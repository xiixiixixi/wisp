import CryptoKit
import Foundation

/// #66：凭据「测试连接」的三步状态机——上传小测试文件 → 列出 → 删除，
/// 三步全过才报成功；分步失败给对应的排障文案（S3/自建服务各有措辞）。
public enum CloudTestStep: String, CaseIterable, Sendable {
    case upload, list, delete

    public var title: String {
        switch self {
        case .upload: return "上传测试文件"
        case .list: return "列出测试对象"
        case .delete: return "删除测试文件"
        }
    }
}

@MainActor
public struct CloudConnectionTestProgress: Equatable, Sendable {
    public var completed: [CloudTestStep] = []
    public var failed: CloudTestStep?
    public var message = ""
    public init() {}
    public var success: Bool { failed == nil && completed == CloudTestStep.allCases }
    /// 纯状态机推进：成功记一步，失败定格在失败步（后续步骤不再执行）。
    public mutating func pass(_ step: CloudTestStep) {
        guard failed == nil, !completed.contains(step) else { return }
        completed.append(step)
    }
    public mutating func fail(_ step: CloudTestStep, message: String) {
        guard failed == nil else { return }
        failed = step
        self.message = message
    }
}

public enum CloudConnectionTest {

    /// 分步失败的排障文案（矩阵 #66 句式，按提供商区分）。
    public static func failureMessage(step: CloudTestStep, provider: String) -> String {
        let s3 = provider.lowercased() == "s3"
        switch step {
        case .upload:
            return s3
                ? "第 1 步（上传）失败：请核对访问密钥、存储桶名称与区域；凭据无效或无写入权限都会在这一步暴露。"
                : "第 1 步（上传）失败：请核对接口地址与凭据；服务不可达或凭据无效都会在这一步暴露。"
        case .list:
            return s3
                ? "第 2 步（列出）失败：测试对象可能已上传，但列举被拒绝；请检查存储桶的 ListBucket 读取权限与区域设置。"
                : "第 2 步（读取确认）失败：上传已可能完成，但返回的分享地址无法匿名读取；请核对公开链接基址与服务端配置。"
        case .delete:
            return s3
                ? "第 3 步（删除）失败：测试对象已上传但无法删除；请检查删除权限，并稍后手动清理该测试对象。"
                : "第 3 步（删除）失败：测试对象已上传但服务端拒绝了删除请求；请检查服务端是否支持 DELETE，并稍后手动清理。"
        }
    }

    public static let successMessage = "连接测试通过：已上传、列出并删除测试文件。"

    /// 三步连测。所有请求走 CloudUploader 的安全通道（强制 HTTPS 回环例外、禁重定向、不回显响应体）。
    @MainActor
    public static func run(account: CloudAccount, credential: String?, session: URLSession? = nil) async -> CloudConnectionTestProgress {
        var progress = CloudConnectionTestProgress()
        let provider = account.provider.lowercased()
        guard ["s3", "custom"].contains(provider) else {
            progress.fail(.upload, message: "此服务类型暂不支持测试连接。")
            return progress
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 120
        let owned = URLSession(configuration: configuration, delegate: CloudRedirectGuard(), delegateQueue: nil)
        defer { owned.invalidateAndCancel() }
        let urlSession = session ?? owned
        do {
            let probe = "wisp-connection-probe-" + UUID().uuidString + ".txt"
            let body = Data("Wisp 收集架连接测试".utf8)
            switch provider {
            case "s3":
                let token = credential?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let credentials = try S3Credentials.parse(token)
                let endpoint = try CloudUploader.checkedURL(
                    account.endpoint.isEmpty ? "https://s3.\(account.region).amazonaws.com" : account.endpoint,
                    label: "S3（对象存储）端点")
                let key = "wisp-test/" + probe
                let target = try CloudUploader.appendPath(endpoint, components: [account.bucket, key])
                // 1) 上传小测试文件（SigV4 头部签名）。
                var put = URLRequest(url: target)
                put.httpMethod = "PUT"
                put.setValue("text/plain", forHTTPHeaderField: "Content-Type")
                try S3Signer.sign(&put, payloadHash: CloudConnectionTest.sha256Hex(body),
                                  credentials: credentials, region: account.region)
                _ = try await CloudUploader.send(put, body: body, session: urlSession, stage: "测试连接 · 上传")
                progress.pass(.upload)
                // 2) 列出（ListObjectsV2，确认键在场）。
                var listComponents = URLComponents(url: target, resolvingAgainstBaseURL: false)!
                listComponents.percentEncodedQuery = nil
                var list = URLRequest(url: listComponents.url!)
                list.httpMethod = "GET"
                try S3Signer.sign(&list, payloadHash: CloudConnectionTest.emptyPayloadHash,
                                  credentials: credentials, region: account.region)
                _ = try await CloudUploader.send(list, session: urlSession, stage: "测试连接 · 列出")
                progress.pass(.list)
                // 3) 删除。
                var remove = URLRequest(url: target)
                remove.httpMethod = "DELETE"
                try S3Signer.sign(&remove, payloadHash: CloudConnectionTest.emptyPayloadHash,
                                  credentials: credentials, region: account.region)
                _ = try await CloudUploader.send(remove, session: urlSession, stage: "测试连接 · 删除")
                progress.pass(.delete)
            default:
                let token = credential?.trimmingCharacters(in: .whitespacesAndNewlines)
                var post = URLRequest(url: try CloudUploader.checkedURL(account.endpoint, label: "上传地址"))
                post.httpMethod = "POST"
                post.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
                post.setValue(CloudUploader.percentEncode(probe), forHTTPHeaderField: "X-Filename")
                if let token, !token.isEmpty { post.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
                let (data, _) = try await CloudUploader.send(post, body: body, session: urlSession, stage: "测试连接 · 上传")
                progress.pass(.upload)
                // 「列出」步 = 分享地址可匿名读取。
                let object = try CloudUploader.json(data, stage: "测试连接 · 上传")
                guard let raw = object["url"] as? String, !raw.isEmpty else {
                    throw CloudUploadFailure("测试连接 · 上传响应缺少有效的 url（链接字段）。")
                }
                let link = try CloudUploader.checkedURL(raw, label: "测试连接返回的分享地址")
                var head = URLRequest(url: link)
                head.httpMethod = "HEAD"
                _ = try await CloudUploader.send(head, session: urlSession, stage: "测试连接 · 读取确认")
                progress.pass(.list)
                var remove = URLRequest(url: link)
                remove.httpMethod = "DELETE"
                if let token, !token.isEmpty { remove.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
                _ = try await CloudUploader.send(remove, session: urlSession, stage: "测试连接 · 删除")
                progress.pass(.delete)
            }
            progress.message = successMessage
        } catch is CancellationError {
            progress.message = "测试连接已取消。"
        } catch {
            let step = CloudTestStep.allCases.first { !progress.completed.contains($0) } ?? .delete
            let detail = (error as? CloudUploadFailure)?.message ?? error.localizedDescription
            progress.fail(step, message: failureMessage(step: step, provider: provider) + "\n" + detail)
        }
        return progress
    }

    static let emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
