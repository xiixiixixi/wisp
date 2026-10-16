import AppKit
import SwiftUI
import ShelfCore
import QuickLookThumbnailing
import QuartzCore
import ImageIO

private let shelfDragOriginType = NSPasteboard.PasteboardType("com.wisp.shelf.origin")

func isReturningToShelf(_ pasteboard: NSPasteboard, id: UUID) -> Bool {
    if pasteboard.string(forType: shelfDragOriginType) == id.uuidString { return true }
    return pasteboard.pasteboardItems?.contains { item in
        guard let data = item.data(forType: ShelfItemTable.Coordinator.reorderType),
              let member = try? JSONDecoder().decode(ShelfItemTable.Coordinator.DragMember.self, from: data) else { return false }
        return member.shelf == id
    } ?? false
}

enum ShelfDragPresentation { case toolbar, stack }

/// 文件数量属于载荷，预览数量属于画面。多文件仍逐项写入拖动剪贴板，
/// 但只用第一项承载一张紧凑预览，避免 AppKit 把每个文件展开成一长串影子。
enum ShelfDragPreview {
    static let size = NSSize(width: 80, height: 94)
    static let toolbarSize = NSSize(width: 40, height: 48)

    static func image(thumbnail: NSImage, count: Int, size: NSSize = size) -> NSImage {
        let image = NSImage(size: size, flipped: false) { rect in
            let canvas = rect.insetBy(dx: 6, dy: 6)
            let fitted = FileDragSource.aspectFit(image: thumbnail, in: canvas)
            let radius: CGFloat = 4
            let path = NSBezierPath(roundedRect: fitted, xRadius: radius, yRadius: radius)
            NSGraphicsContext.saveGraphicsState()
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.16)
            shadow.shadowBlurRadius = 3
            shadow.shadowOffset = NSSize(width: 0, height: -1)
            shadow.set()
            NSColor.windowBackgroundColor.setFill()
            path.fill()
            NSGraphicsContext.restoreGraphicsState()
            NSGraphicsContext.saveGraphicsState()
            path.addClip()
            thumbnail.draw(in: fitted, from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
            if count > 1 {
                let text = count > 999 ? "999+" : String(count)
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                    .foregroundColor: NSColor.white,
                ]
                let measured = (text as NSString).size(withAttributes: attributes)
                let width = max(18, measured.width + 10)
                let badge = NSRect(x: rect.maxX - width - 2, y: 2, width: width, height: 18)
                NSColor.darkGray.withAlphaComponent(0.92).setFill()
                NSBezierPath(roundedRect: badge, xRadius: 9, yRadius: 9).fill()
                (text as NSString).draw(at: NSPoint(x: badge.midX - measured.width / 2,
                                                  y: badge.midY - measured.height / 2),
                                       withAttributes: attributes)
            }
            return true
        }
        image.accessibilityDescription = count > 1 ? "\(count) 个内容项" : thumbnail.accessibilityDescription
        return image
    }

    static func apply(to item: NSDraggingItem, index: Int, image: NSImage, frame: NSRect) {
        // nil 仅隐藏图像；fileURL、来源架子及成员标记仍在 item 的剪贴板载荷中。
        item.setDraggingFrame(frame, contents: index == 0 ? image : nil)
    }

    static func apply(to session: NSDraggingSession, in view: NSView,
                      at screenPoint: NSPoint, image: NSImage) {
        session.draggingFormation = .none
        session.draggingLeaderIndex = 0
        let point = view.window.map { view.convert($0.convertPoint(fromScreen: screenPoint), from: nil) } ?? screenPoint
        let frame = NSRect(x: point.x - image.size.width / 2, y: point.y - image.size.height / 2,
                           width: image.size.width, height: image.size.height)
        session.enumerateDraggingItems(options: [], for: view, classes: [NSPasteboardItem.self], searchOptions: [:]) { item, index, _ in
            apply(to: item, index: index, image: image, frame: frame)
        }
    }

    static func image(for url: URL, count: Int, scale: CGFloat) -> NSImage {
        let thumbnail = ShelfThumbnailCache.shared.image(for: url, size: 82, scale: scale, ready: {})
        return image(thumbnail: thumbnail, count: count)
    }
}

/// 拖拽帧间隔摘要。抽成纯函数是为了能单测：记录器跑在真实拖拽里没法在测试里驱动，
/// 而这里算错一个数，用户那边就白拖一次。
enum ShelfDragTrace {
    /// 60Hz 下一帧的预算是 16.7ms；超过一帧算掉帧，超过两帧（33.4ms）是肉眼可见的卡顿。
    static let droppedFrameBudget: Double = 16.7
    static let hitchBudget: Double = 33.4

