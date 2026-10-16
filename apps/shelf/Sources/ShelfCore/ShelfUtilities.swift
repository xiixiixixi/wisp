import AppKit
import Darwin
import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum ShelfUtilityAction: String, Codable, CaseIterable, Sendable {
    case copyPaths, copyTextContents, removeImageMetadata, moveToTrash

    public var title: String {
        switch self {
        case .copyPaths: return "复制路径"
        case .copyTextContents: return "复制文本文件正文"
        case .removeImageMetadata: return "去除图片元数据"
        case .moveToTrash: return "移至废纸篓"
        }
    }
}

public struct ShelfUtilityRequest: Sendable {
    public var action: ShelfUtilityAction
    public var sources: [URL]
    public var destination: URL?
    public var maxTextFileBytes: Int
    public var maxCombinedTextBytes: Int
    public var maxImagePixels: Int

    public init(action: ShelfUtilityAction, sources: [URL], destination: URL? = nil,
                maxTextFileBytes: Int = 2_097_152, maxCombinedTextBytes: Int = 8_388_608,
                maxImagePixels: Int = 40_000_000) {
        self.action = action
        self.sources = sources
        self.destination = destination
        self.maxTextFileBytes = maxTextFileBytes
        self.maxCombinedTextBytes = maxCombinedTextBytes
        self.maxImagePixels = maxImagePixels
    }
}

public struct ShelfUtilityOutcome: Equatable, Sendable {
    public let source: URL
    public let output: URL?
    public let succeeded: Bool
    public let message: String

    public init(source: URL, output: URL? = nil, succeeded: Bool, message: String) {
        self.source = source
        self.output = output
        self.succeeded = succeeded
        self.message = message
    }
}

public struct ShelfUtilityResult: Equatable, Sendable {
    public let clipboardText: String?
    public let outcomes: [ShelfUtilityOutcome]

    public init(clipboardText: String? = nil, outcomes: [ShelfUtilityOutcome]) {
        self.clipboardText = clipboardText
        self.outcomes = outcomes
    }
}

public enum ShelfUtilities {
    private static let worker = Worker()
    typealias RecycleHandler = @Sendable ([URL]) async throws -> [URL: URL]

    public static func execute(_ request: ShelfUtilityRequest) async -> ShelfUtilityResult {
        await execute(request, recycleHandler: { urls in try await recycleWithWorkspace(urls) })
    }

    static func execute(_ request: ShelfUtilityRequest, recycleHandler: @escaping RecycleHandler) async -> ShelfUtilityResult {
        if request.action == .moveToTrash {
            return await recycle(request, handler: recycleHandler)
        }
        return await worker.execute(request)
    }

    private actor Worker {
        func execute(_ request: ShelfUtilityRequest) -> ShelfUtilityResult {
            ShelfUtilities.local(request)
        }
    }

    private static func local(_ request: ShelfUtilityRequest) -> ShelfUtilityResult {
        var outcomes: [ShelfUtilityOutcome] = []
        var textParts: [String] = []
        var textBytes = 0
        var seen: Set<URL> = []
        for source in request.sources {
            do {
                try Task.checkCancellation()
                try unique(source, seen: &seen)
                let output: URL?
                let message: String
                switch request.action {
                case .copyPaths:
                    _ = try sourceValues(source)
                    let path = source.standardizedFileURL.path
                    guard !path.contains("\n"), !path.contains("\r") else {
                        throw UtilityFailure("文件名含换行符，不能组成明确的逐行路径清单。")
                    }
                    textParts.append(path)
                    output = nil
                    message = "路径已准备，未读取或改动文件正文"
                case .copyTextContents:
                    guard (1...16_777_216).contains(request.maxTextFileBytes),
                          (1...67_108_864).contains(request.maxCombinedTextBytes) else {
                        throw UtilityFailure("文本大小限制无效；单文件最多允许 16 MiB（16777216 字节），组合最多 64 MiB（67108864 字节）。")
                    }
                    let text = try readText(source, limit: request.maxTextFileBytes)
                    let addition = text.utf8.count + (textParts.isEmpty ? 0 : 2)
                    guard addition <= request.maxCombinedTextBytes - textBytes else {
                        throw UtilityFailure("组合后的文本超过大小限制；此项未加入，前面成功读取的正文仍保留。")
                    }
                    textParts.append(text)
                    textBytes += addition
                    output = nil
                    message = "正文已读取，原件未改动"
                case .removeImageMetadata:
                    output = try strippedImage(source, request: request)
                    message = "已生成去除敏感元数据的新图片，原件保留"
                case .moveToTrash:
                    throw UtilityFailure("废纸篓操作需要系统回收接口。")
                }
                outcomes.append(.init(source: source, output: output, succeeded: true, message: message))
            } catch {
                outcomes.append(.init(source: source, succeeded: false, message: readable(error)))
            }
        }
        let separator = request.action == .copyPaths ? "\n" : "\n\n"
        return .init(clipboardText: textParts.isEmpty ? nil : textParts.joined(separator: separator), outcomes: outcomes)
    }

