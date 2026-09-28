//! MCP 客户端 —— 连接外部 MCP 服务器（stdio / streamable-http）。
//!
//! 注意方向：src/mcp_host.rs 是把 Wisp 能力「暴露给」外部 AI 的服务端；
//! 本模块相反，是 Wisp 内嵌 pi agent 「消费」外部服务器的客户端。
//!
//! 配置：`~/.pi/agent/mcp.json`，与 Claude Desktop 同款格式：
//! ```json
//! { "mcpServers": {
//!     "本地服务": { "command": "npx", "args": ["-y", "some-server"] },
//!     "远程服务": { "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }
//! } }
//! ```
//! 协议层手写（JSON-RPC 2.0），不引第三方 MCP crate。stdio 子进程
//! `kill_on_drop` 跟随应用生命周期；单服务器请求串行（锁内排队）。
use dirs::home_dir;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::command;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

const INIT_TIMEOUT: Duration = Duration::from_secs(25);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const PROTOCOL_VERSION: &str = "2024-11-05";

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    /// 设置页开关；缺省视为启用。
    #[serde(default)]
    pub enabled: Option<bool>,
}

impl McpServerConfig {
    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct McpFile {
    #[serde(default)]
    mcp_servers: HashMap<String, McpServerConfig>,
}

fn config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".pi/agent/mcp.json"))
}

fn load_config() -> Result<HashMap<String, McpServerConfig>, String> {
    let Some(path) = config_path() else {
        return Err("home directory unavailable".into());
    };
    // pi 生态惯例：配置目录渐进式出现——文件不存在 = 还没配置 = 空清单，
    // 不是错误（只在文件存在但内容坏了时才报 parse 错）。
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };
    if raw.trim().is_empty() {
        return Ok(HashMap::new());
    }
    let parsed: McpFile = serde_json::from_str(&raw).map_err(|e| format!("parse mcp.json: {e}"))?;
    Ok(parsed.mcp_servers)
}

// ── stdio 传输 ───────────────────────────────────────────────────────────────

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

struct StdioTransport {
    stdin: ChildStdin,
    pending: PendingMap,
    next_id: u64,
}

impl StdioTransport {
    async fn spawn(cfg: &McpServerConfig) -> Result<(Self, Child), String> {
        let command = cfg.command.clone().ok_or("stdio server missing \"command\"")?;
        let mut cmd = Command::new(&command);
        cmd.args(cfg.args.iter().flatten())
            .envs(cfg.env.iter().flatten())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("spawn {command}: {e}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "child stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "child stdout unavailable".to_string())?;

        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(id) = value.get("id").and_then(|i| i.as_u64()) else {
                    continue;
                };
                if let Some(tx) = reader_pending.lock().await.remove(&id) {
                    let _ = tx.send(value);
                }
            }
            // 进程退出：清空挂起请求，接收端拿到 Err 即报"连接关闭"
            reader_pending.lock().await.clear();
        });

        Ok((
            StdioTransport {
                stdin,
                pending,
                next_id: 0,
            },
            child,
        ))
    }

    async fn write_msg(&mut self, value: &Value) -> Result<(), String> {
        let line = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("write stdin: {e}"))?;
        self.stdin
            .write_all(b"\n")
            .await
            .map_err(|e| format!("write stdin: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("flush stdin: {e}"))
    }

    async fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.write_msg(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(value)) => {
                if let Some(err) = value.get("error") {
                    return Err(format!("MCP error: {err}"));
                }
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => Err("server closed the connection".into()),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(format!("timeout after {}s: {method}", timeout.as_secs()))
            }
        }
    }

    /// 通知（无 id，不等待响应），如 initialize 握手的 initialized。
    async fn notify(&mut self, method: &str) -> Result<(), String> {
        self.write_msg(&json!({"jsonrpc":"2.0","method":method})).await
    }
}

// ── streamable-http 传输 ─────────────────────────────────────────────────────

struct HttpTransport {
    url: String,
    headers: HashMap<String, String>,
    session: Option<String>,
    client: reqwest::Client,
}

