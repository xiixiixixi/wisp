import Foundation
import UniformTypeIdentifiers

/// #25：分享扩展（WispShelfShare.appex，嵌在主 Wisp.app 的 Contents/PlugIns）。
///
/// 纯输入模型：类型判定、inbox 物化命名、激活规则、collect 交接地址。
/// 刻意不链接 ShelfCore——appex 只需要「分类 → 物化 → 交接」三步的最小逻辑，
/// 但各条语义与 ShelfCore 对齐：
/// - 物化命名对齐 ShelfStore.materialize（文字/链接/图片按类落盘，见 inboxFileName）；
/// - 文件数上限对齐 ShelfAutomationRequest.maximumFiles（256）；
/// - 交接地址长度上限对齐 ShelfAutomationRequest.maximumAddressBytes（64KB，
///   独立版 WispShelf 直收链接时按这个上限校验）。
enum ShareIntake {
    static let maximumFiles = 256
    static let maximumAddressBytes = 64 * 1024
    /// 单文件 ≤2GB：Dropover 激活规则同款限制；激活字典表达不了尺寸，收件时校验。
    public static let maximumFileBytes: Int64 = 2 * 1024 * 1024 * 1024
    static let scheme = "wisp-shelf"

    enum Kind: Equatable {
        case fileList
        case image
        case webLink
        case plainText

        var typeLabel: String {
            switch self {
            case .fileList: return "文件"
            case .image: return "图片"
            case .webLink: return "链接"
            case .plainText: return "文本"
            }
        }
    }

    enum IntakeError: LocalizedError, Equatable {
        case emptyShare, tooManyFiles, oversizedFile(String), addressTooLong, unreadablePayload

        var errorDescription: String? {
            switch self {
            case .emptyShare: return "没有可加入收集架的内容。"
            case .tooManyFiles: return "一次最多分享 \(ShareIntake.maximumFiles) 项，请分批分享。"
            case .oversizedFile(let name): return "「\(name)」超过 2GB，无法加入收集架。"
            case .addressTooLong: return "文件路径过长，无法交接给收集架。"
            case .unreadablePayload: return "分享的内容无法读取，请重试。"
            }
        }
    }

    /// NSExtensionActivationRule（字典形式）：文件/图片/文本/链接任一满足即在分享面板出现。
    /// 与 Resources/Share-Info.plist 内嵌的规则一一对应，测试看守两处不漂移。
    static let activationRule: [String: Int] = [
        "NSExtensionActivationSupportsFileWithMaxCount": maximumFiles,
        "NSExtensionActivationSupportsImageWithMaxCount": maximumFiles,
        "NSExtensionActivationSupportsTextWithMaxCount": 1,
        "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
    ]

    // MARK: - 类型判定

    /// 一个附件已注册的 UTI 列表 → 我们接的载荷类别。
    /// 优先级对齐 ContentReceiver：文件地址 > 图片数据 > 网页链接 > 纯文本。
    /// （file-url 与 public.url 同挂时按文件收，避免把本机文件当网页链接物化。）
    static func classify(registeredTypeIdentifiers: [String]) -> Kind? {
        if registeredTypeIdentifiers.contains(UTType.fileURL.identifier) { return .fileList }
        if registeredTypeIdentifiers.contains(where: isImageIdentifier) { return .image }
        if registeredTypeIdentifiers.contains(UTType.url.identifier) { return .webLink }
        if registeredTypeIdentifiers.contains(where: isTextIdentifier) { return .plainText }
        return nil
    }

    private static func isImageIdentifier(_ identifier: String) -> Bool {
        UTType(identifier)?.conforms(to: .image) == true
    }

    /// 纯文本三档都认：public.utf8-plain-text（Safari/编辑器常注册）、
    /// public.plain-text、public.text（基类型；UTType.plainText 是前者不是它）。
    private static let textIdentifiers: Set<String> = [
        UTType.utf8PlainText.identifier, UTType.plainText.identifier, UTType.text.identifier,
    ]

    private static func isTextIdentifier(_ identifier: String) -> Bool {
        textIdentifiers.contains(identifier)
    }

    // MARK: - inbox 物化命名

