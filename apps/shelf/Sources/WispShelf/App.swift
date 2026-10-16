import AppKit
import SwiftUI
import Combine
import QuickLookUI
import ApplicationServices
import ServiceManagement
import ShelfCore
import UniformTypeIdentifiers

final class ShelfPanel: NSPanel {
    var onCommand: ((String) -> Void)?
    var onNumber: ((String) -> Bool)?
    var localBindings: (() -> [ShortcutBinding])?
    var onMoveEnded: (() -> Void)?
    override var canBecomeKey: Bool { true }

    override var canBecomeMain: Bool { false }
    override func animationResizeTime(_ newFrame: NSRect) -> TimeInterval {
        ShelfMotion.duration(.docking)
    }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if isEditingText || isRevealButtonKey(event) { return super.performKeyEquivalent(with: event) }
        if isOptionReturn(event) { onCommand?("recentReturn"); return true }
        if !(firstResponder is NSTextView), event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty,
           onNumber?(event.charactersIgnoringModifiers ?? "") == true { return true }
        if dispatchLocal(event) { return true }
        if !(firstResponder is NSTextView), event.modifierFlags.contains(.command), let key = event.charactersIgnoringModifiers?.lowercased(), ["a", "c", "v", "o"].contains(key) {
            onCommand?(key); return true
        }
        return super.performKeyEquivalent(with: event)
    }
    override func keyDown(with event: NSEvent) {
        if isEditingText || isRevealButtonKey(event) { super.keyDown(with: event); return }
        if isOptionReturn(event) { onCommand?("recentReturn"); return }
        if onNumber?(event.charactersIgnoringModifiers ?? "") == true { return }
        if dispatchLocal(event) { return }
        super.keyDown(with: event)
    }
    override func flagsChanged(with event: NSEvent) {
        if !isEditingText, NSEvent.pressedMouseButtons == 0 { onCommand?(event.modifierFlags.contains(.option) ? "recentOn" : "recentOff") }
        super.flagsChanged(with: event)
    }
    private var isEditingText: Bool { firstResponder is NSTextView || firstResponder is NSTextField }
    /// #74：⌥⏎ = 直接重复最近一次操作。最近操作列表正是按住 ⌥ 时显示的，
    /// 这里在 localBindings 之前截获——普通 ⏎（动作菜单）不带 ⌥，互不冲突。
    private func isOptionReturn(_ event: NSEvent) -> Bool {
        event.keyCode == 36 && event.modifierFlags.contains(.option)
    }
    private func isRevealButtonKey(_ event: NSEvent) -> Bool {
        firstResponder is ShelfGalleryRevealButton
            && event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty
            && [36, 49, 76].contains(event.keyCode)
    }
    private func dispatchLocal(_ event: NSEvent) -> Bool {
        if isEditingText { return false }
        let flags = event.modifierFlags
        let modifiersOnly = flags.intersection([.command, .shift, .option, .control])
        if modifiersOnly == .shift, (123...126).contains(Int(event.keyCode)),
           firstResponder is NSTableView || firstResponder is NSCollectionView { return false }
        let modifiers: UInt32 = (flags.contains(.command) ? 256 : 0)
            | (flags.contains(.shift) ? 512 : 0) | (flags.contains(.option) ? 2048 : 0)
            | (flags.contains(.control) ? 4096 : 0)
        guard let binding = localBindings?().first(where: { $0.keyCode == UInt32(event.keyCode) && $0.modifiers == modifiers }) else { return false }
        if binding.enabled { onCommand?(binding.id) }
        return true
    }
}

@MainActor
final class ShelfWindow: NSObject, NSWindowDelegate {
    let panel: ShelfPanel
    let detailsPanel: ShelfPanel
    let id: UUID
    var dockHandle: ShelfDockHandle?
    var undockedFrame: NSRect?
    private var detailsSize = NSSize(width: 350, height: 300)
    lazy var panelMotion = ShelfPanelMotionController(window: panel)
    private lazy var detailsMotion = ShelfPanelMotionController(window: detailsPanel)
    let completion = ShelfCompletionWindow()
    init(id: UUID, store: ShelfStore, app: ShelfApplication) {
        self.id = id
        let frame = NSRect(x: 100, y: 100, width: 200, height: 208)
        panel = ShelfPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = store.shelf(id)?.name ?? "新的悬浮窗"
        panel.level = .floating; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false; panel.isMovableByWindowBackground = false
        // 窗口必须是【不透明】的。之前设的是 isOpaque=false + clear 背景，而面板内容画的是
        // 圆角矩形：圆角在顶边上 alpha 为 0，系统判定那一整条"没有东西"，压根不往窗口派
        // 鼠标事件 —— 表现就是架子顶部 24 像素怎么拖都没反应，点击还穿透到后面的窗口。
        //
        // 但只把底色改成透明是不行的（实测试过）：一旦窗口实际画出来的东西在顶边是
        // 透明的，系统就不认那一条，顶边死区立刻回来。
        //
        // 所以底色仍然是不透明（保住整块矩形都收事件），改为把【窗口自己那层】也切
        // 圆角 —— 不透明的底色被圆角裁掉，四个角自然透出后面的桌面，而顶边依然可命中。
        panel.isOpaque = true; panel.backgroundColor = .windowBackgroundColor; panel.hasShadow = true
        // NSWindow 自己没有 layer，要切圆角得切它的主题框（就是画窗口底色那一层）。
        if let frame = panel.contentView?.superview {
            frame.wantsLayer = true
            frame.layer?.cornerRadius = 24
            frame.layer?.masksToBounds = true
        }
        panel.minSize = NSSize(width: 170, height: 160)
        detailsPanel = ShelfPanel(contentRect: NSRect(x: 100, y: 100, width: 350, height: 300), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        detailsPanel.title = "收集架内容"
        detailsPanel.level = .floating; detailsPanel.isFloatingPanel = true; detailsPanel.hidesOnDeactivate = false
        detailsPanel.isReleasedWhenClosed = false; detailsPanel.isOpaque = false
        detailsPanel.backgroundColor = .clear; detailsPanel.hasShadow = true
        // 空白玻璃=拖动面板（AppKit 原生：没被控件认领的拖拽都归窗口移动），
        // 卡片堆仍拖出文件、按钮仍点击，互不抢。
        panel.isMovableByWindowBackground = true
        detailsPanel.isMovableByWindowBackground = true
        super.init()
        panel.delegate = self
        panel.onMoveEnded = { [weak app] in app?.dockIfNearEdge(id) }
        for detail in [false, true] {
        let target = detail ? detailsPanel : panel
        let receiver = DropHostView(frame: NSRect(origin: .zero, size: target.frame.size))
        // 给 contentView 铺一层**不透明**底色。
        //
        // 窗口已经是 opaque 的，但窗口服务器决定"这一块要不要派鼠标事件"看的是
        // 实际合成出来的像素。面板顶部那条（顶部留白 + ✕ / ⌄ 两个浮层按钮所在的一条）
        // 底下没有任何一层 NSView 画过东西，合成结果全透明，事件不派进窗口——
        // 表现是面板顶部整条点不动，⌄ 打不开菜单、✕ 关不掉，而中下部一切正常。
        //
        // `cornerRadius` + `masksToBounds` 照旧在，四角仍然透出后面的桌面，
        // 视觉上没有变化；这里只是让"没画东西"的那条不再被当成空白。
        receiver.wantsLayer = true
        receiver.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        receiver.shelfID = id
        receiver.isDetailSurface = detail
        receiver.layer?.cornerRadius = 24; receiver.layer?.masksToBounds = true
        let view = ShelfView(store: store, activity: app.activity, id: id,
            close: { app.close(id) }, addFiles: { app.addFiles(to: id) }, paste: { _ = app.receive(.general, shelf: id) }, receive: { app.receive($0, shelf: id) }, instantDrop: { app.instantDrop($0, action: $1, shelf: id) },
            resize: { [weak self] size in
              guard let self else { return }
              if detail { self.resizeDetails(size); return }
                let available = (self.panel.screen ?? NSScreen.main)?.visibleFrame
                let fitted = NSSize(width: min(size.width, available?.width ?? size.width), height: min(size.height, available?.height ?? size.height))
                var frame = self.panel.frame; frame.origin.y += frame.height - fitted.height; frame.size = fitted
                if let available { frame.origin.x = min(max(frame.minX, available.minX), available.maxX - fitted.width); frame.origin.y = min(max(frame.minY, available.minY), available.maxY - fitted.height) }
                guard self.panel.frame != frame else { return }
                self.panel.setFrame(frame, display: true, animate: self.panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
                self.positionDetails(animated: self.detailsPanel.isVisible)
            },
            dock: { app.dock(id) }, run: { app.perform($0, shelf: id, itemIDs: $1) },
            execute: { app.execute($0, shelf: id) }, utility: { app.performUtility($0, shelf: id, itemIDs: $1) },
            preset: { app.performPreset($0, shelf: id, itemIDs: $1) }, share: { app.share($0, shelf: id, itemIDs: $1) },
            preview: { app.showPreview($0) }, dragEnded: { operation, urls, keep in app.dragFinished(operation, shelf: id, draggedURLs: urls, keepOpen: keep) },
            detailSurface: detail, detailsVisibility: { [weak self] in self?.setDetailsVisible($0) },
            focusDetails: { [weak self] in self?.detailsPanel.makeKeyAndOrderFront(nil) },
            focusCompact: { [weak self] in self?.panel.makeKeyAndOrderFront(nil) },
            contextAction: { app.contextAction($0, shelf: id, itemIDs: $1) }, retryUpload: { app.retryUpload(shelf: id) })
        let host = NSHostingView(rootView: view)
        host.frame = receiver.bounds; host.autoresizingMask = [.width, .height]
        receiver.hostingView = host
        receiver.addSubview(host)
        if !detail {
          let edge = ShelfEdgeView(frame: receiver.bounds); edge.autoresizingMask = [.width, .height]
          // #3：双击边缘按设置分派（dock/hide/none，默认停靠）；点击时读当下设置。
          edge.doubleClick = { [weak app] in
            guard let app else { return }
            switch ShelfInteractionRules.edgeDoubleClickCommand(for: app.store.settings.edgeDoubleClick) {
            case "hide": app.close(id)
            case "none": break
            default: app.dock(id)
            }
          }
          receiver.addSubview(edge)
        }
        receiver.onReceive = { pasteboard in
            app.receive(pasteboard, shelf: id)
        }
        // 顶部拖动条的悬停淡入。必须走 AppKit（见 DropHostView.onHoverChanged 的说明）：
        // 架子属于后台 accessory 进程，SwiftUI 的 onHover 在这里一次都不触发。
        if !detail {
            receiver.onHoverChanged = { hovering in
                NotificationCenter.default.post(
                    name: Notification.Name("ShelfPanelHover"), object: id, userInfo: ["hovering": hovering]
                )
            }
        }
        receiver.canReceive = { !app.busy.contains(id) }
        target.contentView = receiver
        target.onCommand = { command in
            if command == "dockLeft" { app.dock(id, edge: "left") }
            else if command == "dockRight" { app.dock(id, edge: "right") }
            else { NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: command, userInfo: ["detail": detail]) }
        }
        target.localBindings = { [weak app] in app?.store.settings.localShortcutBindings ?? [] }
        target.onNumber = { [weak app] in app?.chooseNumber($0) ?? false }
        }
        applySettings(store.settings, ownSpace: store.shelf(id)?.ownSpace)
    }
    func resizeDetails(_ size: NSSize) {
        detailsSize = size
        positionDetails(animated: detailsPanel.isVisible)
    }
    func positionDetails(animated: Bool = false) {
        // 翻转过程中 `windowDidResize` 会连着回调好几次；不挡住的话它会拿
        // 目标帧把动画一帧一帧地覆盖掉，最后窗口就停在架子的尺寸上不动了。
        guard !flipping else { return }
        let available = (panel.screen ?? NSScreen.main)?.visibleFrame ?? panel.frame
        let frame = ShelfDetailLayout.frame(anchor: panel.frame, proposed: detailsSize, visible: available)
        if detailsPanel.frame != frame {
            detailsPanel.setFrame(frame, display: true, animate: animated)
        }
    }
    /// 架子本体在内容面板展开时让位：淡出并且不吃鼠标，收起时再回来。
    ///
    /// 不这么做的话两块面板是**叠在一起**的（内容面板和架子同心，见
    /// `ShelfDetailLayout`）——底下那块架子的卡片和胶囊会从内容面板边上露出来，
    /// 看上去还是"弹了一个窗"。参考应用那里内容面板是**独占**的。
    private func setShelfDimmed(_ dimmed: Bool) {
        let target: CGFloat = dimmed ? 0 : 1
        guard abs(panel.alphaValue - target) > 0.01 else { return }
        let animate = panel.isVisible && !ShelfMotion.reduceMotion
        if animate {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.16
                panel.animator().alphaValue = target
            }
        } else {
            panel.alphaValue = target
        }
        panel.ignoresMouseEvents = dimmed
    }
    func setDetailsVisible(_ visible: Bool) {
        if visible, panel.isVisible {
            positionDetails()
            // 目标帧必须**先**取出来：下面会把窗口摆回架子那块矩形，取晚了拿到的
            // 就不是目标帧，动画会变成"原地不动"。
            let target = detailsPanel.frame
            if detailsPanel.parent == nil { panel.addChildWindow(detailsPanel, ordered: .above) }
            setShelfDimmed(true)
            flipIn(from: ShelfDetailLayout.collapsedFrame(anchor: panel.frame), to: target)
            detailsMotion.reveal()
        } else {
            detailsMotion.conceal { [weak self] in
                guard let self else { return }
                if self.detailsPanel.parent === self.panel { self.panel.removeChildWindow(self.detailsPanel) }
                self.setShelfDimmed(false)
            }
        }
    }
    /// 内容面板从架子那块矩形长到最终尺寸，中心和起点都对得上。
    private func flipIn(from start: NSRect, to target: NSRect) {
        guard !ShelfMotion.reduceMotion, target.width > start.width + 1 else {
            detailsPanel.setFrame(target, display: true)
            return
        }
        flipping = true
        detailsPanel.setFrame(start, display: true)
        detailsPanel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.26
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            detailsPanel.animator().setFrame(target, display: true)
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated { self?.flipping = false }
        })
    }
    private var flipping = false
    func hideImmediately() {
        detailsMotion.hideImmediately()
        if detailsPanel.parent === panel { panel.removeChildWindow(detailsPanel) }
        panelMotion.hideImmediately()
    }
    func windowDidMove(_ notification: Notification) { positionDetails() }
    func windowDidResize(_ notification: Notification) { positionDetails() }
    func applySettings(_ settings: ShelfSettings, ownSpace: Bool? = nil) {
        panel.collectionBehavior = (ownSpace ?? settings.ownSpace) ? [.moveToActiveSpace, .fullScreenAuxiliary] : [.canJoinAllSpaces, .fullScreenAuxiliary]
        detailsPanel.collectionBehavior = panel.collectionBehavior
        dockHandle?.panel.collectionBehavior = panel.collectionBehavior
    }
}