    static func summary(stamps: [Double], fileCount: Int) -> String? {
        guard stamps.count >= 3, let last = stamps.last else { return nil }
        let gaps = zip(stamps, stamps.dropFirst()).map { ($1 - $0) * 1000 }
        let sorted = gaps.sorted()
        func percentile(_ p: Double) -> Double {
            sorted[min(sorted.count - 1, max(0, Int((Double(sorted.count) * p).rounded(.down)) - (p > 0 ? 0 : 1)))]
        }
        let dropped = gaps.filter { $0 > droppedFrameBudget }
        let hitches = gaps.filter { $0 > hitchBudget }
        var text = """
        拖拽帧间隔（毫秒）  文件数 \(fileCount)  时长 \(String(format: "%.0f", last * 1000))ms
          样本 \(gaps.count)   p50 \(String(format: "%.1f", percentile(0.5)))   p95 \(String(format: "%.1f", percentile(0.95)))   max \(String(format: "%.1f", gaps.max() ?? 0))
          掉帧(>\(String(format: "%.1f", droppedFrameBudget))ms) \(dropped.count) 帧   卡顿(>\(String(format: "%.1f", hitchBudget))ms) \(hitches.count) 帧
        """
        if let worst = hitches.max() { text += "\n  最长一次停顿 \(String(format: "%.1f", worst))ms" }
        return text
    }
}

class DropHostView: NSView {
    /// SwiftUI 承载视图。命中它自己 == 那一带没有任何可交互控件。
    weak var hostingView: NSView?
    var shelfID: UUID?
    /// 内容面板（右侧那个 400pt 的）不参与顶部拖动条的悬停。
    var isDetailSurface = false
    var onReceive: ((NSPasteboard) -> Bool)?
    var canReceive: (() -> Bool)?

    /// 悬停状态从这里发出去，而不是用 SwiftUI 的 `.onHover`。
    ///
    /// 架子面板属于**后台的 accessory 进程**（`.accessory` 激活策略 + `.nonactivatingPanel`），
    /// SwiftUI 的 `onHover` 依赖应用处于活动状态，实测在这个面板上**一次都不触发**
    /// ——连 ✕ 按钮的悬停高亮都没有。同一块面板上，走 AppKit `.activeAlways`
    /// 跟踪区的自定义控件（⌄ 按钮）悬停却是好的。
    /// 所以「顶部拖动条」这种要跟着悬停淡入的东西，也必须从 AppKit 这一层发。
    var onHoverChanged: ((Bool) -> Void)?

    // 拖拽过程中 AppKit 会反复问"这个剪贴板能不能收"。而 isReturningToShelf 要
    // **逐个剪贴板条目跑一遍 JSONDecoder**，availableType(from:) 实测单次 0.128ms。
    // 同一次拖拽里剪贴板内容是不变的，用 changeCount（一个整数，0.001ms）当缓存键，
    // 只在真的换了剪贴板时才重算——和 ActivationMonitor 里同一套做法。
    private struct DropProbe { let changeCount: Int; let returning: Bool; let receivable: Bool }
    private var dropProbe: DropProbe?

    private func probe(_ pasteboard: NSPasteboard, id: UUID?) -> DropProbe {
        if let dropProbe, dropProbe.changeCount == pasteboard.changeCount { return dropProbe }
        let next = DropProbe(changeCount: pasteboard.changeCount,
                             returning: id.map { isReturningToShelf(pasteboard, id: $0) } ?? false,
                             receivable: pasteboard.availableType(from: ContentReceiver.types) != nil)
        dropProbe = next
        return next
    }
    private let dropTint = CAShapeLayer()
    // 拖拽过程中 AppKit 会反复问"能不能收"，每次都走到 `highlight = true`。
    // **Swift 里给属性赋同样的值，didSet 照样会执行**——而这个 didSet 原来无条件
    // 启动一个透明度动画，等于光标在架子上扫过就反复起动画、反复替换同名 key，
    // 每一次都是主线程上的开销。加一行 early-return：值没变就什么都不做。
    var highlight = false { didSet {
        guard oldValue != highlight else { return }
        if let shelfID {
            NotificationCenter.default.post(name: Notification.Name("ShelfDropHighlight"), object: shelfID, userInfo: ["active": highlight])
        }
        dropTint.fillColor = NSColor.controlAccentColor.withAlphaComponent(0.07).cgColor
        ShelfMotion.opacity(dropTint, to: highlight ? 1 : 0, key: "shelfDropHighlight")
    } }
    override init(frame: NSRect) { super.init(frame: frame); registerForDraggedTypes(ContentReceiver.types); wantsLayer = true }