impl HttpTransport {
    async fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let body = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
        let mut req = self
            .client
            .post(&self.url)
            .json(&body)
            .header("Accept", "application/json, text/event-stream");
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }
        if let Some(session) = &self.session {
            req = req.header("Mcp-Session-Id", session);
        }
        let resp = tokio::time::timeout(timeout, req.send())
            .await
            .map_err(|_| format!("timeout: {method}"))?
            .map_err(|e| format!("http {method}: {e}"))?;
        if self.session.is_none() {
            if let Some(s) = resp
                .headers()
                .get("mcp-session-id")
                .and_then(|v| v.to_str().ok())
            {
                self.session = Some(s.to_string());
            }
        }
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let text = resp.text().await.map_err(|e| format!("read body: {e}"))?;
        // SSE 响应：逐行找带 JSON 的 data: 帧；普通响应：整段 JSON。
        let value = if content_type.contains("event-stream") {
            text.lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .find_map(|d| serde_json::from_str::<Value>(d.trim()).ok())
                .ok_or("no JSON data frame in SSE response")?
        } else {
            serde_json::from_str::<Value>(&text).map_err(|e| format!("bad JSON body: {e}"))?
        };
        if let Some(err) = value.get("error") {
            return Err(format!("MCP error: {err}"));
        }
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify(&mut self, method: &str) -> Result<(), String> {
        let body = json!({"jsonrpc":"2.0","method":method});
        let mut req = self.client.post(&self.url).json(&body);
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }
        if let Some(session) = &self.session {
            req = req.header("Mcp-Session-Id", session);
        }
        let _ = tokio::time::timeout(LIST_TIMEOUT, req.send()).await;
        Ok(())
    }
}

// ── 服务器池 ─────────────────────────────────────────────────────────────────

enum Transport {
    Stdio(StdioTransport, Child),
    Http(HttpTransport),
}

struct McpServer {
    transport: Transport,
    initialized: bool,
}

impl McpServer {
    async fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        match &mut self.transport {
            Transport::Stdio(t, _) => t.request(method, params, timeout).await,
            Transport::Http(t) => t.request(method, params, timeout).await,
        }
    }

    async fn notify_initialized(&mut self) -> Result<(), String> {
        match &mut self.transport {
            Transport::Stdio(t, _) => t.notify("notifications/initialized").await,
            Transport::Http(t) => t.notify("notifications/initialized").await,
        }
    }
}

struct McpState {
    servers: HashMap<String, McpServer>,
}

static MCP: OnceLock<Mutex<McpState>> = OnceLock::new();

fn state() -> &'static Mutex<McpState> {
    MCP.get_or_init(|| Mutex::new(McpState { servers: HashMap::new() }))
}

/// 启动（或复用）服务器并完成 initialize 握手。
async fn ensure_server(name: &str, cfg: &McpServerConfig) -> Result<(), String> {
    let mut st = state().lock().await;
    if !st.servers.contains_key(name) {
        let transport = if let Some(url) = &cfg.url {
            Transport::Http(HttpTransport {
                url: url.clone(),
                headers: cfg.headers.clone().unwrap_or_default(),
                session: None,
                client: reqwest::Client::new(),
            })
        } else {
            let (t, child) = StdioTransport::spawn(cfg).await?;
            Transport::Stdio(t, child)
        };
        st.servers.insert(name.to_string(), McpServer { transport, initialized: false });
    }
    let server = st.servers.get_mut(name).expect("just inserted");
    if !server.initialized {
        let init = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "wisp", "version": "0.99.34"},
        });
        server.request("initialize", init, INIT_TIMEOUT).await?;
        server.notify_initialized().await?;
        server.initialized = true;
    }
    Ok(())
}

// ── Tauri 命令 ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// 已配置的服务器名（不启动进程）。
#[command]
pub async fn mcp_client_servers() -> Result<Vec<String>, String> {
    Ok(load_config()?.keys().cloned().collect())
}

/// 拉起全部已配置服务器并列出工具。单服务器失败不影响其余（跳过+日志）。
#[command]
pub async fn mcp_client_list_tools() -> Result<Vec<McpToolInfo>, String> {
    let configs = load_config()?;
    if configs.is_empty() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for (server_name, cfg) in &configs {
        if !cfg.is_enabled() {
            continue;
        }
        match ensure_and_list(server_name, cfg).await {
            Ok(mut tools) => out.append(&mut tools),
            Err(e) => eprintln!("[mcp] skip server {server_name}: {e}"),
        }
    }
    Ok(out)
}

async fn ensure_and_list(name: &str, cfg: &McpServerConfig) -> Result<Vec<McpToolInfo>, String> {
    ensure_server(name, cfg).await?;
    let result = state()
        .lock()
        .await
        .servers
        .get_mut(name)
        .expect("server ensured")
        .request("tools/list", json!({}), LIST_TIMEOUT)
        .await?;
    let tools = result
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(tools
        .iter()
        .filter_map(|t| {
            let tool_name = t.get("name")?.as_str()?.to_string();
            Some(McpToolInfo {
                server: name.to_string(),
                name: tool_name,
                description: t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
                input_schema: t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(json!({"type":"object","properties":{}})),
            })
        })
        .collect())
}

