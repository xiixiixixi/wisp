use ollama_rs::{generation::completion::request::GenerationRequest, Ollama};
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::command;
use tracing::{info, warn};

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AIModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContext {
    pub name: String,
    pub path: String,
    pub file_type: String,
    pub content: Option<String>,
    /// Base64-encoded image data (raw base64, no data URL prefix).
    pub image_base64: Option<String>,
    /// MIME type of the image (e.g. "image/png").
    pub image_mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDirectories {
    pub home: String,
    pub documents: String,
    pub downloads: String,
    pub desktop: String,
    pub pictures: String,
    pub videos: String,
    pub music: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub version: String,
    pub hostname: String,
}

static RECENT_FOLDERS: LazyLock<Arc<Mutex<Vec<String>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(Vec::new())));

#[command]
pub async fn get_ai_models() -> Result<Vec<AIModel>, String> {
    info!("Fetching AI models...");

    let mut all_models = Vec::new();

    // Add Claude models if API key is available (from keychain or env var for dev)
    let claude_api_key = crate::secure_credentials::get_secret("agent-api-key")
        .ok()
        .flatten()
        .or_else(|| env::var("CLAUDE_API_KEY").ok());
    if claude_api_key.is_some() {
        all_models.extend(vec![
            AIModel {
                id: "claude-sonnet-4-20250514".to_string(),
                name: "Claude Sonnet 4".to_string(),
                provider: "anthropic".to_string(),
                available: true,
            },
            AIModel {
                id: "claude-haiku-4-5-20251001".to_string(),
                name: "Claude Haiku 4.5".to_string(),
                provider: "anthropic".to_string(),
                available: true,
            },
            AIModel {
                id: "claude-opus-4-6-20250515".to_string(),
                name: "Claude Opus 4.6".to_string(),
                provider: "anthropic".to_string(),
                available: true,
            },
        ]);
        info!("Added Claude models to available models");
    }

    // Add OpenAI models if API key is available (from keychain or env var)
    let openai_api_key = crate::secure_credentials::get_secret("agent-openai-api-key")
        .ok()
        .flatten()
        .or_else(|| env::var("OPENAI_API_KEY").ok());
    if openai_api_key.is_some() {
        all_models.extend(vec![
            AIModel {
                id: "gpt-4o".to_string(),
                name: "GPT-4o".to_string(),
                provider: "openai".to_string(),
                available: true,
            },
            AIModel {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
                provider: "openai".to_string(),
                available: true,
            },
            AIModel {
                id: "o3-mini".to_string(),
                name: "o3 Mini".to_string(),
                provider: "openai".to_string(),
                available: true,
            },
        ]);
        info!("Added OpenAI models to available models");
    }

    // Try to get Ollama models
    let ollama = Ollama::default();
    match ollama.list_local_models().await {
        Ok(models) => {
            for model in models {
                all_models.push(AIModel {
                    id: model.name.clone(),
                    name: model.name,
                    provider: "ollama".to_string(),
                    available: true,
                });
            }
            info!(
                "Added {} Ollama models",
                all_models.iter().filter(|m| m.provider == "ollama").count()
            );
        }
        Err(e) => {
            warn!("Failed to connect to Ollama: {}", e);
            // Add default Ollama models even if Ollama is not available
            all_models.extend(vec![
                AIModel {
                    id: "deepseek-r1:1.5b".to_string(),
                    name: "DeepSeek R1 1.5B".to_string(),
                    provider: "ollama".to_string(),
                    available: false, // Mark as unavailable since Ollama is not running
                },
                AIModel {
                    id: "deepseek-r1:8b".to_string(),
                    name: "DeepSeek R1 8B".to_string(),
                    provider: "ollama".to_string(),
                    available: false,
                },
            ]);
            info!("Added default Ollama models (marked as unavailable)");
        }
    }

    info!("Total available models: {}", all_models.len());
    Ok(all_models)
}

#[command]
pub async fn check_ollama_status() -> Result<bool, String> {
    info!("Checking Ollama status...");

    let ollama = Ollama::default();

    match ollama.list_local_models().await {
        Ok(_) => {
            info!("Ollama is running and accessible");
            Ok(true)
        }
        Err(e) => {
            warn!("Failed to connect to Ollama: {}", e);
            Ok(false)
        }
    }
}

#[command]
pub async fn chat_with_ai(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
    custom_endpoint: Option<String>,
    custom_api_key: Option<String>,
) -> Result<String, String> {
    info!("Starting chat with AI using model: {}", model);

    // Route to appropriate AI service
    route_ai_request(model, messages, file_context, custom_endpoint, custom_api_key).await
}