    // 命中测试的兜底。面板是 borderless 的，SwiftUI 撑满整个 contentView，
    // 不兜底的话边缘那几像素会穿透到后面的窗口；兜底返回自己则保证"这一块
    // 归本窗口"，配合 isMovableByWindowBackground 支持拖空白处移动架子。
    //
    // 这里曾经还有一条"命中宿主视图本身就当没人认领、交回 contentView"的规则，
    // **那条规则把面板里所有按钮的点击全截走了**：SwiftUI 的按钮不各自占一个
    // NSView，在按钮位置 super.hitTest 返回的就是 NSHostingView，于是被判成
    // "没人认领"交回 contentView；而 contentView 正是开了 isMovableByWindowBackground
    // 的那层，于是这次点击直接变成"拖动面板"——✕ 关不掉、加号没反应，
    // **拖卡片时整块面板跟着走**（同一个原因）。
    //
    // 现在命中到的就原样交回去，SwiftUI 才收得到点击；卡片那一块另有
    // FileDragSource.mouseDownCanMoveWindow = false 挡掉"拖窗口"。
    override func hitTest(_ point: NSPoint) -> NSView? {
        if let hit = super.hitTest(point) { return hit }
        return bounds.contains(point) ? self : nil
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { onHoverChanged?(true) }
    override func mouseExited(with event: NSEvent) { onHoverChanged?(false) }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        let p = probe(sender.draggingPasteboard, id: shelfID)
        if p.returning { highlight = false; return [] }
        guard canReceive?() != false, p.receivable else { return [] }
        highlight = true; return .copy
    }
    override func draggingExited(_ sender: NSDraggingInfo?) { highlight = false }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if probe(sender.draggingPasteboard, id: shelfID).returning { return false }
        return canReceive?() != false
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if probe(sender.draggingPasteboard, id: shelfID).returning { highlight = false; return false }
        highlight = false; return onReceive?(sender.draggingPasteboard) ?? false
    }
    override func draggingEnded(_ sender: NSDraggingInfo) { highlight = false; dropProbe = nil }
    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if dropTint.superlayer == nil { layer?.addSublayer(dropTint) }
        dropTint.frame = bounds
        dropTint.path = CGPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), cornerWidth: 14, cornerHeight: 14, transform: nil)
        dropTint.strokeColor = nil
        dropTint.fillColor = NSColor.controlAccentColor.withAlphaComponent(0.07).cgColor
        if !highlight { dropTint.opacity = 0 }
        CATransaction.commit()
    }
}

struct FileDragView: NSViewRepresentable {
    var urls: [URL]
    var copyOnly: Bool
    var doubleClick: () -> Void
    var completed: (NSDragOperation) -> Void
    var completedDetails: ((NSDragOperation, [URL], Bool) -> Void)? = nil
    var missing: (([URL]) -> Void)? = nil
    var disabled = false
    var shelfID: UUID? = nil
    var presentation: ShelfDragPresentation = .toolbar
    var memberIDs: [UUID] = []
    func makeNSView(context: Context) -> FileDragSource { FileDragSource(frame: .zero) }
    func updateNSView(_ view: FileDragSource, context: Context) {
        let added = Set(urls).subtracting(Set(view.urls))
        view.urls = urls; view.copyOnly = copyOnly; view.onDoubleClick = doubleClick; view.onCompleted = completed
        view.onCompletedDetails = completedDetails; view.onMissing = missing; view.disabled = disabled; view.shelfID = shelfID
        view.presentation = presentation; view.memberIDs = memberIDs; view.refreshPresentation()
        if presentation == .stack, !added.isEmpty, view.window != nil {
            ShelfMotion.arrive(view, offset: 4, scale: 0.985, key: "shelfStackReceipt")
        }
    }
}

