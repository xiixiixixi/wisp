//! ChatGPT Bridge — read-only, whitelisted file access for ChatGPT via
//! OpenAI's official Secure MCP Tunnel.
//!
//! Architecture (per developers.openai.com/api/docs/guides/secure-mcp-tunnels):
//!
//! ```text
//! ChatGPT web ── OpenAI tunnel endpoint ── tunnel-client (child process)
//!                                                │ --mcp-command spawns
//!                                                ▼
//!                wisp --chatgpt-bridge-mcp --config <chatgpt-bridge.json>
//!                (headless stdio MCP server, read-only tools only)
//! ```
//!
//! Security model — enforced server-side, never client-side:
//!   * only read tools are registered (no write / no shell)
//!   * every path must resolve (canonicalize) inside an allowed root
//!   * sensitive files (.env, keys, .ssh, …) are rejected even inside roots
//!   * the API key lives in the OS keychain, never in the config file
//!
//! The GUI side manages the `tunnel-client` child: spawn, health-poll
//! (`/readyz`), crash restart with backoff, stale-instance cleanup (only one
//! client may run per tunnel_id).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter, Manager};
use tracing::{info, warn};

use crate::mcp_host;
use crate::secure_credentials;

/// Keychain entry holding the runtime API key (`CONTROL_PLANE_API_KEY`).
pub const API_KEYCHAIN_KEY: &str = "chatgpt-bridge.api-key";

const CONFIG_FILE: &str = "chatgpt-bridge.json";
const PID_FILE: &str = "chatgpt-bridge.pid";
const HEALTH_URL_FILE: &str = "chatgpt-bridge-health.url";
const STATUS_EVENT: &str = "chatgpt-bridge-status";
const MAX_STDERR_TAIL: usize = 8 * 1024;
const RESTART_BACKOFF_SECS: &[u64] = &[2, 4, 8, 16, 30];
const STABLE_UPTIME_SECS: u64 = 60;

// ─── Config ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    pub version: u32,
    pub enabled: bool,
    pub tunnel_id: String,
    /// Explicit `tunnel-client` path; `None` = auto-detect (PATH + Homebrew).
    #[serde(default)]
    pub tunnel_client_path: Option<String>,
    /// Directory whitelist — absolute, canonicalized on load. Empty = the
    /// server serves nothing (safe default).
    #[serde(default)]
    pub allowed_roots: Vec<String>,
    /// Per-file read cap for the read_file tool.
    #[serde(default = "default_max_file_bytes")]
    pub max_file_bytes: u64,
}

const fn default_max_file_bytes() -> u64 {
    512 * 1024
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            tunnel_id: String::new(),
            tunnel_client_path: None,
            allowed_roots: Vec::new(),
            max_file_bytes: default_max_file_bytes(),
        }
    }
}

impl BridgeConfig {
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|e| {
                warn!("[ChatGPTBridge] config parse failed ({e}), using defaults");
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create config dir: {e}"))?;
        }
        let raw = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, raw).map_err(|e| format!("write config: {e}"))
    }
}

/// Config path inside the Tauri app data dir.
pub fn config_path_for(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./data"))
        .join(CONFIG_FILE)
}

/// Config path for the headless `--chatgpt-bridge-mcp` mode (no app handle).
fn config_path_headless(explicit: Option<&str>) -> PathBuf {
    if let Some(p) = explicit {
        return PathBuf::from(p);
    }
    if let Ok(env_path) = std::env::var("WISP_BRIDGE_CONFIG") {
        if !env_path.is_empty() {
            return PathBuf::from(env_path);
        }
    }
    // Mirror Tauri's app_data_dir for com.wisp.app.
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    #[cfg(target_os = "macos")]
    let base = home.join("Library/Application Support/com.wisp.app");
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = home.join(".local/share/com.wisp.app");
    #[cfg(target_os = "windows")]
    let base = home.join("AppData/Roaming/com.wisp.app");
    base.join(CONFIG_FILE)
}

// ─── Read-only access policy ────────────────────────────────────────────────

/// Directory names that are always denied, even inside an allowed root.
const DENIED_SEGMENTS: &[&str] = &[".ssh", ".gnupg", ".aws", ".kube", "keychains"];

/// Exact file names that are always denied.
const DENIED_FILE_NAMES: &[&str] = &[
    ".env",
    ".netrc",
    "_netrc",
    ".npmrc",
    ".pypirc",
    "credentials.json",
];

/// File-name prefixes that are always denied (dot-env variants, private keys).
const DENIED_FILE_PREFIXES: &[&str] = &[".env.", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];

/// File-name suffixes that are always denied (certificates / keystores).
const DENIED_FILE_SUFFIXES: &[&str] = &[".pem", ".key", ".p12", ".pfx", ".keystore"];

