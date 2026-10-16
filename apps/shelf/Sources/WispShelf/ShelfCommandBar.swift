import AppKit
import SwiftUI
import ShelfCore

private extension Optional where Wrapped == String {
    var nilIfEmpty: String? { self?.isEmpty == true ? nil : self }
}

/// 命令栏的一个条目（扁平结构；分组信息由 `ShelfCommandCatalog.grouped` 另行给出）。
struct ShelfCommandEntry: Equatable {
    /// 行的唯一标识（最近使用组会加 "recent:" 前缀避免和建议组撞 id）。
    let id: String
    /// 分发用的原始命令（action:… / utility:… / preset:… / script:… / cloud:…）。
    let command: String
    let title: String
    let symbol: String
    let keywords: [String]
    let enabled: Bool
    /// #51：副标题（脚本的描述），作 tooltip 的一部分。
    let detail: String?
}

/// #72/#73：命令栏目录。条目覆盖 标准操作+工具+自定义操作+脚本+云上传，
/// 分组固定「建议 → 最近使用」，关键词走中英别名表。
/// 全部是纯函数：不依赖窗口，分组顺序与别名命中可直接单测。
enum ShelfCommandCatalog {
    /// 关键词别名表（矩阵 #72）：命令 → 中英高频词。匹配对标题与别名都做包含。
    static let keywordAliases: [String: [String]] = [
        "action:archive": ["压缩", "打包", "归档", "zip", "archive"],
        "action:rename": ["改名", "重命名", "批量命名", "名字", "rename"],
        "action:copy": ["复制", "拷贝", "copy"],
        "action:move": ["移动", "搬家", "move"],
        "action:resizeImages": ["缩放", "调整大小", "尺寸", "变小", "resize", "scale"],
        "action:compressImages": ["压缩图片", "图片压缩", "减小体积", "compress"],
        "action:convertImages": ["转换", "转格式", "格式转换", "convert"],
        "action:imagePDF": ["pdf", "转pdf", "图片转文档"],
        "action:extractText": ["ocr", "文字", "识别", "提取", "text"],
        "action:stitchImages": ["拼接", "拼图", "长图", "stitch"],
        "action:mergePDFs": ["合并", "合并pdf", "merge"],
        "action:protectPDF": ["密码", "加密", "保护", "password", "lock"],
        "action:desktopPicture": ["壁纸", "桌面背景", "wallpaper", "desktop"],
        "action:openApp": ["打开方式", "用应用打开", "open with", "app"],
        "utility:copyPaths": ["路径", "地址", "path", "copy path"],
        "utility:copyTextContents": ["文本", "正文", "内容", "text content"],
        // #47：手动涂黑。
        "utility:redactImages": ["涂黑", "遮盖", "打码", "redact"],
        "utility:removeImageMetadata": ["元数据", "exif", "位置信息", "metadata", "gps"],
        "utility:moveToTrash": ["删除", "废纸篓", "trash", "delete"],
        "cloud": ["上传", "云", "分享链接", "upload", "cloud", "share"],
        "script": ["脚本", "script", "shell"],
    ]

    /// 某类命令的别名（cloud:/script: 按前缀取表）。
    static func aliases(for command: String) -> [String] {
        if let list = keywordAliases[command] { return list }
        if command.hasPrefix("cloud:") { return keywordAliases["cloud"] ?? [] }
        if command.hasPrefix("script:") { return keywordAliases["script"] ?? [] }
        return []
    }

