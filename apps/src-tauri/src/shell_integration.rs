//! Shell-integration injection for PTY sessions.
//!
//! Wisp injects a small rc snippet at spawn so the shell reports its state
//! back to the terminal: OSC 7 (hostless `file://` cwd) and OSC 133 prompt /
//! command marks. The snippet is delivered through the shell's own standard
//! environment startup channels — user rc files are never modified:
//!
//! * zsh — `ZDOTDIR` points at a Wisp-owned temp directory whose `.zshenv`
//!   restores the original `ZDOTDIR`, sources the user's real `.zshenv`, and
//!   (interactive shells only) defers hook installation to the first prompt
//!   so it layers on top of frameworks like oh-my-zsh.
//! * bash — the shell is spawned with `--posix`, where interactive shells
//!   read `$ENV` instead of `~/.bashrc`; the script leaves POSIX mode,
//!   sources `~/.bashrc`, and appends its hook to `PROMPT_COMMAND`.
//!
//! Both snippets stay inert unless `WISP_SHELL_INTEGRATION=1` was exported
//! by Wisp at spawn, and consume the flag when they arm themselves, so
//! manually sourcing them or re-entering a shell never double-installs.
//!
//! The escape-sequence protocol is public (OSC 7 as used by Terminal.app /
//! WezTerm / VS Code, OSC 133 from the FinalTerm semantic-prompt spec). The
//! scripts below are original Wisp code: the injection *mechanisms* follow
//! Ghostty (MIT) and the wider terminal tradition, but Ghostty's own zsh/bash
//! scripts are Kitty-derived GPLv3 and were deliberately not copied.
//!
//! Set `WISP_DISABLE_SHELL_INTEGRATION=1` in the app's environment to opt out.

use portable_pty::CommandBuilder;
use std::ffi::OsString;
use std::path::PathBuf;

/// Shells Wisp knows how to integrate. Other programs (fish, cmd.exe, …)
/// spawn exactly as before — no injection, no behavior change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Zsh,
    Bash,
}

/// Environment entries plus argv additions that turn a plain shell spawn into
/// an integrated one. Pure data — assembling and applying stay testable apart.
pub struct ShellIntegration {
    pub env: Vec<(String, String)>,
    pub args: Vec<String>,
}

/// Decide whether a shell program can be integrated, by executable basename.
pub fn detect_shell_kind(shell_program: &str) -> Option<ShellKind> {
    let basename = shell_program
        .rsplit(&['/', '\\'][..])
        .next()
        .unwrap_or(shell_program);
    match basename {
        "zsh" => Some(ShellKind::Zsh),
        "bash" => {
            // Apple's patched /bin/bash disables the ENV-based POSIX startup
            // path, so injection is impossible there. Other bash builds work.
            if cfg!(target_os = "macos") && shell_program == "/bin/bash" {
                None
            } else {
                Some(ShellKind::Bash)
            }
        }
        _ => None,
    }
}

/// The `.zshenv` Wisp plants in its own ZDOTDIR. Runs for every zsh started
/// with that ZDOTDIR (interactive or not); interactive shells defer hook
/// installation to the first prompt so the user's `.zshrc` wins.
pub fn build_zshenv_shim() -> &'static str {
    r#"# Wisp terminal shell integration — zsh bootstrap.
# Loaded via ZDOTDIR in place of the user's ~/.zshenv (sourced below).
# Reports cwd (OSC 7) and prompt boundaries (OSC 133) to the terminal;
# never modifies user rc files. Inert unless Wisp spawned this shell.

# Restore the ZDOTDIR Wisp replaced so all later rc files (~/.zshrc, ...)
# load exactly as they would without integration.
if [[ -n "${WISP_ZDOTDIR+x}" ]]; then
    builtin export ZDOTDIR="$WISP_ZDOTDIR"
    builtin unset WISP_ZDOTDIR
else
    builtin unset ZDOTDIR
fi

# Source the user's real .zshenv that our ZDOTDIR shadowed.
{
    builtin typeset _wisp_file="${ZDOTDIR:-$HOME}/.zshenv"
    [[ ! -r "$_wisp_file" ]] || builtin source -- "$_wisp_file"
} always {
    builtin unset '_wisp_file'
}

