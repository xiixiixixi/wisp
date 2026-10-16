import AppKit
import SwiftUI
import ShelfCore

/// 架子右上角 ⌄ 的菜单内容。
///
/// 菜单**不是视图、也不是系统菜单**，只是一棵数据树：条目、分隔线、子菜单都写成
/// `ShelfMenuNode`，弹出时交给 `ShelfMenuPopup` 一次画完。每次弹出都重新构造，
/// 于是菜单内容永远反映当下的选择、输出结果和忙碌状态，不会出现"菜单是旧的"。
///
/// 为什么连系统菜单都不用，见 `ShelfMenuPanel.swift` 顶上的实测记录。

/// 菜单的一行。三种形态：普通条目、子菜单、分隔线。
/// 条目的图标可以是符号名（`symbol`）或已知图像（`image`），后者优先 ——
/// 「打开方式」「邮件」「信息」用的是应用/服务自己的图标，其余用 SF 符号。
/// 真实应用/分享服务保留自己的图标，普通操作使用统一的系统单色符号。
indirect enum ShelfMenuNode {
    case item(title: String, symbol: String?, image: NSImage?, enabled: Bool, checked: Bool, action: () -> Void)
    case submenu(title: String, symbol: String?, image: NSImage?, enabled: Bool, children: [ShelfMenuNode])
    case separator

    static func item(_ title: String, _ symbol: String,
                     enabled: Bool = true, checked: Bool = false, _ action: @escaping () -> Void) -> ShelfMenuNode {
        .item(title: title, symbol: symbol, image: nil, enabled: enabled, checked: checked, action: action)
    }

    /// 图标已知（应用图标、分享服务图标）时直接用；取不到才退回符号名。
    static func item(_ title: String, image: NSImage?, symbol: String, enabled: Bool = true, checked: Bool = false,
                     _ action: @escaping () -> Void) -> ShelfMenuNode {
        .item(title: title, symbol: image == nil ? symbol : nil, image: image,
              enabled: enabled, checked: checked, action: action)
    }

    static func submenu(_ title: String, _ symbol: String, _ children: [ShelfMenuNode], enabled: Bool = true) -> ShelfMenuNode {
        .submenu(title: title, symbol: symbol, image: nil, enabled: enabled, children: children)
    }

    static func submenu(_ title: String, image: NSImage?, symbol: String, enabled: Bool = true,
                        _ children: [ShelfMenuNode]) -> ShelfMenuNode {
        .submenu(title: title, symbol: image == nil ? symbol : nil, image: image, enabled: enabled, children: children)
    }

    var title: String? {
        switch self {
        case .item(let title, _, _, _, _, _), .submenu(let title, _, _, _, _): return title
        case .separator: return nil
        }
    }

    var isEnabled: Bool {
        switch self {
        case .item(_, _, _, let enabled, _, _), .submenu(_, _, _, let enabled, _): return enabled
        case .separator: return false
        }
    }

    var isChecked: Bool {
        if case .item(_, _, _, _, let checked, _) = self { return checked }
        return false
    }
}

/// 「打开方式」子菜单里的一个应用。
struct ShelfMenuOpenTarget {
    let title: String
    let image: NSImage
    let identifier: String
}

/// 架子右上角的 ⌄ 按钮。
///
/// **为什么按钮要自己是个 `NSView`**：菜单要在**按下那一刻**弹出来，和系统弹出按钮一致。
/// SwiftUI `Button` 的 action 在松开时才触发，那时菜单已经错过了按下的那一刻。
/// 所以按钮自己处理 `mouseDown`。
///
/// 外观沿用 `ShelfReferenceControlPalette` 的那套数值：白 12% 圆底、悬停 16%、
/// 字白 92%，和 ✕ 完全一致。
struct ShelfMenuButton: NSViewRepresentable {
    var symbol: String
    var symbolSize: CGFloat
    var size: CGFloat
    var enabled: Bool
    var nodes: () -> [ShelfMenuNode]

    func makeNSView(context: Context) -> ShelfMenuButtonView {
        let view = ShelfMenuButtonView(frame: .zero)
        view.apply(symbol: symbol, symbolSize: symbolSize, size: size, enabled: enabled, nodes: nodes)
        return view
    }

