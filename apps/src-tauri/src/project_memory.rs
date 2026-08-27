//! Project Memory — forensic reader for CLI agent session logs.
//!
//! Reads the session files that Claude Code and Codex persist on disk
//! (zero instrumentation — the agents may have run anywhere):
//!   Claude Code: ~/.claude/projects/<munged-cwd>/<session-id>.jsonl
//!     (cwd non-alphanumeric chars are replaced with '-')
//!   Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//!     (the session_meta header line carries the cwd)
//!
//! Sessions are aggregated for a queried working directory; the first
//! human-written message becomes the title (system-injected context that
//! starts with '<' or 'Caveat:' is skipped), and file changes are derived
//! from write tool calls.

use serde_json::Value;
use std::collections::BTreeSet;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSession {
    pub id: String,
    /// "claude-code" | "codex"
    pub agent: String,
    pub title: String,
    /// ISO timestamps
    pub started_at: String,
    pub last_activity: String,
    pub changed_files: Vec<String>,
}

/// Only surface sessions whose log was touched in the last N days.
const MAX_AGE_DAYS: u64 = 30;
/// Skip pathological session files larger than this (parse cost guard).
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const TITLE_MAX_CHARS: usize = 120;
const MAX_CHANGED_FILES: usize = 200;

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

fn is_recent(path: &std::path::Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => match meta.modified() {
            Ok(modified) => {
                modified
                    .elapsed()
                    .map(|e| e.as_secs() < MAX_AGE_DAYS * 24 * 3600)
                    .unwrap_or(true)
            }
            Err(_) => true,
        },
        Err(_) => false,
    }
}

/// Claude Code project directory name for a cwd: every non-alphanumeric
/// character becomes '-' (verified against ~/.claude/projects on disk).
fn munge_claude_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Extract the first human-written user message as a session title.
/// Skips system-injected context and tool-result entries.
fn claude_title(entries: &[Value]) -> String {
    for entry in entries {
        if entry.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let Some(message) = entry.get("message") else {
            continue;
        };
        let Some(content) = message.get("content") else {
            continue;
        };
        let text: Option<&str> = if let Some(s) = content.as_str() {
            Some(s)
        } else if let Some(blocks) = content.as_array() {
            // Tool results come back as user-role entries with tool_result
            // blocks — they are not conversation input.
            if blocks
                .iter()
                .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            {
                continue;
            }
            blocks
                .iter()
                .find_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
        } else {
            None
        };
        let Some(text) = text else { continue };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Slash-command wrappers and system context are machine-written
        if trimmed.starts_with('<') || trimmed.starts_with("Caveat:") {
            continue;
        }
        let mut title: String = trimmed.chars().take(TITLE_MAX_CHARS).collect();
        if trimmed.chars().count() > TITLE_MAX_CHARS {
            title.push('…');
        }
        return title;
    }
    "Untitled session".to_string()
}

/// File paths touched by write-class tool calls in a Claude session.
fn claude_changed_files(entries: &[Value]) -> Vec<String> {
    let mut files = BTreeSet::new();
    for entry in entries {
        let Some(blocks) = entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            continue;
        };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }
            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if !matches!(name, "Write" | "Edit" | "MultiEdit" | "NotebookEdit") {
                continue;
            }
            if let Some(path) = block
                .get("input")
                .and_then(|i| i.get("file_path"))
                .or_else(|| block.get("input").and_then(|i| i.get("notebook_path")))
                .and_then(|p| p.as_str())
            {
                files.insert(path.to_string());
                if files.len() >= MAX_CHANGED_FILES {
                    return files.into_iter().collect();
                }
            }
        }
    }
    files.into_iter().collect()
}

fn parse_claude_session(path: &std::path::Path, cwd: &str) -> Option<ProjectSession> {
    let data = std::fs::read_to_string(path).ok()?;
    let mut entries: Vec<Value> = Vec::new();
    for line in data.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(v) => entries.push(v),
            Err(_) => continue,
        }
    }
    if entries.is_empty() {
        return None;
    }

    // Confirm this session actually ran in the queried directory (the
    // munged folder name is strong evidence; the cwd field double-checks).
    let cwd_match = entries.iter().any(|e| {
        e.get("cwd")
            .and_then(|c| c.as_str())
            .map(|c| c == cwd)
            .unwrap_or(true)
    });
    if !cwd_match {
        return None;
    }

    let id = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let timestamps: Vec<&str> = entries
        .iter()
        .filter_map(|e| e.get("timestamp").and_then(|t| t.as_str()))
        .collect();
    let (started, last) = match (timestamps.first(), timestamps.last()) {
        (Some(a), Some(b)) => (a.to_string(), b.to_string()),
        _ => (String::new(), String::new()),
    };

    Some(ProjectSession {
        id,
        agent: "claude-code".to_string(),
        title: claude_title(&entries),
        started_at: started,
        last_activity: last,
        changed_files: claude_changed_files(&entries),
    })
}