/// True when a path (already lowercase, forward slashes) touches a sensitive
/// location. Applied to listings as well as reads. Only the final file-name
/// is matched against prefix/suffix rules so "monkeypedia.md" stays readable.
pub fn is_sensitive_path(lower: &str) -> bool {
    let name = lower.rsplit('/').next().unwrap_or(lower);
    for seg in lower.split('/') {
        if DENIED_SEGMENTS.contains(&seg) {
            return true;
        }
    }
    if DENIED_FILE_NAMES.contains(&name) {
        return true;
    }
    if DENIED_FILE_PREFIXES.iter().any(|p| name.starts_with(p)) {
        return true;
    }
    DENIED_FILE_SUFFIXES.iter().any(|s| name.ends_with(s))
}

/// Whitelist + sensitive-file policy for the read-only MCP server.
pub struct AccessPolicy {
    roots: Vec<PathBuf>,
    pub max_file_bytes: u64,
}

impl AccessPolicy {
    pub fn from_config(config: &BridgeConfig) -> Self {
        let roots = config
            .allowed_roots
            .iter()
            .map(PathBuf::from)
            .filter_map(|p| std::fs::canonicalize(&p).ok())
            .collect();
        Self {
            roots,
            max_file_bytes: config.max_file_bytes,
        }
    }

    /// Validate a caller-supplied path: reject null bytes, require the
    /// canonical path to sit inside an allowed root, reject sensitive paths,
    /// and run the shared system-directory validation as a final layer.
    /// Symlinks are safe: canonicalize resolves them, so a link pointing
    /// outside the whitelist fails the containment check.
    pub fn check(&self, raw: &str) -> Result<PathBuf, String> {
        if raw.contains('\0') {
            return Err("Access denied: path contains null bytes".to_string());
        }
        let canon = std::fs::canonicalize(raw)
            .map_err(|_| format!("Path not found: {raw}"))?;
        if !self.roots.iter().any(|root| canon.starts_with(root)) {
            return Err(format!(
                "Access denied: '{raw}' is outside the shared directories"
            ));
        }
        let lower = canon.to_string_lossy().replace('\\', "/").to_lowercase();
        if is_sensitive_path(&lower) {
            return Err("Access denied: sensitive file or directory".to_string());
        }
        crate::operations::validate_file_path(&canon.to_string_lossy())?;
        Ok(canon)
    }
}

// ─── Read-only MCP tools ────────────────────────────────────────────────────

/// MCP-shaped tool result (content blocks, not a JSON envelope) so ChatGPT
/// reads file text directly instead of double-encoded JSON.
pub struct BridgeToolResult {
    pub content: Vec<Value>,
    pub is_error: bool,
}

impl BridgeToolResult {
    fn text(t: impl Into<String>) -> Self {
        Self {
            content: vec![json!({ "type": "text", "text": t.into() })],
            is_error: false,
        }
    }

    fn error(t: impl Into<String>) -> Self {
        Self {
            content: vec![json!({ "type": "text", "text": t.into() })],
            is_error: true,
        }
    }
}

/// Tool catalogue for the bridge profile. Read-only by construction:
/// no write tool, no shell tool — ChatGPT developer-mode connectors only
/// accept read-only tools anyway.
pub fn bridge_list_tools() -> Vec<mcp_host::McpToolSchema> {
    vec![
        mcp_host::McpToolSchema {
            name: "read_file".to_string(),
            description: "Read the text content of a shared file (size-capped).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the file." }
                },
                "required": ["path"]
            }),
        },
        mcp_host::McpToolSchema {
            name: "list_directory".to_string(),
            description: "List entries of a shared directory (sensitive names filtered)."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the directory." }
                },
                "required": ["path"]
            }),
        },
        mcp_host::McpToolSchema {
            name: "search_files".to_string(),
            description: "Search a shared directory for files whose name contains a query."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "directory": { "type": "string", "description": "Absolute path to search in (must be shared)." },
                    "query": { "type": "string", "description": "Case-insensitive name substring." }
                },
                "required": ["directory", "query"]
            }),
        },
        mcp_host::McpToolSchema {
            name: "get_file_info".to_string(),
            description: "Get size, kind and modification time of a shared file or directory."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path." }
                },
                "required": ["path"]
            }),
        },
    ]
}

fn arg_str(arguments: &Value, key: &str) -> Option<String> {
    arguments.get(key).and_then(|v| v.as_str()).map(String::from)
}

/// Dispatch a `tools/call` for the bridge profile using the policy derived
/// from the config this process was started with.
pub fn bridge_call_tool(name: &str, arguments: &Value) -> BridgeToolResult {
    let args: Vec<String> = std::env::args().collect();
    let explicit = args
        .iter()
        .position(|a| a == "--config")
        .and_then(|i| args.get(i + 1))
        .cloned();
    let path = config_path_headless(explicit.as_deref());
    let policy = AccessPolicy::from_config(&BridgeConfig::load(&path));
    bridge_call_tool_with(&policy, name, arguments)
}