final class FileDragSource: NSView, NSDraggingSource {
    var urls: [URL] = [] { didSet {
        // 预热原本只在 viewDidMoveToWindow 跑一次，也就是"架子第一次显示时"。
        // 之后用户加文件、改展示模式，都不会再预热——于是**每加一个新文件，
        // 第一次拖它的时候必须在拖拽起始那一帧现生成 96pt 缩略图**（外加圆角和
        // 投影），全在主线程上同步做完。这正是"按下去顿一下"的来源。
        // 挪到 urls 变化时重新预热。
        if urls != oldValue { warmDragImages() }
    } }
    var copyOnly = false
    var onDoubleClick: (() -> Void)?
    var onCompleted: ((NSDragOperation) -> Void)?
    var onCompletedDetails: ((NSDragOperation, [URL], Bool) -> Void)?
    var onMissing: (([URL]) -> Void)?
    var disabled = false
    var shelfID: UUID?
    var presentation: ShelfDragPresentation = .toolbar
    var memberIDs: [UUID] = []
    private var down: NSEvent?
    private var hovering = false
    private final class StackPreview {
        let url: URL
        let frame: CALayer
        let image: CALayer
        var displayedImage: NSImage?
        init(url: URL, frame: CALayer, image: CALayer) {
            self.url = url; self.frame = frame; self.image = image
        }
    }
    private var stackPreviews: [StackPreview] = []
    private let thumbnailObserverID = UUID()
    private var draggedURLs: [URL] = []
    private var missingURLs: [URL] = []
    /// urls 变化时才算一次存在性，draw 直接读它，不在每次重绘里打文件系统。
    private var missingCache: [URL]?
    private var missingCacheKey: [URL] = []
    private func recomputeMissing() {
        missingCache = urls.filter { !FileManager.default.fileExists(atPath: $0.path) }
        missingCacheKey = urls
    }
    override init(frame frameRect: NSRect) { super.init(frame: frameRect); wantsLayer = true }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    /// 【关键】卡片上的按压绝不能被 AppKit 当成"拖窗口"。
    ///
    /// NSView 的 `mouseDownCanMoveWindow` 默认返回 true。窗口又开了
    /// `isMovableByWindowBackground`，于是 AppKit 一旦命中这个视图就直接进入
    /// "拖动窗口"的跟踪循环 —— 连 `mouseDown` 都不会送给视图，文件自然拖不出来。
    /// 实测证据：拖卡片时 hitTest 返回的确实是 FileDragSource，
    /// 但 mouseDown 一次都没进来，架子跟着鼠标跑了。
    /// 空白处拖窗口由 DropHostView 自己（默认 true）负责，两者互不干扰。
    override var mouseDownCanMoveWindow: Bool { false }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func layout() { super.layout(); refreshPresentation() }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        refreshPresentation()
        warmDragImages()
    }
    /// 提前把拖拽图做好。拖拽起始那一帧是在主线程上现画的，第一次拖尤其吃亏
    /// （要现生成缩略图、再加圆角和投影）。挪到上架之后异步做掉，拖起来就不用现算。
    private func warmDragImages() {
        let size = dragImageSize
        let pending = urls
        guard !pending.isEmpty else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, self.urls == pending else { return }
            if let url = pending.last { _ = self.dragImage(for: url, size: size, count: pending.count) }
        }
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; refreshPresentation(animated: true) }
    override func mouseExited(with event: NSEvent) { hovering = false; refreshPresentation(animated: true) }
    override func resetCursorRects() {
        if !disabled, !urls.isEmpty { addCursorRect(bounds, cursor: .openHand) }
    }
    override func mouseDown(with event: NSEvent) {
        guard !disabled else { return }
        if event.clickCount == 2 { onDoubleClick?(); down = nil } else { down = event }
        refreshPresentation(animated: true)
    }
    override func mouseUp(with event: NSEvent) { down = nil; refreshPresentation(animated: true) }

    /// 架子里的卡片和拖出预览都保持内容比例；数量不再改变预览占用的空间。
    private var dragImageSize: NSSize {
        presentation == .stack ? ShelfDragPreview.size : ShelfDragPreview.toolbarSize
    }

    override func mouseDragged(with event: NSEvent) {
        guard let down, !disabled, !urls.isEmpty else { return }
        self.down = nil
        // 这里原本还会再跑一次 refreshPresentation(animated: true)。拖拽刚开始的那一刻
        // 去起 5 个图层动画，正好和系统开始拖拽循环撞在一起——拖拽的"第一下顿挫"就是
        // 从这来的。架子此刻本来就要淡出，堆内动画没人看得见，直接省掉。
        let point = convert(down.locationInWindow, from: nil)
        // 原本对每个文件查两遍存在性（两次 filter），拖拽起始那一帧全在主线程上同步跑。
        // 而且 draw() 里已经把同一件事算过一遍并缓存了（missingCache/missingCacheKey），
        // 拖拽起始这里又原样重算一次——同样的同步文件系统调用在同一个关键帧上做两遍。
        // 缓存命中就直接用，只有缓存没算过才真的去查。
        let missing: [URL]
        let present: [URL]
        if let missingCache, missingCacheKey == urls {
            missing = missingCache
            present = urls.filter { !missingCache.contains($0) }
        } else {
            var m: [URL] = []
            var p: [URL] = []
            for url in urls {
                if FileManager.default.fileExists(atPath: url.path) { p.append(url) }
                else { m.append(url) }
            }
            missing = m; present = p
            missingCache = m
            missingCacheKey = urls
        }
        missingURLs = missing
        draggedURLs = present
        let preview = present.last.map { dragImage(for: $0, size: dragImageSize, count: present.count) }
        let frame = NSRect(x: point.x - dragImageSize.width / 2, y: point.y - dragImageSize.height / 2,
                           width: dragImageSize.width, height: dragImageSize.height)
        let items = present.enumerated().map { index, url -> NSDraggingItem in
            let writer = NSPasteboardItem()
            writer.setString(url.absoluteString, forType: .fileURL)
            if let shelfID {
                writer.setString(shelfID.uuidString, forType: shelfDragOriginType)
                if let index = urls.firstIndex(of: url), memberIDs.indices.contains(index),
                   let marker = try? JSONEncoder().encode(ShelfItemTable.Coordinator.DragMember(shelf: shelfID, member: memberIDs[index])) {
                    writer.setData(marker, forType: ShelfItemTable.Coordinator.reorderType)
                }
            }
            let item = NSDraggingItem(pasteboardWriter: writer)
            if let preview { ShelfDragPreview.apply(to: item, index: index, image: preview, frame: frame) }
            return item
        }
        guard !items.isEmpty else { reportMissingFiles(missingURLs, callback: onMissing); missingURLs.removeAll(); return }
        let session = beginDraggingSession(with: items, event: event, source: self)
        session.draggingFormation = .none
        session.draggingLeaderIndex = 0
        session.animatesToStartingPositionsOnCancelOrFail = true
        if let shelfID { NotificationCenter.default.post(name: Notification.Name("ShelfDragStarted"), object: shelfID) }
        // 实测：一次面板级 SwiftUI 状态重画中位 0.23ms、p95 2.18ms、最大 5.79ms
        // （60Hz 一帧 16.7ms），这是整条拖拽起始路径里**唯一进入掉帧区间**的项。
        // 而拖拽起始本来就要触发 draggingOut 那一次，所以这里不能再白白搭上一次。
        // 绝大多数时候按下的那一刻 Shift 并没有按住，发出去的 keepOpen 就是默认值
        // false —— 等于让整个面板为了一个没变化的布尔值重画一遍。
        // 只有"按下之前就按着 Shift"才需要立刻同步。
        if NSEvent.modifierFlags.contains(.shift) { publishDragModifiers() }
    }
    /// 只缓存合成后的单张预览，拖动起始无需再逐项生成阴影与数量标签。
    private var dragImages: [String: NSImage] = [:]
    private func dragImage(for url: URL, size: NSSize, count: Int) -> NSImage {
        let key = "\(url.path)#\(Int(size.width))x\(Int(size.height))#\(count)"
        if let cached = dragImages[key] { return cached }
        // 拖出时优先复用架子里已经显示的图，避免突然换成尚在加载的通用文件图标。
        let base = stackPreviews.first(where: { $0.url == url })?.displayedImage
            ?? thumbnail(url, size: max(size.width, size.height))
        let out = ShelfDragPreview.image(thumbnail: base, count: count, size: size)
        dragImages[key] = out
        if dragImages.count > 64 { dragImages.removeAll() }
        return out
    }

    /// 把图片等比缩放后居中放进目标矩形。
    static func aspectFit(image: NSImage, in rect: NSRect) -> NSRect {
        let source = image.size
        guard source.width > 0, source.height > 0 else { return rect }
        let scale = min(rect.width / source.width, rect.height / source.height)
        let fitted = NSSize(width: source.width * scale, height: source.height * scale)
        return NSRect(x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2,
                      width: fitted.width, height: fitted.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        if presentation == .stack {
            // 原本这里每重绘一次就把所有文件 exists 一遍。而 needsDisplay 会被
            // refreshPresentation 置位——鼠标进出、按下、抬起、布局、换窗口全都会重绘，
            // 于是光是鼠标在架子上来回晃，就反复做一整轮同步文件系统调用，拖拽的顿挫
            // 就是这么来的。改成只在 urls 变化时重算，缺失提示由缓存驱动。
            if missingCache == nil || missingCacheKey != urls { recomputeMissing() }
            if !(missingCache ?? []).isEmpty {
                ShelfSymbols.image(.warning, accessibilityDescription: "部分原文件不可用")?
                    .withSymbolConfiguration(.init(paletteColors: [.systemRed]))?
                    .draw(in: NSRect(x: bounds.maxX - 24, y: 8, width: 18, height: 18))
            }
            return
        }
        if !disabled, hovering || down != nil {
            NSColor.labelColor.withAlphaComponent(down == nil ? 0.06 : 0.12).setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 6, yRadius: 6).fill()
        }
        let size = min(14, min(bounds.width, bounds.height))
        let symbol = ShelfSymbols.image(.shelf, pointSize: size, accessibilityDescription: "拖出文件")?.withSymbolConfiguration(.init(paletteColors: [hovering ? .labelColor : ShelfGlassPalette.secondaryLabel]))
        symbol?.draw(in: NSRect(x: (bounds.width - size) / 2, y: (bounds.height - size) / 2, width: size, height: size),
                     from: .zero, operation: .sourceOver, fraction: disabled ? 0.4 : 1)
        if urls.contains(where: { !FileManager.default.fileExists(atPath: $0.path) }) {
            let icon = ShelfSymbols.image(.warning, accessibilityDescription: "部分文件不可用")
            icon?.withSymbolConfiguration(.init(paletteColors: [.systemRed]))?.draw(in: NSRect(x: max(0, bounds.maxX - 22), y: 3, width: 18, height: 18))
        }
    }
    func refreshPresentation(animated: Bool = false) {
        needsDisplay = true
        guard presentation == .stack else {
            stackPreviews.forEach { $0.frame.removeFromSuperlayer() }
            stackPreviews.removeAll()
            return
        }
        guard let layer else { return }
        // 最多画 4 张。实测参考应用：放进 4 / 5 / 6 / 7 / 9 个文件，卡片堆尺寸
        // **一模一样**（都是 85.5×100pt），逐张加文件后几何一点不变——它就是只画
        // 最上面 4 张，多出来的全藏在后面（4 张和 9 张截图看��去完全相同）。
        // 我这里原本是 suffix(5)，多画了一张。
        let top = Array(urls.suffix(4))
        if stackPreviews.map(\.url) != top {
            stackPreviews.forEach { $0.frame.removeFromSuperlayer() }
            stackPreviews = top.map { url in
                let frame = CALayer()
                frame.backgroundColor = NSColor.clear.cgColor
                frame.cornerRadius = 6
                frame.shadowColor = NSColor.black.cgColor
                frame.shadowOffset = CGSize(width: 0, height: -2)
                let image = CALayer()
                image.contentsGravity = .resizeAspect
                image.cornerRadius = 6
                image.masksToBounds = true
                frame.addSublayer(image)
                layer.addSublayer(frame)
                return StackPreview(url: url, frame: frame, image: image)
            }
        }
        // 卡片尺寸上限 = "竖版纸页"框：仍然按原比例缩放、绝不拉伸，只把上限收成
        // 68 宽 × 90 高。实测参考应用单卡时正面那张是 68×90pt（卡片是直的、没有遮挡，
        // ASCII 地图逐行直接量）；我原来写 76×100，大了 8×10，整堆就宽一圈。
        let pageWidth = max(24, min(68, bounds.width - 24))
        let pageHeight = max(24, min(90, bounds.height - 20))
        let feedback: CGFloat = !disabled && hovering ? 1 : 0
        let pressed = !disabled && down != nil
        for (index, preview) in stackPreviews.enumerated() {
            let image = thumbnail(preview.url, size: 104, previousImage: preview.displayedImage)
            preview.displayedImage = image
            let ratio = min(pageWidth / max(1, image.size.width), pageHeight / max(1, image.size.height))
            let size = NSSize(width: image.size.width * ratio, height: image.size.height * ratio)
            let depth = CGFloat(top.count - index - 1)
            let back = index != top.count - 1
            // 横移以"中间那张"为原点。top 最多 4 张，所以 spread 天然落在 ±1.5，
            // 不需要额外夹取。
            let spread = depth - CGFloat(top.count - 1) / 2
            // 倾角。判据是**顶部轮廓的最长等高平台**（卡片掩码每列的最上像素，找连续等高段）：
            // 参考应用 7 张时只有 22pt，因为它连正面卡本身都是斜的，轮廓是个拱形，
            // 最高点只有 3pt 宽、落在整堆 68% 处；我原来写 `back ? -2.6*depth : 0`
            // 把正面卡钉成水平，平台整整 68pt（= 一张卡的宽度），整堆成了"一条直边 + 一列阶梯"。
            // 三个已实测的档位：-2.6（平台 68pt）/ 2.5-2.2·depth（平台 12pt，尖峰在右侧，
            // 最接近参考应用）/ 2.5-4.0·depth（散得太开、整堆歪到一边，视觉更差，已否）。
            // 参考应用的每张位移≈2.9pt/1.4pt，与这里的 2.15/2.0 同量级，所以差别全在倾角。
            let baseAngle: CGFloat = back ? 2.5 - 2.2 * depth : 2.5
            let angle = baseAngle + (back && !pressed ? (baseAngle < 0 ? -3 : 3) * feedback : 0)
            let fan: CGFloat = back && !pressed ? 5 * depth * feedback : 0
            // 每张的水平位移。实测参考应用逐张加文件时整堆宽度的增量是 +7.0 / +6.5pt，
            // 反推单张步进 ≈ 5.5–5.8pt（左右各约 3.4）；我原来写 2.15pt，不到一半，
            // 卡片互相盖住大半，看上去是一摞而不是摊开的牌。改成 5.6pt。
            let position = CGPoint(x: bounds.midX - spread * 5.6 + fan,
                                   y: bounds.midY - spread * 2.0 + (pressed ? 0 : feedback * 3))
            let scale: CGFloat = pressed ? 0.965 : 1
            let transform = CATransform3DScale(CATransform3DMakeRotation(angle * .pi / 180, 0, 0, 1), scale, scale, 1)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            preview.frame.bounds = CGRect(origin: .zero, size: size)
            preview.frame.shadowPath = CGPath(roundedRect: preview.frame.bounds, cornerWidth: 6, cornerHeight: 6, transform: nil)
            preview.frame.shadowOpacity = 0.12
            preview.frame.shadowRadius = 4
            preview.frame.opacity = disabled ? 0.4 : 1
            preview.image.frame = preview.frame.bounds
            preview.image.contentsScale = window?.backingScaleFactor ?? 2
            preview.image.contents = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
            CATransaction.commit()
            moveStackPreview(preview.frame, to: position, transform: transform, animated: animated)
        }
    }
    private func moveStackPreview(_ layer: CALayer, to position: CGPoint, transform: CATransform3D, animated: Bool) {
        guard layer.position != position || !CATransform3DEqualToTransform(layer.transform, transform) else { return }
        let current = layer.presentation() ?? layer
        let startPosition = current.position
        let startTransform = current.transform
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.position = position
        layer.transform = transform
        CATransaction.commit()
        layer.removeAnimation(forKey: "shelfStackFeedback")
        guard animated, !ShelfMotion.reduceMotion else { return }
        let movement = CABasicAnimation(keyPath: "position")
        movement.fromValue = NSValue(point: startPosition)
        movement.toValue = NSValue(point: position)
        let rotation = CABasicAnimation(keyPath: "transform")
        rotation.fromValue = NSValue(caTransform3D: startTransform)
        rotation.toValue = NSValue(caTransform3D: transform)
        let group = CAAnimationGroup()
        group.animations = [movement, rotation]
        group.duration = 0.16
        group.timingFunction = ShelfMotion.timingFunction(.feedback)
        layer.add(group, forKey: "shelfStackFeedback")
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { copyOnly ? .copy : [.copy, .move] }
    func ignoreModifierKeys(for session: NSDraggingSession) -> Bool { false }

    // MARK: - 拖拽帧率记录
    // 目的：把「拖拽有没有竞品那么丝滑」从主观感受变成能读的数字。
    // 合成鼠标事件进不了 AppKit 的拖拽跟踪循环，除此之外**没有别的办法拿到
    // 真机拖拽数据**——所以让架子自己记：拖拽全程只往数组里追加一个时间戳
    // （CACurrentMediaTime 约 50ns，可忽略），拖完写一份摘要到
    // ~/Library/Application Support/WispShelf/drag-trace.txt。
    // 看 p50/p95/max 三个数就能判断掉帧在哪一档，不必靠感觉描述症状。
    private var dragFrameStamps: [Double] = []
    private var dragTraceStart: Double = 0
    private var dragTraceURLs = 0

    func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) {
        dragFrameStamps.removeAll(keepingCapacity: true)
        dragTraceURLs = urls.count
        dragTraceStart = CACurrentMediaTime()
        dragFrameStamps.append(0)
    }

    private func markDragFrame() {
        guard !dragFrameStamps.isEmpty else { return }
        dragFrameStamps.append(CACurrentMediaTime() - dragTraceStart)
    }

    private func flushDragTrace() {
        let stamps = dragFrameStamps
        dragFrameStamps.removeAll(keepingCapacity: true)
        guard let text = ShelfDragTrace.summary(stamps: stamps, fileCount: dragTraceURLs) else { return }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("WispShelf", isDirectory: true)
        guard let dir else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? text.write(to: dir.appendingPathComponent("drag-trace.txt"), atomically: true, encoding: .utf8)
    }

    // movedTo 在拖拽过程中【每次鼠标移动】都会被调用。原先每次都读一遍系统按键状态、
    // 再发一条通知，而这条通知在 SwiftUI 那头会改 @State，等于光标每动一下就走一趟
    // 系统调用 + 通知派发 + 状态更新。按住 Shift 的提示只在按下/松开那两下才需要变，
    // 值没变就别发。
    private var lastKeepOpenPublished: Bool?
    func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
        markDragFrame()
        let keepOpen = NSEvent.modifierFlags.contains(.shift)
        guard keepOpen != lastKeepOpenPublished else { return }
        lastKeepOpenPublished = keepOpen
        publishDragModifiers()
    }
    private func publishDragModifiers() {
        if let shelfID { NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: shelfID, userInfo: ["keepOpen": NSEvent.modifierFlags.contains(.shift)]) }
    }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        flushDragTrace()
        if let window {
            hovering = bounds.contains(convert(window.convertPoint(fromScreen: screenPoint), from: nil))
        } else { hovering = false }
        refreshPresentation(animated: true)
        if let shelfID { NotificationCenter.default.post(name: Notification.Name("ShelfDragEnded"), object: shelfID) }
        let actual = draggedURLs; draggedURLs.removeAll()
        let keepOpen = NSEvent.modifierFlags.contains(.shift) || !missingURLs.isEmpty
        reportMissingFiles(missingURLs, callback: onMissing); missingURLs.removeAll()
        if let onCompletedDetails { onCompletedDetails(operation, actual, keepOpen) }
        else { onCompleted?(operation) }
    }
    private func thumbnail(_ url: URL, size: CGFloat, previousImage: NSImage? = nil) -> NSImage {
        ShelfThumbnailCache.shared.image(for: url, size: size, scale: window?.backingScaleFactor ?? 2,
                                        previousImage: previousImage, observerID: thumbnailObserverID) { [weak self] in
            // 预热时可能只有文件图标；真实内容缩略图完成后，不能继续拖出旧图标。
            self?.dragImages = self?.dragImages.filter { !$0.key.hasPrefix("\(url.path)#") } ?? [:]
            self?.refreshPresentation()
        }
    }
    override func accessibilityLabel() -> String? {
        let available = urls.filter { FileManager.default.fileExists(atPath: $0.path) }.count
        return "\(urls.count) 个内容项，\(available) 个可拖出，\(urls.count - available) 个不可用"
    }
    override func isAccessibilityElement() -> Bool { true }
}

