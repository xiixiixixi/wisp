import Foundation
import UniformTypeIdentifiers

public enum ItemKind: String, Codable { case file, text, link, image }

public struct ShelfItem: Identifiable, Codable, Equatable {
    public var id: UUID
    public var url: URL
    public var name: String
    public var kind: ItemKind
    public var bookmark: Data?
    public var managed: Bool
    public var addedAt: Date
    public var result: String?
    public var outputURL: URL?
    public var lastActionSucceeded: Bool?
    public init(url: URL, kind: ItemKind = .file, managed: Bool = false) {
        self.id = UUID(); self.url = url; self.name = url.lastPathComponent
        self.kind = kind; self.managed = managed; self.addedAt = Date(); self.outputURL = nil; self.lastActionSucceeded = nil
        self.bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    }
    public var resolvedURL: URL {
        guard let bookmark else { return url }
        var stale = false
        return (try? URL(resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale)) ?? url
    }
    public var isAvailable: Bool { FileManager.default.fileExists(atPath: resolvedURL.path) }
}

public enum ShelfViewMode: String, Codable, CaseIterable {
    case list, gallery
}

public struct Shelf: Identifiable, Codable, Equatable {
    public var id: UUID
    public var name: String
    public var items: [ShelfItem]
    public var pinned: Bool
    public var color: String
    public var createdAt: Date
    public var x: Double?
    public var y: Double?
    // Optional so older saved shelves still decode without a migration.
    public var viewMode: ShelfViewMode?
    public var detailsVisible: Bool?
    public var showsPinIndicator: Bool?
    public var ownSpace: Bool?
    // ✕ 统一是「收起」：架子留在清单里，visible=false；缺省视为显示（旧档兜底）。
    public var visible: Bool?
    // 停靠边（left/right/top/bottom）；nil = 悬浮窗。收起时保留，恢复时按它重建把手。
    public var dockEdge: String?
    public init(name: String = "新的悬浮窗") {
        id = UUID(); self.name = name; items = []; pinned = false; color = "blue"; createdAt = Date()
    }
}

public struct ShortcutBinding: Identifiable, Codable, Equatable {
    public var id: String
    public var title: String
    public var keyCode: UInt32
    public var modifiers: UInt32
    public var enabled: Bool
    public init(id: String, title: String, keyCode: UInt32, modifiers: UInt32 = 2560, enabled: Bool = true) {
        self.id = id; self.title = title; self.keyCode = keyCode; self.modifiers = modifiers; self.enabled = enabled
    }
}