/// Policy-injected entry point (used by tests so they never touch env/args).
pub fn bridge_call_tool_with(
    policy: &AccessPolicy,
    name: &str,
    arguments: &Value,
) -> BridgeToolResult {
    match name {
        "read_file" => {
            let Some(path) = arg_str(arguments, "path") else {
                return BridgeToolResult::error("Missing required parameter: path");
            };
            let canon = match policy.check(&path) {
                Ok(c) => c,
                Err(e) => return BridgeToolResult::error(e),
            };
            match std::fs::metadata(&canon) {
                Ok(m) if m.is_dir() => {
                    return BridgeToolResult::error(format!("Path is a directory: {path}"));
                }
                Ok(m) if !m.is_file() => {
                    return BridgeToolResult::error("Not a regular file".to_string());
                }
                Err(e) => return BridgeToolResult::error(format!("Cannot access file: {e}")),
                Ok(_) => {}
            }
            let mut file = match std::fs::File::open(&canon) {
                Ok(f) => f,
                Err(e) => return BridgeToolResult::error(format!("Failed to open file: {e}")),
            };
            let cap = policy.max_file_bytes as usize;
            let mut bytes = Vec::new();
            // Read one byte past the cap so `truncated` is exact.
            if let Err(e) = file.by_ref().take(cap as u64 + 1).read_to_end(&mut bytes) {
                return BridgeToolResult::error(format!("Failed to read file: {e}"));
            }
            let truncated = bytes.len() > cap;
            if truncated {
                bytes.truncate(cap);
            }
            let mut text = String::from_utf8_lossy(&bytes).to_string();
            if truncated {
                text.push_str("\n\n[truncated: file exceeds the shared size limit]");
            }
            BridgeToolResult::text(text)
        }
        "list_directory" => {
            let Some(path) = arg_str(arguments, "path") else {
                return BridgeToolResult::error("Missing required parameter: path");
            };
            let canon = match policy.check(&path) {
                Ok(c) => c,
                Err(e) => return BridgeToolResult::error(e),
            };
            let entries = match std::fs::read_dir(&canon) {
                Ok(rd) => rd,
                Err(e) => return BridgeToolResult::error(format!("Failed to read directory: {e}")),
            };
            let mut lines: Vec<String> = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_sensitive_path(&name.to_lowercase()) {
                    continue;
                }
                let is_dir = entry.path().is_dir();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                lines.push(if is_dir {
                    format!("{name}/")
                } else {
                    format!("{name}\t{size} bytes")
                });
            }
            lines.sort_by_key(|l| l.to_lowercase());
            if lines.is_empty() {
                return BridgeToolResult::text("(empty directory)");
            }
            BridgeToolResult::text(lines.join("\n"))
        }
        "search_files" => {
            let (Some(dir), Some(query)) =
                (arg_str(arguments, "directory"), arg_str(arguments, "query"))
            else {
                return BridgeToolResult::error(
                    "Missing required parameters: directory and query",
                );
            };
            let canon = match policy.check(&dir) {
                Ok(c) => c,
                Err(e) => return BridgeToolResult::error(e),
            };
            let q = query.to_lowercase();
            let max_results = 50usize;
            let mut matches: Vec<String> = Vec::new();
            // WalkDir does not follow symlinks by default, so results cannot
            // escape the shared root via a link.
            for entry in walkdir::WalkDir::new(&canon)
                .max_depth(8)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if matches.len() >= max_results {
                    break;
                }
                let path = entry.path();
                let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string())
                else {
                    continue;
                };
                if is_sensitive_path(&name.to_lowercase()) {
                    continue;
                }
                if name.to_lowercase().contains(&q) {
                    matches.push(path.to_string_lossy().to_string());
                }
            }
            if matches.is_empty() {
                return BridgeToolResult::text("No matches.");
            }
            let truncated = matches.len() >= max_results;
            let mut out = matches.join("\n");
            if truncated {
                out.push_str(&format!("\n(showing first {max_results})"));
            }
            BridgeToolResult::text(out)
        }
        "get_file_info" => {
            let Some(path) = arg_str(arguments, "path") else {
                return BridgeToolResult::error("Missing required parameter: path");
            };
            let canon = match policy.check(&path) {
                Ok(c) => c,
                Err(e) => return BridgeToolResult::error(e),
            };
            let Ok(meta) = std::fs::metadata(&canon) else {
                return BridgeToolResult::error("Cannot access path");
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| format_unix_time(d.as_secs()))
                .unwrap_or_else(|| "unknown".to_string());
            BridgeToolResult::text(format!(
                "path: {}\nkind: {}\nsize: {} bytes\nmodified: {}",
                canon.to_string_lossy(),
                if meta.is_dir() { "directory" } else { "file" },
                meta.len(),
                modified
            ))
        }
        // write_file / run_command intentionally absent: they do not exist in
        // this profile, so even a client that asks for them by name gets a
        // clean error instead of any code path reaching the fs layer.
        _ => BridgeToolResult::error(format!("Unknown tool: {name}")),
    }
}

