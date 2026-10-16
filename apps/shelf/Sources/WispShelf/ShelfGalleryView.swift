import AppKit
import Carbon
import QuartzCore
import SwiftUI
import ShelfCore

struct ShelfGalleryView: NSViewRepresentable {
    var shelfID: UUID
    var items: [ShelfItem]
    @Binding var selection: Set<UUID>
    var copyOnly: Bool
    var disabled: Bool
    var localBindings: [ShortcutBinding]
    var onOpen: (ShelfItem) -> Void
    var onPreview: ([URL]) -> Void
    var onRemove: (Set<UUID>) -> Void
    var onReorder: ([UUID]) -> Void
    var onDrop: (NSPasteboard) -> Bool
    var onDragEnd: (NSDragOperation, [URL], Bool) -> Void
    var onCommand: (String) -> Void
    var onMissing: (([URL]) -> Void)? = nil
    var onDropHighlight: ((Bool) -> Void)? = nil
    var onContextAction: ((String, Set<UUID>) -> Void)? = nil
    var contextActions: [ShelfFileMenuAction] = []
    /// #76：最爱动作清单，右键菜单「更多操作」置顶显示。
    var favoriteActions: [String] = []
    var onReveal: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let collection = ShelfGalleryCollection(frame: NSRect(x: 0, y: 0, width: 350, height: 128))
        let layout = NSCollectionViewFlowLayout()
        layout.itemSize = NSSize(width: 108, height: 128)
        layout.minimumInteritemSpacing = 6
        layout.minimumLineSpacing = 8
        layout.sectionInset = NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        collection.collectionViewLayout = layout
        collection.backgroundColors = [.clear]
        collection.isSelectable = true
        collection.allowsMultipleSelection = true
        collection.allowsEmptySelection = true
        collection.autoresizingMask = [.width]
        collection.dataSource = context.coordinator
        collection.delegate = context.coordinator
        collection.register(ShelfGalleryItem.self, forItemWithIdentifier: Coordinator.itemIdentifier)
        collection.register(ShelfGalleryRevealItem.self, forItemWithIdentifier: Coordinator.revealIdentifier)
        collection.registerForDraggedTypes([Coordinator.reorderType] + ContentReceiver.types)
        collection.setDraggingSourceOperationMask([.copy, .move], forLocal: true)
        collection.setDraggingSourceOperationMask(copyOnly ? .copy : [.copy, .move], forLocal: false)
        collection.onOpenItem = { [weak coordinator = context.coordinator] path in coordinator?.openItem(at: path) }
        collection.onPreviewSelected = { [weak coordinator = context.coordinator] in coordinator?.previewSelected() }
        collection.onRemoveSelected = { [weak coordinator = context.coordinator] in coordinator?.removeFromMenu() }
        collection.onDropHighlight = { [weak coordinator = context.coordinator] value in coordinator?.parent.onDropHighlight?(value) }
        collection.onExternalDrop = { [weak coordinator = context.coordinator] pasteboard in
            guard let coordinator, !coordinator.parent.disabled else { return false }
            guard !isReturningToShelf(pasteboard, id: coordinator.parent.shelfID) else {
                coordinator.parent.onDropHighlight?(false)
                return false
            }
            return coordinator.parent.onDrop(pasteboard)
        }
        collection.onCommand = { [weak coordinator = context.coordinator] command in coordinator?.parent.onCommand(command) }
        collection.contextMenu = { [weak coordinator = context.coordinator] path in coordinator?.menu(at: path) }
        collection.onFocusReveal = { [weak coordinator = context.coordinator] in coordinator?.focusReveal() ?? false }
        scroll.documentView = collection
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.scrollerStyle = .overlay
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        context.coordinator.collection = collection
        updateNSView(scroll, context: context)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        guard let collection = coordinator.collection else { return }
        coordinator.parent = self
        collection.shelfID = shelfID
        collection.localBindings = localBindings
        collection.interactionDisabled = disabled
        coordinator.applyingSelection = true
        let previousIDs = Set(coordinator.renderedItems.map(\.id))
        let insertedIDs = coordinator.hasRenderedItems ? Set(items.map(\.id)).subtracting(previousIDs) : []
        let hasReveal = onReveal != nil
        if coordinator.renderedItems != items || coordinator.renderedReveal != hasReveal {
            coordinator.renderedItems = items
            coordinator.renderedReveal = hasReveal
            collection.reloadData()
        }
        coordinator.hasRenderedItems = true
        let paths = Set(items.indices.filter { selection.contains(items[$0].id) }.map { IndexPath(item: $0, section: 0) })
        if collection.selectionIndexPaths != paths { collection.selectionIndexPaths = paths }
        coordinator.applyingSelection = false
        for case let tile as ShelfGalleryRevealItem in collection.visibleItems() {
            tile.update(enabled: !disabled, reveal: { [weak coordinator] in coordinator?.reveal() })
        }
        if !insertedIDs.isEmpty {
            collection.layoutSubtreeIfNeeded()
            for case let tile as ShelfGalleryItem in collection.visibleItems() {
                if let id = tile.representedItemID, insertedIDs.contains(id) { animateShelfItemInsertion(tile.view) }
            }
        }
        collection.setDraggingSourceOperationMask(copyOnly ? .copy : [.copy, .move], forLocal: false)
        updateShelfScrollerVisibility(scroll)
    }

    final class Coordinator: NSObject, NSCollectionViewDataSource, NSCollectionViewDelegate {
        static let itemIdentifier = NSUserInterfaceItemIdentifier("ShelfGalleryItem")
        static let revealIdentifier = NSUserInterfaceItemIdentifier("ShelfGalleryRevealItem")
        static let reorderType = ShelfItemTable.Coordinator.reorderType
        typealias DragMember = ShelfItemTable.Coordinator.DragMember
        var parent: ShelfGalleryView
        weak var collection: ShelfGalleryCollection?
        var renderedItems: [ShelfItem] = []
        var renderedReveal = false
        var hasRenderedItems = false
        var applyingSelection = false
        private var draggedURLs: [URL] = []
        private var missingURLs: [URL] = []
        private var internalReorder = false

        init(_ parent: ShelfGalleryView) { self.parent = parent }

        func collectionView(_ collectionView: NSCollectionView, numberOfItemsInSection section: Int) -> Int {
            parent.items.count + (parent.onReveal != nil ? 1 : 0)
        }

        func isRevealTile(at path: IndexPath) -> Bool {
            parent.onReveal != nil && path.section == 0 && path.item == parent.items.count
        }

        func collectionView(_ collectionView: NSCollectionView, itemForRepresentedObjectAt indexPath: IndexPath) -> NSCollectionViewItem {
            if isRevealTile(at: indexPath) {
                let tile = collectionView.makeItem(withIdentifier: Self.revealIdentifier, for: indexPath)
                (tile as? ShelfGalleryRevealItem)?.update(enabled: !parent.disabled, reveal: { [weak self] in self?.reveal() })
                return tile
            }
            let item = collectionView.makeItem(withIdentifier: Self.itemIdentifier, for: indexPath)
            if let tile = item as? ShelfGalleryItem, parent.items.indices.contains(indexPath.item) {
                tile.update(parent.items[indexPath.item])
            }
            return item
        }

        func collectionView(_ collectionView: NSCollectionView, didSelectItemsAt indexPaths: Set<IndexPath>) { syncSelection() }
        func collectionView(_ collectionView: NSCollectionView, didDeselectItemsAt indexPaths: Set<IndexPath>) { syncSelection() }
        func collectionView(_ collectionView: NSCollectionView, shouldSelectItemsAt indexPaths: Set<IndexPath>) -> Set<IndexPath> {
            Set(indexPaths.filter { $0.section == 0 && parent.items.indices.contains($0.item) })
        }

        private func syncSelection() {
            guard !applyingSelection, let collection else { return }
            collection.window?.makeFirstResponder(collection)
            parent.selection = Set(collection.selectionIndexPaths.compactMap { path in
                parent.items.indices.contains(path.item) ? parent.items[path.item].id : nil
            })
        }

        private var selectedItems: [ShelfItem] { parent.items.filter { parent.selection.contains($0.id) } }

        func reveal() {
            guard !parent.disabled else { return }
            parent.onReveal?()
        }

        func focusReveal() -> Bool {
            guard !parent.disabled, parent.onReveal != nil, let collection, let window = collection.window else { return false }
            let path = IndexPath(item: parent.items.count, section: 0)
            collection.scrollToItems(at: [path], scrollPosition: .centeredVertically)
            collection.layoutSubtreeIfNeeded()
            guard let tile = collection.item(at: path) as? ShelfGalleryRevealItem else { return false }
            return window.makeFirstResponder(tile.button)
        }

        func openItem(at path: IndexPath) {
            if isRevealTile(at: path) { reveal(); return }
            guard !parent.disabled, parent.items.indices.contains(path.item) else { return }
            let item = parent.items[path.item]
            guard item.isAvailable else { reportMissingFiles([item.resolvedURL], callback: parent.onMissing); return }
            parent.onOpen(item)
        }

        func previewSelected() {
            guard !parent.disabled else { return }
            let chosen = selectedItems.isEmpty ? parent.items : selectedItems
            reportMissingFiles(chosen.filter { !$0.isAvailable }.map(\.resolvedURL), callback: parent.onMissing)
            let urls = chosen.filter(\.isAvailable).map(\.resolvedURL)
            if !urls.isEmpty { parent.onPreview(urls) }
        }

        func menu(at path: IndexPath) -> NSMenu? {
            guard let collection, parent.items.indices.contains(path.item) else { return nil }
            if !collection.selectionIndexPaths.contains(path) {
                collection.selectionIndexPaths = [path]
                syncSelection()
            }
            let chosen = collection.selectionIndexPaths.sorted { $0.item < $1.item }.compactMap { path in
                parent.items.indices.contains(path.item) ? parent.items[path.item] : nil
            }
            parent.selection = Set(chosen.map(\.id))
            return ShelfFileContextMenu(items: chosen, disabled: parent.disabled,
                                        supportsExtendedActions: parent.onContextAction != nil,
                                        customActions: parent.contextActions, favorites: parent.favoriteActions) { [weak self] action, ids in
                self?.performContextAction(action, ids: ids)
            }
        }
        private func performContextAction(_ action: String, ids: Set<UUID>) {
            guard !parent.disabled else { return }
            let chosen = parent.items.filter { ids.contains($0.id) }
            guard !chosen.isEmpty, chosen.count == ids.count else { return }
            if !["remove", "moveToNewShelf"].contains(action) {
                let missing = chosen.filter { !$0.isAvailable }.map(\.resolvedURL)
                guard missing.isEmpty else { reportMissingFiles(missing, callback: parent.onMissing); return }
            }
            parent.selection = ids
            if let onContextAction = parent.onContextAction { onContextAction(action, ids); return }
            let urls = chosen.map(\.resolvedURL)
            switch action {
            case "preview": parent.onPreview(urls)
            case "open": urls.forEach { NSWorkspace.shared.open($0) }
            case "reveal": Task { @MainActor in (NSApp.delegate as? ShelfApplication)?.revealInWisp(urls) }
            case "revealInFinder": NSWorkspace.shared.activateFileViewerSelecting(urls)
            case "copyItems": NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects(urls.map { $0 as NSURL })
            case "remove": parent.onRemove(ids)
            default: break
            }
        }
        @objc func removeFromMenu() {
            guard !parent.disabled else { return }
            parent.onRemove(Set(selectedItems.map(\.id)))
        }

        func collectionView(_ collectionView: NSCollectionView, canDragItemsAt indexPaths: Set<IndexPath>, with event: NSEvent) -> Bool {
            !parent.disabled && !indexPaths.isEmpty
                && indexPaths.allSatisfy { $0.section == 0 && parent.items.indices.contains($0.item) }
        }

        func collectionView(_ collectionView: NSCollectionView, pasteboardWriterForItemAt indexPath: IndexPath) -> NSPasteboardWriting? {
            guard !parent.disabled, parent.items.indices.contains(indexPath.item) else { return nil }
            let member = parent.items[indexPath.item]
            let writer = NSPasteboardItem()
            if member.isAvailable { writer.setString(member.resolvedURL.absoluteString, forType: .fileURL) }
            if let data = try? JSONEncoder().encode(DragMember(shelf: parent.shelfID, member: member.id)) {
                writer.setData(data, forType: Self.reorderType)
            }
            return writer
        }

        func collectionView(_ collectionView: NSCollectionView, draggingSession session: NSDraggingSession, willBeginAt screenPoint: NSPoint, forItemsAt indexPaths: Set<IndexPath>) {
            internalReorder = false
            let members = indexPaths.sorted { $0.item < $1.item }.compactMap { path in
                parent.items.indices.contains(path.item) ? parent.items[path.item] : nil
            }
            draggedURLs = members.filter(\.isAvailable).map(\.resolvedURL)
            missingURLs = members.filter { !$0.isAvailable }.map(\.resolvedURL)
            if let previewURL = draggedURLs.first ?? members.first?.resolvedURL {
                let preview = ShelfDragPreview.image(for: previewURL, count: members.count,
                                                     scale: collectionView.window?.backingScaleFactor ?? 2)
                ShelfDragPreview.apply(to: session, in: collectionView, at: screenPoint, image: preview)
            }
            session.animatesToStartingPositionsOnCancelOrFail = true
            collection?.setDraggingAppearance(true)
            NotificationCenter.default.post(name: Notification.Name("ShelfDragStarted"), object: parent.shelfID)
            // 只有"按下之前就按着 Shift"才需要立刻同步；否则发的是默认值 false，
            // 白白让面板为一次没变化的布尔值重画（实测 p95 2.18ms / 最大 5.79ms）。
            if NSEvent.modifierFlags.contains(.shift) {
                NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: parent.shelfID,
                                                userInfo: ["keepOpen": true])
            }
        }

        func collectionView(_ collectionView: NSCollectionView, draggingSession session: NSDraggingSession, endedAt screenPoint: NSPoint, dragOperation operation: NSDragOperation) {
            collection?.setDraggingAppearance(false)
            NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: parent.shelfID,
                                            userInfo: ["keepOpen": false])
            NotificationCenter.default.post(name: Notification.Name("ShelfDragEnded"), object: parent.shelfID)
            let urls = draggedURLs
            draggedURLs.removeAll()
            let keepOpen = NSEvent.modifierFlags.contains(.shift) || !missingURLs.isEmpty
            if !internalReorder {
                reportMissingFiles(missingURLs, callback: parent.onMissing)
                parent.onDragEnd(operation, urls, keepOpen)
            }
            missingURLs.removeAll()
            internalReorder = false
        }

        private func localMembers(_ pasteboard: NSPasteboard) -> [UUID]? {
            let markers = (pasteboard.pasteboardItems ?? []).compactMap { item -> DragMember? in
                guard let data = item.data(forType: Self.reorderType) else { return nil }
                return try? JSONDecoder().decode(DragMember.self, from: data)
            }
            guard !markers.isEmpty, markers.count == pasteboard.pasteboardItems?.count,
                  markers.allSatisfy({ $0.shelf == parent.shelfID }) else { return nil }
            let valid = Set(parent.items.map(\.id))
            guard markers.allSatisfy({ valid.contains($0.member) }) else { return nil }
            return markers.map(\.member)
        }

        func collectionView(_ collectionView: NSCollectionView, validateDrop draggingInfo: NSDraggingInfo,
                            proposedIndexPath proposedDropIndexPath: AutoreleasingUnsafeMutablePointer<NSIndexPath>,
                            dropOperation proposedDropOperation: UnsafeMutablePointer<NSCollectionView.DropOperation>) -> NSDragOperation {
            guard !parent.disabled else { return [] }
            guard (draggingInfo.draggingSource as? ShelfGalleryCollection) === collectionView,
                  localMembers(draggingInfo.draggingPasteboard) != nil else { return [] }
            let path = proposedDropIndexPath.pointee as IndexPath
            proposedDropIndexPath.pointee = IndexPath(item: min(max(path.item, 0), parent.items.count), section: 0) as NSIndexPath
            proposedDropOperation.pointee = .before
            return draggingInfo.draggingSourceOperationMask.contains(.move) ? .move : .copy
        }

        func collectionView(_ collectionView: NSCollectionView, acceptDrop draggingInfo: NSDraggingInfo,
                            indexPath: IndexPath, dropOperation: NSCollectionView.DropOperation) -> Bool {
            guard !parent.disabled else { return false }
            guard (draggingInfo.draggingSource as? ShelfGalleryCollection) === collectionView else {
                guard !isReturningToShelf(draggingInfo.draggingPasteboard, id: parent.shelfID) else {
                    parent.onDropHighlight?(false)
                    return false
                }
                return parent.onDrop(draggingInfo.draggingPasteboard)
            }
            guard let moving = localMembers(draggingInfo.draggingPasteboard) else { return false }
            let ids = parent.items.map(\.id)
            let movingSet = Set(moving)
            let ordered = ids.filter { movingSet.contains($0) }
            let insertion = min(max(indexPath.item, 0), ids.count)
            let removedBefore = ids.prefix(insertion).filter { movingSet.contains($0) }.count
            var result = ids.filter { !movingSet.contains($0) }
            result.insert(contentsOf: ordered, at: min(max(0, insertion - removedBefore), result.count))
            internalReorder = true
            if result != ids { parent.onReorder(result) }
            return true
        }
    }
}

