//! Multi-instance PTY module — each terminal tab gets its own PTY session
//! identified by a unique `session_id`.

use crate::operations::validate_file_path;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{command, Emitter};
use tracing::warn;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _reader_handle: std::thread::JoinHandle<()>,
    child: Box<dyn portable_pty::Child + Send>,
}

static PTY_SESSIONS: Mutex<Option<HashMap<String, PtySession>>> = Mutex::new(None);

fn sessions() -> std::sync::MutexGuard<'static, Option<HashMap<String, PtySession>>> {
    let mut guard = PTY_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    guard
}

/// Incremental UTF-8 decoder for PTY output.
///
/// A read can end in the middle of a multi-byte character (a Chinese character
/// is three bytes), and decoding each chunk on its own turns the split
/// character into replacement characters. Bytes that do not form a complete
/// sequence yet are kept until the next read completes them.
#[derive(Default)]
struct Utf8Chunker {
    pending: Vec<u8>,
}

impl Utf8Chunker {
    fn push(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    out.push_str(&String::from_utf8_lossy(&self.pending[..valid]));
                    match error.error_len() {
                        // Genuinely invalid bytes: substitute and continue.
                        Some(len) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + len);
                        }
                        // Incomplete trailing sequence: wait for the next read.
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }
}

/// Environment a shell expects when it is launched from a GUI app: a UTF-8
/// locale and a terminal identity. Without a locale the shell falls back to
/// the C locale, where it treats non-ASCII output as unprintable bytes.
fn apply_terminal_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Wisp");
    if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if std::env::var_os("LC_CTYPE").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LC_CTYPE", "UTF-8");
    }
}

#[command]
pub async fn pty_spawn(
    app_handle: tauri::AppHandle,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Validate session_id format
    validate_session_id(&session_id)?;

    // Validate cwd path
    validate_file_path(&cwd)?;

    tokio::task::spawn_blocking(move || {
        kill_session(&session_id);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(&cwd);
        apply_terminal_env(&mut cmd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let handle = app_handle.clone();
        let sid = session_id.clone();
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut decoder = Utf8Chunker::default();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = decoder.push(&buf[..n]);
                        if data.is_empty() {
                            continue;
                        }
                        let payload = serde_json::json!({ "session_id": sid, "data": data });
                        if let Err(e) = handle.emit("pty-output", &payload) {
                            warn!("Failed to emit pty-output: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        let kind = e.kind();
                        if kind == std::io::ErrorKind::Other
                            || kind == std::io::ErrorKind::BrokenPipe
                            || kind == std::io::ErrorKind::UnexpectedEof
                        {
                            break;
                        }
                        warn!("PTY read error ({}): {}", sid, e);
                        break;
                    }
                }
            }
            let _ = handle.emit("pty-exit", &sid);
        });

        let mut guard = sessions();
        let map = guard
            .as_mut()
            .ok_or("PTY session map not initialized")
            .map_err(|e| e.to_string())?;
        map.insert(
            session_id,
            PtySession {
                master: pair.master,
                writer,
                _reader_handle: reader_handle,
                child,
            },
        );

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub fn pty_write(session_id: String, data: String) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let mut guard = sessions();
    let map = guard
        .as_mut()
        .ok_or("PTY session map not initialized")
        .map_err(|e| e.to_string())?;
    if let Some(session) = map.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("PTY write error: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("PTY flush error: {}", e))?;
        Ok(())
    } else {
        Err(format!("No PTY session '{}'", session_id))
    }
}

#[command]
pub fn pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let guard = sessions();
    let map = guard
        .as_ref()
        .ok_or("PTY session map not initialized")
        .map_err(|e| e.to_string())?;
    if let Some(session) = map.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY resize error: {}", e))?;
        Ok(())
    } else {
        Err(format!("No PTY session '{}'", session_id))
    }
}

#[command]
pub fn pty_kill(session_id: String) -> Result<(), String> {
    validate_session_id(&session_id)?;
    kill_session(&session_id);
    Ok(())
}

#[command]
pub fn pty_kill_all() -> Result<(), String> {
    let mut guard = sessions();
    if let Some(map) = guard.as_mut() {
        for (_, mut session) in map.drain() {
            let _ = session.child.kill();
            drop(session.writer);
        }
    }
    Ok(())
}