func reportMissingFiles(_ urls: [URL], callback: (([URL]) -> Void)? = nil) {
    guard !urls.isEmpty else { return }
    if let callback { callback(urls); return }
    let alert = NSAlert()
    alert.messageText = "有 \(urls.count) 个文件目前不可用"
    alert.informativeText = "原文件不存在、磁盘未连接或无法访问。这些项目未被交付；清单中的失效项目不会被移除。\n" + urls.prefix(5).map(\.lastPathComponent).joined(separator: "\n")
    alert.addButton(withTitle: "好")
    alert.runModal()
}

final class ShelfThumbnailCache {
    static let shared = ShelfThumbnailCache()
    typealias Generator = (URL, Int, @escaping (NSImage?) -> Void) -> Void
    private final class Entry: NSObject {
        let image: NSImage
        let pixels: Int
        init(image: NSImage, pixels: Int) { self.image = image; self.pixels = pixels }
    }
    private final class Request {
        let id = UUID()
        var callbacks: [UUID: () -> Void] = [:]
        func observe(_ id: UUID?, ready: @escaping () -> Void) {
            if let id { callbacks[id] = ready }
            else if callbacks.count < 32 { callbacks[UUID()] = ready }
        }
    }
    private let cache = NSCache<NSString, Entry>()
    private var pending: [String: Request] = [:]
    private var failed: Set<String> = []
    private let generator: Generator
    private static let imageQueue = DispatchQueue(label: "com.wisp.shelf.thumbnails", qos: .userInitiated)
    init(generator: Generator? = nil) {
        self.generator = generator ?? Self.generateThumbnail
        cache.countLimit = 128; cache.totalCostLimit = 64 * 1024 * 1024
    }

