//! The app-owned macOS menu follows Wisp's language, not the system language.
//! Keep edit accelerators unclaimed: the webview owns file/text shortcuts.

#[cfg(target_os = "macos")]
#[path = "shelf_tray_drop.rs"]
mod tray_drop;

#[cfg(target_os = "macos")]
mod shelves {
    use crate::shelf::MenuSnapshot;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    };
    use tauri::menu::{
        CheckMenuItem, IconMenuItem, Menu, MenuBuilder, MenuItem, NativeIcon, Submenu,
        SubmenuBuilder,
    };

    pub(super) struct State {
        pub language: String,
        pub snapshot: MenuSnapshot,
        pub revision: u64,
    }
    pub(super) fn state() -> &'static Mutex<State> {
        static STATE: OnceLock<Mutex<State>> = OnceLock::new();
        STATE.get_or_init(|| {
            Mutex::new(State {
                language: "zh".into(),
                snapshot: MenuSnapshot::default(),
                revision: 0,
            })
        })
    }

    fn command(
        app: &tauri::AppHandle,
        id: &str,
        text: &str,
        enabled: bool,
        icon: NativeIcon,
    ) -> tauri::Result<IconMenuItem<tauri::Wry>> {
        IconMenuItem::with_id_and_native_icon(app, id, text, enabled, Some(icon), None::<&str>)
    }

    pub(super) fn menu(
        app: &tauri::AppHandle,
        english: bool,
        snapshot: &MenuSnapshot,
    ) -> tauri::Result<Menu<tauri::Wry>> {
        let label = |en, zh| if english { en } else { zh };
        let mut builder = MenuBuilder::new(app)
            .item(&command(
                app,
                "shelf-new",
                label("New Shelf", "新建收集架"),
                snapshot.supported,
                NativeIcon::Add,
            )?)
            .item(&command(
                app,
                "shelf-new-clipboard",
                label("New Shelf from Clipboard", "从剪贴板新建"),
                snapshot.supported,
                NativeIcon::MultipleDocuments,
            )?)
            .separator()
            .item(&command(
                app,
                "shelf-manager",
                label("Manage Shelves…", "管理收集架…"),
                true,
                NativeIcon::IconView,
            )?)
            .item(&command(
                app,
                "shelf-settings",
                label("Shelf Settings…", "收集架设置…"),
                true,
                NativeIcon::PreferencesGeneral,
            )?);
        // A1/#2：菜单分组「固定的 / 其他 / 收起的架子」；固定与其他只收可见架，
        // 收起的架子（✕ 收起）单独成组、点击重开，空组自动隐藏。
        let groups = crate::shelf::menu_groups(snapshot);
        for (title, entries) in [
            (label("Pinned Shelves", "固定的收集架"), groups.pinned),
            (label("Other Shelves", "其他收集架"), groups.other),
            (label("Collapsed Shelves", "收起的架子"), groups.collapsed),
        ] {
            if entries.is_empty() {
                continue;
            }
            let mut submenu = SubmenuBuilder::new(app, title);
            for entry in entries {
                let text = format!("{} ({})", entry.name, entry.count);
                let id = format!("shelf-show:{}", entry.id);
                submenu = submenu.item(&CheckMenuItem::with_id(
                    app,
                    id,
                    text,
                    snapshot.supported,
                    entry.visible,
                    None::<&str>,
                )?);
            }
            builder = builder.item(&submenu.build()?);
        }
        builder.build()
    }

    pub(super) fn submenu(
        app: &tauri::AppHandle,
        english: bool,
        snapshot: &MenuSnapshot,
    ) -> tauri::Result<Submenu<tauri::Wry>> {
        let submenu =
            SubmenuBuilder::new(app, if english { "Shelves" } else { "收集架" }).build()?;
        // AppKit menu items cannot belong to two menus; build separate instances.
        let source = menu(app, english, snapshot)?;
        for item in source.items()? {
            source.remove(&item)?;
            submenu.append(&item)?;
        }
        Ok(submenu)
    }

    pub(super) fn install_tray(
        app: &tauri::AppHandle,
        english: bool,
        snapshot: &MenuSnapshot,
    ) -> tauri::Result<()> {
        let label = |en, zh| if english { en } else { zh };
        let menu = menu(app, english, snapshot)?;
        menu.append(&tauri::menu::PredefinedMenuItem::separator(app)?)?;
        menu.append(&command(
            app,
            "shelf-open-wisp",
            label("Open Wisp", "打开 Wisp"),
            true,
            NativeIcon::Computer,
        )?)?;
        menu.append(&MenuItem::with_id(
            app,
            "shelf-quit-wisp",
            label("Quit Wisp", "退出 Wisp"),
            true,
            None::<&str>,
        )?)?;
        if let Some(tray) = app.tray_by_id("wisp-shelves") {
            tray.set_menu(Some(menu))?;
        } else {
            let tray = tauri::tray::TrayIconBuilder::with_id("wisp-shelves")
                .title("Wisp")
                .tooltip("Wisp")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .build(app)?;
            super::tray_drop::install(app, &tray)?;
        }
        Ok(())
    }

    pub(super) fn update(app: &tauri::AppHandle, value: &serde_json::Value) {
        static QUEUED: AtomicBool = AtomicBool::new(false);
        {
            let mut current = state().lock().unwrap_or_else(|e| e.into_inner());
            let revision = value
                .get("revision")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            if revision != 0 && revision < current.revision {
                return;
            }
            current.revision = current.revision.max(revision);
            let snapshot = MenuSnapshot::from_state(value);
            if current.snapshot == snapshot {
                return;
            }
            current.snapshot = snapshot;
        }
        if QUEUED.swap(true, Ordering::AcqRel) {
            return;
        }
        let handle = app.clone();
        if app
            .run_on_main_thread(move || {
                QUEUED.store(false, Ordering::Release);
                let language = state()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .language
                    .clone();
                if let Err(error) = super::install(&handle, &language) {
                    tracing::warn!("Shelf menu could not be refreshed: {error}");
                }
            })
            .is_err()
        {
            QUEUED.store(false, Ordering::Release);
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn update_shelves(app: &tauri::AppHandle, state: &serde_json::Value) {
    shelves::update(app, state);
}

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};

    let english = language == "en";
    let snapshot = {
        let mut state = shelves::state().lock().unwrap_or_else(|e| e.into_inner());
        state.language = language.to_string();
        state.snapshot.clone()
    };
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
        .item(&shelves::submenu(app, english, &snapshot)?)
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
    shelves::install_tray(app, english, &snapshot)?;
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
