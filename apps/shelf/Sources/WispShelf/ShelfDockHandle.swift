import AppKit
import SwiftUI

@MainActor
final class ShelfDockHandle {
    let panel: NSPanel
    private let edge: String
    private let available: NSRect
    private let center: NSPoint
    private var tuckToken = UUID()
    private var transitionToken = UUID()
    private var expandedState: Bool?
    private var edgeControl: NSView?
    private weak var shelfContent: NSView?

    init(id: UUID, name: String, urls: [URL], memberIDs: [UUID], copyOnly: Bool, edge: String, focus: Bool,
         originalFrame: NSRect, screen: NSScreen,
         undock: @escaping () -> Void, hide: @escaping () -> Void,
         receive: @escaping (NSPasteboard) -> Bool, canReceive: @escaping () -> Bool,
         dragEnded: @escaping (NSDragOperation, [URL], Bool) -> Void) {
        self.edge = edge; available = screen.visibleFrame
        center = NSPoint(x: originalFrame.midX, y: originalFrame.midY)
        panel = ShelfPanel(contentRect: NSRect(origin: originalFrame.origin, size: NSSize(width: 200, height: 208)),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "停靠 · " + name
        panel.level = .floating; panel.isFloatingPanel = true; panel.hidesOnDeactivate = false
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let receiver = ShelfDockClipView(frame: NSRect(origin: .zero, size: panel.frame.size), edge: edge)
        receiver.shelfID = id; receiver.onReceive = receive; receiver.canReceive = canReceive
        receiver.layer?.cornerRadius = 16; receiver.layer?.masksToBounds = true
        receiver.onHover = { [weak self] in self?.hover($0) }
        let view = DockShelfView(id: id, name: name, urls: urls, memberIDs: memberIDs,
            copyOnly: copyOnly, edge: edge, undock: undock, hide: hide, dragEnded: dragEnded)
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(x: 0, y: 0, width: 200, height: 208)
        host.autoresizingMask = []
        receiver.addSubview(host); receiver.shelfHost = host; shelfContent = host
        let edgeHost = NSHostingView(rootView: DockShelfEdgeControl(name: name, urls: urls, edge: edge, undock: undock))
        edgeHost.frame = receiver.bounds; edgeHost.autoresizingMask = [.width, .height]
        edgeHost.isHidden = true
        receiver.addSubview(edgeHost); edgeControl = edgeHost
        panel.contentView = receiver
        setExpanded(false, animated: false)
        panel.orderFrontRegardless()
        if focus { panel.makeKeyAndOrderFront(nil) }
    }
    func dismiss() { tuckToken = UUID(); transitionToken = UUID(); panel.orderOut(nil); panel.contentView = nil; panel.close() }
    private func hover(_ hovering: Bool) {
        let token = UUID(); tuckToken = token
        if hovering { setExpanded(true, animated: true) }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.tuckToken == token else { return }; self.setExpanded(false, animated: true)
        } }
    }
    private func setExpanded(_ expanded: Bool, animated: Bool) {
        guard expandedState != expanded else { return }
        expandedState = expanded
        let token = UUID(); transitionToken = token
        if expanded { edgeControl?.isHidden = true; shelfContent?.isHidden = false }
        let vertical = edge == "left" || edge == "right"
        let size = NSSize(width: vertical && !expanded ? 32 : 200, height: !vertical && !expanded ? 32 : 208)
        var origin = NSPoint(x: center.x - size.width / 2, y: center.y - size.height / 2)
        origin.x = min(max(origin.x, available.minX), available.maxX - size.width)
        origin.y = min(max(origin.y, available.minY), available.maxY - size.height)
        switch edge {
        case "left": origin.x = available.minX
        case "right": origin.x = available.maxX - size.width
        case "bottom": origin.y = available.minY
        default: origin.y = available.maxY - size.height
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = animated ? ShelfMotion.duration(.docking) : 0
            context.timingFunction = ShelfMotion.timingFunction(.docking)
            if context.duration > 0 { panel.animator().setFrame(NSRect(origin: origin, size: size), display: true) }
            else { panel.setFrame(NSRect(origin: origin, size: size), display: true) }
        }, completionHandler: { [weak self] in
            guard let self, self.transitionToken == token else { return }
            self.edgeControl?.isHidden = expanded
            self.shelfContent?.isHidden = !expanded
        })
    }
}

private final class ShelfDockClipView: DropHostView {
    private let edge: String
    var shelfHost: NSView? { didSet { positionShelf() } }
    var onHover: ((Bool) -> Void)?

    init(frame: NSRect, edge: String) {
        self.edge = edge
        super.init(frame: frame)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        positionShelf()
    }
    override func layout() {
        super.layout()
        positionShelf()
    }
    private func positionShelf() {
        guard let shelfHost else { return }
        let origin = NSPoint(x: edge == "left" ? bounds.width - 200 : 0,
                             y: edge == "bottom" ? bounds.height - 208 : 0)
        // The window crops a full-size shelf without changing its internal layout.
        let frame = NSRect(origin: origin, size: NSSize(width: 200, height: 208))
        if shelfHost.frame != frame { shelfHost.frame = frame }
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect, .enabledDuringMouseDrag], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
}

