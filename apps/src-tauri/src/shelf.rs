//! Private, single-writer bridge to Wisp's native floating shelf component.
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

fn unavailable(error: Option<String>) -> Value {
    json!({"supported": false, "shelves": [],
        "cloudHistory": [], "error": error})
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct MenuShelf {
    pub id: String,
    pub name: String,
    pub count: usize,
    pub pinned: bool,
    pub visible: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MenuSnapshot {
    pub supported: bool,
    pub active: Vec<MenuShelf>,
}

/// #2：托盘/应用菜单的架子分组。「固定的 / 其他」只收可见架；
/// 收起的架子（visible=false）单独成组，点击即重新显示。空组由调用方隐藏。
pub(crate) struct MenuGroups {
    pub pinned: Vec<MenuShelf>,
    pub other: Vec<MenuShelf>,
    pub collapsed: Vec<MenuShelf>,
}

pub(crate) fn menu_groups(snapshot: &MenuSnapshot) -> MenuGroups {
    MenuGroups {
        pinned: snapshot
            .active
            .iter()
            .filter(|shelf| shelf.pinned && shelf.visible)
            .cloned()
            .collect(),
        other: snapshot
            .active
            .iter()
            .filter(|shelf| !shelf.pinned && shelf.visible)
            .rev()
            .take(8)
            .cloned()
            .collect(),
        collapsed: snapshot
            .active
            .iter()
            .filter(|shelf| !shelf.visible)
            .rev()
            .take(8)
            .cloned()
            .collect(),
    }
}

impl Default for MenuSnapshot {
    fn default() -> Self {
        Self {
            supported: true,
            active: Vec::new(),
        }
    }
}

impl MenuSnapshot {
    pub(crate) fn from_state(state: &Value) -> Self {
        // A1：recentlyClosed 已废除，快照只读 shelves；visible 是收起语义的勾选真源。
        // 旧字段/缺字段一律宽容缺省，不因引擎版本差异丢整组菜单。
        let entries = state
            .get("shelves")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?.to_string();
                let name = entry
                    .get("name")?
                    .as_str()?
                    .chars()
                    .map(|c| if c.is_control() { ' ' } else { c })
                    .take(64)
                    .collect();
                Some(MenuShelf {
                    id,
                    name,
                    count: entry
                        .get("items")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len),
                    pinned: entry
                        .get("pinned")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    visible: entry
                        .get("visible")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                })
            })
            .collect();
        Self {
            supported: state.get("supported").and_then(Value::as_bool) == Some(true),
            active: entries,
        }
    }
}

fn menu_request(id: &str) -> Option<Value> {
    match id {
        "shelf-new" => Some(json!({"action": "create"})),
        "shelf-new-clipboard" => Some(json!({"action": "clipboard", "forceNew": true})),
        _ => [("shelf-show:", "show")]
            .into_iter()
            .find_map(|(prefix, action)| {
                id.strip_prefix(prefix)
                    .filter(|value| !value.is_empty() && !value.contains(':'))
                    .map(|value| json!({"action": action, "shelfId": value}))
            }),
    }
}

