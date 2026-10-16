import Foundation

public enum ShelfAutomationRequest {
    public static let scheme = "wisp-shelf"
    public static let maximumFiles = 256
    public static let maximumAddressBytes = 64 * 1024

    public static func needsManagedCopy(_ file: URL, removedOnCompletion: Bool) -> Bool {
        if removedOnCompletion { return true }
        let path = file.standardizedFileURL.resolvingSymlinksInPath().path
        let temporary = FileManager.default.temporaryDirectory.standardizedFileURL.resolvingSymlinksInPath().path
        return path.hasPrefix(temporary + "/") || path.hasPrefix("/private/tmp/") || path.hasPrefix("/tmp/")
    }

    public static func address(for files: [URL]) throws -> URL {
        let files = try validatedFiles(files)
        var parts = URLComponents()
        parts.scheme = scheme
        parts.host = "collect"
        parts.queryItems = files.map { URLQueryItem(name: "file", value: $0.absoluteString) }
        guard let url = parts.url, url.absoluteString.utf8.count <= maximumAddressBytes else {
            throw ShelfAutomationError.addressTooLong
        }
        return url
    }

    public static func files(from address: URL) throws -> [URL] {
        guard address.absoluteString.utf8.count <= maximumAddressBytes,
              let parts = URLComponents(url: address, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == scheme, parts.host == "collect",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.path.isEmpty || parts.path == "/", parts.fragment == nil,
              let query = parts.queryItems, !query.isEmpty,
              query.allSatisfy({ $0.name == "file" && $0.value != nil }) else {
            throw ShelfAutomationError.invalidRequest
        }
        let files = try query.map { item -> URL in
            guard let value = item.value, let url = URL(string: value) else { throw ShelfAutomationError.invalidRequest }
            return url
        }
        return try validatedFiles(files)
    }

    /// #26：URL 控制子命令。collect 之外新增 shelf/new 与 shelf/last；
    /// 与宿主侧（shelf.rs 的 open_command）保持同一严格度——动词白名单、不带凭据/端口/查询/片段。
    public enum OpenVerb: Equatable {
        case collect([URL])
        case newShelf
        case lastShelf
    }

    public static func command(from address: URL) throws -> OpenVerb {
        guard let parts = URLComponents(url: address, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == scheme,
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil else {
            throw ShelfAutomationError.invalidRequest
        }
        if parts.host == "shelf" {
            guard parts.percentEncodedQuery == nil else { throw ShelfAutomationError.invalidRequest }
            switch parts.path {
            case "/new": return .newShelf
            case "/last": return .lastShelf
            default: throw ShelfAutomationError.invalidRequest
            }
        }
        return .collect(try files(from: address))
    }

    public static func validatedFiles(_ files: [URL]) throws -> [URL] {
        guard !files.isEmpty else { throw ShelfAutomationError.emptyFiles }
        guard files.count <= maximumFiles else { throw ShelfAutomationError.tooManyFiles }
        var seen: Set<URL> = []
        return try files.compactMap { url in
            guard url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost",
                  url.user == nil, url.password == nil, url.port == nil,
                  !url.path.isEmpty, url.path.hasPrefix("/"), url.query == nil, url.fragment == nil else {
                throw ShelfAutomationError.invalidFile
            }
            let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
            guard FileManager.default.fileExists(atPath: canonical.path),
                  FileManager.default.isReadableFile(atPath: canonical.path) else { throw ShelfAutomationError.unreadableFile }
            return seen.insert(canonical).inserted ? canonical : nil
        }
    }
}

public enum ShelfAutomationError: LocalizedError {
    case invalidRequest, invalidFile, unreadableFile, emptyFiles, tooManyFiles, addressTooLong, unavailable
    public var errorDescription: String? {
        switch self {
        case .invalidRequest: return "收集架自动化请求无效，文件未加入。"
        case .invalidFile: return "收集架自动化只能接收本机文件或文件夹。"
        case .unreadableFile: return "部分文件已不存在或无法读取，未提交这一批文件。"
        case .emptyFiles: return "请先提供要加入架子的文件。"
        case .tooManyFiles: return "一次最多接收 256 项，请分批加入。"
        case .addressTooLong: return "文件路径总长度过长，请分批加入。"
        case .unavailable: return "收集架暂时无法接收，请打开应用后重试。"
        }
    }
}
