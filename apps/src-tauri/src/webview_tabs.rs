//! Web tabs: render real web pages inside a pane by attaching a native
//! child webview to the main window (iframes can't load most sites:
//! X-Frame-Options). The React layer reserves layout space and streams its
//! bounding rect down; the OS webview is layered above the main content.

use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    Emitter, EventTarget, LogicalPosition, LogicalSize, Rect, Webview, WebviewUrl, Window,
};

fn parse_web_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Web tabs only support HTTP and HTTPS addresses".into());
    }
    Ok(parsed)
}

#[derive(Clone, serde::Serialize)]
struct WebTabLoad {
    id: String,
    loading: bool,
    error: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebTabState {
    url: String,
    loading: Option<bool>,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryDirection {
    Back,
    Forward,
}

fn webview_label(window: &Window, id: &str) -> String {
    format!("{}::webtab-{id}", window.label())
}

fn find_webview(window: &Window, id: &str) -> Option<Webview> {
    let label = webview_label(window, id);
    window.webviews().into_iter().find(|w| w.label() == label)
}

fn bounds(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(width, height).into(),
    }
}

/// Create the child webview backing a web tab. Revealing it never reloads it.
#[tauri::command]
pub async fn web_tab_create(
    window: Window,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = parse_web_url(&url)?;
    let label = webview_label(&window, &id);
    let rect = bounds(x, y, width, height);

    if let Some(webview) = find_webview(&window, &id) {
        webview.set_bounds(rect).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parent = window.clone();
    let popup_parent = window.clone();
    let popup_id = id.clone();
    tracing::debug!(tab = %id, host = ?parsed.host_str(), "web tab create");
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed))
        .on_navigation(|url| matches!(url.scheme(), "http" | "https"))
        .on_new_window(move |url, _features| {
            // Search results often use target=_blank/window.open. Wisp owns the
            // navigation: reuse the current tab and its real browser history,
            // never create an unmanaged OS popup or grant remote content IPC.
            if parse_web_url(url.as_str()).is_ok() {
                let parent = popup_parent.clone();
                let id = popup_id.clone();
                tauri::async_runtime::spawn(async move {
                    let Some(webview) = find_webview(&parent, &id) else {
                        return;
                    };
                    tracing::debug!(tab = %id, host = ?url.host_str(), "web tab popup navigation");
                    if let Err(error) = webview.navigate(url) {
                        tracing::warn!(tab = %id, %error, "web tab popup failed");
                        let _ = parent.emit_to(
                            EventTarget::webview(parent.label()),
                            "web-tab-load",
                            WebTabLoad {
                                id,
                                loading: false,
                                error: true,
                            },
                        );
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_webview, payload| {
            // Only the trusted parent consumes loading state; no IPC permissions
            // or injected bridge are granted to external website content.
            let _ = parent.emit_to(
                EventTarget::webview(parent.label()),
                "web-tab-load",
                WebTabLoad {
                    id: id.clone(),
                    loading: matches!(payload.event(), PageLoadEvent::Started),
                    error: false,
                },
            );
        });
    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create web tab: {e}"))?;
    Ok(())
}

/// Navigate within an existing webview, preserving its browser session.
#[tauri::command]
pub async fn web_tab_navigate(window: Window, id: String, url: String) -> Result<(), String> {
    let parsed = parse_web_url(&url)?;
    let webview = find_webview(&window, &id).ok_or("Web tab is not available")?;
    webview.navigate(parsed).map_err(|e| e.to_string())
}

/// Refresh the actual page, including any navigation performed inside the website.
#[tauri::command]
pub async fn web_tab_reload(window: Window, id: String) -> Result<(), String> {
    let webview = find_webview(&window, &id).ok_or("Web tab is not available")?;
    webview.reload().map_err(|e| e.to_string())
}

/// Read the native browser's state without navigating it or injecting scripts.
/// Poll only visible tabs; this also catches redirects and same-document changes.
#[tauri::command]
pub async fn web_tab_state(window: Window, id: String) -> Result<WebTabState, String> {
    let webview = find_webview(&window, &id).ok_or("Web tab is not available")?;
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_foundation::NSString;
        let (tx, rx) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |platform| unsafe {
                let view = platform.inner().cast::<AnyObject>();
                let url: *mut AnyObject = msg_send![view, URL];
                let url = if url.is_null() {
                    String::new()
                } else {
                    let value: *mut NSString = msg_send![url, absoluteString];
                    if value.is_null() {
                        String::new()
                    } else {
                        (*value).to_string()
                    }
                };
                let loading: bool = msg_send![view, isLoading];
                let can_go_back: bool = msg_send![view, canGoBack];
                let can_go_forward: bool = msg_send![view, canGoForward];
                let _ = tx.send(WebTabState {
                    url,
                    loading: Some(loading),
                    can_go_back,
                    can_go_forward,
                });
            })
            .map_err(|error| error.to_string())?;
        rx.await.map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(WebTabState {
            url: webview
                .url()
                .map_err(|error| error.to_string())?
                .to_string(),
            loading: None,
            can_go_back: false,
            can_go_forward: false,
        })
    }
}

#[tauri::command]
pub async fn web_tab_history(
    window: Window,
    id: String,
    direction: HistoryDirection,
) -> Result<(), String> {
    let webview = find_webview(&window, &id).ok_or("Web tab is not available")?;
    // Static browser navigation only; never interpolate webpage/user data into JS.
    webview
        .eval(match direction {
            HistoryDirection::Back => "window.history.back()",
            HistoryDirection::Forward => "window.history.forward()",
        })
        .map_err(|error| error.to_string())
}

/// Keep the child webview glued to the pane's layout rect.
#[tauri::command]
pub async fn web_tab_bounds(
    window: Window,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(webview) = find_webview(&window, &id) else {
        return Ok(());
    };
    webview
        .set_bounds(bounds(x, y, width, height))
        .map_err(|e| e.to_string())
}

/// Show/hide without tearing down browsing state (used on tab switches).
#[tauri::command]
pub async fn web_tab_visibility(window: Window, id: String, visible: bool) -> Result<(), String> {
    let Some(webview) = find_webview(&window, &id) else {
        return Ok(());
    };
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|e| e.to_string())
}

/// Tear the child webview down (tab closed / url left).
#[tauri::command]
pub async fn web_tab_destroy(window: Window, id: String) -> Result<(), String> {
    let Some(webview) = find_webview(&window, &id) else {
        return Ok(());
    };
    webview.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_tabs_only_accept_web_urls() {
        for url in [
            "https://baidu.com/",
            "http://localhost:5190/test",
            "https://example.com/a?q=b",
        ] {
            assert!(parse_web_url(url).is_ok());
        }
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,test",
            "tauri://localhost",
            "not a url",
        ] {
            assert!(parse_web_url(url).is_err());
        }
    }

    #[test]
    fn history_actions_are_not_arbitrary_scripts() {
        for direction in ["back", "forward"] {
            assert!(
                serde_json::from_value::<HistoryDirection>(serde_json::json!(direction)).is_ok()
            );
        }
        for direction in ["reload", "back();alert(1)", "javascript:alert(1)"] {
            assert!(
                serde_json::from_value::<HistoryDirection>(serde_json::json!(direction)).is_err()
            );
        }
    }
}
