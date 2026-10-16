import AppKit
import Carbon
import ApplicationServices
import ShelfCore

private let shelfHotKeySignature: OSType = 0x57534846

private let shelfHotKeyHandler: EventHandlerUPP = { _, event, context in
    guard let event, let context else { return OSStatus(eventNotHandledErr) }
    var identifier = EventHotKeyID()
    let status = GetEventParameter(
        event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
        nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier
    )
    guard status == noErr, identifier.signature == shelfHotKeySignature else {
        return OSStatus(eventNotHandledErr)
    }
    let monitor = Unmanaged<ActivationMonitor>.fromOpaque(context).takeUnretainedValue()
    let hotKeyID = identifier.id
    Task { @MainActor [weak monitor] in monitor?.receiveHotKey(hotKeyID) }
    return noErr
}

@MainActor
final class ActivationMonitor {
    private let settings: () -> ShelfSettings
    private let onActivate: (NSPoint) -> Void
    private let onShortcut: (String) -> Void
    private let onDragState: (Bool) -> Void
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var shelfDragObservers: [NSObjectProtocol] = []
    private var shelfDragging = false
    private var eventHandler: EventHandlerRef?
    private var hotKeyReferences: [EventHotKeyRef] = []
    private var hotKeyActions: [UInt32: String] = [:]
    private var nextHotKeyID: UInt32 = 1
    private var running = false
    private(set) var shortcutErrors: [String] = []

    var hasAccessibilityPermission: Bool { AXIsProcessTrusted() }
    var hasInputMonitoringPermission: Bool { CGPreflightListenEventAccess() }

    private var dragging = false
    private var activatedForDrag = false
    private var mouseDownPasteboardChangeCount: Int?
    private var origin: NSPoint?
    private var extremum: NSPoint?
    private var shakeAxis: ShakeAxis?
    private var shakeDirection: CGFloat = 0
    private var reversals: [TimeInterval] = []
    private var lastActivationTime: TimeInterval = -.infinity

    private enum ShakeAxis { case horizontal, vertical }
    private struct ShortcutChord: Hashable {
        let keyCode: UInt32
        let modifiers: UInt32
    }

    init(
        settings: @escaping () -> ShelfSettings,
        onActivate: @escaping (NSPoint) -> Void,
        onShortcut: @escaping (String) -> Void,
        onDragState: @escaping (Bool) -> Void = { _ in }
    ) {
        self.settings = settings
        self.onActivate = onActivate
        self.onShortcut = onShortcut
        self.onDragState = onDragState
    }

