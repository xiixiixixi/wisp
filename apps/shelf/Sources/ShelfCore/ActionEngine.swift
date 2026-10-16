import AppKit
import Darwin
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers
import Vision

public enum ActionKind: String, Codable, CaseIterable, Sendable {
    case copy, move, archive, openApp, rename, resizeImages, compressImages
    case convertImages, imagePDF, extractText, stitchImages
    case mergePDFs, protectPDF, desktopPicture

    public var title: String {
        switch self {
        case .copy: return "复制到文件夹"
        case .move: return "移至文件夹"
        case .archive: return "压缩"
        case .openApp: return "使用应用打开"
        case .rename: return "重新命名"
        case .resizeImages: return "缩放图片"
        case .compressImages: return "压缩图片"
        case .convertImages: return "转换图片格式"
        case .imagePDF: return "图片转PDF"
        case .extractText: return "提取图片文字"
        case .stitchImages: return "拼接图片"
        case .mergePDFs: return "合并PDF"
        case .protectPDF: return "PDF加密码"
        case .desktopPicture: return "设为桌面图片"
        }
    }

    public var symbol: String {
        switch self {
        case .copy: return "doc.on.doc"
        case .move: return "folder"
        case .archive: return "doc.zipper"
        case .openApp: return "arrow.up.forward.app"
        case .rename: return "pencil"
        case .resizeImages: return "arrow.up.left.and.arrow.down.right"
        case .compressImages: return "arrow.down.right.and.arrow.up.left"
        case .convertImages: return "photo"
        case .imagePDF: return "doc.richtext"
        case .extractText: return "text.viewfinder"
        case .stitchImages: return "rectangle.split.1x2"
        case .mergePDFs: return "doc.badge.plus"
        case .protectPDF: return "lock.doc"
        case .desktopPicture: return "menubar.dock.rectangle"
        }
    }
}

public struct ActionRequest: Sendable {
    public var kind: ActionKind
    public var sources: [URL]
    public var destination: URL?
    public var name: String
    public var width: Int
    public var quality: Double
    public var format: String
    public var application: URL?
    public var sourceOrdinals: [URL: Int]?
    public var password: String
    public var findText: String
    public var replaceText: String
    public var renameMode: String
    public var caseSensitive: Bool
    public var toClipboard: Bool
    // #41：{n} 的起始序号（默认 1；{n} = counterStart + 批内序号）。
    public var counterStart: Int
    // #45：缩放模式 edge=最长边 / fit=最大宽高 contain / percent=百分比。
    public var resizeMode: String
    public var maxWidth: Int
    public var maxHeight: Int
    public var scalePercent: Int
    // #48：输出后动作（keep/replace/newShelf/reveal），由调用方在完成时执行。
    public var afterOutput: String

    public init(kind: ActionKind, sources: [URL], destination: URL? = nil,
                name: String = "", width: Int = 1600, quality: Double = 0.8,
                format: String = "jpeg", application: URL? = nil, sourceOrdinals: [URL: Int]? = nil,
                password: String = "", findText: String = "", replaceText: String = "",
                renameMode: String = "template", caseSensitive: Bool = false, toClipboard: Bool = false,
                counterStart: Int = 1, resizeMode: String = "edge",
                maxWidth: Int = 1600, maxHeight: Int = 1600, scalePercent: Int = 100,
                afterOutput: String = "keep") {
        self.kind = kind; self.sources = sources; self.destination = destination
        self.name = name; self.width = width; self.quality = quality
        self.format = format; self.application = application; self.sourceOrdinals = sourceOrdinals
        self.password = password; self.findText = findText; self.replaceText = replaceText
        self.renameMode = renameMode; self.caseSensitive = caseSensitive; self.toClipboard = toClipboard
        self.counterStart = counterStart; self.resizeMode = resizeMode
        self.maxWidth = maxWidth; self.maxHeight = maxHeight; self.scalePercent = scalePercent
        self.afterOutput = afterOutput
    }
}

