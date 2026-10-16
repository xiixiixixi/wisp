import AppKit
import Carbon
import QuartzCore
import SwiftUI
import ShelfCore

struct ShelfItemTable: NSViewRepresentable {
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

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let table = ShelfListTable()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("item"))
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.headerView = nil
        table.style = .fullWidth
        table.rowHeight = 60
        table.intercellSpacing = .zero
        table.usesAlternatingRowBackgroundColors = false
        table.gridStyleMask = []
        table.allowsMultipleSelection = true
        table.allowsEmptySelection = true
        table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
        table.backgroundColor = .clear
        table.delegate = context.coordinator
        table.dataSource = context.coordinator
        table.target = context.coordinator
        table.doubleAction = #selector(Coordinator.openClicked(_:))
        table.registerForDraggedTypes([Coordinator.reorderType] + ContentReceiver.types)
        table.setDraggingSourceOperationMask([.copy, .move], forLocal: true)
        table.setDraggingSourceOperationMask(copyOnly ? .copy : [.copy, .move], forLocal: false)
        table.localBindings = localBindings
        table.onCommand = { [weak coordinator = context.coordinator] command in coordinator?.parent.onCommand(command) }
        table.onPreviewSelected = { [weak coordinator = context.coordinator] in coordinator?.previewSelected() }
        table.onRemoveSelected = { [weak coordinator = context.coordinator] in coordinator?.removeFromMenu() }
        table.onDropHighlight = { [weak coordinator = context.coordinator] value in coordinator?.parent.onDropHighlight?(value) }
        table.contextMenu = { [weak coordinator = context.coordinator] row in coordinator?.menu(row: row) }
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        context.coordinator.table = table
        updateNSView(scroll, context: context)
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        guard let table = coordinator.table else { return }
        coordinator.parent = self
        table.shelfID = shelfID
        table.localBindings = localBindings
        table.interactionDisabled = disabled
        coordinator.applyingSelection = true
        let previousIDs = Set(coordinator.renderedItems.map(\.id))
        let insertedIDs = coordinator.hasRenderedItems ? Set(items.map(\.id)).subtracting(previousIDs) : []
        if coordinator.renderedItems != items { coordinator.renderedItems = items; table.reloadData() }
        coordinator.hasRenderedItems = true
        let current = Set(table.selectedRowIndexes.compactMap { items.indices.contains($0) ? items[$0].id : nil })
        if current != selection { table.selectRowIndexes(IndexSet(items.indices.filter { selection.contains(items[$0].id) }), byExtendingSelection: false) }
        coordinator.applyingSelection = false
        if !insertedIDs.isEmpty {
            table.layoutSubtreeIfNeeded()
            for row in items.indices where insertedIDs.contains(items[row].id) {
                if let view = table.rowView(atRow: row, makeIfNecessary: false) { animateShelfItemInsertion(view) }
            }
        }
        table.setDraggingSourceOperationMask(copyOnly ? .copy : [.copy, .move], forLocal: false)
        updateShelfScrollerVisibility(scroll)
    }

    final class Coordinator: NSObject, NSTableViewDataSource, NSTableViewDelegate {
        static let reorderType = NSPasteboard.PasteboardType("com.wisp.shelf.member-order")
        struct DragMember: Codable { var shelf: UUID; var member: UUID }
        var parent: ShelfItemTable
        weak var table: ShelfListTable?
        var applyingSelection = false
        var renderedItems: [ShelfItem] = []
        var hasRenderedItems = false
        private var draggedURLs: [URL] = []
        private var missingURLs: [URL] = []
        private var internalReorder = false
        init(_ parent: ShelfItemTable) { self.parent = parent }

        func numberOfRows(in tableView: NSTableView) -> Int { parent.items.count }
        func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? { ShelfItemRowView() }
        func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
            guard parent.items.indices.contains(row) else { return nil }
            let identifier = NSUserInterfaceItemIdentifier("ShelfItemCell")
            let cell = tableView.makeView(withIdentifier: identifier, owner: self) as? ShelfItemCell ?? ShelfItemCell()
            cell.identifier = identifier
            cell.update(parent.items[row])
            return cell
        }
        func tableViewSelectionDidChange(_ notification: Notification) {
            guard !applyingSelection, let table else { return }
            table.window?.makeFirstResponder(table)
            parent.selection = Set(table.selectedRowIndexes.compactMap { parent.items.indices.contains($0) ? parent.items[$0].id : nil })
        }
        @objc func openClicked(_ sender: NSTableView) {
            guard !parent.disabled, parent.items.indices.contains(sender.clickedRow) else { return }
            let item = parent.items[sender.clickedRow]
            guard item.isAvailable else { reportMissingFiles([item.resolvedURL], callback: parent.onMissing); return }
            parent.onOpen(item)
        }
        private var selectedItems: [ShelfItem] { parent.items.filter { parent.selection.contains($0.id) } }
        fileprivate func previewSelected() {
            guard !parent.disabled else { return }
            let chosen = selectedItems.isEmpty ? parent.items : selectedItems
            let missing = chosen.filter { !$0.isAvailable }.map(\.resolvedURL)
            reportMissingFiles(missing, callback: parent.onMissing)
            let available = chosen.filter(\.isAvailable).map(\.resolvedURL)
            if !available.isEmpty { parent.onPreview(available) }
        }
        func menu(row: Int) -> NSMenu? {
            guard let table, parent.items.indices.contains(row) else { return nil }
            if !table.selectedRowIndexes.contains(row) { table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false) }
            let chosen = table.selectedRowIndexes.compactMap { parent.items.indices.contains($0) ? parent.items[$0] : nil }
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
        @objc fileprivate func removeFromMenu() { if !parent.disabled { parent.onRemove(Set(selectedItems.map(\.id))) } }

        func tableView(_ tableView: NSTableView, pasteboardWriterForRow row: Int) -> NSPasteboardWriting? {
            guard !parent.disabled, parent.items.indices.contains(row) else { return nil }
            let member = parent.items[row]
            let writer = NSPasteboardItem()
            if member.isAvailable { writer.setString(member.resolvedURL.absoluteString, forType: .fileURL) }
            if let data = try? JSONEncoder().encode(DragMember(shelf: parent.shelfID, member: member.id)) { writer.setData(data, forType: Self.reorderType) }
            return writer
        }
        func tableView(_ tableView: NSTableView, draggingSession session: NSDraggingSession, willBeginAt screenPoint: NSPoint, forRowIndexes rowIndexes: IndexSet) {
            internalReorder = false
            let members = rowIndexes.compactMap { parent.items.indices.contains($0) ? parent.items[$0] : nil }
            if let previewURL = members.first(where: \.isAvailable)?.resolvedURL ?? members.first?.resolvedURL {
                let preview = ShelfDragPreview.image(for: previewURL, count: members.count,
                                                     scale: tableView.window?.backingScaleFactor ?? 2)
                ShelfDragPreview.apply(to: session, in: tableView, at: screenPoint, image: preview)
            }
            session.animatesToStartingPositionsOnCancelOrFail = true
            NotificationCenter.default.post(name: Notification.Name("ShelfDragStarted"), object: parent.shelfID)
            // 同上：只有按住 Shift 才需要立刻同步，否则白白多一次面板重画。
            if NSEvent.modifierFlags.contains(.shift) {
                NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: parent.shelfID,
                                                userInfo: ["keepOpen": true])
            }
            draggedURLs = members.filter(\.isAvailable).map(\.resolvedURL)
            missingURLs = members.filter { !$0.isAvailable }.map(\.resolvedURL)
        }
        func tableView(_ tableView: NSTableView, draggingSession session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
            NotificationCenter.default.post(name: Notification.Name("ShelfDragModifiers"), object: parent.shelfID,
                                            userInfo: ["keepOpen": false])
            NotificationCenter.default.post(name: Notification.Name("ShelfDragEnded"), object: parent.shelfID)
            let urls = draggedURLs; draggedURLs.removeAll()
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
            guard !markers.isEmpty, markers.allSatisfy({ $0.shelf == parent.shelfID }),
                  markers.count == pasteboard.pasteboardItems?.count else { return nil }
            let valid = Set(parent.items.map(\.id))
            guard markers.allSatisfy({ valid.contains($0.member) }) else { return nil }
            return markers.map(\.member)
        }
        func tableView(_ tableView: NSTableView, validateDrop info: NSDraggingInfo, proposedRow row: Int, proposedDropOperation dropOperation: NSTableView.DropOperation) -> NSDragOperation {
            guard !parent.disabled else { return [] }
            if (info.draggingSource as? ShelfListTable) === tableView {
                guard localMembers(info.draggingPasteboard) != nil else { return [] }
                tableView.setDropRow(min(max(0, row), parent.items.count), dropOperation: .above)
                return info.draggingSourceOperationMask.contains(.move) ? .move : .copy
            }
            guard !isReturningToShelf(info.draggingPasteboard, id: parent.shelfID) else {
                parent.onDropHighlight?(false)
                return []
            }
            tableView.setDropRow(-1, dropOperation: .on)
            return info.draggingPasteboard.availableType(from: ContentReceiver.types) == nil ? [] : .copy
        }
        func tableView(_ tableView: NSTableView, acceptDrop info: NSDraggingInfo, row: Int, dropOperation: NSTableView.DropOperation) -> Bool {
            guard !parent.disabled else { return false }
            guard (info.draggingSource as? ShelfListTable) === tableView else {
                guard !isReturningToShelf(info.draggingPasteboard, id: parent.shelfID) else {
                    parent.onDropHighlight?(false)
                    return false
                }
                return parent.onDrop(info.draggingPasteboard)
            }
            guard let moving = localMembers(info.draggingPasteboard) else { return false }
            let ids = parent.items.map(\.id)
            let movingSet = Set(moving)
            let ordered = ids.filter { movingSet.contains($0) }
            let insertion = min(max(row, 0), ids.count)
            // Translate the drop row after removing the dragged members.
            let removedBefore = ids.prefix(insertion).filter { movingSet.contains($0) }.count
            var result = ids.filter { !movingSet.contains($0) }
            result.insert(contentsOf: ordered, at: min(max(0, insertion - removedBefore), result.count))
            internalReorder = true
            if result != ids { parent.onReorder(result) }
            return true
        }
    }
}

