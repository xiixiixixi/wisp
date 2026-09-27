pub mod planner;
pub mod security;
pub mod tool_executor;
pub mod tools;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::command;
use tauri::Emitter;

// Re-export key types
pub use planner::OperationPlan;

// ─── Helpers ────────────────────────────────────────────────────────────────

pub fn truncate_to_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut idx = max_bytes;
    while !s.is_char_boundary(idx) {
        idx -= 1;
    }
    &s[..idx]
}

// ─── Data Structures ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
    pub requires_approval: bool,
    pub status: String, // "pending", "running", "completed", "denied", "error"
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub event_type: String, // "text", "text_delta", "tool_call", "tool_result", "approval_request", "plan_created", "plan_progress", "complete", "error"
    pub session_id: String,
    pub tool_call: Option<AgentToolCall>,
    pub text: Option<String>,
    pub plan: Option<OperationPlan>,
    pub timestamp: u64,
}

fn default_thinking_budget() -> u32 {
    10_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    pub enabled: bool,
    pub api_key: String,
    #[serde(default)]
    pub openai_api_key: String,
    pub model: String,
    pub max_turns: u32,
    pub auto_approve: bool,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default = "default_thinking_budget")]
    pub thinking_budget: u32,
}

/// Redacted version of AgentSettings returned to the frontend.
/// API keys are replaced with boolean flags indicating whether they are set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeAgentSettings {
    pub enabled: bool,
    pub has_api_key: bool,
    pub has_openai_api_key: bool,
    pub model: String,
    pub max_turns: u32,
    pub auto_approve: bool,
    pub thinking_enabled: bool,
    pub thinking_budget: u32,
}

