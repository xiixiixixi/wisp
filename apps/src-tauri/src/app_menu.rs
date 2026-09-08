//! The app-owned macOS menu follows Wisp's language, not the system language.
//! Keep edit accelerators unclaimed: the webview owns file/text shortcuts.

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};

    let english = language == "en";
    let label = |en, zh| if english { en } else { zh };
    let settings = MenuItem::with_id(
        app,
        "open-settings",
        label("Settings…", "设置…"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let menu = MenuBuilder::new(app)
        .item(
            &SubmenuBuilder::new(app, "Wisp")
                .item(&PredefinedMenuItem::about(
                    app,
                    Some(label("About Wisp", "关于 Wisp")),
                    Some(AboutMetadata::default()),
                )?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::services(
                    app,
                    Some(label("Services", "服务")),
                )?)
                .item(&PredefinedMenuItem::hide(
                    app,
                    Some(label("Hide Wisp", "隐藏 Wisp")),
                )?)
                .item(&PredefinedMenuItem::hide_others(
                    app,
                    Some(label("Hide Others", "隐藏其他应用")),
                )?)
                .separator()
                .item(&PredefinedMenuItem::quit(
                    app,
                    Some(label("Quit Wisp", "退出 Wisp")),
                )?)
                .build()?,
        )
        .item(
            &SubmenuBuilder::new(app, label("View", "视图"))
                .item(&PredefinedMenuItem::fullscreen(
                    app,
                    Some(label("Toggle Full Screen", "切换全屏")),
                )?)
                .build()?,
        )
        .item(
            &SubmenuBuilder::new(app, label("Window", "窗口"))
                .item(&PredefinedMenuItem::minimize(
                    app,
                    Some(label("Minimize", "最小化")),
                )?)
                .item(&PredefinedMenuItem::maximize(
                    app,
                    Some(label("Zoom", "缩放")),
                )?)
                .build()?,
        )
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

#[tauri::command]
pub fn set_app_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if language != "zh" && language != "en" {
        return Err("Unsupported app language".into());
    }
    #[cfg(target_os = "macos")]
    install(&app, &language).map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}