private final class ShelfItemRowView: NSTableRowView {
    private let highlightLayer = CALayer()
    private var hoverTracking: NSTrackingArea?
    private var hovered = false
    override var isSelected: Bool { didSet { updateHighlight() } }
    override var isEmphasized: Bool { didSet { updateHighlight() } }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        highlightLayer.cornerRadius = 6
        highlightLayer.opacity = 0
        layer?.addSublayer(highlightLayer)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        highlightLayer.frame = bounds.insetBy(dx: 5, dy: 3)
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
    override func drawSelection(in dirtyRect: NSRect) { }
    private func updateHighlight() {
        let opacity: Float = isSelected ? 1 : (hovered ? 0.38 : 0)
        let previous = highlightLayer.presentation()?.opacity ?? highlightLayer.opacity
        CATransaction.begin(); CATransaction.setDisableActions(true)
        highlightLayer.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(isEmphasized ? 0.18 : 0.10).cgColor
        highlightLayer.borderColor = NSColor.controlAccentColor.cgColor
        highlightLayer.borderWidth = isSelected && NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast ? 1 : 0
        highlightLayer.opacity = opacity
        CATransaction.commit()
        highlightLayer.removeAnimation(forKey: "highlight")
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let animation = CABasicAnimation(keyPath: "opacity")
            animation.fromValue = previous; animation.toValue = opacity; animation.duration = 0.14
            highlightLayer.add(animation, forKey: "highlight")
        }
    }
}

