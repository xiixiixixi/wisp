import Foundation

public struct ShelfActionDraft: Codable, Equatable, Sendable {
    public var kind: ActionKind
    public var destination: String
    public var name: String
    public var widthText: String
    public var quality: Double
    public var format: String
    public var application: String
    public var password: String
    public var findText: String
    public var replaceText: String
    public var renameMode: String
    public var caseSensitive: Bool
    public var toClipboard: Bool
    // #41：{n} 起始序号（文本态与既有字段一致，方便输入框直接绑定）。
    public var counterStartText: String
    // #45：缩放模式与两档新参数（文本态同上）。
    public var resizeMode: String
    public var maxWidthText: String
    public var maxHeightText: String
    public var percentText: String
    // #48：输出后动作。
    public var afterOutput: String

    public init(kind: ActionKind, destination: String = "", name: String? = nil,
                widthText: String = "1600", quality: Double = 0.8,
                format: String = "jpeg", application: String = "",
                password: String = "", findText: String = "", replaceText: String = "",
                renameMode: String = "template", caseSensitive: Bool = false, toClipboard: Bool = false,
                counterStartText: String = "1", resizeMode: String = "edge",
                maxWidthText: String = "1600", maxHeightText: String = "1600",
                percentText: String = "100", afterOutput: String = "keep") {
        self.kind = kind; self.destination = destination
        self.name = name ?? (kind == .rename ? "{name}-{n}" : "")
        self.widthText = widthText; self.quality = quality
        self.format = format; self.application = application
        self.password = password; self.findText = findText; self.replaceText = replaceText
        self.renameMode = renameMode; self.caseSensitive = caseSensitive; self.toClipboard = toClipboard
        self.counterStartText = counterStartText; self.resizeMode = resizeMode
        self.maxWidthText = maxWidthText; self.maxHeightText = maxHeightText
        self.percentText = percentText; self.afterOutput = afterOutput
    }

    public init(preset: ActionPreset) {
        self.init(kind: preset.kind, destination: preset.destination, name: preset.nameTemplate,
                  widthText: String(preset.width), quality: preset.quality,
                  format: preset.format, application: preset.application,
                  password: preset.password, findText: preset.findText, replaceText: preset.replaceText,
                  renameMode: preset.renameMode, caseSensitive: preset.caseSensitive, toClipboard: preset.toClipboard,
                  counterStartText: String(preset.counterStart), resizeMode: preset.resizeMode,
                  maxWidthText: String(preset.maxWidth), maxHeightText: String(preset.maxHeight),
                  percentText: String(preset.scalePercent), afterOutput: preset.afterOutput)
    }

    public var requiresDestination: Bool { kind == .copy || kind == .move }
    public var usesDestination: Bool { kind != .openApp && kind != .desktopPicture }
    public var usesName: Bool { ![.copy, .move, .openApp, .desktopPicture].contains(kind) && !(kind == .rename && renameMode == "replace") && !(kind == .extractText && toClipboard) }
    public var usesWidth: Bool { kind == .resizeImages || kind == .stitchImages }
    public var usesImageFormat: Bool { [.resizeImages, .compressImages, .convertImages, .stitchImages].contains(kind) }
    public var usesPassword: Bool { kind == .archive || kind == .protectPDF }
    public var usesRenameMode: Bool { kind == .rename }
    public var usesClipboardOption: Bool { kind == .extractText }
    /// #45：只有「缩放图片」有三档模式；拼接仍用固定宽度。
    public var usesResizeMode: Bool { kind == .resizeImages }
    /// #48：能产生输出文件的动作才需要「输出后」声明（copy/move/openApp/桌面无输出文件）。
    public var usesAfterOutput: Bool {
        [.resizeImages, .compressImages, .convertImages, .imagePDF, .stitchImages,
         .mergePDFs, .protectPDF, .archive, .extractText].contains(kind)
    }