// User directory operations
#[command]
pub async fn get_user_directories() -> Result<UserDirectories, String> {
    let home_path =
        dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let home = home_path.to_string_lossy().to_string();

    Ok(UserDirectories {
        home: home.clone(),
        documents: home_path.join("Documents").to_string_lossy().to_string(),
        downloads: home_path.join("Downloads").to_string_lossy().to_string(),
        desktop: home_path.join("Desktop").to_string_lossy().to_string(),
        pictures: home_path.join("Pictures").to_string_lossy().to_string(),
        videos: home_path.join("Videos").to_string_lossy().to_string(),
        music: home_path.join("Music").to_string_lossy().to_string(),
    })
}

#[command]
pub async fn get_recent_folders() -> Result<Vec<String>, String> {
    let recent_folders = RECENT_FOLDERS.lock().map_err(|e| e.to_string())?;
    Ok(recent_folders.clone())
}

#[command]
pub async fn add_to_recent_folders(path: String) -> Result<(), String> {
    let mut recent_folders = RECENT_FOLDERS.lock().map_err(|e| e.to_string())?;

    // Remove if already exists
    recent_folders.retain(|p| p != &path);

    // Add to front
    recent_folders.insert(0, path);

    // Keep only last 10
    if recent_folders.len() > 10 {
        recent_folders.truncate(10);
    }

    Ok(())
}

#[command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let os = env::consts::OS.to_string();
    let arch = env::consts::ARCH.to_string();
    let version = env::var("OS").unwrap_or_else(|_| "Unknown".to_string());
    let hostname = env::var("COMPUTERNAME")
        .or_else(|_| env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Unknown".to_string());

    Ok(SystemInfo {
        os,
        arch,
        version,
        hostname,
    })
}

// Claude API structures
#[derive(Debug, Serialize, Deserialize)]
struct ClaudeMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<ClaudeMessage>,
    system: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClaudeContent {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
    #[serde(rename = "type")]
    response_type: String,
}

// Claude API client
async fn chat_with_claude(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
) -> Result<String, String> {
    let api_key = crate::secure_credentials::get_secret("agent-api-key")
        .ok()
        .flatten()
        .or_else(|| env::var("CLAUDE_API_KEY").ok())
        .ok_or_else(|| {
            "Claude API key not configured. Set it in Settings → AI Agent.".to_string()
        })?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Build system message
    let mut system_message = "You are Copilot, an AI assistant integrated into the Wisp file explorer. You help users with file management, code analysis, and development tasks. Be helpful, thorough, and practical. Provide detailed, comprehensive responses with specific examples and step-by-step guidance when appropriate. Include code examples, best practices, and additional context that would be valuable to the user.".to_string();

    // Add file context to system message if provided
    if let Some(context) = &file_context {
        system_message.push_str(&format!(
            "\n\nYou are currently working with:\nFile: {}\nPath: {}\nType: {}",
            context.name, context.path, context.file_type
        ));

        if let Some(content) = &context.content {
            system_message.push_str(&format!("\nContent:\n{}", content));
        }
    }

    // Ensure the conversation ends with a user message (Claude API requirement).
    let mut messages = messages;
    if messages.last().map(|m| m.role.as_str()) != Some("user") {
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: "Continue.".to_string(),
        });
    }

    // Convert messages to Claude format, injecting image content blocks when present
    let has_image = file_context
        .as_ref()
        .map(|c| c.image_base64.is_some())
        .unwrap_or(false);

    // Find the index of the last user message (to inject image only there)
    let last_user_idx = messages.iter().rposition(|m| m.role == "user");

    let claude_messages: Vec<ClaudeMessage> = messages
        .into_iter()
        .enumerate()
        .map(|(idx, msg)| {
            let role = if msg.role == "user" {
                "user".to_string()
            } else {
                "assistant".to_string()
            };

            // Inject image content block on the last user message only
            if has_image && last_user_idx == Some(idx) {
                if let Some(ref ctx) = file_context {
                    if let (Some(ref b64), Some(ref mime)) =
                        (&ctx.image_base64, &ctx.image_mime_type)
                    {
                        let content = serde_json::json!([
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime,
                                    "data": b64,
                                }
                            },
                            {
                                "type": "text",
                                "text": msg.content,
                            }
                        ]);
                        return ClaudeMessage { role, content };
                    }
                }
            }

            ClaudeMessage {
                role,
                content: serde_json::Value::String(msg.content),
            }
        })
        .collect();

    let request_body = ClaudeRequest {
        model,
        max_tokens: 4096,
        messages: claude_messages,
        system: Some(system_message),
    };

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Claude API: {}", e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Claude API error: {}", error_text));
    }

    let claude_response: ClaudeResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    // Extract text from the first content item that has text
    claude_response
        .content
        .iter()
        .find_map(|c| c.text.clone())
        .ok_or_else(|| "No content in Claude response".to_string())
}