func animateShelfItemInsertion(_ view: NSView) {
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
    view.wantsLayer = true
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0; fade.toValue = 1
    let movement = CABasicAnimation(keyPath: "transform.translation.y")
    movement.fromValue = 5; movement.toValue = 0
    let animation = CAAnimationGroup()
    animation.animations = [fade, movement]
    animation.duration = 0.18
    animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
    view.layer?.add(animation, forKey: "shelfInsertion")
}

func updateShelfScrollerVisibility(_ scroll: NSScrollView) {
    // SwiftUI supplies the final viewport after the representable's update.
    DispatchQueue.main.async { [weak scroll] in
        guard let scroll, let document = scroll.documentView, scroll.window != nil else { return }
        scroll.window?.contentView?.layoutSubtreeIfNeeded()
        scroll.layoutSubtreeIfNeeded()
        document.layoutSubtreeIfNeeded()
        let viewportHeight = scroll.contentView.bounds.height
        guard viewportHeight > 1 else { return }
        let contentHeight = (document as? NSCollectionView)?.collectionViewLayout?.collectionViewContentSize.height ?? document.frame.height
        let needsScroller = contentHeight > viewportHeight + 1
        if scroll.hasVerticalScroller != needsScroller { scroll.hasVerticalScroller = needsScroller }
    }
}