public struct ActionOutcome: Equatable, Sendable {
    public var source: URL
    public var output: URL?
    public var succeeded: Bool
    public var message: String

    public init(source: URL, output: URL? = nil, succeeded: Bool, message: String = "") {
        self.source = source; self.output = output
        self.succeeded = succeeded; self.message = message
    }
}

public enum ActionEngine {
    private static let runner = Runner()

    // Callbacks report completed outcomes on the execution context, not necessarily the main thread.
    public static func execute(_ request: ActionRequest, progress: (@Sendable (ActionOutcome) -> Void)? = nil) async -> [ActionOutcome] {
        if request.kind == .openApp { return await openRequests(request, progress: progress) }
        if request.kind == .desktopPicture { return await desktopRequests(request, progress: progress) }
        return await runner.execute(request, progress: progress)
    }

    private actor Runner {
        func execute(_ request: ActionRequest, progress: (@Sendable (ActionOutcome) -> Void)?) -> [ActionOutcome] {
            ActionEngine.run(request, progress: progress)
        }
    }

    private static func run(_ request: ActionRequest, progress: (@Sendable (ActionOutcome) -> Void)?) -> [ActionOutcome] {
        guard !request.sources.isEmpty else { return [] }
        switch request.kind {
        case .archive:
            let results = archive(request)
            for outcome in results { progress?(outcome) }
            return results
        case .imagePDF, .stitchImages:
            let results = groupedImages(request)
            for outcome in results { progress?(outcome) }
            return results
        case .mergePDFs:
            let results = mergedPDFs(request)
            for outcome in results { progress?(outcome) }
            return results
        case .extractText where request.toClipboard:
            let results = extractedToClipboard(request)
            for outcome in results { progress?(outcome) }
            return results
        default: break
        }
        var results: [ActionOutcome] = []
        for (index, source) in request.sources.enumerated() {
            let outcome: ActionOutcome
            do {
                try validateSource(source)
                let ordinal = request.sourceOrdinals?[source] ?? index + 1
                guard ordinal > 0 else { throw Failure("原批次序号无效，没有执行。") }
                let (output, message) = try single(request, source: source, index: ordinal - 1)
                outcome = .init(source: source, output: output, succeeded: true, message: message)
            } catch {
                outcome = .init(source: source, output: (error as? Failure)?.output, succeeded: false, message: error.localizedDescription)
            }
            results.append(outcome)
            progress?(outcome)
        }
        return results
    }

    private static func openRequests(_ request: ActionRequest, progress: (@Sendable (ActionOutcome) -> Void)?) async -> [ActionOutcome] {
        var results: [ActionOutcome] = []
        for source in request.sources {
            let outcome: ActionOutcome
            do {
                try validateSource(source)
                try await open(source, application: request.application)
                outcome = .init(source: source, output: source, succeeded: true, message: "已交给所选应用")
            } catch {
                outcome = .init(source: source, succeeded: false, message: error.localizedDescription)
            }
            results.append(outcome)
            progress?(outcome)
        }
        return results
    }

    private static func desktopRequests(_ request: ActionRequest, progress: (@Sendable (ActionOutcome) -> Void)?) async -> [ActionOutcome] {
        var results: [ActionOutcome] = []
        for source in request.sources {
            let outcome: ActionOutcome
            do {
                try validateSource(source)
                _ = try image(source)
                try await setDesktopPicture(source)
                outcome = .init(source: source, output: source, succeeded: true, message: "已设为桌面图片")
            } catch {
                outcome = .init(source: source, succeeded: false, message: error.localizedDescription)
            }
            results.append(outcome)
            progress?(outcome)
        }
        return results
    }