    public func makeRequest(sources: [URL]) throws -> ActionRequest {
        guard !sources.isEmpty else { throw ShelfActionDraftError("请选择至少一个内容项。") }
        guard sources.allSatisfy(\.isFileURL) else { throw ShelfActionDraftError("只支持架子中的本地文件。") }
        let destinationText = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        var target: URL?
        if usesDestination {
            if requiresDestination, destinationText.isEmpty { throw ShelfActionDraftError("请选择目标文件夹。") }
            if !destinationText.isEmpty {
                let url = fileURL(destinationText)
                var isDirectory = ObjCBool(false)
                guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                    throw ShelfActionDraftError("目标文件夹不存在或不可用。")
                }
                target = url
            }
        }
        var applicationURL: URL?
        if kind == .openApp {
            let text = application.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { throw ShelfActionDraftError("请选择用于打开文件的应用。") }
            let url = fileURL(text)
            var isDirectory = ObjCBool(false)
            guard url.pathExtension.lowercased() == "app",
                  FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                throw ShelfActionDraftError("请选择存在的应用程序。")
            }
            applicationURL = url
        }
        let pattern = usesName ? name.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        if kind == .rename, renameMode == "replace" {
            if findText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw ShelfActionDraftError("请填写要查找的文字。") }
        } else if kind == .rename, pattern.isEmpty {
            throw ShelfActionDraftError("请填写名称模板。")
        }
        if !pattern.isEmpty, pattern == "." || pattern == ".." || pattern.contains("/") || pattern.contains("\\") || pattern.contains("\0") {
            throw ShelfActionDraftError("名称必须是单个文件名，不能包含路径。")
        }
        if kind == .protectPDF {
            let text = password
            guard !text.isEmpty, text.count >= 3 else { throw ShelfActionDraftError("密码至少需要3个字符。") }
        }
        if kind == .archive, !password.isEmpty, password.count < 3 {
            throw ShelfActionDraftError("密码至少需要3个字符。")
        }
        var width = 1600
        if usesWidth {
            guard let value = Int(widthText.trimmingCharacters(in: .whitespacesAndNewlines)), (1...16384).contains(value) else {
                throw ShelfActionDraftError("图片尺寸须为1至16384之间的整数像素。")
            }
            width = value
        }
        // #41：起始序号只在改名模板模式有效（替换模式没有 {n}）。
        var counterStart = 1
        if kind == .rename, renameMode != "replace" {
            guard let value = Int(counterStartText.trimmingCharacters(in: .whitespacesAndNewlines)), (1...999_999).contains(value) else {
                throw ShelfActionDraftError("起始序号须为1至999999之间的整数。")
            }
            counterStart = value
        }
        // #45：按模式校验对应参数（fit=最大宽高，percent=百分比）。
        let mode = ActionEngine.resizeMode(for: resizeMode)
        var maxWidth = 1600, maxHeight = 1600, scalePercent = 100
        if usesResizeMode, mode != .edge {
            if mode == .fit {
                guard let w = Int(maxWidthText.trimmingCharacters(in: .whitespacesAndNewlines)),
                      let h = Int(maxHeightText.trimmingCharacters(in: .whitespacesAndNewlines)),
                      (1...16384).contains(w), (1...16384).contains(h) else {
                    throw ShelfActionDraftError("图片尺寸须为1至16384之间的整数像素。")
                }
                maxWidth = w; maxHeight = h
            } else {
                guard let p = Int(percentText.trimmingCharacters(in: .whitespacesAndNewlines)), (1...1000).contains(p) else {
                    throw ShelfActionDraftError("缩放百分比须为1至1000之间的整数。")
                }
                scalePercent = p
            }
        }
        var imageFormat = "jpeg"
        if usesImageFormat {
            switch format.lowercased() {
            case "jpg", "jpeg": imageFormat = "jpeg"
            case "png": imageFormat = "png"
            case "tif", "tiff": imageFormat = "tiff"
            case "heic": imageFormat = "heic"
            default: throw ShelfActionDraftError("请选择PNG（无损图片）、JPEG（压缩图片）、TIFF（高质量图片）或HEIC（高效图片）格式。")
            }
            guard quality.isFinite, (0...1).contains(quality) else { throw ShelfActionDraftError("图片质量须在0至100%之间。") }
        }
        // #48：非法值回落 keep（历史行为）。
        let afterOutput = ShelfInteractionRules.afterOutputOutcome(for: afterOutput)
        return ActionRequest(kind: kind, sources: sources, destination: target, name: pattern,
                             width: width, quality: usesImageFormat ? quality : 0.8,
                             format: imageFormat, application: applicationURL,
                             password: password, findText: findText, replaceText: replaceText,
                             renameMode: renameMode, caseSensitive: caseSensitive, toClipboard: toClipboard,
                             counterStart: counterStart, resizeMode: usesResizeMode ? resizeMode : "edge",
                             maxWidth: maxWidth, maxHeight: maxHeight, scalePercent: scalePercent,
                             afterOutput: afterOutput)
    }

    /// #40：改名实时预览。与 ActionEngine 的取名规则同源（模板 {name}/{n}/{date}，
    /// 或查找替换），供动作面板/设置编辑器展示「当前名 → 新名」。
    /// 参数不合法（缺查找文字等）时返回空数组，由调用方沿用现有错误提示。
    public func previewRenames(sources: [URL], limit: Int = 5, date: Date = Date()) -> [(current: String, next: String)] {
        guard kind == .rename, !sources.isEmpty else { return [] }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let stamp = formatter.string(from: date)
        let start = max(1, Int(counterStartText.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 1)
        return sources.prefix(max(0, limit)).enumerated().map { index, source in
            let isDir = (try? source.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            let ext = isDir ? "" : source.pathExtension
            let originalStem = isDir ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
            let stem: String
            if renameMode == "replace" {
                let find = findText
                guard !find.isEmpty else { return (source.lastPathComponent, source.lastPathComponent) }
                stem = ActionEngine.replacingPreview(in: originalStem, find: find, with: replaceText, caseSensitive: caseSensitive)
            } else {
                let pattern = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "{name}" : name
                stem = pattern
                    .replacingOccurrences(of: "{name}", with: originalStem)
                    .replacingOccurrences(of: "{n}", with: String(start + index))
                    .replacingOccurrences(of: "{date}", with: stamp)
            }
            let next = stem.isEmpty || stem == "." || stem == ".." || stem.contains("/") || stem.contains("\\")
                ? source.lastPathComponent
                : (ext.isEmpty ? stem : stem + "." + ext)
            return (source.lastPathComponent, next)
        }
    }

    private func fileURL(_ path: String) -> URL {
        URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
    }

    private enum CodingKeys: String, CodingKey {
        case kind, destination, name, widthText, quality, format, application, password, findText, replaceText
        case renameMode, caseSensitive, toClipboard
        case counterStartText, resizeMode, maxWidthText, maxHeightText, percentText, afterOutput
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(kind: try container.decode(ActionKind.self, forKey: .kind))
        destination = try container.decodeIfPresent(String.self, forKey: .destination) ?? destination
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? name
        widthText = try container.decodeIfPresent(String.self, forKey: .widthText) ?? widthText
        quality = try container.decodeIfPresent(Double.self, forKey: .quality) ?? quality
        format = try container.decodeIfPresent(String.self, forKey: .format) ?? format
        application = try container.decodeIfPresent(String.self, forKey: .application) ?? application
        password = try container.decodeIfPresent(String.self, forKey: .password) ?? password
        findText = try container.decodeIfPresent(String.self, forKey: .findText) ?? findText
        replaceText = try container.decodeIfPresent(String.self, forKey: .replaceText) ?? replaceText
        renameMode = try container.decodeIfPresent(String.self, forKey: .renameMode) ?? renameMode
        caseSensitive = try container.decodeIfPresent(Bool.self, forKey: .caseSensitive) ?? caseSensitive
        toClipboard = try container.decodeIfPresent(Bool.self, forKey: .toClipboard) ?? toClipboard
        counterStartText = try container.decodeIfPresent(String.self, forKey: .counterStartText) ?? counterStartText
        resizeMode = try container.decodeIfPresent(String.self, forKey: .resizeMode) ?? resizeMode
        maxWidthText = try container.decodeIfPresent(String.self, forKey: .maxWidthText) ?? maxWidthText
        maxHeightText = try container.decodeIfPresent(String.self, forKey: .maxHeightText) ?? maxHeightText
        percentText = try container.decodeIfPresent(String.self, forKey: .percentText) ?? percentText
        afterOutput = try container.decodeIfPresent(String.self, forKey: .afterOutput) ?? afterOutput
    }
}

public struct ShelfActionDraftError: LocalizedError {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}