/// Minimal UTC formatter (YYYY-MM-DD HH:MM:SS) — avoids a chrono dependency
/// just for one status line.
fn format_unix_time(secs: u64) -> String {
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days algorithm (Howard Hinnant).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{d:02} {h:02}:{m:02}:{s:02} UTC")
}

// ─── tunnel-client process manager ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// stopped | starting | running | error
    pub state: String,
    pub enabled: bool,
    pub pid: Option<u32>,
    pub health_url: Option<String>,
    /// Result of the last `/readyz` probe (None = not probed yet).
    pub ready: Option<bool>,
    pub restarts: u32,
    pub last_error: Option<String>,
    pub started_at: Option<u64>,
}

struct ManagerInner {
    app: Option<AppHandle>,
    data_dir: PathBuf,
    pid: Option<u32>,
    /// stopped | starting | running | error
    state: String,
    restarts: u32,
    last_error: Option<String>,
    stderr_tail: String,
    health_url: Option<String>,
    ready: Option<bool>,
    started_at: Option<u64>,
    config: BridgeConfig,
}

struct BridgeManager {
    should_run: AtomicBool,
    inner: Mutex<ManagerInner>,
}

static MANAGER: LazyLock<BridgeManager> = LazyLock::new(|| {
    BridgeManager {
        should_run: AtomicBool::new(false),
        inner: Mutex::new(ManagerInner {
            app: None,
            data_dir: PathBuf::from("./data"),
            pid: None,
            state: "stopped".to_string(),
            restarts: 0,
            last_error: None,
            stderr_tail: String::new(),
            health_url: None,
            ready: None,
            started_at: None,
            config: BridgeConfig::default(),
        }),
    }
});

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl BridgeManager {
    fn status(&self) -> BridgeStatus {
        let inner = self.inner.lock().unwrap();
        BridgeStatus {
            state: inner.state.clone(),
            enabled: inner.config.enabled,
            pid: inner.pid,
            health_url: inner.health_url.clone(),
            ready: inner.ready,
            restarts: inner.restarts,
            last_error: inner.last_error.clone(),
            started_at: inner.started_at,
        }
    }

    fn emit_status(&self) {
        let payload = self.status();
        let app = {
            let inner = self.inner.lock().unwrap();
            inner.app.clone()
        };
        if let Some(app) = app {
            let _ = app.emit(STATUS_EVENT, &payload);
        }
    }
}

/// Locate `tunnel-client`: PATH first, then the Homebrew prefixes (the
/// officially supported install route on macOS is
/// `brew install openai/tools/tunnel-client`).
pub fn detect_tunnel_client() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path_var) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path_var).map(|dir| dir.join("tunnel-client")),
        );
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/tunnel-client"));
    candidates.push(PathBuf::from("/usr/local/bin/tunnel-client"));
    candidates.into_iter().find(|c| c.is_file())
}

fn resolve_client_path(config: &BridgeConfig) -> Result<PathBuf, String> {
    if let Some(explicit) = &config.tunnel_client_path {
        let p = PathBuf::from(explicit);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!(
            "tunnel-client not found at configured path: {explicit}"
        ));
    }
    detect_tunnel_client().ok_or_else(|| {
        "tunnel-client not found — run `brew install openai/tools/tunnel-client` first, \
         or set its path in the bridge panel"
            .to_string()
    })
}

/// The command tunnel-client runs to get our stdio MCP server. Paths are
/// quoted because app paths contain spaces (…/Application Support/…).
fn build_mcp_command(wisp_exe: &Path, config_path: &Path) -> String {
    format!(
        "\"{}\" --chatgpt-bridge-mcp --config \"{}\"",
        wisp_exe.display(),
        config_path.display()
    )
}

/// Kill the running child (if any) without touching the public state.
/// Taking the pid out of `inner` first makes the waiter thread stand down
/// instead of treating the kill as a crash to restart.
fn stop_if_running() {
    let pid = {
        let mut inner = MANAGER.inner.lock().unwrap();
        inner.pid.take()
    };
    if let Some(pid) = pid {
        kill_pid(pid);
    }
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    let _ = std::process::Command::new("kill")
        .arg(pid.to_string())
        .status();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status();
}

/// Kill a leftover tunnel-client from a previous session. Only one client
/// may run per tunnel_id, so a stale process would block the new one.
fn kill_stale_instance(data_dir: &Path) {
    let pid_file = data_dir.join(PID_FILE);
    let Ok(raw) = std::fs::read_to_string(&pid_file) else {
        return;
    };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(&pid_file);
        return;
    };
    // Confirm the pid still belongs to tunnel-client before killing.
    #[cfg(unix)]
    let comm_check = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output();
    #[cfg(windows)]
    let comm_check = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}")])
        .output();

    if let Ok(out) = comm_check {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        if text.contains("tunnel-client") {
            info!("[ChatGPTBridge] killing stale tunnel-client pid {pid}");
            kill_pid(pid);
        }
    }
    let _ = std::fs::remove_file(&pid_file);
}

