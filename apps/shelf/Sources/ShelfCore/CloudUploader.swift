import CryptoKit
import Foundation
import UniformTypeIdentifiers

/// #64/#67：一次上传的结果面——链接之外带上来源标注、到期点与撤销句柄。
public struct CloudUploadOutcome: Sendable, Equatable {
    public var links: [URL]
    /// presigned（S3 预签名）/publicBase（匿名公开基址）；其他提供商为 nil。
    public var linkSource: String?
    /// 预签名链接的失效点；nil = 不过期。
    public var expiresAt: Date?
    /// 与 links 平行排列的撤销句柄（S3=对象键 / imgur=图片编号 / custom=分享地址）。
    public var deleteHandles: [String?]
    public init(links: [URL], linkSource: String? = nil, expiresAt: Date? = nil, deleteHandles: [String?] = []) {
        self.links = links; self.linkSource = linkSource; self.expiresAt = expiresAt
        self.deleteHandles = deleteHandles
    }
}

public enum CloudUploader {
    public static func upload(_ urls: [URL], account: CloudAccount, credential: String?,
                              onProgress: (@Sendable (CloudUploadProgress) -> Void)? = nil) async throws -> [URL] {
        try await uploadDetailed(urls, account: account, credential: credential, onProgress: onProgress).links
    }

    public static func uploadDetailed(_ urls: [URL], account: CloudAccount, credential: String?,
                                      onProgress: (@Sendable (CloudUploadProgress) -> Void)? = nil) async throws -> CloudUploadOutcome {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 90
        configuration.timeoutIntervalForResource = 900
        let session = URLSession(configuration: configuration, delegate: CloudRedirectGuard(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        return try await uploadDetailed(urls, account: account, credential: credential, session: session, onProgress: onProgress)
    }

    static func upload(_ urls: [URL], account: CloudAccount, credential: String?, session: URLSession,
                       onProgress: (@Sendable (CloudUploadProgress) -> Void)? = nil) async throws -> [URL] {
        try await uploadDetailed(urls, account: account, credential: credential, session: session, onProgress: onProgress).links
    }

    static func uploadDetailed(_ urls: [URL], account: CloudAccount, credential: String?, session: URLSession,
                               onProgress: (@Sendable (CloudUploadProgress) -> Void)? = nil) async throws -> CloudUploadOutcome {
        let progress = CloudProgressReporter(totalFiles: urls.count, callback: onProgress)
        progress.preparing()
        try Task.checkCancellation()
        let provider = account.provider.lowercased()
        guard ["custom", "s3", "dropbox", "gdrive", "onedrive", "imgur", "icloud"].contains(provider) else {
            throw CloudUploadFailure("不支持此云服务类型。")
        }
        if provider == "icloud" {
            throw CloudUploadFailure("iCloud（苹果云盘）公开分享需要系统分享界面和相应签名权限；不能由普通上传接口生成公开链接。")
        }
        let token = credential?.trimmingCharacters(in: .whitespacesAndNewlines)
        if provider != "custom", token?.isEmpty != false {
            throw CloudUploadFailure("此云服务尚未设置访问凭据。")
        }
        if provider != "s3", let token, token.contains("\r") || token.contains("\n") {
            throw CloudUploadFailure("访问凭据不能包含换行符。")
        }
        var s3Credentials: S3Credentials?
        if provider == "custom" {
            _ = try checkedURL(account.endpoint, label: "上传地址")
        } else if provider == "s3" {
            s3Credentials = try S3Credentials.parse(token ?? "")
            guard !account.bucket.isEmpty, !account.bucket.contains("/"), !account.region.isEmpty,
                  account.region.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }) else {
                throw CloudUploadFailure("S3（对象存储）需要存储桶名称和区域，桶名称不能包含斜杠。")
            }
            let endpoint = try s3Endpoint(account)
            guard endpoint.query == nil, endpoint.fragment == nil else {
                throw CloudUploadFailure("S3（对象存储）端点不能包含查询参数或片段。")
            }
            // #64：预签名模式不需要匿名公开基址（链接本地签名即可读）；
            // 传统匿名公开模式仍然必须显式配置基址，上传绝不改桶权限。
            if !account.presignEnabled {
                guard !account.publicBaseURL.isEmpty else {
                    throw CloudUploadFailure("S3（对象存储）必须配置已允许公开读取的分享基址；上传不会自动修改存储桶权限。")
                }
                _ = try checkedURL(account.publicBaseURL, label: "公开分享基址")
            }
            if let message = CloudPathTemplate.validationError(for: account.pathTemplate) {
                throw CloudUploadFailure(message)
            }
        }
        // Validate the entire selection before the first request has a side effect.
        let files = try urls.map { try UploadFile($0, provider: provider) }
        var results: CloudUploadOutcome = CloudUploadOutcome(links: [])
        for (index, file) in files.enumerated() {
            progress.beginFile(file.url, index: index)
            do {
                try Task.checkCancellation()
                let outcome: CloudUploadOutcome
                switch provider {
                case "custom": outcome = try await custom(file, account: account, token: token, session: session, progress: progress)
                case "s3": outcome = try await s3(file, account: account, credentials: s3Credentials!, session: session, progress: progress)
                case "dropbox": outcome = try await dropbox(file, account: account, token: token!, session: session, progress: progress)
                case "gdrive": outcome = try await googleDrive(file, account: account, token: token!, session: session, progress: progress)
                case "onedrive": outcome = try await oneDrive(file, account: account, token: token!, session: session, progress: progress)
                case "imgur": outcome = try await imgur(file, token: token!, session: session, progress: progress)
                default: throw CloudUploadFailure("不支持此云服务类型。")
                }
                results.links.append(contentsOf: outcome.links)
                results.linkSource = results.linkSource ?? outcome.linkSource
                results.expiresAt = results.expiresAt ?? outcome.expiresAt
                results.deleteHandles.append(contentsOf: outcome.deleteHandles)
                progress.confirmed(results.links)
            } catch is CancellationError {
                throw CloudUploadFailure("上传已取消；没有自动重试或删除已上传文件。", completedLinks: results.links,
                    remainingFiles: Array(urls.dropFirst(index)), cancelled: true,
                    uploadMayHaveSucceeded: progress.bodyRequestStarted)
            } catch {
                let detail = (error as? CloudUploadFailure)?.message ?? "上传失败，未取得可确认的公开链接。"
                let prefix = results.links.isEmpty ? "" : "前面已完成 \(results.links.count) 个文件；"
                throw CloudUploadFailure(prefix + detail, completedLinks: results.links,
                    remainingFiles: Array(urls.dropFirst(index)), uploadMayHaveSucceeded: progress.bodyRequestStarted)
            }
        }
        progress.completed(results.links)
        return results
    }