    private static func setDesktopPicture(_ source: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            DispatchQueue.main.async {
                let screens = NSScreen.screens
                guard !screens.isEmpty else {
                    continuation.resume(throwing: Failure("没有可用的显示器")); return
                }
                var lastError: Error?
                var failures = 0
                for screen in screens {
                    do { try NSWorkspace.shared.setDesktopImageURL(source, for: screen, options: [:]) }
                    catch { failures += 1; lastError = error }
                }
                if failures == screens.count, let lastError { continuation.resume(throwing: lastError) }
                else { continuation.resume() }
            }
        }
    }

    private static func single(_ request: ActionRequest, source: URL, index: Int) throws -> (URL, String) {
        let fm = FileManager.default
        switch request.kind {
        case .copy, .move:
            guard let destination = request.destination else { throw Failure("请选择目标文件夹") }
            try validateDirectory(destination)
            let output = destination.appendingPathComponent(source.lastPathComponent)
            try vacant(output)
            if isDirectory(source), isWithin(output, directory: source) {
                throw Failure("不能把文件夹复制或移动到自身内部")
            }
            if request.kind == .copy {
                try writeOutput(output) { try fm.copyItem(at: source, to: $0) }
                return (output, "已复制")
            }
            return (output, try move(source, to: output))
        case .rename:
            let root = try destination(request, source: source)
            let ext = isDirectory(source) ? "" : source.pathExtension
            let originalStem = isDirectory(source) ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
            let stem: String
            if request.renameMode == "replace" {
                let find = request.findText
                guard !find.isEmpty else { throw Failure("请填写要查找的文字") }
                stem = Self.replacing(in: originalStem, find: find, with: request.replaceText, caseSensitive: request.caseSensitive)
                guard !stem.isEmpty else { throw Failure("替换后的名称不能为空") }
            } else {
                stem = try name(request.name.isEmpty ? "{name}" : request.name, source: source, index: index, counterStart: request.counterStart)
            }
            let output = root.appendingPathComponent(ext.isEmpty ? stem : stem + "." + ext)
            if output.standardizedFileURL == source.standardizedFileURL { return (source, "名称未变化") }
            try vacant(output)
            if isDirectory(source), isWithin(output, directory: source) { throw Failure("改名目标不能在原文件夹内部") }
            return (output, try move(source, to: output))
        case .protectPDF:
            let password = request.password
            guard password.count >= 3 else { throw Failure("密码至少需要3个字符") }
            guard source.pathExtension.lowercased() == "pdf" else { throw Failure("只支持PDF文稿") }
            let output = try outputURL(request, source: source, index: index, suffix: "protected", ext: "pdf")
            try writeEncryptedPDF(source, to: output, password: password)
            return (output, "已加密码保护")
        case .resizeImages, .compressImages, .convertImages:
            let original = try image(source)
            let format = try imageFormat(request.format)
            try validateQuality(request.quality)
            let suffix: String
            let result: CGImage
            if request.kind == .resizeImages {
                let mode = Self.resizeMode(for: request.resizeMode)
                if mode == .edge { try validateWidth(request.width) }
                else { try validateResizeBounds(request) }
                let size = Self.resizedDimensions(width: original.width, height: original.height,
                                                  mode: mode, longestEdge: request.width,
                                                  maxWidth: request.maxWidth, maxHeight: request.maxHeight,
                                                  percent: request.scalePercent)
                result = try render(width: size.width, height: size.height) { context in
                    context.draw(original, in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
                }
                suffix = "resized"
            } else {
                result = original
                suffix = request.kind == .compressImages ? "compressed" : "converted"
            }
            let output = try outputURL(request, source: source, index: index, suffix: suffix, ext: format.ext)
            try encode(result, output: output, format: format.type, quality: request.quality)
            return (output, "已生成新图片")
        case .extractText:
            let input = try image(source)
            let recognition = VNRecognizeTextRequest()
            recognition.recognitionLevel = .accurate
            recognition.usesLanguageCorrection = true
            recognition.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
            try VNImageRequestHandler(cgImage: input).perform([recognition])
            let text = (recognition.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure("没有识别到文字") }
            let output = try outputURL(request, source: source, index: index, suffix: "text", ext: "txt")
            try writeOutput(output) { try Data(text.utf8).write(to: $0, options: .withoutOverwriting) }
            return (output, "已保存识别文字")
        default: throw Failure("该动作需要整批处理")
        }
    }

    private static func archive(_ request: ActionRequest) -> [ActionOutcome] {
        let fm = FileManager.default
        var results = initialResults(request)
        var included: [Int] = []
        let stage = fm.temporaryDirectory.appendingPathComponent("WispShelf-" + UUID().uuidString)
        let contents = stage.appendingPathComponent("Contents")
        var ownsStage = false
        defer { if ownsStage { try? fm.removeItem(at: stage) } }
        let password = request.password
        if !password.isEmpty, password.count < 3 {
            for index in results.indices { results[index].message = "密码至少需要3个字符" }
            return results
        }
        do {
            let root = try destination(request, source: request.sources[0])
            let leaf = try name(request.name.isEmpty ? "Archive" : request.name, source: request.sources[0], index: 0, counterStart: request.counterStart)
            let output = root.appendingPathComponent(leaf.hasSuffix(".zip") ? leaf : leaf + ".zip")
            try vacant(output)
            try fm.createDirectory(at: stage, withIntermediateDirectories: false)
            ownsStage = true
            try fm.createDirectory(at: contents, withIntermediateDirectories: false)
            for (index, source) in request.sources.enumerated() {
                var staged: URL?
                do {
                    try validateSource(source)
                    if isDirectory(source), isWithin(stage, directory: source) { throw Failure("不能压缩包含临时工作目录的文件夹") }
                    var leaf = source.lastPathComponent
                    var number = 2
                    while exists(contents.appendingPathComponent(leaf)) {
                        leaf = source.deletingPathExtension().lastPathComponent + "-" + String(number)
                        if !source.pathExtension.isEmpty { leaf += "." + source.pathExtension }
                        number += 1
                    }
                    let target = stage.appendingPathComponent("input-" + UUID().uuidString)
                    staged = target
                    try fm.copyItem(at: source, to: target)
                    try renameExclusively(target, to: contents.appendingPathComponent(leaf))
                    included.append(index)
                } catch {
                    if let staged { try? fm.removeItem(at: staged) }
                    results[index].message = error.localizedDescription
                }
            }
            guard !included.isEmpty else { return results }
            try writeOutput(output) { temporary in
                let process = Process()
                process.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C"]
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                if password.isEmpty {
                    process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                    process.arguments = ["-c", "-k", "--norsrc", "--noextattr", "--noacl", "--keepParent", contents.path, temporary.path]
                    process.currentDirectoryURL = stage
                } else {
                    process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
                    process.arguments = ["-r", "-X", "-P", password, temporary.path, "."]
                    process.currentDirectoryURL = contents
                }
                try process.run()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else { throw Failure("系统压缩未完成") }
            }
            for index in included { results[index] = .init(source: request.sources[index], output: output, succeeded: true, message: "已加入压缩包") }
        } catch {
            for index in results.indices where included.contains(index) || results[index].message == "未处理" {
                results[index].message = error.localizedDescription
            }
        }
        return results
    }

    private static func groupedImages(_ request: ActionRequest) -> [ActionOutcome] {
        var results = initialResults(request)
        var images: [(index: Int, image: CGImage)] = []
        var totalPixels = 0
        for (index, source) in request.sources.enumerated() {
            do {
                try validateSource(source)
                let decoded = try image(source, remainingPixels: 80_000_000 - totalPixels)
                let pixels = decoded.width * decoded.height
                guard totalPixels <= 80_000_000 - pixels else { throw Failure("整批图片超过安全内存尺寸限制") }
                totalPixels += pixels
                images.append((index, decoded))
            }
            catch { results[index].message = error.localizedDescription }
        }
        guard let first = images.first else { return results }
        do {
            let output: URL
            if request.kind == .imagePDF {
                output = try outputURL(request, source: request.sources[first.index], index: 0, suffix: "images", ext: "pdf")
                let document = PDFDocument()
                for entry in images {
                    let bitmap = NSImage(cgImage: entry.image, size: NSSize(width: entry.image.width, height: entry.image.height))
                    guard let page = PDFPage(image: bitmap) else { throw Failure("无法生成图片文档页") }
                    document.insert(page, at: document.pageCount)
                }
                try writeOutput(output) { guard document.write(to: $0) else { throw Failure("文档保存失败") } }
            } else {
                try validateWidth(request.width)
                try validateQuality(request.quality)
                let format = try imageFormat(request.format)
                let heights = images.map { max(1, Int((Double($0.image.height) * Double(request.width) / Double($0.image.width)).rounded())) }
                let height = heights.reduce(0, +)
                let combined = try render(width: request.width, height: height) { context in
                    var y = height
                    for (entry, rowHeight) in zip(images, heights) {
                        y -= rowHeight
                        context.draw(entry.image, in: CGRect(x: 0, y: y, width: request.width, height: rowHeight))
                    }
                }
                output = try outputURL(request, source: request.sources[first.index], index: 0, suffix: "stitched", ext: format.ext)
                try encode(combined, output: output, format: format.type, quality: request.quality)
            }
            for entry in images { results[entry.index] = .init(source: request.sources[entry.index], output: output, succeeded: true, message: "已生成整批结果") }
        } catch {
            for entry in images { results[entry.index].message = error.localizedDescription }
        }
        return results
    }

    private static func open(_ source: URL, application: URL?) async throws {
        guard let application, application.isFileURL, application.pathExtension.lowercased() == "app",
              FileManager.default.fileExists(atPath: application.path) else { throw Failure("请选择已安装的应用") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            DispatchQueue.main.async {
                NSWorkspace.shared.open([source], withApplicationAt: application, configuration: .init()) { _, error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume() }
                }
            }
        }
    }

    /// #47 涂黑复用：解码原图（含方向校正）与全尺寸像素限制。
    static func image(_ source: URL, remainingPixels: Int = 40_000_000) throws -> CGImage {
        guard let reader = CGImageSourceCreateWithURL(source as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(reader, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber else { throw Failure("无法读取图片") }
        try validatePixels(width: width.intValue, height: height.intValue)
        guard width.intValue * height.intValue <= remainingPixels else { throw Failure("整批图片超过安全内存尺寸限制") }
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                      kCGImageSourceCreateThumbnailWithTransform: true,
                                      kCGImageSourceThumbnailMaxPixelSize: max(width.intValue, height.intValue)]
        guard let result = CGImageSourceCreateThumbnailAtIndex(reader, 0, options as CFDictionary) else { throw Failure("图片解码失败") }
        return result
    }

    private static func render(width: Int, height: Int, opaque: Bool = false, draw: (CGContext) -> Void) throws -> CGImage {
        try validatePixels(width: width, height: height)
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure("无法分配图片内存") }
        let bounds = CGRect(x: 0, y: 0, width: width, height: height)
        context.clear(bounds)
        if opaque {
            context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
            context.fill(bounds)
        }
        context.interpolationQuality = .high
        draw(context)
        guard let result = context.makeImage() else { throw Failure("图片生成失败") }
        return result
    }

    /// #43：编码落盘。writer 创建失败时按格式给出明确文案——HEIC 在旧系统上
    /// 不可编码，必须点名而不是笼统的「无法创建图片输出」。创建器可注入以便
    /// 单测覆盖失败路径。
    static func encode(_ image: CGImage, output: URL, format: CFString, quality: Double,
                       createDestination: (URL, CFString) -> CGImageDestination? =
                           { url, type in CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) }) throws {
        let bitmap: CGImage
        if format == UTType.jpeg.identifier as CFString {
            bitmap = try render(width: image.width, height: image.height, opaque: true) { context in
                context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            }
        } else { bitmap = image }
        let heic = format == UTType.heic.identifier as CFString
        try writeOutput(output) { temporary in
            guard let writer = createDestination(temporary, format) else {
                throw Failure(heic ? "此系统版本不支持HEIC编码，请改用JPEG或PNG后重试。" : "无法创建图片输出")
            }
            CGImageDestinationAddImage(writer, bitmap, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            guard CGImageDestinationFinalize(writer) else { throw Failure("图片保存失败") }
        }
    }

    /// #47 涂黑复用：扩展名 → 编码格式。
    static func imageFormat(_ value: String) throws -> (type: CFString, ext: String) {
        switch value.lowercased() {
        case "png": return (UTType.png.identifier as CFString, "png")
        case "jpg", "jpeg": return (UTType.jpeg.identifier as CFString, "jpg")
        case "tif", "tiff": return (UTType.tiff.identifier as CFString, "tiff")
        case "heic": return (UTType.heic.identifier as CFString, "heic")
        default: throw Failure("只支持PNG、JPEG、TIFF和HEIC图片格式")
        }
    }

    private static func outputURL(_ request: ActionRequest, source: URL, index: Int, suffix: String, ext: String) throws -> URL {
        let root = try destination(request, source: source)
        let pattern = request.name.isEmpty ? "{name}-" + suffix : request.name
        let stem = try name(pattern, source: source, index: index, counterStart: request.counterStart)
        return root.appendingPathComponent(stem + "." + ext)
    }

    private static func destination(_ request: ActionRequest, source: URL) throws -> URL {
        let root = request.destination ?? source.deletingLastPathComponent()
        try validateDirectory(root)
        return root
    }

    /// #41：{n} = counterStart + 批内序号；默认 counterStart=1 时与历史行为（index+1）一致。
    static func name(_ pattern: String, source: URL, index: Int, counterStart: Int = 1) throws -> String {
        let original = isDirectory(source) ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
        let stamp = Self.dateFormatter.string(from: Date())
        let value = pattern
            .replacingOccurrences(of: "{name}", with: original)
            .replacingOccurrences(of: "{n}", with: String(max(1, counterStart) + index))
            .replacingOccurrences(of: "{date}", with: stamp)
        guard !value.isEmpty, value != ".", value != "..", !value.contains("/"), !value.contains("\\"), !value.contains("\0") else { throw Failure("名称必须是单个文件名，不能包含路径") }
        return value
    }

    /// #45：缩放模式。未知值回落最长边（历史行为）。
    enum ResizeMode { case edge, fit, percent }
    static func resizeMode(for value: String) -> ResizeMode {
        switch value {
        case "fit": return .fit
        case "percent": return .percent
        default: return .edge
        }
    }

    /// #45：三种模式的缩放数学（纯函数便于单测）。结果至少 1px，且不超过
    /// 最长边/最大宽高/百分比各自的合法上限（fit=contain：等比放进最大宽高框）。
    static func resizedDimensions(width: Int, height: Int, mode: ResizeMode,
                                  longestEdge: Int, maxWidth: Int, maxHeight: Int, percent: Int) -> (width: Int, height: Int) {
        func clamp(_ size: (width: Int, height: Int)) -> (width: Int, height: Int) {
            (max(1, size.width), max(1, size.height))
        }
        switch mode {
        case .edge:
            let scale = Double(longestEdge) / Double(max(width, height))
            return clamp((Int((Double(width) * scale).rounded()), Int((Double(height) * scale).rounded())))
        case .fit:
            let scale = min(Double(maxWidth) / Double(width), Double(maxHeight) / Double(height))
            return clamp((Int((Double(width) * scale).rounded()), Int((Double(height) * scale).rounded())))
        case .percent:
            let scale = Double(percent) / 100
            return clamp((Int((Double(width) * scale).rounded()), Int((Double(height) * scale).rounded())))
        }
    }

    private static func validateResizeBounds(_ request: ActionRequest) throws {
        if resizeMode(for: request.resizeMode) == .fit {
            guard (1...16384).contains(request.maxWidth), (1...16384).contains(request.maxHeight) else {
                throw Failure("图片尺寸须在1至16384像素之间")
            }
        } else {
            guard (1...1000).contains(request.scalePercent) else { throw Failure("缩放百分比须在1至1000之间") }
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static func replacing(in text: String, find: String, with replacement: String, caseSensitive: Bool) -> String {
        if caseSensitive { return text.replacingOccurrences(of: find, with: replacement) }
        var result = ""
        var remainder = Substring(text)
        while let range = remainder.range(of: find, options: .caseInsensitive) {
            result += remainder[remainder.startIndex..<range.lowerBound]
            result += replacement
            remainder = remainder[range.upperBound...]
        }
        result += remainder
        return result
    }

    /// #40：改名预览与执行共用同一份查找替换规则（大小写开关语义一致）。
    static func replacingPreview(in text: String, find: String, with replacement: String, caseSensitive: Bool) -> String {
        replacing(in: text, find: find, with: replacement, caseSensitive: caseSensitive)
    }

    private static func writeEncryptedPDF(_ source: URL, to output: URL, password: String) throws {
        guard let document = CGPDFDocument(source as CFURL), document.numberOfPages > 0 else { throw Failure("无法读取PDF文稿") }
        try writeOutput(output) { temporary in
            let auxiliary: [CFString: Any] = [kCGPDFContextUserPassword: password, kCGPDFContextOwnerPassword: password]
            guard let context = CGContext(temporary as CFURL, mediaBox: nil, auxiliary as CFDictionary) else {
                throw Failure("无法创建加密PDF")
            }
            for pageNumber in 1...document.numberOfPages {
                guard let page = document.page(at: pageNumber) else { continue }
                let bounds = page.getBoxRect(.mediaBox)
                context.beginPDFPage([kCGPDFContextMediaBox: bounds] as CFDictionary)
                context.drawPDFPage(page)
                context.endPDFPage()
            }
            context.closePDF()
        }
    }

    private static func mergedPDFs(_ request: ActionRequest) -> [ActionOutcome] {
        var results = initialResults(request)
        var pages: [(index: Int, page: PDFPage)] = []
        var documents: [PDFDocument] = []
        for (index, source) in request.sources.enumerated() {
            do {
                try validateSource(source)
                guard let document = PDFDocument(url: source), document.pageCount > 0 else { throw Failure("不是有效的PDF文稿") }
                documents.append(document)
                for pageNumber in 0..<document.pageCount {
                    guard let page = document.page(at: pageNumber) else { continue }
                    pages.append((index, page))
                }
            } catch { results[index].message = error.localizedDescription }
        }
        guard let first = pages.first else { return results }
        do {
            let output = try outputURL(request, source: request.sources[first.index], index: 0, suffix: "merged", ext: "pdf")
            let merged = PDFDocument()
            for entry in pages { merged.insert(entry.page, at: merged.pageCount) }
            try writeOutput(output) { guard merged.write(to: $0) else { throw Failure("合并后的PDF保存失败") } }
            let indices = Set(pages.map { $0.index })
            for index in indices {
                results[index] = .init(source: request.sources[index], output: output, succeeded: true, message: "已合并为一份PDF")
            }
        } catch {
            let indices = Set(pages.map { $0.index })
            for index in indices { results[index].message = error.localizedDescription }
        }
        return results
    }

    private static func extractedToClipboard(_ request: ActionRequest) -> [ActionOutcome] {
        var results = initialResults(request)
        var texts: [(index: Int, text: String)] = []
        for (index, source) in request.sources.enumerated() {
            do {
                try validateSource(source)
                let input = try image(source)
                let recognition = VNRecognizeTextRequest()
                recognition.recognitionLevel = .accurate
                recognition.usesLanguageCorrection = true
                recognition.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
                try VNImageRequestHandler(cgImage: input).perform([recognition])
                let text = (recognition.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw Failure("没有识别到文字") }
                texts.append((index, text))
            } catch { results[index].message = error.localizedDescription }
        }
        guard !texts.isEmpty else { return results }
        let combined = texts.map { $0.text }.joined(separator: "\n\n")
        DispatchQueue.main.async {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(combined, forType: .string)
        }
        for entry in texts {
            results[entry.index] = .init(source: request.sources[entry.index], output: nil, succeeded: true, message: "识别文字已复制到剪贴板")
        }
        return results
    }

    /// #47 涂黑复用：原子发布（临时文件 + RENAME_EXCL，绝不覆盖既有文件）。
    static func writeOutput(_ output: URL, write: (URL) throws -> Void) throws {
        try vacant(output)
        let temporary = output.deletingLastPathComponent().appendingPathComponent(".wisp-shelf-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try write(temporary)
        try vacant(output)
        try renameExclusively(temporary, to: output)
    }

    private static func renameExclusively(_ source: URL, to output: URL) throws {
        let status = source.path.withCString { sourcePath in
            output.path.withCString { targetPath in renamex_np(sourcePath, targetPath, UInt32(RENAME_EXCL)) }
        }
        if status != 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }

    private static func move(_ source: URL, to output: URL) throws -> String {
        do { try renameExclusively(source, to: output); return "已移动" }
        catch let error as NSError where error.domain == NSPOSIXErrorDomain && error.code == Int(EXDEV) {
            try writeOutput(output) { try FileManager.default.copyItem(at: source, to: $0) }
            let original = source.deletingLastPathComponent().appendingPathComponent(".wisp-shelf-moved-" + UUID().uuidString)
            do { try renameExclusively(source, to: original) }
            catch { throw Failure("已复制到目标，但未能移走原件；原件仍在", output: output) }
            do { try FileManager.default.removeItem(at: original); return "已移动" }
            catch { return "已移动；原位置的临时副本未能清理，请检查" }
        }
    }

    private static func validateSource(_ source: URL) throws {
        guard source.isFileURL, FileManager.default.fileExists(atPath: source.path) else { throw Failure("原文件不存在或不是本地文件") }
    }

    private static func validateDirectory(_ url: URL) throws {
        guard url.isFileURL, isDirectory(url) else { throw Failure("目标文件夹不存在或不可用") }
    }

    private static func vacant(_ url: URL) throws {
        if exists(url) { throw Failure("目标已有同名项目，未覆盖") }
    }

    private static func exists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path) || (try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)) != nil
    }

    private static func isDirectory(_ url: URL) -> Bool {
        var directory = ObjCBool(false)
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) && directory.boolValue
    }

    private static func isWithin(_ child: URL, directory: URL) -> Bool {
        child.resolvingSymlinksInPath().standardizedFileURL.pathComponents.starts(with: directory.resolvingSymlinksInPath().standardizedFileURL.pathComponents)
    }

    private static func validateWidth(_ width: Int) throws {
        guard (1...16384).contains(width) else { throw Failure("图片尺寸须在1至16384像素之间") }
    }

    private static func validateQuality(_ quality: Double) throws {
        guard quality.isFinite, (0...1).contains(quality) else { throw Failure("图片质量须在0至1之间") }
    }

    private static func validatePixels(width: Int, height: Int) throws {
        guard width > 0, height > 0, width <= 32768, height <= 32768,
              width <= 40_000_000 / height else { throw Failure("图片超过安全内存尺寸限制") }
    }

    private static func initialResults(_ request: ActionRequest) -> [ActionOutcome] {
        request.sources.map { .init(source: $0, succeeded: false, message: "未处理") }
    }

    private struct Failure: LocalizedError {
        var text: String
        var output: URL?
        init(_ text: String, output: URL? = nil) { self.text = text; self.output = output }
        var errorDescription: String? { text }
    }
}