    func updateNSView(_ view: ShelfMenuButtonView, context: Context) {
        view.apply(symbol: symbol, symbolSize: symbolSize, size: size, enabled: enabled, nodes: nodes)
    }
}

@MainActor
final class ShelfMenuButtonView: NSView {
    private var symbol = "chevron.down"
    private var symbolSize: CGFloat = 11
    private var diameter: CGFloat = 30
    private var enabled = true
    private var nodeProvider: (() -> [ShelfMenuNode])?
    private var hovering = false
    private var pressed = false

    func apply(symbol: String, symbolSize: CGFloat, size: CGFloat, enabled: Bool, nodes: @escaping () -> [ShelfMenuNode]) {
        self.symbol = symbol
        self.symbolSize = symbolSize
        self.diameter = size
        self.enabled = enabled
        nodeProvider = nodes
        wantsLayer = true
        needsDisplay = true
    }

    /// 卡片那种"这块不参与拖窗口"的开关，在这里同样必须写。
    /// 不写的话按 ⌄ 会变成拖面板，菜单永远出不来。
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .button }
    override func accessibilityLabel() -> String? { "文件与窗口操作" }
    override func accessibilityHelp() -> String? { "打开文件操作、分享和窗口设置菜单" }
    override func accessibilityIdentifier() -> String { "shelf.actions-menu-button" }
    override func isAccessibilityEnabled() -> Bool { enabled }
    override func accessibilityChildren() -> [Any]? {
        ShelfMenuPopup.accessibilityMenu(for: self).map { [$0] } ?? []
    }

    override func accessibilityPerformPress() -> Bool {
        guard enabled, nodeProvider != nil, window != nil else { return false }
        // 辅助功能调用必须立即返回；真正菜单仍走相同的显示与执行路径。
        DispatchQueue.main.async { [weak self] in self?.openMenu() }
        return true
    }
    override func accessibilityPerformShowMenu() -> Bool { accessibilityPerformPress() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovering = false; pressed = false; needsDisplay = true }

    override func mouseDown(with event: NSEvent) {
        openMenu()
    }

    private func openMenu() {
        guard enabled, let nodeProvider else { return }
        pressed = true
        needsDisplay = true
        let nodes = nodeProvider()
        pressed = false
        needsDisplay = true
        // 菜单自己接管事件跟踪（悬停、点外面关闭、Esc、子菜单），返回时已经收工。
        ShelfMenuPopup.run(nodes: nodes, anchor: self)
    }

    override func draw(_ dirtyRect: NSRect) {
        // 圆盘颜色必须和 ✕ 用同一份（`ShelfReferenceControlPalette`），**不能写死白色**。
        // 写死过一次的结果是：浅色外观下面板底本身就是白的，白 12% 的圆等于没有，
        // 「⌄」看上去就是一个光秃秃的箭头——正是用户报的那个问题。
        let ink = ShelfReferenceControlPalette.roundInkNS
        let side = min(diameter, min(bounds.width, bounds.height))
        let circle = NSRect(x: bounds.midX - side / 2, y: bounds.midY - side / 2, width: side, height: side)
        ShelfReferenceControlPalette.roundFillNS.setFill()
        NSBezierPath(ovalIn: circle).fill()
        if hovering || pressed {
            ShelfReferenceControlPalette.roundHoverNS.setFill()
            NSBezierPath(ovalIn: circle).fill()
        }
        // 系统弹出按钮用的是 `chevron.down` 的**中粗**字形；`.regular` 描边太细，
        // 和旁边的 ✕ 摆在一起不像一个系统控件。
        let glyphSize = min(symbolSize, side * 0.46)
        if let image = ShelfSymbols.image(named: symbol, pointSize: glyphSize, weight: .medium,
                                         accessibilityDescription: nil) {
            // 手绘控件显式按透明字形染色，避免深色外观出现黑箭头。
            let box = NSRect(x: circle.midX - glyphSize / 2, y: circle.midY - glyphSize / 2,
                             width: glyphSize, height: glyphSize)
            ShelfSymbols.tinted(image, color: ink).draw(in: FileDragSource.aspectFit(image: image, in: box))
        }
        if !enabled {
            NSColor.black.withAlphaComponent(0.25).setFill()
            NSBezierPath(ovalIn: circle).fill()
        }
    }
}