    private static func custom(_ file: UploadFile, account: CloudAccount, token: String?, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        var request = URLRequest(url: try checkedURL(account.endpoint, label: "上传地址"))
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(percentEncode(file.name), forHTTPHeaderField: "X-Filename")
        authorize(&request, token: token)
        let (data, _) = try await send(request, file: file.url, session: session, stage: "自建服务上传", progress: progress)
        let object = try json(data, stage: "自建服务上传")
        let link = try responseLink(object["url"], stage: "自建服务上传", field: "url")
        // #67：custom 的撤销句柄就是分享地址（服务端支持 DELETE 即可撤销）。
        return CloudUploadOutcome(links: [link], deleteHandles: [link.absoluteString])
    }

    // AWS Signature V4: https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
    private static func s3(_ file: UploadFile, account: CloudAccount, credentials: S3Credentials, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        // #63：对象键按账户的路径模板生成（默认 {filename}）。
        let key = CloudPathTemplate.objectKey(template: account.pathTemplate, filename: file.name)
        let target = try appendPath(try s3Endpoint(account), components: [account.bucket, key])
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(file.mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(file.size), forHTTPHeaderField: "Content-Length")
        try S3Signer.sign(&request, payloadHash: try hashFile(file.url), credentials: credentials, region: account.region)
        _ = try await send(request, file: file.url, session: session, stage: "S3（对象存储）上传", progress: progress)
        if account.presignEnabled {
            // #64：本地 SigV4 预签名链接（GET、按档位到期），不需要改桶权限。
            let seconds = S3PresignExpiry.seconds(for: account.presignExpiry)
            let link = try S3Signer.presignedGET(url: target, credentials: credentials, region: account.region, expiresInSeconds: seconds)
            return CloudUploadOutcome(links: [link], linkSource: "presigned",
                expiresAt: Date().addingTimeInterval(TimeInterval(seconds)), deleteHandles: [key])
        }
        let publicURL = try appendPath(try checkedURL(account.publicBaseURL, label: "公开分享基址"), components: [key])
        var check = URLRequest(url: publicURL)
        check.httpMethod = "HEAD"
        do {
            _ = try await send(check, session: session, stage: "S3（对象存储）匿名公开检查", progress: progress)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw CloudUploadFailure("文件已上传，但公开地址未通过匿名读取检查。请核对公开基址及存储桶读取权限；不会自动开放权限。")
        }
        return CloudUploadOutcome(links: [publicURL], linkSource: "publicBase", deleteHandles: [key])
    }