/// Codex user messages: event_msg entries with payload.type == "user_message".
fn codex_title(payload_messages: &[String]) -> String {
    for text in payload_messages {
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.starts_with('<') || trimmed.starts_with("Caveat:") {
            continue;
        }
        let mut title: String = trimmed.chars().take(TITLE_MAX_CHARS).collect();
        if trimmed.chars().count() > TITLE_MAX_CHARS {
            title.push('…');
        }
        return title;
    }
    "Untitled session".to_string()
}

/// Codex file changes live inside apply_patch call arguments as
/// "*** Add File: <path>" / "*** Update File: <path>" markers. Inside the
/// raw JSON-encoded log line the path is terminated by an escaped newline
/// (literal backslash-n) or a quote, not a real newline.
fn codex_changed_files(data: &str) -> Vec<String> {
    fn path_after_marker(after: &str) -> String {
        let end = after.find('\n').or_else(|| after.find('"')).unwrap_or(after.len());
        let segment = &after[..end];
        let cut = segment.find("\\n").unwrap_or(segment.len());
        segment[..cut].trim().trim_matches('"').to_string()
    }

    let mut files = BTreeSet::new();
    for marker in ["*** Add File: ", "*** Update File: ", "*** Delete File: "] {
        let mut rest = data;
        while let Some(idx) = rest.find(marker) {
            let after = &rest[idx + marker.len()..];
            let path = path_after_marker(after);
            if !path.is_empty() {
                files.insert(path);
            }
            rest = after;
        }
    }
    files.into_iter().take(MAX_CHANGED_FILES).collect()
}

fn parse_codex_session(path: &std::path::Path, cwd: &str) -> Option<ProjectSession> {
    // Header-first: session_meta on line 1 carries id + cwd, so mismatched
    // sessions are rejected without reading the whole file.
    let mut first_line = String::new();
    {
        use std::io::BufRead;
        let file = std::fs::File::open(path).ok()?;
        let mut reader = std::io::BufReader::new(file);
        if reader.read_line(&mut first_line).is_err() {
            return None;
        }
    }
    let header: Value = serde_json::from_str(first_line.trim()).ok()?;
    let payload = header.get("payload")?;
    if payload.get("cwd").and_then(|c| c.as_str()) != Some(cwd) {
        return None;
    }

    let data = std::fs::read_to_string(path).ok()?;
    let mut user_messages: Vec<String> = Vec::new();
    let mut timestamps: Vec<String> = Vec::new();
    for line in data.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
            timestamps.push(ts.to_string());
        }
        let Some(payload) = v.get("payload") else { continue };
        if payload.get("type").and_then(|t| t.as_str()) == Some("user_message") {
            if let Some(msg) = payload.get("message").and_then(|m| m.as_str()) {
                user_messages.push(msg.to_string());
            }
        }
    }

    let id = payload
        .get("id")
        .and_then(|i| i.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let (started, last) = match (timestamps.first(), timestamps.last()) {
        (Some(a), Some(b)) => (a.clone(), b.clone()),
        _ => (String::new(), String::new()),
    };

    Some(ProjectSession {
        id,
        agent: "codex".to_string(),
        title: codex_title(&user_messages),
        started_at: started,
        last_activity: last,
        changed_files: codex_changed_files(&data),
    })
}