final class ShelfListTable: NSTableView {
    var shelfID: UUID?
    var localBindings: [ShortcutBinding] = []
    var onCommand: ((String) -> Void)?
    var onPreviewSelected: (() -> Void)?
    var onRemoveSelected: (() -> Void)?
    var interactionDisabled = false { didSet { if interactionDisabled { onDropHighlight?(false) } } }
    var onDropHighlight: ((Bool) -> Void)?
    var contextMenu: ((Int) -> NSMenu?)?
    // movedTo 在拖拽全程【每次鼠标移动】都会被调用。原来每次都读系统按键状态 +
    // 发一条 ShelfDragModifiers 通知，而这条通知在 SwiftUI 那头会改 @State，
    // 等于光标每动一下就走一趟「系统调用 + 通知派发 + 状态更新」。
    // 按住 Shift 的提示只在按下/松开那两下才需要变，值没变就别发
    // （与 NativeDrag 里的拖拽源同一个处理）。
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
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        super.mouseDown(with: event)
    }
    override func keyDown(with event: NSEvent) {
        let selectionModifiers = event.modifierFlags.intersection([.command, .shift, .option, .control])
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
    override func menu(for event: NSEvent) -> NSMenu? {
        contextMenu?(row(at: convert(event.locationInWindow, from: nil)))
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !interactionDisabled else { onDropHighlight?(false); return [] }
        let operation = super.draggingEntered(sender)
        onDropHighlight?(operation.contains(.copy) && (sender.draggingSource as? ShelfListTable) !== self)
        return operation
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !interactionDisabled else { onDropHighlight?(false); return [] }
        let operation = super.draggingUpdated(sender)
        onDropHighlight?(operation.contains(.copy) && (sender.draggingSource as? ShelfListTable) !== self)
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
        return super.prepareForDragOperation(sender)
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        defer { onDropHighlight?(false) }
        guard !interactionDisabled else { return false }
        return super.performDragOperation(sender)
    }
}