    // Dropbox upload + explicit public sharing, not the ordinary file path.
    private static func dropbox(_ file: UploadFile, account: CloudAccount, token: String, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        let folder = account.bucket.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let path = "/" + (folder.isEmpty ? "" : folder + "/") + UUID().uuidString + "-" + file.name
        var request = URLRequest(url: URL(string: "https://content.dropboxapi.com/2/files/upload")!)
        request.httpMethod = "POST"
        authorize(&request, token: token)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(try asciiJSON(["path": path, "mode": [".tag": "add"], "autorename": true]), forHTTPHeaderField: "Dropbox-API-Arg")
        let (data, _) = try await send(request, file: file.url, session: session, stage: "Dropbox（云盘）上传", progress: progress)
        let upload = try json(data, stage: "Dropbox（云盘）上传")
        guard let id = upload["id"] as? String, !id.isEmpty else {
            throw CloudUploadFailure("Dropbox（云盘）上传响应缺少文件编号 id；没有确认公开分享。")
        }
        let sharing = try await jsonRequest("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", token: token,
            body: ["path": id, "settings": ["audience": [".tag": "public"], "access": [".tag": "viewer"]]],
            session: session, stage: "Dropbox（云盘）公开分享", progress: progress)
        guard let permissions = sharing["link_permissions"] as? [String: Any] else {
            throw CloudUploadFailure("文件已上传，但 Dropbox（云盘）分享响应缺少实际权限。")
        }
        let audience = (permissions["effective_audience"] as? [String: Any])?[".tag"] as? String
        let visibility = (permissions["resolved_visibility"] as? [String: Any])?[".tag"] as? String
        guard (audience ?? visibility) == "public", permissions["require_password"] as? Bool != true else {
            throw CloudUploadFailure("文件已上传，但 Dropbox（云盘）未允许无密码的公开访问；可能受团队策略限制。")
        }
        return CloudUploadOutcome(links: [try responseLink(sharing["url"], stage: "Dropbox（云盘）公开分享", field: "url")])
    }