private struct DockShelfEdgeControl: View {
    let name: String
    let urls: [URL]
    let edge: String
    let undock: () -> Void
    private var symbol: String {
        switch edge {
        case "left": return "chevron.right"
        case "right": return "chevron.left"
        case "bottom": return "chevron.up"
        default: return "chevron.down"
        }
    }
    private var summary: String { urls.count == 1 ? urls[0].lastPathComponent : "\(urls.count) 项" }

    var body: some View {
        Button(action: undock) {
            ShelfIcon(named: symbol, size: 12)
                .foregroundStyle(ShelfGlassPalette.secondaryText)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .background(ShelfGlassBackground(material: .popover))
            .help(summary).accessibilityLabel("展开\(name)，\(summary)")
    }
}

private struct DockShelfView: View {
    let id: UUID
    let name: String
    let urls: [URL]
    let memberIDs: [UUID]
    let copyOnly: Bool
    let edge: String
    let undock: () -> Void
    let hide: () -> Void
    let dragEnded: (NSDragOperation, [URL], Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draggingOut = false
    @State private var keepOpen = false
    private var summary: String { urls.count == 1 ? urls[0].lastPathComponent : "\(urls.count) 项" }
    /// 取消停靠的箭头指向屏幕内侧（随停靠边旋转），指明窗口会往哪个方向出来。
    private var inwardSymbol: String {
        switch edge {
        case "left": return "arrow.right.to.line"
        case "right": return "arrow.left.to.line"
        case "bottom": return "arrow.up.to.line"
        default: return "arrow.down.to.line"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                // 展开态顶行常显架子名：原先这行只有三个按钮，名字只写在窗口属性里，
                // 多块停靠的玻璃窗分不清谁是谁。名字占按钮左侧剩余宽度，超长中段截断，
                // 不参与命中（按钮与拖放不受影响）。
                Text(name)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ShelfGlassPalette.secondaryText)
                    .lineLimit(1).truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .allowsHitTesting(false)
                Button(action: undock) { ShelfIcon(named: "chevron.down", size: 11) }
                    .buttonStyle(ShelfRoundIconStyle(size: 30)).help("展开停靠架子").accessibilityLabel("展开停靠架子")
                // B1：停靠要有显式出口——「取消停靠」把悬浮窗抬离屏幕边恢复出来。
                Divider().frame(height: 14).opacity(0.5)
                Button(action: undock) { ShelfIcon(named: inwardSymbol, size: 12) }
                    .buttonStyle(ShelfRoundIconStyle(size: 30)).help("取消停靠").accessibilityLabel("取消停靠")
                Button(action: hide) { ShelfIcon(.close, size: 12) }
                    .buttonStyle(ShelfRoundIconStyle(size: 30)).help("收起（内容保留）").accessibilityLabel("收起（内容保留）")
            }.padding(.horizontal, 7).frame(height: 32).opacity(draggingOut ? 0.35 : 1)
            ZStack {
                FileDragView(urls: urls, copyOnly: copyOnly, doubleClick: undock, completed: { _ in },
                             completedDetails: dragEnded, shelfID: id, presentation: .stack, memberIDs: memberIDs)
                    .frame(width: 148, height: 134).opacity(draggingOut ? 0 : 1)
                if draggingOut, keepOpen {
                    Text("保持打开").font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ShelfGlassPalette.secondaryText).allowsHitTesting(false)
                }
            }.frame(width: 200, height: 134)
            Button(action: undock) {
                HStack(spacing: 5) {
                    Text(summary).lineLimit(1).truncationMode(.middle)
                    Image(systemName: "chevron.down.circle.fill")
                        .symbolRenderingMode(.hierarchical).font(.system(size: 11))
                }
            }.buttonStyle(ShelfReferenceCountStyle()).help(name)
                .accessibilityLabel("展开\(name)，\(urls.count) 项")
                .frame(maxWidth: 178).frame(height: 34).padding(.bottom, 8)
                .opacity(draggingOut ? 0.35 : 1)
        }.frame(width: 200, height: 208)
            .background(ShelfGlassBackground(material: .popover))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(ShelfGlassPalette.controlStroke, lineWidth: 0.75).allowsHitTesting(false))
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: draggingOut)
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragStarted"))) { note in
                if note.object as? UUID == id { draggingOut = true }
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragEnded"))) { note in
                if note.object as? UUID == id { draggingOut = false; keepOpen = false }
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragModifiers"))) { note in
                if note.object as? UUID == id { keepOpen = note.userInfo?["keepOpen"] as? Bool ?? false }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("停靠的\(name)，\(urls.count)项")
    }
}
