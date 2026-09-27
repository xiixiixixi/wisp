// pi_bridge — Tauri commands for the pi agent engine (pi-agent-core running
// in the WebView). The LLM loop lives in the frontend; Rust keeps the three
// roles that must not leave the backend: tool execution (with the approval
// backstop and path sandbox), the AGENTS.md context chain, and session
// persistence as pi-format JSONL keyed by folder anchor.
//
// Storage layout (data_local_dir()/wisp):
//   agent/sessions/index.json                 — session metadata index
//   agent/sessions/by-folder/manifest.json    — path-hash ↔ real path
//   agent/sessions/by-folder/<hash>/<id>.jsonl
//   agent/sessions/global/<id>.jsonl

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::command;

use crate::agent::{self, emit_event, AgentEvent, AgentToolCall};
use crate::utils::{now_ms, now_secs};

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution bridge
// ─────────────────────────────────────────────────────────────────────────────

/// Execute one agent tool on behalf of the frontend pi engine.
///
/// SECURITY: write tools (see `tools::tool_requires_approval`) refuse to run
/// unless `approved` is true. The frontend is expected to gate those through
/// its approval UI (pi `beforeToolCall`) before invoking this command; this
/// flag is the backend backstop that makes the gate enforceable regardless of
/// what the frontend does. Path sandboxing happens inside `tool_executor`.
#[command]
pub async fn agent_execute_tool(
    session_id: String,
    tool_name: String,
    tool_input: Value,
    approved: bool,
    app_handle: tauri::AppHandle,
) -> Result<AgentToolCall, String> {
    let requires_approval = crate::agent::tools::tool_requires_approval(&tool_name);
    let tool_id = format!("pi_{}", now_ms());

    let pending = AgentToolCall {
        id: tool_id.clone(),
        name: tool_name.clone(),
        input: tool_input.clone(),
        requires_approval,
        status: "running".to_string(),
        result: None,
        error: None,
    };
    emit_event(
        &app_handle,
        &AgentEvent {
            event_type: "tool_call".to_string(),
            session_id: session_id.clone(),
            tool_call: Some(pending),
            text: None,
            plan: None,
            timestamp: now_ms(),
        },
    );

    let (_result_json, tool_call) = agent::run_tool_for_pi(
        &tool_id,
        &session_id,
        &tool_name,
        &tool_input,
        approved,
        &app_handle,
    );

    // The backend event stream carries the structured tool_result so the
    // existing session-event UI keeps rendering tool cards unchanged; the
    // return value drives the pi tool result the model sees.
    emit_event(
        &app_handle,
        &AgentEvent {
            event_type: "tool_result".to_string(),
            session_id: session_id.clone(),
            tool_call: Some(tool_call.clone()),
            text: None,
            plan: None,
            timestamp: now_ms(),
        },
    );

    Ok(tool_call)
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENTS.md context chain
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_FILE_NAMES: &[&str] = &["AGENTS.md", "CLAUDE.md"];
const GLOBAL_CONTEXT_DIR: &str = ".wisp";
/// Per-file read cap — context files are instructions, not payloads.
const MAX_CONTEXT_FILE_BYTES: u64 = 32 * 1024;
/// Cap on directory levels walked upward from the anchor.
const MAX_CHAIN_DEPTH: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextFile {
    /// Absolute path of the file, or "global" for ~/.wisp/AGENTS.md.
    pub source: String,
    pub content: String,
}

/// Collect the AGENTS.md chain for a session anchor: the global file
/// (~/.wisp/AGENTS.md), then one file per directory from the home dir down to
/// the anchor (AGENTS.md wins over CLAUDE.md in the same directory).
/// Files inside the user's home only; symlinks are skipped.
#[command]
pub async fn agent_load_context_chain(anchor: Option<String>) -> Result<Vec<ContextFile>, String> {
    let home = dirs::home_dir().ok_or("home directory unavailable")?;
    let mut files = Vec::new();

    let global = home.join(GLOBAL_CONTEXT_DIR).join("AGENTS.md");
    if let Some(content) = read_context_file(&global) {
        files.push(ContextFile {
            source: "global".to_string(),
            content,
        });
    }

    if let Some(anchor) = anchor.as_deref().map(Path::new) {
        let canonical = anchor
            .canonicalize()
            .map_err(|e| format!("anchor not accessible: {}: {}", anchor.display(), e))?;
        if canonical.starts_with(&home) {
            files.extend(collect_chain_files(&canonical, &home));
        }
        // Outside home: only the global file applies.
    }

    Ok(files)
}

/// Walk from `anchor` up to (and including) directories under `home`,
/// collecting context files root-first. Pure function — unit-testable.
fn collect_chain_files(anchor: &Path, home: &Path) -> Vec<ContextFile> {
    let mut chain: Vec<(PathBuf, String)> = Vec::new();
    let mut dir = Some(anchor.to_path_buf());
    let mut depth = 0usize;
    while let Some(d) = dir {
        if depth >= MAX_CHAIN_DEPTH || !d.starts_with(home) {
            break;
        }
        for name in CONTEXT_FILE_NAMES {
            let candidate = d.join(name);
            if let Some(content) = read_context_file(&candidate) {
                chain.push((candidate, content));
                break; // AGENTS.md wins over CLAUDE.md per directory
            }
        }
        dir = d.parent().map(Path::to_path_buf);
        depth += 1;
    }
    // Root-first order so deeper files read as refinements.
    chain.reverse();
    chain
        .into_iter()
        .map(|(path, content)| ContextFile {
            source: path.to_string_lossy().to_string(),
            content,
        })
        .collect()
}

fn read_context_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_CONTEXT_FILE_BYTES {
        return None;
    }
    // Symlinked instruction files are an injection vector; only real files.
    if std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(true)
    {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

// ─────────────────────────────────────────────────────────────────────────────
// Session store (pi-format JSONL)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    /// None = global (速聊); Some(path) = folder-anchored session.
    #[serde(default)]
    pub anchor: Option<String>,
    pub model: String,
    /// "chat" | "quick_action" | … — quick-action conversions fork with this.
    #[serde(default)]
    pub origin: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub message_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct SessionIndex {
    sessions: Vec<SessionMeta>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct FolderManifest {
    /// path-hash → real absolute path
    entries: HashMap<String, String>,
}

pub struct SessionStore {
    root: PathBuf,
}

impl SessionStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn sessions_root(&self) -> PathBuf {
        self.root.join("agent").join("sessions")
    }

    fn index_path(&self) -> PathBuf {
        self.sessions_root().join("index.json")
    }

    fn manifest_path(&self) -> PathBuf {
        self.sessions_root().join("by-folder").join("manifest.json")
    }

    fn session_path(&self, meta: &SessionMeta) -> PathBuf {
        match &meta.anchor {
            Some(anchor) => self
                .sessions_root()
                .join("by-folder")
                .join(hash_path(anchor))
                .join(format!("{}.jsonl", meta.id)),
            None => self.sessions_root().join("global").join(format!("{}.jsonl", meta.id)),
        }
    }

    fn load_index(&self) -> SessionIndex {
        read_json(&self.index_path()).unwrap_or_default()
    }

    fn save_index(&self, index: &SessionIndex) -> Result<(), String> {
        let path = self.index_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_json_atomic(&path, index)
    }

    fn load_manifest(&self) -> FolderManifest {
        read_json(&self.manifest_path()).unwrap_or_default()
    }

    fn save_manifest(&self, manifest: &FolderManifest) -> Result<(), String> {
        let path = self.manifest_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_json_atomic(&path, manifest)
    }

    fn new_session_id(&self) -> String {
        use rand::Rng;
        let suffix: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(6)
            .map(char::from)
            .collect();
        format!("s-{}-{}", now_secs(), suffix.to_lowercase())
    }

    pub fn create(
        &self,
        anchor: Option<String>,
        title: Option<String>,
        model: String,
        origin: Option<String>,
    ) -> Result<SessionMeta, String> {
        let meta = SessionMeta {
            id: self.new_session_id(),
            title: title.unwrap_or_else(|| "新对话".to_string()),
            anchor: anchor
                .map(|a| Path::new(&a).to_string_lossy().to_string()),
            model,
            origin,
            created_at: now_secs(),
            updated_at: now_secs(),
            message_count: 0,
        };
        let file = self.session_path(&meta);
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&file, "").map_err(|e| e.to_string())?;

        if let Some(anchor) = &meta.anchor {
            let mut manifest = self.load_manifest();
            manifest
                .entries
                .insert(hash_path(anchor), anchor.clone());
            self.save_manifest(&manifest)?;
        }

        let mut index = self.load_index();
        index.sessions.insert(0, meta.clone());
        self.save_index(&index)?;
        Ok(meta)
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        self.load_index().sessions
    }

    pub fn find(&self, id: &str) -> Result<SessionMeta, String> {
        self.load_index()
            .sessions
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("session not found: {}", id))
    }

    /// Read the JSONL transcript as a Vec of parsed messages.
    pub fn read(&self, id: &str) -> Result<Vec<Value>, String> {
        let meta = self.find(id)?;
        let content = std::fs::read_to_string(self.session_path(&meta))
            .map_err(|e| format!("failed to read session: {}", e))?;
        content
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|line| {
                serde_json::from_str(line)
                    .map_err(|e| format!("corrupt session line in {}: {}", id, e))
            })
            .collect()
    }

    /// Append one message (a single JSON value) to the transcript.
    pub fn append(&self, id: &str, message: &Value) -> Result<SessionMeta, String> {
        let mut meta = self.find(id)?;
        let path = self.session_path(&meta);
        let mut line = serde_json::to_string(message).map_err(|e| e.to_string())?;
        line.push('\n');
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()))
            .map_err(|e| format!("failed to append: {}", e))?;

        meta.message_count = meta.message_count.saturating_add(1);
        meta.updated_at = now_secs();
        let mut index = self.load_index();
        if let Some(slot) = index.sessions.iter_mut().find(|s| s.id == id) {
            *slot = meta.clone();
        }
        // keep most-recent first
        index.sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.save_index(&index)?;
        Ok(meta)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut index = self.load_index();
        let meta = index
            .sessions
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| format!("session not found: {}", id))?;
        index.sessions.retain(|s| s.id != id);
        let _ = std::fs::remove_file(self.session_path(&meta));
        self.save_index(&index)
    }

    pub fn rename(&self, id: &str, title: String) -> Result<SessionMeta, String> {
        let mut index = self.load_index();
        let slot = index
            .sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("session not found: {}", id))?;
        slot.title = title;
        slot.updated_at = now_secs();
        let meta = slot.clone();
        self.save_index(&index)?;
        Ok(meta)
    }

    /// Fork an existing transcript into a new session (快捷功能 → 转为对话).
    pub fn fork(
        &self,
        id: &str,
        title: Option<String>,
        anchor: Option<String>,
        origin: Option<String>,
    ) -> Result<SessionMeta, String> {
        let source = self.find(id)?;
        let messages = self.read(id)?;
        let created = self.create(
            anchor.or(source.anchor),
            title,
            source.model.clone(),
            origin.or_else(|| Some("fork".to_string())),
        )?;
        for message in &messages {
            self.append(&created.id, message)?;
        }
        Ok(created)
    }

    /// Re-link sessions after a folder was renamed or moved.
    pub fn relink(&self, old_path: &str, new_path: &str) -> Result<usize, String> {
        let old_hash = hash_path(old_path);
        let new_hash = hash_path(new_path);
        let mut manifest = self.load_manifest();
        if !manifest.entries.contains_key(&old_hash) {
            return Ok(0);
        }
        manifest
            .entries
            .insert(old_hash.clone(), new_path.to_string());
        manifest.entries.insert(new_hash.clone(), new_path.to_string());

        let old_dir = self.sessions_root().join("by-folder").join(&old_hash);
        let new_dir = self.sessions_root().join("by-folder").join(&new_hash);
        if old_dir != new_dir && old_dir.exists() {
            std::fs::rename(&old_dir, &new_dir).map_err(|e| e.to_string())?;
        }
        self.save_manifest(&manifest)?;

        let mut index = self.load_index();
        let mut count = 0usize;
        for session in index.sessions.iter_mut() {
            if session.anchor.as_deref() == Some(old_path) {
                session.anchor = Some(new_path.to_string());
                count += 1;
            }
        }
        self.save_index(&index)?;
        Ok(count)
    }
}