final class ShelfGalleryCollection: NSCollectionView {
    var shelfID: UUID?
    var localBindings: [ShortcutBinding] = []
    var interactionDisabled = false { didSet { if interactionDisabled { onDropHighlight?(false) } } }
    var onDropHighlight: ((Bool) -> Void)?
    var onExternalDrop: ((NSPasteboard) -> Bool)?
    var onCommand: ((String) -> Void)?
    var onOpenItem: ((IndexPath) -> Void)?
    var onPreviewSelected: (() -> Void)?
    var onRemoveSelected: (() -> Void)?
    var contextMenu: ((IndexPath) -> NSMenu?)?
    var onFocusReveal: (() -> Bool)?
    // 同 NativeDrag：movedTo 每次鼠标移动都调，值没变就不发通知。
    private var lastKeepOpenPublished: Bool?
    override func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
        super.draggingSession(session, movedTo: screenPoint)
        guard let shelfID else { return }
        let keepOpen = NSEvent.modifierFlags.contains(.shift)
        guard keepOpen != lastKeepOpenPublished else { return }
        lastKeepOpenPublished = keepOpen
        NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: shelfID,
                                        userInfo: ["keepOpen": keepOpen])
    }

    override func layout() {
        if let flow = collectionViewLayout as? NSCollectionViewFlowLayout, bounds.width > 0 {
            let columns: CGFloat = bounds.width >= 324 ? 3 : (bounds.width >= 216 ? 2 : 1)
            let spacing = 16 + (columns - 1) * 6
            // 参考应用实测：内容面板宽 400、格子 122×122（方形），卡片间距 131。
            // 这里原本上限 108、高 128，于是格子是竖的、比竞品小一大圈。
            let width = max(1, min(122, floor((bounds.width - spacing) / columns)))
            let size = NSSize(width: width, height: 122)
            if flow.itemSize != size { flow.itemSize = size }
        }
        super.layout()
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let path = indexPathForItem(at: convert(event.locationInWindow, from: nil))
        super.mouseDown(with: event)
        if event.clickCount == 2, let path, !interactionDisabled { onOpenItem?(path) }
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        guard let path = indexPathForItem(at: convert(event.locationInWindow, from: nil)) else { return nil }
        return contextMenu?(path)
    }

    override func keyDown(with event: NSEvent) {
        let selectionModifiers = event.modifierFlags.intersection([.command, .shift, .option, .control])
        if selectionModifiers.isEmpty, event.keyCode == 48, onFocusReveal?() == true { return }
        if selectionModifiers == .shift, (123...126).contains(Int(event.keyCode)) {
            super.keyDown(with: event); return
        }
        if window?.firstResponder is NSTextView, !event.modifierFlags.contains(.command) {
            super.keyDown(with: event); return
        }
        let flags = event.modifierFlags
        let modifiers: UInt32 = (flags.contains(.command) ? UInt32(cmdKey) : 0)
            | (flags.contains(.shift) ? UInt32(shiftKey) : 0)
            | (flags.contains(.option) ? UInt32(optionKey) : 0)
            | (flags.contains(.control) ? UInt32(controlKey) : 0)
        if let binding = localBindings.first(where: { $0.keyCode == UInt32(event.keyCode) && $0.modifiers == modifiers }) {
            if binding.enabled && !interactionDisabled {
                if binding.id == "preview" { onPreviewSelected?() } else { onCommand?(binding.id) }
            }
            return
        }
        if modifiers == 0, event.keyCode == 49 { if !interactionDisabled { onPreviewSelected?() }; return }
        if modifiers == 0, event.keyCode == 51 || event.keyCode == 117 { if !interactionDisabled { onRemoveSelected?() }; return }
        super.keyDown(with: event)
    }

    func setDraggingAppearance(_ dragging: Bool) {
        for case let item as ShelfGalleryItem in visibleItems() { item.setDraggingAppearance(dragging) }
    }
    private func isOwnDrag(_ sender: NSDraggingInfo) -> Bool { (sender.draggingSource as? ShelfGalleryCollection) === self }
    private func externalDropOperation(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !interactionDisabled, sender.draggingPasteboard.availableType(from: ContentReceiver.types) != nil else { return [] }
        if let shelfID, isReturningToShelf(sender.draggingPasteboard, id: shelfID) {
            onDropHighlight?(false)
            return []
        }
        return .copy
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if isOwnDrag(sender) { onDropHighlight?(false); return super.draggingEntered(sender) }
        let operation = externalDropOperation(sender)
        onDropHighlight?(operation.contains(.copy))
        return operation
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        if isOwnDrag(sender) { onDropHighlight?(false); return super.draggingUpdated(sender) }
        let operation = externalDropOperation(sender)
        onDropHighlight?(operation.contains(.copy))
        return operation
    }
    override func draggingExited(_ sender: NSDraggingInfo?) {
        onDropHighlight?(false)
        super.draggingExited(sender)
    }
    override func draggingEnded(_ sender: NSDraggingInfo) {
        onDropHighlight?(false)
        super.draggingEnded(sender)
    }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard !interactionDisabled else { onDropHighlight?(false); return false }
        return isOwnDrag(sender) ? super.prepareForDragOperation(sender) : !externalDropOperation(sender).isEmpty
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        defer { onDropHighlight?(false) }
        guard !interactionDisabled else { return false }
        if isOwnDrag(sender) { return super.performDragOperation(sender) }
        guard !externalDropOperation(sender).isEmpty else { return false }
        return onExternalDrop?(sender.draggingPasteboard) ?? false
    }
}

