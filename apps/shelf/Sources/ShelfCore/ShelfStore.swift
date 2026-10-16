import Foundation
import Combine
import Security

@MainActor
public final class ShelfStore: ObservableObject {
    @Published public var shelves: [Shelf] = []
    @Published public var settings = ShelfSettings()
    @Published public var actionDrafts: [String: ShelfActionDraft] = [:]
    @Published public var recentActions: [ShelfActionDraft] = []
    @Published public private(set) var cloudHistory: [CloudShareRecord] = []
    /// #33：观察文件夹的实时健康（标准化路径 → "active"/"error"）。
    /// 只反映 FolderMonitor 的上报，不持久化；stopped 由开关状态推导。
    @Published public private(set) var watchedFolderHealth: [String: String] = [:]
    @Published public var lastError: String?
    public let directory: URL
    public var contentDirectory: URL { directory.appendingPathComponent("Contents", isDirectory: true) }
    private var stateURL: URL { directory.appendingPathComponent("state.json") }
    /// #82：与小组件扩展共用的清单位置（~/Library/Application Support/WispShelf）。
    /// 未沙盒的扩展进程直读 state.json，无需 App Group。
    public nonisolated static func defaultDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WispShelf", isDirectory: true)
    }
    /// #82：state.json 的标准位置（相对自定义目录）。
    public nonisolated static func stateURL(in directory: URL) -> URL {
        directory.appendingPathComponent("state.json")
    }
    private var loadFailed = false
    private var stateLock: ShelfStateLock?
    private var transactionActive = false
    public let didCommit = PassthroughSubject<Void, Never>()
    public var storageAvailable: Bool { !loadFailed && stateLock != nil }
    /// #9：智能命名生成器（可注入，测试离线确定性）。默认走 FoundationModels，
    /// 不可用/失败返回 nil → 保留规则名。总闸仍是 settings.intelligentShelfName。
    public var shelfNameGenerator: ([String]) async -> String? = ShelfNameRefiner.generate
    /// #9：单架精修去重（首批文件到位时在途一次即可）。
    private var pendingNameRefinements: Set<UUID> = []

    public init(directory: URL? = nil) {
        self.directory = directory ?? ShelfStore.defaultDirectory()
        do {
            try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
            stateLock = try ShelfStateLock(directory: self.directory)
            try FileManager.default.createDirectory(at: contentDirectory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: stateURL.path) {
                let snapshot = try JSONDecoder().decode(ShelfSnapshot.self, from: Data(contentsOf: stateURL))
                guard snapshot.version == 1 else { throw StoreError.unsupportedVersion }
                shelves = snapshot.shelves; settings = snapshot.settings
                actionDrafts = snapshot.actionDrafts
                recentActions = snapshot.recentActions
                cloudHistory = snapshot.cloudHistory
                migrateRecentlyClosed(snapshot.legacyRecentlyClosed)
            }
        } catch { loadFailed = true; lastError = "无法读取或建立本机清单：\(error.localizedDescription)。原记录未被覆盖。" }
    }

    @discardableResult public func persist() -> Bool {
        guard !loadFailed else { lastError = "原清单读取失败，已停止写入以保留原记录。"; return false }
        if transactionActive { return true }
        do {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(ShelfSnapshot(shelves: shelves, settings: settings, actionDrafts: actionDrafts, recentActions: recentActions, cloudHistory: cloudHistory)).write(to: stateURL, options: .atomic)
            didCommit.send()
            return true
        } catch { lastError = "清单保存失败：\(error.localizedDescription)"; return false }
    }

    /// 旧档迁移：recentlyClosed 里的架子一次性并回 shelves（收起态，顺序在后），
    /// 之后立即写盘抹掉该字段。再次加载时旧键已不存在，迁移自然幂等；
    /// 已在 shelves 里的 id 跳过，保证不重复、不丢架子。
    private func migrateRecentlyClosed(_ legacy: [Shelf]?) {
        guard let legacy, !legacy.isEmpty else { return }
        let known = Set(shelves.map(\.id))
        var merged = false
        for shelf in legacy where !known.contains(shelf.id) {
            var hidden = shelf
            hidden.visible = false
            shelves.append(hidden)
            merged = true
        }
        if merged { persist() }
    }

    public func transaction<T>(_ change: () throws -> T) throws -> T {
        guard storageAvailable else { throw ShelfStorageError.unavailable }
        guard !transactionActive else { throw ShelfStorageError.nestedTransaction }
        let previous = ShelfSnapshot(shelves: shelves, settings: settings,
            actionDrafts: actionDrafts, recentActions: recentActions, cloudHistory: cloudHistory)
        transactionActive = true
        do {
            let result = try change()
            transactionActive = false
            guard persist() else { throw ShelfStorageError.saveFailed }
            return result
        } catch {
            transactionActive = false
            shelves = previous.shelves; settings = previous.settings
            actionDrafts = previous.actionDrafts; recentActions = previous.recentActions; cloudHistory = previous.cloudHistory
            throw error
        }
    }

    // A finished session cannot resume writing after another process acquires the lock.
    public func releaseStorage() {
        loadFailed = true
        stateLock = nil
    }

    @discardableResult public func createShelf(name: String = "新的悬浮窗") -> UUID {
        var shelf = Shelf(name: name)
        // #7：开着「给架子着色」时新架自动领一个没被声明过的颜色；
        // 手动改过色的架子（color ≠ 默认）既不被覆盖、也继续占用自己的颜色。
        if settings.colorShelves {
            shelf.color = ShelfInteractionRules.autoShelfColor(existing: shelves.map(\.color))
        }
        shelves.append(shelf); persist(); return shelf.id
    }
    public func shelf(_ id: UUID) -> Shelf? { shelves.first { $0.id == id } }
    public func actionDraft(for id: UUID) -> ShelfActionDraft? { actionDrafts[id.uuidString] }
    @discardableResult public func beginActionDraft(_ kind: ActionKind, for id: UUID) -> Bool {
        guard shelf(id) != nil else { lastError = "该架子已关闭，未保存动作参数。"; return false }
        if let draft = actionDraft(for: id), draft.kind == kind { return true }
        return setActionDraft(ShelfActionDraft(kind: kind), for: id)
    }
    @discardableResult public func setActionDraft(_ draft: ShelfActionDraft, for id: UUID) -> Bool {
        guard shelf(id) != nil else { lastError = "该架子已关闭，未保存动作参数。"; return false }
        let previous = actionDrafts[id.uuidString]
        actionDrafts[id.uuidString] = draft
        if persist() { return true }
        actionDrafts[id.uuidString] = previous
        return false
    }
    @discardableResult public func clearActionDraft(for id: UUID) -> Bool {
        let previous = actionDrafts[id.uuidString]
        actionDrafts.removeValue(forKey: id.uuidString)
        if persist() { return true }
        actionDrafts[id.uuidString] = previous
        return false
    }
    @discardableResult public func rememberAction(_ draft: ShelfActionDraft) -> Bool {
        let previous = recentActions
        recentActions.removeAll { $0 == draft }
        recentActions.insert(draft, at: 0)
        recentActions = Array(recentActions.prefix(5))
        if persist() { return true }
        recentActions = previous
        return false
    }
    @discardableResult public func recordCloudShare(accountName: String, links: [URL], message: String,
                                                    accountID: String? = nil, linkSource: String? = nil,
                                                    expiresAt: Date? = nil, deleteHandles: [String?] = []) -> Bool {
        var seen: Set<URL> = []
        let validLinks = links.filter { CloudShareRecord.isValidShareLink($0) && seen.insert($0).inserted }
        guard !validLinks.isEmpty else {
            lastError = "没有有效的分享链接，未添加成功记录。"
            return false
        }
        // 撤销句柄与保留下来的链接按位对齐（被剔除的链接不保留句柄）。
        let keptHandles = validLinks.map { url -> String? in
            guard let index = links.firstIndex(of: url) else { return nil }
            return deleteHandles.indices.contains(index) ? deleteHandles[index] : nil
        }
        let previous = cloudHistory
        cloudHistory.insert(CloudShareRecord(accountName: accountName, links: validLinks, message: message,
            linkSource: linkSource, expiresAt: expiresAt, accountID: accountID, deleteHandles: keptHandles), at: 0)
        cloudHistory = Array(cloudHistory.prefix(50))
        if persist() { return true }
        cloudHistory = previous
        return false
    }
    /// #67：从列表删除一条本机分享记录（不动远端对象）。
    @discardableResult public func removeCloudRecord(_ id: UUID) -> Bool {
        let previous = cloudHistory
        cloudHistory.removeAll { $0.id == id }
        guard cloudHistory != previous else { return false }
        if persist() { return true }
        cloudHistory = previous
        return false
    }
    @discardableResult public func addOutputs(from itemIDs: Set<UUID>, to id: UUID) -> Int {
        guard let shelf = shelf(id) else { return 0 }
        let existing = Set(shelf.items.map { $0.resolvedURL.standardizedFileURL.resolvingSymlinksInPath() })
        let outputs = shelf.items.filter { itemIDs.contains($0.id) }.compactMap(\.outputURL)
            .map { $0.standardizedFileURL.resolvingSymlinksInPath() }.filter { !existing.contains($0) }
        return add(outputs, to: id)
    }
    public func updateShelf(_ id: UUID, _ change: (inout Shelf) -> Void) {
        guard let index = shelves.firstIndex(where: { $0.id == id }) else { return }
        change(&shelves[index]); persist()
    }
    /// #33：FolderMonitor 上报的健康快照（path → active/error）。值没变就不重发布。
    public func publishWatchedHealth(_ health: [String: String]) {
        guard health != watchedFolderHealth else { return }
        watchedFolderHealth = health
    }
    /// #33：单条观察规则的状态（id 对应设置里的记录；error>stopped>active）。
    public func watchedFolderStatus(for folder: WatchedFolder) -> String {
        ShelfInteractionRules.watchedFolderStatus(
            enabled: folder.enabled,
            hasError: watchedFolderHealth[shelfNormalizedPath(folder.path)] == "error")
    }
    @discardableResult public func add(_ urls: [URL], to id: UUID, kind: ItemKind = .file, managed: Bool = false) -> Int {
        guard let index = shelves.firstIndex(where: { $0.id == id }) else { return 0 }
        var existing = Set(shelves[index].items.map { $0.resolvedURL.standardizedFileURL.path })
        var count = 0
        for url in urls where url.isFileURL && FileManager.default.fileExists(atPath: url.path) {
            if existing.insert(url.standardizedFileURL.path).inserted {
                shelves[index].items.append(ShelfItem(url: url, kind: kind, managed: managed)); count += 1
            }
        }
        if count > 0, settings.intelligentShelfName, shelves[index].name == "新的悬浮窗", !shelves[index].items.isEmpty {
            shelves[index].name = Self.suggestedShelfName(for: shelves[index].items)
            // #9：规则名先顶上（架子从不无名），系统模型可用时异步换成描述性名。
            scheduleNameRefinement(for: shelves[index])
        }
        persist(); return count
    }

    /// #9：新架首批文件 → 系统模型描述性名。规则名先落盘；模型返回的名字只在
    /// 架子**仍顶着规则名**（用户没手动改过）时替换，失败静默保留。窗口在途只发一次。
    private func scheduleNameRefinement(for shelf: Shelf) {
        guard !pendingNameRefinements.contains(shelf.id) else { return }
        let id = shelf.id
        let ruleName = shelf.name
        let names = shelf.items.map(\.name)
        pendingNameRefinements.insert(id)
        Task { [weak self] in
            let suggestion = await self?.shelfNameGenerator(names)
            guard let self else { return }
            self.pendingNameRefinements.remove(id)
            guard let suggestion else { return }
            self.applyRefinedName(suggestion, to: id, replacing: ruleName)
        }
    }

    /// 只在当前名字仍等于规则名时替换（用户改名后绝不覆盖）。保存失败会回滚。
    @discardableResult func applyRefinedName(_ name: String, to id: UUID, replacing ruleName: String) -> Bool {
        guard let index = shelves.firstIndex(where: { $0.id == id }), shelves[index].name == ruleName else { return false }
        let previous = shelves[index].name
        shelves[index].name = name
        if persist() { return true }
        shelves[index].name = previous
        return false
    }

    /// 依内容组成生成窗口名，例如「4 张图片」「3 张图片、2 个文稿 等 9 项」。
    public nonisolated static func suggestedShelfName(for items: [ShelfItem]) -> String {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for item in items {
            let label = label(for: item)
            if counts[label] == nil { order.append(label) }
            counts[label, default: 0] += 1
        }
        guard !counts.isEmpty else { return "新的悬浮窗" }
        let ranked = order.sorted { (counts[$0] ?? 0) > (counts[$1] ?? 0) }
        func piece(_ label: String) -> String { "\(counts[label] ?? 0) \(label)" }
        if ranked.count == 1 { return piece(ranked[0]) }
        if ranked.count == 2 { return piece(ranked[0]) + "、" + piece(ranked[1]) }
        let total = items.count
        return piece(ranked[0]) + "、" + piece(ranked[1]) + " 等 \(total) 项"
    }

    private nonisolated static func label(for item: ShelfItem) -> String {
        switch item.kind {
        case .text: return "段文字"
        case .link: return "个链接"
        case .image: return "张图片"
        case .file:
            let url = item.resolvedURL
            var isDirectory = ObjCBool(false)
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue { return "个文件夹" }
            switch url.pathExtension.lowercased() {
            case "png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "tif", "svg", "bmp", "avif", "raw": return "张图片"
            case "pdf": return "个PDF"
            case "mp4", "mov", "m4v", "avi", "mkv", "wmv", "flv", "webm", "mpg", "mpeg": return "个视频"
            case "mp3", "wav", "aac", "flac", "m4a", "aiff", "ogg", "wma": return "个音频"
            case "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "dmg", "iso": return "个压缩包"
            case "doc", "docx", "pages", "rtf", "txt", "md", "key", "numbers", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "csv", "epub": return "个文稿"
            default: return "个文件"
            }
        }
    }
    public func remove(_ itemIDs: Set<UUID>, from id: UUID) {
        updateShelf(id) { $0.items.removeAll { itemIDs.contains($0.id) } }
    }
    @discardableResult public func moveItemsToNewShelf(_ itemIDs: Set<UUID>, from id: UUID,
                                                      name: String = "新的悬浮窗") -> UUID? {
        guard let index = shelves.firstIndex(where: { $0.id == id }) else {
            lastError = "原架子已关闭，未转移内容。"
            return nil
        }
        let source = shelves[index]
        let moving = source.items.filter { itemIDs.contains($0.id) }
        guard !moving.isEmpty else { return nil }
        let previous = shelves
        var destination = Shelf(name: name)
        destination.color = source.color
        destination.viewMode = source.viewMode
        destination.detailsVisible = false
        destination.items = moving
        let movingIDs = Set(moving.map(\.id))
        shelves[index].items.removeAll { movingIDs.contains($0.id) }
        shelves.append(destination)
        // Both shelf records must reach disk together; file contents are never touched.
        guard persist() else {
            shelves = previous
            return nil
        }
        return destination.id
    }
    /// ✕ = 收起：架子留在 shelves、visible=false，内容、位置、停靠边全保留。
    public func hide(_ id: UUID) {
        updateShelf(id) { $0.visible = false }
    }
    /// 真正删除架子（管理页「删除架子」）。只删清单记录和草稿，不动任何文件。
    public func removeShelf(_ id: UUID) {
        guard shelves.contains(where: { $0.id == id }) else { return }
        shelves.removeAll { $0.id == id }
        actionDrafts.removeValue(forKey: id.uuidString)
        persist()
    }
    /// 恢复悬浮窗时的「抬离钳制」：算出离屏边 ≥40px 的原点并**立即持久化**，
    /// 否则停靠恢复的窗口停在 12px 吸附圈里，下次启动又被读回贴边位。
    @discardableResult public func placeLifted(_ id: UUID, size: CGSize, proposed: CGPoint, visible: CGRect) -> CGPoint? {
        guard let index = shelves.firstIndex(where: { $0.id == id }) else { return nil }
        let origin = ShelfWindowPlacement.liftedOrigin(size: size, proposed: proposed, visible: visible)
        shelves[index].x = origin.x; shelves[index].y = origin.y
        persist()
        return origin
    }
    public func materialize(_ data: Data, extension suffix: String, kind: ItemKind, to id: UUID) throws -> URL {
        guard shelf(id) != nil else { throw StoreError.invalidShelf }
        guard !suffix.isEmpty, suffix.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }) else { throw CocoaError(.fileWriteInvalidFileName) }
        let label: String
        switch kind { case .text: label = "文字"; case .link: label = "链接"; case .image: label = "图片"; case .file: label = "文件" }
        let folder = contentDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(label).appendingPathExtension(suffix)
        try data.write(to: url, options: .atomic)
        guard add([url], to: id, kind: kind, managed: true) == 1 else { throw StoreError.invalidShelf }
        return url
    }
    public func record(_ outcomes: [ActionOutcome], shelf id: UUID, moving: Bool,
                       sourceItemIDs: [URL: UUID]? = nil) {
        updateShelf(id) { shelf in
            for outcome in outcomes {
                let matchedIndex: Int?
                if let sourceItemIDs {
                    let itemID = sourceItemIDs[outcome.source] ?? sourceItemIDs.first {
                        $0.key.standardizedFileURL == outcome.source.standardizedFileURL
                    }?.value
                    matchedIndex = itemID.flatMap { id in shelf.items.firstIndex { $0.id == id } }
                } else {
                    matchedIndex = shelf.items.firstIndex {
                        $0.url.standardizedFileURL == outcome.source.standardizedFileURL ||
                        $0.resolvedURL.standardizedFileURL == outcome.source.standardizedFileURL
                    }
                }
                guard let index = matchedIndex else { continue }
                shelf.items[index].result = outcome.message
                shelf.items[index].lastActionSucceeded = outcome.succeeded
                if outcome.succeeded, let output = outcome.output { shelf.items[index].outputURL = output }
                if moving, outcome.succeeded, let output = outcome.output {
                    var replacement = ShelfItem(url: output, kind: shelf.items[index].kind, managed: shelf.items[index].managed)
                    replacement.id = shelf.items[index].id; replacement.result = outcome.message
                    replacement.outputURL = output; replacement.lastActionSucceeded = true; shelf.items[index] = replacement
                }
            }
        }
    }
    public func setCredential(_ value: String, for account: CloudAccount) -> Bool {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.wisp.shelf", kSecAttrAccount as String: account.credentialKey]
        let data = Data(value.utf8)
        let existing = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        let status = existing == errSecItemNotFound ? SecItemAdd(query.merging([kSecValueData as String: data]) { _, new in new } as CFDictionary, nil) : existing
        guard status == errSecSuccess else { lastError = "密钥保存失败（\(status)）"; return false }
        return true
    }
    public func credential(for account: CloudAccount) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.wisp.shelf", kSecAttrAccount as String: account.credentialKey, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    public func removeCloudAccountRecord(_ id: UUID) throws -> CloudAccount {
        guard let account = settings.cloudAccounts.first(where: { $0.id == id }) else {
            throw ShelfHostedError.invalidRequest
        }
        try transaction { settings.cloudAccounts.removeAll { $0.id == id } }
        return account
    }

    public func deleteCredential(for account: CloudAccount) -> Bool {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.wisp.shelf", kSecAttrAccount as String: account.credentialKey]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            lastError = "密钥移除失败（\(status)）"; return false
        }
        return true
    }
}

enum StoreError: LocalizedError {
    case unsupportedVersion, invalidShelf
    var errorDescription: String? {
        switch self { case .unsupportedVersion: return "不支持此清单版本"; case .invalidShelf: return "收集架已关闭" }
    }
}
