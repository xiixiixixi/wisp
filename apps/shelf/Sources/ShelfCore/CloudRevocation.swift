import Foundation

/// #67：上传历史的「删除并撤销」——远端删对象 + 本地移记录。
/// 只有支持 DELETE 的提供商开放（custom/S3/imgur）；其余提供商只提供「从列表删除」。
public enum CloudRevocation {
    public static let revocableProviders: Set<String> = ["custom", "s3", "imgur"]

    public static func canRevoke(provider: String) -> Bool {
        revocableProviders.contains(provider.lowercased())
    }

    /// Imgur 分享链接（https://i.imgur.com/{id}.png 等）→ 图片编号。
    public static func imgurImageID(from link: URL) -> String? {
        guard link.host?.lowercased().hasSuffix("imgur.com") == true else { return nil }
        let last = link.lastPathComponent   // 形如 "abc123.png"
        let stem = last.contains(".") ? String(last.split(separator: ".").first ?? "") : last
        let value = stem.trimmingCharacters(in: .whitespacesAndNewlines)
        return (4...16).contains(value.count) && value.allSatisfy(\.isAlphanumericASCII) ? value : nil
    }

    /// 撤销一条记录里的全部可撤销句柄；全部成功才算撤销成功。
    /// 所有请求沿用 CloudUploader 的安全通道（强制 HTTPS 回环例外、禁重定向、不回显响应体）。
    @MainActor
    public static func revoke(record: CloudShareRecord, account: CloudAccount, credential: String?,
                              session: URLSession? = nil) async throws {
        let provider = account.provider.lowercased()
        guard canRevoke(provider: provider) else {
            throw CloudUploadFailure("此云服务不支持删除并撤销；可只从列表移除记录。")
        }
        let handles = record.revocableHandles
        guard handles.contains(where: { $0 != nil }) else {
            throw CloudUploadFailure("这条记录没有可撤销的远端对象。")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        let owned = URLSession(configuration: configuration, delegate: CloudRedirectGuard(), delegateQueue: nil)
        defer { owned.invalidateAndCancel() }
        let urlSession = session ?? owned
        var revoked = 0
        for handle in handles.compactMap({ $0 }) {
            switch provider {
            case "s3":
                let credentials = try S3Credentials.parse(credential ?? "")
                let endpoint = try CloudUploader.checkedURL(
                    account.endpoint.isEmpty ? "https://s3.\(account.region).amazonaws.com" : account.endpoint,
                    label: "S3（对象存储）端点")
                let target = try CloudUploader.appendPath(endpoint, components: [account.bucket, handle])
                var remove = URLRequest(url: target)
                remove.httpMethod = "DELETE"
                try S3Signer.sign(&remove, payloadHash: CloudConnectionTest.emptyPayloadHash,
                                  credentials: credentials, region: account.region)
                _ = try await CloudUploader.send(remove, session: urlSession, stage: "撤销分享 · S3（对象存储）删除")
            case "imgur":
                // 上传时存的句柄就是图片编号。
                let id = handle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard (4...16).contains(id.count), id.allSatisfy(\.isAlphanumericASCII) else { continue }
                var remove = URLRequest(url: URL(string: "https://api.imgur.com/3/image/" + CloudUploader.percentEncode(id))!)
                remove.httpMethod = "DELETE"
                if let token = credential?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty {
                    remove.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
                }
                _ = try await CloudUploader.send(remove, session: urlSession, stage: "撤销分享 · Imgur（图床）删除")
            default:
                let link = try CloudUploader.checkedURL(handle, label: "撤销分享地址")
                var remove = URLRequest(url: link)
                remove.httpMethod = "DELETE"
                if let token = credential?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty {
                    remove.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
                }
                _ = try await CloudUploader.send(remove, session: urlSession, stage: "撤销分享 · 自建服务删除")
            }
            revoked += 1
        }
        if revoked == 0 {
            throw CloudUploadFailure("这条记录里的链接都无法解析出远端对象，未执行撤销。")
        }
    }
}

extension Character {
    var isAlphanumericASCII: Bool {
        isASCII && (isLetter || isNumber)
    }
}