    // Resumable upload avoids reading large files into memory. A session is not a share link.
    private static func googleDrive(_ file: UploadFile, account: CloudAccount, token: String, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        let startURL = URL(string: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id")!
        var request = URLRequest(url: startURL)
        request.httpMethod = "POST"
        authorize(&request, token: token)
        request.setValue("application/json; charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.setValue(file.mimeType, forHTTPHeaderField: "X-Upload-Content-Type")
        request.setValue(String(file.size), forHTTPHeaderField: "X-Upload-Content-Length")
        var metadata: [String: Any] = ["name": file.name]
        if !account.bucket.isEmpty { metadata["parents"] = [account.bucket] }
        request.httpBody = try JSONSerialization.data(withJSONObject: metadata)
        let (_, started) = try await send(request, session: session, stage: "Google Drive（谷歌云盘）创建上传会话", progress: progress)
        guard let location = started.value(forHTTPHeaderField: "Location") else {
            throw CloudUploadFailure("Google Drive（谷歌云盘）响应缺少上传会话地址 Location。")
        }
        let uploadURL = try checkedURL(location, label: "Google Drive（谷歌云盘）上传会话")
        guard sameOrigin(startURL, uploadURL) else {
            throw CloudUploadFailure("Google Drive（谷歌云盘）上传会话指向不同服务器，已拒绝发送访问凭据。")
        }
        var uploadRequest = URLRequest(url: uploadURL)
        uploadRequest.httpMethod = "PUT"
        authorize(&uploadRequest, token: token)
        uploadRequest.setValue(file.mimeType, forHTTPHeaderField: "Content-Type")
        uploadRequest.setValue(String(file.size), forHTTPHeaderField: "Content-Length")
        let (data, _) = try await send(uploadRequest, file: file.url, session: session, stage: "Google Drive（谷歌云盘）上传", progress: progress)
        let uploaded = try json(data, stage: "Google Drive（谷歌云盘）上传")
        guard let id = uploaded["id"] as? String, !id.isEmpty else {
            throw CloudUploadFailure("Google Drive（谷歌云盘）上传响应缺少文件编号 id。")
        }
        let base = "https://www.googleapis.com/drive/v3/files/" + percentEncode(id)
        let permission = try await jsonRequest(base + "/permissions?fields=id,type,role", token: token,
            body: ["type": "anyone", "role": "reader", "allowFileDiscovery": false],
            session: session, stage: "Google Drive（谷歌云盘）公开权限", progress: progress)
        guard permission["type"] as? String == "anyone", permission["role"] as? String == "reader" else {
            throw CloudUploadFailure("文件已上传，但 Google Drive（谷歌云盘）没有确认任何人可读取的分享权限。")
        }
        var fetch = URLRequest(url: URL(string: base + "?fields=id,webViewLink")!)
        authorize(&fetch, token: token)
        let (linkData, _) = try await send(fetch, session: session, stage: "Google Drive（谷歌云盘）读取分享地址", progress: progress)
        let link = try json(linkData, stage: "Google Drive（谷歌云盘）读取分享地址")
        return CloudUploadOutcome(links: [try responseLink(link["webViewLink"], stage: "Google Drive（谷歌云盘）公开分享", field: "webViewLink")])
    }

    private static func oneDrive(_ file: UploadFile, account: CloudAccount, token: String, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        let name = percentEncode(UUID().uuidString + "-" + file.name)
        let base = "https://graph.microsoft.com/v1.0/me/drive/"
        let target = account.bucket.isEmpty ? base + "root:/" + name + ":/content"
            : base + "items/" + percentEncode(account.bucket) + ":/" + name + ":/content"
        var request = URLRequest(url: URL(string: target)!)
        request.httpMethod = "PUT"
        authorize(&request, token: token)
        request.setValue(file.mimeType, forHTTPHeaderField: "Content-Type")
        let (data, _) = try await send(request, file: file.url, session: session, stage: "OneDrive（微软云盘）上传", progress: progress)
        let uploaded = try json(data, stage: "OneDrive（微软云盘）上传")
        guard let id = uploaded["id"] as? String, !id.isEmpty else {
            throw CloudUploadFailure("OneDrive（微软云盘）上传响应缺少文件编号 id。")
        }
        let sharing = try await jsonRequest(base + "items/" + percentEncode(id) + "/createLink", token: token,
            body: ["type": "view", "scope": "anonymous"], session: session, stage: "OneDrive（微软云盘）匿名分享", progress: progress)
        guard let link = sharing["link"] as? [String: Any], link["scope"] as? String == "anonymous", link["type"] as? String == "view" else {
            throw CloudUploadFailure("文件已上传，但 OneDrive（微软云盘）没有确认匿名只读分享；可能受管理员策略限制。")
        }
        return CloudUploadOutcome(links: [try responseLink(link["webUrl"], stage: "OneDrive（微软云盘）匿名分享", field: "link.webUrl")])
    }

    private static func imgur(_ file: UploadFile, token: String, session: URLSession, progress: CloudProgressReporter) async throws -> CloudUploadOutcome {
        let boundary = "WispShelf-" + UUID().uuidString
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\nfile\r\n".utf8))
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"upload\"\r\nContent-Type: \(file.mimeType)\r\n\r\n".utf8))
        do { body.append(try Data(contentsOf: file.url)) } catch { throw CloudUploadFailure("无法读取待上传图片。") }
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: URL(string: "https://api.imgur.com/3/image")!)
        request.httpMethod = "POST"
        authorize(&request, token: token)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let (data, _) = try await send(request, body: body, session: session, stage: "Imgur（图床）上传", progress: progress)
        let response = try json(data, stage: "Imgur（图床）上传")
        guard response["success"] as? Bool == true, let image = response["data"] as? [String: Any] else {
            throw CloudUploadFailure("Imgur（图床）没有返回已成功上传的图片结果。")
        }
        let link = try responseLink(image["link"], stage: "Imgur（图床）上传", field: "data.link")
        // #67：Imgur 的撤销句柄是图片编号（DELETE /3/image/{id}）。
        return CloudUploadOutcome(links: [link], deleteHandles: [CloudRevocation.imgurImageID(from: link)])
    }

    private static func jsonRequest(_ url: String, token: String, body: [String: Any], session: URLSession, stage: String, progress: CloudProgressReporter) async throws -> [String: Any] {
        var request = URLRequest(url: try checkedURL(url, label: "服务地址"))
        request.httpMethod = "POST"
        authorize(&request, token: token)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await send(request, session: session, stage: stage, progress: progress)
        return try json(data, stage: stage)
    }

    static func send(_ request: URLRequest, file: URL? = nil, body: Data? = nil, session: URLSession,
                             stage: String, progress: CloudProgressReporter? = nil) async throws -> (Data, HTTPURLResponse) {
        try Task.checkCancellation()
        let transfer = file != nil || body != nil
        let expected = body.map { Int64($0.count) }
            ?? file.flatMap { try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize }.map(Int64.init)
        progress?.request(stage: stage, transferring: transfer, expectedBytes: expected)
        let delegate = CloudTransferDelegate(progress: transfer ? progress : nil)
        let result: (Data, URLResponse)
        do {
            if let file { result = try await session.upload(for: request, fromFile: file, delegate: delegate) }
            else if let body { result = try await session.upload(for: request, from: body, delegate: delegate) }
            else { result = try await session.data(for: request, delegate: delegate) }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw CloudUploadFailure("\(stage)网络请求失败（错误代码 \(error.code.rawValue)）；没有确认公开分享。")
        } catch {
            throw CloudUploadFailure("\(stage)网络请求失败；没有确认公开分享。")
        }
        if transfer { progress?.request(stage: "正在确认分享链接", transferring: false, expectedBytes: nil) }
        guard let response = result.1 as? HTTPURLResponse else {
            throw CloudUploadFailure("\(stage)没有返回 HTTP（网络协议）响应。")
        }
        if let original = request.url, let final = response.url, !sameOrigin(original, final) {
            throw CloudUploadFailure("\(stage)响应来自不同服务器，已拒绝接受该结果。")
        }
        guard (200...299).contains(response.statusCode) else {
            let hint: String
            switch response.statusCode {
            case 300...399: hint = "自动重定向已禁止；请使用最终地址，避免凭据泄漏或上传方法改变。"
            case 401: hint = "访问凭据无效或已过期。"
            case 403: hint = "没有相应上传或公开分享权限，或服务策略不允许。"
            case 413: hint = "文件超过服务允许的大小。"
            case 429: hint = "请求过于频繁，请稍后重试。"
            default: hint = "服务没有确认本次操作成功。"
            }
            // Never echo arbitrary response bodies: an endpoint can reflect Authorization.
            throw CloudUploadFailure("\(stage)失败：HTTP（网络状态）\(response.statusCode)。\(hint)")
        }
        return (result.0, response)
    }

    static func authorize(_ request: inout URLRequest, token: String?) {
        if let token, !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
    }

    static func json(_ data: Data, stage: String) throws -> [String: Any] {
        guard let object = try? JSONSerialization.jsonObject(with: data), let dictionary = object as? [String: Any] else {
            throw CloudUploadFailure("\(stage)返回的内容不是有效 JSON（结构化数据）对象，无法确认链接。")
        }
        return dictionary
    }

    static func responseLink(_ value: Any?, stage: String, field: String) throws -> URL {
        guard let string = value as? String, !string.isEmpty else {
            throw CloudUploadFailure("\(stage)响应缺少有效的 \(field)（链接字段）。")
        }
        return try checkedURL(string, label: "\(stage)返回的分享地址")
    }

    static func checkedURL(_ value: String, label: String) throws -> URL {
        guard let components = URLComponents(string: value), let url = components.url,
              let host = components.host, !host.isEmpty, components.user == nil, components.password == nil,
              components.fragment == nil, let scheme = components.scheme?.lowercased(),
              scheme == "https" || (scheme == "http" && isLoopback(host)) else {
            throw CloudUploadFailure("\(label)必须是 HTTPS（加密网址）；仅本机回环地址允许 HTTP（非加密网址），且不能包含用户名、密码或片段。")
        }
        return url
    }

    private static func isLoopback(_ host: String) -> Bool {
        let host = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if host == "localhost" || host == "::1" { return true }
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
        return octets.count == 4 && octets[0] == "127" && octets.allSatisfy { part in
            !part.isEmpty && part.allSatisfy({ $0.isASCII && $0.isNumber }) && Int(part).map { (0...255).contains($0) } == true
        }
    }

    static func sameOrigin(_ first: URL, _ second: URL) -> Bool {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        return first.scheme?.lowercased() == second.scheme?.lowercased()
            && first.host?.lowercased() == second.host?.lowercased() && port(first) == port(second)
    }

    static func s3Endpoint(_ account: CloudAccount) throws -> URL {
        try checkedURL(account.endpoint.isEmpty ? "https://s3.\(account.region).amazonaws.com" : account.endpoint, label: "S3（对象存储）端点")
    }

    static func appendPath(_ base: URL, components: [String]) throws -> URL {
        guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false), parts.query == nil else {
            throw CloudUploadFailure("存储或分享基址不能包含查询参数。")
        }
        let suffix = components.map { $0.split(separator: "/", omittingEmptySubsequences: false).map { percentEncode(String($0)) }.joined(separator: "/") }.joined(separator: "/")
        parts.percentEncodedPath = parts.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        parts.percentEncodedPath = "/" + (parts.percentEncodedPath.isEmpty ? "" : parts.percentEncodedPath + "/") + suffix
        guard let url = parts.url else { throw CloudUploadFailure("无法组成有效的存储地址。") }
        return url
    }

    static func percentEncode(_ value: String) -> String {
        value.utf8.map { byte -> String in
            if (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || [45, 46, 95, 126].contains(byte) {
                return String(UnicodeScalar(byte))
            }
            return String(format: "%%%02X", byte)
        }.joined()
    }

    private static func asciiJSON(_ object: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let string = String(decoding: data, as: UTF8.self)
        return string.utf16.map { unit in unit < 128 ? String(UnicodeScalar(unit)!) : String(format: "\\u%04X", unit) }.joined()
    }

    static func hashFile(_ url: URL) throws -> String {
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var hash = SHA256()
            while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
                try Task.checkCancellation()
                hash.update(data: chunk)
            }
            return hash.finalize().map { String(format: "%02x", $0) }.joined()
        } catch is CancellationError { throw CancellationError() }
        catch { throw CloudUploadFailure("无法读取文件以计算 S3（对象存储）签名。") }
    }
}

