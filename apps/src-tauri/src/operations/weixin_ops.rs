//! 微信桥底座：iLink HTTP 代理（仅 *.weixin.qq.com）+ 凭据/状态存取。
//!
//! 协议逻辑在前端 lib/weixin/ilink.ts（移植自 dsh-weixin-clawbot，MIT）；
//! Rust 只提供 WKWebView 做不了的两件事——跨域 HTTP 与本机凭据落盘。
//! 凭据含 bot token，文件权限 600，存 app_data_dir。
use serde_json::Value;
use std::time::Duration;
use tauri::command;
use tauri::AppHandle;
use tauri::Manager;

const STATE_FILE: &str = "weixin-bridge-state.json";
const CRED_FILE: &str = "weixin-bridge-ilink.json";

fn state_path(app: &AppHandle, file: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    Ok(dir.join(file))
}

fn write_private(path: &std::path::PathBuf, raw: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, raw).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// 状态读写（颗粒度/文件夹范围/白名单等，非敏感）。
#[command]
pub async fn weixin_state_get(app: AppHandle) -> Result<Value, String> {
    let path = state_path(&app, STATE_FILE)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        _ => Ok(Value::Null),
    }
}

#[command]
pub async fn weixin_state_set(app: AppHandle, state: Value) -> Result<(), String> {
    let path = state_path(&app, STATE_FILE)?;
    let raw = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    write_private(&path, &raw)
}

/// iLink 凭据读取（自动登录用）。
#[command]
pub async fn weixin_creds_get(app: AppHandle) -> Result<Value, String> {
    let path = state_path(&app, CRED_FILE)?;
    match std::fs::read_to_string(&path) {
        Ok(raw) if !raw.trim().is_empty() => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        _ => Ok(Value::Null),
    }
}

#[command]
pub async fn weixin_creds_set(app: AppHandle, creds: Value) -> Result<(), String> {
    let path = state_path(&app, CRED_FILE)?;
    let raw = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
    write_private(&path, &raw)
}

#[command]
pub async fn weixin_creds_clear(app: AppHandle) -> Result<(), String> {
    let path = state_path(&app, CRED_FILE)?;
    let _ = std::fs::remove_file(&path);
    Ok(())
}

/// 前端桥日志直通开发日志（面板里看不到原因时，dev log 里有全链路）。
#[command]
pub async fn weixin_log(line: String) {
    eprintln!("[weixin-bridge] {line}");
}

/// iLink HTTP 代理：只放行 *.weixin.qq.com（防任意内网请求）。
/// headers/body 由前端按协议拼好；长轮询超时上限 90s。
#[command]
pub async fn weixin_http(
    url: String,
    method: String,
    headers: Value,
    body: Value,
) -> Result<Value, String> {
    let host = extract_host(&url).ok_or_else(|| format!("bad url: {url}"))?;
    let is_weixin = host == "weixin.qq.com" || host.ends_with(".weixin.qq.com");
    if !is_weixin {
        return Err(format!("host not allowed: {host} (仅 *.weixin.qq.com)"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        _ => client.post(&url),
    };
    if let Some(map) = headers.as_object() {
        for (k, v) in map {
            if let Some(vs) = v.as_str() {
                req = req.header(k, vs);
            }
        }
    }
    if let Some(body_obj) = body.as_object() {
        req = req.json(&Value::Object(body_obj.clone()));
    } else if !body.is_null() {
        req = req.body(body.to_string());
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[weixin] http {method} {url} 失败: {e}");
            return Err(format!("http: {e}"));
        }
    };
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("read body: {e}"))?;
    let json: Value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text.clone()))
    };
    Ok(serde_json::json!({ "status": status, "body": json }))
}

/// 手写 host 提取（不引 url crate）：去协议 → 取第一个 / 或 : 之前。
fn extract_host(raw: &str) -> Option<String> {
    let rest = raw
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(raw);
    let end = rest.find(['/', ':']).unwrap_or(rest.len());
    let host = &rest[..end];
    if host.is_empty() { None } else { Some(host.to_lowercase()) }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// 真网测试：走 weixin_http 全链路拿配对二维码（cargo test live_weixin -- --ignored）
    #[tokio::test]
    #[ignore]
    async fn live_weixin_http_qrcode() {
        let headers = serde_json::json!({
            "content-type": "application/json",
            "iLink-App-Id": "bot",
            "iLink-App-ClientVersion": "65536",
            "AuthorizationType": "ilink_bot_token",
            "X-WECHAT-UIN": "dGVzdA=="
        });
        let r = weixin_http(
            "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3".into(),
            "POST".into(),
            headers,
            serde_json::json!({"local_token_list": []}),
        )
        .await
        .expect("weixin_http call");
        assert!(
            r["body"]["qrcode"].is_string(),
            "unexpected body: {r}"
        );
    }
}