    /// 全量条目：标准操作 → 工具 → 自定义操作 → 脚本 → 云上传。
    static func entries(settings: ShelfSettings) -> [ShelfCommandEntry] {
        var list: [ShelfCommandEntry] = ActionKind.allCases.map { kind in
            ShelfCommandEntry(id: "action:" + kind.rawValue, command: "action:" + kind.rawValue,
                              title: kind.title, symbol: ShelfSymbols.action(kind),
                              keywords: aliases(for: "action:" + kind.rawValue), enabled: true, detail: nil)
        }
        let utilities: [(String, String, String)] = [
            ("copyPaths", "复制文件路径", ShelfSymbols.name(.copyPaths)),
            ("copyTextContents", "复制文本正文", ShelfSymbols.name(.text)),
            // #47：手动涂黑（整批图片；命令栏与 ⌄ 菜单同一命令）。
            ("redactImages", "涂黑…", "highlighter"),
            ("removeImageMetadata", "去除图片元数据", ShelfSymbols.name(.photo)),
            ("moveToTrash", "移到废纸篓", ShelfSymbols.name(.trash)),
        ]
        list += utilities.map {
            ShelfCommandEntry(id: "utility:" + $0.0, command: "utility:" + $0.0,
                              title: $0.1, symbol: $0.2,
                              keywords: aliases(for: "utility:" + $0.0), enabled: true, detail: nil)
        }
        list += settings.customActions.map {
            ShelfCommandEntry(id: "preset:\($0.id.uuidString)", command: "preset:\($0.id.uuidString)",
                              title: $0.name, symbol: ShelfSymbols.action($0.kind),
                              keywords: [$0.name], enabled: true, detail: nil)
        }
        list += settings.scriptPaths.map { path in
            ShelfCommandEntry(id: "script:" + path, command: "script:" + path,
                              title: URL(fileURLWithPath: path).lastPathComponent, symbol: "terminal",
                              keywords: aliases(for: "script:" + path), enabled: true,
                              detail: settings.scriptDescriptions[path])
        }
        list += settings.cloudAccounts
            .filter { ShelfMenuSelection.uploadProviders.contains($0.provider.lowercased()) }
            .map { account in
                ShelfCommandEntry(id: "cloud:\(account.id.uuidString)", command: "cloud:\(account.id.uuidString)",
                                  title: "上传到 \(account.name) 并获取链接…" + (account.shelfMenuConfigurationReady ? "" : "（需配置）"),
                                  symbol: ShelfSymbols.name(.cloud),
                                  keywords: aliases(for: "cloud:" + account.id.uuidString) + [account.name],
                                  enabled: !settings.onlineDisabled && account.shelfMenuConfigurationReady,
                                  detail: nil)
            }
        return list
    }

    /// 查询词命中：标题或任一别名包含（不区分大小写）。
    static func matches(_ entry: ShelfCommandEntry, query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return true }
        if entry.title.localizedCaseInsensitiveContains(needle) { return true }
        return entry.keywords.contains { $0.localizedCaseInsensitiveContains(needle) }
    }

    /// #73：建议在前、最近使用在后。最近组取 recentActions（≤5，本身已去重置顶），
    /// 只收能在建议组找到对应命令的草稿；查询非空时两组各自过滤。
    static func grouped(settings: ShelfSettings, recent: [ShelfActionDraft],
                        query: String = "") -> [(title: String, entries: [ShelfCommandEntry])] {
        let suggested = entries(settings: settings).filter { matches($0, query: query) }
        let lookup = Dictionary(uniqueKeysWithValues: entries(settings: settings).map { ($0.command, $0) })
        // 行 id 按「recent:动作」唯一化：同动作的多条最近草稿只留第一条，避免 ForEach 撞 id。
        var seenKinds: Set<String> = []
        let recentEntries: [ShelfCommandEntry] = recent.prefix(5).compactMap { draft in
            guard let base = lookup["action:" + draft.kind.rawValue],
                  seenKinds.insert(draft.kind.rawValue).inserted else { return nil }
            let detail = draft.destination.isEmpty
                ? draft.name
                : URL(fileURLWithPath: draft.destination).lastPathComponent
            return ShelfCommandEntry(id: "recent:action:" + draft.kind.rawValue,
                                     command: base.command,
                                     title: detail.isEmpty ? base.title : base.title + " · " + detail,
                                     symbol: base.symbol, keywords: [], enabled: base.enabled, detail: nil)
        }
        .filter { matches($0, query: query) }
        var groups: [(String, [ShelfCommandEntry])] = [("建议", suggested)]
        if !recentEntries.isEmpty { groups.append(("最近使用", recentEntries)) }
        return groups.map { (title: $0.0, entries: $0.1) }
    }
}

struct ShelfCommandBar: View {
    @ObservedObject var store: ShelfStore
    let run: (ActionKind) -> Void
    let utility: (String) -> Void
    let preset: (ActionPreset) -> Void
    let share: (String) -> Void
    let close: () -> Void
    @State private var query = ""
    @State private var selectedIdentifier: String?
    @State private var hoveredIdentifier: String?