public struct ActionPreset: Identifiable, Codable, Equatable {
    public var id: UUID
    public var name: String
    public var kind: ActionKind
    public var destination: String
    public var nameTemplate: String
    public var width: Int
    public var quality: Double
    public var format: String
    public var application: String
    public var password: String
    public var findText: String
    public var replaceText: String
    public var renameMode: String
    public var caseSensitive: Bool
    public var toClipboard: Bool
    // #41：{n} 序号的起始值（默认 1，旧档回落同值）。
    public var counterStart: Int
    // #45：缩放模式 edge=最长边（历史行为）/ fit=最大宽高 contain / percent=百分比。
    public var resizeMode: String
    public var maxWidth: Int
    public var maxHeight: Int
    public var scalePercent: Int
    // #48：输出后动作 keep=保留现行为 / replace=源条目替换为输出 / newShelf=输出进新架 / reveal=打开所在文件夹。
    public var afterOutput: String
    public init(name: String = "复制到文件夹", kind: ActionKind = .copy, destination: String = "") {
        id = UUID(); self.name = name; self.kind = kind; self.destination = destination
        nameTemplate = ""; width = 1600; quality = 0.8; format = "jpeg"; application = ""
        password = ""; findText = ""; replaceText = ""; renameMode = "template"
        caseSensitive = false; toClipboard = false
        counterStart = 1; resizeMode = "edge"; maxWidth = 1600; maxHeight = 1600; scalePercent = 100
        afterOutput = "keep"
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, kind, destination, nameTemplate, width, quality, format, application
        case password, findText, replaceText, renameMode, caseSensitive, toClipboard
        case counterStart, resizeMode, maxWidth, maxHeight, scalePercent, afterOutput
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init()
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        kind = try container.decode(ActionKind.self, forKey: .kind)
        destination = try container.decode(String.self, forKey: .destination)
        nameTemplate = try container.decode(String.self, forKey: .nameTemplate)
        width = try container.decode(Int.self, forKey: .width)
        quality = try container.decode(Double.self, forKey: .quality)
        format = try container.decode(String.self, forKey: .format)
        application = try container.decode(String.self, forKey: .application)
        password = try container.decodeIfPresent(String.self, forKey: .password) ?? password
        findText = try container.decodeIfPresent(String.self, forKey: .findText) ?? findText
        replaceText = try container.decodeIfPresent(String.self, forKey: .replaceText) ?? replaceText
        renameMode = try container.decodeIfPresent(String.self, forKey: .renameMode) ?? renameMode
        caseSensitive = try container.decodeIfPresent(Bool.self, forKey: .caseSensitive) ?? caseSensitive
        toClipboard = try container.decodeIfPresent(Bool.self, forKey: .toClipboard) ?? toClipboard
        counterStart = try container.decodeIfPresent(Int.self, forKey: .counterStart) ?? counterStart
        resizeMode = try container.decodeIfPresent(String.self, forKey: .resizeMode) ?? resizeMode
        maxWidth = try container.decodeIfPresent(Int.self, forKey: .maxWidth) ?? maxWidth
        maxHeight = try container.decodeIfPresent(Int.self, forKey: .maxHeight) ?? maxHeight
        scalePercent = try container.decodeIfPresent(Int.self, forKey: .scalePercent) ?? scalePercent
        afterOutput = try container.decodeIfPresent(String.self, forKey: .afterOutput) ?? afterOutput
    }
}

public enum WatchedFileType: String, CaseIterable, Codable, Sendable {
    case all, images, documents, text, audio, video, archives
    public var title: String {
        switch self {
        case .all: return "全部文件"
        case .images: return "图片"
        case .documents: return "文档"
        case .text: return "文字"
        case .audio: return "音频"
        case .video: return "视频"
        case .archives: return "压缩包"
        }
    }
    fileprivate func matches(_ type: UTType?, extension suffix: String) -> Bool {
        switch self {
        case .all: return true
        case .images: return type?.conforms(to: .image) == true
        case .documents:
            return type?.conforms(to: .text) == true || type?.conforms(to: .pdf) == true ||
                type?.conforms(to: .presentation) == true || type?.conforms(to: .spreadsheet) == true ||
                ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key", "odt", "ods", "odp"].contains(suffix)
        case .text: return type?.conforms(to: .text) == true
        case .audio: return type?.conforms(to: .audio) == true
        case .video: return type?.conforms(to: .movie) == true || type?.conforms(to: .video) == true
        case .archives: return type?.conforms(to: .archive) == true || ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].contains(suffix)
        }
    }
}

