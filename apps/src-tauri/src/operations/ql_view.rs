//! Embed the system Quick Look renderer in the calling window's sidebar.
//!
//! The web layer owns layout; this module hosts a system-generated document in the
//! WKWebView's coordinate space. A session belongs to one mounted component,
//! so delayed updates or cleanup cannot touch the next selected document.

use serde::Deserialize;
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewViewFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub viewport_width: f64,
    pub viewport_height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct NativeFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl PreviewViewFrame {
    fn validate(&self) -> Result<(), String> {
        if ![
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_width,
            self.viewport_height,
        ]
        .iter()
        .all(|value| value.is_finite())
            || self.width < 0.0
            || self.height < 0.0
            || self.viewport_width <= 0.0
            || self.viewport_height <= 0.0
        {
            return Err("invalid Quick Look viewport geometry".to_string());
        }
        Ok(())
    }

    fn in_native_bounds(&self, bounds: NativeFrame, flipped: bool) -> NativeFrame {
        // Clamp defensively to the visible web viewport. AppKit uses points,
        // not physical pixels: the ratio also accounts for web page zoom.
        let left = self.x.clamp(0.0, self.viewport_width);
        let top = self.y.clamp(0.0, self.viewport_height);
        let right = (self.x + self.width).clamp(left, self.viewport_width);
        let bottom = (self.y + self.height).clamp(top, self.viewport_height);
        let scale_x = bounds.width / self.viewport_width;
        let scale_y = bounds.height / self.viewport_height;
        NativeFrame {
            x: bounds.x + left * scale_x,
            y: bounds.y
                + if flipped {
                    top * scale_y
                } else {
                    bounds.height - bottom * scale_y
                },
            width: (right - left) * scale_x,
            height: (bottom - top) * scale_y,
        }
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::{NativeFrame, PreviewViewFrame};
    use block2::RcBlock;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{define_class, msg_send, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSScrollView, NSScroller, NSScrollerStyle, NSView, NSWindowOrderingMode};
    use objc2_foundation::{
        NSBundle, NSPoint, NSRect, NSRunLoop, NSRunLoopCommonModes, NSSize, NSString, NSTimer,
        NSURL,
    };
    use sha2::{Digest, Sha256};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant, UNIX_EPOCH};
    use tauri::{Manager, WebviewWindow};

    // PDFKit restores hasVerticalScroller during scrolling. Use the documented
    // custom-scroller contract so that this preview's controls stay hidden even
    // when its renderer changes that flag. No global AppKit behavior is changed.
    define_class!(
        #[unsafe(super(NSScroller))]
        #[thread_kind = MainThreadOnly]
        #[name = "WispPreviewHiddenScroller"]
        struct HiddenScroller;

        impl HiddenScroller {
            #[unsafe(method(isCompatibleWithOverlayScrollers))]
            fn overlay_compatible() -> bool { true }

            #[unsafe(method(setHidden:))]
            fn keep_hidden(&self, _hidden: bool) {
                unsafe { let _: () = msg_send![super(self), setHidden: true]; }
            }
        }
    );

    #[derive(Default)]
    struct WebPreviewState {
        width: f64,
        configured: bool,
        pending: bool,
        attempts: u8,
        last_attempt: Option<Instant>,
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Renderer {
        QuickLook,
        Pdf,
        SystemHtml,
    }

    struct NativePreview {
        session_id: String,
        view: Retained<NSView>,
        renderer: Renderer,
        fit_web_document: bool,
        web_states: HashMap<usize, WebPreviewState>,
        last_pdf_width: f64,
        observer: Retained<NSTimer>,
        // Keep exported attachments leased until the reader leaves the window.
        _presentation: Option<PresentationFile>,
    }

    impl Drop for NativePreview {
        fn drop(&mut self) {
            self.observer.invalidate();
            // A closed QLPreviewView cannot be reused. Hiding uses setHidden
            // instead; only final component/window disposal reaches here.
            if self.renderer == Renderer::QuickLook {
                unsafe {
                    let _: () = msg_send![&*self.view, close];
                }
            } else if self.renderer == Renderer::Pdf {
                unsafe {
                    let _: () =
                        msg_send![&*self.view, setDocument: std::ptr::null_mut::<AnyObject>()];
                }
            } else {
                unsafe {
                    let _: () = msg_send![&*self.view, stopLoading];
                }
            }
            self.view.removeFromSuperview();
        }
    }

    thread_local! {
        static PREVIEWS: RefCell<HashMap<String, NativePreview>> = RefCell::new(HashMap::new());
    }

    struct PresentationFile {
        html: PathBuf,
        resources: PathBuf,
        _lease: std::fs::File,
    }

    // A complete export includes its relative image/font attachments. Publish the
    // entire directory atomically so another selection never sees half an export.
    struct ExportStaging(PathBuf);

    impl Drop for ExportStaging {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn presentation_key(path: &Path) -> Result<String, String> {
        let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
        let modified = metadata
            .modified()
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?;
        let mut hash = Sha256::new();
        hash.update(path.as_os_str().as_encoded_bytes());
        hash.update(metadata.len().to_le_bytes());
        hash.update(modified.as_nanos().to_le_bytes());
        Ok(format!("{:x}", hash.finalize()))
    }

    fn presentation_file(directory: &Path, source: &Path) -> Result<PresentationFile, String> {
        let lease = std::fs::File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join(".lease"))
            .map_err(|error| error.to_string())?;
        lease.lock_shared().map_err(|error| error.to_string())?;
        let name = source
            .file_name()
            .ok_or("presentation filename is unavailable")?;
        let mut bundle = name.to_os_string();
        bundle.push(".qlpreview");
        let resources = directory.join(bundle);
        let html = resources.join("Preview.html");
        if !html.is_file() {
            return Err(
                "system presentation preview did not provide a complete HTML document".into(),
            );
        }
        Ok(PresentationFile {
            html,
            resources,
            _lease: lease,
        })
    }

    fn prune_presentation_cache(cache: &Path, limit: usize) {
        let Ok(entries) = std::fs::read_dir(cache) else {
            return;
        };
        let mut complete: Vec<_> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_str()?;
                if name.len() != 64 || !name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                    return None;
                }
                if !entry.file_type().ok()?.is_dir() {
                    return None;
                }
                Some((entry.metadata().ok()?.modified().ok()?, entry.path()))
            })
            .collect();
        complete.sort_unstable_by_key(|(modified, _)| *modified);
        let mut excess = complete.len().saturating_sub(limit);
        for (_, directory) in complete {
            if excess == 0 {
                break;
            }
            let Ok(lease) = std::fs::File::options()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(directory.join(".lease"))
            else {
                continue;
            };
            // The shared reader lease protects lazy-loaded images across both
            // windows and Wisp processes. Never wait for a currently open file.
            if lease.try_lock().is_ok() && std::fs::remove_dir_all(&directory).is_ok() {
                excess -= 1;
            }
        }
    }

    fn prepare_presentation_html(html: &str) -> Result<String, String> {
        // Preserve the generator's quirks/standards mode and all slide layout.
        // Only reader chrome and resource permissions are changed. Source-file
        // scripts are also disabled by WKWebViewConfiguration below.
        let head = html
            .as_bytes()
            .windows(6)
            .take(4096)
            .position(|bytes| bytes.eq_ignore_ascii_case(b"<head>"))
            .ok_or("system presentation preview has no HTML document head")?
            + "<head>".len();
        let policy = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline' file:; font-src file: data:; media-src file: data:; base-uri 'none'; form-action 'none'"><style id="wisp-native-preview-scrollbars">*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}</style>"#;
        let mut result = String::with_capacity(html.len() + policy.len());
        result.push_str(&html[..head]);
        result.push_str(policy);
        result.push_str(&html[head..]);
        Ok(result)
    }

    async fn export_presentation(
        window: &WebviewWindow,
        path: &str,
    ) -> Result<PresentationFile, String> {
        static EXPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        static NEXT_EXPORT: AtomicU64 = AtomicU64::new(0);
        let source = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let key = presentation_key(&source)?;
        let cache = window
            .app_handle()
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("native-presentations-v1");
        let complete = cache.join(&key);
        // The short lock covers cache publication across windows as well as
        // duplicate requests for the same presentation.
        let _guard = EXPORT_LOCK.lock().await;
        if complete.is_dir() {
            let presentation = presentation_file(&complete, &source)?;
            prune_presentation_cache(&cache, 32);
            return Ok(presentation);
        }
        std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
        let staging = ExportStaging(cache.join(format!(
            ".partial-{}-{}",
            std::process::id(),
            NEXT_EXPORT.fetch_add(1, Ordering::Relaxed)
        )));
        std::fs::create_dir(&staging.0).map_err(|error| error.to_string())?;
        let mut command = tokio::process::Command::new("/usr/bin/qlmanage");
        command
            .args(["-p", "-o"])
            .arg(&staging.0)
            .arg(&source)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(Duration::from_secs(45), command.status())
            .await
            .map_err(|_| "system presentation preview timed out".to_string())?
            .map_err(|error| format!("system presentation preview could not start: {error}"))?;
        if !status.success() {
            return Err("system presentation preview could not be generated".into());
        }
        let generated = presentation_file(&staging.0, &source)?;
        let html = std::fs::read_to_string(&generated.html).map_err(|error| error.to_string())?;
        std::fs::write(&generated.html, prepare_presentation_html(&html)?)
            .map_err(|error| error.to_string())?;
        if key != presentation_key(&source)? {
            return Err("presentation changed while its preview was being generated".into());
        }
        if let Err(error) = std::fs::rename(&staging.0, &complete) {
            // Another Wisp process may have completed the same immutable entry.
            if !complete.is_dir() {
                return Err(format!("presentation preview could not be cached: {error}"));
            }
        }
        let presentation = presentation_file(&complete, &source)?;
        prune_presentation_cache(&cache, 32);
        Ok(presentation)
    }

    fn renderer_class(name: &std::ffi::CStr) -> Result<&'static AnyClass, String> {
        if let Some(class) = AnyClass::get(name) {
            return Ok(class);
        }
        let bundle = NSBundle::bundleWithPath(&NSString::from_str(
            "/System/Library/Frameworks/Quartz.framework",
        ))
        .ok_or("Quick Look framework is unavailable")?;
        let loaded: bool = unsafe { msg_send![&*bundle, load] };
        if !loaded {
            return Err("Quick Look framework could not be loaded".to_string());
        }
        AnyClass::get(name).ok_or_else(|| "native document renderer is unavailable".to_string())
    }

    fn hidden_scroller() -> Retained<NSScroller> {
        let allocated: Allocated<HiddenScroller> =
            unsafe { msg_send![HiddenScroller::class(), alloc] };
        let scroller: Retained<HiddenScroller> = unsafe {
            msg_send![allocated, initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0))]
        };
        scroller.setHidden(true);
        scroller.into_super()
    }

    fn hide_native_scrollbars(scroll: &NSScrollView) {
        if scroll.scrollerStyle() != NSScrollerStyle::Overlay {
            scroll.setScrollerStyle(NSScrollerStyle::Overlay);
        }
        if !scroll
            .verticalScroller()
            .is_some_and(|scroller| scroller.downcast_ref::<HiddenScroller>().is_some())
        {
            scroll.setVerticalScroller(Some(&hidden_scroller()));
        }
        if !scroll
            .horizontalScroller()
            .is_some_and(|scroller| scroller.downcast_ref::<HiddenScroller>().is_some())
        {
            scroll.setHorizontalScroller(Some(&hidden_scroller()));
        }
        if scroll.hasVerticalScroller() {
            scroll.setHasVerticalScroller(false);
        }
        if scroll.hasHorizontalScroller() {
            scroll.setHasHorizontalScroller(false);
        }
    }

    const WEB_PREVIEW_STYLE: &str = r#"(() => {
      if (!document.body || document.readyState !== 'complete' || !document.body.childElementCount) return 0;
      let style = document.getElementById('wisp-native-preview-scrollbars');
      if (!style) {
        style = document.createElement('style');
        style.id = 'wisp-native-preview-scrollbars';
        style.textContent = '* { scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
        (document.head || document.documentElement).appendChild(style);
      }
      return Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    })()"#;

    fn configure_web_preview(label: &str, preview: &mut NativePreview, web: Retained<NSView>) {
        let key = Retained::as_ptr(&web) as usize;
        let width = web.bounds().size.width;
        if width <= 0.0 {
            return;
        }
        let state = preview.web_states.entry(key).or_default();
        let loading: bool = unsafe { msg_send![&*web, isLoading] };
        if loading {
            state.configured = false;
            state.attempts = 0;
            return;
        }
        let resized = (state.width - width).abs() > 0.5;
        if state.pending || (state.configured && !resized) {
            return;
        }
        if !resized
            && (state.attempts >= 30
                || state
                    .last_attempt
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(1)))
        {
            return;
        }
        state.width = width;
        state.pending = true;
        if resized {
            state.attempts = 0;
        }
        state.attempts = state.attempts.saturating_add(1);
        state.last_attempt = Some(Instant::now());
        if preview.fit_web_document {
            // Measure at natural scale, then scale the complete page. This keeps
            // table/image layout intact instead of reflowing individual elements.
            unsafe {
                let _: () = msg_send![&*web, setPageZoom: 1.0f64];
            }
        }
        let label = label.to_owned();
        let session_id = preview.session_id.clone();
        let fit_document = preview.fit_web_document;
        let callback = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
            if MainThreadMarker::new().is_none() {
                return;
            }
            PREVIEWS.with(|previews| {
                let mut previews = previews.borrow_mut();
                let Some(preview) = previews.get_mut(&label) else {
                    return;
                };
                if preview.session_id != session_id {
                    return;
                }
                let Some(state) = preview.web_states.get_mut(&key) else {
                    return;
                };
                state.pending = false;
                if !error.is_null() || result.is_null() {
                    return;
                }
                let natural_width: f64 = unsafe { msg_send![result, doubleValue] };
                if !natural_width.is_finite() || natural_width <= 0.0 {
                    return;
                }
                state.configured = true;
                state.attempts = 0;
                if fit_document {
                    let zoom = (width / natural_width).clamp(0.1, 1.0);
                    unsafe {
                        let _: () = msg_send![&*web, setPageZoom: zoom];
                    }
                }
            });
        });
        // The callback retains only this live view until evaluation finishes;
        // its session guard prevents an old document from changing the new one.
        let web_pointer = key as *mut AnyObject;
        unsafe {
            let _: () = msg_send![web_pointer, evaluateJavaScript: &*NSString::from_str(WEB_PREVIEW_STYLE), completionHandler: &*callback];
        }
    }

    fn refresh_preview_chrome(label: &str, preview: &mut NativePreview) {
        if preview.view.isHiddenOrHasHiddenAncestor()
            || !preview
                .view
                .window()
                .is_some_and(|window| window.isVisible())
        {
            return;
        }
        let web_class = AnyClass::get(c"WKWebView");
        let mut queue = vec![preview.view.clone()];
        let mut visited = 0;
        // Work is bounded to this preview's subtree, never the app/web DOM.
        while let Some(view) = queue.pop() {
            visited += 1;
            if visited > 256 {
                break;
            }
            if let Some(scroll) = view.downcast_ref::<NSScrollView>() {
                hide_native_scrollbars(scroll);
            }
            if web_class.is_some_and(|class| unsafe { msg_send![&*view, isKindOfClass: class] }) {
                configure_web_preview(label, preview, view.clone());
            }
            queue.extend(view.subviews().iter().take(256 - visited));
        }
        if preview.renderer == Renderer::Pdf {
            let width = preview.view.bounds().size.width;
            if (preview.last_pdf_width - width).abs() > 0.5 {
                let scale: f64 = unsafe { msg_send![&*preview.view, scaleFactorForSizeToFit] };
                if scale.is_finite() && scale > 0.0 {
                    unsafe {
                        let _: () = msg_send![&*preview.view, setScaleFactor: scale];
                    }
                    preview.last_pdf_width = width;
                }
            }
        }
    }

    fn chrome_observer(label: String, session_id: String) -> Retained<NSTimer> {
        let callback = RcBlock::new(move |_timer: NonNull<NSTimer>| {
            PREVIEWS.with(|previews| {
                let mut previews = previews.borrow_mut();
                if let Some(preview) = previews.get_mut(&label) {
                    if preview.session_id == session_id {
                        refresh_preview_chrome(&label, preview);
                    }
                }
            });
        });
        // QL builds its descendants asynchronously. The timer does no work while
        // hidden, writes web styles only on load/resize, and dies with the session.
        unsafe {
            let timer = NSTimer::timerWithTimeInterval_repeats_block(0.25, true, &callback);
            NSRunLoop::mainRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes);
            timer
        }
    }

    fn native_frame(parent: &NSView, frame: &PreviewViewFrame) -> NativeFrame {
        let bounds = parent.bounds();
        frame.in_native_bounds(
            NativeFrame {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            },
            parent.isFlipped(),
        )
    }

    fn rect(frame: NativeFrame) -> NSRect {
        NSRect::new(
            NSPoint::new(frame.x, frame.y),
            NSSize::new(frame.width, frame.height),
        )
    }

    fn apply_frame(view: &NSView, frame: NativeFrame, visible: bool) {
        let visible = visible && frame.width > 0.0 && frame.height > 0.0;
        // Hide before moving an occluded view to avoid briefly painting over
        // a web dialog or a collapsed sidebar.
        if !visible {
            view.setHidden(true);
        }
        view.setFrame(rect(frame));
        if visible {
            view.setHidden(false);
        }
    }

    pub async fn mount(
        window: WebviewWindow,
        path: String,
        session_id: String,
        frame: PreviewViewFrame,
        visible: bool,
    ) -> Result<(), String> {
        let extension = Path::new(&path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        // QL's presentation renderer can host its scrolling content outside the
        // public view tree. Export the same system-generated complete document
        // into a local reader where scrollbars are controllable without cropping.
        let presentation = if matches!(extension.as_str(), "ppt" | "pptx" | "pps" | "ppsx") {
            Some(export_presentation(&window, &path).await?)
        } else {
            None
        };
        let label = window.label().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |platform| {
                let result = (|| {
                    MainThreadMarker::new().ok_or("Quick Look requires the main thread")?;
                    // Tauri gives us the live WKWebView on the UI thread. Its
                    // bounds exclude the title bar and already use AppKit points.
                    let parent = unsafe { &*platform.inner().cast::<NSView>() };
                    let native_frame = native_frame(parent, &frame);
                    let renderer = if presentation.is_some() {
                        Renderer::SystemHtml
                    } else if extension == "pdf" {
                        Renderer::Pdf
                    } else {
                        Renderer::QuickLook
                    };
                    let class = renderer_class(match renderer {
                        Renderer::Pdf => c"PDFView",
                        Renderer::QuickLook => c"QLPreviewView",
                        Renderer::SystemHtml => c"WKWebView",
                    })?;
                    let allocated: Allocated<NSView> = unsafe { msg_send![class, alloc] };
                    // Normal style keeps the renderer's document navigation.
                    let view: Option<Retained<NSView>> = if renderer == Renderer::SystemHtml {
                        let configuration_class = renderer_class(c"WKWebViewConfiguration")?;
                        let configuration: Retained<AnyObject> = unsafe { msg_send![configuration_class, new] };
                        unsafe {
                            let preferences: Retained<AnyObject> = msg_send![&*configuration, defaultWebpagePreferences];
                            let _: () = msg_send![&*preferences, setAllowsContentJavaScript: false];
                            let _: () = msg_send![&*configuration, setMediaTypesRequiringUserActionForPlayback: usize::MAX];
                            let _: () = msg_send![&*configuration, setSuppressesIncrementalRendering: true];
                            let store_class = renderer_class(c"WKWebsiteDataStore")?;
                            let store: Retained<AnyObject> = msg_send![store_class, nonPersistentDataStore];
                            let _: () = msg_send![&*configuration, setWebsiteDataStore: &*store];
                            msg_send![allocated, initWithFrame: rect(native_frame), configuration: &*configuration]
                        }
                    } else if renderer == Renderer::Pdf {
                        unsafe { msg_send![allocated, initWithFrame: rect(native_frame)] }
                    } else {
                        unsafe {
                            msg_send![allocated, initWithFrame: rect(native_frame), style: 0usize]
                        }
                    };
                    let view = view.ok_or("native document preview could not be initialized")?;
                    view.setHidden(true);
                    if renderer == Renderer::QuickLook {
                        unsafe {
                            let _: () = msg_send![&*view, setAutostarts: false];
                            let _: () = msg_send![&*view, setShouldCloseWithWindow: false];
                        }
                    }
                    let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
                    let pdf_document = if renderer == Renderer::Pdf {
                        let document_class = renderer_class(c"PDFDocument")?;
                        let allocated: Allocated<AnyObject> =
                            unsafe { msg_send![document_class, alloc] };
                        let document: Option<Retained<AnyObject>> =
                            unsafe { msg_send![allocated, initWithURL: &*url] };
                        Some(document.ok_or("PDF document could not be opened")?)
                    } else {
                        None
                    };
                    if let Some(presentation) = &presentation {
                        let html_url = NSURL::fileURLWithPath(&NSString::from_str(&presentation.html.to_string_lossy()));
                        let resources_url = NSURL::fileURLWithPath(&NSString::from_str(&presentation.resources.to_string_lossy()));
                        let navigation: Option<Retained<AnyObject>> = unsafe {
                            msg_send![&*view, loadFileURL: &*html_url, allowingReadAccessToURL: &*resources_url]
                        };
                        navigation.ok_or("system presentation preview could not be loaded")?;
                    }
                    parent.addSubview_positioned_relativeTo(
                        &view,
                        NSWindowOrderingMode::Above,
                        None,
                    );
                    if let Some(document) = pdf_document {
                        unsafe {
                            let _: () = msg_send![&*view, setDisplayMode: 1isize]; // single-page continuous
                            let _: () = msg_send![&*view, setDocument: &*document];
                            let _: () = msg_send![&*view, setAutoScales: true];
                        }
                    } else if renderer == Renderer::QuickLook {
                        unsafe {
                            let _: () = msg_send![&*view, setPreviewItem: &*url];
                        }
                    }
                    // Never make this view the first responder. Selecting a
                    // file must leave keyboard navigation in the file list.
                    apply_frame(&view, native_frame, visible);
                    let observer = chrome_observer(label.clone(), session_id.clone());
                    PREVIEWS.with(|previews| {
                        let mut previews = previews.borrow_mut();
                        let preview = previews
                            .entry(label.clone())
                            .insert_entry(NativePreview {
                                session_id,
                                view,
                                renderer,
                                observer,
                                fit_web_document: renderer == Renderer::SystemHtml || matches!(
                                    extension.as_str(),
                                    "doc" | "docx" | "rtf" | "rtfd" | "odt"
                                ),
                                web_states: HashMap::new(),
                                last_pdf_width: 0.0,
                                _presentation: presentation,
                            })
                            .into_mut();
                        refresh_preview_chrome(&label, preview);
                    });
                    // This confirms the native host exists. QLPreviewView loads
                    // the actual document asynchronously and supplies its own UI.
                    Ok(())
                })();
                let _ = tx.send(result);
            })
            .map_err(|error| error.to_string())?;
        rx.await
            .map_err(|_| "Quick Look main thread dispatch ended".to_string())?
    }

    pub async fn update(
        window: WebviewWindow,
        session_id: String,
        frame: PreviewViewFrame,
        visible: bool,
    ) -> Result<(), String> {
        let label = window.label().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |platform| {
                let result = (|| {
                    MainThreadMarker::new().ok_or("Quick Look requires the main thread")?;
                    let parent = unsafe { &*platform.inner().cast::<NSView>() };
                    PREVIEWS.with(|previews| {
                        let mut previews = previews.borrow_mut();
                        if let Some(preview) = previews.get_mut(&label) {
                            if preview.session_id == session_id {
                                apply_frame(&preview.view, native_frame(parent, &frame), visible);
                                refresh_preview_chrome(&label, preview);
                            }
                        }
                    });
                    Ok(())
                })();
                let _ = tx.send(result);
            })
            .map_err(|error| error.to_string())?;
        rx.await
            .map_err(|_| "Quick Look main thread dispatch ended".to_string())?
    }

    pub async fn close(window: WebviewWindow, session_id: String) -> Result<(), String> {
        let label = window.label().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                PREVIEWS.with(|previews| {
                    let mut previews = previews.borrow_mut();
                    if previews
                        .get(&label)
                        .is_some_and(|preview| preview.session_id == session_id)
                    {
                        previews.remove(&label);
                    }
                });
                let _ = tx.send(());
            })
            .map_err(|error| error.to_string())?;
        rx.await
            .map_err(|_| "Quick Look main thread dispatch ended".to_string())
    }

    pub fn close_for_window(label: &str) {
        // Tauri window events are delivered on the event loop's main thread.
        if MainThreadMarker::new().is_none() {
            return;
        }
        PREVIEWS.with(|previews| {
            previews.borrow_mut().remove(label);
        });
    }

    #[cfg(test)]
    mod presentation_tests {
        use super::*;

        #[test]
        fn cache_cleanup_keeps_attachments_while_a_reader_holds_them() {
            let temporary = tempfile::tempdir().unwrap();
            let first = temporary.path().join("1".repeat(64));
            let second = temporary.path().join("2".repeat(64));
            for directory in [&first, &second] {
                let bundle = directory.join("slides.pptx.qlpreview");
                std::fs::create_dir_all(&bundle).unwrap();
                std::fs::write(bundle.join("Preview.html"), "<html></html>").unwrap();
                std::fs::write(bundle.join("Attachment1.png"), b"image bytes").unwrap();
            }
            let reader = presentation_file(&first, Path::new("slides.pptx")).unwrap();
            prune_presentation_cache(temporary.path(), 0);
            assert!(reader.html.is_file());
            assert!(reader.resources.join("Attachment1.png").is_file());
            assert!(!second.exists());
            drop(reader);
            prune_presentation_cache(temporary.path(), 0);
            assert!(!first.exists());
        }

        #[test]
        fn cache_invalidates_for_same_size_edits_within_one_second() {
            let temporary = tempfile::tempdir().unwrap();
            let source = temporary.path().join("slides.pptx");
            std::fs::write(&source, b"first").unwrap();
            let file = std::fs::File::options().write(true).open(&source).unwrap();
            file.set_times(
                std::fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::new(10, 1)),
            )
            .unwrap();
            let before = presentation_key(&source).unwrap();
            std::fs::write(&source, b"later").unwrap();
            file.set_times(
                std::fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::new(10, 2)),
            )
            .unwrap();
            assert_ne!(before, presentation_key(&source).unwrap());
        }

        #[test]
        fn reader_policy_preserves_layout_mode_unicode_and_relative_attachments() {
            let original = "<html><HEAD><meta charset='utf-8'><style>.slide{width:960;height:540}</style></HEAD><body><div class='slide'>第一页<img src='image001.png'></div><div class='slide'>末页</div></body></html>";
            let prepared = prepare_presentation_html(original).unwrap();
            assert!(prepared.starts_with("<html><HEAD><meta http-equiv="));
            assert!(prepared.contains("default-src 'none'"));
            assert!(prepared.contains("img-src file: data:"));
            assert!(prepared.contains("scrollbar-width:none!important"));
            // No doctype insertion or rewriting of the generator's original
            // page/style/image content, including its legacy unitless geometry.
            assert!(prepared.ends_with(original.split_once("<HEAD>").unwrap().1));
            assert!(prepare_presentation_html("<body>incomplete export</body>").is_err());
        }
    }
}