public struct CloudUploadProgress: Sendable {
    public enum Phase: String, Sendable { case preparing, uploading, confirmingLink, completed }
    public let phase: Phase
    public let stage: String
    public let currentFile: URL?
    public let fileNumber: Int
    public let totalFiles: Int
    public let bytesSent: Int64
    public let expectedBytes: Int64?
    public let completedLinks: [URL]

    public var fraction: Double? {
        guard phase == .uploading, let expectedBytes, expectedBytes > 0 else { return nil }
        return min(1, max(0, Double(bytesSent) / Double(expectedBytes)))
    }
}

public struct CloudUploadFailure: LocalizedError, Sendable {
    public let message: String
    public let completedLinks: [URL]
    public let remainingFiles: [URL]
    public let cancelled: Bool
    public let uploadMayHaveSucceeded: Bool
    public init(_ message: String, completedLinks: [URL] = [], remainingFiles: [URL] = [],
                cancelled: Bool = false, uploadMayHaveSucceeded: Bool = false) {
        self.message = message
        self.completedLinks = completedLinks
        self.remainingFiles = remainingFiles
        self.cancelled = cancelled
        self.uploadMayHaveSucceeded = uploadMayHaveSucceeded
    }
    public var errorDescription: String? { message }
}

// Reports only bytes supplied by URLSession, not elapsed time or file-size estimates.
final class CloudProgressReporter: @unchecked Sendable {
    private let lock = NSLock()
    private let callback: (@Sendable (CloudUploadProgress) -> Void)?
    private let totalFiles: Int
    private var phase: CloudUploadProgress.Phase = .preparing
    private var stage = "正在准备文件"
    private var file: URL?
    private var fileNumber = 0
    private var bytesSent: Int64 = 0
    private var expectedBytes: Int64?
    private var links: [URL] = []
    private var startedBody = false
    private var lastEmission: UInt64 = 0
    private var reportedTransferBytes = false

