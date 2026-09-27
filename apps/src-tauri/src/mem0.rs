// mem0 — cloud memory integration (mem0 Platform REST API).
//
// Automatic long-term memory: each conversation round is sent to mem0 for
// background extraction (facts/preferences distilled from the transcript),
// and relevant memories are searched and injected before each turn. Rust owns
// the credential and the HTTP calls so the WebView never fights CORS and the
// key stays in a 0600 file.
//
// Config: ~/.pi/agent/mem0-config.json — same convention as mem0's official
// pi plugin, so Wisp and the pi CLI can share one cloud memory pool.
//
// Wire protocol (verified live 2026-09-26):
//   POST   /v1/memories/           {messages, user_id}          → queued
//   POST   /v2/memories/search/    {query, filters:{user_id}}   → [{memory, score}]
//   GET    /v1/memories/?user_id=  → [{id, memory, categories}]
//   DELETE /v1/memories/<id>/      → delete one
//   DELETE /v1/memories/?user_id=  → delete all for the user
// Auth header: `Authorization: Token <api key>`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::command;

const AUTH_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mem0Config {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_user_id")]
    pub user_id: String,
    #[serde(default = "default_true")]
    pub auto_capture: bool,
}

fn default_user_id() -> String {
    "wisp".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for Mem0Config {
    fn default() -> Self {
        Self {
            enabled: true,
            api_key: String::new(),
            user_id: default_user_id(),
            auto_capture: true,
        }
    }
}

/// What the frontend may see — the key never crosses the bridge.
#[derive(Debug, Clone, Serialize)]
pub struct Mem0ConfigState {
    pub enabled: bool,
    pub has_key: bool,
    pub user_id: String,
    pub auto_capture: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Mem0Hit {
    pub id: String,
    pub memory: String,
    pub score: Option<f64>,
    pub categories: Vec<String>,
}

pub struct Mem0Store {
    dir: PathBuf,
}

impl Mem0Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn config_path(&self) -> PathBuf {
        self.dir.join("mem0-config.json")
    }

    pub fn read_config(&self) -> Mem0Config {
        std::fs::read_to_string(self.config_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn write_config(&self, config: &Mem0Config) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| format!("mkdir failed: {}", e))?;
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| format!("serialize failed: {}", e))?;
        std::fs::write(self.config_path(), json).map_err(|e| format!("write failed: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &self.config_path(),
                std::fs::Permissions::from_mode(0o600),
            );
        }
        Ok(())
    }

    fn home_store() -> Result<Self, String> {
        let dir = dirs::home_dir()
            .ok_or_else(|| "no home directory".to_string())?
            .join(".pi")
            .join("agent");
        Ok(Self::new(dir))
    }

    /// Blocking client — every caller already runs inside `spawn_blocking`.
    fn client() -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(AUTH_TIMEOUT_SECS))
            .build()
            .expect("reqwest client")
    }

    fn auth_header(key: &str) -> reqwest::header::HeaderValue {
        let mut v = reqwest::header::HeaderValue::from_str(&format!("Token {}", key))
            .expect("ascii header");
        v.set_sensitive(true);
        v
    }

    pub fn add_round(
        &self,
        user_text: &str,
        assistant_text: &str,
    ) -> Result<(), String> {
        let config = self.read_config();
        if !config.enabled || config.api_key.is_empty() {
            return Ok(());
        }
        let mut messages = vec![json!({"role": "user", "content": user_text})];
        if !assistant_text.trim().is_empty() {
            messages.push(json!({"role": "assistant", "content": assistant_text}));
        }
        let body = json!({"messages": messages, "user_id": config.user_id});
        let resp = Self::client()
            .post("https://api.mem0.ai/v1/memories/")
            .header(reqwest::header::AUTHORIZATION, Self::auth_header(&config.api_key))
            .json(&body)
            .send()
            .map_err(|e| format!("mem0 request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("mem0 add failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<Mem0Hit>, String> {
        let config = self.read_config();
        if config.api_key.is_empty() {
            return Ok(Vec::new());
        }
        let body = json!({
            "query": query,
            "filters": {"user_id": config.user_id},
            "limit": limit.clamp(1, 20),
        });
        let resp = Self::client()
            .post("https://api.mem0.ai/v2/memories/search/")
            .header(reqwest::header::AUTHORIZATION, Self::auth_header(&config.api_key))
            .json(&body)
            .send()
            .map_err(|e| format!("mem0 request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("mem0 search failed: HTTP {}", resp.status()));
        }
        let value: Value = resp
            .json()
            .map_err(|e| format!("mem0 decode failed: {}", e))?;
        let items = value.as_array().cloned().unwrap_or_default();
        Ok(items
            .iter()
            .map(|m| Mem0Hit {
                id: m["id"].as_str().unwrap_or_default().to_string(),
                memory: m["memory"].as_str().unwrap_or_default().to_string(),
                score: m["score"].as_f64(),
                categories: m["categories"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|c| c.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .filter(|h| !h.id.is_empty() && !h.memory.is_empty())
            .collect())
    }

    pub fn list(&self, limit: u32) -> Result<Vec<Mem0Hit>, String> {
        let config = self.read_config();
        if config.api_key.is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "https://api.mem0.ai/v1/memories/?user_id={}&limit={}",
            urlencoding::encode(&config.user_id),
            limit.clamp(1, 100),
        );
        let resp = Self::client()
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, Self::auth_header(&config.api_key))
            .send()
            .map_err(|e| format!("mem0 request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("mem0 list failed: HTTP {}", resp.status()));
        }
        let value: Value = resp
            .json()
            .map_err(|e| format!("mem0 decode failed: {}", e))?;
        let items = value.as_array().cloned().unwrap_or_default();
        Ok(items
            .iter()
            .map(|m| Mem0Hit {
                id: m["id"].as_str().unwrap_or_default().to_string(),
                memory: m["memory"].as_str().unwrap_or_default().to_string(),
                score: m["score"].as_f64(),
                categories: m["categories"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|c| c.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .filter(|h| !h.id.is_empty())
            .collect())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let config = self.read_config();
        if config.api_key.is_empty() {
            return Err("mem0 not configured".to_string());
        }
        // id comes from mem0 itself; still reject obvious path-ish junk.
        if id.contains('/') || id.len() > 64 {
            return Err("invalid memory id".to_string());
        }
        let url = format!("https://api.mem0.ai/v1/memories/{}/", id);
        let resp = Self::client()
            .delete(&url)
            .header(reqwest::header::AUTHORIZATION, Self::auth_header(&config.api_key))
            .send()
            .map_err(|e| format!("mem0 request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("mem0 delete failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    pub fn delete_all(&self) -> Result<(), String> {
        let config = self.read_config();
        if config.api_key.is_empty() {
            return Err("mem0 not configured".to_string());
        }
        let url = format!(
            "https://api.mem0.ai/v1/memories/?user_id={}",
            urlencoding::encode(&config.user_id),
        );
        let resp = Self::client()
            .delete(&url)
            .header(reqwest::header::AUTHORIZATION, Self::auth_header(&config.api_key))
            .send()
            .map_err(|e| format!("mem0 request failed: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("mem0 delete-all failed: HTTP {}", resp.status()));
        }
        Ok(())
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[command]
pub fn mem0_config_state() -> Result<Mem0ConfigState, String> {
    let store = Mem0Store::home_store()?;
    let c = store.read_config();
    Ok(Mem0ConfigState {
        enabled: c.enabled && !c.api_key.is_empty(),
        has_key: !c.api_key.is_empty(),
        user_id: c.user_id,
        auto_capture: c.auto_capture,
    })
}

fn save_config_on(
    store: &Mem0Store,
    enabled: Option<bool>,
    user_id: Option<String>,
    auto_capture: Option<bool>,
    api_key: Option<String>,
) -> Result<Mem0Config, String> {
    let mut c = store.read_config();
    if let Some(v) = enabled {
        c.enabled = v;
    }
    if let Some(v) = user_id {
        let v = v.trim().to_string();
        if v.is_empty() || v.contains('/') {
            return Err("invalid user id".to_string());
        }
        c.user_id = v;
    }
    if let Some(v) = auto_capture {
        c.auto_capture = v;
    }
    // Empty string = "keep existing key" (the masked input never round-trips).
    if let Some(v) = api_key {
        let v = v.trim().to_string();
        if !v.is_empty() {
            if !v.starts_with("m0-") {
                return Err("mem0 keys start with m0-".to_string());
            }
            c.api_key = v;
        }
    }
    store.write_config(&c)?;
    Ok(c)
}

#[command]
pub fn mem0_save_config(
    enabled: Option<bool>,
    user_id: Option<String>,
    auto_capture: Option<bool>,
    api_key: Option<String>,
) -> Result<Mem0ConfigState, String> {
    let store = Mem0Store::home_store()?;
    let c = save_config_on(&store, enabled, user_id, auto_capture, api_key)?;
    Ok(Mem0ConfigState {
        enabled: c.enabled && !c.api_key.is_empty(),
        has_key: !c.api_key.is_empty(),
        user_id: c.user_id,
        auto_capture: c.auto_capture,
    })
}

#[command]
pub async fn mem0_add(user_text: String, assistant_text: String) -> Result<(), String> {
    let store = Mem0Store::home_store()?;
    if !store.read_config().auto_capture {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || store.add_round(&user_text, &assistant_text))
        .await
        .map_err(|e| format!("join failed: {}", e))?
}

#[command]
pub async fn mem0_search(query: String, limit: Option<u32>) -> Result<Vec<Mem0Hit>, String> {
    let store = Mem0Store::home_store()?;
    let limit = limit.unwrap_or(5);
    tokio::task::spawn_blocking(move || store.search(&query, limit))
        .await
        .map_err(|e| format!("join failed: {}", e))?
}

#[command]
pub async fn mem0_list(limit: Option<u32>) -> Result<Vec<Mem0Hit>, String> {
    let store = Mem0Store::home_store()?;
    let limit = limit.unwrap_or(50);
    tokio::task::spawn_blocking(move || store.list(limit))
        .await
        .map_err(|e| format!("join failed: {}", e))?
}

#[command]
pub async fn mem0_delete(id: String) -> Result<(), String> {
    let store = Mem0Store::home_store()?;
    tokio::task::spawn_blocking(move || store.delete(&id))
        .await
        .map_err(|e| format!("join failed: {}", e))?
}

#[command]
pub async fn mem0_delete_all() -> Result<(), String> {
    let store = Mem0Store::home_store()?;
    tokio::task::spawn_blocking(move || store.delete_all())
        .await
        .map_err(|e| format!("join failed: {}", e))?
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (Mem0Store, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        (Mem0Store::new(dir.path().to_path_buf()), dir)
    }

    #[test]
    fn config_roundtrip_and_permissions() {
        let (store, _d) = temp_store();
        // A missing config file yields the default (enabled, no key).
        let fresh = store.read_config();
        assert!(fresh.enabled);
        assert!(fresh.api_key.is_empty());
        let mut c = fresh;
        c.enabled = true;
        c.api_key = "m0-test".into();
        c.user_id = "wisp-test".into();
        store.write_config(&c).unwrap();

        let back = store.read_config();
        assert!(back.enabled);
        assert_eq!(back.api_key, "m0-test");
        assert_eq!(back.user_id, "wisp-test");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(store.config_path())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn save_config_empty_key_keeps_existing() {
        let (store, _d) = temp_store();
        let mut c = store.read_config();
        c.api_key = "m0-keep".into();
        store.write_config(&c).unwrap();

        let saved = save_config_on(&store, Some(true), Some("wisp".into()), None, Some("".into()))
            .expect("save");
        assert!(!saved.api_key.is_empty());
        assert_eq!(store.read_config().api_key, "m0-keep");
    }

    #[test]
    fn save_config_rejects_bad_input() {
        let (store, _d) = temp_store();
        assert!(save_config_on(&store, None, Some("a/b".into()), None, None).is_err());
        assert!(save_config_on(&store, None, None, None, Some("not-m0".into())).is_err());
        assert!(save_config_on(&store, None, Some("ok".into()), None, None).is_ok());
    }

    /// Live round-trip against the real cloud. Ignored by default:
    ///   MEM0_API_KEY=m0-... cargo test --lib live_mem0 -- --ignored
    #[test]
    #[ignore]
    fn live_mem0_roundtrip() {
        let key = std::env::var("MEM0_API_KEY").expect("MEM0_API_KEY not set");
        let dir = tempfile::tempdir().expect("tempdir");
        let store = Mem0Store::new(dir.path().to_path_buf());
        store
            .write_config(&Mem0Config {
                enabled: true,
                api_key: key,
                user_id: "wisp-live-test".into(),
                auto_capture: true,
            })
            .unwrap();

        store
            .add_round("记住：我喜欢把截图按日期归档", "好的，已记住。")
            .expect("add");
        // background extraction needs a beat
        std::thread::sleep(std::time::Duration::from_secs(6));
        let hits = store.search("截图怎么归档", 5).expect("search");
        assert!(!hits.is_empty(), "expected at least one extracted memory");
        for h in &hits {
            store.delete(&h.id).expect("delete");
        }
        let after = store.list(50).expect("list");
        assert!(after.is_empty(), "cleanup failed: {:?}", after);
    }

    #[test]
    fn delete_rejects_pathish_ids() {
        let (store, _d) = temp_store();
        let mut c = store.read_config();
        c.api_key = "m0-x".into();
        store.write_config(&c).unwrap();
        assert!(store.delete("../evil").is_err());
        assert!(store.delete(&"x".repeat(65)).is_err());
    }
}