@MainActor
final class ShelfApplication: NSObject, NSApplicationDelegate, @preconcurrency QLPreviewPanelDataSource {
    let store = ShelfStore()
    let hosted = ProcessInfo.processInfo.arguments.contains("--hosted")
    var hostedConnectionClosed = false
    lazy var hostedBridge = ShelfHostedBridge(app: self)
    var windows: [UUID: ShelfWindow] = [:]
    var preferencesWindow: NSWindow?
    var statusItem: NSStatusItem?
    var statusDrop: StatusDropView?
    var bindings: Set<AnyCancellable> = []
    var previewURLs: [URL] = []
    let activity = ShelfActivity()
    var busy: Set<UUID> { get { activity.busy } set { activity.busy = newValue } }
    private var operationTokens: [UUID: UUID] = [:]
    private var scriptWindows: [UUID: ShelfScriptConsole] = [:]
    private var scriptTasks: [UUID: Task<Void, Never>] = [:]
    // #47：每架至多一个涂黑窗口；窗口开着期间架子保持忙碌，避免并发改动原文件。
    private var redactionControllers: [UUID: ShelfRedactionController] = [:]
    // #84：快速上手引导窗（独立浮窗，hosted/独立运行都能弹）。
    private var onboardingWindow: NSWindow?
    var shortcutErrors: [String] = []
    private var loginEnabled: Bool?
    private var outsideMonitors: [Any] = []
    private var draggingShelf: UUID?
    lazy var notch: NotchDropTarget = NotchDropTarget { [weak self] pasteboard in
        guard let self else { return false }
        let accepted = self.receive(pasteboard, shelf: self.collectionTarget())
        self.notch.hide(after: 0.25)
        return accepted
    }
    lazy var activation = ActivationMonitor(settings: { [weak self] in self?.store.settings ?? .init() }, onActivate: { [weak self] point in self?.activateWhileDragging(point) }, onShortcut: { [weak self] in self?.shortcut($0) }, onDragState: { [weak self] active in
        guard let self else { return }
        if active, self.store.settings.notchEnabled { self.notch.show() }
        else { self.notch.hide(after: 0.25) }
        // #19：外部拖拽会话期间挂上数字选架（会话结束即拆）。
        if active { self.beginDragNumberSelection() } else { self.endDragNumberSelection() }
    })
    lazy var folders = FolderMonitor(onFiles: { [weak self] urls in self?.collectWatchedFiles(urls) }, onError: { [weak self] in self?.store.lastError = $0 }, onScreenshots: { [weak self] urls in
        guard let self else { return }
        let id = self.collectionTarget(behavior: self.store.settings.screenshotAdditionBehavior)
        _ = self.store.add(urls, to: id); self.show(id)
    }, onStates: { [weak self] states in
        // #33：健康快照进 store，设置页徽标与托管快照都从这一份取。
        self?.store.publishWatchedHealth(states)
    })

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard store.storageAvailable else {
            if hosted { hostedBridge.start() }
            else { alert(store.lastError ?? ShelfStorageError.unavailable.localizedDescription) }
            return
        }
        if hosted {
            do {
                let settings = try ShelfHostedSettings.merged([:], into: store.settings)
                try store.transaction { store.settings = settings }
            } catch { try? FileHandle.standardError.write(contentsOf: Data((error.localizedDescription + "\n").utf8)) }
            hostedBridge.start()
        }
        ShelfIntentBridge.collectFiles = { [weak self] urls in
            guard let self else { throw ShelfAutomationError.unavailable }
            self.collect(try ShelfAutomationRequest.validatedFiles(urls))
        }
        // #27：FilesFromShelf / OpenLastShelf 两枚意图直连引擎状态。
        ShelfIntentBridge.filesFromShelf = { [weak self] in
            guard let self,
                  let selection = ShelfInteractionRules.filesFromShelf(
                      current: self.activity.currentShelfID,
                      shelves: self.store.shelves.map { ($0.id, $0.visible ?? true, $0.items) }) else { return [] }
            return selection.items.map(\.resolvedURL)
        }
        ShelfIntentBridge.openLastShelf = { [weak self] in
            guard let self else { throw ShelfAutomationError.unavailable }
            if let id = ShelfInteractionRules.lastCollapsedShelf(shelves: self.store.shelves.map { ($0.id, $0.visible ?? true) }) {
                self.show(id)
            }
        }
        NSApp.servicesProvider = self; NSUpdateDynamicServices()
        if !hosted { setMainMenu() }
        applySettings()
        activation.start(); shortcutErrors = activation.shortcutErrors
        for shelf in store.shelves where shelf.visible != false { show(shelf.id) }
        if !hosted, store.shelves.isEmpty { _ = newShelf(); showPreferences() }
        store.$settings.dropFirst().debounce(for: .milliseconds(200), scheduler: DispatchQueue.main).sink { [weak self] _ in self?.applySettings(); _ = self?.store.persist() }.store(in: &bindings)
        store.$shelves.debounce(for: .milliseconds(150), scheduler: DispatchQueue.main).sink { [weak self] _ in self?.rebuildStatusMenu() }.store(in: &bindings)
        store.$lastError.compactMap { $0 }.removeDuplicates().sink { [weak self] error in
            guard let self else { return }
            if self.hosted { try? FileHandle.standardError.write(contentsOf: Data((error + "\n").utf8)) }
            else { self.alert(error) }
        }.store(in: &bindings)
        NotificationCenter.default.publisher(for: Notification.Name("WispShelfShortcutCaptureStarted")).sink { [weak self] _ in self?.activation.stop() }.store(in: &bindings)
        NotificationCenter.default.publisher(for: Notification.Name("WispShelfShortcutCaptureEnded")).sink { [weak self] _ in self?.activation.start(); self?.shortcutErrors = self?.activation.shortcutErrors ?? []; self?.rebuildStatusMenu() }.store(in: &bindings)
        NotificationCenter.default.publisher(for: Notification.Name("ShelfDragStarted")).sink { [weak self] in self?.draggingShelf = $0.object as? UUID }.store(in: &bindings)
        NotificationCenter.default.publisher(for: Notification.Name("ShelfDragEnded")).sink { [weak self] _ in self?.draggingShelf = nil }.store(in: &bindings)
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged, handler: { [weak self] event in
            self?.publishDragFeedback(event.modifierFlags); return event
        }) { outsideMonitors.append(monitor) }
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged, handler: { [weak self] event in
            Task { @MainActor in self?.publishDragFeedback(event.modifierFlags) }
        }) { outsideMonitors.append(monitor) }
        if !hosted, ProcessInfo.processInfo.arguments.contains("--preferences") { showPreferences() }
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown, handler: { [weak self] event in
            if let self, let window = event.window, let id = self.windows.first(where: { $0.value.panel === window || $0.value.detailsPanel === window })?.key { self.activity.currentShelfID = id }
            self?.collapseOutside(event.window); return event
        }) { outsideMonitors.append(monitor) }
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown, handler: { [weak self] _ in Task { @MainActor in self?.collapseOutside(nil) } }) { outsideMonitors.append(monitor) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !store.storageAvailable { return .terminateNow }
        if !busy.isEmpty {
            let alert = NSAlert(); alert.messageText = "操作仍在进行"; alert.informativeText = "退出会中断尚未完成的操作。"; alert.addButton(withTitle: "继续等待"); alert.addButton(withTitle: "退出")
            if alert.runModal() == .alertFirstButtonReturn { return .terminateCancel }
        }
        if !saveWindowPositions() {
            guard hosted && hostedConnectionClosed else { return .terminateCancel }
            try? FileHandle.standardError.write(contentsOf: Data("Wisp 已断开，收集架保存失败。保留原清单后退出。\n".utf8))
        }
        notch.hide()
        activation.stop(); folders.stop(); for monitor in outsideMonitors { NSEvent.removeMonitor(monitor) }
        endDragNumberSelection()
        store.releaseStorage()
        return .terminateNow
    }
    @discardableResult func saveWindowPositions() -> Bool {
        do {
            try store.transaction {
                for (id, window) in windows {
                    let frame = window.undockedFrame ?? window.panel.frame
                    // 存盘前先把位置夹回所在屏幕的可见范围内。菜单栏和程序坞会吃掉
                    // 屏幕边缘，不夹的话架子会被存成半个身子在屏幕外，下次启动直接
                    // 恢复到那个越界位置，而且越界后更难用鼠标把它拖回来。
                    let area = window.panel.screen?.visibleFrame
                    var x = frame.minX, y = frame.minY
                    if let area, frame.width <= area.width, frame.height <= area.height {
                        x = min(max(frame.minX, area.minX), area.maxX - frame.width)
                        y = min(max(frame.minY, area.minY), area.maxY - frame.height)
                    }
                    store.updateShelf(id) { $0.x = x; $0.y = y }
                }
            }
            return true
        } catch { return false }
    }
    func terminateHosted() {
        guard busy.isEmpty else { return }
        NSApp.terminate(nil)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showPreferences(); return true }
    private func publishDragFeedback(_ flags: NSEvent.ModifierFlags) {
        if let id = draggingShelf { NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: id, userInfo: ["keepOpen": flags.contains(.shift)]) }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        let files = urls.filter(\.isFileURL)
        if !files.isEmpty { collect(files) }
        for url in urls where url.scheme?.lowercased() == ShelfAutomationRequest.scheme {
            do {
                // #26：collect 之外认识 shelf/new 与 shelf/last（与宿主侧同一套校验）。
                switch try ShelfAutomationRequest.command(from: url) {
                case .collect(let collected): collect(collected)
                case .newShelf: _ = newShelf()
                case .lastShelf:
                    if let id = ShelfInteractionRules.lastCollapsedShelf(shelves: store.shelves.map { ($0.id, $0.visible ?? true) }) {
                        show(id)
                    }
                }
            }
            catch { alert(error.localizedDescription) }
        }
    }

    @discardableResult func newShelf(at point: NSPoint? = nil, allowFocus: Bool = true) -> UUID {
        let id = store.createShelf(); show(id, at: point, allowFocus: allowFocus); return id
    }
    func show(_ id: UUID, at point: NSPoint? = nil, allowFocus: Bool = true) {
        guard let shelf = store.shelf(id) else { return }
        // 停靠态的「显示」= 重建停靠把手，不出悬浮窗（B1：停靠的出口是把手上的
        // 「取消停靠」，别处的 show 不得顺手把停靠架子变回悬浮窗）。
        if let edge = shelf.dockEdge {
            let controller = windows[id] ?? ShelfWindow(id: id, store: store, app: self)
            windows[id] = controller
            if controller.dockHandle == nil {
                // 先摆回存档位置，panel.screen 才能落在停靠边那块屏上。
                if let x = shelf.x, let y = shelf.y { controller.panel.setFrameOrigin(NSPoint(x: x, y: y)) }
                dock(id, edge: edge)
            } else { controller.dockHandle?.panel.orderFrontRegardless() }
            return
        }
        let controller = windows[id] ?? ShelfWindow(id: id, store: store, app: self)
        let fresh = windows[id] == nil; windows[id] = controller
        activity.currentShelfID = id
        if fresh || point != nil {
            let screen = point.flatMap { p in NSScreen.screens.first { $0.frame.contains(p) } } ?? NSScreen.main ?? NSScreen.screens[0]
            let f = screen.visibleFrame; let s = controller.panel.frame.size
            let position: NSPoint
            // 这个架子是用存档位置恢复出来的吗？autoPlace 只能给"没有位置的新架子"
            // 兜底，不能覆盖玩家自己摆好的位置。之前这里不区分两者，每次显示都重排，
            // 架子就会一轮轮往右漂，最后整块挂到屏幕外面抓不到。
            var restored = false
            if let point { position = NSPoint(x: min(max(point.x - s.width / 2, f.minX), f.maxX - s.width), y: min(max(point.y - s.height / 2, f.minY), f.maxY - s.height)) }
            else if let x = shelf.x, let y = shelf.y, let home = NSScreen.screens.first(where: { $0.visibleFrame.intersects(NSRect(x: x, y: y, width: s.width, height: s.height)) })?.visibleFrame, s.width <= home.width, s.height <= home.height {
                // 存档里的位置也可能已经越界（老版本存的、或者显示器拔了插了）。
                // 这里按"它落在哪块屏上"夹回去，而不是按主屏。
                position = NSPoint(x: min(max(x, home.minX), home.maxX - s.width), y: min(max(y, home.minY), home.maxY - s.height))
                restored = true
            }
            else {
                // #78：默认位置含「中央」档；原点计算收进纯函数便于单测，夹边仍在下方统一做。
                position = ShelfInteractionRules.defaultOrigin(
                    kind: store.settings.defaultPosition, visible: f, size: s,
                    cursor: NSEvent.mouseLocation, cascade: CGFloat(windows.count - 1) * 20)
            }
            var placed = position
            if store.settings.autoPlace, point == nil, !restored {
                let columns = max(1, Int((f.width - 36) / (s.width + 14)))
                let index = max(0, windows.count - 1)
                placed = NSPoint(x: f.maxX - s.width - 18 - CGFloat(index % columns) * (s.width + 14), y: f.maxY - s.height - 18 - CGFloat(index / columns) * (s.height + 14))
            }
            placed.x = min(max(placed.x, f.minX), f.maxX - s.width); placed.y = min(max(placed.y, f.minY), f.maxY - s.height)
            controller.panel.setFrameOrigin(placed)
        }
        let screen = NSScreen.screens.first { $0.visibleFrame.intersects(controller.panel.frame) } ?? NSScreen.main
        if let screen {
            var frame = controller.panel.frame
            frame.size.width = min(frame.width, screen.visibleFrame.width); frame.size.height = min(frame.height, screen.visibleFrame.height)
            if fresh, let lifted = store.placeLifted(id, size: frame.size,
                                                    proposed: NSPoint(x: min(max(frame.minX, screen.visibleFrame.minX), screen.visibleFrame.maxX - frame.width),
                                                                      y: min(max(frame.minY, screen.visibleFrame.minY), screen.visibleFrame.maxY - frame.height)),
                                                    visible: screen.visibleFrame) {
                // A1/B1：新建/恢复的悬浮窗一律抬离屏边 ≥40px 并持久化——否则从停靠
                // 恢复的窗口还停在 12px 吸附圈里，一拖又吸回去。
                frame.origin = lifted
            } else {
                frame.origin.x = min(max(frame.minX, screen.visibleFrame.minX), screen.visibleFrame.maxX - frame.width)
                frame.origin.y = min(max(frame.minY, screen.visibleFrame.minY), screen.visibleFrame.maxY - frame.height)
            }
            controller.panel.setFrame(frame, display: true)
        }
        controller.panel.title = shelf.name
        controller.panelMotion.reveal {
            if allowFocus, self.store.settings.focusOnShow {
                NSApp.activate(ignoringOtherApps: true)
                controller.panel.makeKeyAndOrderFront(nil)
            } else { controller.panel.orderFrontRegardless() }
        }
        controller.setDetailsVisible(shelf.detailsVisible == true || store.actionDraft(for: id) != nil)
        store.updateShelf(id) { $0.visible = true }
        if hosted { hostedBridge.scheduleState() }
        // #19：拖拽会话进行中，新亮起来的架子也要领到编号徽标。
        if dragNumbersActive { assignDragNumbers() }
    }
    /// ✕ = 收起（A1）：销毁窗口/把手，架子留在 shelves、visible=false。
    /// 内容、位置、停靠边全保留，下次 show 按原样恢复。
    func hide(_ id: UUID) {
        if let panel = windows[id]?.panel { store.updateShelf(id) { $0.x = panel.frame.minX; $0.y = panel.frame.minY } }
        windows[id]?.dockHandle?.dismiss(); windows[id]?.dockHandle = nil
        windows[id]?.completion.dismiss()
        if let window = windows[id] {
            window.hideImmediately()
            window.detailsPanel.contentView = nil; window.detailsPanel.onCommand = nil
            window.detailsPanel.onNumber = nil; window.detailsPanel.localBindings = nil; window.detailsPanel.close()
        }
        if let panel = windows[id]?.panel {
            panel.contentView = nil; panel.onCommand = nil; panel.onNumber = nil; panel.localBindings = nil; panel.close()
        }
        windows.removeValue(forKey: id)
        activity.retryRequests.removeValue(forKey: id); activity.numbers.removeValue(forKey: id); activity.uploads.removeValue(forKey: id)
        store.hide(id)
        rebuildStatusMenu()
        if hosted { hostedBridge.scheduleState() }
    }
    func close(_ id: UUID) {
        guard !busy.contains(id) else { alert("当前窗口仍在操作，请等待结果后收起。"); return }
        hide(id)
    }
    /// 真正删除架子（管理页「删除架子」）。只移除收集架，不删除其中的文件。
    func removeShelf(_ id: UUID) {
        hide(id)
        store.removeShelf(id)
    }
    /// B1：停靠的显式出口。销毁把手、dockEdge 置空，悬浮窗从停靠位恢复——
    /// 恢复的 undockedFrame 本来就贴在 8px 处（12px 吸附圈之内），必须抬离 ≥40px。
    func undock(_ id: UUID) {
        guard let window = windows[id] else { return }
        store.updateShelf(id) { $0.dockEdge = nil }
        window.dockHandle?.dismiss(); window.dockHandle = nil
        if let frame = window.undockedFrame { window.panel.setFrame(frame, display: true) }
        window.undockedFrame = nil
        if let screen = window.panel.screen ?? NSScreen.main,
           let lifted = store.placeLifted(id, size: window.panel.frame.size,
                                          proposed: window.panel.frame.origin, visible: screen.visibleFrame) {
            window.panel.setFrameOrigin(lifted)
        }
        activity.currentShelfID = id
        window.panelMotion.reveal { window.panel.makeKeyAndOrderFront(nil) }
        store.updateShelf(id) { $0.visible = true }
        rebuildStatusMenu()
        if hosted { hostedBridge.scheduleState() }
    }
    func dock(_ id: UUID, edge: String? = nil) {
        guard !busy.contains(id) else { return }
        guard let panel = windows[id]?.panel, let screen = panel.screen ?? NSScreen.main else { return }
        let f = screen.visibleFrame; var p = panel.frame.origin
        let distances = [abs(panel.frame.minX - f.minX), abs(panel.frame.maxX - f.maxX), abs(panel.frame.minY - f.minY), abs(panel.frame.maxY - f.maxY)]
        let side = edge ?? ["left", "right", "bottom", "top"][distances.firstIndex(of: distances.min() ?? 0) ?? 0]
        switch side {
        case "left": p.x = f.minX + 8
        case "right": p.x = f.maxX - panel.frame.width - 8
        case "bottom": p.y = f.minY + 8
        default: p.y = f.maxY - panel.frame.height - 8
        }
        panel.setFrameOrigin(p)
        store.updateShelf(id) { $0.x = p.x; $0.y = p.y; $0.dockEdge = side; $0.visible = true }
        guard let shelf = store.shelf(id), let window = windows[id] else { return }
        let keepFocus = panel.isKeyWindow || window.detailsPanel.isKeyWindow
        window.undockedFrame = panel.frame
        window.dockHandle?.dismiss()
        window.dockHandle = ShelfDockHandle(id: id, name: shelf.name, urls: shelf.items.map(\.resolvedURL), memberIDs: shelf.items.map(\.id), copyOnly: store.settings.copyOnDrag, edge: side, focus: keepFocus,
            originalFrame: panel.frame, screen: screen,
            undock: { [weak self] in self?.undock(id) },
            hide: { [weak self] in self?.close(id) },
            receive: { [weak self] pb in self?.receive(pb, shelf: id) ?? false }, canReceive: { [weak self] in self?.busy.contains(id) == false },
            dragEnded: { [weak self] operation, urls, keep in self?.dragFinished(operation, shelf: id, draggedURLs: urls, keepOpen: keep) })
        window.dockHandle?.panel.collectionBehavior = panel.collectionBehavior
        window.hideImmediately()
        if hosted { hostedBridge.scheduleState() }
    }
    func dockIfNearEdge(_ id: UUID) {
        guard !busy.contains(id), let panel = windows[id]?.panel, let visible = panel.screen?.visibleFrame else { return }
        let distances: [(String, CGFloat)] = [("left", abs(panel.frame.minX - visible.minX)), ("right", abs(panel.frame.maxX - visible.maxX)),
            ("bottom", abs(panel.frame.minY - visible.minY)), ("top", abs(panel.frame.maxY - visible.maxY))]
        if let nearest = distances.min(by: { $0.1 < $1.1 }), nearest.1 <= 12 { dock(id, edge: nearest.0) }
    }
    func collectionTarget(behavior: String? = nil) -> UUID {
        let effective = behavior ?? store.settings.additionBehavior
        if effective == "current" {
            if let id = activity.currentShelfID, store.shelf(id) != nil { return id }
            if let id = store.shelves.last?.id { return id }
        }
        // #38「添加到可见窗口」：最近使用的可见架（悬浮面板或停靠把手），无则新建。
        if effective == "visible", let id = visibleCollectionTarget() { return id }
        return newShelf()
    }
    /// 可见架候选：本会话仍有可见载体（悬浮面板或停靠把手）且未收起的架子。
    func visibleCollectionTarget() -> UUID? {
        ShelfInteractionRules.visibleTarget(
            current: activity.currentShelfID,
            shelves: store.shelves.map { shelf in
                (id: shelf.id,
                 visible: shelf.visible != false
                   && (windows[shelf.id]?.panel.isVisible == true || windows[shelf.id]?.dockHandle != nil))
            })
    }
    func activateWhileDragging(_ point: NSPoint) {
        // #84：真实拖动激活落地时广播一次——快速上手的「晃动试玩」页靠它检测。
        NotificationCenter.default.post(name: Notification.Name("ShelfDragActivated"), object: nil)
        if let empty = store.shelves.last(where: { $0.items.isEmpty && !busy.contains($0.id) && windows[$0.id]?.panel.isVisible == true }) {
            show(empty.id, at: point, allowFocus: false)
            return
        }
        let current = activity.currentShelfID.flatMap { store.shelf($0) } ?? store.shelves.last
        if store.settings.additionBehavior == "current", let current {
            show(current.id, at: current.items.isEmpty ? point : nil, allowFocus: false)
        } else if store.settings.additionBehavior == "visible", let id = visibleCollectionTarget() {
            show(id, at: store.shelf(id)?.items.isEmpty == true ? point : nil, allowFocus: false)
        } else {
            _ = newShelf(at: point, allowFocus: false)
        }
    }
    func collect(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        let id = collectionTarget()
        let base = store.contentDirectory.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        let managed = urls.filter { $0.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(base) }
        _ = store.add(urls.filter { !managed.contains($0) }, to: id)
        _ = store.add(managed, to: id, managed: true)
        show(id)
    }
    private func collectWatchedFiles(_ urls: [URL]) {
        // #32：perFileNewShelf 规则命中的文件各开一个新架（批量导出场景）；
        // 其余文件照旧整批，走 additionBehavior 的目标选择。
        let groups = ShelfInteractionRules.watchedFileGroups(files: urls, folders: store.settings.watchedFolders)
        var lastPerFileID: UUID?
        for file in groups.perFile {
            let id = store.createShelf(name: file.lastPathComponent)
            _ = store.add([file], to: id)
            show(id)
            lastPerFileID = id
        }
        if !groups.batched.isEmpty {
            collect(groups.batched)
            guard let first = groups.batched.first, let id = activity.currentShelfID else { return }
            let folder = FileManager.default.displayName(atPath: first.deletingLastPathComponent().path)
            let type = UTType(filenameExtension: first.pathExtension)
            let kind = type?.conforms(to: .movie) == true ? "视频" : type?.conforms(to: .image) == true ? "图片" : "文件"
            finishNotice(shelf: id, title: "\(folder) 中的新\(kind)", message: "已收集 \(groups.batched.count) 项，原文件仍在原位置。", outputs: [])
        } else if let lastPerFileID {
            finishNotice(shelf: lastPerFileID, title: "已收集 \(groups.perFile.count) 个新文件",
                message: "按规则为每个文件各开了一个新窗口，原文件仍在原位置。", outputs: [])
        }
    }
    func addFiles(to id: UUID) {
        let picker = NSOpenPanel(); picker.canChooseFiles = true; picker.canChooseDirectories = true; picker.allowsMultipleSelection = true; picker.prompt = "加入架子"
        NSApp.activate(ignoringOtherApps: true)
        if picker.runModal() == .OK { _ = store.add(picker.urls, to: id); show(id) }
    }
    func collapseOutside(_ clicked: NSWindow?) {
        guard store.settings.closeDetailsOutside else { return }
        for (id, window) in windows where window.panel.isVisible && clicked !== window.panel {
            guard clicked !== window.detailsPanel,
                  !window.panel.frame.contains(NSEvent.mouseLocation),
                  !window.detailsPanel.isVisible || !window.detailsPanel.frame.contains(NSEvent.mouseLocation),
                  window.panel.attachedSheet == nil, window.detailsPanel.attachedSheet == nil else { continue }
            NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "collapse")
        }
    }
    func clipboardShelf() {
        let id = collectionTarget()
        if !receive(.general, shelf: id) { alert("剪贴板里没有可收集的文件、图片、文字或链接，或架子正在操作。") }
        show(id)
    }
    func receive(_ pasteboard: NSPasteboard, shelf id: UUID, completed: @escaping ([UUID]) -> Void = { _ in }) -> Bool {
        guard !busy.contains(id) else { return false }
        busy.insert(id)
        activity.currentShelfID = id
        let retract = store.settings.retractAfterDrop && store.shelf(id)?.items.isEmpty == true
        let accepted = ContentReceiver.receive(pasteboard, store: store, shelf: id) { [weak self] ids in
            guard let self else { return }
            self.busy.remove(id)
            if !ids.isEmpty, self.windows[id]?.dockHandle != nil { self.undock(id) }
            if retract {
                NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "collapse")
                self.dock(id)
            }
            completed(ids)
        }
        if !accepted { busy.remove(id) }
        return accepted
    }
    func instantDrop(_ pasteboard: NSPasteboard, action: String, shelf id: UUID) -> Bool {
        receive(pasteboard, shelf: id) { [weak self] ids in
            guard let self, !ids.isEmpty else { return }
            if action.hasPrefix("action:"), let kind = ActionKind(rawValue: String(action.dropFirst(7))) { self.perform(kind, shelf: id, itemIDs: ids) }
            else if action.hasPrefix("preset:"), let preset = self.store.settings.customActions.first(where: { $0.id.uuidString == String(action.dropFirst(7)) }) { self.performPreset(preset, shelf: id, itemIDs: ids) }
            else if action.hasPrefix("utility:") { self.performUtility(String(action.dropFirst(8)), shelf: id, itemIDs: ids) }
            else { self.share(action, shelf: id, itemIDs: ids) }
        }
    }
    func shortcut(_ id: String) {
        switch id {
        case "new": _ = newShelf()
        case "clipboard": clipboardShelf()
        case "selection": numberShelves()
        case "reopen": if let id = store.shelves.last(where: { $0.visible != true })?.id { show(id) }
        case "closeAll": for id in Array(windows.keys) { close(id) }
        case "toggle":
            let handles = windows.values.compactMap(\.dockHandle)
            let visible = handles.contains { $0.panel.isVisible }
            for handle in handles { if visible { handle.panel.orderOut(nil) } else { handle.panel.orderFrontRegardless() } }
        default: break
        }
    }
    func numberShelves() {
        let ids = store.shelves.filter { windows[$0.id]?.panel.isVisible == true }.map(\.id)
        activity.numbers = ShelfInteractionRules.numberAssignments(ids: ids)
        if let first = ids.first { NSApp.activate(ignoringOtherApps: true); windows[first]?.panel.makeKeyAndOrderFront(nil) }
    }
    func chooseNumber(_ value: String) -> Bool {
        guard !activity.numbers.isEmpty else { return false }
        if value == "\u{1b}" { activity.numbers = [:]; return true }
        guard let id = ShelfInteractionRules.targetForDigit(value, numbers: activity.numbers) else { return false }
        activity.numbers = [:]
        show(id); windows[id]?.panel.makeKeyAndOrderFront(nil)
        return true
    }

    // MARK: - #19 拖拽会话数字选架

    /// 外部拖拽会话激活期间挂全局键盘监听：按 1-9 把目标切到对应架子（Esc 清除编号）。
    /// 全局 keyDown 监听需要「输入监控」权限；没有权限时事件不达，行为安静降级。
    private var dragNumberMonitor: Any?
    private var dragNumbersActive = false

    func beginDragNumberSelection() {
        dragNumbersActive = true
        assignDragNumbers()
        guard dragNumberMonitor == nil else { return }
        dragNumberMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            Task { @MainActor in
                guard let self, self.dragNumbersActive,
                      event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty else { return }
                let value = event.charactersIgnoringModifiers ?? ""
                if value == "\u{1b}" { self.activity.numbers = [:]; return }
                if let id = ShelfInteractionRules.targetForDigit(value, numbers: self.activity.numbers) {
                    self.activity.numbers = [:]
                    // 悬浮面板是非激活面板，置前/置键不会打断源应用正在进行的拖拽会话。
                    self.show(id)
                    self.windows[id]?.panel.makeKeyAndOrderFront(nil)
                }
            }
        }
    }

    func endDragNumberSelection() {
        if let dragNumberMonitor { NSEvent.removeMonitor(dragNumberMonitor) }
        dragNumberMonitor = nil
        if dragNumbersActive { activity.numbers = [:] }
        dragNumbersActive = false
    }

    private func assignDragNumbers() {
        let ids = store.shelves.filter { windows[$0.id]?.panel.isVisible == true }.map(\.id)
        activity.numbers = ShelfInteractionRules.numberAssignments(ids: ids)
    }
    func selectionShelf() {
        guard AXIsProcessTrusted() else { alert("读取其他应用的选中项目需要辅助功能权限。也可以使用访达的“服务 → 加入收集架”，无需让应用读取整屏。"); return }
        guard let target = NSWorkspace.shared.frontmostApplication, target.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
        let app = AXUIElementCreateApplication(target.processIdentifier)
        var focus: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focus) == .success, let focus else { return }
        let element = unsafeBitCast(focus, to: AXUIElement.self)
        var selected: CFTypeRef?
        _ = AXUIElementCopyAttributeValue(element, kAXSelectedChildrenAttribute as CFString, &selected)
        if selected == nil { _ = AXUIElementCopyAttributeValue(element, kAXSelectedRowsAttribute as CFString, &selected) }
        var urls: [URL] = []
        func visit(_ element: AXUIElement, depth: Int) {
            guard depth < 5, urls.count < 100 else { return }
            var value: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXURLAttribute as CFString, &value) == .success {
                if let url = value as? URL, url.isFileURL { urls.append(url) }
                else if let string = value as? String, let url = URL(string: string), url.isFileURL { urls.append(url) }
            }
            var children: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success, let children = children as? [AXUIElement] { for child in children.prefix(100) { visit(child, depth: depth + 1) } }
        }
        if let rows = selected as? [AXUIElement] { for row in rows { visit(row, depth: 0) } }
        if urls.isEmpty { alert("当前应用没有提供可读取的选中文件。请拖入文件，或使用系统服务菜单。"); return }
        collect(urls)
    }
    @objc func collectService(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        let id = collectionTarget()
        if !receive(pasteboard, shelf: id) { error.pointee = "没有收到可收集的内容" }
    }

    func showPreferences() {
        if hosted { hostedBridge.navigate("settings"); return }
        if preferencesWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 740, height: 600), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "收集架设置"; window.titleVisibility = .hidden; window.titlebarAppearsTransparent = true
            window.minSize = NSSize(width: 700, height: 560); window.isReleasedWhenClosed = false
            window.isOpaque = false; window.backgroundColor = .clear
            window.contentView = NSHostingView(rootView: PreferencesView(store: store, newShelf: { [weak self] in _ = self?.newShelf() },
                                                                         onGuide: { [weak self] in self?.presentOnboarding() },
                                                                         onScreenshotTest: { [weak self] in
                                                                             try? self?.runScreenshotTest()
                                                                         }))
            window.center(); preferencesWindow = window
        }
        NSApp.activate(ignoringOtherApps: true); preferencesWindow?.makeKeyAndOrderFront(nil)
    }
    /// #84：三页交互式快速上手（晃动试玩→投放完成→收起/找回）。
    /// 独立浮窗承载：hosted 模式没有原生设置窗，sheet 无处挂。
    func presentOnboarding() {
        onboardingWindow?.close()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 420),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "收集架 · 快速上手"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: ShelfOnboardingView(store: store, onFinish: { [weak self] in
            self?.onboardingWindow?.close()
            self?.onboardingWindow = nil
        }))
        window.center()
        onboardingWindow = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
    /// #34：「拍一张试试」——调起系统交互截图，直接落到设置的截图文件夹里，
    /// FolderMonitor 检测到 kMDItemIsScreenCapture 后照常亮架。
    func runScreenshotTest() throws {
        guard store.settings.screenshotMonitoringEnabled, !store.settings.screenshotDirectory.isEmpty else {
            throw ShelfHostedError.invalidRequest
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let directory = URL(fileURLWithPath: store.settings.screenshotDirectory, isDirectory: true)
        let target = directory.appendingPathComponent("Wisp 收集架测试 " + formatter.string(from: Date()) + ".png")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-i", target.path]
        try process.run()
    }
    /// #34：系统「截屏」设置深链（关闭浮动缩略图的入口）。主程序的 open_url 只放行
    /// http(s)，深链统一由引擎侧用 NSWorkspace 打开。
    func openScreenshotSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Screenshots") {
            NSWorkspace.shared.open(url)
        }
    }
    func applySettings() {
        NSApp.setActivationPolicy(!hosted && store.settings.showDock ? .regular : .accessory)
        if !hosted, store.settings.showMenuBar, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: 28)
            item.button?.image = ShelfSymbols.image(.shelf, pointSize: 16, accessibilityDescription: "收集架")
            let drop = StatusDropView(frame: item.button?.bounds ?? NSRect(x: 0, y: 0, width: 28, height: 22))
            drop.autoresizingMask = [.width, .height]
            drop.onClick = { [weak self] in self?.showStatusMenu() }
            drop.onReceive = { [weak self] pb in guard let self else { return false }; return self.receive(pb, shelf: self.collectionTarget()) }
            item.button?.addSubview(drop); statusItem = item; statusDrop = drop
        } else if (hosted || !store.settings.showMenuBar), let statusItem { NSStatusBar.system.removeStatusItem(statusItem); self.statusItem = nil; statusDrop = nil }
        for window in windows.values { window.applySettings(store.settings, ownSpace: store.shelf(window.id)?.ownSpace) }
        let screenshotDirectory = store.settings.screenshotMonitoringEnabled && !store.settings.screenshotDirectory.isEmpty ? store.settings.screenshotDirectory : nil
        folders.update(store.settings.watchedFolders, screenshotDirectory: screenshotDirectory)
        activation.refreshShortcuts(); shortcutErrors = activation.shortcutErrors
        if !hosted, loginEnabled != store.settings.startAtLogin, Bundle.main.bundleURL.pathExtension == "app" {
            do {
                if store.settings.startAtLogin { try SMAppService.mainApp.register() }
                else if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
                loginEnabled = store.settings.startAtLogin
            } catch { store.lastError = "登录启动设置未生效：\(error.localizedDescription)"; loginEnabled = store.settings.startAtLogin }
        }
        rebuildStatusMenu()
    }
    func showStatusMenu() { rebuildStatusMenu(); if let menu = statusItem?.menu, let button = statusItem?.button { menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button) } }
    func rebuildStatusMenu() {
        if let windowMenu = NSApp.mainMenu?.items.first(where: { $0.title == "窗口" })?.submenu {
            if let previous = windowMenu.item(withTag: 4376) { windowMenu.removeItem(previous) }
            let all = NSMenu()
            for shelf in store.shelves { windows[shelf.id]?.panel.title = shelf.name; all.addItem(shelfMenuItem(shelf)) }
            let item = NSMenuItem(title: "所有架子（\(store.shelves.count)）", action: nil, keyEquivalent: "")
            item.tag = 4376; item.submenu = all; windowMenu.addItem(item)
        }
        guard let statusItem else { return }
        let menu = NSMenu()
        add(menu, "新的悬浮窗", #selector(menuNew), "")
        add(menu, "从剪贴板创建", #selector(menuClipboard), "")
        add(menu, "选择架子", #selector(menuNumberShelves), "")
        add(menu, "切换停靠架子", #selector(menuToggleDocked), "")
        menu.addItem(.separator())
        let pinned = Array(store.shelves.filter(\.pinned).prefix(6))
        for shelf in pinned { menu.addItem(shelfMenuItem(shelf, prefix: "固定 · ")) }
        if !store.shelves.isEmpty {
            let all = NSMenu()
            for shelf in store.shelves {
                windows[shelf.id]?.panel.title = shelf.name
                all.addItem(shelfMenuItem(shelf))
            }
            let item = NSMenuItem(title: "所有架子（\(store.shelves.count)）", action: nil, keyEquivalent: "")
            item.submenu = all; menu.addItem(item)
        }
        // #2：托盘「收起的架子」子菜单——visible=false 的架子列表，点击即重新显示；无收起项时隐藏整组。
        let collapsedShelves = store.shelves.filter { ($0.visible ?? true) != true }
        if !collapsedShelves.isEmpty {
            let collapsed = NSMenu()
            for shelf in collapsedShelves { collapsed.addItem(shelfMenuItem(shelf)) }
            let item = NSMenuItem(title: "收起的架子（\(collapsedShelves.count)）", action: nil, keyEquivalent: "")
            item.submenu = collapsed; menu.addItem(item)
        }
        if !store.shelves.isEmpty, !store.shelves.filter(\.pinned).isEmpty { menu.addItem(.separator()) }
        if let capacity = try? store.directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage, capacity < 500_000_000 {
            let warning = NSMenuItem(title: "储存空间不足，文件生成可能失败", action: nil, keyEquivalent: ""); warning.isEnabled = false; menu.addItem(warning)
        }
        for error in shortcutErrors { let item = NSMenuItem(title: error, action: nil, keyEquivalent: ""); item.isEnabled = false; menu.addItem(item) }
        add(menu, "快速开始指南…", #selector(guide), "")
        add(menu, "关于收集架…", #selector(about), "")
        add(menu, "偏好设置…", #selector(menuPreferences), ",")
        menu.addItem(.separator()); add(menu, "退出", #selector(quit), "q")
        statusItem.menu = menu
    }
    private func shelfMenuItem(_ shelf: Shelf, prefix: String = "") -> NSMenuItem {
        let current = shelf.id == activity.currentShelfID ? " · 当前" : ""
        let item = NSMenuItem(title: "\(prefix)\(shelf.name) · \(shelf.items.count) 项\(current)", action: #selector(menuShow(_:)), keyEquivalent: "")
        item.target = self; item.representedObject = shelf.id.uuidString
        let date = Calendar.current.isDateInToday(shelf.createdAt)
            ? "今天 " + shelf.createdAt.formatted(date: .omitted, time: .shortened)
            : shelf.createdAt.formatted(date: .abbreviated, time: .shortened)
        let title = NSMutableAttributedString(string: shelf.name + "\n", attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .medium)])
        title.append(NSAttributedString(string: "\(shelf.pinned ? "固定 · " : "")\(shelf.items.count) 项 · \(date)", attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]))
        item.attributedTitle = title
        if let url = shelf.items.last?.resolvedURL {
            let source = ShelfThumbnailCache.shared.image(for: url, size: 32, scale: 2) { [weak self] in self?.rebuildStatusMenu() }
            let image = NSImage(size: NSSize(width: 32, height: 32))
            image.lockFocus()
            source.draw(in: NSRect(x: 1, y: 1, width: 30, height: 30))
            if shelf.pinned { ShelfSymbols.image(.pinned, pointSize: 12, accessibilityDescription: "固定")?.withSymbolConfiguration(.init(paletteColors: [.controlAccentColor]))?.draw(in: NSRect(x: 20, y: 0, width: 12, height: 12)) }
            image.unlockFocus(); item.image = image
        } else { item.image = ShelfSymbols.image(shelf.pinned ? .pinned : .shelf) }
        item.state = shelf.id == activity.currentShelfID ? .on : .off
        return item
    }
    private func add(_ menu: NSMenu, _ title: String, _ selector: Selector, _ key: String) { let item = NSMenuItem(title: title, action: selector, keyEquivalent: key); item.target = self; menu.addItem(item) }
    func setMainMenu() {
        let main = NSMenu(); let app = NSMenu(); let root = NSMenuItem(); root.submenu = app; main.addItem(root)
        add(app, "关于收集架…", #selector(about), ""); add(app, "偏好设置…", #selector(menuPreferences), ",")
        let services = NSMenu(); let serviceItem = NSMenuItem(title: "服务", action: nil, keyEquivalent: ""); serviceItem.submenu = services; app.addItem(serviceItem); NSApp.servicesMenu = services
        app.addItem(.separator()); add(app, "退出", #selector(quit), "q")
        let edit = NSMenu(title: "编辑"); let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: ""); editItem.submenu = edit; main.addItem(editItem)
        for (title, selector, key) in [("撤销", Selector(("undo:")), "z"), ("剪切", #selector(NSText.cut(_:)), "x"), ("复制", #selector(NSText.copy(_:)), "c"), ("粘贴", #selector(NSText.paste(_:)), "v"), ("全选", #selector(NSText.selectAll(_:)), "a")] { edit.addItem(NSMenuItem(title: title, action: selector, keyEquivalent: key)) }
        let window = NSMenu(title: "窗口"); let windowItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: ""); windowItem.submenu = window; main.addItem(windowItem); add(window, "新的悬浮窗", #selector(menuNew), "n")
        add(window, "选择架子", #selector(menuNumberShelves), "")
        add(window, "切换停靠架子", #selector(menuToggleDocked), "")
        NSApp.mainMenu = main
    }
    @objc func menuNew() { let id = newShelf(); windows[id]?.panel.makeKeyAndOrderFront(nil) }
    @objc func menuClipboard() { clipboardShelf() }
    @objc func menuNumberShelves() { numberShelves() }
    @objc func menuToggleDocked() { shortcut("toggle") }
    @objc func menuPreferences() { showPreferences() }
    @objc func menuShow(_ sender: NSMenuItem) {
        if let raw = sender.representedObject as? String, let id = UUID(uuidString: raw) {
            show(id)
            // 停靠架子 show 只重建把手；悬浮窗仍是收起状态，不能顺手把它顶出来。
            if store.shelf(id)?.dockEdge == nil { windows[id]?.panel.makeKeyAndOrderFront(nil) }
        }
    }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Wisp Shelf（收集架）", .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.2.0", .credits: NSAttributedString(string: "独立实现的文件收集工具。参考功能目标为悬浮架5.3.1，不是官方应用。")]); NSApp.activate(ignoringOtherApps: true) }
    @objc func guide() { presentOnboarding() }
    func alert(_ message: String) { let alert = NSAlert(); alert.messageText = "收集架"; alert.informativeText = message; alert.addButton(withTitle: "好"); if let preferencesWindow, preferencesWindow.isVisible { alert.beginSheetModal(for: preferencesWindow) } else { NSApp.activate(ignoringOtherApps: true); alert.runModal() } }

    func showPreview(_ urls: [URL]) {
        previewURLs = urls.filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !previewURLs.isEmpty, let panel = QLPreviewPanel.shared() else { alert("选中的文件目前都不可访问，请重新关联文件或连接磁盘。"); return }
        if previewURLs.count < urls.count, let id = activity.currentShelfID {
            finishNotice(shelf: id, title: "部分文件不可访问", message: "仅预览 \(previewURLs.count) / \(urls.count) 项。", outputs: [])
        }
        panel.dataSource = self; panel.reloadData(); panel.makeKeyAndOrderFront(nil)
    }
    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { previewURLs.count }
    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! { previewURLs[index] as NSURL }
    func dragFinished(_ operation: NSDragOperation, shelf id: UUID, draggedURLs: [URL], keepOpen: Bool) {
        guard !operation.isEmpty, !keepOpen else { return }
        let moved = !draggedURLs.isEmpty && draggedURLs.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }
        if store.settings.closeAfterDrag == "always" || (store.settings.closeAfterDrag == "moved" && operation.contains(.move) && moved) { close(id) }
    }
    func items(_ id: UUID, _ selected: [UUID]) -> [ShelfItem] { let all = store.shelf(id)?.items ?? []; return selected.isEmpty ? all : all.filter { selected.contains($0.id) } }
    func destination() -> URL? { let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true; panel.prompt = "选择目标文件夹"; NSApp.activate(ignoringOtherApps: true); return panel.runModal() == .OK ? panel.url : nil }
    func perform(_ kind: ActionKind, shelf id: UUID, itemIDs: [UUID]) {
        guard !busy.contains(id), !items(id, itemIDs).isEmpty else { return }
        activity.currentShelfID = id
        NotificationCenter.default.post(name: Notification.Name("ShelfSelection.\(id.uuidString)"), object: itemIDs)
        guard store.beginActionDraft(kind, for: id) else { return }
        show(id)
        NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "compose")
        windows[id]?.detailsPanel.makeKeyAndOrderFront(nil)
    }
    func performPreset(_ preset: ActionPreset, shelf id: UUID, itemIDs: [UUID]) {
        guard !busy.contains(id), !items(id, itemIDs).isEmpty else { return }
        NotificationCenter.default.post(name: Notification.Name("ShelfSelection.\(id.uuidString)"), object: itemIDs)
        guard store.setActionDraft(ShelfActionDraft(preset: preset), for: id) else { return }
        show(id)
        NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "compose")
        windows[id]?.detailsPanel.makeKeyAndOrderFront(nil)
    }
    func execute(_ request: ActionRequest, shelf id: UUID) {
        guard !busy.contains(id) else { alert("此窗口的操作仍在进行，请等待结果。"); return }
        var request = request
        if request.sourceOrdinals == nil {
            request.sourceOrdinals = Dictionary(request.sources.enumerated().map { ($0.element, $0.offset + 1) }, uniquingKeysWith: { first, _ in first })
        }
        busy.insert(id)
        activity.retryRequests[id] = request
        activity.currentShelfID = id
        let token = UUID(); operationTokens[id] = token
        activity.progress[id] = "处理 0 / \(request.sources.count) 项"
        let sourceItemIDs = Dictionary((store.shelf(id)?.items ?? []).filter { request.sources.contains($0.resolvedURL) }.map { ($0.resolvedURL, $0.id) }, uniquingKeysWith: { first, _ in first })
        store.updateShelf(id) { shelf in for index in shelf.items.indices where request.sources.contains(shelf.items[index].resolvedURL) { shelf.items[index].result = "处理中…" } }
        Task { [self] in
            let outcomes = await ActionEngine.execute(request, progress: { [weak self] outcome in
                Task { @MainActor in
                    guard let self, self.operationTokens[id] == token, self.busy.contains(id) else { return }
                    self.store.record([outcome], shelf: id, moving: request.kind == .move || request.kind == .rename, sourceItemIDs: sourceItemIDs)
                    let completedIDs = Set(sourceItemIDs.values)
                    let completed = self.store.shelf(id)?.items.filter { completedIDs.contains($0.id) && $0.result != "处理中…" }.count ?? 0
                    self.activity.progress[id] = "已处理 \(completed) / \(request.sources.count) 项"
                }
            })
            store.record(outcomes, shelf: id, moving: request.kind == .move || request.kind == .rename, sourceItemIDs: sourceItemIDs)
            busy.remove(id)
            operationTokens.removeValue(forKey: id); activity.progress.removeValue(forKey: id)
            var draft = ShelfActionDraft(kind: request.kind)
            draft.destination = request.destination?.path ?? ""; draft.name = request.name
            draft.widthText = String(request.width); draft.quality = request.quality
            draft.format = request.format; draft.application = request.application?.path ?? ""
            draft.counterStartText = String(request.counterStart); draft.resizeMode = request.resizeMode
            draft.maxWidthText = String(request.maxWidth); draft.maxHeightText = String(request.maxHeight)
            draft.percentText = String(request.scalePercent); draft.afterOutput = request.afterOutput
            _ = store.rememberAction(draft)
            let failed = outcomes.filter { !$0.succeeded }
            let outputURLs = Array(Set(outcomes.filter(\.succeeded).compactMap(\.output)))
            // #48：按声明的「输出后动作」处理产物（keep=什么都不做）。
            let afterOutput = ShelfInteractionRules.afterOutputOutcome(for: request.afterOutput)
            if afterOutput == "replace", !outputURLs.isEmpty {
                store.record(outcomes, shelf: id, moving: true, sourceItemIDs: sourceItemIDs)
            }
            if afterOutput == "newShelf", !outputURLs.isEmpty {
                let newID = store.createShelf(name: "\(request.kind.title)结果")
                _ = store.add(outputURLs, to: newID)
                show(newID)
            }
            if afterOutput == "reveal", !outputURLs.isEmpty {
                NSWorkspace.shared.activateFileViewerSelecting(outputURLs)
            }
            // #48：完成卡片给出对应的后续操作（手动补做三种去向）。
            var actions: [ShelfCompletionAction] = []
            if !outputURLs.isEmpty, store.shelf(id) != nil {
                actions.append(ShelfCompletionAction(title: "结果加入新架子", symbol: ShelfSymbols.name(.newShelf)) { [weak self] in
                    guard let self else { return }
                    let newID = self.store.createShelf(name: "\(request.kind.title)结果")
                    _ = self.store.add(outputURLs, to: newID)
                    self.show(newID)
                })
                actions.append(ShelfCompletionAction(title: "用结果替换架内条目", symbol: ShelfSymbols.action(.convertImages)) { [weak self] in
                    guard let self else { return }
                    self.store.record(outcomes, shelf: id, moving: true, sourceItemIDs: sourceItemIDs)
                })
            }
            finishNotice(shelf: id, title: "\(request.kind.title) · 完成 \(outcomes.count - failed.count) 项",
                message: failed.isEmpty ? "结果已保留，可继续使用相同参数。" : "失败 \(failed.count) 项：" + (failed.first?.message ?? ""),
                outputs: outputURLs, actions: actions)
        }
    }
    func finishNotice(shelf id: UUID, title: String, message: String, outputs: [URL],
                      actions: [ShelfCompletionAction] = []) {
        guard let window = windows[id] else { return }
        window.completion.show(below: window.panel, title: title, message: message, outputs: outputs, actions: actions)
    }
    func performUtility(_ raw: String, shelf id: UUID, itemIDs: [UUID]) {
        // #47：涂黑是逐张画框的交互窗口，不走批量引擎。
        if raw == "redactImages" { presentRedaction(shelf: id, itemIDs: itemIDs); return }
        guard let action = ShelfUtilityAction(rawValue: raw), !busy.contains(id) else { return }
        let sources = items(id, itemIDs).map(\.resolvedURL)
        guard !sources.isEmpty else { return }
        var destination: URL?
        if action == .removeImageMetadata { guard let chosen = self.destination() else { return }; destination = chosen }
        if action == .moveToTrash {
            let confirmation = NSAlert(); confirmation.messageText = "将 \(sources.count) 个原文件移到废纸篓？"
            confirmation.informativeText = "这会改变原文件的位置，不只是移除架子中的引用。"
            confirmation.addButton(withTitle: "移到废纸篓"); confirmation.addButton(withTitle: "取消")
            guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        }
        busy.insert(id); activity.currentShelfID = id
        activity.retryRequests.removeValue(forKey: id)
        let sourceIDs = Dictionary(items(id, itemIDs).map { ($0.resolvedURL, $0.id) }, uniquingKeysWith: { first, _ in first })
        Task {
            let result = await ShelfUtilities.execute(.init(action: action, sources: sources, destination: destination))
            if let text = result.clipboardText { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string) }
            let outcomes = result.outcomes.map { ActionOutcome(source: $0.source, output: $0.output, succeeded: $0.succeeded, message: $0.message) }
            store.record(outcomes, shelf: id, moving: false, sourceItemIDs: sourceIDs)
            if action == .moveToTrash { store.remove(Set(outcomes.filter(\.succeeded).compactMap { sourceIDs[$0.source] }), from: id) }
            busy.remove(id)
            let failed = outcomes.filter { !$0.succeeded }
            finishNotice(shelf: id, title: "完成 \(outcomes.count - failed.count) 项",
                message: failed.isEmpty ? "操作已完成。" : "失败 \(failed.count) 项：" + (failed.first?.message ?? ""),
                outputs: action == .moveToTrash ? [] : outcomes.filter(\.succeeded).compactMap(\.output))
        }
    }
    /// #47：打开手动涂黑窗口（架子动作菜单 → 涂黑…，整批图片时可用）。
    /// 导出/替换逐张回执到条目结果列；窗口关闭时解除忙碌。
    func presentRedaction(shelf id: UUID, itemIDs: [UUID]) {
        guard !busy.contains(id) else { return }
        let selected = items(id, itemIDs)
        guard !selected.isEmpty else { return }
        guard selected.allSatisfy(\.isAvailable) else { alert("部分原文件不可访问，请重新连接磁盘。"); return }
        if let existing = redactionControllers[id] {
            NSApp.activate(ignoringOtherApps: true)
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        busy.insert(id)
        activity.currentShelfID = id
        let sourceIDs = Dictionary(selected.map { ($0.resolvedURL, $0.id) }, uniquingKeysWith: { first, _ in first })
        let controller = ShelfRedactionController(
            sources: selected.map(\.resolvedURL),
            apply: { [weak self] outcome in
                self?.store.record([outcome], shelf: id, moving: false, sourceItemIDs: sourceIDs)
            },
            onComplete: { [weak self] in
                guard let self else { return }
                self.redactionControllers.removeValue(forKey: id)
                self.busy.remove(id)
            })
        redactionControllers[id] = controller
        controller.show()
    }

    func revealInWisp(_ urls: [URL]) {
        guard hosted, !hostedConnectionClosed else {
            alert("收集架未连接 Wisp 主窗口，请从 Wisp 打开收集架后重试。")
            return
        }
        do { try hostedBridge.revealInWisp(urls) }
        catch { alert("无法在 Wisp 中显示：\(error.localizedDescription)") }
    }

    func contextAction(_ command: String, shelf id: UUID, itemIDs: [UUID]) {
        guard !busy.contains(id), !itemIDs.isEmpty else { return }
        let selected = items(id, itemIDs)
        guard selected.count == Set(itemIDs).count else { return }
        if command == "remove" { store.remove(Set(itemIDs), from: id); return }
        if command == "moveToNewShelf" {
            if let next = store.moveItemsToNewShelf(Set(itemIDs), from: id) {
                show(next)
                windows[next]?.panel.makeKeyAndOrderFront(nil)
            }
            return
        }
        guard selected.allSatisfy(\.isAvailable) else { alert("部分原文件不可访问，请重新连接磁盘。"); return }
        let urls = selected.map(\.resolvedURL)
        switch command {
        case "preview": showPreview(urls)
        case "open": urls.forEach { NSWorkspace.shared.open($0) }
        case "reveal": revealInWisp(urls)
        case "revealInFinder": NSWorkspace.shared.activateFileViewerSelecting(urls)
        case "copyItems": NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects(urls.map { $0 as NSURL })
        case "getInfo":
            let info = NSAlert(); info.messageText = selected.count == 1 ? selected[0].name : "\(selected.count) 个文件"
            info.informativeText = urls.prefix(12).map { url in
                let metadata = ShelfFileMetadataReader.read(url)?.compactDescription ?? "大小未知"
                return url.lastPathComponent + " · " + metadata + "\n" + url.path
            }.joined(separator: "\n\n")
            info.addButton(withTitle: "好"); info.runModal()
        case "airdrop", "mail", "messages", "notes": share(command, shelf: id, itemIDs: itemIDs)
        default:
            if command.hasPrefix("action:"), let kind = ActionKind(rawValue: String(command.dropFirst(7))) {
                if kind == .rename, selected.count == 1 { renameFile(selected[0], shelf: id) }
                else { perform(kind, shelf: id, itemIDs: itemIDs) }
            } else if command.hasPrefix("utility:") { performUtility(String(command.dropFirst(8)), shelf: id, itemIDs: itemIDs) }
            else if command.hasPrefix("script:") { share(command, shelf: id, itemIDs: itemIDs) }
            else if command.hasPrefix("cloud:") { share(String(command.dropFirst(6)), shelf: id, itemIDs: itemIDs) }
            else if command.hasPrefix("preset:"), let preset = store.settings.customActions.first(where: { $0.id.uuidString == String(command.dropFirst(7)) }) { performPreset(preset, shelf: id, itemIDs: itemIDs) }
            else if command.hasPrefix("openWith:"), let application = URL(string: String(command.dropFirst(9))), application.isFileURL {
                NSWorkspace.shared.open(urls, withApplicationAt: application, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
                    if let error { Task { @MainActor in self?.alert(error.localizedDescription) } }
                }
            }
        }
    }
    private func renameFile(_ item: ShelfItem, shelf id: UUID) {
        let source = item.resolvedURL
        let directory = (try? source.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        let stem = directory ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
        let editor = NSTextField(string: stem); editor.frame = NSRect(x: 0, y: 0, width: 320, height: 26)
        let prompt = NSAlert(); prompt.messageText = "重新命名"
        prompt.informativeText = directory || source.pathExtension.isEmpty ? "修改原文件的名称。" : "修改原文件的名称，保留 .\(source.pathExtension) 扩展名。"
        prompt.accessoryView = editor; prompt.addButton(withTitle: "重新命名"); prompt.addButton(withTitle: "取消")
        prompt.window.initialFirstResponder = editor
        guard prompt.runModal() == .alertFirstButtonReturn, !editor.stringValue.isEmpty else { return }
        execute(ActionRequest(kind: .rename, sources: [source], name: editor.stringValue), shelf: id)
    }
    func share(_ type: String, shelf id: UUID, itemIDs: [UUID]) {
        guard !busy.contains(id) else { alert("此窗口仍在接收或处理内容，请等待。"); return }
        let urls = items(id, itemIDs).map(\.resolvedURL)
        guard !urls.isEmpty else { return }
        do {
            if try hostedBridge.shareAirDropIfHosted(type, urls: urls, hosted: hosted) { return }
        } catch {
            alert("无法打开隔空投送：\(error.localizedDescription)")
            return
        }
        if type.hasPrefix("script:") {
            let path = String(type.dropFirst(7))
            let console = ShelfScriptConsole(path: path, count: urls.count,
                run: { [weak self] test in self?.runScript(path: path, sources: test ? [] : urls, shelf: id) },
                cancel: { [weak self] in self?.scriptTasks[id]?.cancel() })
            scriptWindows[id]?.window.orderOut(nil); scriptWindows[id] = console
            console.show(); return
        }
        let name: NSSharingService.Name?
        switch type {
        case "airdrop": name = .sendViaAirDrop
        case "messages": name = .composeMessage
        case "mail": name = .composeEmail
        // 备忘录没有系统常量，只能按服务标识取。
        case "notes": name = NSSharingService.Name(rawValue: "com.apple.notes")
        default: name = nil
        }
        // 系统分享服务取不到时必须在这里停下。往下走会落进云账户分支，
        // 于是「点备忘录」弹出的是「请先在云分享设置中添加自己的服务」——驴唇不对马嘴。
        if let name {
            guard let service = NSSharingService(named: name) else {
                alert("这台 Mac 上没有可用的「\(type == "notes" ? "备忘录" : "系统分享")」目标，没有文件被送出。")
                return
            }
            NSApp.activate(ignoringOtherApps: true); service.perform(withItems: urls); return
        }
        guard !store.settings.onlineDisabled else { alert("在线功能已关闭。"); return }
        // #65：云面板默认设置——「云链接」即时动作优先用上次上传的账户；指定账户的入口不受影响。
        let account = store.settings.cloudAccounts.first { $0.id.uuidString == type }
            ?? (type == "cloud" ? rememberedCloudAccount() : nil)
        guard let account else { alert("请先在云分享设置中添加自己的服务。没有文件被上传。"); showPreferences(); return }
        let alert = NSAlert(); alert.messageText = "上传到 \(account.name)？"; alert.informativeText = "将上传 \(urls.count) 个项目的内容。网盘服务将创建任何人凭链接可读的分享；自建服务和对象存储的公开方式由你配置。请勿上传私密文件。"; alert.addButton(withTitle: "上传"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        // #65：确认上传即记住该账户，供下次「云链接」默认使用。
        store.settings.cloudLastAccountID = account.id.uuidString
        busy.insert(id)
        let controller = ShelfUploadController()
        activity.uploads[id] = controller
        controller.start(urls, account: account, credential: store.credential(for: account)) { [weak self, weak controller] result in
            guard let self, let controller else { return }
            self.finishUpload(result, controller: controller, accountName: account.name, accountID: account.id, shelf: id)
        }
    }
    /// #65：上次上传的账户仍在清单则用它，否则退回第一个（保持旧兜底行为）。
    private func rememberedCloudAccount() -> CloudAccount? {
        if let raw = store.settings.cloudLastAccountID,
           let remembered = store.settings.cloudAccounts.first(where: { $0.id.uuidString == raw }) {
            return remembered
        }
        return store.settings.cloudAccounts.first
    }

    private func finishUpload(_ result: ShelfUploadController.Result, controller: ShelfUploadController, accountName: String, accountID: UUID, shelf id: UUID) {
        busy.remove(id)
        let links = controller.completedLinks
        var historySaved = false
        if !links.isEmpty {
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(links.map(\.absoluteString).joined(separator: "\n"), forType: .string)
            // #64/#67：记录带上来源标注、到期点与撤销句柄。
            let outcome = controller.lastOutcome ?? CloudUploadOutcome(links: links)
            historySaved = store.recordCloudShare(accountName: accountName, links: links,
                message: controller.failure?.message ?? "上传完成", accountID: accountID.uuidString,
                linkSource: outcome.linkSource, expiresAt: outcome.expiresAt,
                deleteHandles: outcome.deleteHandles)
        }
        let title: String
        switch result {
        case .success: title = "已取得 \(links.count) 个分享链接"
        case .failure(let failure): title = failure.cancelled ? "上传已取消" : "上传未完成"
        }
        let savedMessage = links.isEmpty ? "" : historySaved ? "分享链接已复制，并保留在本机历史。" : "分享链接已复制；本机历史未能保存。"
        finishNotice(shelf: id, title: title, message: (controller.failure?.message ?? "") + savedMessage, outputs: [])
    }
    func retryUpload(shelf id: UUID) {
        guard !store.settings.onlineDisabled else { alert("在线功能已关闭，未发送文件。"); return }
        guard !busy.contains(id), let controller = activity.uploads[id], let failure = controller.failure else { return }
        guard let account = store.settings.cloudAccounts.first(where: { $0.id == controller.retryAccountID }),
              controller.matches(account: account, credential: store.credential(for: account)) else {
            alert("上传服务或凭据已更改，未重试。请重新选择云分享并确认新的服务配置。"); return
        }
        let confirmation = NSAlert(); confirmation.messageText = "重试未完成的 \(failure.remainingFiles.count) 项？"
        confirmation.informativeText = failure.uploadMayHaveSucceeded
            ? "最后一项可能已经到达远端，但尚未确认分享链接。重试可能产生重复文件；取消不能删除已经上传的内容。"
            : "只重试未完成的文件。已经成功的链接会继续保留，文件内容仍将发送到你配置的服务。"
        confirmation.addButton(withTitle: "重试"); confirmation.addButton(withTitle: "取消")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        busy.insert(id)
        if !controller.retryRemaining(onResult: { [weak self, weak controller] result in
            guard let self, let controller else { return }
            self.finishUpload(result, controller: controller, accountName: account.name, accountID: account.id, shelf: id)
        }) { busy.remove(id) }
    }
    func runScript(path: String, sources: [URL], shelf id: UUID) {
        guard !busy.contains(id), let console = scriptWindows[id] else { return }
        let confirmation = NSAlert(); confirmation.messageText = sources.isEmpty ? "无输入试运行脚本？" : "执行自定义脚本？"
        confirmation.informativeText = "\(path)\n将传入 \(sources.count) 个文件路径。即使没有输入，脚本也可能修改本机文件；停止执行不能撤销已经发生的改动。"
        confirmation.addButton(withTitle: "执行"); confirmation.addButton(withTitle: "取消")
        guard confirmation.runModal() == .alertFirstButtonReturn else { return }
        busy.insert(id); activity.retryRequests.removeValue(forKey: id)
        activity.progress[id] = "脚本正在执行…"
        let runID = console.session.beginRun()
        let copyOutput = store.settings.scriptCopyOutput, closeOnSuccess = store.settings.scriptCloseOnSuccess
        scriptTasks[id] = Task { [self] in
            defer { busy.remove(id); activity.progress.removeValue(forKey: id); scriptTasks.removeValue(forKey: id); console.session.busy = false }
            do {
                let result = try await ShelfScriptRunner.run(.init(script: URL(fileURLWithPath: path), sources: sources), onOutput: { snapshot in
                    Task { @MainActor in if console.session.busy { console.session.receive(snapshot, runID: runID) } }
                })
                console.session.output = result.stdout; console.session.errors = result.stderr; console.session.status = result.message
                if copyOutput, result.succeeded { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(result.stdout, forType: .string) }
                finishNotice(shelf: id, title: result.succeeded ? "脚本执行完成" : "脚本未成功完成", message: result.message, outputs: [])
                if closeOnSuccess, result.succeeded, !sources.isEmpty { busy.remove(id); close(id) }
            } catch { console.session.status = "未完成"; console.session.errors = error.localizedDescription }
        }
    }
}

@main
@MainActor
struct ShelfMain {
    static func main() {
        let hosted = ProcessInfo.processInfo.arguments.contains("--hosted")
        if hosted { signal(SIGPIPE, SIG_IGN) }
        let application = NSApplication.shared
        if !hosted {
            guard Bundle.main.object(forInfoDictionaryKey: "WispHostedComponent") as? Bool == true,
                  let host = ShelfHostedRedirector.hostApplicationURL else {
                try? FileHandle.standardError.write(contentsOf: Data("收集架是 Wisp 的内部组件，请通过 Wisp 使用。\n".utf8))
                return
            }
            let redirector = ShelfHostedRedirector(hostURL: host)
            application.delegate = redirector
            withExtendedLifetime(redirector) { application.run() }
            return
        }
        let delegate = ShelfApplication()
        application.delegate = delegate
        application.run()
    }
}