    func image(for url: URL, size: CGFloat, scale: CGFloat, previousImage: NSImage? = nil,
               observerID: UUID? = nil, ready: @escaping () -> Void) -> NSImage {
        let url = url.standardizedFileURL
        guard let key = Self.versionKey(for: url) else { return NSWorkspace.shared.icon(forFile: url.path) }
        let pixels = min(512, max(32, Int(ceil(size * scale))))
        let cached = cache.object(forKey: key as NSString)
        if let cached, cached.pixels >= pixels { return cached.image }
        // A larger request or cache eviction must not replace a visible photo with its file icon.
        let fallback = cached?.image ?? previousImage ?? NSWorkspace.shared.icon(forFile: url.path)
        guard !failed.contains(key) else { return fallback }
        if let request = pending[key] {
            request.observe(observerID, ready: ready)
            return fallback
        }
        guard pending.count < 16 else { return fallback }
        let request = Request()
        request.observe(observerID, ready: ready)
        pending[key] = request
        generator(url, pixels) { [weak self] image in
            DispatchQueue.main.async {
                guard let self, self.pending[key]?.id == request.id else { return }
                self.pending.removeValue(forKey: key)
                if Self.versionKey(for: url) == key {
                    if let image { self.cache.setObject(Entry(image: image, pixels: pixels), forKey: key as NSString, cost: pixels * pixels * 4) }
                    else {
                        if self.failed.count >= 128 { self.failed.removeAll() }
                        self.failed.insert(key)
                    }
                }
                request.callbacks.values.forEach { $0() }
            }
        }
        return fallback
    }