pub(crate) fn tray_file_paths(urls: &[String]) -> Result<Vec<String>, String> {
    if urls.is_empty() || urls.len() > 256 {
        return Err("请一次拖入 1 到 256 个文件或文件夹。".into());
    }
    urls.iter()
        .map(|raw| {
            let url = tauri::Url::parse(raw).map_err(|_| "文件地址无效。")?;
            if url.scheme() != "file"
                || url.query().is_some()
                || url.fragment().is_some()
                || !matches!(url.host_str(), None | Some("") | Some("localhost"))
            {
                return Err("菜单栏暂时只接受本机文件和文件夹。".into());
            }
            let path = url.to_file_path().map_err(|_| "无法读取文件地址。")?;
            Ok(path.to_string_lossy().into_owned())
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RevealNavigation {
    target: &'static str,
    directory: String,
    paths: Vec<String>,
    omitted_count: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
enum ShelfNavigation {
    Page(String),
    Reveal(RevealNavigation),
}

fn airdrop_paths(message: &Value) -> Result<Vec<String>, crate::airdrop::AirDropError> {
    use std::collections::HashSet;
    use std::path::{Component, Path, PathBuf};

    let invalid = |message: &str| crate::airdrop::AirDropError {
        code: "invalid_paths",
        message: message.into(),
    };
    let paths = message
        .get("paths")
        .and_then(Value::as_array)
        .filter(|paths| !paths.is_empty() && paths.len() <= 256)
        .ok_or_else(|| invalid("请一次选择 1 到 256 个文件或文件夹。"))?;
    let mut total_bytes = 0;
    let mut unique = HashSet::new();
    let mut checked = Vec::new();
    for value in paths {
        let raw = value.as_str().ok_or_else(|| invalid("文件路径无效。"))?;
        total_bytes += raw.len();
        let path = Path::new(raw);
        if raw.len() > 4096
            || total_bytes > 64 * 1024
            || raw.contains('\0')
            || !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(invalid("只接受长度受限的本机绝对文件路径。"));
        }
        let path: PathBuf = path.components().collect();
        let metadata = std::fs::metadata(&path)
            .map_err(|_| invalid("有文件已移动或无法访问，请重新选择。"))?;
        if metadata.is_file() {
            std::fs::File::open(&path).map_err(|_| invalid("有文件无法读取，请重新选择。"))?;
        } else if metadata.is_dir() {
            std::fs::read_dir(&path).map_err(|_| invalid("有文件夹无法读取，请重新选择。"))?;
        } else {
            return Err(invalid("只接受普通文件和文件夹。"));
        }
        let path = path
            .to_str()
            .ok_or_else(|| invalid("文件路径无效。"))?
            .to_owned();
        if unique.insert(path.clone()) {
            checked.push(path);
        }
    }
    Ok(checked)
}

fn navigation_message(message: &Value) -> Result<Option<ShelfNavigation>, String> {
    match message.get("target").and_then(Value::as_str) {
        Some(target @ ("settings" | "shelves")) => Ok(Some(ShelfNavigation::Page(target.into()))),
        Some("reveal") => {
            reveal_navigation(message).map(|target| Some(ShelfNavigation::Reveal(target)))
        }
        _ => Ok(None),
    }
}

fn reveal_navigation(message: &Value) -> Result<RevealNavigation, String> {
    use std::collections::HashSet;
    use std::path::{Component, Path, PathBuf};

    let paths = message
        .get("paths")
        .and_then(Value::as_array)
        .ok_or("文件列表无效。")?;
    if paths.is_empty() || paths.len() > 256 {
        return Err("请一次显示 1 到 256 个文件或文件夹。".into());
    }
    let bytes = paths
        .iter()
        .filter_map(Value::as_str)
        .map(str::len)
        .sum::<usize>();
    if bytes > 256 * 1024
        || paths
            .iter()
            .filter_map(Value::as_str)
            .any(|path| path.len() > 4096)
    {
        return Err("文件路径过长，无法显示。".into());
    }

    let mut directory = None;
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    let mut omitted_count = 0;
    for raw in paths {
        let checked = raw.as_str().and_then(|raw| {
            let path = Path::new(raw);
            if raw.contains('\0')
                || !path.is_absolute()
                || path
                    .components()
                    .any(|part| matches!(part, Component::ParentDir))
            {
                return None;
            }
            // Keep symbolic links at their source location, rather than revealing their targets.
            let path: PathBuf = path.components().collect();
            let parent = path.parent()?;
            if path.file_name().is_none() || !path.exists() || !parent.is_dir() {
                return None;
            }
            Some((path.to_str()?.to_owned(), parent.to_str()?.to_owned()))
        });
        let Some((path, parent)) = checked else {
            omitted_count += 1;
            continue;
        };
        if !seen.insert(path.clone()) {
            continue;
        }
        let first_directory = directory.get_or_insert_with(|| parent.clone());
        if *first_directory == parent {
            selected.push(path);
        } else {
            omitted_count += 1;
        }
    }
    let directory = directory.ok_or("文件已移动或不存在，无法在 Wisp 中显示。")?;
    Ok(RevealNavigation {
        target: "reveal",
        directory,
        paths: selected,
        omitted_count,
    })
}

#[derive(Default)]
struct NavigationState {
    ready: bool,
    pending: Option<ShelfNavigation>,
}

impl NavigationState {
    fn loading(&mut self) {
        self.ready = false;
    }
    fn navigate(&mut self, target: ShelfNavigation) -> Option<ShelfNavigation> {
        if self.ready {
            Some(target)
        } else {
            self.pending = Some(target);
            None
        }
    }
    fn ready(&mut self) -> Option<ShelfNavigation> {
        self.ready = true;
        self.pending.take()
    }
}

#[cfg(target_os = "macos")]
fn navigation() -> &'static std::sync::Mutex<NavigationState> {
    static STATE: std::sync::OnceLock<std::sync::Mutex<NavigationState>> =
        std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(NavigationState::default()))
}

#[cfg(target_os = "macos")]
pub fn frontend_loading() {
    navigation()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .loading();
}

#[cfg(target_os = "macos")]
pub fn frontend_ready(app: &AppHandle) {
    use tauri::Emitter;
    let pending = navigation()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .ready();
    if let Some(target) = pending {
        let _ = app.emit("shelf-navigate", target);
    }
}

#[cfg(target_os = "macos")]
fn show_main(app: &AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn navigate(app: &AppHandle, target: ShelfNavigation) {
    use tauri::Emitter;
    show_main(app);
    let target = navigation()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .navigate(target);
    if let Some(target) = target {
        let _ = app.emit("shelf-navigate", target);
    }
}

#[cfg(target_os = "macos")]
fn open_shelf_airdrop(app: &AppHandle, message: Value) {
    use tauri::{Emitter, Manager};
    show_main(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let paths = tauri::async_runtime::spawn_blocking(move || airdrop_paths(&message)).await;
        let result = match paths {
            Ok(Ok(paths)) => match app.get_webview_window("main") {
                Some(window) => crate::airdrop::open_airdrop(window, paths).await,
                None => Err(crate::airdrop::AirDropError {
                    code: "launch_failed",
                    message: "Wisp 主窗口不可用。".into(),
                }),
            },
            Ok(Err(error)) => Err(error),
            Err(error) => Err(crate::airdrop::AirDropError {
                code: "launch_failed",
                message: error.to_string(),
            }),
        };
        if let Err(error) = result {
            let _ = app.emit("shelf-airdrop-failed", json!(error));
        }
    });
}

#[cfg(target_os = "macos")]
pub(crate) fn dispatch_menu_request(app: &AppHandle, request: Value) {
    use tauri::Emitter;
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = native::request(&app, request) {
            show_main(&app);
            let _ = app.emit("shelf-intake-failed", error);
        }
    });
}