final class ShelfGalleryRevealItem: NSCollectionViewItem {
    let button = ShelfGalleryRevealButton(frame: .zero)

    override func loadView() { view = button }
    override func prepareForReuse() {
        super.prepareForReuse()
        button.reveal = nil
        button.isEnabled = false
    }
    func update(enabled: Bool, reveal: @escaping () -> Void) {
        button.isEnabled = enabled
        button.reveal = reveal
    }
}

/// 内容网格最后一格：「在 Finder 中显示」。
///
/// 之前这是一个 `NSButton(imagePosition: .imageAbove)`，图标 42pt 加 10pt 标题整体
/// 垂直居中，于是它的标题比旁边文件名的基线高了将近一格，看上去就是**歪的**。
/// 参考应用那一格和文件卡片是同一条基线：图标落在缩略图那条带里，标题和文件名齐平。
/// 这里改成用和 `ShelfGalleryCell` 同一套度量手工排版。
final class ShelfGalleryRevealButton: NSButton {
    /// 和 `ShelfGalleryCell` 保持一致：图标带 top 6 / 高 78，标题 top 92 / 高 17。
    private static let bandTop: CGFloat = 6
    private static let bandHeight: CGFloat = 78
    private static let titleTop: CGFloat = 92
    private static let titleHeight: CGFloat = 17
    private static let iconSide: CGFloat = 34

