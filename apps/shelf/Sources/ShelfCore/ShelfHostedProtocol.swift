import Foundation

public enum ShelfJSONValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool), array([ShelfJSONValue]), object([String: ShelfJSONValue]), null
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode(Double.self) { self = .number(item) }
        else if let item = try? value.decode([ShelfJSONValue].self) { self = .array(item) }
        else { self = .object(try value.decode([String: ShelfJSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .bool(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }
}

public struct ShelfHostedEnvelope: Decodable {
    public let id: Int
    public let request: ShelfHostedRequest
}

public struct ShelfHostedRequest: Decodable {
    public let action: String
    public let shelfId: String?
    public let name: String?
    public let pinned: Bool?
    public let itemIds: [String]?
    public let paths: [String]?
    public let text: String?
    public let url: String?
    public let html: String?
    public let settings: [String: ShelfJSONValue]?
    public let command: String?
    public let accountId: String?
    public let secret: String?
    public let edge: String?
    public let active: Bool?
    public let forceNew: Bool?
    /// #67：上传历史记录编号（removeCloudRecord/revokeCloudRecord）。
    public let recordId: String?
}

public struct ShelfHostedItem: Encodable {
    public let id: String
    public let name: String
    public let path: String
    public let kind: String
    public let managed: Bool
    public let available: Bool
    public let isDirectory: Bool
    public let size: Int64
    public let addedAt: Double
    public init(_ item: ShelfItem) {
        id = item.id.uuidString; name = item.name; path = item.resolvedURL.path; kind = item.kind.rawValue
        managed = item.managed; available = item.isAvailable; addedAt = item.addedAt.timeIntervalSince1970 * 1000
        let values = try? item.resolvedURL.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
        isDirectory = values?.isDirectory ?? false
        size = Int64(values?.fileSize ?? 0)
    }
}

public struct ShelfHostedShelf: Encodable {
    public let id: String
    public let name: String
    public let pinned: Bool
    public let color: String
    public let createdAt: Double
    public let items: [ShelfHostedItem]
    public let visible: Bool
    public let docked: Bool
    public let dockEdge: String?
    public let busy: Bool
    public init(_ shelf: Shelf, busy: Bool = false) {
        id = shelf.id.uuidString; name = shelf.name; pinned = shelf.pinned; color = shelf.color
        createdAt = shelf.createdAt.timeIntervalSince1970 * 1000; items = shelf.items.map(ShelfHostedItem.init)
        // 透传持久字段：visible 是收起语义的唯一真源（旧档缺省视为显示）。
        visible = shelf.visible ?? true
        docked = shelf.dockEdge != nil
        dockEdge = shelf.dockEdge
        self.busy = busy
    }
}

public struct ShelfHostedCloudRecord: Encodable {
    public let id: String
    public let createdAt: Double
    public let accountName: String
    public let links: [String]
    public let message: String
    /// #64：链接来源标注（presigned/publicBase）；其他提供商为空。
    public let linkSource: String?
    /// #67：记录的到期时间（毫秒）；nil = 不过期。
    public let expiresAt: Double?
    /// #67：删除并撤销需要按记录找回账户。
    public let accountID: String?
    /// #67：与 links 平行的撤销句柄（对齐有效链接；nil = 该链接不可撤销）。
    public let deleteHandles: [String?]
    public init(_ record: CloudShareRecord) {
        id = record.id.uuidString; createdAt = record.createdAt.timeIntervalSince1970 * 1000
        accountName = record.accountName; message = record.message
        let valid = record.validLinks
        links = valid.map(\.absoluteString)
        linkSource = record.linkSource
        expiresAt = record.expiresAt.map { $0.timeIntervalSince1970 * 1000 }
        accountID = record.accountID
        // 撤销句柄按记录里的完整链接位对齐，再挑出与有效链接对应的那几把。
        let handles = record.revocableHandles
        deleteHandles = valid.map { link in
            guard let index = record.links.firstIndex(of: link), handles.indices.contains(index) else { return nil }
            return handles[index]
        }
    }
}

public struct ShelfHostedSnapshot: Encodable {
    public let supported = true
    public let revision: Int
    public let shelves: [ShelfHostedShelf]
    public let settings: ShelfSettings
    public let cloudHistory: [ShelfHostedCloudRecord]
    public let credentialAccountIds: [String]
    /// #33：观察文件夹状态（记录 id → active/stopped/error），来自 FolderMonitor 实时上报。
    public let watchedFolderStates: [String: String]
    public init(shelves: [ShelfHostedShelf], settings: ShelfSettings,
                cloudHistory: [ShelfHostedCloudRecord], credentialAccountIds: [String],
                watchedFolderStates: [String: String] = [:], revision: Int = 0) {
        self.revision = revision
        self.shelves = shelves; self.settings = settings
        self.cloudHistory = cloudHistory; self.credentialAccountIds = credentialAccountIds
        self.watchedFolderStates = watchedFolderStates
    }
}

public enum ShelfHostedSettings {
    public static func merged(_ patch: [String: ShelfJSONValue], into current: ShelfSettings) throws -> ShelfSettings {
        let encoder = JSONEncoder()
        var fields = try JSONDecoder().decode([String: ShelfJSONValue].self, from: encoder.encode(current))
        guard patch.keys.allSatisfy({ fields[$0] != nil }), !patch.values.contains(.null) else {
            throw ShelfHostedError.invalidSettings
        }
        fields.merge(patch) { _, value in value }
        // Login and application appearance belong to the Wisp host, not its helper.
        fields["showDock"] = .bool(false); fields["showMenuBar"] = .bool(false); fields["startAtLogin"] = .bool(false)
        let value = try JSONDecoder().decode(ShelfSettings.self, from: encoder.encode(fields))
        guard value.shakeSensitivity.isFinite, (0...1).contains(value.shakeSensitivity),
              ["shift", "option", "control", "command"].contains(value.activationModifier),
              ["topRight", "topLeft", "bottomRight", "bottomLeft", "center", "cursor"].contains(value.defaultPosition),
              ["new", "current", "visible"].contains(value.additionBehavior),
              ["new", "current"].contains(value.screenshotAdditionBehavior),
              ["reveal", "open", "preview", "none"].contains(value.doubleClickBehavior),
              ["dock", "hide", "none"].contains(value.edgeDoubleClick),
              ["moved", "always", "never"].contains(value.closeAfterDrag),
              // #30/#76/#48/#41：新枚举与上限校验，非法补丁整体拒绝、不落半截设置。
              value.watchedFolders.allSatisfy({ ["any", "contains", "startsWith"].contains($0.nameCondition) }),
              value.favoriteActionIDs.count <= 5,
              value.customActions.allSatisfy({ ["keep", "replace", "newShelf", "reveal"].contains($0.afterOutput) }),
              value.customActions.allSatisfy({ ["edge", "fit", "percent"].contains($0.resizeMode) }),
              value.customActions.allSatisfy({ (1...999_999).contains($0.counterStart) }),
              value.scriptDescriptions.count <= 128,
              value.shortcutBindings.count <= 64, value.localShortcutBindings.count <= 64,
              value.watchedFolders.count <= 128, value.cloudAccounts.count <= 128,
              value.ignoredApps.count <= 512, value.scriptPaths.count <= 128,
              value.customActions.count <= 128,
              // #63/#64：云账户新字段——模板文案校验 + 到期档位白名单；非法补丁整体拒绝。
              value.cloudAccounts.allSatisfy({ CloudPathTemplate.validationError(for: $0.pathTemplate) == nil }),
              value.cloudAccounts.allSatisfy({ S3PresignExpiry.tiers.contains($0.presignExpiry) }),
              // #65：记住的上次账户必须是可空 UUID 文本。
              value.cloudLastAccountID == nil || UUID(uuidString: value.cloudLastAccountID!) != nil else { throw ShelfHostedError.invalidSettings }
        return value
    }
}

public enum ShelfHostedError: LocalizedError {
    case invalidRequest, invalidShelf, invalidItems, invalidSettings, busy, emptyContent, unsupportedCommand
    public var errorDescription: String? {
        switch self {
        case .invalidRequest: return "收集架请求缺少必要参数，或参数格式不正确。"
        case .invalidShelf: return "该收集架已关闭或不存在，请刷新后重试。"
        case .invalidItems: return "部分项目已从收集架移除，请刷新后重试。"
        case .invalidSettings: return "收集架设置含有无效选项，此次更改未保存。"
        case .busy: return "收集架仍在接收或处理文件，请等待完成后再操作。"
        case .emptyContent: return "没有可加入收集架的内容。"
        case .unsupportedCommand: return "不支持此收集架操作。"
        }
    }
}