/// Stop the bridge (idempotent). Called on disable, restart and app exit.
pub fn stop_bridge() {
    MANAGER.should_run.store(false, Ordering::SeqCst);
    stop_if_running();
    let data_dir = {
        let inner = MANAGER.inner.lock().unwrap();
        inner.data_dir.clone()
    };
    let _ = std::fs::remove_file(data_dir.join(PID_FILE));
    let _ = std::fs::remove_file(data_dir.join(HEALTH_URL_FILE));
    {
        let mut inner = MANAGER.inner.lock().unwrap();
        inner.state = "stopped".to_string();
        inner.ready = None;
        inner.health_url = None;
        inner.started_at = None;
        inner.restarts = 0;
    }
    MANAGER.emit_status();
    info!("[ChatGPTBridge] stopped");
}

/// Bind the manager to the running app (data dir, config, event emitter).
/// Called once from Tauri setup; safe to call again (idempotent refresh).
pub fn init(app: &AppHandle) {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./data"));
    let mut inner = MANAGER.inner.lock().unwrap();
    inner.app = Some(app.clone());
    inner.data_dir = data_dir.clone();
    inner.config = BridgeConfig::load(&data_dir.join(CONFIG_FILE));
}

/// Start (or restart) tunnel-client with the current config.
pub fn start_bridge() -> Result<(), String> {
    let (config, data_dir) = {
        let inner = MANAGER.inner.lock().unwrap();
        (inner.config.clone(), inner.data_dir.clone())
    };

    if !config.enabled {
        return Err("Bridge is disabled".to_string());
    }
    if config.tunnel_id.trim().is_empty() {
        return Err("Missing tunnel ID — create one on platform.openai.com".to_string());
    }
    if config.allowed_roots.is_empty() {
        return Err("No shared directories configured".to_string());
    }
    let api_key = secure_credentials::get_secret(API_KEYCHAIN_KEY)
        .ok()
        .flatten()
        .ok_or("Missing runtime API key — paste it in the bridge panel first")?;
    let client_path = resolve_client_path(&config)?;
    let wisp_exe =
        std::env::current_exe().map_err(|e| format!("Cannot resolve wisp binary: {e}"))?;
    let config_path = data_dir.join(CONFIG_FILE);
    let mcp_command = build_mcp_command(&wisp_exe, &config_path);

    // Only one tunnel-client may run per tunnel_id.
    stop_if_running();
    kill_stale_instance(&data_dir);

    let health_url_file = data_dir.join(HEALTH_URL_FILE);
    let _ = std::fs::remove_file(&health_url_file);

    let mut command = std::process::Command::new(&client_path);
    command
        .args([
            "run",
            "--control-plane.tunnel-id",
            config.tunnel_id.trim(),
            "--mcp-command",
            &mcp_command,
            "--health.listen-addr",
            "127.0.0.1:0",
            "--health.url-file",
        ])
        .arg(&health_url_file)
        .env("CONTROL_PLANE_API_KEY", &api_key)
        .env("CONTROL_PLANE_TUNNEL_ID", config.tunnel_id.trim())
        .env("WISP_BRIDGE_CONFIG", &config_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start tunnel-client ({}): {e}", client_path.display()))?;

    let pid = child.id();
    let _ = std::fs::write(data_dir.join(PID_FILE), pid.to_string());

    MANAGER.should_run.store(true, Ordering::SeqCst);
    {
        let mut inner = MANAGER.inner.lock().unwrap();
        inner.pid = Some(pid);
        inner.state = "starting".to_string();
        inner.last_error = None;
        inner.stderr_tail.clear();
        inner.health_url = None;
        inner.ready = None;
        inner.started_at = Some(now_ms());
    }
    MANAGER.emit_status();
    info!("[ChatGPTBridge] tunnel-client started (pid {pid})");

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stderr);
            let mut buf = [0u8; 2048];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        let mut inner = MANAGER.inner.lock().unwrap();
                        inner.stderr_tail.push_str(&chunk);
                        let len = inner.stderr_tail.len();
                        if len > MAX_STDERR_TAIL {
                            inner.stderr_tail = inner.stderr_tail[len - MAX_STDERR_TAIL..].to_string();
                        }
                    }
                }
            }
        });
    }

    let started_at = now_ms();
    std::thread::spawn(move || {
        // Wait for exit; restart with backoff while enabled and unstable.
        loop {
            let status = match child.wait() {
                Ok(s) => s,
                Err(_) => return,
            };
            let should_run = MANAGER.should_run.load(Ordering::SeqCst);
            let was_ours = {
                let inner = MANAGER.inner.lock().unwrap();
                inner.pid == Some(pid)
            };
            if !should_run || !was_ours {
                // stop_bridge() / stop_if_running() reaped us — final state
                // is set there; do not restart.
                return;
            }
            let uptime = now_ms().saturating_sub(started_at) / 1000;
            let stderr = {
                let inner = MANAGER.inner.lock().unwrap();
                inner.stderr_tail.clone()
            };
            warn!(
                "[ChatGPTBridge] tunnel-client exited ({status}); uptime {uptime}s"
            );
            let restarts = {
                let inner = MANAGER.inner.lock().unwrap();
                inner.restarts
            };
            if restarts >= RESTART_BACKOFF_SECS.len() as u32 {
                let mut inner = MANAGER.inner.lock().unwrap();
                inner.pid = None;
                inner.state = "error".to_string();
                inner.last_error = Some(if stderr.is_empty() {
                    format!("tunnel-client exited: {status} (gave up after {restarts} restarts)")
                } else {
                    format!("gave up after {restarts} restarts — last output:\n{stderr}")
                });
                drop(inner);
                MANAGER.emit_status();
                return;
            }
            let backoff = if uptime >= STABLE_UPTIME_SECS {
                // It ran stably; treat this as a fresh crash.
                MANAGER.inner.lock().unwrap().restarts = 0;
                RESTART_BACKOFF_SECS[0]
            } else {
                let delay = RESTART_BACKOFF_SECS[restarts as usize];
                MANAGER.inner.lock().unwrap().restarts = restarts + 1;
                delay
            };
            {
                let mut inner = MANAGER.inner.lock().unwrap();
                inner.state = "starting".to_string();
                inner.last_error = Some(format!(
                    "tunnel-client exited ({status}); restarting in {backoff}s…"
                ));
            }
            MANAGER.emit_status();
            std::thread::sleep(Duration::from_secs(backoff));
            if !MANAGER.should_run.load(Ordering::SeqCst) {
                return;
            }
            match start_bridge() {
                Ok(()) => return, // the new child owns its own waiter thread
                Err(e) => {
                    let mut inner = MANAGER.inner.lock().unwrap();
                    inner.state = "error".to_string();
                    inner.last_error = Some(e);
                    drop(inner);
                    MANAGER.emit_status();
                    return;
                }
            }
        }
    });

    // Health poller: read the url file once tunnel-client writes it, then
    // probe /readyz until the bridge stops.
    std::thread::spawn(move || loop {
        if !MANAGER.should_run.load(Ordering::SeqCst) {
            return;
        }
        let url = std::fs::read_to_string(&health_url_file)
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty());
        if let Some(url) = url {
            let ready = probe_ready(&url);
            let mut inner = MANAGER.inner.lock().unwrap();
            let changed =
                inner.health_url.as_deref() != Some(url.as_str()) || inner.ready != ready;
            inner.health_url = Some(url);
            inner.ready = ready;
            if ready == Some(true) && inner.state == "starting" {
                inner.state = "running".to_string();
            }
            if changed {
                drop(inner);
                MANAGER.emit_status();
            }
        }
        std::thread::sleep(Duration::from_secs(3));
    });

    Ok(())
}