    /// 物化落盘目录：~/Library/Application Support/WispShelf/inbox/
    /// （与 ShelfStore.defaultDirectory 同根；inbox 内容按普通文件引用入架，不进 Contents 托管区。）
    static func inboxDirectory(applicationSupport: URL) -> URL {
        applicationSupport.appendingPathComponent("WispShelf", isDirectory: true)
            .appendingPathComponent("inbox", isDirectory: true)
    }

    /// 物化文件名：分享文字-时间.txt / 分享链接-时间.webloc / 分享图片-时间.png。
    /// stamp 由调用方生成（yyyyMMdd-HHmmss），便于测试确定性。文件类不物化，返回空。
    static func inboxFileName(kind: Kind, stamp: String) -> String {
        switch kind {
        case .plainText: return "分享文字-\(stamp).txt"
        case .webLink: return "分享链接-\(stamp).webloc"
        case .image: return "分享图片-\(stamp).png"
        case .fileList: return ""
        }
    }

    /// 同一秒多张图片会撞名：撞了就在扩展名前补序号（name 2.png）。
    static func availableName(for proposed: String, in directory: URL) -> String {
        let path = proposed as NSString
        let base = path.deletingPathExtension
        let suffix = path.pathExtension.isEmpty ? "" : "." + path.pathExtension
        var candidate = proposed
        var order = 2
        while FileManager.default.fileExists(atPath: directory.appendingPathComponent(candidate).path) {
            candidate = base + " \(order)" + suffix
            order += 1
        }
        return candidate
    }

    /// .webloc 内容与 ContentReceiver 同构（XML 属性表包一条 URL）。
    static func weblocData(for url: URL) throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: ["URL": url.absoluteString], format: .xml, options: 0)
    }

    /// 单文件尺寸校验（≤2GB）。读不到尺寸的按超限拒绝，不静默放行。
    static func withinSizeLimit(_ fileURL: URL) -> Bool {
        guard let size = try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber else {
            return false
        }
        return size.int64Value <= maximumFileBytes
    }

    // MARK: - collect 交接地址

    /// 构造 wisp-shelf://collect?file=<urlencoded>&file=… 交接地址。
    /// 协议本身支持多文件（重复 file 参数；宿主侧 shelf.rs 与独立版 WispShelf 都按数组收）。
    /// 超过 64KB 时按序切块逐块交接——独立版直收路径对单条链接有同样上限，
    /// 不切块会在那一侧被整单拒绝。
    static func collectAddresses(forFiles files: [URL]) throws -> [URL] {
        guard !files.isEmpty else { throw IntakeError.emptyShare }
        guard files.count <= maximumFiles else { throw IntakeError.tooManyFiles }
        var addresses: [URL] = []
        var chunk: [String] = []
        var chunkBytes = overheadBytes
        for file in files {
            let encoded = percentEncoded(file.absoluteString)
            let itemBytes = "file=".utf8.count + encoded.utf8.count + 1
            guard itemBytes + overheadBytes <= maximumAddressBytes else { throw IntakeError.addressTooLong }
            if !chunk.isEmpty && chunkBytes + itemBytes > maximumAddressBytes {
                addresses.append(try address(encodedFiles: chunk))
                chunk = []; chunkBytes = overheadBytes
            }
            chunk.append(encoded)
            chunkBytes += itemBytes
        }
        if !chunk.isEmpty { addresses.append(try address(encodedFiles: chunk)) }
        return addresses
    }

    private static let overheadBytes = "\(scheme)://collect?".utf8.count

    private static func address(encodedFiles: [String]) throws -> URL {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.host = "collect"
        parts.percentEncodedQuery = encodedFiles.map { "file=" + $0 }.joined(separator: "&")
        guard let url = parts.url, url.absoluteString.utf8.count <= maximumAddressBytes else {
            throw IntakeError.addressTooLong
        }
        return url
    }

    /// 与 URLComponents 对 file= 查询项值的百分号编码保持一致
    /// （宿主 Rust 侧 query_pairs 与独立版 URLComponents 都按一次解码取回原值）。
    static func percentEncoded(_ value: String) -> String {
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "file", value: value)]
        guard let query = parts.percentEncodedQuery, query.hasPrefix("file=") else {
            return value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
        }
        return String(query.dropFirst("file=".count))
    }
}