// Update the main chat function to route to appropriate AI service
async fn route_ai_request(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
    custom_endpoint: Option<String>,
    custom_api_key: Option<String>,
) -> Result<String, String> {
    // Check if it's a Claude model
    if model.starts_with("claude-") {
        chat_with_claude(model, messages, file_context).await
    } else if model.starts_with("openrouter:") {
        // OpenRouter model — strip the "openrouter:" prefix
        let or_model = model
            .strip_prefix("openrouter:")
            .unwrap_or(&model)
            .to_string();
        chat_with_openrouter(or_model, messages, file_context, None).await
    } else if model.starts_with("custom-openai:") {
        // User-configured OpenAI-compatible endpoint (MiniMax, DeepSeek, GLM…)
        let custom_model = model
            .strip_prefix("custom-openai:")
            .unwrap_or(&model)
            .to_string();
        chat_with_openai_compatible(custom_model, messages, file_context, custom_endpoint, custom_api_key)
            .await
    } else if model.starts_with("custom-anthropic:") {
        // User-configured Anthropic-compatible endpoint (/v1/messages)
        let custom_model = model
            .strip_prefix("custom-anthropic:")
            .unwrap_or(&model)
            .to_string();
        chat_with_anthropic_compatible(
            custom_model,
            messages,
            file_context,
            custom_endpoint,
            custom_api_key,
        )
        .await
    } else {
        // Use existing Ollama chat function
        chat_with_ollama(model, messages, file_context).await
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter API (OpenAI-compatible)
// ─────────────────────────────────────────────────────────────────────────────

/// Chat via OpenRouter. Uses the caller's `api_key` when provided, otherwise
/// falls back to the `OPENROUTER_API_KEY` env var (for the hosted Wisp Cloud service).
async fn chat_with_openrouter(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
    api_key: Option<String>,
) -> Result<String, String> {
    let key = api_key
        .or_else(|| env::var("OPENROUTER_API_KEY").ok())
        .ok_or_else(|| {
            "OpenRouter API key not configured. Set it in Settings → AI or via OPENROUTER_API_KEY env var.".to_string()
        })?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Build system message
    let mut system_content = "You are Copilot, an AI assistant integrated into the Wisp file explorer. You help users with file management, code analysis, and development tasks. Be helpful, thorough, and practical. Provide detailed, comprehensive responses with specific examples and step-by-step guidance when appropriate. Include code examples, best practices, and additional context that would be valuable to the user.".to_string();

    if let Some(context) = &file_context {
        system_content.push_str(&format!(
            "\n\nYou are currently working with:\nFile: {}\nPath: {}\nType: {}",
            context.name, context.path, context.file_type
        ));
        if let Some(content) = &context.content {
            system_content.push_str(&format!("\nContent:\n{}", content));
        }
    }

    // Build OpenAI-compatible messages array
    let mut api_messages = vec![serde_json::json!({
        "role": "system",
        "content": system_content,
    })];

    for msg in &messages {
        let role = if msg.role == "user" {
            "user"
        } else {
            "assistant"
        };
        api_messages.push(serde_json::json!({
            "role": role,
            "content": msg.content,
        }));
    }

    // Ensure conversation ends with a user message
    if messages.last().map(|m| m.role.as_str()) != Some("user") {
        api_messages.push(serde_json::json!({
            "role": "user",
            "content": "Continue.",
        }));
    }

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": api_messages,
    });

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", key))
        .header("HTTP-Referer", "https://xplorer.space")
        .header("X-Title", "Wisp")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to OpenRouter API: {}", e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("OpenRouter API error: {}", error_text));
    }

    let resp: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenRouter response: {}", e))?;

    resp.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in OpenRouter response".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom OpenAI-compatible endpoint (MiniMax, DeepSeek, GLM, Qwen, …)
// ─────────────────────────────────────────────────────────────────────────────

