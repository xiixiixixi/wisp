import AppKit
import ShelfCore

/// 架子右上角 ⌄ 弹出的菜单。
///
/// 目前沿用独立的菜单面板，应用图标与操作符号分别处理。
/// 它不代表竞品内部实现，也不代表系统菜单不能承载相同内容。
///
/// **为什么用事件跟踪循环而不是跟踪区/定时器**：架子是后台 accessory 进程，
/// 系统的鼠标移动事件只发给前台应用——`.mouseMoved` 跟踪区一次都不响，
/// 默认模式下的定时器也根本没有时间片。只有 `NSEvent.nextEvent` 自己从队列里取
/// 才拿得到（`NSMenu.popUp` 内部就是这么干的），所以菜单的悬停高亮、划到子菜单
/// 就展开，全部走这条循环。
///
/// 根据用户提供的完整菜单截图，按200×208点浮框换算布局。
@MainActor
enum ShelfMenuMetrics {
    static let rowHeight: CGFloat = 24
    static let separatorHeight: CGFloat = 12
    static let verticalPadding: CGFloat = 5
    static let iconSize: CGFloat = 15
    static let iconLeading: CGFloat = 16
    static let titleLeading: CGFloat = 41
    static let trailing: CGFloat = 16
    static let disclosureWidth: CGFloat = 10
    static let minWidth: CGFloat = 217
    static let maxWidth: CGFloat = 320
    static let cornerRadius: CGFloat = 12
    static let scrollIndicatorHeight: CGFloat = 14

    static func viewportSize(content: NSSize, visible: NSRect) -> NSSize {
        NSSize(width: min(content.width, max(1, visible.width - 8)),
               height: min(content.height, max(1, visible.height - 8)))
    }

    static func popupOrigin(anchor: NSRect, size: NSSize, visible: NSRect) -> NSPoint {
        // 菜单左边贴按钮左边，向卡片右侧展开；顶部与圆钮底部重叠约5点。
        var x = anchor.minX
        if x + size.width > visible.maxX { x = anchor.maxX - size.width }
        x = min(max(x, visible.minX), max(visible.minX, visible.maxX - size.width))
        let y = min(max(anchor.minY + 5 - size.height, visible.minY),
                    max(visible.minY, visible.maxY - size.height))
        return NSPoint(x: x.rounded(), y: y.rounded())
    }

    /// row 是父菜单中当前可见行的屏幕坐标，包含滚动偏移。
    static func submenuOrigin(parent: NSRect, row: NSRect, size: NSSize, visible: NSRect) -> NSPoint {
        var x = parent.maxX - 4
        if x + size.width > visible.maxX { x = parent.minX - size.width + 4 }
        x = min(max(x, visible.minX), max(visible.minX, visible.maxX - size.width))
        let y = min(max(row.maxY + verticalPadding - size.height, visible.minY),
                    max(visible.minY, visible.maxY - size.height))
        return NSPoint(x: x.rounded(), y: y.rounded())
    }
}

@MainActor
final class ShelfMenuPopup {
    /// 当前打开的菜单栈：最上面那个是子菜单。
    private static var stack: [ShelfMenuPopup] = []

    private let panel: NSPanel
    private let view: ShelfMenuPanelView
    private weak var anchor: NSView?
    private weak var parent: ShelfMenuPopup?
    private var parentRow: Int?
    static var active: ShelfMenuPopup? { stack.last }
    var selectedRow: Int? { view.selectedRow }
    var selectedTitle: String? { selectedRow.flatMap { view.node(atRow: $0)?.title } }

