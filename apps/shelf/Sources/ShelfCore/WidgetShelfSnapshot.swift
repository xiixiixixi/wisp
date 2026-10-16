import Foundation

/// #82：桌面小组件专用的最小 state.json 投影。
///
/// 完整 ShelfSnapshot 连着托管负载、密钥与 AppKit 依赖，小组件进程只需要三样东西：
/// 架子名、条目数、最近条目的文件名。这里按最小面解码，未知键与缺失键一律容忍——
/// 主程序以后加字段，小组件不重编也不会坏。日期解码沿用主程序同一约定
/// （JSONDecoder 默认的 referenceDate 秒）。
public struct WidgetShelfSnapshot: Codable, Equatable {
    public struct Item: Codable, Equatable {
        public var name: String?
        public var addedAt: Date?
        public init(name: String? = nil, addedAt: Date? = nil) {
            self.name = name; self.addedAt = addedAt
        }
        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            name = try container.decodeIfPresent(String.self, forKey: .name)
            addedAt = try container.decodeIfPresent(Date.self, forKey: .addedAt)
        }
        private enum CodingKeys: String, CodingKey { case name, addedAt }
    }

    public struct Shelf: Codable, Equatable, Identifiable {
        public var id: UUID
        public var name: String
        public var visible: Bool?
        public var items: [Item]
        public init(id: UUID = UUID(), name: String = "新的悬浮窗", visible: Bool? = true, items: [Item] = []) {
            self.id = id; self.name = name; self.visible = visible; self.items = items
        }
        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(UUID.self, forKey: .id)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "新的悬浮窗"
            visible = try container.decodeIfPresent(Bool.self, forKey: .visible)
            items = try container.decodeIfPresent([Item].self, forKey: .items) ?? []
        }
        private enum CodingKeys: String, CodingKey { case id, name, visible, items }
    }

    public var shelves: [Shelf]

    public init(shelves: [Shelf] = []) { self.shelves = shelves }

    public init(from decoder: Decoder) throws {
        shelves = try decoder.container(keyedBy: CodingKeys.self)
            .decodeIfPresent([Shelf].self, forKey: .shelves) ?? []
    }
    private enum CodingKeys: String, CodingKey { case shelves }

    /// 解析失败（半截写入/换版本）返回空快照而不是抛错：小组件宁可显示空态也不崩。
    public static func load(from data: Data) -> WidgetShelfSnapshot {
        (try? JSONDecoder().decode(WidgetShelfSnapshot.self, from: data)) ?? WidgetShelfSnapshot()
    }

    public static func load(url: URL) -> WidgetShelfSnapshot {
        guard let data = try? Data(contentsOf: url) else { return WidgetShelfSnapshot() }
        return load(from: data)
    }

    public func shelf(id: UUID) -> Shelf? { shelves.first { $0.id == id } }

    /// 小组件的默认展示目标：最后一个**有内容**的架子（清单按创建序，新收集落末尾，
    /// 与「重新打开最近窗口」的取材方向一致）；全部为空时取最后一个架子显示空态。
    public func defaultShelf() -> Shelf? {
        shelves.last { !$0.items.isEmpty } ?? shelves.last
    }

    /// 最近条目名：按 addedAt 新→旧排序，缺时间的条目排在有时间的之后并保持原序；
    /// 无名条目跳过；最多取 limit 个。
    public static func recentNames(from items: [Item], limit: Int) -> [String] {
        max(0, limit) == 0 ? [] : items
            .filter { !($0.name ?? "").isEmpty }
            .enumerated()
            .sorted { lhs, rhs in
                switch (lhs.element.addedAt, rhs.element.addedAt) {
                case let (l?, r?):
                    if l == r { return lhs.offset < rhs.offset }
                    return l > r
                case (_?, nil): return true
                case (nil, _?): return false
                default: return lhs.offset < rhs.offset
                }
            }
            .prefix(limit)
            .compactMap { $0.element.name }
    }
}