fn hash_path(path: &str) -> String {
    let digest = Sha256::digest(path.as_bytes());
    digest.iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

fn default_store() -> SessionStore {
    let root = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("wisp");
    SessionStore::new(root)
}

// ── Command wrappers ─────────────────────────────────────────────────────────

#[command]
pub async fn pi_session_create(
    anchor: Option<String>,
    title: Option<String>,
    model: String,
    origin: Option<String>,
) -> Result<SessionMeta, String> {
    default_store().create(anchor, title, model, origin)
}

#[command]
pub async fn pi_session_list() -> Result<Vec<SessionMeta>, String> {
    Ok(default_store().list())
}

#[command]
pub async fn pi_session_read(id: String) -> Result<Vec<Value>, String> {
    default_store().read(&id)
}

#[command]
pub async fn pi_session_append(id: String, message: Value) -> Result<SessionMeta, String> {
    default_store().append(&id, &message)
}

#[command]
pub async fn pi_session_delete(id: String) -> Result<(), String> {
    default_store().delete(&id)
}

#[command]
pub async fn pi_session_rename(id: String, title: String) -> Result<SessionMeta, String> {
    default_store().rename(&id, title)
}

#[command]
pub async fn pi_session_fork(
    id: String,
    title: Option<String>,
    anchor: Option<String>,
    origin: Option<String>,
) -> Result<SessionMeta, String> {
    default_store().fork(&id, title, anchor, origin)
}

#[command]
pub async fn pi_session_relink(old_path: String, new_path: String) -> Result<usize, String> {
    default_store().relink(&old_path, &new_path)
}

// ─────────────────────────────────────────────────────────────────────────────
// pi-format model configuration (~/.pi/agent/models.json + auth.json)
//
// Wisp follows pi's own configuration form: providers and models are declared
// in models.json, credentials live in auth.json ({"provider": {"type":
// "api_key", "key": ...}} with 0600 permissions, taking priority over env
// vars). The same files the pi CLI reads — Wisp is a visual editor on top.
// ─────────────────────────────────────────────────────────────────────────────

/// Marker that replaces a literal apiKey in models.json when it is handed to
/// the frontend, so keys are never echoed back for display. On write, marker
/// values are restored from the copy on disk.
pub const API_KEY_KEEP_MARKER: &str = "$WISP_KEEP_KEY$";

#[derive(Debug, Clone, Serialize)]
pub struct AuthProviderStatus {
    pub provider: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PiConfigState {
    pub models_path: String,
    pub auth_path: String,
    /// models.json with every `apiKey` string replaced by the keep-marker.
    pub models_json: Value,
    pub auth_status: Vec<AuthProviderStatus>,
}

pub struct PiConfigStore {
    dir: PathBuf,
}

impl PiConfigStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn models_path(&self) -> PathBuf {
        self.dir.join("models.json")
    }

    fn auth_path(&self) -> PathBuf {
        self.dir.join("auth.json")
    }

    fn read_models_raw(&self) -> Result<Value, String> {
        match std::fs::read_to_string(self.models_path()) {
            Ok(text) if text.trim().is_empty() => Ok(json!({ "providers": {} })),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| format!("models.json 解析失败: {}", e)),
            Err(_) => Ok(json!({ "providers": {} })),
        }
    }

    fn write_models_raw(&self, value: &Value) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
        std::fs::write(self.models_path(), text).map_err(|e| e.to_string())
    }

    fn read_auth_raw(&self) -> Value {
        std::fs::read_to_string(self.auth_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_else(|| json!({}))
    }

    fn write_auth_raw(&self, value: &Value) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
        let path = self.auth_path();
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        // pi convention: credentials are 0600.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    /// All api_key credentials as provider → key.
    /// auth.json is authoritative; models.json literal `apiKey` fields are
    /// equally valid pi credentials (the settings editor writes them there),
    /// so they resolve too — masked markers are never credentials.
    pub fn auth_keys(&self) -> std::collections::HashMap<String, String> {
        let mut out = std::collections::HashMap::new();
        if let Some(map) = self.read_auth_raw().as_object() {
            for (provider, cred) in map {
                if cred["type"] == "api_key" {
                    if let Some(key) = cred["key"].as_str() {
                        if !key.is_empty() {
                            out.insert(provider.clone(), key.to_string());
                        }
                    }
                }
            }
        }
        if let Ok(raw) = self.read_models_raw() {
            if let Some(providers) = raw["providers"].as_object() {
                for (id, cfg) in providers {
                    if let Some(key) = cfg["apiKey"].as_str() {
                        if !key.is_empty() && key != API_KEY_KEEP_MARKER {
                            out.entry(id.clone()).or_insert_with(|| key.to_string());
                        }
                    }
                }
            }
        }
        out
    }

    pub fn state(&self) -> Result<PiConfigState, String> {
        let raw = self.read_models_raw()?;
        let mut masked = raw.clone();
        mask_api_keys(&mut masked);

        let keys = self.auth_keys();
        let mut providers: Vec<String> = keys.keys().cloned().collect();
        if let Some(map) = raw["providers"].as_object() {
            for id in map.keys() {
                if !providers.contains(id) {
                    providers.push(id.clone());
                }
            }
        }
        providers.sort();
        let auth_status = providers
            .into_iter()
            .map(|provider| AuthProviderStatus {
                has_key: keys.contains_key(&provider),
                provider,
            })
            .collect();

        Ok(PiConfigState {
            models_path: self.models_path().to_string_lossy().to_string(),
            auth_path: self.auth_path().to_string_lossy().to_string(),
            models_json: masked,
            auth_status,
        })
    }

    pub fn write_models(&self, incoming: Value) -> Result<(), String> {
        let mut merged = incoming;
        // Restore marker'd apiKeys from the on-disk copy.
        let disk = self.read_models_raw()?;
        if let (Some(dst), Some(src)) = (merged["providers"].as_object_mut(), disk["providers"].as_object()) {
            let src = src.clone();
            for (id, provider) in dst.iter_mut() {
                if let Some(disk_provider) = src.get(id) {
                    restore_masked_keys(provider, disk_provider);
                }
            }
        }
        if !merged.is_object() || merged.get("providers").is_none() {
            return Err("models.json 必须是 {\"providers\": {...}} 结构".to_string());
        }
        self.write_models_raw(&merged)
    }

    pub fn set_auth_key(&self, provider: &str, api_key: &str) -> Result<(), String> {
        let provider = provider.trim().to_lowercase();
        if provider.is_empty() || !provider.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(format!("非法 provider id: '{}'", provider));
        }
        if api_key.trim().is_empty() {
            return self.remove_auth_key(&provider);
        }
        let mut auth = self.read_auth_raw();
        if !auth.is_object() {
            auth = json!({});
        }
        auth[&provider] = json!({ "type": "api_key", "key": api_key.trim() });
        self.write_auth_raw(&auth)
    }

    pub fn remove_auth_key(&self, provider: &str) -> Result<(), String> {
        let mut auth = self.read_auth_raw();
        if let Some(map) = auth.as_object_mut() {
            map.remove(provider);
        }
        self.write_auth_raw(&auth)
    }
}

