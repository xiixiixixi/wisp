import AppIntents
import ShelfCore
import SwiftUI
import WidgetKit

/// #82：桌面小组件（WispShelfWidget.appex，嵌在主 Wisp.app 的 Contents/PlugIns）。
///
/// 数据源：直读 ~/Library/Application Support/WispShelf/state.json（WidgetShelfSnapshot
/// 最小投影；Wisp 未沙盒，扩展进程无需 App Group 即可读到同一份清单）。
/// 刷新：15 分钟时间线档——不追实时，宿主侧后续可通过 WidgetCenter.reloadTimelines
/// 在收起/清空等时点主动打通（本批不做，见批次报告）。
/// 点击：深链 wisp-shelf://shelf/last 重开最近收起的架子（引擎已实现该子命令）。
///
/// 系统门槛：AppIntentConfiguration（可配置小组件）是 macOS 14 API；macOS 13 本就
/// 没有第三方桌面小组件，所以 bundle 用 if #available 把实现整体关在 14 门内，
/// 包的部署目标维持 macOS 13（主应用要求）。
@main
struct WispShelfWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(macOS 14.0, *) {
            ShelfWidget()
        }
    }
}

enum WispShelfWidgetStore {
    static var stateURL: URL { ShelfStore.stateURL(in: ShelfStore.defaultDirectory()) }
}

// MARK: - 可配置项：选哪个架子

@available(macOS 14.0, *)
struct ShelfEntity: AppEntity {
    let id: UUID
    let name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "收集架"
    static var defaultQuery = ShelfEntityQuery()
}

@available(macOS 14.0, *)
struct ShelfEntityQuery: EntityQuery, DynamicOptionsProvider {
    func entities(for identifiers: [UUID]) async throws -> [ShelfEntity] {
        let snapshot = WidgetShelfSnapshot.load(url: WispShelfWidgetStore.stateURL)
        return identifiers.compactMap { identifier in
            snapshot.shelf(id: identifier).map { ShelfEntity(id: identifier, name: $0.name) }
        }
    }

    func entities() async throws -> [ShelfEntity] {
        WidgetShelfSnapshot.load(url: WispShelfWidgetStore.stateURL)
            .shelves.map { ShelfEntity(id: $0.id, name: $0.name) }
    }
}

@available(macOS 14.0, *)
struct SelectShelfIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "选择收集架"
    static var description = IntentDescription("小组件展示哪个架子")
    @Parameter(title: "架子")
    var shelf: ShelfEntity

    func perform() async throws -> some IntentResult { .result() }
}

// MARK: - 时间线

struct ShelfDisplay: Equatable {
    var shelfID: UUID?
    var name: String
    var count: Int
    var recent: [String]
    var hasShelves: Bool

    static let empty = ShelfDisplay(shelfID: nil, name: "收集架", count: 0, recent: [], hasShelves: false)

    init(shelfID: UUID?, name: String, count: Int, recent: [String], hasShelves: Bool) {
        self.shelfID = shelfID
        self.name = name
        self.count = count
        self.recent = recent
        self.hasShelves = hasShelves
    }

    init(shelf: WidgetShelfSnapshot.Shelf, hasShelves: Bool) {
        self.init(shelfID: shelf.id,
                  name: shelf.name.isEmpty ? "收集架" : shelf.name,
                  count: shelf.items.count,
                  recent: WidgetShelfSnapshot.recentNames(from: shelf.items, limit: 3),
                  hasShelves: hasShelves)
    }
}

@available(macOS 14.0, *)
struct ShelfEntry: TimelineEntry {
    let date: Date
    let display: ShelfDisplay

    static func placeholder() -> ShelfEntry {
        ShelfEntry(date: .now, display: ShelfDisplay(
            shelfID: nil, name: "发票截图", count: 6,
            recent: ["六月账单.png", "报销单.pdf", "收据.jpg"], hasShelves: true))
    }
}

@available(macOS 14.0, *)
struct ShelfTimelineProvider: AppIntentTimelineProvider {
    /// 15 分钟档：收集架是收集点不是仪表盘，延迟可接受；宿主后续可主动 reload。
    static let refreshInterval: TimeInterval = 15 * 60

    func placeholder(in context: Context) -> ShelfEntry { .placeholder() }

    func snapshot(for configuration: SelectShelfIntent, in context: Context) async -> ShelfEntry {
        entry(for: configuration)
    }

    func timeline(for configuration: SelectShelfIntent, in context: Context) async -> Timeline<ShelfEntry> {
        Timeline(entries: [entry(for: configuration)],
                 policy: .after(Date().addingTimeInterval(Self.refreshInterval)))
    }

    private func entry(for configuration: SelectShelfIntent) -> ShelfEntry {
        let snapshot = WidgetShelfSnapshot.load(url: WispShelfWidgetStore.stateURL)
        // 配置的架子已删时退回默认架（最后一个有内容的），小组件不留白。
        let shelf = snapshot.shelf(id: configuration.shelf.id) ?? snapshot.defaultShelf()
        let display = shelf.map { ShelfDisplay(shelf: $0, hasShelves: !snapshot.shelves.isEmpty) } ?? .empty
        return ShelfEntry(date: Date(), display: display)
    }
}

// MARK: - 视图

@available(macOS 14.0, *)
struct ShelfWidgetEntryView: View {
    let entry: ShelfEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        ShelfWidgetContent(display: entry.display, family: family)
            .widgetURL(URL(string: "wisp-shelf://shelf/last"))
            .modifier(ShelfWidgetBackground())
    }
}

struct ShelfWidgetContent: View {
    let display: ShelfDisplay
    let family: WidgetFamily

    var body: some View {
        if !display.hasShelves {
            emptyState
        } else if family == .systemMedium {
            medium
        } else {
            small
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("收集架", systemImage: "square.stack.3d.up")
                .font(.system(size: 13, weight: .semibold))
            Text("还没有架子。在 Wisp 里晃动或拖入文件即可创建。")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(display.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            Text("\(display.count) 项").font(.system(size: 11)).foregroundStyle(.secondary)
            if let latest = display.recent.first {
                Text(latest).font(.system(size: 11)).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(display.name).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                Text("\(display.count) 项").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(display.recent, id: \.self) { name in
                    Text(name).font(.system(size: 11)).lineLimit(1).truncationMode(.middle)
                }
                if display.recent.isEmpty {
                    Text("还没有条目").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// macOS 14+ 要求 containerBackground；13 上用普通背景。
private struct ShelfWidgetBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 14.0, *) {
            content.containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
        } else {
            content.background(Color(nsColor: .windowBackgroundColor))
        }
    }
}

@available(macOS 14.0, *)
struct ShelfWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "WispShelf.Shelf", intent: SelectShelfIntent.self,
                               provider: ShelfTimelineProvider()) { entry in
            ShelfWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("收集架")
        .description("显示架子的条目数与最近条目，点按重开最近的收集架。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