/// Normalize an OpenAI-compatible endpoint: base URLs get the standard
/// chat/completions path appended; full paths pass through untouched.
fn normalize_openai_endpoint(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.ends_with("chat/completions") || trimmed.contains("chatcompletion") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

/// Chat via a user-configured OpenAI-compatible endpoint. Accepts either a
/// base URL (e.g. https://api.minimaxi.com/v1 — "/chat/completions" is
/// appended automatically, the ZCode convention) or a full endpoint path.
async fn chat_with_openai_compatible(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
    endpoint: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let raw_endpoint = endpoint.filter(|s| !s.trim().is_empty()).ok_or_else(|| {
        "Custom endpoint not configured. Set it in Settings → AI → 助手（高级）.".to_string()
    })?;
    // Trim: pasted keys/URLs often carry stray whitespace, and unlike MiniMax
    // most providers reject a "Bearer <key> " header outright.
    let key = api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Custom API key not configured.".to_string())?;

    let endpoint = normalize_openai_endpoint(&raw_endpoint);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut system_content = "You are an AI assistant integrated into the Wisp file explorer. You help users with file management, code analysis, and development tasks. Be helpful, thorough, and practical.".to_string();
    if let Some(context) = &file_context {
        system_content.push_str(&format!(
            "\n\nYou are currently working with:\nFile: {}\nPath: {}\nType: {}",
            context.name, context.path, context.file_type
        ));
        if let Some(content) = &context.content {
            system_content.push_str(&format!("\nContent:\n{}", content));
        }
    }

    let mut api_messages = vec![serde_json::json!({
        "role": "system",
        "content": system_content,
    })];
    for msg in &messages {
        let role = if msg.role == "user" { "user" } else { "assistant" };
        api_messages.push(serde_json::json!({
            "role": role,
            "content": msg.content,
        }));
    }
    if messages.last().map(|m| m.role.as_str()) != Some("user") {
        api_messages.push(serde_json::json!({
            "role": "user",
            "content": "Continue.",
        }));
    }

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "messages": api_messages,
    });

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to {}: {}", endpoint, e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Custom endpoint API error: {}", error_text));
    }

    let resp: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse custom endpoint response: {}", e))?;

    resp.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No content in custom endpoint response".to_string())
}

/// Normalize an Anthropic-compatible endpoint: base URLs get /v1/messages
/// appended; full paths pass through untouched.
fn normalize_anthropic_endpoint(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.ends_with("/messages") || trimmed.ends_with("/v1/messages") {
        trimmed.to_string()
    } else if trimmed.ends_with("/v1") {
        format!("{}/messages", trimmed)
    } else {
        format!("{}/v1/messages", trimmed)
    }
}

/// Chat via a user-configured Anthropic-compatible endpoint (MiniMax, GLM,
/// DeepSeek and Kimi all expose /v1/messages). Text-only for now.
async fn chat_with_anthropic_compatible(
    model: String,
    mut messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
    endpoint: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let raw_endpoint = endpoint.filter(|s| !s.trim().is_empty()).ok_or_else(|| {
        "Custom endpoint not configured. Set it in Settings → AI → 助手（高级）.".to_string()
    })?;
    let key = api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Custom API key not configured.".to_string())?;

    let endpoint = normalize_anthropic_endpoint(&raw_endpoint);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut system_content = "You are an AI assistant integrated into the Wisp file explorer. You help users with file management, code analysis, and development tasks. Be helpful, thorough, and practical.".to_string();
    if let Some(context) = &file_context {
        system_content.push_str(&format!(
            "\n\nYou are currently working with:\nFile: {}\nPath: {}\nType: {}",
            context.name, context.path, context.file_type
        ));
        if let Some(content) = &context.content {
            system_content.push_str(&format!("\nContent:\n{}", content));
        }
    }

    // Anthropic requires the conversation to end with a user message
    if messages.last().map(|m| m.role.as_str()) != Some("user") {
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: "Continue.".to_string(),
        });
    }

    let api_messages: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|msg| {
            let role = if msg.role == "user" { "user" } else { "assistant" };
            serde_json::json!({ "role": role, "content": msg.content })
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_content,
        "messages": api_messages,
    });

    let response = client
        .post(&endpoint)
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to {}: {}", endpoint, e))?;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Custom Anthropic endpoint error: {}", error_text));
    }

    let resp: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    resp.get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|block| block.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No text in Anthropic response".to_string())
}

/// Live test against the user's MiniMax endpoint (env: MINIMAX_API_HOST +
/// MINIMAX_API_KEY). Ignored by default; run with:
///   cargo test custom_openai_compatible_minimax_live -- --ignored --nocapture
#[cfg(test)]
mod custom_endpoint_tests {
    use super::*;