/// 调用某服务器的工具，返回 MCP result（content/isError 由前端解读）。
#[command]
pub async fn mcp_client_call_tool(
    server: String,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    let configs = load_config()?;
    let cfg = configs
        .get(&server)
        .ok_or_else(|| format!("unknown MCP server: {server}"))?
        .clone();
    ensure_server(&server, &cfg).await?;
    state()
        .lock()
        .await
        .servers
        .get_mut(&server)
        .expect("server ensured")
        .request(
            "tools/call",
            json!({"name": tool, "arguments": arguments}),
            CALL_TIMEOUT,
        )
        .await
}

/// 设置页用：读全量配置（含禁用项；密钥原样返回——本机文件本就含密钥）。
#[command]
pub async fn mcp_config_get() -> Result<Value, String> {
    let configs = load_config()?;
    let mut out = serde_json::Map::new();
    for (name, cfg) in &configs {
        out.insert(
            name.clone(),
            json!({
                "type": cfg.r#type.clone().unwrap_or_else(|| if cfg.url.is_some() { "http".into() } else { "stdio".into() }),
                "command": cfg.command,
                "args": cfg.args,
                "env": cfg.env,
                "url": cfg.url,
                "headers": cfg.headers,
                "enabled": cfg.is_enabled(),
            }),
        );
    }
    Ok(Value::Object(out))
}

/// 设置页用：整份写回 ~/.pi/agent/mcp.json，并重置已拉起的服务器进程。
#[command]
pub async fn mcp_config_set(config: Value) -> Result<(), String> {
    let Some(path) = config_path() else {
        return Err("home directory unavailable".into());
    };
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    // 配置已变：旧进程/会话全部作废，下次使用时按新配置重启
    state().lock().await.servers.clear();
    Ok(())
}

/// 设置页用：测单个服务器连通性，返回工具数与名字样例。
#[command]
pub async fn mcp_test_server(server: String) -> Result<Value, String> {
    let configs = load_config()?;
    let cfg = configs
        .get(&server)
        .ok_or_else(|| format!("unknown MCP server: {server}"))?
        .clone();
    match ensure_and_list(&server, &cfg).await {
        Ok(tools) => {
            let names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
            Ok(json!({"ok": true, "toolCount": names.len(), "tools": names}))
        }
        Err(e) => Ok(json!({"ok": false, "error": e})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_returns_empty_not_error() {
        // pi 生态渐进式配置：文件不存在 = 空清单（新机器首开不报错）
        let path = config_path().expect("home");
        let moved = path.with_extension("json.bak");
        let _ = std::fs::rename(&path, &moved);
        let result = load_config();
        if moved.exists() {
            let _ = std::fs::rename(&moved, &path);
        }
        assert!(result.map(|m| m.is_empty()).unwrap_or(false));
    }

    #[test]
    fn parse_config_camel_and_snake() {
        let raw = r#"{"mcpServers":{"local":{"command":"npx","args":["-y","x"],"env":{"A":"1"}},"remote":{"url":"https://e/mcp","headers":{"Authorization":"Bearer t"}}}}"#;
        let parsed: McpFile = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.mcp_servers.len(), 2);
        assert_eq!(parsed.mcp_servers["local"].command.as_deref(), Some("npx"));
        assert!(parsed.mcp_servers["remote"].url.is_some());
    }

    #[test]
    fn disabled_servers_parse_and_flag() {
        let raw = r#"{"mcpServers":{"off":{"command":"x","enabled":false},"on":{"command":"y"}}}"#;
        let parsed: McpFile = serde_json::from_str(raw).unwrap();
        assert!(!parsed.mcp_servers["off"].is_enabled());
        assert!(parsed.mcp_servers["on"].is_enabled());
    }

    #[test]
    fn empty_file_is_empty_map() {
        let parsed: McpFile = serde_json::from_str("{}").unwrap();
        assert!(parsed.mcp_servers.is_empty());
    }

    /// 真网 live 测试：对 ~/.pi/agent/mcp.json 里的 web-reader 做
    /// initialize → tools/list（cargo test live_mcp -- --ignored 手动跑）。
    #[tokio::test]
    #[ignore]
    async fn live_mcp_web_reader_tools_list() {
        let configs = load_config().expect("mcp.json readable");
        let cfg = configs
            .get("web-reader")
            .expect("web-reader configured")
            .clone();
        let tools = ensure_and_list("web-reader", &cfg)
            .await
            .expect("handshake + tools/list");
        assert!(!tools.is_empty(), "web-reader should expose tools");
    }
}