# Interactive shells spawned by Wisp only; the marker is consumed so a
# re-sourced shim (or `exec zsh` picking it up again) stays inert.
if [[ -o interactive ]] && [[ "${WISP_SHELL_INTEGRATION:-}" == 1 ]]; then
    export WISP_SHELL_INTEGRATION=zsh

    _wisp_report_cwd() {
        builtin print -n -- "\e]7;file://$PWD\a"
    }
    # $? at hook entry still holds the last command's exit status; it must
    # be captured before any other builtin (emulate) clobbers it.
    _wisp_precmd() {
        builtin local -i _wisp_status=$?
        builtin emulate -L zsh
        builtin typeset -gi _wisp_state=${_wisp_state:-0}
        if (( _wisp_state == 1 )); then
            builtin print -n -- "\e]133;D;${_wisp_status}\a"
            _wisp_state=2
        fi
        _wisp_report_cwd
        builtin print -n -- "\e]133;A\a"
        _wisp_state=2
    }
    _wisp_preexec() {
        builtin emulate -L zsh
        builtin typeset -gi _wisp_state=1
        builtin print -n -- "\e]133;C\a"
    }

    # Install at the first prompt, after every user rc file has run, then
    # remove this bootstrap from the precmd list.
    _wisp_deferred_init() {
        builtin emulate -L zsh
        builtin typeset -ag precmd_functions preexec_functions chpwd_functions
        precmd_functions=(${precmd_functions:#_wisp_deferred_init} _wisp_precmd)
        preexec_functions+=(_wisp_preexec)
        chpwd_functions+=(_wisp_report_cwd)
        _wisp_precmd
        builtin unfunction _wisp_deferred_init
    }
    builtin typeset -ag precmd_functions
    precmd_functions+=(_wisp_deferred_init)
fi
"#
}

/// The script `$ENV` points at for bash (spawned `--posix`). Written in
/// POSIX syntax on purpose: `ENV` can leak into child `sh` shells, which
/// must be able to parse — and then ignore — this file.
pub fn build_bash_env_script() -> &'static str {
    r#"# Wisp terminal shell integration — bash bootstrap.
# Loaded through the POSIX-mode ENV startup channel (bash is spawned as
# `bash --posix`, where interactive shells read $ENV instead of ~/.bashrc).
# Reports cwd (OSC 7) and prompt boundaries (OSC 133) to the terminal;
# never modifies user rc files. Inert unless Wisp spawned this shell.

# Non-bash shells (a child sh that inherited ENV) stop here.
[ -n "${BASH_VERSION:-}" ] || return 0
# Interactive shells only.
case $- in *i*) ;; *) return 0 ;; esac
# Wisp-spawned shells only; the marker is consumed so re-sourcing stays inert.
[ "${WISP_SHELL_INTEGRATION:-}" = 1 ] || return 0
WISP_SHELL_INTEGRATION=bash
export WISP_SHELL_INTEGRATION

# Close the ENV channel so it does not leak into child shells, restoring
# the user's original ENV if there was one.
if [ -n "${WISP_BASH_ENV:-}" ]; then
    ENV="${WISP_BASH_ENV}"
    unset WISP_BASH_ENV
    export ENV
else
    unset ENV
fi

# The POSIX startup path skipped normal bash init — redo it here.
set +o posix
[ -n "${HISTFILE:-}" ] || HISTFILE="$HOME/.bash_history"
if [ -z "${WISP_BASH_RC_LOADED:-}" ] && [ -r "$HOME/.bashrc" ]; then
    WISP_BASH_RC_LOADED=1
    . "$HOME/.bashrc"
fi

# $? still holds the last command's exit status at PROMPT_COMMAND entry.
_wisp_precmd() {
    _wisp_status=$?
    if [ "${_wisp_state:-0}" = 1 ]; then
        printf '\033]133;D;%d\007' "$_wisp_status"
        _wisp_state=2
    fi
    printf '\033]7;file://%s\007' "$PWD"
    printf '\033]133;A\007'
    _wisp_state=2
}
# Prepend instead of replace: the user's own PROMPT_COMMAND survives.
case ";${PROMPT_COMMAND:-};" in
    *";_wisp_precmd;"*) ;;
    *) PROMPT_COMMAND="_wisp_precmd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
"#
}

/// Per-app-instance directory under the system temp dir holding the shims.
fn integration_dir() -> PathBuf {
    std::env::temp_dir().join(format!("wisp-shell-integration-{}", std::process::id()))
}

/// Apply the injection to a shell command, in place. Unsupported shells (and
/// the `WISP_DISABLE_SHELL_INTEGRATION` opt-out) leave the command untouched.
pub fn apply_shell_integration(cmd: &mut CommandBuilder, shell_program: &str) {
    if let Some(integration) = setup_shell_integration(shell_program) {
        for (key, value) in integration.env {
            cmd.env(key, value);
        }
        for arg in integration.args {
            cmd.arg(arg);
        }
    }
}

/// Assemble the injection for a shell program, reading Wisp's own ambient
/// environment (opt-out flag, original ZDOTDIR/ENV to preserve).
pub fn setup_shell_integration(shell_program: &str) -> Option<ShellIntegration> {
    build_integration(
        shell_program,
        std::env::var_os("ZDOTDIR"),
        std::env::var_os("ENV"),
        std::env::var_os("WISP_DISABLE_SHELL_INTEGRATION").is_some(),
    )
}