    #[test]
    fn normalizes_base_and_full_endpoints() {
        assert_eq!(
            normalize_openai_endpoint("https://api.minimaxi.com/v1"),
            "https://api.minimaxi.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_openai_endpoint("https://api.minimaxi.com/v1/"),
            "https://api.minimaxi.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_openai_endpoint("https://api.minimaxi.com/v1/chat/completions"),
            "https://api.minimaxi.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_openai_endpoint("https://api.minimaxi.com/v1/text/chatcompletion_v2"),
            "https://api.minimaxi.com/v1/text/chatcompletion_v2"
        );
    }

    #[test]
    fn normalizes_anthropic_endpoints() {
        assert_eq!(
            normalize_anthropic_endpoint("https://api.minimaxi.com/anthropic"),
            "https://api.minimaxi.com/anthropic/v1/messages"
        );
        assert_eq!(
            normalize_anthropic_endpoint("https://api.anthropic.com"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            normalize_anthropic_endpoint("https://api.anthropic.com/v1"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            normalize_anthropic_endpoint("https://x/anthropic/v1/messages"),
            "https://x/anthropic/v1/messages"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn custom_anthropic_compatible_minimax_live() {
        let host = std::env::var("MINIMAX_API_HOST").expect("MINIMAX_API_HOST not set");
        let key = std::env::var("MINIMAX_API_KEY").expect("MINIMAX_API_KEY not set");
        // Anthropic-compatible base URL; /v1/messages is appended
        let endpoint = host.trim_end_matches('/').to_string() + "/anthropic";

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "只回复两个字：收到".to_string(),
        }];

        let reply = chat_with_anthropic_compatible(
            "MiniMax-Text-01".to_string(),
            messages,
            None,
            Some(endpoint),
            Some(key),
        )
        .await
        .expect("MiniMax Anthropic chat should succeed");

        assert!(!reply.trim().is_empty(), "reply should not be empty");
        println!("MiniMax Anthropic live reply: {}", reply);
    }

    #[tokio::test]
    #[ignore]
    async fn custom_openai_compatible_minimax_live() {
        let host = std::env::var("MINIMAX_API_HOST").expect("MINIMAX_API_HOST not set");
        let key = std::env::var("MINIMAX_API_KEY").expect("MINIMAX_API_KEY not set");
        // Base URL only — the standard /chat/completions path is appended
        let endpoint = host.trim_end_matches('/').to_string() + "/v1";

        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "只回复两个字：收到".to_string(),
        }];

        let reply = chat_with_openai_compatible(
            "MiniMax-Text-01".to_string(),
            messages,
            None,
            Some(endpoint),
            Some(key),
        )
        .await
        .expect("MiniMax chat should succeed");

        assert!(!reply.trim().is_empty(), "reply should not be empty");
        println!("MiniMax live reply: {}", reply);
    }
}


/// Detect an available Ollama vision model (async version)
async fn detect_ollama_vision_model() -> Option<String> {
    let vision_models = [
        "llava",
        "bakllava",
        "moondream",
        "llava-llama3",
        "llava:13b",
        "llava:7b",
    ];

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return None,
    };

    let response = match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => r,
        Err(_) => return None,
    };

    #[derive(Deserialize)]
    struct OllamaModel {
        name: String,
    }
    #[derive(Deserialize)]
    struct OllamaModelList {
        models: Vec<OllamaModel>,
    }

    let model_list: OllamaModelList = match response.json().await {
        Ok(m) => m,
        Err(_) => return None,
    };

    for model in &model_list.models {
        let name_lower = model.name.to_lowercase();
        for vision in &vision_models {
            if name_lower.contains(vision) {
                return Some(model.name.clone());
            }
        }
    }

    None
}
async fn call_ollama_vision_async(
    model: &str,
    prompt: &str,
    images: &[String],
) -> Result<String, String> {
    #[derive(Serialize)]
    struct OllamaGenReq {
        model: String,
        prompt: String,
        images: Option<Vec<String>>,
        stream: bool,
    }
    #[derive(Deserialize)]
    struct OllamaGenResp {
        response: String,
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let request = OllamaGenReq {
        model: model.to_string(),
        prompt: prompt.to_string(),
        images: Some(images.to_vec()),
        stream: false,
    };

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Ollama API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error ({}): {}", status, body));
    }

    let result: OllamaGenResp = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(result.response)
}