/// List CLI agent sessions that ran in `cwd`, newest first.
#[command]
pub async fn project_memory_sessions(cwd: String) -> Result<Vec<ProjectSession>, String> {
    let home = home_dir().ok_or("HOME not set")?;
    let mut sessions: Vec<ProjectSession> = Vec::new();

    // Claude Code: directory name is deterministic, no scanning needed
    let claude_dir = home
        .join(".claude/projects")
        .join(munge_claude_dir(&cwd));
    if let Ok(entries) = std::fs::read_dir(&claude_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if !is_recent(&path) {
                continue;
            }
            if entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
                continue;
            }
            if let Some(session) = parse_claude_session(&path, &cwd) {
                sessions.push(session);
            }
        }
    }

    // Codex: date-nested rollouts, header cwd decides membership
    let codex_root = home.join(".codex/sessions");
    if let Ok(years) = std::fs::read_dir(&codex_root) {
        for year in years.flatten() {
            let Ok(months) = std::fs::read_dir(year.path()) else {
                continue;
            };
            for month in months.flatten() {
                let Ok(days) = std::fs::read_dir(month.path()) else {
                    continue;
                };
                for day in days.flatten() {
                    let Ok(files) = std::fs::read_dir(day.path()) else {
                        continue;
                    };
                    for file in files.flatten() {
                        let path = file.path();
                        let name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        if !name.starts_with("rollout-") || !name.ends_with(".jsonl") {
                            continue;
                        }
                        if !is_recent(&path) {
                            continue;
                        }
                        if file.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
                            continue;
                        }
                        if let Some(session) = parse_codex_session(&path, &cwd) {
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    sessions.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    sessions.truncate(50);
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn munges_cwd_like_claude_code() {
        assert_eq!(
            munge_claude_dir("/Users/weixili/git/loop"),
            "-Users-weixili-git-loop"
        );
        assert_eq!(
            munge_claude_dir("/Users/weixili/.agents/skills/huashu-design"),
            "-Users-weixili--agents-skills-huashu-design"
        );
    }

    #[test]
    fn claude_title_skips_injected_context() {
        let entries: Vec<Value> = serde_json::from_str(
            r#"[
              {"type":"user","message":{"role":"user","content":"<command-message>run</command-message>"}},
              {"type":"user","message":{"role":"user","content":"Caveat: The messages below were generated..."}},
              {"type":"user","message":{"role":"user","content":[{"type":"tool_result","text":"ok"}]}},
              {"type":"user","message":{"role":"user","content":"帮我整理这个文件夹"}}
            ]"#,
        )
        .unwrap();
        assert_eq!(claude_title(&entries), "帮我整理这个文件夹");
    }

    #[test]
    fn extracts_claude_write_tools() {
        let entries: Vec<Value> = serde_json::from_str(
            r#"[
              {"type":"assistant","message":{"content":[
                {"type":"tool_use","name":"Read","input":{"file_path":"/tmp/a.txt"}},
                {"type":"tool_use","name":"Write","input":{"file_path":"/tmp/b.txt"}},
                {"type":"tool_use","name":"Edit","input":{"file_path":"/tmp/c.txt"}}
              ]}}
            ]"#,
        )
        .unwrap();
        assert_eq!(
            claude_changed_files(&entries),
            vec!["/tmp/b.txt".to_string(), "/tmp/c.txt".to_string()]
        );
    }

    #[test]
    fn extracts_codex_apply_patch_files() {
        // Raw log line: the patch lives inside a JSON string, so newlines
        // appear as the literal two characters \n
        let raw = r#"{"arguments":"*** Begin Patch\n*** Add File: /tmp/new.rs\n+x\n*** Update File: /tmp/old.rs\n@@\n*** End Patch"}"#;
        assert_eq!(
            codex_changed_files(raw),
            vec!["/tmp/new.rs".to_string(), "/tmp/old.rs".to_string()]
        );
        // Plain text with real newlines also works
        let plain = "*** Delete File: /tmp/gone.txt\nrest";
        assert_eq!(codex_changed_files(plain), vec!["/tmp/gone.txt".to_string()]);
    }

    /// Live check against the real ~/.claude log store on this machine.
    /// Skips when no session log has been touched in the last 30 days.
    #[test]
    #[ignore]
    fn reads_real_claude_sessions() {
        let home = home_dir().expect("HOME");
        let projects = home.join(".claude/projects");

        // Find any session file that passes the same recency filter the
        // command applies, and recover its real cwd from the log content.
        let mut recent: Option<(std::path::PathBuf, String)> = None;
        'outer: for dir in std::fs::read_dir(&projects)
            .expect("~/.claude/projects exists on this machine")
            .flatten()
        {
            if !dir.path().is_dir() {
                continue;
            }
            for file in std::fs::read_dir(dir.path()).unwrap().flatten() {
                let path = file.path();
                if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                    continue;
                }
                if !is_recent(&path) {
                    continue;
                }
                if let Ok(data) = std::fs::read_to_string(&path) {
                    let cwd = data
                        .lines()
                        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                        .find_map(|v| v.get("cwd").and_then(|c| c.as_str()).map(String::from));
                    if let Some(cwd) = cwd {
                        recent = Some((path, cwd));
                        break 'outer;
                    }
                }
            }
        }

        let Some((_path, real_cwd)) = recent else {
            println!("SKIP: no Claude session log modified in the last 30 days");
            return;
        };

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let sessions = rt
            .block_on(project_memory_sessions(real_cwd.clone()))
            .expect("parse succeeds");
        assert!(!sessions.is_empty(), "sessions found for {real_cwd}");
        // We queried a directory with a known Claude log, so at least one
        // Claude session must come back; Codex sessions for the same dir
        // are welcome to appear alongside.
        assert!(
            sessions.iter().any(|s| s.agent == "claude-code"),
            "at least one claude-code session"
        );
        for s in &sessions {
            assert!(!s.title.is_empty(), "every session has a title");
        }
        println!(
            "real sessions for {}: {} (first title: {})",
            real_cwd,
            sessions.len(),
            sessions[0].title
        );
    }
}