/// Pure core of [`setup_shell_integration`]: everything the result depends on
/// is an argument, so tests never mutate process-global state.
fn build_integration(
    shell_program: &str,
    zdotdir: Option<OsString>,
    env_value: Option<OsString>,
    disabled: bool,
) -> Option<ShellIntegration> {
    if disabled {
        return None;
    }
    match detect_shell_kind(shell_program)? {
        ShellKind::Zsh => {
            let dir = integration_dir();
            std::fs::create_dir_all(&dir).ok()?;
            std::fs::write(dir.join(".zshenv"), build_zshenv_shim()).ok()?;
            let mut env = vec![
                ("ZDOTDIR".to_string(), dir.to_string_lossy().into_owned()),
                ("WISP_SHELL_INTEGRATION".to_string(), "1".to_string()),
            ];
            // The shim restores the user's real ZDOTDIR (dotfile managers).
            if let Some(original) = zdotdir {
                env.push((
                    "WISP_ZDOTDIR".to_string(),
                    original.to_string_lossy().into_owned(),
                ));
            }
            Some(ShellIntegration {
                env,
                args: Vec::new(),
            })
        }
        ShellKind::Bash => {
            let dir = integration_dir();
            std::fs::create_dir_all(&dir).ok()?;
            let script = dir.join("wisp-bash-env.sh");
            std::fs::write(&script, build_bash_env_script()).ok()?;
            let mut env = vec![
                ("ENV".to_string(), script.to_string_lossy().into_owned()),
                ("WISP_SHELL_INTEGRATION".to_string(), "1".to_string()),
            ];
            if let Some(original) = env_value {
                env.push((
                    "WISP_BASH_ENV".to_string(),
                    original.to_string_lossy().into_owned(),
                ));
            }
            Some(ShellIntegration {
                env,
                args: vec!["--posix".to_string()],
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_map(integration: ShellIntegration) -> HashMap<String, String> {
        integration.env.into_iter().collect()
    }

    #[test]
    fn detects_supported_shells_by_basename() {
        assert_eq!(detect_shell_kind("zsh"), Some(ShellKind::Zsh));
        assert_eq!(detect_shell_kind("/bin/zsh"), Some(ShellKind::Zsh));
        assert_eq!(
            detect_shell_kind("/usr/local/bin/zsh"),
            Some(ShellKind::Zsh)
        );
        assert_eq!(detect_shell_kind("bash"), Some(ShellKind::Bash));
        assert_eq!(
            detect_shell_kind("/opt/homebrew/bin/bash"),
            Some(ShellKind::Bash)
        );
        assert_eq!(detect_shell_kind("sh"), None);
        assert_eq!(detect_shell_kind("fish"), None);
        assert_eq!(detect_shell_kind("cmd.exe"), None);
        assert_eq!(detect_shell_kind(""), None);
    }

    /// Apple's /bin/bash disables the ENV startup path — no injection there.
    #[cfg(target_os = "macos")]
    #[test]
    fn apples_bash_is_not_injectable() {
        assert_eq!(detect_shell_kind("/bin/bash"), None);
    }

    #[test]
    fn zsh_shim_restores_zdotdir_and_emits_marks() {
        let shim = build_zshenv_shim();
        // ZDOTDIR restore both ways (backup present / absent).
        assert!(shim.contains("WISP_ZDOTDIR"));
        assert!(shim.contains("builtin unset ZDOTDIR"));
        // The user's real .zshenv is still sourced.
        assert!(shim.contains("/.zshenv"));
        // Interactive-only guard, gated on the Wisp-spawned marker.
        assert!(shim.contains("[[ -o interactive ]]"));
        assert!(shim.contains("\"${WISP_SHELL_INTEGRATION:-}\" == 1"));
        // The OSC 7 / OSC 133 emissions.
        assert!(shim.contains("133;D;"));
        assert!(shim.contains("7;file://"));
        assert!(shim.contains("133;A"));
        assert!(shim.contains("133;C"));
        // $? is captured before `emulate` can clobber it.
        let status_line = shim
            .lines()
            .find(|line| line.contains("_wisp_status=$?"))
            .expect("status capture exists");
        assert!(
            status_line.trim_start().starts_with("builtin local"),
            "the status capture must be the first statement of the hook: {status_line}"
        );
    }

    #[test]
    fn bash_script_is_posix_syntax_and_coexists_with_user_rc() {
        let script = build_bash_env_script();
        // POSIX-parse guards: no bash-only `[[`, and `.` instead of `source`.
        assert!(!script.contains("[["));
        assert!(!script.contains("\nsource "));
        // Only bash proceeds past the gate.
        assert!(script.contains("BASH_VERSION"));
        // The user's bashrc is loaded and PROMPT_COMMAND preserved.
        assert!(script.contains(".bashrc"));
        assert!(script.contains(";_wisp_precmd;"));
        assert!(script.contains("set +o posix"));
        // The OSC emissions (printf \033 forms).
        assert!(script.contains("133;D;%d"));
        assert!(script.contains("]7;file://%s"));
        assert!(script.contains("133;A"));
    }

    #[test]
    fn setup_zsh_plants_shim_and_env() {
        let integration = build_integration("/bin/zsh", None, None, false).expect("zsh integrates");
        let env = env_map(integration);
        let zdotdir = env.get("ZDOTDIR").expect("ZDOTDIR is set").clone();
        assert_eq!(
            env.get("WISP_SHELL_INTEGRATION").map(String::as_str),
            Some("1")
        );
        assert!(
            !env.contains_key("WISP_ZDOTDIR"),
            "no backup without an original"
        );
        let planted = std::fs::read_to_string(std::path::Path::new(&zdotdir).join(".zshenv"))
            .expect("shim is on disk");
        assert!(planted.contains("_wisp_precmd"));

        // A preexisting ZDOTDIR is preserved through the backup variable.
        let integration = build_integration(
            "zsh",
            Some(OsString::from("/tmp/user-zdotdir")),
            None,
            false,
        )
        .expect("zsh integrates");
        let env = env_map(integration);
        assert_eq!(
            env.get("WISP_ZDOTDIR").map(String::as_str),
            Some("/tmp/user-zdotdir")
        );
    }

    #[test]
    fn setup_bash_uses_posix_env_channel() {
        let integration = build_integration(
            "/opt/homebrew/bin/bash",
            None,
            Some(OsString::from("/tmp/user-env")),
            false,
        )
        .expect("bash integrates");
        assert_eq!(integration.args, vec!["--posix".to_string()]);
        let env = env_map(integration);
        assert_eq!(
            env.get("WISP_BASH_ENV").map(String::as_str),
            Some("/tmp/user-env")
        );
        let script = std::fs::read_to_string(env.get("ENV").expect("ENV points at the script"))
            .expect("script is on disk");
        assert!(script.contains("_wisp_precmd"));
    }

    #[test]
    fn unsupported_shells_and_opt_out_spawn_untouched() {
        assert!(build_integration("sh", None, None, false).is_none());
        assert!(build_integration("cmd.exe", None, None, false).is_none());
        assert!(build_integration("zsh", None, None, true).is_none());
        assert!(build_integration("bash", None, None, true).is_none());
    }

    /// End-to-end through a real PTY: an interactive zsh started with the
    /// injected ZDOTDIR must emit the OSC 7 / OSC 133 marks the frontend
    /// parses — including the D;0 finish of a successful `cd`.
    #[cfg(unix)]
    #[test]
    fn zsh_shim_emits_marks_over_a_real_pty() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::{Read, Write};

        let integration = build_integration("zsh", None, None, false).expect("zsh integrates");
        let env = env_map(integration);
        let zdotdir = env.get("ZDOTDIR").expect("ZDOTDIR set").clone();

        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new("zsh");
        cmd.env("ZDOTDIR", &zdotdir);
        cmd.env("WISP_SHELL_INTEGRATION", "1");
        cmd.cwd(std::env::temp_dir());
        let mut child = pair.slave.spawn_command(cmd).expect("spawn zsh");
        drop(pair.slave);

        let mut writer = pair.master.take_writer().expect("writer");
        let mut reader = pair.master.try_clone_reader().expect("reader");
        // Two prompt cycles: the first proves deferred init + first-prompt
        // marks; the second proves preexec/precmd pairing after a command.
        // The PTY buffers input until the shell reads it, so writing
        // immediately is safe.
        writer.write_all(b"cd /\nexit\n").expect("write");
        writer.flush().expect("flush");

        let mut output = Vec::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            output.extend_from_slice(&buf[..n]);
        }
        let _ = child.wait();

        let text = String::from_utf8_lossy(&output);
        assert!(
            // Three slashes = hostless: exactly the local-only form the
            // frontend trusts (a hostful report would be a remote shell's).
            text.contains("\u{1b}]7;file:///"),
            "missing hostless OSC 7 cwd report in: {text:?}"
        );
        assert!(
            text.contains("\u{1b}]133;A"),
            "missing OSC 133 prompt mark in: {text:?}"
        );
        assert!(
            text.contains("\u{1b}]133;C"),
            "missing OSC 133 command mark in: {text:?}"
        );
        assert!(
            text.contains("\u{1b}]133;D;0"),
            "missing OSC 133 finish mark with exit status in: {text:?}"
        );
    }
}
