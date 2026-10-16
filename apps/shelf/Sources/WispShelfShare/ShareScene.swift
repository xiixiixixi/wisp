import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// #25：分享扩展确认页的驱动模型。
/// 载入（分类+取名）→ 确认（物化 inbox + 交接 collect 链接）→ completeRequest。
@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case ready
        case working
        case failed(String)
    }

    struct Row: Identifiable, Equatable {
        let id = UUID()
        let name: String
        let kind: ShareIntake.Kind
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var rows: [Row] = []
    private var providers: [(provider: NSItemProvider, typeIdentifier: String, kind: ShareIntake.Kind)] = []
    private let inbox: URL
    private let opener: (URL) async -> Bool
    private let complete: () -> Void
    private let cancel: () -> Void

    init(inbox: URL? = nil,
         opener: @escaping (URL) async -> Bool,
         complete: @escaping () -> Void = {},
         cancel: @escaping () -> Void = {}) {
        self.inbox = inbox ?? ShareModel.defaultInbox()
        self.opener = opener
        self.complete = complete
        self.cancel = cancel
    }

    /// 与 ShelfStore.defaultDirectory 同款 nonisolated 形态：默认参数（非隔离上下文）也要能取。
    nonisolated static func defaultInbox() -> URL {
        ShareIntake.inboxDirectory(
            applicationSupport: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
    }

    // MARK: - 载入（类型判定 + 取显示名）

    func load(inputProviders: [NSItemProvider]) {
        providers = inputProviders.compactMap { provider in
            // 先按 classify 的优先级对整份注册表判类，再回头挑出该类命中的具体 UTI。
            // 注册顺序不代表优先级：附件常同时注册 file-url 与 public.url，
            // 顺序并不保证 file-url 在前——逐个判会把本机文件错当网页链接物化成 webloc。
            let registered = provider.registeredTypeIdentifiers
            guard let kind = ShareIntake.classify(registeredTypeIdentifiers: registered),
                  let identifier = registered.first(where: {
                      ShareIntake.classify(registeredTypeIdentifiers: [$0]) == kind
                  }) else { return nil }
            return (provider, identifier, kind)
        }
        guard providers.count <= ShareIntake.maximumFiles else {
            phase = .failed(ShareIntake.IntakeError.tooManyFiles.localizedDescription)
            return
        }
        rows = providers.map { entry in
            Row(name: entry.provider.suggestedName ?? entry.kind.fallbackName, kind: entry.kind)
        }
        phase = rows.isEmpty ? .failed(ShareIntake.IntakeError.emptyShare.localizedDescription) : .ready
    }

    // MARK: - 确认（物化 + 交接）

    func confirm() {
        guard phase == .ready else { return }
        phase = .working
        let carrying = providers
        Task { @MainActor in
            do {
                try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
                var files: [URL] = []
                for entry in carrying { files.append(try await intake(entry)) }
                for address in try ShareIntake.collectAddresses(forFiles: files) {
                    // 逐块交接：首块把 Wisp 拉起，后续块由已运行的实例继续收。
                    if !(await opener(address)) { throw ShareIntake.IntakeError.unreadablePayload }
                }
                complete()
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func cancelShare() {
        guard phase != .working else { return }
        cancel()
    }

    /// 单个附件 → 本机文件（文件类原样取路径，其余物化进 inbox）。
    private func intake(_ entry: (provider: NSItemProvider, typeIdentifier: String, kind: ShareIntake.Kind)) async throws -> URL {
        let payload: (any NSSecureCoding)? = try await withCheckedThrowingContinuation { continuation in
            entry.provider.loadItem(forTypeIdentifier: entry.typeIdentifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let item {
                    continuation.resume(returning: item)
                } else {
                    continuation.resume(throwing: ShareIntake.IntakeError.unreadablePayload)
                }
            }
        }
        let stamp = Self.stampFormatter.string(from: Date())
        switch entry.kind {
        case .fileList:
            guard let url = payload as? URL ?? (payload as? Data).flatMap({ URL(string: String(decoding: $0, as: UTF8.self)) }),
                  url.isFileURL else { throw ShareIntake.IntakeError.unreadablePayload }
            guard ShareIntake.withinSizeLimit(url) else { throw ShareIntake.IntakeError.oversizedFile(url.lastPathComponent) }
            return url
        case .webLink:
            // loadItem 的交付形态以 Data 为主（本机实测），URL/String 是老系统的补充形态。
            guard let url = payload as? URL
                ?? (payload as? String).flatMap(URL.init(string:))
                ?? (payload as? Data).flatMap({ URL(string: String(decoding: $0, as: UTF8.self)) }) else {
                throw ShareIntake.IntakeError.unreadablePayload
            }
            return try materialize(try ShareIntake.weblocData(for: url), kind: .webLink, stamp: stamp)
        case .plainText:
            let text = payload as? String
                ?? (payload as? Data).map { String(decoding: $0, as: UTF8.self) }
                ?? (payload as? NSAttributedString)?.string
            guard let text, !text.isEmpty else { throw ShareIntake.IntakeError.unreadablePayload }
            return try materialize(Data(text.utf8), kind: .plainText, stamp: stamp)
        case .image:
            guard let data = payload as? Data, let png = Self.pngData(from: data) else {
                throw ShareIntake.IntakeError.unreadablePayload
            }
            return try materialize(png, kind: .image, stamp: stamp)
        }
    }

    private func materialize(_ data: Data, kind: ShareIntake.Kind, stamp: String) throws -> URL {
        let proposed = ShareIntake.inboxFileName(kind: kind, stamp: stamp)
        let url = inbox.appendingPathComponent(ShareIntake.availableName(for: proposed, in: inbox))
        try data.write(to: url, options: .atomic)
        return url
    }

    private static let stampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()

    /// 图片数据统一转 png 落盘（与 ContentReceiver 的 tiff→png 同一套解码→重编码路径）。
    private static func pngData(from data: Data) -> Data? {
        guard let image = NSImage(data: data),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        return NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:])
    }
}

extension ShareIntake.Kind {
    var symbolName: String {
        switch self {
        case .fileList: return "doc"
        case .image: return "photo"
        case .webLink: return "link"
        case .plainText: return "text.quote"
        }
    }

    var fallbackName: String {
        switch self {
        case .fileList: return "文件"
        case .image: return "分享图片"
        case .webLink: return "分享链接"
        case .plainText: return "分享文字"
        }
    }
}

// MARK: - 主视图：极简确认页

/// 收到 N 项列表（名称+类型）+「添加到收集架」主按钮 +「取消」；
/// 继承 Wisp 玻璃质感，但控件是 appex 自带的简化皮肤（不链接 ShelfCore）。
struct ShareScene: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(ShareSkin.separator).padding(.top, 12)
            switch model.phase {
            case .loading: LoadingSection()
            case .ready, .working: ItemList(model: model)
            case .failed(let message): FailureSection(message: message)
            }
            Spacer(minLength: 0)
            footer
        }
        .padding(16)
        .frame(width: 340, height: 460, alignment: .topLeading)
        .background(ShareGlassBackground())
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "square.stack.3d.up")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("添加到收集架").font(.system(size: 15, weight: .semibold))
                if case .ready = model.phase {
                    Text(model.rows.count == 1 ? "收到 1 项内容" : "收到 \(model.rows.count) 项内容")
                        .font(.system(size: 11))
                        .foregroundStyle(ShareSkin.secondaryText)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var footer: some View {
        HStack {
            Spacer(minLength: 0)
            Button("取消") { model.cancelShare() }
                .buttonStyle(ShareSecondaryButtonStyle())
                .disabled(model.phase == .working)
            Button("添加到收集架") { model.confirm() }
                .buttonStyle(SharePrimaryButtonStyle())
                .disabled(model.phase != .ready)
        }
        .padding(.top, 12)
    }
}

private struct ItemList: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(model.rows) { row in
                    HStack(spacing: 8) {
                        Image(systemName: row.kind.symbolName)
                            .font(.system(size: 12))
                            .foregroundStyle(ShareSkin.secondaryText)
                            .frame(width: 18)
                        Text(row.name)
                            .font(.system(size: 12))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 0)
                        Text(row.kind.typeLabel)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(ShareSkin.secondaryText)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Capsule().fill(ShareSkin.capsuleFill))
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(ShareSkin.rowFill))
                }
            }
            .padding(.vertical, 10)
        }
        .allowsHitTesting(model.phase != .working)
        .opacity(model.phase == .working ? 0.55 : 1)
        .overlay {
            if model.phase == .working {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("正在添加…").font(.system(size: 12)).foregroundStyle(ShareSkin.secondaryText)
                }
            }
        }
    }
}

private struct LoadingSection: View {
    var body: some View {
        VStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("正在读取分享内容…").font(.system(size: 12)).foregroundStyle(ShareSkin.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct FailureSection: View {
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 20))
                .foregroundStyle(ShareSkin.secondaryText)
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(ShareSkin.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