public struct WatchedFolder: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var path: String
    public var enabled: Bool
    public var fileType: WatchedFileType
    public var extensions: [String]
    public var collectionDelay: Double
    // #30：名称运算符 any=不限（默认）/ contains=名称包含 / startsWith=名称开头；关键字为空时等同不限。
    public var nameCondition: String
    public var nameText: String
    // #32：开启后该规则命中的每个新文件各落一个新架（批量导出场景）。
    public var perFileNewShelf: Bool
    public init(path: String, enabled: Bool = true, fileType: WatchedFileType = .all,
                extensions: [String] = [], collectionDelay: Double = 3,
                nameCondition: String = "any", nameText: String = "", perFileNewShelf: Bool = false) {
        id = UUID(); self.path = path; self.enabled = enabled; self.fileType = fileType
        self.extensions = extensions; self.collectionDelay = collectionDelay.isFinite ? min(30, max(0.5, collectionDelay)) : 3
        self.nameCondition = nameCondition; self.nameText = nameText; self.perFileNewShelf = perFileNewShelf
    }
    public var normalizedExtensions: [String] {
        let values = extensions.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        }.filter { !$0.isEmpty }
        return Array(Set(values)).sorted()
    }
    public var effectiveCollectionDelay: Double { collectionDelay.isFinite ? min(30, max(0.5, collectionDelay)) : 3 }
    public func matches(_ url: URL, contentType: UTType? = nil) -> Bool {
        let suffixes = normalizedExtensions
        let name = url.lastPathComponent.lowercased()
        guard suffixes.isEmpty || suffixes.contains(where: { name.hasSuffix("." + $0) }) else { return false }
        // #30：名称运算符在扩展名之后、类型之前生效；匹配不区分大小写。
        let keyword = nameText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !keyword.isEmpty {
            let rawName = url.lastPathComponent
            switch nameCondition {
            case "contains":
                if rawName.range(of: keyword, options: .caseInsensitive) == nil { return false }
            case "startsWith":
                if !rawName.lowercased().hasPrefix(keyword.lowercased()) { return false }
            default: break
            }
        }
        let suffix = url.pathExtension.lowercased()
        return fileType.matches(contentType ?? UTType(filenameExtension: suffix), extension: suffix)
    }
    private enum CodingKeys: String, CodingKey {
        case id, path, enabled, fileType, extensions, collectionDelay
        case nameCondition, nameText, perFileNewShelf
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(path: try container.decode(String.self, forKey: .path),
                  enabled: try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true,
                  fileType: try container.decodeIfPresent(WatchedFileType.self, forKey: .fileType) ?? .all,
                  extensions: try container.decodeIfPresent([String].self, forKey: .extensions) ?? [],
                  collectionDelay: try container.decodeIfPresent(Double.self, forKey: .collectionDelay) ?? 3,
                  nameCondition: try container.decodeIfPresent(String.self, forKey: .nameCondition) ?? "any",
                  nameText: try container.decodeIfPresent(String.self, forKey: .nameText) ?? "",
                  perFileNewShelf: try container.decodeIfPresent(Bool.self, forKey: .perFileNewShelf) ?? false)
        id = try container.decode(UUID.self, forKey: .id)
    }
}

public struct CloudAccount: Identifiable, Codable, Equatable {
    public var id: UUID
    public var name: String
    public var provider: String
    public var endpoint: String
    public var bucket: String
    public var region: String
    public var publicBaseURL: String
    public var credentialKey: String
    // #63：上传对象键模板（默认 {filename}；可用 {filename}/{date}）。
    public var pathTemplate: String
    // #64：S3 上传后本地生成 SigV4 预签名链接，替代匿名公开基址。
    public var presignEnabled: Bool
    // #64：预签名到期档位 1h/1d/7d/30d（默认 7 天）。
    public var presignExpiry: String
    public init(provider: String = "custom") {
        id = UUID(); self.provider = provider; name = provider
        endpoint = ""; bucket = ""; region = "us-east-1"; publicBaseURL = ""
        credentialKey = UUID().uuidString
        pathTemplate = CloudPathTemplate.defaultTemplate
        presignEnabled = false; presignExpiry = "7d"
    }
    private enum CodingKeys: String, CodingKey {
        case id, name, provider, endpoint, bucket, region, publicBaseURL, credentialKey
        case pathTemplate, presignEnabled, presignExpiry
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        provider = try container.decode(String.self, forKey: .provider)
        endpoint = try container.decode(String.self, forKey: .endpoint)
        bucket = try container.decode(String.self, forKey: .bucket)
        region = try container.decode(String.self, forKey: .region)
        publicBaseURL = try container.decode(String.self, forKey: .publicBaseURL)
        credentialKey = try container.decode(String.self, forKey: .credentialKey)
        // 旧档没有这三个字段：回落出厂值（空模板等同 {filename}）。
        pathTemplate = CloudPathTemplate.normalized(
            try container.decodeIfPresent(String.self, forKey: .pathTemplate) ?? CloudPathTemplate.defaultTemplate)
        presignEnabled = try container.decodeIfPresent(Bool.self, forKey: .presignEnabled) ?? false
        presignExpiry = S3PresignExpiry.normalize(
            try container.decodeIfPresent(String.self, forKey: .presignExpiry) ?? "7d")
    }
}