    init(totalFiles: Int, callback: (@Sendable (CloudUploadProgress) -> Void)?) {
        self.totalFiles = totalFiles
        self.callback = callback
    }
    var bodyRequestStarted: Bool { lock.lock(); defer { lock.unlock() }; return startedBody }
    func preparing() { update {} }
    func beginFile(_ url: URL, index: Int) {
        update { file = url; fileNumber = index + 1; phase = .preparing; stage = "正在准备文件"; bytesSent = 0; expectedBytes = nil; startedBody = false }
    }
    func request(stage label: String, transferring: Bool, expectedBytes expected: Int64?) {
        update {
            phase = transferring ? .uploading : .confirmingLink
            stage = label
            bytesSent = 0
            expectedBytes = expected
            reportedTransferBytes = false
            if transferring { startedBody = true }
        }
    }
    func sent(_ count: Int64, expected: Int64) {
        update(forceEmission: false) {
            guard phase == .uploading else { return }
            bytesSent = max(bytesSent, count)
            if expected > 0 { expectedBytes = expected }
        }
    }
    func confirmed(_ completedLinks: [URL]) { update { links = completedLinks } }
    func completed(_ completedLinks: [URL]) { update { phase = .completed; stage = "分享链接已确认"; links = completedLinks } }
    private func update(forceEmission: Bool = true, _ changes: () -> Void) {
        lock.lock()
        changes()
        let now = DispatchTime.now().uptimeNanoseconds
        let fullySent = expectedBytes.map { $0 > 0 && bytesSent >= $0 } ?? false
        let firstTransferBytes = phase == .uploading && bytesSent > 0 && !reportedTransferBytes
        guard forceEmission || firstTransferBytes || fullySent || now - lastEmission >= 50_000_000 else { lock.unlock(); return }
        if phase == .uploading, bytesSent > 0 { reportedTransferBytes = true }
        lastEmission = now
        let snapshot = CloudUploadProgress(phase: phase, stage: stage, currentFile: file,
            fileNumber: fileNumber, totalFiles: totalFiles, bytesSent: bytesSent,
            expectedBytes: expectedBytes, completedLinks: links)
        lock.unlock()
        callback?(snapshot)
    }
}

