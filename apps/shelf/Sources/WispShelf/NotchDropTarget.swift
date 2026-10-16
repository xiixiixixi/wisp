import AppKit
import ShelfCore

@MainActor
final class NotchDropTarget {
    private var panels: [NSPanel] = []
    private let receive: (NSPasteboard) -> Bool
    private var hideWork: DispatchWorkItem?

    init(receive: @escaping (NSPasteboard) -> Bool) { self.receive = receive }

    func show() {
        hideWork?.cancel()
        guard panels.isEmpty else { return }
        for screen in NSScreen.screens where screen.safeAreaInsets.top > 0 {
            let height: CGFloat = 40
            let frame = NSRect(x: screen.frame.midX - 110, y: screen.frame.maxY - screen.safeAreaInsets.top - height,
                               width: 220, height: height)
            let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel],
                                backing: .buffered, defer: false)
            panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.isReleasedWhenClosed = false
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = true
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            let target = NotchReceiver(frame: NSRect(origin: .zero, size: frame.size))
            target.onReceive = receive
            panel.contentView = target
            panel.orderFrontRegardless()
            panels.append(panel)
        }
    }

    func hide(after delay: TimeInterval = 0) {
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.panels.forEach { $0.close() }
            self?.panels.removeAll()
        }
        hideWork = work
        if delay > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work) }
        else { work.perform() }
    }
}

private final class NotchReceiver: DropHostView {
    private let material = NSVisualEffectView()
    private let row = NSStackView()
    private let symbol = NSImageView()
    // #18：悬停高亮时亮出的行动提示；常显态（图标 + 细边）保留。
    private let hint = NSTextField(labelWithString: "松手放入收集架")
    // 重写属性观察器会**替换**掉父类的那个，所以父类里的"值没变就跳过"守卫在这里不生效。
    // 拖拽时光标反复进出这个区域，每次都会给 highlight 赋同样的值，于是每次都重设
    // 颜色、边框和边框宽度。补上同样的守卫。
    override var highlight: Bool { didSet { guard oldValue != highlight else { return }; updateHighlight() } }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        layer?.cornerRadius = 8
        layer?.masksToBounds = true
        material.material = .popover
        material.blendingMode = .behindWindow
        material.state = .active
        material.frame = bounds
        material.autoresizingMask = [.width, .height]
        material.wantsLayer = true
        material.layer?.cornerRadius = 8
        material.layer?.masksToBounds = true
        addSubview(material)
        symbol.image = ShelfSymbols.image(.shelf, pointSize: 20, accessibilityDescription: "放入收集架")
        symbol.imageScaling = .scaleProportionallyDown
        symbol.translatesAutoresizingMaskIntoConstraints = false
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 7
        row.translatesAutoresizingMaskIntoConstraints = false
        row.addArrangedSubview(symbol)
        hint.font = .systemFont(ofSize: 12, weight: .medium)
        hint.translatesAutoresizingMaskIntoConstraints = false
        row.addArrangedSubview(hint)
        addSubview(row)
        NSLayoutConstraint.activate([
            symbol.widthAnchor.constraint(equalToConstant: 20), symbol.heightAnchor.constraint(equalToConstant: 20),
            row.centerXAnchor.constraint(equalTo: centerXAnchor), row.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        updateHighlight()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateHighlight() }
    private func updateHighlight() {
        // #18：两档外观收敛在 ShelfInteractionRules.notchPresentation，这里只落色。
        let presentation = ShelfInteractionRules.notchPresentation(targeted: highlight)
        symbol.contentTintColor = presentation.tintsContent ? .controlAccentColor : .labelColor
        material.layer?.borderColor = (presentation.tintsContent ? NSColor.controlAccentColor : NSColor.separatorColor).cgColor
        material.layer?.borderWidth = presentation.borderWidth
        hint.textColor = presentation.tintsContent ? .controlAccentColor : .labelColor
        hint.isHidden = !presentation.showsHintText
    }
    override func accessibilityLabel() -> String? { "刘海文件投放区" }
    override func isAccessibilityElement() -> Bool { true }
}