    private init(nodes: [ShelfMenuNode], anchor: NSView, parent: ShelfMenuPopup?) {
        self.anchor = anchor
        self.parent = parent
        let width = ShelfMenuPanelView.measureWidth(nodes)
        let view = ShelfMenuPanelView(nodes: nodes, width: width)
        view.anchor = anchor
        self.view = view
        let visible = anchor.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        let size = ShelfMenuMetrics.viewportSize(content: view.measuredSize, visible: visible)

        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        let base = anchor.window?.level ?? NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.floatingWindow)))
        panel.level = NSWindow.Level(rawValue: base.rawValue + 1)
        panel.hidesOnDeactivate = false
        panel.acceptsMouseMovedEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let host = NSView(frame: NSRect(origin: .zero, size: size))
        host.wantsLayer = true
        host.layer?.cornerRadius = ShelfMenuMetrics.cornerRadius
        host.layer?.masksToBounds = true
        let backdrop = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        backdrop.material = .menu
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.wantsLayer = true
        backdrop.layer?.cornerRadius = ShelfMenuMetrics.cornerRadius
        backdrop.layer?.masksToBounds = true
        host.addSubview(backdrop)
        view.frame = NSRect(origin: .zero, size: size)
        view.autoresizingMask = [.width, .height]
        host.addSubview(view)
        panel.contentView = host
        self.panel = panel
        view.accessibilityMenuParent = anchor
        view.onAccessiblePress = { [weak self] row in self?.performAccessiblePress(row: row) ?? false }
        view.accessibilitySubmenu = { [weak self] row in
            guard let self else { return nil }
            return Self.stack.first(where: { $0.parent === self && $0.parentRow == row })?.view
        }
    }

    // MARK: - 弹出与关闭

    /// 在 `anchor` 下方弹出并接管事件，直到用户选中、Esc 或点到外面。
    static func run(nodes: [ShelfMenuNode], anchor: NSView) {
        let popup = prepare(nodes: nodes, anchor: anchor)
        popup.panel.orderFrontRegardless()
        NSAccessibility.post(element: anchor, notification: .layoutChanged)
        popup.track()
    }

    /// 构造和摆位独立于显示/事件跟踪，便于验证菜单而不在测试时弹出窗口。
    static func prepare(nodes: [ShelfMenuNode], anchor: NSView) -> ShelfMenuPopup {
        closeAll()
        let popup = ShelfMenuPopup(nodes: nodes, anchor: anchor, parent: nil)
        stack.append(popup)
        popup.placeBelowAnchor()
        return popup
    }

    static func closeAll() {
        let wasOpen = !stack.isEmpty
        while let last = stack.popLast() { last.tearDown() }
        if wasOpen { wakeTracking() }
    }

    static func accessibilityMenu(for anchor: NSView) -> ShelfMenuPanelView? {
        stack.first(where: { $0.parent == nil && $0.anchor === anchor })?.view
    }

    private static func wakeTracking() {
        guard let event = NSEvent.otherEvent(with: .applicationDefined, location: .zero,
            modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: 0,
            context: nil, subtype: 0, data1: 0, data2: 0) else { return }
        NSApp.postEvent(event, atStart: false)
    }

    private func tearDown() {
        panel.orderOut(nil)
        if let owner = view.accessibilityMenuParent { NSAccessibility.post(element: owner, notification: .layoutChanged) }
    }

    /// 命中测试用：屏幕坐标落在哪一块菜单的哪一行上（从最上面的子菜单往下找）。
    private static func popup(atScreen point: NSPoint) -> (ShelfMenuPopup, Int)? {
        for popup in stack.reversed() where popup.panel.frame.contains(point) {
            if let row = popup.view.rowIndex(atScreen: point) { return (popup, row) }
        }
        return nil
    }

    private static func popupContainingScreen(_ point: NSPoint) -> ShelfMenuPopup? {
        stack.reversed().first { $0.panel.frame.contains(point) }
    }

    // MARK: - 事件跟踪

    private static let tracked: NSEvent.EventTypeMask = [
        .leftMouseDown, .leftMouseUp, .leftMouseDragged, .rightMouseDown, .otherMouseDown, .mouseMoved, .keyDown,
        .applicationDefined, .scrollWheel,
    ]

    /// 别的应用上的点击收不到（跟踪循环只拿本进程的事件），用全局监视兜底。
    /// 鼠标事件的全局监视**不需要辅助功能权限**，所以可以直接挂。
    private static var globalMouseMonitor: Any?
    private static var outsideClick = false

    private func track() {
        Self.outsideClick = false
        Self.globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { _ in
            MainActor.assumeIsolated {
                Self.outsideClick = true
                // 塞一个空事件把跟踪循环叫醒，否则它会一直阻塞在 nextEvent 上。
                guard let wake = NSEvent.otherEvent(
                    with: .applicationDefined, location: .zero, modifierFlags: [],
                    timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: 0,
                    context: nil, subtype: 0, data1: 0, data2: 0
                ) else { return }
                NSApp.postEvent(wake, atStart: false)
            }
        }
        defer {
            if let monitor = Self.globalMouseMonitor { NSEvent.removeMonitor(monitor) }
            Self.globalMouseMonitor = nil
        }
        // 第一段：等鼠标松开。和系统弹出按钮一致——按一下弹出来，松开之后菜单留在原地。
        while let event = NSApp.nextEvent(matching: Self.tracked, until: .distantFuture, inMode: .default, dequeue: true) {
            if handle(event) { return }
            if event.type == .leftMouseUp { break }
        }
        // 第二段：菜单留在屏幕上，等选中、Esc 或点到外面。
        while let event = NSApp.nextEvent(matching: Self.tracked, until: .distantFuture, inMode: .default, dequeue: true) {
            if handle(event) { return }
        }
    }

    /// 返回 true 表示菜单该收工了。
    private func handle(_ event: NSEvent) -> Bool {
        guard !Self.stack.isEmpty else { return true }
        if Self.outsideClick {
            Self.closeAll()
            return true
        }
        let screen = NSEvent.mouseLocation
        switch event.type {
        case .mouseMoved, .leftMouseDragged:
            Self.updateHover(at: screen)
            return false
        case .keyDown:
            return (Self.active ?? self).handleKey(event.keyCode)
        case .scrollWheel:
            let popup = Self.popupContainingScreen(screen) ?? Self.active ?? self
            popup.closeSubmenu()
            popup.view.selectRow(nil)
            let scale = event.hasPreciseScrollingDeltas ? CGFloat(1) : ShelfMenuMetrics.rowHeight
            popup.view.scroll(by: -event.scrollingDeltaY * scale)
            return false
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            guard let popup = Self.popupContainingScreen(screen) else {
                Self.closeAll()
                return true
            }
            if let direction = popup.view.scrollDirection(atScreen: screen) {
                popup.closeSubmenu()
                popup.view.scroll(by: direction * ShelfMenuMetrics.rowHeight)
                return false
            }
            guard let row = popup.view.rowIndex(atScreen: screen) else { return false }
            return popup.activate(row: row)
        case .leftMouseUp, .applicationDefined:
            return false
        default:
            return false
        }
    }

    private static func updateHover(at screen: NSPoint) {
        // 先确定鼠标在哪个菜单中；回到同一父项时保留已有子菜单，不能每帧重建。
        guard let popup = popupContainingScreen(screen) else { return }
        let row = popup.view.setHoveredRow(atScreen: screen)
        guard let row, let node = popup.view.node(atRow: row), ShelfMenuPanelView.isSubmenu(node) else {
            popup.closeSubmenu()
            return
        }
        popup.openSubmenu(node, row: row)
    }

    /// 方向键导航独立于鼠标悬停；禁用项与分隔线不会取得键盘选中状态。
    @discardableResult
    func handleKey(_ code: UInt16) -> Bool {
        switch code {
        case 53:
            Self.closeAll()
            return true
        case 125, 126:
            closeSubmenu()
            view.moveSelection(by: code == 125 ? 1 : -1)
        case 124:
            if let row = selectedRow, let node = view.node(atRow: row),
               let child = openSubmenu(node, row: row), child.selectedRow == nil {
                child.view.moveSelection(by: 1)
            }
        case 123:
            if let parent { parent.closeSubmenu() }
        case 36, 76, 49:
            guard let row = selectedRow else { return false }
            if let node = view.node(atRow: row), ShelfMenuPanelView.isSubmenu(node) {
                if let child = openSubmenu(node, row: row), child.selectedRow == nil {
                    child.view.moveSelection(by: 1)
                }
            } else { return activate(row: row) }
        default: break
        }
        return false
    }

    /// 点中某一行。返回 true 表示菜单该收工了。
    private func activate(row: Int) -> Bool {
        guard let node = view.node(atRow: row) else { return false }
        if ShelfMenuPanelView.isSubmenu(node) {
            openSubmenu(node, row: row)
            return false
        }
        guard case .item(_, _, _, let enabled, _, let action) = node, enabled else { return false }
        Self.closeAll()
        action()
        return true
    }

    private func performAccessiblePress(row: Int) -> Bool {
        guard Self.stack.contains(where: { $0 === self }),
              let node = view.node(atRow: row), node.title != nil, node.isEnabled else { return false }
        view.selectRow(row)
        if ShelfMenuPanelView.isSubmenu(node) { return openSubmenu(node, row: row) != nil }
        return activate(row: row)
    }

    // MARK: - 摆位

    private func placeBelowAnchor() {
        guard let frame = anchorFrame else { return }
        let size = panel.frame.size
        let visible = anchor?.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        panel.setFrameOrigin(ShelfMenuMetrics.popupOrigin(anchor: frame, size: size, visible: visible))
    }

    private func placeBesideParent(_ parentPopup: ShelfMenuPopup, row: NSRect) {
        let size = panel.frame.size
        let visible = parentPopup.panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        let screenRow = parentPopup.panel.convertToScreen(parentPopup.view.convert(row, to: nil))
        panel.setFrameOrigin(ShelfMenuMetrics.submenuOrigin(parent: parentPopup.panel.frame,
                                                           row: screenRow, size: size, visible: visible))
    }

    private var anchorFrame: NSRect? {
        guard let anchor, let window = anchor.window else { return nil }
        let origin = window.convertPoint(toScreen: anchor.convert(anchor.bounds.origin, to: nil))
        return NSRect(origin: origin, size: anchor.bounds.size)
    }

    // MARK: - 子菜单

    @discardableResult
    private func openSubmenu(_ node: ShelfMenuNode, row: Int) -> ShelfMenuPopup? {
        guard case .submenu(_, _, _, let enabled, let children) = node, enabled,
              let anchor = view.anchor, let rowFrame = view.rowFrame(atRow: row) else { return nil }
        if let child = Self.stack.first(where: { $0.parent === self && $0.parentRow == row }) { return child }
        closeSubmenu()
        let popup = ShelfMenuPopup(nodes: children, anchor: anchor, parent: self)
        popup.parentRow = row
        popup.view.accessibilityMenuParent = view.accessibilityElement(atRow: row)
        Self.stack.append(popup)
        popup.placeBesideParent(self, row: rowFrame)
        if panel.isVisible { popup.panel.orderFrontRegardless() }
        if let owner = popup.view.accessibilityMenuParent { NSAccessibility.post(element: owner, notification: .layoutChanged) }
        return popup
    }

    private func closeSubmenu() {
        guard let index = Self.stack.firstIndex(where: { $0 === self }) else { return }
        while Self.stack.count > index + 1 {
            Self.stack.removeLast().tearDown()
        }
    }
}

