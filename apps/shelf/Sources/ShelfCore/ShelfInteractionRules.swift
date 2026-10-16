import Foundation

/// 图钉/顶部色条的十色盘（顺序即 #7 自动配色的轮换顺序）。
/// 视图层按名字映射成具体颜色；这里只存名字，保持 ShelfCore 无 UI 依赖。
public enum ShelfPalette {
    public static let names: [String] = [
        "gray", "orange", "yellow", "green", "mint", "blue",
        "purple", "pink", "olive", "sage",
    ]
    /// 新架的出厂颜色（未着色语义，#7 用它区分「手动改过色」）。
    public static let defaultName = "blue"
}

/// 观察文件夹路径的统一标准化：展开 ~、解符号链接、标准化。
/// FolderMonitor、状态快照与 #32 的目标分组必须用同一份，否则对不上号。
public func shelfNormalizedPath(_ path: String) -> String {
    URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
        .resolvingSymlinksInPath().standardizedFileURL.path
}

/// 批次1 的五条纯交互规则。全部无 AppKit 依赖，逻辑单测直接覆盖；
/// WispShelf 侧只负责把这些结果接到窗口/视图上。
///
/// - #38 「添加到可见窗口」目标选择
/// - #78 默认架子位置（含中央）
/// - #3 双击窗口边缘三态
/// - #4 双击文件行为（含无操作档与多文件确认条件）
/// - #20 copy-content 本地快捷键的剪贴板载荷
public enum ShelfInteractionRules {

    /// #38：候选=本会话仍有可见载体（悬浮面板或停靠把手）的架子。
    /// 最近活动者优先（currentShelfID 命中且可见即它），其余按清单顺序取最后一个；
    /// 无可见架返回 nil（调用方新建）。
    public static func visibleTarget(current: UUID?, shelves: [(id: UUID, visible: Bool)]) -> UUID? {
        if let current, shelves.contains(where: { $0.id == current && $0.visible }) { return current }
        return shelves.last(where: { $0.visible })?.id
    }

    /// #78：新架默认落点（未夹边，调用方负责夹回可见区）。
    /// 四角 / 光标附近 / 中央（center）；缺省档为右上角并按 `cascade` 逐层错开。
    public static func defaultOrigin(kind: String, visible: CGRect, size: CGSize,
                                     cursor: CGPoint, cascade: CGFloat = 0) -> CGPoint {
        switch kind {
        case "topLeft": return CGPoint(x: visible.minX + 18, y: visible.maxY - size.height - 18)
        case "bottomLeft": return CGPoint(x: visible.minX + 18, y: visible.minY + 18)
        case "bottomRight": return CGPoint(x: visible.maxX - size.width - 18, y: visible.minY + 18)
        case "center": return CGPoint(x: visible.midX - size.width / 2, y: visible.midY - size.height / 2)
        case "cursor": return CGPoint(x: cursor.x - size.width / 2, y: cursor.y - size.height)
        default: return CGPoint(x: visible.maxX - size.width - 18 - cascade, y: visible.maxY - size.height - 18 - cascade)
        }
    }

    /// #3：双击窗口边缘的分派指令（dock=停靠 / hide=收起该架 / none=无操作）。
    /// 未知值与缺省一律回落停靠（历史行为）。
    public static func edgeDoubleClickCommand(for setting: String?) -> String {
        switch setting {
        case "hide": return "hide"
        case "none": return "none"
        default: return "dock"
        }
    }

    /// #4：双击文件的行为档（含 none）。未知值回落 reveal（历史行为）。
    public static func doubleClickOutcome(for behavior: String) -> String {
        switch behavior {
        case "open", "preview", "none": return behavior
        default: return "reveal"
        }
    }

    /// #4：多文件确认条件——动作为打开或在 Wisp 中显示、且目标不止一个文件时先弹确认；
    /// 快速预览与单文件不弹。
    public static func doubleClickNeedsConfirmation(behavior: String, fileCount: Int) -> Bool {
        fileCount > 1 && ["open", "reveal"].contains(doubleClickOutcome(for: behavior))
    }

    /// #20：整架写入剪贴板的载荷。文件类条目（含链接）写文件 URL；
    /// 托管文字类条目写其文本内容；不可访问的条目跳过。
    public static func clipboardPayloads(for items: [ShelfItem]) -> [(url: URL?, text: String?)] {
        items.compactMap { item in
            if item.kind == .text {
                guard let text = try? String(contentsOf: item.resolvedURL, encoding: .utf8),
                      !text.isEmpty else { return nil }
                return (nil, text)
            }
            guard item.isAvailable else { return nil }
            return (item.resolvedURL, nil)
        }
    }

    /// #7：colorShelves 开时新架自动取「没人声明过」的颜色，按十色盘顺序轮换。
    /// 仍在默认色（blue）上的架子视为未手动着色，不占用任何颜色；
    /// 十色全被声明过时退回在场计数最少的颜色（同数取盘序靠前者）。
    public static func autoShelfColor(existing: [String],
                                      palette: [String] = ShelfPalette.names,
                                      defaultColor: String = ShelfPalette.defaultName) -> String {
        guard let first = palette.first else { return defaultColor }
        let claimed = Set(existing.filter { $0 != defaultColor })
        if let fresh = palette.first(where: { !claimed.contains($0) }) { return fresh }
        var counts: [String: Int] = [:]
        for color in existing where palette.contains(color) { counts[color, default: 0] += 1 }
        return palette.min(by: { lhs, rhs in
            let left = counts[lhs] ?? 0, right = counts[rhs] ?? 0
            return left == right
                ? (palette.firstIndex(of: lhs) ?? 0) < (palette.firstIndex(of: rhs) ?? 0)
                : left < right
        }) ?? first
    }