final class CloudTransferDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let progress: CloudProgressReporter?
    init(progress: CloudProgressReporter?) { self.progress = progress }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        progress?.sent(totalBytesSent, expected: totalBytesExpectedToSend)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct UploadFile {
    let url: URL
    let name: String
    let size: Int64
    let mimeType: String
    init(_ url: URL, provider: String) throws {
        guard url.isFileURL else { throw CloudUploadFailure("只能上传本机文件，不能把网址当作文件上传。") }
        let values: URLResourceValues
        do { values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentTypeKey]) }
        catch { throw CloudUploadFailure("待上传文件不存在或无法读取。") }
        guard values.isRegularFile == true, FileManager.default.isReadableFile(atPath: url.path), let size = values.fileSize else {
            throw CloudUploadFailure("只能上传可读取的普通文件；文件夹请先压缩，不会自动打包。")
        }
        self.url = url
        name = url.lastPathComponent
        self.size = Int64(size)
        mimeType = values.contentType?.preferredMIMEType ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let limit: Int64?
        switch provider {
        case "dropbox": limit = 157_286_400
        case "onedrive": limit = 250_000_000
        case "imgur": limit = 10_000_000
        default: limit = nil
        }
        if let limit, self.size > limit { throw CloudUploadFailure("所选文件超过此上传方式的大小限制（\(limit) 字节）。") }
        if provider == "imgur", !mimeType.hasPrefix("image/") {
            throw CloudUploadFailure("Imgur（图床）上传仅接受图片；视频和普通文件不适用。")
        }
    }
}

final class CloudRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Reject even same-origin redirects: a 302 can silently turn a POST into GET.
        completionHandler(nil)
    }
}

struct S3Credentials: Decodable {
    let accessKey: String
    let secretKey: String
    let sessionToken: String?
    static func parse(_ value: String) throws -> S3Credentials {
        guard let data = value.data(using: .utf8), let result = try? JSONDecoder().decode(Self.self, from: data),
              !result.accessKey.isEmpty, !result.secretKey.isEmpty,
              !result.accessKey.contains(where: { $0.isWhitespace || $0 == "," || $0 == "/" }),
              result.sessionToken?.contains(where: { $0 == "\r" || $0 == "\n" }) != true else {
            throw CloudUploadFailure("S3（对象存储）凭据必须是包含 accessKey（访问编号）、secretKey（访问密钥）和可选 sessionToken（会话凭据）的 JSON（结构化数据）。")
        }
        return result
    }
}