fn mask_api_keys(value: &mut Value) {
    if let Some(map) = value.as_object_mut() {
        for (k, v) in map.iter_mut() {
            if k == "apiKey" && v.is_string() && v.as_str() != Some(API_KEY_KEEP_MARKER) {
                *v = json!(API_KEY_KEEP_MARKER);
            } else {
                mask_api_keys(v);
            }
        }
    } else if let Some(list) = value.as_array_mut() {
        for v in list.iter_mut() {
            mask_api_keys(v);
        }
    }
}

fn restore_masked_keys(dst: &mut Value, src: &Value) {
    if let (Some(dst_map), Some(src_map)) = (dst.as_object_mut(), src.as_object()) {
        for (k, v) in dst_map.iter_mut() {
            if k == "apiKey" && v.as_str() == Some(API_KEY_KEEP_MARKER) {
                if let Some(disk_key) = src_map.get("apiKey").and_then(|s| s.as_str()) {
                    *v = json!(disk_key);
                }
            } else if let Some(src_child) = src_map.get(k) {
                restore_masked_keys(v, src_child);
            }
        }
    }
}

fn default_pi_config_store() -> PiConfigStore {
    let dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".pi")
        .join("agent");
    PiConfigStore::new(dir)
}

#[command]
pub async fn pi_config_state() -> Result<PiConfigState, String> {
    default_pi_config_store().state()
}