final class ShelfItemCell: NSTableCellView {
    private let icon = NSImageView()
    private let nameLabel = NSTextField(labelWithString: "")
    private let sourceLabel = NSTextField(labelWithString: "")
    private let resultLabel = NSTextField(labelWithString: "")
    private let resultIcon = NSImageView()
    /// #46：结果行的复制按钮——OCR 输出的 .txt 直接复制文件内容，其余复制结果文案。
    private let copyResultButton = NSButton()
    private lazy var resultRow = NSStackView(views: [resultIcon, resultLabel, copyResultButton])
    private var representedID: UUID?
    private var representedURL: URL?
    private var representedOutputURL: URL?
    private var sourceAvailable = true
    override var backgroundStyle: NSView.BackgroundStyle {
        didSet { applySemanticTextColors() }
    }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        let labels = NSStackView(views: [nameLabel, sourceLabel, resultRow])
        labels.orientation = .vertical; labels.alignment = .leading; labels.spacing = 2
        resultRow.orientation = .horizontal; resultRow.alignment = .centerY; resultRow.spacing = 4
        resultIcon.imageScaling = .scaleProportionallyDown
        icon.imageScaling = .scaleProportionallyUpOrDown
        nameLabel.font = .systemFont(ofSize: 13, weight: .medium)
        sourceLabel.font = .systemFont(ofSize: 11)
        resultLabel.font = .systemFont(ofSize: 11)
        nameLabel.textColor = .labelColor
        sourceLabel.textColor = ShelfGlassPalette.secondaryLabel; resultLabel.textColor = ShelfGlassPalette.secondaryLabel
        for label in [nameLabel, sourceLabel, resultLabel] {
            label.maximumNumberOfLines = 1
            label.lineBreakMode = label === sourceLabel ? .byTruncatingMiddle : .byTruncatingTail
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            label.translatesAutoresizingMaskIntoConstraints = false
        }
        copyResultButton.isBordered = false
        copyResultButton.image = ShelfSymbols.image(.copy, pointSize: 11, accessibilityDescription: "复制结果文本")
        copyResultButton.imageScaling = .scaleProportionallyDown
        copyResultButton.imagePosition = .imageOnly
        copyResultButton.contentTintColor = ShelfGlassPalette.secondaryLabel
        copyResultButton.toolTip = "复制结果文本"
        copyResultButton.action = #selector(copyResultText)
        copyResultButton.target = self
        addSubview(icon); addSubview(labels)
        icon.translatesAutoresizingMaskIntoConstraints = false; labels.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 40), icon.heightAnchor.constraint(equalToConstant: 40),
            labels.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10), labels.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            labels.centerYAnchor.constraint(equalTo: centerYAnchor),
            nameLabel.widthAnchor.constraint(equalTo: labels.widthAnchor), sourceLabel.widthAnchor.constraint(equalTo: labels.widthAnchor), resultRow.widthAnchor.constraint(equalTo: labels.widthAnchor),
            resultIcon.widthAnchor.constraint(equalToConstant: 11), resultIcon.heightAnchor.constraint(equalToConstant: 11),
            copyResultButton.widthAnchor.constraint(equalToConstant: 16), copyResultButton.heightAnchor.constraint(equalToConstant: 14),
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    /// #46：OCR 的输出文件是 .txt——优先复制文件正文；没有输出文件时复制结果文案。
    @objc private func copyResultText() {
        var text = resultLabel.stringValue
        if let output = representedOutputURL, output.pathExtension.lowercased() == "txt",
           let content = try? String(contentsOf: output, encoding: .utf8) {
            text = content
        }
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        applySemanticTextColors()
    }
    private func applySemanticTextColors() {
        // The custom pale selection keeps the same semantic text colors as an unselected row.
        for label in [nameLabel, sourceLabel, resultLabel] { label.cell?.backgroundStyle = .light }
        nameLabel.textColor = .labelColor
        sourceLabel.textColor = sourceAvailable ? ShelfGlassPalette.secondaryLabel : .labelColor
        resultLabel.textColor = ShelfGlassPalette.secondaryLabel
    }
    func update(_ item: ShelfItem) {
        representedID = item.id
        sourceAvailable = item.isAvailable
        let url = item.resolvedURL
        representedURL = url
        representedOutputURL = item.outputURL
        nameLabel.stringValue = item.name
        let source = url.deletingLastPathComponent()
        sourceLabel.stringValue = item.isAvailable ? "" : "原文件不可用"
        sourceLabel.toolTip = item.isAvailable ? source.path : "原文件找不到、磁盘未连接或无法访问：\(url.path)"
        sourceLabel.textColor = item.isAvailable ? ShelfGlassPalette.secondaryLabel : .labelColor
        resultLabel.stringValue = item.result ?? ""
        resultRow.isHidden = item.result?.isEmpty != false
        let resultColor: NSColor = item.lastActionSucceeded.map { $0 ? .systemGreen : .systemRed } ?? ShelfGlassPalette.secondaryLabel
        resultLabel.textColor = ShelfGlassPalette.secondaryLabel
        resultIcon.contentTintColor = resultColor
        resultIcon.image = ShelfSymbols.image(item.lastActionSucceeded.map { $0 ? .success : .warning } ?? .info, pointSize: 12, accessibilityDescription: item.result)
        toolTip = url.path + (item.result.map { "\n" + $0 } ?? "")
        setAccessibilityLabel("\(item.name)，\(sourceLabel.stringValue)，\(item.result ?? "")")
        applySemanticTextColors()
        if item.isAvailable {
            let metadata = ShelfFileMetadataCache.shared.metadata(for: url) { [weak self] metadata in
                guard let self, self.representedID == item.id, self.representedURL == url else { return }
                self.applyMetadata(metadata, item: item, source: source)
            }
            applyMetadata(metadata, item: item, source: source)
        }
        icon.image = ShelfThumbnailCache.shared.image(for: url, size: 40, scale: window?.backingScaleFactor ?? 2) { [weak self] in
            guard let self, self.representedID == item.id, self.representedURL == url else { return }
            self.icon.image = ShelfThumbnailCache.shared.image(for: url, size: 40, scale: self.window?.backingScaleFactor ?? 2, ready: {})
        }
    }
    func applyMetadata(_ metadata: ShelfFileMetadata?, item: ShelfItem, source: URL) {
        let information = metadata?.compactDescription ?? ""
        sourceLabel.stringValue = information
        sourceLabel.toolTip = source.path + (information.isEmpty ? "" : "\n" + information)
        setAccessibilityLabel("\(item.name)，\(sourceLabel.stringValue)，\(item.result ?? "")")
    }
}