fn probe_ready(base_url: &str) -> Option<bool> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    match client.get(format!("{base_url}/readyz")).send() {
        Ok(resp) => Some(resp.status().is_success()),
        Err(_) => Some(false),
    }
}

/// Auto-start on app launch when the config says so (called from setup).
pub fn auto_start(app: &AppHandle) {
    init(app);
    let enabled = {
        let inner = MANAGER.inner.lock().unwrap();
        inner.config.enabled
    };
    if enabled {
        if let Err(e) = start_bridge() {
            warn!("[ChatGPTBridge] auto-start failed: {e}");
            let mut inner = MANAGER.inner.lock().unwrap();
            inner.state = "error".to_string();
            inner.last_error = Some(e);
            drop(inner);
            MANAGER.emit_status();
        }
    }
}

/// Kill the child when the app really quits (RunEvent::Exit).
pub fn shutdown() {
    stop_bridge();
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStateResponse {
    pub config: BridgeConfig,
    pub status: BridgeStatus,
    pub detected_client_path: Option<String>,
    pub has_api_key: bool,
    pub config_path: String,
    pub wisp_exe: String,
}

fn state_response() -> BridgeStateResponse {
    let (config, data_dir) = {
        let inner = MANAGER.inner.lock().unwrap();
        (inner.config.clone(), inner.data_dir.clone())
    };
    BridgeStateResponse {
        config,
        status: MANAGER.status(),
        detected_client_path: detect_tunnel_client().map(|p| p.display().to_string()),
        has_api_key: secure_credentials::get_secret(API_KEYCHAIN_KEY)
            .ok()
            .flatten()
            .is_some(),
        config_path: data_dir.join(CONFIG_FILE).display().to_string(),
        wisp_exe: std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

#[command]
pub async fn chatgpt_bridge_get_state() -> Result<BridgeStateResponse, String> {
    Ok(state_response())
}

#[command]
pub async fn chatgpt_bridge_get_status() -> Result<BridgeStatus, String> {
    Ok(MANAGER.status())
}

#[command]
pub async fn chatgpt_bridge_save_config(
    config: BridgeConfig,
) -> Result<BridgeStateResponse, String> {
    {
        let mut inner = MANAGER.inner.lock().unwrap();
        inner.config = config.clone();
    }
    config
        .save(&MANAGER.inner.lock().unwrap().data_dir.join(CONFIG_FILE))
        .map_err(|e| format!("Failed to save config: {e}"))?;

    if config.enabled {
        if let Err(e) = start_bridge() {
            // Config stays saved; surface the failure as bridge state.
            let mut inner = MANAGER.inner.lock().unwrap();
            inner.state = "error".to_string();
            inner.last_error = Some(e.clone());
            drop(inner);
            MANAGER.emit_status();
            return Err(e);
        }
    } else {
        stop_bridge();
    }
    Ok(state_response())
}

#[command]
pub async fn chatgpt_bridge_set_api_key(api_key: String) -> Result<(), String> {
    secure_credentials::store_secret(API_KEYCHAIN_KEY, api_key.trim())
        .map_err(|e| format!("Failed to store API key: {e}"))
}

#[command]
pub async fn chatgpt_bridge_delete_api_key() -> Result<(), String> {
    secure_credentials::delete_secret(API_KEYCHAIN_KEY)
        .map_err(|e| format!("Failed to delete API key: {e}"))
}

#[command]
pub async fn chatgpt_bridge_restart() -> Result<BridgeStatus, String> {
    let enabled = {
        let inner = MANAGER.inner.lock().unwrap();
        inner.config.enabled
    };
    if !enabled {
        return Err("Bridge is disabled".to_string());
    }
    stop_bridge();
    start_bridge()?;
    Ok(MANAGER.status())
}

#[command]
pub async fn chatgpt_bridge_stop() -> Result<BridgeStatus, String> {
    stop_bridge();
    Ok(MANAGER.status())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wisp-bridge-test-{tag}-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn policy_for(root: &Path, max_file_bytes: u64) -> AccessPolicy {
        // Mirror from_config: canonicalize so /var → /private/var symlinks
        // on macOS don't break containment checks.
        AccessPolicy {
            roots: vec![std::fs::canonicalize(root).unwrap()],
            max_file_bytes,
        }
    }

    #[test]
    fn policy_allows_inside_root_and_denies_outside() {
        let root = temp_root("allow");
        let file = root.join("notes.txt");
        std::fs::write(&file, "hello").unwrap();
        let policy = policy_for(&root, 1024);
        assert!(policy.check(file.to_str().unwrap()).is_ok());
        assert!(policy.check("/etc/hosts").is_err());
    }

    #[test]
    fn policy_denies_traversal_escape() {
        let root = temp_root("traversal");
        std::fs::write(root.join("a.txt"), "a").unwrap();
        let sneaky = format!("{}/../../../../etc/hosts", root.display());
        let policy = policy_for(&root, 1024);
        assert!(policy.check(&sneaky).is_err());
    }

    #[test]
    fn policy_denies_sensitive_paths_inside_root() {
        let root = temp_root("sensitive");
        let ssh_dir = root.join(".ssh");
        std::fs::create_dir_all(&ssh_dir).unwrap();
        std::fs::write(ssh_dir.join("id_rsa"), "PRIVATE").unwrap();
        std::fs::write(root.join(".env"), "SECRET=1").unwrap();
        std::fs::write(root.join("cert.pem"), "x").unwrap();
        std::fs::write(root.join("readme.md"), "fine").unwrap();
        let policy = policy_for(&root, 1024);
        assert!(policy.check(ssh_dir.join("id_rsa").to_str().unwrap()).is_err());
        assert!(policy.check(root.join(".env").to_str().unwrap()).is_err());
        // whole .ssh dir is denied, not just key files
        assert!(policy
            .check(ssh_dir.join("known_hosts").to_str().unwrap())
            .is_err());
        assert!(policy.check(root.join("cert.pem").to_str().unwrap()).is_err());
        assert!(policy.check(root.join("readme.md").to_str().unwrap()).is_ok());
    }

    #[test]
    fn policy_denies_symlink_escape() {
        let root = temp_root("symlink");
        let outside = temp_root("symlink-outside");
        std::fs::write(outside.join("secret.txt"), "s").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let policy = policy_for(&root, 1024);
        #[cfg(unix)]
        {
            // Canonicalizing the link resolves outside the root → denied.
            assert!(policy
                .check(root.join("link/secret.txt").to_str().unwrap())
                .is_err());
        }
    }

    #[test]
    fn sensitive_name_table() {
        assert!(is_sensitive_path("/users/x/proj/.ssh/config"));
        assert!(is_sensitive_path("/users/x/proj/.env.production"));
        assert!(is_sensitive_path("/users/x/proj/.env"));
        assert!(is_sensitive_path("/users/x/proj/server.pem"));
        assert!(is_sensitive_path("/users/x/proj/id_ed25519.pub"));
        assert!(is_sensitive_path("/users/x/proj/credentials.json"));
        assert!(!is_sensitive_path("/users/x/proj/readme.md"));
        assert!(!is_sensitive_path("/users/x/proj/env.d.ts")); // no leading dot
        assert!(!is_sensitive_path("/users/x/proj/monkeypedia.md")); // suffix must match the file name
    }

    #[test]
    fn tool_catalogue_is_read_only() {
        let tools = bridge_list_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            ["read_file", "list_directory", "search_files", "get_file_info"]
        );
        assert!(!names.contains(&"write_file"));
        assert!(!names.contains(&"run_command"));
    }

    #[test]
    fn read_file_respects_size_cap() {
        let root = temp_root("cap");
        let big = root.join("big.txt");
        std::fs::write(&big, "x".repeat(3000)).unwrap();
        let policy = policy_for(&root, 1024);
        let result = bridge_call_tool_with(
            &policy,
            "read_file",
            &json!({ "path": big.display().to_string() }),
        );
        assert!(!result.is_error);
        let text = result.content[0]["text"].as_str().unwrap();
        assert!(text.contains("[truncated"));
        assert!(text.len() < 3000);
    }

    #[test]
    fn list_directory_filters_sensitive_entries() {
        let root = temp_root("listdir");
        std::fs::write(root.join("ok.txt"), "1").unwrap();
        std::fs::write(root.join(".env"), "s").unwrap();
        let policy = policy_for(&root, 1024);
        let result = bridge_call_tool_with(
            &policy,
            "list_directory",
            &json!({ "path": root.display().to_string() }),
        );
        assert!(!result.is_error);
        let text = result.content[0]["text"].as_str().unwrap();
        assert!(text.contains("ok.txt"));
        assert!(!text.contains(".env"));
    }

    #[test]
    fn search_finds_and_stays_in_root() {
        let root = temp_root("search");
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("report-q3.md"), "1").unwrap();
        std::fs::write(root.join("other.txt"), "2").unwrap();
        let policy = policy_for(&root, 1024);
        let result = bridge_call_tool_with(
            &policy,
            "search_files",
            &json!({ "directory": root.display().to_string(), "query": "Q3" }),
        );
        assert!(!result.is_error);
        let text = result.content[0]["text"].as_str().unwrap();
        assert!(text.contains("report-q3.md"));
        // searching from outside the whitelist is rejected
        let denied = bridge_call_tool_with(
            &policy,
            "search_files",
            &json!({ "directory": "/etc", "query": "hosts" }),
        );
        assert!(denied.is_error);
    }

    #[test]
    fn write_tool_is_absent_not_stubbed() {
        let result = bridge_call_tool_with(
            &AccessPolicy { roots: vec![], max_file_bytes: 1 },
            "write_file",
            &json!({ "path": "/tmp/wisp-bridge-should-not-exist.txt", "content": "x" }),
        );
        assert!(result.is_error);
        assert!(!Path::new("/tmp/wisp-bridge-should-not-exist.txt").exists());
    }

    #[test]
    fn config_roundtrip() {
        let dir = temp_root("config");
        let path = dir.join("bridge.json");
        let cfg = BridgeConfig {
            version: 1,
            enabled: true,
            tunnel_id: "tunnel_test".to_string(),
            tunnel_client_path: Some("/usr/local/bin/tunnel-client".to_string()),
            allowed_roots: vec!["/Users/tc/git".to_string()],
            max_file_bytes: 2048,
        };
        cfg.save(&path).unwrap();
        let loaded = BridgeConfig::load(&path);
        assert_eq!(loaded.tunnel_id, "tunnel_test");
        assert_eq!(loaded.allowed_roots, vec!["/Users/tc/git".to_string()]);
        assert_eq!(loaded.max_file_bytes, 2048);
        assert!(loaded.enabled);
    }

    #[test]
    fn config_defaults_on_missing_file() {
        let cfg = BridgeConfig::load(Path::new("/nonexistent/wisp-bridge-cfg.json"));
        assert!(!cfg.enabled);
        assert!(cfg.allowed_roots.is_empty());
        assert_eq!(cfg.max_file_bytes, 512 * 1024);
    }

    #[test]
    fn mcp_command_quotes_paths() {
        let cmd = build_mcp_command(
            Path::new("/Applications/Wisp.app/Contents/MacOS/wisp"),
            Path::new(
                "/Users/tc/Library/Application Support/com.wisp.app/chatgpt-bridge.json",
            ),
        );
        assert!(cmd.starts_with('"'));
        assert!(cmd.contains("--chatgpt-bridge-mcp"));
        assert_eq!(cmd.matches('"').count(), 4);
    }

    #[test]
    fn format_time_shape() {
        let s = format_unix_time(1_760_000_000);
        assert_eq!(s.len(), "YYYY-MM-DD HH:MM:SS UTC".len());
        assert!(s.ends_with("UTC"));
    }
}