    /// 取缩略图版本号要先 `attributesOfItem` 打一次文件系统。而 `image(for:)` 在缓存命中时
    /// 也得先算版本号才能查缓存——于是鼠标按下、移出、进出，各触发一次卡片堆重绘，
    /// 每次就是 N 个文件的属性查询，全在主线程上。拖拽起始那一下会连着来两轮。
    /// 这里把版本号缓存住，一秒内同一个文件不重复查。缩略图本来也不是亚秒级新鲜的
    /// 东西，这点延迟对缓存失效没有任何实际影响。
    private static var versionCache: [String: (key: String, at: CFTimeInterval)] = [:]
    private static let versionTTL: CFTimeInterval = 1

    private static func versionKey(for url: URL) -> String? {
        let path = url.path
        let now = CACurrentMediaTime()
        if let hit = versionCache[path], now - hit.at < versionTTL { return hit.key }
        guard let values = try? FileManager.default.attributesOfItem(atPath: path) else { return nil }
        let date = (values[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let size = (values[.size] as? NSNumber)?.int64Value ?? 0
        let file = (values[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
        let key = "\(path)|\(date)|\(size)|\(file)"
        if versionCache.count > 256 { versionCache.removeAll() }
        versionCache[path] = (key, now)
        return key
    }

    private static func generateThumbnail(for url: URL, pixels: Int, completed: @escaping (NSImage?) -> Void) {
        imageQueue.async {
            let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: pixels,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            if let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions),
               let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) {
                completed(NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height)))
                return
            }
            let request = QLThumbnailGenerator.Request(fileAt: url,
                size: CGSize(width: CGFloat(pixels), height: CGFloat(pixels)), scale: 1, representationTypes: .thumbnail)
            QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, _ in
                completed(representation?.nsImage)
            }
        }
    }
}

final class StatusDropView: DropHostView {
    var onClick: (() -> Void)?
    override func mouseDown(with event: NSEvent) { onClick?() }
}

final class ShelfEdgeView: NSView {
    // #3：双击边缘的动作由宿主按设置分派（停靠/收起/无操作），视图本身不再写死停靠。
    var doubleClick: (() -> Void)?
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        // 顶部不参与命中：这层是给"拖到边缘停靠"用的，它靠 NSWindow.performDrag
        // 移动窗口，而面板是 nonactivating 面板、拿不到焦点，performDrag 会静默失效。
        // 顶部一旦被这层认领，事件就落在一个什么都不做的视图上 —— 看起来就是"顶部拖不动"。
        // 顶部交给 isMovableByWindowBackground，那条路是不需要焦点的，实测可用。
        let isEdge = local.x < 8 || local.x > bounds.maxX - 8 || local.y > bounds.maxY - 8
        guard bounds.contains(local), isEdge else { return nil }
        return self
    }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { doubleClick?() }
        else { window?.performDrag(with: event); (window as? ShelfPanel)?.onMoveEnded?() }
    }
}