    private static func sourceValues(_ source: URL) throws -> URLResourceValues {
        guard source.isFileURL, FileManager.default.fileExists(atPath: source.path) else {
            throw UtilityFailure("原文件不存在，或不是本机文件。")
        }
        do {
            return try source.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey, .fileSizeKey, .contentTypeKey, .isVolumeKey])
        } catch {
            throw UtilityFailure("无法读取此文件的信息；请检查访问权限。")
        }
    }

    private static func unique(_ source: URL, seen: inout Set<URL>) throws {
        guard seen.insert(source.standardizedFileURL).inserted else {
            throw UtilityFailure("同一文件重复出现，此项没有再次执行。")
        }
    }

    private static func readText(_ source: URL, limit: Int) throws -> String {
        let values = try sourceValues(source)
        guard values.isRegularFile == true else { throw UtilityFailure("只能读取普通文本文件，不能读取文件夹。") }
        let type = values.contentType ?? UTType(filenameExtension: source.pathExtension)
        let knownTextExtensions: Set<String> = ["txt", "text", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "xml", "yaml", "yml", "toml", "ini", "conf", "html", "htm", "css", "js", "jsx", "ts", "tsx", "swift", "rs", "sh", "py", "rb"]
        guard type?.conforms(to: .text) == true || knownTextExtensions.contains(source.pathExtension.lowercased()) else {
            throw UtilityFailure("此项不是明确的文本类型；不把文档、图片或未知二进制文件当作正文。")
        }
        guard FileManager.default.isReadableFile(atPath: source.path) else { throw UtilityFailure("文本文件不可读取；请检查访问权限。") }
        if let size = values.fileSize, size > limit { throw UtilityFailure("文本文件超过单文件读取大小限制（\(limit) 字节）。") }
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: source) }
        catch { throw UtilityFailure("无法打开文本文件；文件可能已移走或没有读取权限。") }
        defer { try? handle.close() }
        var data = Data()
        do {
            // The extra byte detects growth after the metadata check, without an unbounded read.
            while data.count <= limit {
                try Task.checkCancellation()
                guard let chunk = try handle.read(upToCount: min(65_536, limit + 1 - data.count)), !chunk.isEmpty else { break }
                data.append(chunk)
            }
        } catch is CancellationError { throw CancellationError() }
        catch { throw UtilityFailure("读取文本失败；此项没有加入剪贴板正文。") }
        guard data.count <= limit else { throw UtilityFailure("文本文件在读取时超过大小限制，没有截断后冒充完整正文。") }
        guard !data.contains(0), var text = String(data: data, encoding: .utf8) else {
            throw UtilityFailure("文件不是有效 UTF-8（通用文字编码）正文，或含二进制内容；没有猜测编码。")
        }
        if text.first == "\u{FEFF}" { text.removeFirst() }
        return text
    }

    private static func strippedImage(_ source: URL, request: ShelfUtilityRequest) throws -> URL {
        let values = try sourceValues(source)
        guard values.isRegularFile == true, FileManager.default.isReadableFile(atPath: source.path) else {
            throw UtilityFailure("图片不是可读取的普通文件。")
        }
        guard (1...64_000_000).contains(request.maxImagePixels) else { throw UtilityFailure("图片像素预算无效；最多允许 6400 万像素。") }
        guard let directory = request.destination, directory.isFileURL,
              (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
              FileManager.default.isWritableFile(atPath: directory.path) else {
            throw UtilityFailure("请明确选择可写的输出文件夹；不会覆盖原图片。")
        }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let input = CGImageSourceCreateWithURL(source as CFURL, options), CGImageSourceGetCount(input) == 1 else {
            throw UtilityFailure("图片损坏、格式不支持，或含多帧；不会只保留第一帧冒充完整图片。")
        }
        guard let identifier = CGImageSourceGetType(input),
              let type = UTType(identifier as String),
              [UTType.jpeg, .png, .tiff, .heic].contains(type),
              let properties = CGImageSourceCopyPropertiesAtIndex(input, 0, nil) as? [String: Any],
              let width = (properties[kCGImagePropertyPixelWidth as String] as? NSNumber)?.intValue,
              let height = (properties[kCGImagePropertyPixelHeight as String] as? NSNumber)?.intValue,
              width > 0, height > 0 else {
            throw UtilityFailure("仅处理单帧 JPEG、PNG、TIFF 或 HEIC（常用图片格式），且图片必须有有效尺寸。")
        }
        guard width <= request.maxImagePixels / height else { throw UtilityFailure("图片超过像素预算，未解码或生成输出。") }
        let orientation = (properties[kCGImagePropertyOrientation as String] as? NSNumber)?.intValue ?? 1
        guard (1...8).contains(orientation) else { throw UtilityFailure("图片方向信息无效，未生成可能转向错误的副本。") }
        let decodeOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(width, height),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(input, 0, decodeOptions as CFDictionary) else {
            throw UtilityFailure("图片无法完整解码，没有生成输出。")
        }
        let turned = (5...8).contains(orientation)
        guard image.width == (turned ? height : width), image.height == (turned ? width : height) else {
            throw UtilityFailure("图片解码尺寸发生变化，未把缩略图当作完整图片输出。")
        }
        guard let canvas = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                                     space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw UtilityFailure("无法建立只含像素的新图片，原件未改动。")
        }
        canvas.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        guard let cleanImage = canvas.makeImage() else { throw UtilityFailure("无法生成只含像素的新图片，原件未改动。") }
        try Task.checkCancellation()
        let sourceType = UTType(filenameExtension: source.pathExtension)
        let ext = sourceType == type ? source.pathExtension.lowercased() : (type.preferredFilenameExtension ?? "png")
        let output = directory.appendingPathComponent(source.deletingPathExtension().lastPathComponent + "-no-metadata").appendingPathExtension(ext)
        guard !exists(output) else { throw UtilityFailure("输出已有同名文件，未覆盖；请更换输出目录或移走原有输出。") }
        let temporary = directory.appendingPathComponent(".wisp-shelf-strip-" + UUID().uuidString)
        let descriptor = temporary.path.withCString { open($0, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR) }
        guard descriptor >= 0 else { throw UtilityFailure("无法建立图片输出临时文件，原件未改动。") }
        close(descriptor)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let destination = CGImageDestinationCreateWithURL(temporary as CFURL, identifier, 1, nil) else {
            throw UtilityFailure("系统无法写入此图片格式，原件未改动。")
        }
        // Encode a fresh pixel surface, not the source-backed image or its metadata.
        CGImageDestinationAddImage(destination, cleanImage, nil)
        guard CGImageDestinationFinalize(destination) else { throw UtilityFailure("图片编码失败，没有发布输出文件。") }
        try verifyStrippedImage(temporary, width: cleanImage.width, height: cleanImage.height)
        try Task.checkCancellation()
        let status = temporary.path.withCString { from in
            output.path.withCString { to in renamex_np(from, to, UInt32(RENAME_EXCL)) }
        }
        guard status == 0 else {
            throw UtilityFailure(errno == EEXIST ? "输出已被其他操作建立，未覆盖。" : "无法发布图片输出，原件未改动。")
        }
        return output
    }

    static func verifyStrippedImage(_ url: URL, width: Int, height: Int) throws {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              (properties[kCGImagePropertyPixelWidth as String] as? NSNumber)?.intValue == width,
              (properties[kCGImagePropertyPixelHeight as String] as? NSNumber)?.intValue == height else {
            throw UtilityFailure("输出图片验证失败，未发布文件。")
        }
        let privateGroups: [CFString] = [kCGImagePropertyExifAuxDictionary, kCGImagePropertyGPSDictionary, kCGImagePropertyIPTCDictionary,
                                       kCGImageProperty8BIMDictionary, kCGImagePropertyMakerAppleDictionary]
        for key in privateGroups where properties[key as String] != nil {
            throw UtilityFailure("输出仍包含拍摄或定位元数据，未发布文件。")
        }
        let privateFields: Set<String> = ["DocumentName", "ImageDescription", "Make", "Model", "Software", "DateTime", "Artist", "HostComputer", "Copyright", "Author", "Title", "Description", "Comment", "Creation Time", "ModificationTime", "XML:com.adobe.xmp"]
        for group in [kCGImagePropertyTIFFDictionary, kCGImagePropertyPNGDictionary] {
            if let dictionary = properties[group as String] as? [String: Any], !privateFields.isDisjoint(with: dictionary.keys) {
                throw UtilityFailure("输出仍包含来源、时间或描述信息，未发布文件。")
            }
        }
        // ImageIO creates dimensions/color tags itself, and bridges EXIF/TIFF tags through CGImageMetadata.
        // Only structural keys with verified numeric values are safe; absence of a whole EXIF group is not portable.
        let exif: [String: Int] = [kCGImagePropertyExifPixelXDimension as String: width,
                                 kCGImagePropertyExifPixelYDimension as String: height,
                                 kCGImagePropertyExifColorSpace as String: 1]
        let tiff: [String: Int] = [kCGImagePropertyTIFFOrientation as String: 1,
                                 kCGImagePropertyTIFFCompression as String: 1,
                                 kCGImagePropertyTIFFPhotometricInterpretation as String: 2,
                                 kCGImagePropertyTIFFResolutionUnit as String: 2,
                                 "TileWidth": width, "TileLength": height]
        for (group, allowed) in [(kCGImagePropertyExifDictionary, exif), (kCGImagePropertyTIFFDictionary, tiff)] {
            if let raw = properties[group as String] {
                guard let dictionary = raw as? [String: Any] else { throw UtilityFailure("输出元数据结构无效，未发布文件。") }
                for (name, value) in dictionary {
                    guard let expected = allowed[name], structuralNumber(value, equals: expected) else {
                        throw UtilityFailure("输出仍包含非必要元数据（\(name)），未发布文件。")
                    }
                }
            }
        }
        if let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
           let rawTags = CGImageMetadataCopyTags(metadata) {
            guard let tags = rawTags as? [CGImageMetadataTag] else {
                throw UtilityFailure("无法验证输出图片标签，未发布文件。")
            }
            for tag in tags {
                guard let namespace = CGImageMetadataTagCopyNamespace(tag),
                      let name = CGImageMetadataTagCopyName(tag), let value = CGImageMetadataTagCopyValue(tag) else {
                    throw UtilityFailure("输出包含无法验证的图片标签，未发布文件。")
                }
                let allowed = namespace as String == kCGImageMetadataNamespaceExif as String ? exif :
                    (namespace as String == kCGImageMetadataNamespaceTIFF as String ? tiff : [:])
                guard let expected = allowed[name as String], structuralNumber(value, equals: expected),
                      (CGImageMetadataTagCopyQualifiers(tag).map { CFArrayGetCount($0) } ?? 0) == 0 else {
                    throw UtilityFailure("输出仍包含拍摄、描述或 XMP（图片扩展信息）标签，未发布文件。")
                }
            }
        }
    }

    private static func structuralNumber(_ value: Any, equals expected: Int) -> Bool {
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            return number.doubleValue == Double(expected)
        }
        if let text = value as? String, let number = Int(text) { return number == expected }
        return false
    }

    private static func recycle(_ request: ShelfUtilityRequest, handler: RecycleHandler) async -> ShelfUtilityResult {
        var seen: Set<URL> = []
        var outcomes: [ShelfUtilityOutcome] = []
        for source in request.sources {
            do {
                try Task.checkCancellation()
                try unique(source, seen: &seen)
                let values = try sourceValues(source)
                guard source.standardizedFileURL.path != "/", values.isVolume != true,
                      source.standardizedFileURL != FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL else {
                    throw UtilityFailure("不能把磁盘根目录或整个用户主目录移至废纸篓。")
                }
                let mapping = try await handler([source])
                guard let output = mapping[source] ?? mapping.first(where: { $0.key.standardizedFileURL == source.standardizedFileURL })?.value,
                      output.isFileURL, output.standardizedFileURL != source.standardizedFileURL else {
                    throw UtilityFailure("系统没有确认此项进入废纸篓；未标记为成功。")
                }
                outcomes.append(.init(source: source, output: output, succeeded: true, message: "系统已确认移至废纸篓"))
            } catch {
                outcomes.append(.init(source: source, succeeded: false, message: "移至废纸篓未完成：" + readable(error)))
            }
        }
        return .init(outcomes: outcomes)
    }

    @MainActor
    private static func recycleWithWorkspace(_ urls: [URL]) async throws -> [URL: URL] {
        try await withCheckedThrowingContinuation { continuation in
            NSWorkspace.shared.recycle(urls) { mapping, error in
                if let error, mapping.isEmpty { continuation.resume(throwing: error) }
                else { continuation.resume(returning: mapping) }
            }
        }
    }

    private static func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path) || (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) != nil
    }

    private static func readable(_ error: Error) -> String {
        if error is CancellationError { return "操作已取消；已经完成的项目不会自动撤销。" }
        return error.localizedDescription
    }
}

private struct UtilityFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
