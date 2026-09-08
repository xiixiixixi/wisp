//! Web tabs: render real web pages inside a pane by attaching a native
//! child webview to the main window (iframes can't load most sites:
//! X-Frame-Options). The React layer reserves layout space and streams its
//! bounding rect down; the OS webview is layered above the main content.

use tauri::webview::{PageLoadEvent, WebviewBuilder};
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
    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed))
        .on_navigation(|url| matches!(url.scheme(), "http" | "https"))
        .on_page_load(move |_webview, payload| {
            // Only the trusted parent consumes loading state; no IPC permissions
            // or injected bridge are granted to external website content.
            let _ = parent.emit_to(
                EventTarget::webview(parent.label()),
                "web-tab-load",
                WebTabLoad {
                    id: id.clone(),
                    loading: matches!(payload.event(), PageLoadEvent::Started),
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
}