/// 菜单面板的内容视图：所有行一次画完，悬停和点击都靠算命中。
@MainActor
final class ShelfMenuPanelView: NSView {
    private(set) var nodes: [ShelfMenuNode]
    /// 菜单从这个按钮下面挂下来；子菜单摆位时要用。
    weak var anchor: NSView?
    weak var accessibilityMenuParent: AnyObject?
    var onAccessiblePress: ((Int) -> Bool)?
    var accessibilitySubmenu: ((Int) -> ShelfMenuPanelView?)?
    private var accessibilityRows: [ShelfMenuRowAccessibility] = []
    private let menuWidth: CGFloat
    /// 按视觉顺序排的行，`nodeIndex` 指回 `nodes`。
    private var slots: [Slot] = []
    private(set) var selectedRow: Int?
    private(set) var scrollOffset: CGFloat = 0

    var scrolls: Bool { measuredSize.height > bounds.height }
    private var scrollInset: CGFloat { scrolls ? ShelfMenuMetrics.scrollIndicatorHeight : 0 }
    var maximumScrollOffset: CGFloat { max(0, measuredSize.height - bounds.height + scrollInset * 2) }
    private var contentRect: NSRect { bounds.insetBy(dx: 0, dy: scrollInset) }

    private struct Slot {
        let node: ShelfMenuNode
        let nodeIndex: Int
        let frame: NSRect
    }

