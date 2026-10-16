import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum WebImageReceiver {
    public struct Limits: Sendable {
        public var maximumBytes: Int
        public var timeout: TimeInterval
        public var maximumPixels: Int
        public var maximumSide: Int
        public init(maximumBytes: Int = 32 * 1024 * 1024, timeout: TimeInterval = 20,
                    maximumPixels: Int = 40_000_000, maximumSide: Int = 32768) {
            self.maximumBytes = maximumBytes; self.timeout = timeout
            self.maximumPixels = maximumPixels; self.maximumSide = maximumSide
        }
    }

    public struct Image: Sendable {
        public let data: Data
        public let fileExtension: String
    }

    public static func isImageAddress(_ url: URL) -> Bool {
        guard isAllowedAddress(url), let type = UTType(filenameExtension: url.pathExtension) else { return false }
        return type.conforms(to: .image)
    }

    public static func isAllowedAddress(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              ["http", "https"].contains(parts.scheme?.lowercased() ?? "") else { return false }
        return parts.port.map { (1...65535).contains($0) } ?? true
    }

    public static func allowsRedirect(from origin: URL, to target: URL) -> Bool {
        guard isAllowedAddress(origin), isAllowedAddress(target),
              origin.host?.lowercased() == target.host?.lowercased() else { return false }
        let sourceScheme = origin.scheme?.lowercased(), targetScheme = target.scheme?.lowercased()
        if sourceScheme == targetScheme {
            let defaultPort = sourceScheme == "https" ? 443 : 80
            return (origin.port ?? defaultPort) == (target.port ?? defaultPort)
        }
        return sourceScheme == "http" && targetScheme == "https"
            && (origin.port == nil || origin.port == 80) && (target.port == nil || target.port == 443)
    }

    public static func download(_ url: URL, limits: Limits = .init()) async throws -> Image {
        guard isImageAddress(url) else { throw WebImageReceiveError.invalidAddress }
        guard limits.maximumBytes > 0, limits.maximumPixels > 0, limits.maximumSide > 0,
              limits.timeout.isFinite, limits.timeout > 0 else { throw WebImageReceiveError.invalidLimits }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = limits.timeout
        configuration.timeoutIntervalForResource = limits.timeout
        let delegate = ImageDownloadGuard(origin: url, maximumBytes: limits.maximumBytes)
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: limits.timeout)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        do {
            let (temporary, response) = try await session.download(for: request, delegate: delegate)
            defer { try? FileManager.default.removeItem(at: temporary) }
            if let failure = delegate.failure { throw failure }
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw WebImageReceiveError.httpStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
            }
            let attributes = try FileManager.default.attributesOfItem(atPath: temporary.path)
            guard let bytes = attributes[.size] as? NSNumber, bytes.int64Value <= Int64(limits.maximumBytes) else {
                throw WebImageReceiveError.oversizedBytes
            }
            return try validatedImage(Data(contentsOf: temporary), limits: limits)
        } catch {
            if let failure = delegate.failure { throw failure }
            if error is WebImageReceiveError { throw error }
            if (error as? URLError)?.code == .timedOut { throw WebImageReceiveError.timedOut }
            if error is CancellationError || (error as? URLError)?.code == .cancelled { throw error }
            throw WebImageReceiveError.networkFailed
        }
    }

    public static func validatedImage(_ data: Data, limits: Limits = .init()) throws -> Image {
        guard data.count <= limits.maximumBytes else { throw WebImageReceiveError.oversizedBytes }
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false, kCGImageSourceShouldAllowFloat: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, options as CFDictionary),
              let identifier = CGImageSourceGetType(source) as String?, let type = UTType(identifier),
              type.conforms(to: .image), let suffix = type.preferredFilenameExtension else {
            throw WebImageReceiveError.notAnImage
        }
        let count = CGImageSourceGetCount(source)
        guard count > 0, count <= 100 else { throw WebImageReceiveError.oversizedPixels }
        var totalPixels = 0
        for index in 0..<count {
            guard let properties = CGImageSourceCopyPropertiesAtIndex(source, index, options as CFDictionary) as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                  let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else { throw WebImageReceiveError.notAnImage }
            let w = width.intValue, h = height.intValue
            guard w > 0, h > 0, w <= limits.maximumSide, h <= limits.maximumSide,
                  w <= (limits.maximumPixels - totalPixels) / h else { throw WebImageReceiveError.oversizedPixels }
            totalPixels += w * h
        }
        guard CGImageSourceCreateImageAtIndex(source, 0, options as CFDictionary) != nil else {
            throw WebImageReceiveError.notAnImage
        }
        return Image(data: data, fileExtension: suffix)
    }
}

public enum WebImageReceiveError: LocalizedError, Equatable {
    case invalidAddress, invalidLimits, unsafeRedirect, tooManyRedirects
    case oversizedBytes, oversizedPixels, notAnImage, timedOut, networkFailed, httpStatus(Int)
    public var errorDescription: String? {
        switch self {
        case .invalidAddress: return "不是可接收的网页图片地址。"
        case .invalidLimits: return "网页图片接收限制无效。"
        case .unsafeRedirect: return "图片地址跳转到了其他服务器或不安全地址，已停止接收。"
        case .tooManyRedirects: return "图片地址跳转次数过多，已停止接收。"
        case .oversizedBytes: return "图片超过接收大小上限（32 兆）。"
        case .oversizedPixels: return "图片超过安全像素或帧数上限。"
        case .notAnImage: return "这个地址没有返回可读取的图片，未改存成网页链接。"
        case .timedOut: return "接收网页图片超时，请重新拖入。"
        case .networkFailed: return "网页图片下载失败，请检查网络或图片访问权限。"
        case .httpStatus(let code): return "图片服务器未成功返回内容（状态码 \(code)）。"
        }
    }
}

private final class ImageDownloadGuard: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let origin: URL
    private let maximumBytes: Int
    private let lock = NSLock()
    private var storedFailure: WebImageReceiveError?
    private var redirects = 0
    var failure: WebImageReceiveError? { lock.lock(); defer { lock.unlock() }; return storedFailure }

    init(origin: URL, maximumBytes: Int) { self.origin = origin; self.maximumBytes = maximumBytes }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock()
        redirects += 1
        if redirects > 4 { storedFailure = .tooManyRedirects }
        else if request.url.map({ WebImageReceiver.allowsRedirect(from: response.url ?? origin, to: $0) }) != true { storedFailure = .unsafeRedirect }
        let allowed = storedFailure == nil
        lock.unlock()
        completionHandler(allowed ? request : nil)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesWritten > Int64(maximumBytes) || totalBytesExpectedToWrite > Int64(maximumBytes) else { return }
        lock.lock(); storedFailure = .oversizedBytes; lock.unlock()
        downloadTask.cancel()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) { }
}