#[command]
pub async fn pi_config_write_models(models_json: Value) -> Result<(), String> {
    default_pi_config_store().write_models(models_json)
}

#[command]
pub async fn pi_config_set_auth_key(provider: String, api_key: String) -> Result<(), String> {
    default_pi_config_store().set_auth_key(&provider, &api_key)
}

#[command]
pub async fn pi_config_remove_auth_key(provider: String) -> Result<(), String> {
    default_pi_config_store().remove_auth_key(&provider)
}

/// Provider API keys resolved the pi way: auth.json first, env vars second.
/// Replaces pi_provider_keys for the pi engine.
#[command]
pub async fn pi_auth_keys() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(default_pi_config_store().auth_keys())
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory context (scoped injection)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (SessionStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SessionStore::new(dir.path().to_path_buf());
        (store, dir)
    }

    #[test]
    fn session_crud_roundtrip() {
        let (store, _dir) = temp_store();
        let meta = store
            .create(
                Some("/Users/x/Downloads".into()),
                Some("整理截图".into()),
                "claude-sonnet-4-6".into(),
                None,
            )
            .unwrap();
        assert!(meta.id.starts_with("s-"));
        assert_eq!(meta.anchor.as_deref(), Some("/Users/x/Downloads"));

        store
            .append(
                &meta.id,
                &json!({"role":"user","content":"hi","timestamp":1}),
            )
            .unwrap();
        store
            .append(
                &meta.id,
                &json!({"role":"assistant","content":[],"timestamp":2}),
            )
            .unwrap();

        let messages = store.read(&meta.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");

        let listed = store.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].message_count, 2);
        assert_eq!(listed[0].title, "整理截图");

        store.rename(&meta.id, "改名了".into()).unwrap();
        assert_eq!(store.list()[0].title, "改名了");

        store.delete(&meta.id).unwrap();
        assert!(store.list().is_empty());
        assert!(store.read(&meta.id).is_err());
    }

    #[test]
    fn global_and_folder_sessions_do_not_collide() {
        let (store, _dir) = temp_store();
        let folder = store
            .create(Some("/a/b".into()), None, "m".into(), None)
            .unwrap();
        let global = store.create(None, Some("速聊".into()), "m".into(), None).unwrap();
        assert_eq!(store.list().len(), 2);

        let folder_path = store.session_path(&folder);
        let global_path = store.session_path(&global);
        assert!(folder_path
            .to_string_lossy()
            .contains("by-folder"));
        assert!(global_path.to_string_lossy().contains("global"));
    }

    #[test]
    fn fork_copies_transcript() {
        let (store, _dir) = temp_store();
        let src = store.create(Some("/a".into()), None, "m".into(), None).unwrap();
        store
            .append(&src.id, &json!({"role":"user","content":"q"}))
            .unwrap();
        let forked = store
            .fork(&src.id, Some("转为对话".into()), None, Some("quick_action".into()))
            .unwrap();
        assert_ne!(forked.id, src.id);
        assert_eq!(forked.origin.as_deref(), Some("quick_action"));
        assert_eq!(store.read(&forked.id).unwrap().len(), 1);
        // source still intact
        assert_eq!(store.read(&src.id).unwrap().len(), 1);
    }

    #[test]
    fn relink_moves_sessions_after_folder_rename() {
        let (store, _dir) = temp_store();
        let meta = store
            .create(Some("/Users/x/发票".into()), None, "m".into(), None)
            .unwrap();
        store
            .append(&meta.id, &json!({"role":"user","content":"q"}))
            .unwrap();

        let count = store.relink("/Users/x/发票", "/Users/x/票据").unwrap();
        assert_eq!(count, 1);
        let moved = store.list()[0].clone();
        assert_eq!(moved.anchor.as_deref(), Some("/Users/x/票据"));
        // transcript came along
        assert_eq!(store.read(&moved.id).unwrap().len(), 1);
        // manifest maps both hashes to the new path
        let manifest = store.load_manifest();
        assert_eq!(
            manifest.entries.get(&hash_path("/Users/x/发票")).map(|s| s.as_str()),
            Some("/Users/x/票据")
        );
    }

    #[test]
    fn index_survives_missing_files() {
        let (store, _dir) = temp_store();
        assert!(store.list().is_empty());
    }

    #[test]
    fn context_chain_reads_root_first_and_prefers_agents_md() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("home");
        let mid = root.join("Documents");
        let leaf = mid.join("发票");
        std::fs::create_dir_all(&leaf).unwrap();
        std::fs::write(root.join("AGENTS.md"), "root rules").unwrap();
        std::fs::write(mid.join("CLAUDE.md"), "mid claude").unwrap();
        std::fs::write(mid.join("AGENTS.md"), "mid agents").unwrap();
        std::fs::write(leaf.join("AGENTS.md"), "leaf rules").unwrap();

        let files = collect_chain_files(&leaf, &root);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].content, "root rules");
        // AGENTS.md wins over CLAUDE.md in the same directory
        assert_eq!(files[1].content, "mid agents");
        assert_eq!(files[2].content, "leaf rules");
    }

    #[test]
    fn context_chain_stops_outside_home() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("AGENTS.md"), "should not appear").unwrap();

        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();

        let files = collect_chain_files(&outside, &home);
        assert!(files.is_empty());
    }

    #[test]
    fn context_chain_caps_file_size() {
        let dir = tempfile::tempdir().unwrap();
        let leaf = dir.path().join("a");
        std::fs::create_dir_all(&leaf).unwrap();
        let big = "x".repeat((MAX_CONTEXT_FILE_BYTES + 1) as usize);
        std::fs::write(leaf.join("AGENTS.md"), big).unwrap();
        assert!(read_context_file(&leaf.join("AGENTS.md")).is_none());
    }
}