    func start() {
        guard !running else { return }
        running = true
        shelfDragObservers = [
            NotificationCenter.default.addObserver(forName: Notification.Name("ShelfDragStarted"), object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.setShelfDragging(true) }
            },
            NotificationCenter.default.addObserver(forName: Notification.Name("ShelfDragEnded"), object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.setShelfDragging(false) }
            },
            // 前台应用换了，之前缓存的"是否在忽略名单里"就作废了
            NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
            ) { [weak self] _ in MainActor.assumeIsolated { self?.frontmostCache = nil } }
        ]
        let mask: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .flagsChanged]
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
            let baseline = event.type == .leftMouseDown ? NSPasteboard(name: .drag).changeCount : nil
            // 本地监听的回调本来就跑在主线程上，而 receiveMouseEvent 是 @MainActor。
            // 原来还是绕了一次 `Task { @MainActor }`，于是光标每动一下（拖拽时是每帧）
            // 都要分配一个 Task 再异步跳回主线程。直接 assumeIsolated，省掉这一跳。
            MainActor.assumeIsolated { self?.receiveMouseEvent(event, mouseDownBaseline: baseline) }
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            let baseline = event.type == .leftMouseDown ? NSPasteboard(name: .drag).changeCount : nil
            Task { @MainActor [weak self] in self?.receiveMouseEvent(event, mouseDownBaseline: baseline) }
        }
        refreshShortcuts()
    }

    func stop() {
        running = false
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        localMonitor = nil
        globalMonitor = nil
        for observer in shelfDragObservers { NotificationCenter.default.removeObserver(observer) }
        shelfDragObservers.removeAll()
        shelfDragging = false
        unregisterShortcuts()
        if let eventHandler { RemoveEventHandler(eventHandler) }
        eventHandler = nil
        resetDrag()
        mouseDownPasteboardChangeCount = nil
        onDragState(false)
    }

    func refreshShortcuts() {
        unregisterShortcuts()
        shortcutErrors = []
        guard running else { return }

        if eventHandler == nil {
            var eventType = EventTypeSpec(
                eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)
            )
            let status = InstallEventHandler(
                GetApplicationEventTarget(), shelfHotKeyHandler, 1, &eventType,
                Unmanaged.passUnretained(self).toOpaque(), &eventHandler
            )
            guard status == noErr else {
                shortcutErrors.append("无法连接系统快捷键服务，错误代码：\(status)。")
                return
            }
        }

        var usedChords: [ShortcutChord: String] = [:]
        for binding in settings().shortcutBindings where binding.enabled {
            let chord = ShortcutChord(keyCode: binding.keyCode, modifiers: binding.modifiers)
            if let previous = usedChords[chord] {
                shortcutErrors.append("“\(binding.title)”与本应用的“\(previous)”使用了相同快捷键。")
                continue
            }
            usedChords[chord] = binding.title
            let identifier = nextHotKeyID
            nextHotKeyID &+= 1
            var reference: EventHotKeyRef?
            let status = RegisterEventHotKey(
                binding.keyCode, binding.modifiers,
                EventHotKeyID(signature: shelfHotKeySignature, id: identifier),
                GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &reference
            )
            if status == noErr, let reference {
                hotKeyReferences.append(reference)
                hotKeyActions[identifier] = binding.id
            } else if status == OSStatus(eventHotKeyExistsErr) {
                shortcutErrors.append("“\(binding.title)”的快捷键已被系统或其他应用占用，请换一组按键。")
            } else {
                shortcutErrors.append("无法注册“\(binding.title)”的快捷键，错误代码：\(status)。")
            }
        }
    }

    fileprivate func receiveHotKey(_ identifier: UInt32) {
        guard running, let action = hotKeyActions[identifier], !isIgnoredApplication(settings()) else { return }
        onShortcut(action)
    }

    private func unregisterShortcuts() {
        for reference in hotKeyReferences { UnregisterEventHotKey(reference) }
        hotKeyReferences.removeAll()
        hotKeyActions.removeAll()
    }

    private func receiveMouseEvent(_ event: NSEvent, mouseDownBaseline: Int?) {
        guard running else { return }
        if event.type == .leftMouseUp {
            onDragState(false)
            resetDrag()
            mouseDownPasteboardChangeCount = nil
            return
        }
        if event.type == .leftMouseDown {
            resetDrag()
            // Capture before the actor hop; the drag payload may already be ready afterward.
            mouseDownPasteboardChangeCount = mouseDownBaseline
            return
        }
        guard !shelfDragging else { return }
        guard NSEvent.pressedMouseButtons & 1 != 0 else {
            resetDrag()
            return
        }
        let configuration = settings()
        guard !isIgnoredApplication(configuration) else {
            resetDrag()
            return
        }
        guard event.type == .leftMouseDragged || (event.type == .flagsChanged && dragging) else { return }

        // Only inspect type metadata during a live drag; do not read or copy its contents.
        // 顺序很重要：原先先问 availableType（要同步类型列表，贵），再问 changeCount（便宜）。
        // 每一帧都这么走一遍，而拖拽剪贴板是所有进程都在读的共享资源。倒过来，
        // 先用便宜的 changeCount 把"根本没在拖东西"的情况挡掉，再去问类型。
        let pasteboard = NSPasteboard(name: .drag)
        guard let baseline = mouseDownPasteboardChangeCount else { return }
        guard pasteboard.changeCount != baseline else { return }
        guard pasteboard.availableType(from: ContentReceiver.types) != nil else { return }
        let point = NSEvent.mouseLocation
        if !dragging {
            dragging = true
            onDragState(true)
            origin = point
            extremum = point
        }
        guard !activatedForDrag else { return }

        if configuration.modifierEnabled, modifierIsHeld(configuration.activationModifier, flags: event.modifierFlags) {
            activate(at: point)
            return
        }
        if configuration.notchEnabled, isInsideNotchArea(point) {
            // The notch receiver handles the drop; do not create a second empty shelf.
            return
        }
        if configuration.shakeEnabled, event.type == .leftMouseDragged {
            trackShake(at: point, sensitivity: configuration.shakeSensitivity)
        }
    }

    private func setShelfDragging(_ active: Bool) {
        shelfDragging = active
        resetDrag()
        mouseDownPasteboardChangeCount = NSPasteboard(name: .drag).changeCount
        onDragState(false)
    }

    /// 「前台应用是不是在忽略名单里」原本每次鼠标移动都重新问一次系统。
    /// `NSWorkspace.shared.frontmostApplication` 是跨进程调用，在拖拽的每一帧上做一次
    /// 是笔实打实的开销——而且这份开销不只收集架自己受罪，系统上任何一次文件拖拽
    /// 都会走到这里。前台应用只在切换时变，缓存住、切换时清掉就够了。
    private var frontmostCache: String?
    private var frontmostIgnoredCache = false
    private var ignoredAppsCache: [String] = []
    private func isIgnoredApplication(_ configuration: ShelfSettings) -> Bool {
        let list = configuration.ignoredApps
        if list != ignoredAppsCache { ignoredAppsCache = list; frontmostCache = nil }
        if let frontmostCache { return frontmostIgnoredCache }
        let bundle = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        frontmostCache = bundle ?? ""
        frontmostIgnoredCache = list.contains { $0.caseInsensitiveCompare(bundle ?? "") == .orderedSame }
        return frontmostIgnoredCache
    }

    private func modifierIsHeld(_ name: String, flags: NSEvent.ModifierFlags) -> Bool {
        switch name {
        case "shift": return flags.contains(.shift)
        case "option": return flags.contains(.option)
        case "control": return flags.contains(.control)
        case "command": return flags.contains(.command)
        default: return false
        }
    }

    private func isInsideNotchArea(_ point: NSPoint) -> Bool {
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(point) }) else { return false }
        let inset = screen.safeAreaInsets.top
        guard inset > 0 else { return false }
        return point.y >= screen.frame.maxY - inset
            && abs(point.x - screen.frame.midX) <= max(100, inset * 2.5)
    }

    private func trackShake(at point: NSPoint, sensitivity: Double) {
        guard let origin, let previousExtremum = extremum else { return }
        let value = min(1, max(0, sensitivity.isFinite ? sensitivity : 0.6))
        let distance = CGFloat(32 - 20 * value)
        if shakeAxis == nil {
            let dx = point.x - origin.x
            let dy = point.y - origin.y
            guard max(abs(dx), abs(dy)) >= distance else { return }
            shakeAxis = abs(dx) >= abs(dy) ? .horizontal : .vertical
            shakeDirection = (shakeAxis == .horizontal ? dx : dy) >= 0 ? 1 : -1
            extremum = point
            return
        }
        let movement = shakeAxis == .horizontal
            ? point.x - previousExtremum.x : point.y - previousExtremum.y
        if movement * shakeDirection >= 0 {
            extremum = point
            return
        }
        guard abs(movement) >= distance else { return }
        shakeDirection *= -1
        extremum = point
        let now = ProcessInfo.processInfo.systemUptime
        reversals.removeAll { now - $0 > 0.85 }
        reversals.append(now)
        if reversals.count >= 3 { activate(at: point) }
    }

    private func activate(at point: NSPoint) {
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastActivationTime >= 1 else { return }
        activatedForDrag = true
        lastActivationTime = now
        onActivate(point)
    }

    private func resetDrag() {
        dragging = false
        activatedForDrag = false
        origin = nil
        extremum = nil
        shakeAxis = nil
        shakeDirection = 0
        reversals.removeAll()
    }

    deinit {
        let local = localMonitor
        let global = globalMonitor
        let observers = shelfDragObservers
        let handler = eventHandler
        let references = hotKeyReferences
        MainActor.assumeIsolated {
            if let local { NSEvent.removeMonitor(local) }
            if let global { NSEvent.removeMonitor(global) }
            for observer in observers { NotificationCenter.default.removeObserver(observer) }
            for reference in references { UnregisterEventHotKey(reference) }
            if let handler { RemoveEventHandler(handler) }
        }
    }
}
