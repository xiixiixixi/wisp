import AppKit
import ImageIO

@MainActor
public enum ContentReceiver {
    /// #24：Mail 拖动承载的 .eml 载荷类型（历史 board 风格；新版 Mail 多为文件承诺，
    /// 走既有的 NSFilePromiseReceiver 路径）。落到本机 .eml 文件。
    public static let mailMessageTypes: [NSPasteboard.PasteboardType] = [
        .init("com.apple.mail.eml"), .init("com.apple.mail.PasteboardType"),
    ]
    /// #28：服务菜单 NSFileContentsPboardType 的伪类型名（文件内容按其真实类型上板，
    /// 这里兜住没有专门分支的载荷）。
    public static let fileContentsType = NSPasteboard.PasteboardType("NSFileContentsPboardType")
    public static let types: [NSPasteboard.PasteboardType] = [.fileURL, .URL, .string, .png, .tiff, .rtf, .rtfd]
        + mailMessageTypes + [fileContentsType]
        + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) }

    public static func receive(_ pasteboard: NSPasteboard, store: ShelfStore, shelf: UUID, completed: @escaping ([UUID]) -> Void = { _ in }) -> Bool {
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            let normalizedURLs = urls.map(canonicalFileURL)
            let existing = Set(store.shelf(shelf)?.items.map { canonicalFileURL($0.resolvedURL) } ?? [])
            _ = store.add(normalizedURLs.filter { !existing.contains($0) }, to: shelf)
            let paths = Set(normalizedURLs)
            let ids = store.shelf(shelf)?.items.filter { paths.contains(canonicalFileURL($0.resolvedURL)) }.map(\.id) ?? []
            if !ids.isEmpty { completed(ids) }
            return !ids.isEmpty
        }
        if let receivers = pasteboard.readObjects(forClasses: [NSFilePromiseReceiver.self], options: nil) as? [NSFilePromiseReceiver], !receivers.isEmpty {
            let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
            let batch = PromiseBatch(count: receivers.reduce(0) { $0 + max(1, $1.fileNames.count) }, completed: completed)
            for receiver in receivers {
                let destination = store.contentDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                do { try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true) }
                catch { store.lastError = "附件保存目录创建失败：\(error.localizedDescription)"; for _ in 0..<max(1, receiver.fileNames.count) { batch.finish([]) }; continue }
                receiver.receivePromisedFiles(atDestination: destination, options: [:], operationQueue: queue) { url, error in
                    Task { @MainActor in
                        if let error { store.lastError = "接收附件失败：\(error.localizedDescription)" }
                        else if canonicalFileURL(url).path.hasPrefix(canonicalFileURL(destination).path + "/") { store.add([url], to: shelf, managed: true) }
                        let ids = store.shelf(shelf)?.items.filter { canonicalFileURL($0.resolvedURL) == canonicalFileURL(url) }.map(\.id) ?? []
                        batch.finish(ids)
                    }
                }
            }
            return true
        }
        do {
            if let data = pasteboard.data(forType: .png) {
                guard try WebImageReceiver.validatedImage(data).fileExtension == "png" else { throw WebImageReceiveError.notAnImage }
                let url = try store.materialize(data, extension: "png", kind: .image, to: shelf); finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            if let data = pasteboard.data(forType: .tiff) {
                let png = try pngFromTIFF(data)
                let url = try store.materialize(png, extension: "png", kind: .image, to: shelf); finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            // #24：Mail 拖动过去的 .eml 载荷——先于文字/链接分支，否则整封信会被存成主题文本。
            if let type = mailMessageTypes.first(where: { pasteboard.data(forType: $0) != nil }),
               let data = pasteboard.data(forType: type) {
                let url = try store.materialize(data, extension: "eml", kind: .text, to: shelf)
                finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            if let url = webURL(from: pasteboard) {
                if WebImageReceiver.isImageAddress(url) {
                    guard !store.settings.onlineDisabled else {
                        store.lastError = "在线功能已关闭，未下载网页图片。"; return false
                    }
                    Task { @MainActor in
                        do {
                            let image = try await WebImageReceiver.download(url)
                            let saved = try store.materialize(image.data, extension: image.fileExtension, kind: .image, to: shelf)
                            finish(saved, store: store, shelf: shelf, completed: completed)
                        } catch {
                            store.lastError = "网页图片接收失败：\(error.localizedDescription)"
                            completed([])
                        }
                    }
                    return true
                }
                let data = try PropertyListSerialization.data(fromPropertyList: ["URL": url.absoluteString], format: .xml, options: 0)
                let saved = try store.materialize(data, extension: "webloc", kind: .link, to: shelf)
                finish(saved, store: store, shelf: shelf, completed: completed); return true
            }
            // #24/#28：RTFD——板上是富文本目录格式；物化为 .rtfd 包（目录 + TXT.rtf）。
            if let data = pasteboard.data(forType: .rtfd) {
                let url = try materializeRTFD(data, store: store, shelf: shelf)
                finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            if !store.settings.plainText, let data = pasteboard.data(forType: .rtf) {
                let url = try store.materialize(data, extension: "rtf", kind: .text, to: shelf); finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            if let string = pasteboard.string(forType: .string), !string.isEmpty {
                let url = try store.materialize(Data(string.utf8), extension: "txt", kind: .text, to: shelf); finish(url, store: store, shelf: shelf, completed: completed); return true
            }
            // #28：NSFileContents 伪类型兜底——按内容嗅探扩展名落盘（具体类型已被上面各分支接走）。
            if let data = pasteboard.data(forType: fileContentsType) {
                let url = try store.materialize(data, extension: fileContentsExtension(data), kind: .file, to: shelf)
                finish(url, store: store, shelf: shelf, completed: completed); return true
            }
        } catch { store.lastError = "内容保存失败：\(error.localizedDescription)" }
        return false
    }

    /// #24：把板上的 RTFD 载荷物化成真正的 .rtfd 包（目录内放 TXT.rtf）。
    /// 板上能拿到的 RTFD 数据是富文本主体（"{\rtf" 开头）；图片附件随主文档一起收不进来时
    /// 至少保住文字内容，TextEdit 可直接打开该包。
    private static func materializeRTFD(_ data: Data, store: ShelfStore, shelf: UUID) throws -> URL {
        guard data.count <= 32 * 1024 * 1024 else { throw WebImageReceiveError.oversizedBytes }
        guard data.prefix(6) == Data("{\\rtf1".utf8) || data.prefix(5) == Data("{\\rtf".utf8) else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let folder = store.contentDirectory.appendingPathComponent(UUID().uuidString + ".rtfd", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: folder.appendingPathComponent("TXT.rtf"), options: .atomic)
        // 架上条目指向 .rtfd 包本身（双击即由系统按富文本包打开）。
        guard store.add([folder], to: shelf, kind: .text, managed: true) == 1 else { throw CocoaError(.fileWriteUnknown) }
        return folder
    }

    /// #28：NSFileContents 载荷的扩展名嗅探（只认明确魔数，其余保守落 .dat）。
    private static func fileContentsExtension(_ data: Data) -> String {
        if data.prefix(5) == Data("%PDF-".utf8) { return "pdf" }
        if data.prefix(4) == Data([0x50, 0x4B, 0x03, 0x04]) { return "zip" }
        if data.prefix(5) == Data("{\\rtf".utf8) { return "rtf" }
        if let text = String(data: data.prefix(4096), encoding: .utf8),
           !text.isEmpty, text.unicodeScalars.allSatisfy({ scalar in
               // 可打印文本（含常见空白）；其余控制字符/不可见码位一律当二进制。
               scalar.value >= 0x20 || [0x09, 0x0A, 0x0D, 0x0C].contains(scalar.value)
           }) {
            return "txt"
        }
        return "dat"
    }

    private static func pngFromTIFF(_ data: Data) throws -> Data {
        guard data.count <= WebImageReceiver.Limits().maximumBytes else { throw WebImageReceiveError.oversizedBytes }
        let options: [CFString: Any] = [kCGImageSourceShouldCache: false, kCGImageSourceShouldAllowFloat: false]
        guard let reader = CGImageSourceCreateWithData(data as CFData, options as CFDictionary),
              CGImageSourceGetCount(reader) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(reader, 0, options as CFDictionary) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else { throw ImageReceiveError.unreadable }
        let pixelWidth = width.intValue, pixelHeight = height.intValue
        guard pixelWidth > 0, pixelHeight > 0, pixelWidth <= 32768, pixelHeight <= 32768,
              pixelWidth <= 40_000_000 / pixelHeight else { throw ImageReceiveError.oversized }
        guard let image = CGImageSourceCreateImageAtIndex(reader, 0, options as CFDictionary) else { throw ImageReceiveError.decodeFailed }
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw ImageReceiveError.encodeFailed }
        return png
    }

    private static func webURL(from pasteboard: NSPasteboard) -> URL? {
        guard pasteboard.availableType(from: [.URL]) != nil else { return nil }
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: false]) as? [URL],
           let url = urls.first(where: WebImageReceiver.isAllowedAddress) { return url }
        guard let value = pasteboard.string(forType: .URL), let url = URL(string: value), WebImageReceiver.isAllowedAddress(url) else { return nil }
        return url
    }

    private static func canonicalFileURL(_ url: URL) -> URL {
        url.standardizedFileURL.resolvingSymlinksInPath()
    }

    private static func finish(_ url: URL, store: ShelfStore, shelf: UUID, completed: ([UUID]) -> Void) {
        completed(store.shelf(shelf)?.items.filter { canonicalFileURL($0.url) == canonicalFileURL(url) }.map(\.id) ?? [])
    }
}

private enum ImageReceiveError: LocalizedError {
    case unreadable, oversized, decodeFailed, encodeFailed
    var errorDescription: String? {
        switch self {
        case .unreadable: return "无法读取图片有效尺寸"
        case .oversized: return "图片超过安全内存尺寸限制"
        case .decodeFailed: return "图片解码失败"
        case .encodeFailed: return "图片保存格式转换失败"
        }
    }
}

@MainActor
private final class PromiseBatch {
    var remaining: Int
    var ids: Set<UUID> = []
    let completed: ([UUID]) -> Void
    init(count: Int, completed: @escaping ([UUID]) -> Void) { remaining = count; self.completed = completed }
    func finish(_ received: [UUID]) {
        guard remaining > 0 else { return }
        ids.formUnion(received); remaining -= 1
        if remaining == 0 { completed(Array(ids)) }
    }
}
