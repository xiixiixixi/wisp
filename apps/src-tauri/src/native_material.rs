//! Native backing for transparent navigation chrome. File content remains opaque
//! in the webview; only its transparent regions reveal AppKit's material.

use std::cell::RefCell;
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, ProtocolObject};
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow, NSWindowOrderingMode, NSWorkspace,
    NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
};
use objc2_foundation::{NSNotification, NSObjectProtocol, NSOperationQueue};
use tauri::Manager;

struct NativeMaterial {
    window: Retained<NSWindow>,
    backings: Vec<Retained<NSView>>,
    webview: tauri::WebviewWindow,
    kind: &'static str,
    // NSNotificationCenter owns the callback; retain its observer for this window's lifetime.
    _observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

thread_local! {
    static MATERIAL: RefCell<Option<NativeMaterial>> = const { RefCell::new(None) };
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mtm =
        MainThreadMarker::new().ok_or("native material must be installed on the main thread")?;
    let webview = app
        .get_webview_window("main")
        .ok_or("main window is unavailable")?;
    // Tauri owns this NSWindow. Retain it for the lifetime of the backing view.
    let window = unsafe { Retained::retain(webview.ns_window()?.cast::<NSWindow>()) }
        .ok_or("native window is unavailable")?;
    let container = window
        .contentView()
        .ok_or("native content view is unavailable")?;
    let bounds = container.bounds();

    // NSGlassEffectView samples inside its window. Supply an explicit desktop
    // backdrop first so transparent web chrome never falls back to a flat tint.
    let vibrancy = NSVisualEffectView::initWithFrame(mtm.alloc(), bounds);
    vibrancy.setMaterial(NSVisualEffectMaterial::Sidebar);
    vibrancy.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    vibrancy.setState(NSVisualEffectState::FollowsWindowActiveState);
    vibrancy.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    container.addSubview_positioned_relativeTo(&vibrancy, NSWindowOrderingMode::Below, None);
    let mut backings: Vec<Retained<NSView>> = vec![vibrancy.into_super()];

    let kind = if AnyClass::get(c"NSGlassEffectView").is_some() {
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), bounds);
        glass.setStyle(NSGlassEffectViewStyle::Regular);
        glass.setCornerRadius(16.0);
        // Use the documented contentView contract instead of attaching arbitrary
        // children to the glass. The webview stays a sibling above this backing.
        let content = NSView::initWithFrame(mtm.alloc(), bounds);
        glass.setContentView(Some(&content));
        glass.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        container.addSubview_positioned_relativeTo(
            &glass,
            NSWindowOrderingMode::Above,
            Some(&backings[0]),
        );
        backings.push(glass.into_super());
        "glass"
    } else {
        "vibrancy"
    };

    let callback = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        publish_frontend_state();
    });
    let workspace = NSWorkspace::sharedWorkspace();
    let observer = unsafe {
        workspace
            .notificationCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification),
                None,
                Some(&NSOperationQueue::mainQueue()),
                &callback,
            )
    };
    MATERIAL.with(|state| {
        *state.borrow_mut() = Some(NativeMaterial {
            window,
            backings,
            webview,
            kind,
            _observer: observer,
        });
    });
    publish_frontend_state();
    tracing::info!("Installed native {kind} window material");
    Ok(())
}

/// Refresh accessibility and publish markers after navigation as well as when
/// AppKit reports a preference change. Native materials follow system appearance.
pub fn publish_frontend_state() {
    if MainThreadMarker::new().is_none() {
        return;
    }
    MATERIAL.with(|state| {
        let state = state.borrow();
        let Some(material) = state.as_ref() else {
            return;
        };
        let workspace = NSWorkspace::sharedWorkspace();
        let reduced_transparency = workspace.accessibilityDisplayShouldReduceTransparency();
        let reduced_motion = workspace.accessibilityDisplayShouldReduceMotion();
        let increased_contrast = workspace.accessibilityDisplayShouldIncreaseContrast();
        for backing in &material.backings {
            backing.setHidden(reduced_transparency);
        }
        material.window.setOpaque(reduced_transparency);
        let background = if reduced_transparency {
            NSColor::windowBackgroundColor()
        } else {
            NSColor::clearColor()
        };
        material.window.setBackgroundColor(Some(&background));
        let kind = if reduced_transparency {
            "opaque"
        } else {
            material.kind
        };
        let script = format!(
            "(() => {{ const apply = () => {{ const root = document.documentElement; \
             root.dataset.nativeMaterial = '{kind}'; \
             root.toggleAttribute('data-native-reduce-transparency', {reduced_transparency}); \
             root.toggleAttribute('data-native-reduce-motion', {reduced_motion}); \
             root.toggleAttribute('data-native-increase-contrast', {increased_contrast}); \
             }}; if (document.documentElement) apply(); \
             else document.addEventListener('DOMContentLoaded', apply, {{ once: true }}); }})();"
        );
        if let Err(error) = material.webview.eval(&script) {
            tracing::debug!("Native material marker deferred until page load: {error}");
        }
    });
}