    var reveal: (() -> Void)?
    private var hoverTracking: NSTrackingArea?
    private var hovered = false
    private let iconView = ShelfGalleryImageView()
    private let label = NSTextField(labelWithString: "在 Finder 中显示")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        // 按钮本身不画东西：图标和文字都是子视图，按钮只负责点击和键盘焦点。
        title = ""
        image = nil
        isBordered = false
        iconView.image = ShelfSymbols.image(named: "arrowshape.turn.up.right.circle",
                                           pointSize: Self.iconSide,
                                           accessibilityDescription: "在 Finder 中显示")
        iconView.imageScaling = .scaleProportionallyDown
        iconView.contentTintColor = .secondaryLabelColor
        label.font = .systemFont(ofSize: 10, weight: .medium)
        label.alignment = .center
        label.textColor = .labelColor
        label.maximumNumberOfLines = 1
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for subview in [iconView, label] { subview.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(iconView)
        addSubview(label)
        NSLayoutConstraint.activate([
            iconView.centerXAnchor.constraint(equalTo: centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: topAnchor, constant: Self.bandTop + Self.bandHeight / 2),
            iconView.widthAnchor.constraint(equalToConstant: Self.iconSide),
            iconView.heightAnchor.constraint(equalToConstant: Self.iconSide),
            label.topAnchor.constraint(equalTo: topAnchor, constant: Self.titleTop),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            label.heightAnchor.constraint(equalToConstant: Self.titleHeight),
        ])
        setButtonType(.momentaryPushIn)
        focusRingType = .exterior
        target = self
        action = #selector(invokeReveal)
        wantsLayer = true
        layer?.cornerRadius = 6
        setAccessibilityLabel("在 Finder 中显示")
        setAccessibilityHelp("打开文件所在的文件夹，并在访达中选中这些文件。")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var acceptsFirstResponder: Bool { isEnabled }
    override var isEnabled: Bool {
        didSet {
            iconView.contentTintColor = isEnabled ? .secondaryLabelColor : .tertiaryLabelColor
            label.textColor = isEnabled ? .labelColor : .tertiaryLabelColor
            updateHover()
        }
    }
    override func updateTrackingAreas() {
        if let hoverTracking { removeTrackingArea(hoverTracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        hoverTracking = tracking
        super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; updateHover() }
    override func mouseExited(with event: NSEvent) { hovered = false; updateHover() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateHover() }
    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty,
           [36, 49, 76].contains(event.keyCode) {
            if isEnabled { performClick(nil) }
            return
        }
        super.keyDown(with: event)
    }
    @objc private func invokeReveal() { if isEnabled { reveal?() } }
    private func updateHover() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = (hovered && isEnabled ? NSColor.labelColor.withAlphaComponent(0.06) : .clear).cgColor
        }
    }
}