    /// #32：perFileNewShelf 规则命中的文件每个单独开窗（各开一个新架），
    /// 其余文件保持整批、继续走 additionBehavior 的目标选择。
    /// 规则按「文件所在目录 = 规则目录」对号，再走该规则自己的过滤条件。
    public static func watchedFileGroups(files: [URL], folders: [WatchedFolder]) -> (perFile: [URL], batched: [URL]) {
        let rules: [String: [WatchedFolder]] = Dictionary(grouping: folders.filter(\.enabled)) {
            shelfNormalizedPath($0.path)
        }
        var perFile: [URL] = []
        var batched: [URL] = []
        for file in files {
            let parent = file.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path
            if let folderRules = rules[parent], folderRules.contains(where: { $0.perFileNewShelf && $0.matches(file) }) {
                perFile.append(file)
            } else {
                batched.append(file)
            }
        }
        return (perFile, batched)
    }

    /// #48：输出后动作档位归一（keep/replace/newShelf/reveal；未知回落 keep）。
    public static func afterOutputOutcome(for value: String?) -> String {
        switch value {
        case "replace", "newShelf", "reveal": return value!
        default: return "keep"
        }
    }

    /// #33：观察状态三态。error 优先（关掉开关的错误文件夹仍要能「重选」修复）。
    public static func watchedFolderStatus(enabled: Bool, hasError: Bool) -> String {
        if hasError { return "error" }
        return enabled ? "active" : "stopped"
    }

    /// #19：数字选架分配——按可见顺序给前 9 个架子编号 1-9
    ///（选择模式与拖拽会话共用这一份，拖拽时只分配不抢焦点）。
    public static func numberAssignments(ids: [UUID]) -> [UUID: Int] {
        Dictionary(uniqueKeysWithValues: ids.prefix(9).enumerated().map { ($0.element, $0.offset + 1) })
    }

    /// #19：数字键命中（1-9 字符；Esc 由调用方自行处理）。无编号表或非数字返回 nil。
    public static func targetForDigit(_ value: String, numbers: [UUID: Int]) -> UUID? {
        guard let number = Int(value), (1...9).contains(number) else { return nil }
        return numbers.first(where: { $0.value == number })?.key
    }

    /// #27：FilesFromShelf 的取材规则——最近活动的可见架优先，其余取最后一个可见架；
    /// 返回该架可访问的文件（去重，≤256 项）。
    public static func filesFromShelf(current: UUID?,
                                      shelves: [(id: UUID, visible: Bool, items: [ShelfItem])]) -> (id: UUID, items: [ShelfItem])? {
        let candidates = shelves.filter { $0.visible }
        guard let target = candidates.first(where: { $0.id == current }) ?? candidates.last else { return nil }
        var seen = Set<URL>()
        let files = target.items.filter { item in
            guard item.isAvailable else { return false }
            return seen.insert(item.resolvedURL.standardizedFileURL).inserted
        }
        return (target.id, Array(files.prefix(256)))
    }

    /// #27：OpenLastShelf / URL 子命令 shelf/last 的目标——最后一个收起的架子
    ///（与「重新打开最近的窗口」快捷键同语义）。
    public static func lastCollapsedShelf(shelves: [(id: UUID, visible: Bool)]) -> UUID? {
        shelves.last(where: { !$0.visible })?.id
    }

    /// #67：上传历史过滤 all（全部）/ valid（有效）/ expired（已过期）。
    /// 无到期字段的记录视为不过期，只出现在「全部」和「有效」里。
    public static func historyFilter(_ records: [CloudShareRecord], filter: String, now: Date = Date()) -> [CloudShareRecord] {
        switch filter {
        case "valid": return records.filter { !$0.isExpired(now: now) }
        case "expired": return records.filter { $0.isExpired(now: now) }
        default: return records
        }
    }

    /// #18：刘海投放区的两档外观（常显态 / 拖拽会话悬停高亮态）。
    /// Dropover 的三态配置（不高亮/悬停高亮/拖动时始终高亮）按裁决简化为这一档：
    /// 悬停在投放区上时加粗描边并亮出文字提示；常显态（中性细边+图标）保留。
    public static func notchPresentation(targeted: Bool) -> NotchDropPresentation {
        NotchDropPresentation(targeted: targeted)
    }
}

/// #18：刘海投放区外观决策（纯数据，AppKit 层只负责落色）。
public struct NotchDropPresentation: Equatable, Sendable {
    public let targeted: Bool
    init(targeted: Bool) { self.targeted = targeted }
    /// 悬停时才亮出「松手放入收集架」提示文字。
    public var showsHintText: Bool { targeted }
    /// 描边粗细：常显 0.5pt 中性 / 悬停 1.5pt 强调色。
    public var borderWidth: CGFloat { targeted ? 1.5 : 0.5 }
    /// 图标与文字是否用强调色。
    public var tintsContent: Bool { targeted }
}
