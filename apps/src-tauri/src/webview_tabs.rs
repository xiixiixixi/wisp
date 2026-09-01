//! Web tabs: render real web pages inside a pane by attaching a native
//! child webview to the main window (iframes can't load most sites:
//! X-Frame-Options). The React layer reserves layout space and streams its
//! bounding rect down; the OS webview is layered above the main content.

use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl, Window};

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

/// Create (or reveal + navigate) the child webview backing a web tab.
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
    let parsed: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {e}"))?;
    let label = webview_label(&window, &id);
    let rect = bounds(x, y, width, height);

    if let Some(webview) = find_webview(&window, &id) {
        let _ = webview.set_bounds(rect);
        let _ = webview.navigate(parsed);
        let _ = webview.show();
        return Ok(());
    }

    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed));
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| format!("Failed to create web tab: {e}"))?;
    Ok(())
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
pub async fn web_tab_visibility(
    window: Window,
    id: String,
    visible: bool,
) -> Result<(), String> {
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