#[cfg(test)]
mod pi_config_tests {
    use super::*;

    fn store() -> (PiConfigStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        (PiConfigStore::new(dir.path().to_path_buf()), dir)
    }

    #[test]
    fn state_defaults_to_empty_providers() {
        let (store, _d) = store();
        let state = store.state().unwrap();
        assert_eq!(state.models_json["providers"].as_object().unwrap().len(), 0);
        assert!(state.models_path.ends_with("models.json"));
        assert!(state.auth_path.ends_with("auth.json"));
    }

    #[test]
    fn set_and_remove_auth_key_roundtrip() {
        let (store, _d) = store();
        store.set_auth_key("minimax", "eyJ-key").unwrap();
        assert_eq!(store.auth_keys().get("minimax").map(|s| s.as_str()), Some("eyJ-key"));

        // auth.json written with 0600
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(store.auth_path()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        store.set_auth_key("minimax", "").unwrap(); // empty removes
        assert!(!store.auth_keys().contains_key("minimax"));
    }

    #[test]
    fn rejects_bad_provider_ids() {
        let (store, _d) = store();
        assert!(store.set_auth_key("../evil", "k").is_err());
        assert!(store.set_auth_key("", "k").is_err());
        assert!(store.set_auth_key("my-provider", "k").is_ok());
    }

    #[test]
    fn models_json_masks_and_restores_literal_api_keys() {
        let (store, _d) = store();
        store.write_models_raw(&json!({
            "providers": {
                "my-llm": {
                    "baseUrl": "https://api.example.com/v1",
                    "api": "openai-completions",
                    "apiKey": "sk-secret",
                    "models": [{ "id": "m1" }]
                }
            }
        }))
        .unwrap();

        // read: key masked
        let state = store.state().unwrap();
        assert_eq!(state.models_json["providers"]["my-llm"]["apiKey"], API_KEY_KEEP_MARKER);

        // write back the masked payload: key survives
        store.write_models(state.models_json.clone()).unwrap();
        let raw = store.read_models_raw().unwrap();
        assert_eq!(raw["providers"]["my-llm"]["apiKey"], "sk-secret");

        // a NEW key written through the same path replaces it
        let mut edited = raw.clone();
        edited["providers"]["my-llm"]["apiKey"] = json!("sk-new");
        store.write_models(edited).unwrap();
        assert_eq!(
            store.read_models_raw().unwrap()["providers"]["my-llm"]["apiKey"],
            "sk-new"
        );
    }

    #[test]
    fn models_json_literal_apiKey_resolves_as_auth_key() {
        let (store, _d) = store();
        store
            .write_models_raw(&json!({
                "providers": {
                    "open.bigmodel.cn": {
                        "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                        "api": "openai-completions",
                        "apiKey": "sk-real-key",
                        "models": [{ "id": "glm-5.3" }]
                    }
                }
            }))
            .unwrap();

        // literal apiKey counts as a credential even with no auth.json
        let keys = store.auth_keys();
        assert_eq!(
            keys.get("open.bigmodel.cn").map(String::as_str),
            Some("sk-real-key")
        );

        // the masked marker is never a credential
        let mut edited = store.read_models_raw().unwrap();
        edited["providers"]["open.bigmodel.cn"]["apiKey"] = json!(API_KEY_KEEP_MARKER);
        store.write_models_raw(&edited).unwrap();
        assert!(!store.auth_keys().contains_key("open.bigmodel.cn"));
        // NOTE: dotted provider ids (host-named customs) are rejected by
        // set_auth_key, so the models.json literal is their ONLY credential
        // channel — auth.json remains authoritative for the ids it holds.
        store.set_auth_key("minimax", "sk-auth").unwrap();
        assert_eq!(
            store.auth_keys().get("minimax").map(String::as_str),
            Some("sk-auth")
        );
    }

    #[test]
    fn state_lists_providers_from_models_json_and_auth() {
        let (store, _d) = store();
        store.set_auth_key("deepseek", "k").unwrap();
        store.write_models_raw(&json!({
            "providers": { "my-llm": { "baseUrl": "https://x", "api": "openai-completions" } }
        }))
        .unwrap();
        let state = store.state().unwrap();
        let ids: Vec<&str> = state.auth_status.iter().map(|s| s.provider.as_str()).collect();
        assert!(ids.contains(&"deepseek"));
        assert!(ids.contains(&"my-llm"));
        assert!(state.auth_status.iter().find(|s| s.provider == "deepseek").unwrap().has_key);
        assert!(!state.auth_status.iter().find(|s| s.provider == "my-llm").unwrap().has_key);
    }
}
