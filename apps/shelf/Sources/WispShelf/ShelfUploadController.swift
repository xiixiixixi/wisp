import AppKit
import ShelfCore
import SwiftUI

@MainActor
final class ShelfUploadController: ObservableObject {
    enum Result { case success([URL]), failure(CloudUploadFailure) }
    @Published private(set) var progress: CloudUploadProgress?
    @Published private(set) var running = false
    @Published private(set) var cancelling = false
    @Published private(set) var completedLinks: [URL] = []
    @Published private(set) var failure: CloudUploadFailure?
    /// #64/#67：最近一次成功上传的完整结果面（来源标注/到期点/撤销句柄）。
    @Published private(set) var lastOutcome: CloudUploadOutcome?
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var retryAccount: CloudAccount?
    private var retryCredential: String?
    var retryAccountID: UUID? { retryAccount?.id }
    func matches(account: CloudAccount, credential: String?) -> Bool {
        retryAccount == account && retryCredential == credential
    }

    @discardableResult
    func start(_ urls: [URL], account: CloudAccount, credential: String?,
               retainingLinks: [URL] = [],
               onResult: @escaping (Result) -> Void) -> Bool {
        guard !running else { return false }
        let generation = UUID()
        self.generation = generation
        retryAccount = account
        retryCredential = credential
        failure = nil
        progress = nil
        lastOutcome = nil
        completedLinks = retainingLinks
        running = true
        cancelling = false
        task = Task { [weak self] in
            let result: Result
            var outcome: CloudUploadOutcome?
            do {
                let uploaded = try await CloudUploader.uploadDetailed(urls, account: account, credential: credential,
                    onProgress: { [weak self] snapshot in
                        Task { @MainActor in
                            guard let self, self.generation == generation, self.running else { return }
                            self.progress = snapshot
                            self.completedLinks = retainingLinks + snapshot.completedLinks
                        }
                    })
                outcome = uploaded
                result = .success(uploaded.links)
            } catch {
                let failure = error as? CloudUploadFailure ?? CloudUploadFailure(
                    error is CancellationError ? "上传已取消。" : "上传没有完成。", remainingFiles: urls,
                    cancelled: error is CancellationError)
                result = .failure(failure)
            }
            guard let self, self.generation == generation else { return }
            self.running = false
            self.cancelling = false
            self.task = nil
            switch result {
            case .success(let links):
                self.completedLinks = retainingLinks + links
                self.lastOutcome = outcome
                self.retryAccount = nil
                self.retryCredential = nil
            case .failure(let failure):
                self.completedLinks = retainingLinks + failure.completedLinks
                self.failure = CloudUploadFailure(failure.message, completedLinks: self.completedLinks,
                    remainingFiles: failure.remainingFiles, cancelled: failure.cancelled,
                    uploadMayHaveSucceeded: failure.uploadMayHaveSucceeded)
            }
            onResult(result)
        }
        return true
    }

    func cancel() {
        guard running else { return }
        cancelling = true
        task?.cancel()
    }

    // Call only after a fresh confirmation: the last unconfirmed file may already exist remotely.
    @discardableResult
    func retryRemaining(onResult: @escaping (Result) -> Void) -> Bool {
        guard !running, let account = retryAccount, let failure, !failure.remainingFiles.isEmpty else { return false }
        return start(failure.remainingFiles, account: account, credential: retryCredential,
                     retainingLinks: completedLinks, onResult: onResult)
    }
}

struct ShelfUploadProgressView: View {
    @ObservedObject var controller: ShelfUploadController
    var retry: (() -> Void)? = nil
    var dismiss: (() -> Void)? = nil
    var framed = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if controller.running {
                    Button { controller.cancel() } label: { ShelfIcon(.stop, size: ShelfSymbols.compactSize) }
                        .buttonStyle(ShelfQuietIconStyle(size: 24))
                        .help("取消上传").accessibilityLabel("取消上传").disabled(controller.cancelling)
                } else if !controller.completedLinks.isEmpty {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(controller.completedLinks.map(\.absoluteString).joined(separator: "\n"), forType: .string)
                    } label: { ShelfIcon(.link, size: ShelfSymbols.compactSize) }
                        .buttonStyle(ShelfQuietIconStyle(size: 24))
                        .help("复制已成功的分享链接").accessibilityLabel("复制已成功的分享链接")
                }
                if !controller.running, let dismiss {
                    Button(action: dismiss) { ShelfIcon(.close, size: ShelfSymbols.compactSize) }
                        .buttonStyle(ShelfQuietIconStyle(size: 24))
                        .help("关闭上传反馈").accessibilityLabel("关闭上传反馈")
                }
            }
            if controller.running {
                if let progress = controller.progress {
                    if let file = progress.currentFile {
                        Text("\(progress.fileNumber)/\(progress.totalFiles) · \(file.lastPathComponent)")
                            .font(.system(size: 11)).lineLimit(1).help(file.lastPathComponent)
                    }
                    if let fraction = progress.fraction {
                        ProgressView(value: fraction).progressViewStyle(.linear)
                        Text(byteLabel(progress)).font(.system(size: 10)).foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.mini)
                            Text(progress.stage).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2).help(progress.stage)
                        }
                    }
                } else {
                    HStack(spacing: 6) { ProgressView().controlSize(.mini); Text("正在准备文件").font(.system(size: 11)) }
                }
                if !controller.completedLinks.isEmpty {
                    Text("已确认 \(controller.completedLinks.count) 个分享链接").font(.system(size: 10)).foregroundStyle(.secondary)
                }
            } else if let failure = controller.failure {
                Text(failure.message).font(.system(size: 11)).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true).help(failure.message)
                if !failure.remainingFiles.isEmpty, let retry {
                    Button(action: retry) { Label("重试未完成的 \(failure.remainingFiles.count) 项", systemImage: ShelfSymbols.name(.retry)) }
                        .buttonStyle(ShelfGlassButtonStyle())
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 130, alignment: .topLeading)
        .background(framed ? ShelfGlassPalette.controlFill : .clear, in: RoundedRectangle(cornerRadius: 6))
    }

    private var title: String {
        if controller.cancelling { return "正在取消上传" }
        if controller.running { return "正在上传" }
        if let failure = controller.failure {
            if !controller.completedLinks.isEmpty { return "部分成功 · \(controller.completedLinks.count) 项" }
            return failure.cancelled ? "上传已取消" : "上传未完成"
        }
        return "完成 · \(controller.completedLinks.count) 项"
    }
    private func byteLabel(_ progress: CloudUploadProgress) -> String {
        let sent = ByteCountFormatter.string(fromByteCount: progress.bytesSent, countStyle: .file)
        guard let expected = progress.expectedBytes else { return "已发送 " + sent }
        let total = ByteCountFormatter.string(fromByteCount: expected, countStyle: .file)
        return "\(sent) / \(total)"
    }
}