pub fn handle_menu_event(app: &AppHandle, id: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        match id {
            "shelf-manager" => {
                navigate(app, ShelfNavigation::Page("shelves".into()));
                return true;
            }
            "shelf-settings" => {
                navigate(app, ShelfNavigation::Page("settings".into()));
                return true;
            }
            "shelf-open-wisp" => {
                show_main(app);
                return true;
            }
            "shelf-quit-wisp" => {
                app.exit(0);
                return true;
            }
            _ => {}
        }
        if let Some(request) = menu_request(id) {
            dispatch_menu_request(app, request);
            return true;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, id);
    false
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{mpsc, Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{Emitter, Manager};

    type Reply = Result<Value, String>;
    struct Engine {
        child: Mutex<Child>,
        input: Mutex<Option<ChildStdin>>,
        pending: Mutex<HashMap<u64, mpsc::SyncSender<Reply>>>,
        next: AtomicU64,
        alive: AtomicBool,
    }
    static ENGINE: OnceLock<Mutex<Option<Arc<Engine>>>> = OnceLock::new();
    static STATE_REVISION: AtomicU64 = AtomicU64::new(1);

    fn slot() -> &'static Mutex<Option<Arc<Engine>>> {
        ENGINE.get_or_init(|| Mutex::new(None))
    }

    fn component_path(app: &AppHandle) -> Result<PathBuf, String> {
        let relative = "shelf-engine/WispShelf.app/Contents/MacOS/WispShelf";
        let mut paths = Vec::new();
        if let Ok(resources) = app.path().resource_dir() {
            paths.push(resources.join(relative));
        }
        if cfg!(debug_assertions) {
            paths.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative));
        }
        paths
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| "收集架组件尚未准备好，请重新启动 Wisp 开发版。".into())
    }

    fn engine(app: &AppHandle) -> Result<Arc<Engine>, String> {
        let mut current = slot().lock().unwrap_or_else(|e| e.into_inner());
        let mut stale = false;
        if let Some(engine) = current.as_ref() {
            // 存活与否**以操作系统为准**（`Child::try_wait`），不要只看 `alive` 这个标志。
            //
            // `alive` 是读 stdout 的那个线程在**读到 EOF 之后**才置 false 的。那个线程
            // 里面调着 `app_menu::update_shelves`，一旦那里 panic（这台机器上确实有
            // 后台线程 panic 的记录），线程直接 unwind，`alive` 就永远停在 true。
            // 于是宿主拿着一台**已经死掉的引擎**当活的继续发指令，页面一直显示
            // 「收集架连接已断开」，点重试也拉不起来，只有重启整个 Wisp 才好。
            //
            // 先问系统「这个子进程还在吗」，再决定复用还是重开，两种情况都覆盖得到。
            let mut child = engine.child.lock().unwrap_or_else(|e| e.into_inner());
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                // 进程还在，但只有「标志说活着」且「指令通道还在」才敢复用。
                let writable = engine
                    .input
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_some();
                if engine.alive.load(Ordering::Acquire) && writable {
                    return Ok(engine.clone());
                }
                return Err("收集架正在退出，请稍后再试。".into());
            }
            stale = true;
        }
        if stale {
            current.take();
        }
        let mut child = Command::new(component_path(app)?)
            .arg("--hosted")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("无法启动收集架：{e}"))?;
        let output = child.stdout.take().ok_or("收集架输出通道不可用")?;
        let input = child.stdin.take().ok_or("收集架输入通道不可用")?;
        let engine = Arc::new(Engine {
            child: Mutex::new(child),
            input: Mutex::new(Some(input)),
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        let weak = Arc::downgrade(&engine);
        let handle = app.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            let mut line = String::new();
            let mut failure = "收集架连接已断开；请重新打开收集架管理页。".to_string();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) if line.len() <= 16 * 1024 * 1024 => {}
                    _ => break,
                }
                let Ok(mut message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(state) = message.get_mut("state").and_then(Value::as_object_mut) {
                    state.insert(
                        "revision".into(),
                        json!(STATE_REVISION.fetch_add(1, Ordering::Relaxed)),
                    );
                }
                if let Some(state) = message.get("state") {
                    crate::app_menu::update_shelves(&handle, state);
                }
                if let Some(error) = message.get("error").and_then(Value::as_str) {
                    failure = error.to_string();
                }
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if let Some(engine) = weak.upgrade() {
                        let sender = engine
                            .pending
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove(&id);
                        if let Some(sender) = sender {
                            let reply = if message.get("ok").and_then(Value::as_bool) == Some(true)
                            {
                                message
                                    .get("state")
                                    .cloned()
                                    .ok_or_else(|| "收集架没有返回最新记录。".to_string())
                            } else {
                                Err(failure.clone())
                            };
                            let _ = sender.send(reply);
                        }
                    }
                } else if message.get("event").and_then(Value::as_str) == Some("state") {
                    if let Some(state) = message.get("state") {
                        let _ = handle.emit("shelf-state-changed", state);
                    }
                } else if message.get("event").and_then(Value::as_str) == Some("navigate") {
                    match super::navigation_message(&message) {
                        Ok(Some(target)) => super::navigate(&handle, target),
                        Ok(None) => {}
                        Err(error) => {
                            super::show_main(&handle);
                            let _ = handle.emit("shelf-reveal-failed", error);
                        }
                    }
                } else if message.get("event").and_then(Value::as_str) == Some("airdrop") {
                    super::open_shelf_airdrop(&handle, message);
                } else if message.get("event").and_then(Value::as_str) == Some("cloudTest") {
                    // #66：测试连接的分步结果转发给设置页。
                    if let Some(result) = message.get("result") {
                        let _ = handle.emit("shelf-cloud-test-result", result);
                    }
                } else if message.get("event").and_then(Value::as_str) == Some("cloudRevoke") {
                    // #67：删除并撤销的结果转发给上传历史。
                    if let Some(result) = message.get("result") {
                        let _ = handle.emit("shelf-cloud-revoke-result", result);
                    }
                }
            }
            if let Some(engine) = weak.upgrade() {
                engine.alive.store(false, Ordering::Release);
                engine
                    .input
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
                for (_, sender) in engine
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .drain()
                {
                    let _ = sender.send(Err(failure.clone()));
                }
                let state = unavailable(Some(failure));
                crate::app_menu::update_shelves(&handle, &state);
                let _ = handle.emit("shelf-state-changed", state);
            }
        });
        *current = Some(engine.clone());
        Ok(engine)
    }

    fn send(engine: &Engine, request: Value, timeout: Duration) -> Reply {
        let id = engine.next.fetch_add(1, Ordering::Relaxed);
        let bytes = serde_json::to_vec(&json!({"id": id, "request": request}))
            .map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("收集内容过大，请分批添加。".into());
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        engine
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, sender);
        let written = {
            let mut input = engine.input.lock().unwrap_or_else(|e| e.into_inner());
            match input.as_mut() {
                Some(input) => input
                    .write_all(&bytes)
                    .and_then(|_| input.write_all(b"\n"))
                    .and_then(|_| input.flush()),
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "component stopped",
                )),
            }
        };
        let reply = match written {
            Ok(_) => receiver.recv_timeout(timeout).unwrap_or_else(|_| {
                Err("尚未收到收集架的确认，请先查看最新记录，避免重复操作。".into())
            }),
            Err(error) => Err(format!("收集架连接已断开：{error}")),
        };
        engine
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        reply
    }

    pub fn request(app: &AppHandle, request: Value) -> Reply {
        let engine = engine(app)?;
        let timeout = request_timeout(&request);
        let state = send(&engine, request, timeout)?;
        let _ = app.emit("shelf-state-changed", &state);
        Ok(state)
    }

    pub(super) fn request_timeout(request: &Value) -> Duration {
        let seconds = if request.get("action").and_then(Value::as_str) == Some("snapshot") {
            15
        } else {
            120
        };
        Duration::from_secs(seconds)
    }

    pub fn request_shutdown() -> Result<(), String> {
        let engine = slot().lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(engine) = engine {
            if engine.alive.load(Ordering::Acquire) {
                send(
                    &engine,
                    json!({"action":"shutdown"}),
                    Duration::from_secs(3),
                )?;
                engine
                    .input
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
            }
            wait_for_child_exit(&engine.child, Duration::from_secs(3))?;
        }
        Ok(())
    }

    pub(super) fn wait_for_child_exit(
        child: &Mutex<Child>,
        timeout: Duration,
    ) -> Result<(), String> {
        let started = Instant::now();
        loop {
            if child
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .try_wait()
                .map_err(|error| format!("无法确认收集架已退出：{error}"))?
                .is_some()
            {
                return Ok(());
            }
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Err("收集架尚未完全退出，请等待操作完成后再退出 Wisp。".into());
            }
            std::thread::sleep(remaining.min(Duration::from_millis(20)));
        }
    }

    pub fn detach() {
        if let Some(engine) = slot().lock().unwrap_or_else(|e| e.into_inner()).take() {
            engine
                .input
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            std::thread::spawn(move || {
                let _ = engine
                    .child
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .wait();
            });
        }
    }
}