impl SafeAgentSettings {
    pub fn from_settings(settings: &AgentSettings) -> Self {
        Self {
            enabled: settings.enabled,
            has_api_key: !settings.api_key.is_empty(),
            has_openai_api_key: !settings.openai_api_key.is_empty(),
            model: settings.model.clone(),
            max_turns: settings.max_turns,
            auto_approve: settings.auto_approve,
            thinking_enabled: settings.thinking_enabled,
            thinking_budget: settings.thinking_budget,
        }
    }
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            api_key: String::new(),
            openai_api_key: String::new(),
            model: "claude-sonnet-4-6".to_string(),
            max_turns: 25,
            auto_approve: false,
            thinking_enabled: false,
            thinking_budget: 10_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPermissions {
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub auto_approve_tools: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub blocked_paths: Vec<String>,
    #[serde(default)]
    pub custom_blocked_commands: Vec<String>,
    #[serde(default = "default_true")]
    pub block_internet: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AgentPermissions {
    fn default() -> Self {
        Self {
            disabled_tools: Vec::new(),
            auto_approve_tools: Vec::new(),
            allowed_paths: Vec::new(),
            blocked_paths: Vec::new(),
            custom_blocked_commands: Vec::new(),
            block_internet: true,
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

pub use crate::utils::now_ms;

pub fn emit_event(app: &tauri::AppHandle, event: &AgentEvent) {
    let _ = app.emit("agent-event", event);
}

fn settings_path() -> std::path::PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("wisp");
    std::fs::create_dir_all(&dir).ok();
    dir.join("agent_settings.json")
}

fn load_settings() -> AgentSettings {
    let path = settings_path();
    let mut settings: AgentSettings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Retrieve API keys from OS keychain
    if let Ok(Some(key)) = crate::secure_credentials::get_secret("agent-api-key") {
        settings.api_key = key;
    } else if !settings.api_key.is_empty() {
        // Migrate plaintext API key to keychain
        crate::secure_credentials::migrate_to_keychain("agent-api-key", &settings.api_key);
    }

    if let Ok(Some(key)) = crate::secure_credentials::get_secret("agent-openai-api-key") {
        settings.openai_api_key = key;
    } else if !settings.openai_api_key.is_empty() {
        crate::secure_credentials::migrate_to_keychain(
            "agent-openai-api-key",
            &settings.openai_api_key,
        );
    }

    settings
}

fn permissions_path() -> std::path::PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("wisp");
    std::fs::create_dir_all(&dir).ok();
    dir.join("agent_permissions.json")
}

pub fn load_permissions() -> AgentPermissions {
    let path = permissions_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_permissions(perms: &AgentPermissions) -> Result<(), String> {
    let path = permissions_path();
    let json = serde_json::to_string_pretty(perms)
        .map_err(|e| format!("Failed to serialize permissions: {}", e))?;
    std::fs::write(&path, &json).map_err(|e| format!("Failed to write permissions: {}", e))?;
    Ok(())
}


// ─── Tool Execution ─────────────────────────────────────────────────────────

/// Execute a single write tool, handling plan creation events, and return
/// the tool_result JSON value along with the updated AgentToolCall.
///
/// SECURITY: Write tools require the `approved` flag to be set to true before
/// execution proceeds. This ensures that all write operations have been
/// explicitly approved through the approval flow.
fn execute_write_tool(
    tool_id: &str,
    tool_name: &str,
    tool_input: &Value,
    session_id: &str,
    app_handle: &tauri::AppHandle,
    approved: bool,
) -> (Value, AgentToolCall) {
    let requires_approval = tools::tool_requires_approval(tool_name);

    let mut tool_call = AgentToolCall {
        id: tool_id.to_string(),
        name: tool_name.to_string(),
        input: tool_input.clone(),
        requires_approval,
        status: "running".to_string(),
        result: None,
        error: None,
    };

    // Backend enforcement: verify that write operations have been approved.
    // This is a defense-in-depth check — the caller (execute_write_tools)
    // should only call this function after approval, but we verify here.
    // The `approved` parameter is passed in by the caller to confirm the
    // operation went through the approval flow.
    if requires_approval && !approved {
        tool_call.status = "error".to_string();
        tool_call.error = Some("Write operation requires approval".to_string());
        let result = json!({
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": "Error: Write operation requires approval",
            "is_error": true,
        });
        return (result, tool_call);
    }

    let is_plan_create = tool_name == "create_plan";

    let tool_result = match tool_executor::execute_tool(tool_name, tool_input) {
        Ok(result) => {
            tool_call.status = "completed".to_string();
            tool_call.result = Some(result.clone());

            // Emit plan_created event if applicable
            if is_plan_create {
                if let Ok(plan_data) = serde_json::from_str::<Value>(&result) {
                    if let Some(plan_id) = plan_data["plan_id"].as_str() {
                        if let Some(plan) = planner::get_plan(plan_id) {
                            emit_event(
                                app_handle,
                                &AgentEvent {
                                    event_type: "plan_created".to_string(),
                                    session_id: session_id.to_string(),
                                    tool_call: None,
                                    text: None,
                                    plan: Some(plan),
                                    timestamp: now_ms(),
                                },
                            );
                        }
                    }
                }
            }

            json!({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": result,
            })
        }
        Err(err) => {
            tool_call.status = "error".to_string();
            tool_call.error = Some(err.clone());

            json!({
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": format!("Error: {}", err),
                "is_error": true,
            })
        }
    };

    (tool_result, tool_call)
}

/// Execute one tool on behalf of the frontend pi engine (pi_bridge).
/// Wraps the same gated path the internal loop uses: `approved` is the
/// backend backstop for write tools, and path sandboxing stays inside
/// `tool_executor`.
pub fn run_tool_for_pi(
    tool_id: &str,
    session_id: &str,
    tool_name: &str,
    tool_input: &Value,
    approved: bool,
    app_handle: &tauri::AppHandle,
) -> (Value, AgentToolCall) {
    execute_write_tool(
        tool_id,
        tool_name,
        tool_input,
        session_id,
        app_handle,
        approved,
    )
}
#[command]
pub async fn get_agent_settings() -> Result<SafeAgentSettings, String> {
    let settings = load_settings();
    Ok(SafeAgentSettings::from_settings(&settings))
}

// ─── Permission Commands ─────────────────────────────────────────────────

#[command]
pub async fn get_agent_permissions() -> Result<AgentPermissions, String> {
    Ok(load_permissions())
}

#[command]
pub async fn update_agent_permissions(permissions: AgentPermissions) -> Result<(), String> {
    save_permissions(&permissions)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_to_char_boundary_ascii() {
        let s = "Hello, World!";
        assert_eq!(truncate_to_char_boundary(s, 5), "Hello");
        assert_eq!(truncate_to_char_boundary(s, 100), s);
    }

    #[test]
    fn test_truncate_to_char_boundary_multibyte() {
        let s = "Hello, \u{1F600} World!"; // contains a 4-byte emoji
        let truncated = truncate_to_char_boundary(s, 10);
        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
    }

    #[test]
    fn test_truncate_to_char_boundary_empty() {
        let s = "";
        assert_eq!(truncate_to_char_boundary(s, 0), "");
        assert_eq!(truncate_to_char_boundary(s, 10), "");
    }




}