public struct CloudShareRecord: Identifiable, Codable, Equatable {
    public var id: UUID
    public var createdAt: Date
    public var accountName: String
    public var links: [URL]
    public var message: String
    // #64：链接来源标注——presigned（S3 预签名）/publicBase（匿名公开基址）；其他提供商为空。
    public var linkSource: String?
    // #67：记录的到期时间（预签名链接的失效点）；nil = 不过期。
    public var expiresAt: Date?
    // #67：删除并撤销需要按记录找回账户与提供商。
    public var accountID: String?
    // #67：与 links 平行排列的撤销句柄（S3=对象键 / imgur=图片编号 / custom=分享地址）；nil = 不可撤销。
    public var deleteHandles: [String?]?
    public init(id: UUID = UUID(), createdAt: Date = Date(), accountName: String, links: [URL], message: String,
                linkSource: String? = nil, expiresAt: Date? = nil, accountID: String? = nil, deleteHandles: [String?]? = nil) {
        self.id = id; self.createdAt = createdAt; self.accountName = accountName
        self.links = links; self.message = message
        self.linkSource = linkSource; self.expiresAt = expiresAt
        self.accountID = accountID; self.deleteHandles = deleteHandles
    }
    private enum CodingKeys: String, CodingKey {
        case id, createdAt, accountName, links, message, linkSource, expiresAt, accountID, deleteHandles
    }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        accountName = try container.decode(String.self, forKey: .accountName)
        links = try container.decode([URL].self, forKey: .links)
        message = try container.decode(String.self, forKey: .message)
        linkSource = try container.decodeIfPresent(String.self, forKey: .linkSource)
        expiresAt = try container.decodeIfPresent(Date.self, forKey: .expiresAt)
        accountID = try container.decodeIfPresent(String.self, forKey: .accountID)
        deleteHandles = try container.decodeIfPresent([String?].self, forKey: .deleteHandles)
    }
    public static func isValidShareLink(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return false }
        return true
    }
    public var validLinks: [URL] { links.filter(Self.isValidShareLink) }
    /// #67：预签名链接到点即失效；无到期字段的记录视为不过期。
    public func isExpired(now: Date = Date()) -> Bool { expiresAt.map { $0 <= now } ?? false }
    /// #64/#67：历史列表的来源/到期徽标文案（预签名 / 公开基址，已过期优先展示）。
    public var badgeText: String {
        if isExpired() { return "已过期" }
        switch linkSource {
        case "presigned":
            let deadline = expiresAt.map { " · 至 " + $0.formatted(date: .numeric, time: .shortened) } ?? ""
            return "预签名链接\(deadline)"
        case "publicBase": return "公开基址链接"
        default: return "分享链接"
        }
    }
    /// #67：撤销句柄按 links 位置对齐返回（缺省补 nil）。
    public var revocableHandles: [String?] {
        links.indices.map { deleteHandles?[safe: $0] ?? nil }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

public struct ShelfSettings: Codable, Equatable {
    public var shakeEnabled = true
    public var shakeSensitivity = 0.6
    public var modifierEnabled = true
    public var activationModifier = "shift"
    public var notchEnabled = true
    public var defaultPosition = "topRight"
    public var additionBehavior = "new"
    public var ignoredApps: [String] = []
    public var doubleClickBehavior = "reveal"
    // #3 双击窗口边缘三态：dock=停靠（默认）/ hide=收起该架 / none=无操作。
    public var edgeDoubleClick = "dock"
    public var closeAfterDrag = "moved"
    public var autoPlace = false
    public var retractAfterDrop = false
    public var colorShelves = false
    public var closeDetailsOutside = false
    public var plainText = false
    public var ownSpace = false
    public var copyOnDrag = false
    public var focusOnShow = false
    public var intelligentShelfName = true
    public var showMenuBar = true
    public var startAtLogin = false
    public var showDock = false
    public var onlineDisabled = false
    public var instantActionsEnabled = true
    public var instantActionIDs = ["airdrop", "messages", "mail", "cloud"]
    public var screenshotMonitoringEnabled = false
    public var screenshotDirectory = ""
    public var screenshotAdditionBehavior = "current"
    public var scriptPaths: [String] = []
    public var scriptCopyOutput = false
    public var scriptCloseOnSuccess = false
    // #51：脚本描述（路径 → 描述），菜单 tooltip/副标题用。
    public var scriptDescriptions: [String: String] = [:]
    // #76：最爱动作（≤5），动作菜单置顶分组用；条目格式与 instantActionIDs 一致。
    public var favoriteActionIDs: [String] = []
    // #84：快速上手引导是否已看完（「不再显示」的持久位）。
    public var onboardingCompleted = false
    // #65：云面板默认设置——记住上次上传使用的账户（「云链接」即时动作按它挑选；
    // 指定账户的菜单入口不受影响，选完即更新此值）。路径模板与预签名开关是账户
    // 自身字段，随账户持久化，无需另记。
    public var cloudLastAccountID: String?
    public var customActions: [ActionPreset] = []
    public var watchedFolders: [WatchedFolder] = []
    public var cloudAccounts: [CloudAccount] = []
    public var shortcutBindings: [ShortcutBinding] = [
        .init(id: "new", title: "新的悬浮窗", keyCode: 49),
        .init(id: "clipboard", title: "从剪贴板创建", keyCode: 0),
        .init(id: "selection", title: "选择架子", keyCode: 1),
        .init(id: "reopen", title: "重新打开最近的窗口", keyCode: 15, enabled: false),
        .init(id: "closeAll", title: "关闭所有窗口", keyCode: 13, modifiers: 6144, enabled: false),
        .init(id: "toggle", title: "切换停靠架子", keyCode: 2, enabled: false),
    ]
    public var localShortcutBindings: [ShortcutBinding] = ShelfSettings.defaultLocalShortcuts
    public init() {}

    /// 本地快捷键出厂键位。#20：copyContent（复制收集内容）默认 ⌥C、停用出厂，
    /// 与既有条目（⌘W/空格/⇧D/↩/⇥/⌘K/⌫/⇧←/⇧→）不冲突。
    private static let defaultLocalShortcuts: [ShortcutBinding] = [
        .init(id: "close", title: "关闭架子", keyCode: 13, modifiers: 256),
        .init(id: "preview", title: "快速预览", keyCode: 49, modifiers: 0),
        .init(id: "dock", title: "停靠到最近边缘", keyCode: 2, modifiers: 512),
        .init(id: "actionMenu", title: "动作菜单", keyCode: 36, modifiers: 0),
        .init(id: "details", title: "显示详情", keyCode: 48, modifiers: 0, enabled: false),
        .init(id: "commandBar", title: "命令栏", keyCode: 40, modifiers: 256),
        .init(id: "clear", title: "移出所选收集项", keyCode: 51, modifiers: 0),
        .init(id: "dockLeft", title: "左侧停靠", keyCode: 123, modifiers: 512),
        .init(id: "dockRight", title: "右侧停靠", keyCode: 124, modifiers: 512),
        .init(id: "copyContent", title: "复制收集内容", keyCode: 8, modifiers: 2048, enabled: false),
    ]

    private enum CodingKeys: String, CodingKey {
        case shakeEnabled, shakeSensitivity, modifierEnabled, activationModifier, notchEnabled, defaultPosition, additionBehavior, ignoredApps
        case doubleClickBehavior, edgeDoubleClick, closeAfterDrag, autoPlace, retractAfterDrop, colorShelves, closeDetailsOutside, plainText, ownSpace, copyOnDrag, focusOnShow, intelligentShelfName
        case showMenuBar, startAtLogin, showDock, onlineDisabled, instantActionsEnabled, instantActionIDs
        case screenshotMonitoringEnabled, screenshotDirectory, screenshotAdditionBehavior
        case scriptPaths, scriptCopyOutput, scriptCloseOnSuccess, scriptDescriptions, favoriteActionIDs, onboardingCompleted, cloudLastAccountID
        case customActions, watchedFolders, cloudAccounts, shortcutBindings, localShortcutBindings
    }
    public init(from decoder: Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shakeEnabled = try c.decodeIfPresent(Bool.self, forKey: .shakeEnabled) ?? shakeEnabled
        shakeSensitivity = try c.decodeIfPresent(Double.self, forKey: .shakeSensitivity) ?? shakeSensitivity
        modifierEnabled = try c.decodeIfPresent(Bool.self, forKey: .modifierEnabled) ?? modifierEnabled
        activationModifier = try c.decodeIfPresent(String.self, forKey: .activationModifier) ?? activationModifier
        notchEnabled = try c.decodeIfPresent(Bool.self, forKey: .notchEnabled) ?? notchEnabled
        defaultPosition = try c.decodeIfPresent(String.self, forKey: .defaultPosition) ?? defaultPosition
        additionBehavior = try c.decodeIfPresent(String.self, forKey: .additionBehavior) ?? additionBehavior
        ignoredApps = try c.decodeIfPresent([String].self, forKey: .ignoredApps) ?? ignoredApps
        doubleClickBehavior = try c.decodeIfPresent(String.self, forKey: .doubleClickBehavior) ?? doubleClickBehavior
        edgeDoubleClick = try c.decodeIfPresent(String.self, forKey: .edgeDoubleClick) ?? edgeDoubleClick
        closeAfterDrag = try c.decodeIfPresent(String.self, forKey: .closeAfterDrag) ?? closeAfterDrag
        autoPlace = try c.decodeIfPresent(Bool.self, forKey: .autoPlace) ?? autoPlace
        retractAfterDrop = try c.decodeIfPresent(Bool.self, forKey: .retractAfterDrop) ?? retractAfterDrop
        colorShelves = try c.decodeIfPresent(Bool.self, forKey: .colorShelves) ?? colorShelves
        closeDetailsOutside = try c.decodeIfPresent(Bool.self, forKey: .closeDetailsOutside) ?? closeDetailsOutside
        plainText = try c.decodeIfPresent(Bool.self, forKey: .plainText) ?? plainText
        ownSpace = try c.decodeIfPresent(Bool.self, forKey: .ownSpace) ?? ownSpace
        copyOnDrag = try c.decodeIfPresent(Bool.self, forKey: .copyOnDrag) ?? copyOnDrag
        focusOnShow = try c.decodeIfPresent(Bool.self, forKey: .focusOnShow) ?? focusOnShow
        intelligentShelfName = try c.decodeIfPresent(Bool.self, forKey: .intelligentShelfName) ?? intelligentShelfName
        showMenuBar = try c.decodeIfPresent(Bool.self, forKey: .showMenuBar) ?? showMenuBar
        startAtLogin = try c.decodeIfPresent(Bool.self, forKey: .startAtLogin) ?? startAtLogin
        showDock = try c.decodeIfPresent(Bool.self, forKey: .showDock) ?? showDock
        onlineDisabled = try c.decodeIfPresent(Bool.self, forKey: .onlineDisabled) ?? onlineDisabled
        instantActionsEnabled = try c.decodeIfPresent(Bool.self, forKey: .instantActionsEnabled) ?? instantActionsEnabled
        instantActionIDs = try c.decodeIfPresent([String].self, forKey: .instantActionIDs) ?? instantActionIDs
        screenshotMonitoringEnabled = try c.decodeIfPresent(Bool.self, forKey: .screenshotMonitoringEnabled) ?? screenshotMonitoringEnabled
        screenshotDirectory = try c.decodeIfPresent(String.self, forKey: .screenshotDirectory) ?? screenshotDirectory
        screenshotAdditionBehavior = try c.decodeIfPresent(String.self, forKey: .screenshotAdditionBehavior) ?? screenshotAdditionBehavior
        scriptPaths = try c.decodeIfPresent([String].self, forKey: .scriptPaths) ?? scriptPaths
        scriptCopyOutput = try c.decodeIfPresent(Bool.self, forKey: .scriptCopyOutput) ?? scriptCopyOutput
        scriptCloseOnSuccess = try c.decodeIfPresent(Bool.self, forKey: .scriptCloseOnSuccess) ?? scriptCloseOnSuccess
        scriptDescriptions = try c.decodeIfPresent([String: String].self, forKey: .scriptDescriptions) ?? scriptDescriptions
        favoriteActionIDs = try c.decodeIfPresent([String].self, forKey: .favoriteActionIDs) ?? favoriteActionIDs
        onboardingCompleted = try c.decodeIfPresent(Bool.self, forKey: .onboardingCompleted) ?? onboardingCompleted
        cloudLastAccountID = try c.decodeIfPresent(String.self, forKey: .cloudLastAccountID) ?? nil
        customActions = try c.decodeIfPresent([ActionPreset].self, forKey: .customActions) ?? customActions
        watchedFolders = try c.decodeIfPresent([WatchedFolder].self, forKey: .watchedFolders) ?? watchedFolders
        cloudAccounts = try c.decodeIfPresent([CloudAccount].self, forKey: .cloudAccounts) ?? cloudAccounts
        shortcutBindings = try c.decodeIfPresent([ShortcutBinding].self, forKey: .shortcutBindings) ?? shortcutBindings
        for index in shortcutBindings.indices {
            if shortcutBindings[index].id == "selection" { shortcutBindings[index].title = "选择架子" }
            if shortcutBindings[index].id == "toggle" { shortcutBindings[index].title = "切换停靠架子" }
        }
        localShortcutBindings = try c.decodeIfPresent([ShortcutBinding].self, forKey: .localShortcutBindings) ?? localShortcutBindings
        // 旧档只有九条本地快捷键：补齐后来新增的出厂条目（如 copyContent），
        // 用户自己改过的键位和开关原样保留。
        for fallback in ShelfSettings.defaultLocalShortcuts
        where !localShortcutBindings.contains(where: { $0.id == fallback.id }) {
            localShortcutBindings.append(fallback)
        }
    }
}

public struct ShelfSnapshot: Codable {
    public var version = 1
    public var shelves: [Shelf]
    public var settings: ShelfSettings
    public var actionDrafts: [String: ShelfActionDraft]
    public var recentActions: [ShelfActionDraft]
    public var cloudHistory: [CloudShareRecord]
    /// 旧档里读出的 recentlyClosed，只用于一次性迁移（并入 shelves 后不再写出）。
    public var legacyRecentlyClosed: [Shelf]?
    public init(shelves: [Shelf] = [], settings: ShelfSettings = .init(),
                actionDrafts: [String: ShelfActionDraft] = [:], recentActions: [ShelfActionDraft] = [],
                cloudHistory: [CloudShareRecord] = []) {
        self.shelves = shelves; self.settings = settings
        self.actionDrafts = actionDrafts
        self.recentActions = Array(recentActions.prefix(5))
        self.cloudHistory = Array(cloudHistory.prefix(50))
    }
    private enum CodingKeys: String, CodingKey { case version, shelves, recentlyClosed, settings, actionDrafts, recentActions, cloudHistory }
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        shelves = try container.decode([Shelf].self, forKey: .shelves)
        legacyRecentlyClosed = try container.decodeIfPresent([Shelf].self, forKey: .recentlyClosed)
        settings = try container.decode(ShelfSettings.self, forKey: .settings)
        actionDrafts = try container.decodeIfPresent([String: ShelfActionDraft].self, forKey: .actionDrafts) ?? [:]
        recentActions = Array((try container.decodeIfPresent([ShelfActionDraft].self, forKey: .recentActions) ?? []).prefix(5))
        cloudHistory = Array((try container.decodeIfPresent([CloudShareRecord].self, forKey: .cloudHistory) ?? []).prefix(50))
    }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // recentlyClosed 已废除：旧键只为读取迁移保留，永不再写出。
        try container.encode(version, forKey: .version)
        try container.encode(shelves, forKey: .shelves)
        try container.encode(settings, forKey: .settings)
        try container.encode(actionDrafts, forKey: .actionDrafts)
        try container.encode(recentActions, forKey: .recentActions)
        try container.encode(cloudHistory, forKey: .cloudHistory)
    }
}