#[tauri::command]
pub async fn preview_mount_ql_view(
    window: WebviewWindow,
    path: String,
    session_id: String,
    frame: PreviewViewFrame,
    visible: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        frame.validate()?;
        if session_id.is_empty() {
            return Err("Quick Look session is missing".to_string());
        }
        if !std::path::Path::new(&path).is_file() {
            return Err("Quick Look source file is unavailable".to_string());
        }
        native::mount(window, path, session_id, frame, visible).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path, session_id, frame, visible);
        Err("embedded Quick Look is only available on macOS".to_string())
    }
}

#[tauri::command]
pub async fn preview_update_ql_view(
    window: WebviewWindow,
    session_id: String,
    frame: PreviewViewFrame,
    visible: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        frame.validate()?;
        native::update(window, session_id, frame, visible).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, session_id, frame, visible);
        Err("embedded Quick Look is only available on macOS".to_string())
    }
}

#[tauri::command]
pub async fn preview_close_ql_view(
    window: WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        native::close(window, session_id).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, session_id);
        Err("embedded Quick Look is only available on macOS".to_string())
    }
}

pub fn close_ql_view_for_window(label: &str) {
    #[cfg(target_os = "macos")]
    native::close_for_window(label);
    #[cfg(not(target_os = "macos"))]
    let _ = label;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> PreviewViewFrame {
        PreviewViewFrame {
            x: 600.0,
            y: 80.0,
            width: 200.0,
            height: 300.0,
            viewport_width: 800.0,
            viewport_height: 600.0,
        }
    }

    #[test]
    fn scaled_viewport_maps_to_webview_points_in_both_coordinate_systems() {
        let bounds = NativeFrame {
            x: 10.0,
            y: 20.0,
            width: 1200.0,
            height: 900.0,
        };
        assert_eq!(
            frame().in_native_bounds(bounds, true),
            NativeFrame {
                x: 910.0,
                y: 140.0,
                width: 300.0,
                height: 450.0
            }
        );
        assert_eq!(
            frame().in_native_bounds(bounds, false),
            NativeFrame {
                x: 910.0,
                y: 350.0,
                width: 300.0,
                height: 450.0
            }
        );
    }

    #[test]
    fn preview_cannot_extend_beyond_the_webview() {
        let mut frame = frame();
        frame.x = -20.0;
        frame.y = 550.0;
        let bounds = NativeFrame {
            x: 0.0,
            y: 0.0,
            width: 800.0,
            height: 600.0,
        };
        assert_eq!(
            frame.in_native_bounds(bounds, true),
            NativeFrame {
                x: 0.0,
                y: 550.0,
                width: 180.0,
                height: 50.0
            }
        );
        frame.x = 900.0;
        assert_eq!(frame.in_native_bounds(bounds, true).width, 0.0);
    }

    #[test]
    fn zero_size_is_valid_but_invalid_viewports_and_non_finite_values_are_rejected() {
        let mut frame = frame();
        frame.width = 0.0;
        frame.height = 0.0;
        assert!(frame.validate().is_ok());
        frame.viewport_width = 0.0;
        assert!(frame.validate().is_err());
        frame.viewport_width = 800.0;
        frame.y = f64::NAN;
        assert!(frame.validate().is_err());
    }
}