    init(nodes: [ShelfMenuNode], width: CGFloat) {
        self.nodes = nodes
        menuWidth = width
        super.init(frame: .zero)
        wantsLayer = true
        accessibilityRows = nodes.indices.filter { nodes[$0].title != nil }.map {
            ShelfMenuRowAccessibility(owner: self, row: $0)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .menu }
    override func accessibilityParent() -> Any? { accessibilityMenuParent ?? super.accessibilityParent() }
    override func accessibilityLabel() -> String? {
        if let row = accessibilityMenuParent as? ShelfMenuRowAccessibility, let title = row.accessibilityLabel() {
            return "\(title)菜单"
        }
        return "文件与窗口操作菜单"
    }
    override func accessibilityChildren() -> [Any]? { accessibilityRows }
    override func accessibilityVisibleChildren() -> [Any]? {
        accessibilityRows.filter { !$0.accessibilityFrame().isEmpty }
    }

    func accessibilityElement(atRow row: Int) -> ShelfMenuRowAccessibility? {
        accessibilityRows.first { $0.row == row }
    }

    fileprivate func accessibilityScreenFrame(atRow row: Int) -> NSRect {
        guard let window, let frame = rowFrame(atRow: row) else { return .zero }
        let visible = frame.intersection(contentRect)
        guard !visible.isEmpty else { return .zero }
        return window.convertToScreen(convert(visible, to: nil))
    }

    fileprivate func performAccessiblePress(atRow row: Int) -> Bool {
        guard nodes.indices.contains(row), nodes[row].isEnabled, nodes[row].title != nil else { return false }
        return onAccessiblePress?(row) ?? false
    }

    // MARK: 尺寸

    /// 菜单宽度由最长的那一行决定——标题越长菜单越宽，和系统菜单一致。
    static func measureWidth(_ nodes: [ShelfMenuNode]) -> CGFloat {
        let widest = nodes.compactMap { node -> CGFloat? in
            guard let title = node.title else { return nil }
            let text = (title as NSString).size(withAttributes: [.font: ShelfMenuPanelView.font]).width
            var width = ShelfMenuMetrics.titleLeading + text + ShelfMenuMetrics.trailing
            if ShelfMenuPanelView.isSubmenu(node) { width += ShelfMenuMetrics.disclosureWidth }
            return width
        }.max() ?? 0
        return min(max(widest, ShelfMenuMetrics.minWidth), ShelfMenuMetrics.maxWidth)
    }

    var measuredSize: NSSize {
        let height = nodes.reduce(ShelfMenuMetrics.verticalPadding * 2) {
            $0 + ($1.title == nil ? ShelfMenuMetrics.separatorHeight : ShelfMenuMetrics.rowHeight)
        }
        return NSSize(width: menuWidth, height: max(height, ShelfMenuMetrics.rowHeight))
    }

    override var intrinsicContentSize: NSSize { measuredSize }

    /// 从下往上排版：这是 AppKit 默认的**不翻转**坐标系。
    private func layOut() {
        var y = bounds.height - ShelfMenuMetrics.verticalPadding - scrollInset + scrollOffset
        var laid: [Slot] = []
        laid.reserveCapacity(nodes.count)
        for (index, node) in nodes.enumerated() {
            let height = node.title == nil ? ShelfMenuMetrics.separatorHeight : ShelfMenuMetrics.rowHeight
            y -= height
            laid.append(Slot(node: node, nodeIndex: index,
                             frame: NSRect(x: 0, y: y, width: bounds.width, height: height)))
        }
        slots = laid
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        scrollOffset = min(scrollOffset, maximumScrollOffset)
        layOut()
    }

    // MARK: 命中

    private func slotIndex(at point: NSPoint) -> Int? {
        guard contentRect.contains(point) else { return nil }
        layOut()
        return slots.firstIndex { $0.node.title != nil && $0.frame.contains(point) }
    }

    /// 屏幕坐标 → 行号。
    func rowIndex(atScreen point: NSPoint) -> Int? {
        guard let window else { return nil }
        return slotIndex(at: convert(window.convertPoint(fromScreen: point), from: nil))
    }

    func node(atRow row: Int) -> ShelfMenuNode? {
        layOut()
        guard slots.indices.contains(row) else { return nil }
        return slots[row].node
    }

    func rowFrame(atRow row: Int) -> NSRect? {
        layOut()
        guard slots.indices.contains(row) else { return nil }
        return slots[row].frame
    }

    /// 刷新悬停，返回命中的行号（没命中返回 nil）。
    @discardableResult
    func setHoveredRow(atScreen point: NSPoint) -> Int? {
        guard let window else { return nil }
        let next = slotIndex(at: convert(window.convertPoint(fromScreen: point), from: nil))
        selectRow(next, ensureVisible: false)
        return next
    }

    func selectRow(_ row: Int?, ensureVisible: Bool = true) {
        let next = row.flatMap { nodes.indices.contains($0) && nodes[$0].isEnabled ? $0 : nil }
        if next != selectedRow {
            selectedRow = next
            needsDisplay = true
            if let next, let element = accessibilityElement(atRow: next) {
                NSAccessibility.post(element: element, notification: .focusedUIElementChanged)
            }
        }
        if ensureVisible, let next { ensureRowVisible(next) }
    }

    /// 没有选中项时，下方向第一项、上方向最后一项；到边界后循环。
    @discardableResult
    func moveSelection(by direction: Int) -> Int? {
        let available = nodes.indices.filter { nodes[$0].title != nil && nodes[$0].isEnabled }
        guard !available.isEmpty else { selectRow(nil); return nil }
        let next: Int
        if let selectedRow, let current = available.firstIndex(of: selectedRow) {
            next = available[(current + (direction < 0 ? -1 : 1) + available.count) % available.count]
        } else { next = direction < 0 ? available.last! : available.first! }
        selectRow(next)
        return next
    }

    func ensureRowVisible(_ row: Int) {
        guard let frame = rowFrame(atRow: row) else { return }
        if frame.minY < contentRect.minY + ShelfMenuMetrics.verticalPadding {
            scroll(by: contentRect.minY + ShelfMenuMetrics.verticalPadding - frame.minY)
        } else if frame.maxY > contentRect.maxY - ShelfMenuMetrics.verticalPadding {
            scroll(by: contentRect.maxY - ShelfMenuMetrics.verticalPadding - frame.maxY)
        }
    }

    func scroll(by amount: CGFloat) {
        let next = min(max(scrollOffset + amount, 0), maximumScrollOffset)
        guard next != scrollOffset else { return }
        scrollOffset = next
        layOut()
        needsDisplay = true
        NSAccessibility.post(element: self, notification: .layoutChanged)
    }

    func scrollDirection(atScreen point: NSPoint) -> CGFloat? {
        guard let window else { return nil }
        return scrollDirection(at: convert(window.convertPoint(fromScreen: point), from: nil))
    }

    private func scrollDirection(at point: NSPoint) -> CGFloat? {
        guard scrolls, bounds.contains(point) else { return nil }
        if point.y >= contentRect.maxY, scrollOffset > 0 { return -1 }
        if point.y <= contentRect.minY, scrollOffset < maximumScrollOffset { return 1 }
        return nil
    }

    /// 测试用：某个点上是不是落在某一行上。
    func rowIndexForTesting(_ point: NSPoint) -> Int? { slotIndex(at: point) }

    /// 测试用：每一格（含分隔线）排好之后的矩形，下标与 `nodes` 一致。
    func slotFramesForTesting() -> [NSRect] {
        layOut()
        return slots.sorted { $0.nodeIndex < $1.nodeIndex }.map(\.frame)
    }

    override func mouseDown(with event: NSEvent) {
        // 事件都被 `ShelfMenuPopup` 的跟踪循环取走了，走到这里只是为了不让点击
        // 穿透到菜单背后的架子面板上。
        window?.makeFirstResponder(nil)
    }

    // MARK: 画

    override func draw(_ dirtyRect: NSRect) {
        layOut()
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(rect: contentRect).addClip()
        for (index, slot) in slots.enumerated() {
            guard slot.frame.intersects(dirtyRect) else { continue }
            if slot.node.title == nil {
                drawSeparator(in: slot.frame)
            } else {
                drawRow(slot.node, in: slot.frame, hovered: index == selectedRow)
            }
        }
        NSGraphicsContext.restoreGraphicsState()
        drawScrollIndicators()
    }

    private func drawScrollIndicators() {
        guard scrolls else { return }
        for (visible, symbol, y) in [
            (scrollOffset > 0, "chevron.up", bounds.maxY - scrollInset / 2),
            (scrollOffset < maximumScrollOffset, "chevron.down", scrollInset / 2),
        ] where visible {
            guard let image = ShelfSymbols.image(named: symbol, pointSize: 9, weight: .medium) else { continue }
            let box = NSRect(x: bounds.midX - 5, y: y - 4, width: 10, height: 8)
            ShelfSymbols.tinted(image, color: .secondaryLabelColor).draw(in: FileDragSource.aspectFit(image: image, in: box))
        }
    }

    private func drawSeparator(in rect: NSRect) {
        NSColor.labelColor.withAlphaComponent(0.14).setFill()
        NSRect(x: ShelfMenuMetrics.iconLeading, y: round(rect.midY),
               width: bounds.width - ShelfMenuMetrics.iconLeading * 2, height: 1).fill()
    }

    private func drawRow(_ node: ShelfMenuNode, in rect: NSRect, hovered: Bool) {
        let enabled = node.isEnabled
        let selected = hovered && enabled
        if selected {
            NSColor.selectedContentBackgroundColor.setFill()
            NSBezierPath(roundedRect: rect.insetBy(dx: 4, dy: 1), xRadius: 5, yRadius: 5).fill()
        }
        let alpha: CGFloat = enabled ? 1 : 0.38

        let ink = selected ? NSColor.selectedMenuItemTextColor : NSColor.labelColor
        let isSub = ShelfMenuPanelView.isSubmenu(node)
        let titleX = ShelfMenuMetrics.titleLeading
        let available = rect.width - titleX - ShelfMenuMetrics.trailing
            - (isSub ? ShelfMenuMetrics.disclosureWidth : 0)

        if let image = ShelfMenuPanelView.icon(for: node) {
            let side = ShelfMenuMetrics.iconSize
            let box = NSRect(x: ShelfMenuMetrics.iconLeading, y: rect.midY - side / 2,
                             width: side, height: side)
            ShelfSymbols.tinted(image, color: ink).draw(
                in: FileDragSource.aspectFit(image: image, in: box),
                from: .zero, operation: .sourceOver, fraction: alpha)
        }

        if let title = node.title {
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            (title as NSString).draw(
                in: NSRect(x: titleX, y: rect.midY - 8, width: max(0, available), height: 16),
                withAttributes: [
                    .font: ShelfMenuPanelView.font,
                    .foregroundColor: ink.withAlphaComponent(alpha),
                    .paragraphStyle: paragraph,
                ]
            )
        }

        if node.isChecked, let check = ShelfSymbols.image(named: "checkmark", pointSize: 9, weight: .medium) {
            let box = NSRect(x: 4, y: rect.midY - 5, width: 9, height: 10)
            ShelfSymbols.tinted(check, color: ink).draw(in: FileDragSource.aspectFit(image: check, in: box))
        }

        if isSub, let arrow = ShelfMenuPanelView.disclosureImage {
            let box = NSRect(x: rect.maxX - ShelfMenuMetrics.trailing - 4,
                             y: rect.midY - 5, width: 10, height: 10)
            ShelfSymbols.tinted(arrow, color: ink).draw(
                in: FileDragSource.aspectFit(image: arrow, in: box),
                from: .zero, operation: .sourceOver, fraction: alpha)
        }
    }

    // MARK: 图标

    static let font = NSFont.systemFont(ofSize: 13)

    static let disclosureImage = ShelfSymbols.image(named: "chevron.right", pointSize: 10, weight: .medium)

    /// 应用/分享服务使用真实图像，普通动作使用同一套系统单色符号。
    static func icon(for node: ShelfMenuNode) -> NSImage? {
        switch node {
        case .item(_, let symbol, let image, _, _, _):
            if let image { return image }
            guard let symbol, !symbol.isEmpty else { return nil }
            return ShelfSymbols.image(named: symbol, pointSize: ShelfMenuMetrics.iconSize, weight: .regular)
        case .submenu(_, let symbol, let image, _, _):
            if let image { return image }
            guard let symbol, !symbol.isEmpty else { return nil }
            return ShelfSymbols.image(named: symbol, pointSize: ShelfMenuMetrics.iconSize, weight: .regular)
        case .separator:
            return nil
        }
    }

    static func isSubmenu(_ node: ShelfMenuNode) -> Bool {
        if case .submenu = node { return true }
        return false
    }
}

/// 自绘行仍是可执行的菜单项。图形、菜单命中和辅助功能共用同一份节点与激活路径。
@MainActor
final class ShelfMenuRowAccessibility: NSAccessibilityElement {
    private weak var owner: ShelfMenuPanelView?
    let row: Int