const ACTIONS: &[&str] = &[
    "snapshot",
    "create",
    "rename",
    "pin",
    "clear",
    "removeItems",
    // close 在引擎端是「收起」（架子保留）；remove 才是删除架子。
    "close",
    "remove",
    "show",
    "hide",
    "dock",
    "addFiles",
    "addContent",
    "clipboard",
    "settings",
    "context",
    "setCredential",
    "deleteCredential",
    "removeCloudAccount",
    "shortcutCapture",
    "selectIgnoredApplications",
    // #66/#67：测试连接与上传历史的删除/撤销由引擎端执行（凭据只在本机解密）。
    "testCloudAccount",
    "removeCloudRecord",
    "revokeCloudRecord",
    // #26：URL 子命令 shelf/last 的分派目标（与 reopen 快捷键同语义）。
    "showLast",
    // #34/#84：截图「拍一张试试」与「快速上手」入口由引擎侧执行（原生能力）。
    "screenshotTest",
    "openScreenshotSettings",
    "showGuide",
];

fn validate_request(request: &Value) -> Result<(), String> {
    let action = request
        .get("action")
        .and_then(Value::as_str)
        .ok_or("缺少收集架操作")?;
    if !request.is_object() || !ACTIONS.contains(&action) {
        return Err("不支持的收集架操作".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn shelf_request(app: AppHandle, request: Value) -> Result<Value, String> {
    validate_request(&request)?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || native::request(&app, request))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(unavailable(Some("原生悬浮收集架目前仅支持 macOS。".into())))
    }
}

pub fn auto_start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = native::request(app, json!({"action":"snapshot"})) {
        tracing::warn!("Shelf component unavailable: {error}");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn request_shutdown() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return native::request_shutdown();
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

pub fn shutdown() {
    #[cfg(target_os = "macos")]
    native::detach();
}

/// #26：wisp-shelf 链接的控制动词。collect 之外新增 shelf/new 与 shelf/last；
/// 校验保持同一严格度——动词白名单、不带凭据/端口/查询/片段。
enum ShelfOpenCommand {
    Collect(Vec<String>),
    NewShelf,
    LastShelf,
}

fn open_command(url: &tauri::Url) -> Result<Option<ShelfOpenCommand>, String> {
    if url.scheme() != "wisp-shelf" {
        return Ok(None);
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return Err("无效的收集架链接".into());
    }
    if url.host_str() == Some("shelf") {
        // 子命令不带任何参数；多余的查询串按无效处理（与 collect 同一严格度）。
        if url.query().is_some() || url.query_pairs().next().is_some() {
            return Err("无效的收集架链接".into());
        }
        return match url.path() {
            "/new" => Ok(Some(ShelfOpenCommand::NewShelf)),
            "/last" => Ok(Some(ShelfOpenCommand::LastShelf)),
            _ => Err("无效的收集架链接".into()),
        };
    }
    if url.host_str() != Some("collect") || !["", "/"].contains(&url.path()) {
        return Err("无效的收集架链接".into());
    }
    let mut paths = Vec::new();
    for (key, value) in url.query_pairs() {
        if key != "file" || paths.len() >= 5000 {
            return Err("无效的收集架文件列表".into());
        }
        let file = tauri::Url::parse(&value).map_err(|_| "无效的文件地址")?;
        if file.query().is_some() || file.fragment().is_some() {
            return Err("无效的文件地址".into());
        }
        let path = file
            .to_file_path()
            .map_err(|_| "收集架仅接受本地文件地址")?;
        paths.push(path.to_string_lossy().into_owned());
    }
    if paths.is_empty() {
        return Err("收集架文件列表为空".into());
    }
    Ok(Some(ShelfOpenCommand::Collect(paths)))
}

pub fn collect_opened(app: &AppHandle, urls: &[tauri::Url]) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Emitter;
        let mut paths = Vec::new();
        let mut verbs = Vec::new();
        for url in urls {
            match open_command(url) {
                Ok(Some(ShelfOpenCommand::Collect(files))) => paths.extend(files),
                Ok(Some(verb @ (ShelfOpenCommand::NewShelf | ShelfOpenCommand::LastShelf))) => {
                    verbs.push(verb)
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = app.emit("shelf-intake-failed", error);
                    return;
                }
            }
        }
        for verb in verbs {
            let action = match verb {
                ShelfOpenCommand::NewShelf => json!({"action":"create"}),
                ShelfOpenCommand::LastShelf => json!({"action":"showLast"}),
                ShelfOpenCommand::Collect(_) => unreachable!("collect is batched above"),
            };
            let handle = app.clone();
            std::thread::spawn(move || {
                if let Err(error) = native::request(&handle, action) {
                    let _ = handle.emit("shelf-intake-failed", error);
                }
            });
        }
        if paths.is_empty() {
            return;
        }
        let handle = app.clone();
        std::thread::spawn(move || {
            if let Err(error) = native::request(&handle, json!({"action":"addFiles","paths":paths}))
            {
                let _ = handle.emit("shelf-intake-failed", error);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, urls);
}

#[cfg(test)]
#[path = "shelf_reveal_tests.rs"]
mod reveal_tests;

#[cfg(test)]
#[path = "shelf_airdrop_tests.rs"]
mod airdrop_tests;

#[cfg(test)]
#[path = "shelf_bridge_tests.rs"]
mod tests;
