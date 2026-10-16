import AppKit
import ShelfCore

struct ShelfFileMenuAction {
    var title: String
    var action: String
    var symbol: String? = nil
    var group: String = "自定义操作"
    var enabled = true
    var kind: ActionKind? = nil
    var uploadProvider: String? = nil
    /// #51：副标题/描述（脚本的说明），菜单里作 tooltip。
    var detail: String? = nil

    static func openWithCommand(for application: URL) -> String {
        "openWith:\(application.absoluteString)"
    }
}

final class ShelfFileContextMenu: NSMenu {
    private let selectedIDs: Set<UUID>
    private let perform: (String, Set<UUID>) -> Void
    private let favorites: [String]

    init(items: [ShelfItem], disabled: Bool, supportsExtendedActions: Bool,
         customActions: [ShelfFileMenuAction], favorites: [String] = [],
         perform: @escaping (String, Set<UUID>) -> Void) {
        selectedIDs = Set(items.map(\.id))
        self.perform = perform
        self.favorites = favorites
        super.init(title: "文件操作")
        autoenablesItems = false
        let available = !disabled && !items.isEmpty && items.allSatisfy(\.isAvailable)
        let manageable = !disabled && !items.isEmpty
        let capabilities = ShelfMenuSelection(items: items)
        addCommand("打开", "open", symbol: ShelfSymbols.name(.open), enabled: available)
        let openWith = NSMenu(title: "打开方式")
        openWith.autoenablesItems = false
        if available {
            let urls = items.map(\.resolvedURL)
            let choices = urls.map { NSWorkspace.shared.urlsForApplications(toOpen: $0) }
            let common = choices.dropFirst().reduce(Set(choices.first ?? [])) { $0.intersection($1) }
            let firstDefault = urls.first.flatMap { NSWorkspace.shared.urlForApplication(toOpen: $0) }
            for application in (choices.first ?? []).filter({ common.contains($0) }).prefix(16) {
                let title = FileManager.default.displayName(atPath: application.path)
                    + (application == firstDefault ? "（默认）" : "")
                let item = command(title, ShelfFileMenuAction.openWithCommand(for: application), enabled: supportsExtendedActions)
                item.image = NSWorkspace.shared.icon(forFile: application.path)
                item.image?.size = NSSize(width: 16, height: 16)
                openWith.addItem(item)
            }
        }
        if !openWith.items.isEmpty { openWith.addItem(.separator()) }
        openWith.addItem(command("其他应用…", "action:openApp", enabled: available && supportsExtendedActions))
        addSubmenu("打开方式", openWith, symbol: ShelfSymbols.name(.application), enabled: available && supportsExtendedActions)
        addCommand("在 Finder 中显示", "revealInFinder", symbol: ShelfSymbols.name(.reveal), enabled: available)
        addCommand("快速预览", "preview", symbol: ShelfSymbols.name(.preview), enabled: available)
        addItem(.separator())
        addCommand("隔空投送…", "airdrop", symbol: ShelfSymbols.name(.airdrop), enabled: available && supportsExtendedActions)
        addCommand("邮件…", "mail", symbol: ShelfSymbols.name(.mail), enabled: available && supportsExtendedActions)
        addCommand("信息…", "messages", symbol: ShelfSymbols.name(.messages), enabled: available && supportsExtendedActions)
        // 备忘录要和 ⌄ 下拉菜单的分享组保持一致（那边已经加上了），不然两个菜单对不上。
        addCommand("备忘录", "notes", symbol: ShelfSymbols.name(.notes), enabled: available && supportsExtendedActions)
        let more = NSMenu(title: "更多操作")
        more.autoenablesItems = false
        // #76：最爱操作置顶（分隔线隔开），解析不了的静默跳过。
        let pinnedFavorites = favoriteItems(capabilities: capabilities, available: available,
                                            supportsExtendedActions: supportsExtendedActions,
                                            customActions: customActions)
        for item in pinnedFavorites { more.addItem(item) }
        if !pinnedFavorites.isEmpty { more.addItem(.separator()) }
        for (title, action, symbol) in [
            ("显示简介", "getInfo", ShelfSymbols.name(.info)),
            ("重新命名文件…", "action:rename", ShelfSymbols.name(.rename)),
            ("创建压缩文件…", "action:archive", ShelfSymbols.name(.archive)),
            ("复制到文件夹…", "action:copy", ShelfSymbols.name(.copy)),
            ("移动到文件夹…", "action:move", ShelfSymbols.name(.move)),
            ("复制文件路径", "utility:copyPaths", ShelfSymbols.name(.copyPaths)),
            ("复制文本正文", "utility:copyTextContents", ShelfSymbols.name(.text)),
            ("去除图片元数据", "utility:removeImageMetadata", ShelfSymbols.name(.photo)),
        ] {
            if action.hasPrefix("utility:"), !capabilities.supportsUtility(String(action.dropFirst(8))) { continue }
            let item = command(title, action, symbol: symbol, enabled: available && supportsExtendedActions)
            if action == "action:rename" { item.toolTip = "修改实际文件的名称，收集项会跟随更新。" }
            if action == "action:move" { item.toolTip = "移动实际文件到目标文件夹，不只是整理收集项。" }
            more.addItem(item)
        }
        let imageActions = ActionKind.allCases.filter {
            ![.copy, .move, .archive, .openApp, .rename].contains($0) && capabilities.supports($0)
        }
        if !imageActions.isEmpty { more.addItem(.separator()) }
        for kind in imageActions {
            more.addItem(command(kind.title + "…", "action:\(kind.rawValue)", symbol: ShelfSymbols.action(kind), enabled: available && supportsExtendedActions))
        }
        let applicableActions = customActions.filter { $0.kind.map(capabilities.supports) ?? true }
        let groups = applicableActions.reduce(into: [String]()) { result, action in
            if !result.contains(action.group) { result.append(action.group) }
        }
        for group in groups {
            let submenu = NSMenu(title: group)
            submenu.autoenablesItems = false
            for action in applicableActions where action.group == group {
                let uploadable = action.uploadProvider.map(capabilities.supportsUpload) ?? true
                let item = command(action.title, action.action, symbol: action.symbol,
                    enabled: available && supportsExtendedActions && action.enabled && uploadable)
                // #51：描述作 tooltip（脚本说明等）。
                if let detail = action.detail, !detail.isEmpty { item.toolTip = detail }
                submenu.addItem(item)
            }
            let item = NSMenuItem(title: group, action: nil, keyEquivalent: "")
            item.submenu = submenu
            item.isEnabled = submenu.items.contains(where: \.isEnabled)
            more.addItem(item)
        }
        more.addItem(.separator())
        let trash = command("将实际文件移到废纸篓…", "utility:moveToTrash", symbol: ShelfSymbols.name(.trash), enabled: available && supportsExtendedActions)
        trash.toolTip = "处理磁盘上的实际文件；普通文件引用和收集副本都会移到废纸篓。"
        more.addItem(trash)
        addSubmenu("更多操作", more, symbol: ShelfSymbols.name(.more), enabled: available && supportsExtendedActions)
        addItem(.separator())
        addCommand(items.count == 1 ? "复制文件" : "复制 \(items.count) 项", "copyItems", symbol: ShelfSymbols.name(.copy), enabled: available)
        addCommand("将收集项移到新架子", "moveToNewShelf", symbol: ShelfSymbols.name(.newShelf), enabled: manageable && supportsExtendedActions)
        addCommand("从架子移除", "remove", symbol: ShelfSymbols.name(.remove), enabled: manageable)
        self.items.last?.toolTip = "只移除收集记录，保留实际文件和收集副本。"
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// #76：解析 favoriteActionIDs → 菜单条目。标准命令按前缀解析；
    /// preset:/script:/cloud: 由调用方装在 customActions 里（含能力信息），按命令字对号。
    /// 能力不匹配时置灰保位，解析不了的静默跳过。
    private func favoriteItems(capabilities: ShelfMenuSelection, available: Bool,
                               supportsExtendedActions: Bool, customActions: [ShelfFileMenuAction]) -> [NSMenuItem] {
        let extended = available && supportsExtendedActions
        var items: [NSMenuItem] = []
        for favorite in favorites {
            let item: NSMenuItem?
            if favorite.hasPrefix("action:"), let kind = ActionKind(rawValue: String(favorite.dropFirst(7))) {
                item = command(kind.title + "…", favorite, symbol: ShelfSymbols.action(kind),
                               enabled: extended && capabilities.supports(kind))
            } else if favorite.hasPrefix("utility:") {
                let utilities: [String: String] = [
                    "copyPaths": "复制文件路径", "copyTextContents": "复制文本正文",
                    "removeImageMetadata": "去除图片元数据", "moveToTrash": "将实际文件移到废纸篓…",
                ]
                guard let title = utilities[String(favorite.dropFirst(8))] else { continue }
                item = command(title, favorite, enabled: extended && capabilities.supportsUtility(String(favorite.dropFirst(8))))
            } else if let action = customActions.first(where: { $0.action == favorite }) {
                let capable = action.kind.map(capabilities.supports) ?? true
                let uploadable = action.uploadProvider.map(capabilities.supportsUpload) ?? true
                item = command(action.title, action.action, symbol: action.symbol,
                               enabled: extended && capable && action.enabled && uploadable)
                if let detail = action.detail, !detail.isEmpty { item?.toolTip = detail }
            } else {
                item = nil
            }
            if let item { items.append(item) }
        }
        return items
    }

    private func command(_ title: String, _ action: String, symbol: String? = nil, enabled: Bool) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: #selector(invoke(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = action
        item.isEnabled = enabled
        if let symbol { item.image = ShelfSymbols.image(named: symbol, accessibilityDescription: title) }
        return item
    }
    private func addCommand(_ title: String, _ action: String, symbol: String? = nil, enabled: Bool) {
        addItem(command(title, action, symbol: symbol, enabled: enabled))
    }
    private func addSubmenu(_ title: String, _ submenu: NSMenu, symbol: String, enabled: Bool) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        item.image = ShelfSymbols.image(named: symbol, accessibilityDescription: title)
        item.isEnabled = enabled
        addItem(item)
    }
    @objc private func invoke(_ sender: NSMenuItem) {
        guard sender.isEnabled, let action = sender.representedObject as? String else { return }
        perform(action, selectedIDs)
    }
}