enum S3Signer {
    static func sign(_ request: inout URLRequest, payloadHash: String, credentials: S3Credentials, region: String, date: Date = Date()) throws {
        guard let url = request.url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false), let host = components.host else {
            throw CloudUploadFailure("S3（对象存储）签名地址无效。")
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let timestamp = formatter.string(from: date)
        let day = String(timestamp.prefix(8))
        let formattedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let defaultPort = components.scheme == "https" ? 443 : 80
        request.setValue(formattedHost + (components.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? ""), forHTTPHeaderField: "Host")
        request.setValue(timestamp, forHTTPHeaderField: "x-amz-date")
        request.setValue(payloadHash, forHTTPHeaderField: "x-amz-content-sha256")
        if let token = credentials.sessionToken, !token.isEmpty { request.setValue(token, forHTTPHeaderField: "x-amz-security-token") }
        let headers = (request.allHTTPHeaderFields ?? [:]).filter { !["authorization", "content-length"].contains($0.key.lowercased()) }
            .map { ($0.key.lowercased(), $0.value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")) }
            .sorted { $0.0 < $1.0 }
        let canonicalHeaders = headers.map { "\($0.0):\($0.1)\n" }.joined()
        let signedHeaders = headers.map { $0.0 }.joined(separator: ";")
        let encodedQuery: [(name: String, value: String)] = (components.queryItems ?? []).map { item in
            (name: CloudUploader.percentEncode(item.name), value: CloudUploader.percentEncode(item.value ?? ""))
        }
        let sortedQuery = encodedQuery.sorted { first, second in
            first.name == second.name ? first.value < second.value : first.name < second.name
        }
        let queryPairs: [String] = sortedQuery.map { "\($0.name)=\($0.value)" }
        let query = queryPairs.joined(separator: "&")
        let canonical = [request.httpMethod ?? "GET", components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath,
                         query, canonicalHeaders, signedHeaders, payloadHash].joined(separator: "\n")
        let scope = "\(day)/\(region)/s3/aws4_request"
        let toSign = "AWS4-HMAC-SHA256\n\(timestamp)\n\(scope)\n\(sha256(Data(canonical.utf8)))"
        var key = hmac(Data(("AWS4" + credentials.secretKey).utf8), day)
        key = hmac(key, region)
        key = hmac(key, "s3")
        key = hmac(key, "aws4_request")
        let signature = hmac(key, toSign).map { String(format: "%02x", $0) }.joined()
        request.setValue("AWS4-HMAC-SHA256 Credential=\(credentials.accessKey)/\(scope), SignedHeaders=\(signedHeaders), Signature=\(signature)", forHTTPHeaderField: "Authorization")
    }

    private static func hmac(_ key: Data, _ value: String) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: Data(value.utf8), using: SymmetricKey(data: key)))
    }
    private static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    /// #64：查询串式预签名 GET（SigV4 query authentication，本地拼装、无外部服务）。
    /// 规范：https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-query-string-auth.html
    static func presignedGET(url: URL, credentials: S3Credentials, region: String,
                             expiresInSeconds: Int, date: Date = Date()) throws -> URL {
        guard (1...2_592_000).contains(expiresInSeconds) else {
            throw CloudUploadFailure("预签名到期时长须在 1 秒到 30 天之间。")
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false), let host = components.host else {
            throw CloudUploadFailure("S3（对象存储）预签名地址无效。")
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let timestamp = formatter.string(from: date)
        let day = String(timestamp.prefix(8))
        let scope = "\(day)/\(region)/s3/aws4_request"
        // 预签名的签名头只有 host（端口非默认时要带上，与头部签名一致）。
        let formattedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let defaultPort = components.scheme == "https" ? 443 : 80
        let hostValue = formattedHost + (components.port.map { $0 == defaultPort ? "" : ":\($0)" } ?? "")
        var query: [(name: String, value: String)] = [
            ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
            ("X-Amz-Credential", "\(credentials.accessKey)/\(scope)"),
            ("X-Amz-Date", timestamp),
            ("X-Amz-Expires", String(expiresInSeconds)),
            ("X-Amz-SignedHeaders", "host"),
        ]
        if let token = credentials.sessionToken, !token.isEmpty {
            query.append(("X-Amz-Security-Token", token))
        }
        // 规范查询串：名字/值都百分号编码，先按名后按值排序。
        let encodedPairs: [(String, String)] = query.map { pair in
            (CloudUploader.percentEncode(pair.name), CloudUploader.percentEncode(pair.value))
        }
        let sortedPairs = encodedPairs.sorted { first, second in
            first.0 == second.0 ? first.1 < second.1 : first.0 < second.0
        }
        let canonicalQuery = sortedPairs.map { "\($0.0)=\($0.1)" }.joined(separator: "&")
        let canonical = ["GET",
                         components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath,
                         canonicalQuery,
                         "host:\(hostValue)\n",
                         "host",
                         "UNSIGNED-PAYLOAD"].joined(separator: "\n")
        let toSign = "AWS4-HMAC-SHA256\n\(timestamp)\n\(scope)\n\(sha256(Data(canonical.utf8)))"
        var key = hmac(Data(("AWS4" + credentials.secretKey).utf8), day)
        key = hmac(key, region)
        key = hmac(key, "s3")
        key = hmac(key, "aws4_request")
        let signature = hmac(key, toSign).map { String(format: "%02x", $0) }.joined()
        var signed = components
        signed.percentEncodedQuery = canonicalQuery + "&X-Amz-Signature=" + signature
        guard let result = signed.url else { throw CloudUploadFailure("无法组成有效的预签名链接。") }
        return result
    }
}