// Rename the existing chat function and create a new router
async fn chat_with_ollama(
    model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
) -> Result<String, String> {
    info!("Starting chat with Ollama using model: {}", model);

    // Check if we have image data and should use a vision model
    let has_image = file_context
        .as_ref()
        .map(|c| c.image_base64.is_some())
        .unwrap_or(false);

    if has_image {
        // Try to use a vision model for image analysis
        let vision_model = detect_ollama_vision_model().await;
        if let Some(vm) = vision_model {
            return chat_with_ollama_vision(vm, messages, file_context).await;
        }
        // No vision model available — fall through to text-only with metadata
        info!("No Ollama vision model available, falling back to text-only");
    }

    let ollama = Ollama::default();

    // Build the prompt from messages
    let mut prompt = String::new();

    // Add system context
    prompt.push_str("You are Copilot, an AI assistant integrated into the Wisp file explorer. You help users with file management, code analysis, and development tasks. Be helpful, thorough, and practical. Provide detailed, comprehensive responses with specific examples and step-by-step guidance when appropriate. Include code examples, best practices, and additional context that would be valuable to the user.\n\n");

    // Add file context if provided
    if let Some(context) = &file_context {
        prompt.push_str(&format!(
            "You are currently working with:\nFile: {}\nPath: {}\nType: {}\n",
            context.name, context.path, context.file_type
        ));

        if let Some(content) = &context.content {
            prompt.push_str(&format!("Content:\n{}\n\n", content));
        }
    }

    // Add conversation history
    for message in &messages {
        match message.role.as_str() {
            "user" => prompt.push_str(&format!("User: {}\n", message.content)),
            "assistant" => prompt.push_str(&format!("Assistant: {}\n", message.content)),
            "system" => prompt.push_str(&format!("System: {}\n", message.content)),
            _ => prompt.push_str(&format!("{}: {}\n", message.role, message.content)),
        }
    }

    prompt.push_str("\nAssistant: ");

    info!(
        "Sending prompt to Ollama: {}",
        &prompt[..prompt.len().min(200)]
    );

    let request = GenerationRequest::new(model.clone(), prompt);

    match ollama.generate(request).await {
        Ok(response) => {
            info!("AI response completed successfully");
            let mut result = response.response;

            // Clean up the response - remove any meta-commentary or thinking tags
            let original_response = result.clone();

            // Remove common thinking patterns (compiled once via lazy_static-style approach)
            use std::sync::OnceLock;
            static CLEANUP_REGEXES: OnceLock<Vec<regex::Regex>> = OnceLock::new();
            let regexes = CLEANUP_REGEXES.get_or_init(|| {
                [
                    r"<thinking>.*?</thinking>",
                    r"Let me think about this.*?\n",
                    r"I need to.*?\n",
                    r"First, I'll.*?\n",
                    r"Looking at this.*?\n",
                ]
                .iter()
                .filter_map(|p| regex::Regex::new(p).ok())
                .collect()
            });

            for re in regexes {
                result = re.replace_all(&result, "").to_string();
            }

            // If the result is empty after cleaning, return the original
            if result.trim().is_empty() {
                result = original_response;
            }

            Ok(result)
        }
        Err(e) => {
            warn!("Failed to get AI response: {}", e);
            Err(format!("Failed to get AI response from Ollama: {}. Make sure Ollama is running and the model '{}' is available.", e, model))
        }
    }
}

/// Chat with Ollama using a vision model when images are provided in context.
async fn chat_with_ollama_vision(
    vision_model: String,
    messages: Vec<ChatMessage>,
    file_context: Option<FileContext>,
) -> Result<String, String> {
    info!(
        "Using Ollama vision model '{}' for image analysis",
        vision_model
    );

    // Build prompt from messages
    let mut prompt = String::new();
    for message in &messages {
        match message.role.as_str() {
            "user" => prompt.push_str(&format!("User: {}\n", message.content)),
            "assistant" => prompt.push_str(&format!("Assistant: {}\n", message.content)),
            "system" => prompt.push_str(&format!("System: {}\n", message.content)),
            _ => prompt.push_str(&format!("{}: {}\n", message.role, message.content)),
        }
    }
    prompt.push_str("\nAssistant: ");

    // Collect image base64 data
    let images: Vec<String> = file_context
        .as_ref()
        .and_then(|ctx| ctx.image_base64.clone())
        .into_iter()
        .collect();

    if images.is_empty() {
        return Err("No image data available for vision model".to_string());
    }

    call_ollama_vision_async(&vision_model, &prompt, &images).await
}