private final class ShelfGalleryItem: NSCollectionViewItem {
    private(set) var representedItemID: UUID?
    override func loadView() {
        let cell = ShelfGalleryCell(frame: .zero)
        view = cell
        imageView = cell.previewImageView
        textField = cell.titleField
    }
    override var isSelected: Bool { didSet { (view as? ShelfGalleryCell)?.setSelected(isSelected) } }
    override var highlightState: NSCollectionViewItem.HighlightState {
        didSet {
            let selected = highlightState == .forSelection || (isSelected && highlightState != .forDeselection)
            (view as? ShelfGalleryCell)?.setSelected(selected)
        }
    }
    override func prepareForReuse() {
        super.prepareForReuse()
        representedItemID = nil
        view.layer?.removeAnimation(forKey: "shelfInsertion")
        (view as? ShelfGalleryCell)?.reset()
    }
    func update(_ item: ShelfItem) {
        representedItemID = item.id
        (view as? ShelfGalleryCell)?.update(item)
        (view as? ShelfGalleryCell)?.setSelected(isSelected)
    }
    func setDraggingAppearance(_ dragging: Bool) { (view as? ShelfGalleryCell)?.setDraggingAppearance(dragging) }
}

final class ShelfGalleryImageView: NSImageView {
    static func fittedImageRect(size: NSSize, bounds: NSRect) -> NSRect? {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0,
              bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let fitted = NSSize(width: size.width * scale, height: size.height * scale)
        return NSRect(x: bounds.midX - fitted.width / 2, y: bounds.midY - fitted.height / 2,
                      width: fitted.width, height: fitted.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let image, let fitted = Self.fittedImageRect(size: image.size, bounds: bounds) else {
            super.draw(dirtyRect)
            return
        }
        NSGraphicsContext.saveGraphicsState()
        let radius = min(6, fitted.width / 2, fitted.height / 2)
        NSBezierPath(roundedRect: fitted, xRadius: radius, yRadius: radius).addClip()
        super.draw(dirtyRect)
        NSGraphicsContext.restoreGraphicsState()
    }
}

private final class ShelfGalleryCell: NSView {
    private let hoverLayer = CALayer()
    private let highlightLayer = CALayer()
    private let preview = NSView()
    private let thumbnail = ShelfGalleryImageView()
    private let nameLabel = NSTextField(labelWithString: "")
    private let sourceLabel = NSTextField(labelWithString: "")
    private let sourceIcon = NSImageView()
    private let statusIcon = NSImageView()
    private var representedID: UUID?
    private var representedURL: URL?
    private var hoverTracking: NSTrackingArea?
    private var hovered = false
    private var selected = false
    private var dragging = false
    private var sourceAvailable = true
    var previewImageView: NSImageView { thumbnail }
    var titleField: NSTextField { nameLabel }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        hoverLayer.cornerRadius = 6
        hoverLayer.opacity = 0
        layer?.addSublayer(hoverLayer)
        highlightLayer.cornerRadius = 6
        highlightLayer.opacity = 0
        layer?.addSublayer(highlightLayer)
        preview.wantsLayer = true
        preview.layer?.cornerRadius = 6
        preview.layer?.borderWidth = 0
        thumbnail.imageScaling = .scaleProportionallyUpOrDown
        thumbnail.imageAlignment = .alignCenter
        thumbnail.unregisterDraggedTypes()
        statusIcon.imageScaling = .scaleProportionallyDown
        sourceIcon.imageScaling = .scaleProportionallyDown
        sourceIcon.image = ShelfSymbols.image(.folder, pointSize: 11)
        sourceIcon.contentTintColor = ShelfGlassPalette.secondaryLabel
        nameLabel.font = .systemFont(ofSize: 10, weight: .medium)
        sourceLabel.font = .systemFont(ofSize: 9, weight: .regular)
        nameLabel.alignment = .center
        nameLabel.textColor = .labelColor
        sourceLabel.textColor = ShelfGlassPalette.secondaryLabel
        for label in [nameLabel, sourceLabel] {
            label.maximumNumberOfLines = 1
            label.lineBreakMode = .byTruncatingMiddle
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        }
        let sourceRow = NSStackView(views: [sourceIcon, sourceLabel])
        sourceRow.orientation = .horizontal
        sourceRow.alignment = .centerY
        sourceRow.spacing = 4
        addSubview(preview); preview.addSubview(thumbnail); preview.addSubview(statusIcon)
        addSubview(nameLabel); addSubview(sourceRow)
        for subview in [preview, thumbnail, nameLabel, sourceRow, sourceIcon, statusIcon] { subview.translatesAutoresizingMaskIntoConstraints = false }
        let previewWidth = preview.widthAnchor.constraint(equalToConstant: 84)
        previewWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            preview.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            preview.centerXAnchor.constraint(equalTo: centerXAnchor),
            previewWidth, preview.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -16),
            preview.heightAnchor.constraint(equalToConstant: 78),
            thumbnail.leadingAnchor.constraint(equalTo: preview.leadingAnchor, constant: 4),
            thumbnail.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -4),
            thumbnail.topAnchor.constraint(equalTo: preview.topAnchor, constant: 4),
            thumbnail.bottomAnchor.constraint(equalTo: preview.bottomAnchor, constant: -4),
            statusIcon.trailingAnchor.constraint(equalTo: preview.trailingAnchor, constant: -5),
            statusIcon.topAnchor.constraint(equalTo: preview.topAnchor, constant: 5),
            statusIcon.widthAnchor.constraint(equalToConstant: 15), statusIcon.heightAnchor.constraint(equalToConstant: 15),
            nameLabel.topAnchor.constraint(equalTo: preview.bottomAnchor, constant: 8),
            nameLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            nameLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            nameLabel.heightAnchor.constraint(equalToConstant: 17),
            sourceRow.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 3),
            sourceRow.centerXAnchor.constraint(equalTo: centerXAnchor),
            sourceRow.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 6),
            sourceRow.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -6),
            sourceRow.heightAnchor.constraint(equalToConstant: 14),
            sourceIcon.widthAnchor.constraint(equalToConstant: 11), sourceIcon.heightAnchor.constraint(equalToConstant: 11),
        ])
        updateHighlight()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        hoverLayer.frame = bounds.insetBy(dx: 2, dy: 1)
        highlightLayer.frame = bounds.insetBy(dx: 2, dy: 1)
        CATransaction.commit()
    }

    override func updateTrackingAreas() {
        if let hoverTracking { removeTrackingArea(hoverTracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(tracking); hoverTracking = tracking
        super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; updateHighlight() }
    override func mouseExited(with event: NSEvent) { hovered = false; updateHighlight() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateHighlight() }

    func update(_ item: ShelfItem) {
        representedID = item.id
        let url = item.resolvedURL
        representedURL = url
        let available = item.isAvailable
        sourceAvailable = available
        let source = url.deletingLastPathComponent()
        nameLabel.stringValue = item.name
        sourceLabel.stringValue = available ? (source.lastPathComponent.isEmpty ? source.path : source.lastPathComponent) : "原文件不可用"
        sourceLabel.textColor = available ? ShelfGlassPalette.secondaryLabel : .systemRed
        sourceIcon.image = ShelfSymbols.image(available ? .folder : .warning, pointSize: 11)
        sourceIcon.isHidden = false
        sourceIcon.contentTintColor = available ? ShelfGlassPalette.secondaryLabel : .systemRed
        sourceLabel.toolTip = available ? source.path : "原文件找不到、磁盘未连接或无法访问：\(url.path)"
        nameLabel.toolTip = item.name
        toolTip = url.path + (available ? "" : "\n原文件找不到、磁盘未连接或无法访问") + (item.result.map { "\n" + $0 } ?? "")
        setAccessibilityLabel("\(item.name)，\(sourceLabel.stringValue)，\(item.result ?? "")")
        statusIcon.isHidden = available && item.result?.isEmpty != false
        let statusSymbol: ShelfSymbol = item.lastActionSucceeded.map { $0 ? .success : .warning } ?? .info
        statusIcon.image = ShelfSymbols.image(available ? statusSymbol : .warning, pointSize: 13, accessibilityDescription: item.result)
        statusIcon.contentTintColor = available ? (item.lastActionSucceeded.map { $0 ? .systemGreen : .systemRed } ?? ShelfGlassPalette.secondaryLabel) : .systemRed
        thumbnail.alphaValue = available ? 1 : 0.42
        if available {
            let metadata = ShelfFileMetadataCache.shared.metadata(for: url) { [weak self] metadata in
                guard let self, self.representedID == item.id, self.representedURL == url else { return }
                self.applyMetadata(metadata, item: item, source: source)
            }
            applyMetadata(metadata, item: item, source: source)
        }
        thumbnail.image = ShelfThumbnailCache.shared.image(for: url, size: 84, scale: window?.backingScaleFactor ?? 2) { [weak self] in
            guard let self, self.representedID == item.id, self.representedURL == url else { return }
            self.thumbnail.image = ShelfThumbnailCache.shared.image(for: url, size: 84, scale: self.window?.backingScaleFactor ?? 2, ready: {})
        }
        updateHighlight()
    }
    private func applyMetadata(_ metadata: ShelfFileMetadata?, item: ShelfItem, source: URL) {
        let information = metadata?.compactDescription ?? ""
        sourceLabel.stringValue = information.isEmpty ? (source.lastPathComponent.isEmpty ? source.path : source.lastPathComponent) : information
        sourceIcon.isHidden = !information.isEmpty
        sourceLabel.toolTip = source.path + (information.isEmpty ? "" : "\n" + information)
        setAccessibilityLabel("\(item.name)，\(sourceLabel.stringValue)，来自\(source.path)，\(item.result ?? "")")
    }

    func reset() {
        representedID = nil
        representedURL = nil
        hovered = false; selected = false; dragging = false
        sourceAvailable = true
        thumbnail.image = nil
        nameLabel.stringValue = ""; sourceLabel.stringValue = ""
        statusIcon.isHidden = true
        toolTip = nil
        updateHighlight()
    }
    func setSelected(_ value: Bool) { selected = value; updateHighlight() }
    func setDraggingAppearance(_ value: Bool) {
        dragging = value
        let opacity: CGFloat = value ? 0.45 : 1
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            nameLabel.alphaValue = opacity
        } else {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.14
                nameLabel.animator().alphaValue = opacity
            }
        }
        sourceLabel.alphaValue = opacity; sourceIcon.alphaValue = opacity
    }
    private func updateHighlight() {
        let selectedOpacity: Float = selected ? 1 : 0
        let hoveredOpacity: Float = hovered && !selected ? 1 : 0
        let previousSelection = highlightLayer.presentation()?.opacity ?? highlightLayer.opacity
        let previousHover = hoverLayer.presentation()?.opacity ?? hoverLayer.opacity
        let selectedText = NSColor.alternateSelectedControlTextColor
        CATransaction.begin(); CATransaction.setDisableActions(true)
        hoverLayer.backgroundColor = NSColor.labelColor.withAlphaComponent(0.06).cgColor
        hoverLayer.opacity = hoveredOpacity
        highlightLayer.backgroundColor = NSColor.selectedContentBackgroundColor.cgColor
        highlightLayer.opacity = selectedOpacity
        preview.layer?.backgroundColor = nil
        preview.layer?.borderColor = nil
        preview.layer?.borderWidth = 0
        CATransaction.commit()
        nameLabel.textColor = selected ? selectedText : .labelColor
        let sourceColor = sourceAvailable ? ShelfGlassPalette.secondaryLabel : .systemRed
        sourceLabel.textColor = selected ? selectedText.withAlphaComponent(0.85) : sourceColor
        sourceIcon.contentTintColor = selected ? selectedText.withAlphaComponent(0.85) : sourceColor
        highlightLayer.removeAnimation(forKey: "highlight")
        hoverLayer.removeAnimation(forKey: "highlight")
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            for (layer, previous, opacity) in [(highlightLayer, previousSelection, selectedOpacity),
                                               (hoverLayer, previousHover, hoveredOpacity)] {
                let animation = CABasicAnimation(keyPath: "opacity")
                animation.fromValue = previous; animation.toValue = opacity; animation.duration = 0.12
                animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
                layer.add(animation, forKey: "highlight")
            }
        }
    }
}