fn kill_session(session_id: &str) {
    let mut guard = sessions();
    if let Some(map) = guard.as_mut() {
        if let Some(mut session) = map.remove(session_id) {
            let _ = session.child.kill();
            drop(session.writer);
        }
    }
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        || session_id.len() > 64
    {
        return Err("Invalid session ID format".to_string());
    }
    Ok(())
}

fn default_shell() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "cmd.exe"
    }
    #[cfg(target_os = "macos")]
    {
        "zsh"
    }
    #[cfg(target_os = "linux")]
    {
        "bash"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "sh"
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8Chunker;

    /// A multi-byte character split across two reads must survive intact —
    /// this is the case that used to render Chinese prompts as `�`.
    #[test]
    fn reassembles_a_character_split_across_reads() {
        let bytes = "工作目录".as_bytes();
        let split = 4; // inside the second character
        let mut decoder = Utf8Chunker::default();
        let first = decoder.push(&bytes[..split]);
        let second = decoder.push(&bytes[split..]);
        assert_eq!(first, "工");
        assert_eq!(second, "作目录");
        assert!(!format!("{first}{second}").contains('\u{FFFD}'));
    }

    /// Regression proof for the reported bug: the previous reader decoded each
    /// 4096-byte chunk on its own, so a character split across a read became
    /// replacement characters. This pins the old behaviour as broken and the
    /// new decoder as correct for the very same bytes.
    #[test]
    fn a_split_character_used_to_be_corrupted() {
        let bytes = "\u{5de5}\u{4f5c}\u{76ee}\u{5f55}".as_bytes(); // 工作目录
        let split = 4; // inside the second character

        let old = format!(
            "{}{}",
            String::from_utf8_lossy(&bytes[..split]),
            String::from_utf8_lossy(&bytes[split..])
        );
        assert!(
            old.contains('\u{FFFD}'),
            "the previous per-chunk decode is expected to corrupt this split"
        );

        let mut decoder = Utf8Chunker::default();
        let fixed = format!(
            "{}{}",
            decoder.push(&bytes[..split]),
            decoder.push(&bytes[split..])
        );
        assert_eq!(fixed, "\u{5de5}\u{4f5c}\u{76ee}\u{5f55}");
    }

    /// The same protection when the stream arrives one byte at a time.
    #[test]
    fn reassembles_byte_by_byte() {
        let text = "中文🎉ok";
        let mut decoder = Utf8Chunker::default();
        let mut out = String::new();
        for byte in text.as_bytes() {
            out.push_str(&decoder.push(&[*byte]));
        }
        assert_eq!(out, text);
    }

    /// Invalid bytes become one replacement character and do not swallow the
    /// text that follows them.
    #[test]
    fn survives_invalid_bytes() {
        let mut decoder = Utf8Chunker::default();
        let out = decoder.push(b"a\xff\xfeb");
        assert_eq!(out, "a\u{FFFD}\u{FFFD}b");
        assert_eq!(decoder.push(b"c"), "c");
    }

    /// The real read path: a live PTY, a real shell and more Chinese than one
    /// 4096-byte read can hold. The old per-chunk lossy decode turned every
    /// character straddling a read boundary into U+FFFD — the garbled prompts.
    #[cfg(unix)]
    #[test]
    fn pty_output_survives_read_boundaries() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;

        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new(super::default_shell());
        cmd.arg("-c");
        // The backslash must reach the shell: printf expands \u4e2d to 中.
        cmd.arg("printf '\\u4e2d%.0s' {1..5000}");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn shell");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("clone reader");
        let mut decoder = Utf8Chunker::default();
        let mut text = String::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            text.push_str(&decoder.push(&buf[..n]));
        }
        let _ = child.wait();

        assert!(
            !text.contains('\u{FFFD}'),
            "output contained replacement characters: {text:?}"
        );
        assert_eq!(
            text.matches('\u{4e2d}').count(),
            5000,
            "every character must survive the read boundaries"
        );
    }

    /// Complete chunks are passed through untouched.
    #[test]
    fn passes_complete_text_through() {
        let mut decoder = Utf8Chunker::default();
        assert_eq!(decoder.push("$ ls — 目录".as_bytes()), "$ ls — 目录");
    }
}