    private var groups: [(title: String, entries: [ShelfCommandEntry])] {
        ShelfCommandCatalog.grouped(settings: store.settings, recent: store.recentActions, query: query)
    }
    private var flat: [ShelfCommandEntry] { groups.flatMap(\.entries) }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                ShelfIcon(.search).foregroundStyle(.secondary)
                ShelfCommandSearchField(text: $query, move: moveSelection, submit: submitSelection, cancel: close)
                    .frame(height: 28)
                Button(action: close) { ShelfIcon(.close, size: ShelfSymbols.compactSize) }
                    .buttonStyle(ShelfGlassIconButtonStyle(size: 26))
                    .help("关闭命令搜索").accessibilityLabel("关闭命令搜索")
            }
            .padding(.horizontal, 9)
            .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor.opacity(0.35), lineWidth: 0.75))
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(groups, id: \.title) { group in
                            Text(group.title)
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                                .padding(.horizontal, 9).padding(.top, 4).padding(.bottom, 2)
                            ForEach(group.entries, id: \.id) { entry in
                                commandRow(entry).id(entry.id)
                            }
                        }
                        if flat.isEmpty {
                            Text("没有匹配的操作")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 22)
                        }
                    }
                }
                .onChange(of: selectedIdentifier) { identifier in
                    if let identifier { scroll.scrollTo(identifier) }
                }
            }
        }
        .padding(12)
        .background(ShelfGlassBackground(material: .popover))
        .onAppear { selectedIdentifier = flat.first?.id }
        .onChange(of: query) { _ in selectedIdentifier = flat.first?.id }
    }

    private var selectedCommand: ShelfCommandEntry? {
        flat.first { $0.id == selectedIdentifier } ?? flat.first
    }

    private func commandRow(_ entry: ShelfCommandEntry) -> some View {
        let selected = selectedCommand?.id == entry.id
        return Button { perform(entry) } label: {
            HStack(spacing: 9) {
                ShelfIcon(named: entry.symbol, size: 12)
                    .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                    .frame(width: 20)
                Text(entry.title).font(.system(size: 12, weight: selected ? .medium : .regular)).lineLimit(1)
                Spacer(minLength: 0)
                if selected {
                    ShelfIcon(.returnKey, size: ShelfSymbols.compactSize).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 9).frame(height: 32)
            .contentShape(Rectangle())
            .background(selected ? Color.accentColor.opacity(0.12) : hoveredIdentifier == entry.id ? ShelfGlassPalette.controlFill : Color.clear,
                        in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(!entry.enabled)
        .help(entry.detail.nilIfEmpty.map { entry.title + " — " + $0 } ?? entry.title)
        .onHover { hoveredIdentifier = $0 ? entry.id : nil }
    }

    private func moveSelection(_ direction: Int) {
        let available = flat.filter(\.enabled)
        guard !available.isEmpty else { return }
        let index = available.firstIndex { $0.id == selectedCommand?.id } ?? 0
        selectedIdentifier = available[min(max(index + direction, 0), available.count - 1)].id
    }

    private func submitSelection() {
        if let command = selectedCommand { perform(command) }
    }

    /// 分发：action:→run、utility:→utility、preset:→preset、script:/cloud:→share。
    /// cloud: 走 App.share 的账户分支（传账户 id）。
    private func perform(_ entry: ShelfCommandEntry) {
        guard entry.enabled else { return }
        if entry.command.hasPrefix("action:"), let kind = ActionKind(rawValue: String(entry.command.dropFirst(7))) { run(kind) }
        else if entry.command.hasPrefix("utility:") { utility(String(entry.command.dropFirst(8))) }
        else if entry.command.hasPrefix("preset:"),
                let action = store.settings.customActions.first(where: { $0.id.uuidString == String(entry.command.dropFirst(7)) }) {
            preset(action)
        } else if entry.command.hasPrefix("script:") { share(entry.command) }
        else if entry.command.hasPrefix("cloud:") { share(String(entry.command.dropFirst(6))) }
    }
}

private struct ShelfCommandSearchField: NSViewRepresentable {
    @Binding var text: String
    let move: (Int) -> Void
    let submit: () -> Void
    let cancel: () -> Void
    @Environment(\.isEnabled) private var isEnabled

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> CommandTextField {
        let field = CommandTextField()
        field.delegate = context.coordinator
        field.placeholderString = "搜索操作"
        field.placeholderAttributedString = NSAttributedString(string: "搜索操作", attributes: [.foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.systemFont(ofSize: 13)])
        field.font = .systemFont(ofSize: 13)
        field.textColor = .labelColor
        field.isBezeled = false
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.usesSingleLineMode = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.setAccessibilityLabel("搜索操作")
        return field
    }

    func updateNSView(_ field: CommandTextField, context: Context) {
        context.coordinator.parent = self
        field.isEnabled = isEnabled
        if field.stringValue != text { field.stringValue = text }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: ShelfCommandSearchField
        init(_ parent: ShelfCommandSearchField) { self.parent = parent }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            switch NSStringFromSelector(commandSelector) {
            case "moveDown:": parent.move(1)
            case "moveUp:": parent.move(-1)
            case "insertNewline:": parent.submit()
            case "cancelOperation:": parent.cancel()
            default: return false
            }
            return true
        }
    }

    final class CommandTextField: NSTextField {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard window != nil else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.isEnabled else { return }
                self.window?.makeFirstResponder(self)
            }
        }
    }
}