    init(owner: ShelfMenuPanelView, row: Int) {
        self.owner = owner
        self.row = row
        super.init()
        setAccessibilityRole(.menuItem)
        setAccessibilityIdentifier("shelf.menu.row.\(row)")
    }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityParent() -> Any? { owner }
    override func accessibilityLabel() -> String? { owner?.node(atRow: row)?.title }
    override func isAccessibilityEnabled() -> Bool { owner?.node(atRow: row)?.isEnabled ?? false }
    override func accessibilityValue() -> Any? { NSNumber(value: owner?.node(atRow: row)?.isChecked ?? false) }
    override func accessibilityValueDescription() -> String? {
        owner?.node(atRow: row)?.isChecked == true ? "已勾选" : nil
    }
    override func isAccessibilitySelected() -> Bool { owner?.selectedRow == row }
    override func accessibilityFrame() -> NSRect { owner?.accessibilityScreenFrame(atRow: row) ?? .zero }
    override func accessibilityChildren() -> [Any]? { owner?.accessibilitySubmenu?(row).map { [$0] } ?? [] }
    override func accessibilityHelp() -> String? {
        owner?.node(atRow: row).map { ShelfMenuPanelView.isSubmenu($0) ? "展开子菜单" : "执行操作" }
    }
    override func accessibilityPerformPress() -> Bool { owner?.performAccessiblePress(atRow: row) ?? false }
    override func accessibilityPerformShowMenu() -> Bool {
        guard let node = owner?.node(atRow: row), ShelfMenuPanelView.isSubmenu(node) else { return false }
        return accessibilityPerformPress()
    }
}

/// 按 bundle id 取系统自带应用的图标。
///
/// 参考应用菜单里「在 Finder 中显示 / 邮件 / 信息 / 备忘录」用的是**应用自己的彩色图标**
/// （Finder 的蓝笑脸、邮件的蓝信封、信息的绿气泡、备忘录的黄本子），不是 SF 符号。
/// 菜单是我们自己画的，所以这些图标直接去系统里取。
@MainActor
enum ShelfAppIcons {
    private static var cache: [String: NSImage?] = [:]

    static func image(bundleID: String) -> NSImage? {
        if let cached = cache[bundleID] { return cached }
        let icon = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
            .map { NSWorkspace.shared.icon(forFile: $0.path) }
        cache[bundleID] = icon
        return icon
    }

    static let finder = "com.apple.finder"
    static let mail = "com.apple.mail"
    static let messages = "com.apple.MobileSMS"
    static let notes = "com.apple.Notes"
}
