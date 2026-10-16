import AppKit
import ShelfCore
import SwiftUI
import UniformTypeIdentifiers

@MainActor
struct ActionComposerView: View {
    @ObservedObject var store: ShelfStore
    let id: UUID
    let selectedSources: [URL]
    let onRun: (ActionRequest) -> Void
    let onDismiss: () -> Void
    @State private var error: String?
    @State private var editingPath = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: ShelfStore, id: UUID, selectedSources: [URL],
         onRun: @escaping (ActionRequest) -> Void, onDismiss: @escaping () -> Void) {
        self.store = store; self.id = id; self.selectedSources = selectedSources
        self.onRun = onRun; self.onDismiss = onDismiss
    }

    private var draft: ShelfActionDraft { store.actionDraft(for: id) ?? ShelfActionDraft(kind: .copy) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(ActionKind.allCases, id: \.rawValue) { kind in
                        Button {
                            if !store.beginActionDraft(kind, for: id) { error = store.lastError }
                            else { error = nil }
                        } label: {
                            Label(actionTitle(kind), systemImage: ShelfSymbols.action(kind))
                        }
                    }
                } label: {
                    Label(actionTitle(draft.kind), systemImage: ShelfSymbols.action(draft.kind))
                        .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.visible)
                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                .accessibilityLabel("操作")
                .help("选择操作")
                Button {
                    guard store.clearActionDraft(for: id) else { error = store.lastError; return }
                    onDismiss()
                } label: { ShelfIcon(.close, size: ShelfSymbols.compactSize) }
                .buttonStyle(ShelfQuietIconStyle(size: 24))
                .help("关闭动作参数").accessibilityLabel("关闭动作参数")
            }
            parameters
            if let error {
                Label(error, systemImage: ShelfSymbols.name(.warning))
                    .foregroundStyle(.red).font(.system(size: 11))
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button { NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "preview", userInfo: ["detail": true]) } label: {
                    ShelfIcon(.preview)
                }.buttonStyle(ShelfQuietIconStyle()).help("快速预览").accessibilityLabel("快速预览")
                Spacer(minLength: 0)
                Button(action: run) { Label(primaryTitle, systemImage: ShelfSymbols.action(draft.kind)) }
                    .buttonStyle(ShelfPrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(selectedSources.isEmpty || missingRequiredPath)
            }
        }
        .font(.system(size: 12)).controlSize(.small)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(ShelfGlassPalette.controlFill.opacity(0.55))
        .background(ShelfGlassBackground(material: .popover))
        .overlay(alignment: .top) { Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5) }
        .onChange(of: selectedSources) { _ in error = nil }
        .onChange(of: draft.kind) { _ in editingPath = false }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: editingPath)
    }

    @ViewBuilder private var parameters: some View {
        if draft.kind == .openApp {
            pathRow("应用", text: binding(\.application), placeholder: "选择应用", isApplication: true)
        } else {
            if draft.usesDestination {
                pathRow("目标", text: binding(\.destination),
                        placeholder: draft.requiresDestination ? "选择目标文件夹" : "原文件所在文件夹")
            }
            if draft.usesName {
                HStack(spacing: 8) {
                    parameterLabel(draft.kind == .rename ? "模板" : "名称")
                    TextField(draft.kind == .rename ? "{name}-{n}" : "保留默认名称", text: binding(\.name), prompt: Text(draft.kind == .rename ? "{name}-{n}" : "保留默认名称").foregroundColor(Color(nsColor: .secondaryLabelColor)))
                        .textFieldStyle(ShelfGlassFieldStyle())
                        .help("可用 {name}（原名称）、{n}（序号）和 {date}（日期）")
                }
            }
            if draft.usesRenameMode {
                HStack(spacing: 8) {
                    parameterLabel("方式")
                    renameModeMenu
                }
                if draft.renameMode == "replace" {
                    HStack(spacing: 8) {
                        parameterLabel("查找")
                        TextField("要替换的文字", text: binding(\.findText), prompt: Text("要替换的文字").foregroundColor(Color(nsColor: .secondaryLabelColor)))
                            .textFieldStyle(ShelfGlassFieldStyle())
                    }
                    HStack(spacing: 8) {
                        parameterLabel("替换")
                        TextField("替换为（可留空）", text: binding(\.replaceText), prompt: Text("替换为（可留空）").foregroundColor(Color(nsColor: .secondaryLabelColor)))
                            .textFieldStyle(ShelfGlassFieldStyle())
                    }
                    Toggle(isOn: binding(\.caseSensitive)) { Text("区分大小写") }
                        .toggleStyle(.checkbox)
                } else {
                    // #41：{n} 序号的起始值（默认 1）。
                    HStack(spacing: 8) {
                        parameterLabel("起始")
                        TextField("1", text: binding(\.counterStartText), prompt: Text("1").foregroundColor(Color(nsColor: .secondaryLabelColor)))
                            .textFieldStyle(ShelfGlassFieldStyle())
                            .frame(maxWidth: 72)
                            .help("模板里的 {n} 从这个数开始递增。")
                        Text("序号从该值开始").foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                }
                renamePreview
            }
            if draft.usesClipboardOption {
                HStack(spacing: 8) {
                    parameterLabel("输出")
                    clipboardDestinationMenu
                }
            }
            if draft.usesPassword {
                HStack(spacing: 8) {
                    parameterLabel("密码")
                    SecureField(draft.kind == .protectPDF ? "密码（至少3个字符）" : "可选密码", text: binding(\.password))
                        .textFieldStyle(ShelfGlassFieldStyle())
                    if draft.kind == .archive { Text("可选").foregroundStyle(.secondary) }
                }
            }
            if draft.usesResizeMode {
                // #45：三种缩放模式——最长边（历史默认）/ 适配最大宽高 / 百分比。
                HStack(spacing: 8) {
                    parameterLabel("方式")
                    resizeModeMenu
                }
                switch draft.resizeMode {
                case "fit":
                    HStack(spacing: 8) {
                        parameterLabel("不超")
                        TextField("1600", text: binding(\.maxWidthText), prompt: Text("1600").foregroundColor(Color(nsColor: .secondaryLabelColor))).textFieldStyle(ShelfGlassFieldStyle())
                            .frame(maxWidth: 72)
                        Text("×").foregroundStyle(.secondary)
                        TextField("1600", text: binding(\.maxHeightText), prompt: Text("1600").foregroundColor(Color(nsColor: .secondaryLabelColor))).textFieldStyle(ShelfGlassFieldStyle())
                            .frame(maxWidth: 72)
                        Text("像素").foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                case "percent":
                    HStack(spacing: 8) {
                        parameterLabel("缩放")
                        TextField("100", text: binding(\.percentText), prompt: Text("100").foregroundColor(Color(nsColor: .secondaryLabelColor))).textFieldStyle(ShelfGlassFieldStyle())
                            .frame(maxWidth: 72)
                        Text("%").foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                default:
                    HStack(spacing: 8) {
                        parameterLabel("长边")
                        TextField("1600", text: binding(\.widthText), prompt: Text("1600").foregroundColor(Color(nsColor: .secondaryLabelColor))).textFieldStyle(ShelfGlassFieldStyle())
                            .frame(maxWidth: 100)
                        Text("像素").foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                }
            } else if draft.usesWidth {
                HStack(spacing: 8) {
                    parameterLabel(draft.kind == .resizeImages ? "长边" : "宽度")
                    TextField("1600", text: binding(\.widthText), prompt: Text("1600").foregroundColor(Color(nsColor: .secondaryLabelColor))).textFieldStyle(ShelfGlassFieldStyle())
                        .frame(maxWidth: 100)
                    Text("像素").foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
            if draft.usesImageFormat {
                HStack(spacing: 8) {
                    parameterLabel("格式")
                    Menu {
                        Button("JPEG（压缩图片）") { imageFormatBinding.wrappedValue = "jpeg" }
                        Button("PNG（无损图片）") { imageFormatBinding.wrappedValue = "png" }
                        Button("TIFF（高质量图片）") { imageFormatBinding.wrappedValue = "tiff" }
                        // #43：HEIC 输出；旧系统编码失败时执行阶段会明确报错。
                        Button("HEIC（高效图片）") { imageFormatBinding.wrappedValue = "heic" }
                    } label: {
                        Text(imageFormatTitle).lineLimit(1)
                    }
                    .menuStyle(.borderlessButton).menuIndicator(.visible)
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .padding(.horizontal, 8)
                    .background(ShelfGlassControlBackground(radius: 6))
                    .accessibilityLabel("图片格式")
                }
                if ["jpg", "jpeg", "heic"].contains(draft.format.lowercased()) {
                    HStack(spacing: 8) {
                        parameterLabel("质量")
                        Slider(value: binding(\.quality), in: 0...1)
                        Text(draft.quality.formatted(.percent.precision(.fractionLength(0))))
                            .monospacedDigit().frame(width: 34, alignment: .trailing)
                    }
                }
            }
            if draft.usesAfterOutput {
                // #48：输出后动作四选（keep=现行为）。
                HStack(spacing: 8) {
                    parameterLabel("输出后")
                    afterOutputMenu
                }
            }
        }
    }

    private var renameModeMenu: some View {
        Menu {
            Button("自定义格式") { binding(\.renameMode).wrappedValue = "template" }
            Button("查找替换") { binding(\.renameMode).wrappedValue = "replace" }
        } label: {
            Text(draft.renameMode == "replace" ? "查找替换" : "自定义格式").lineLimit(1)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible)
        .frame(maxWidth: .infinity, minHeight: 28)
        .padding(.horizontal, 8)
        .background(ShelfGlassControlBackground(radius: 6))
        .accessibilityLabel("重命名方式")
    }

    /// #45：缩放方式菜单（最长边/适配最大宽高/百分比）。
    private var resizeModeMenu: some View {
        Menu {
            Button("最长边") { binding(\.resizeMode).wrappedValue = "edge" }
            Button("适配最大宽高") { binding(\.resizeMode).wrappedValue = "fit" }
            Button("百分比") { binding(\.resizeMode).wrappedValue = "percent" }
        } label: {
            Text(resizeModeTitle).lineLimit(1)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible)
        .frame(maxWidth: .infinity, minHeight: 28)
        .padding(.horizontal, 8)
        .background(ShelfGlassControlBackground(radius: 6))
        .accessibilityLabel("缩放方式")
    }

    private var resizeModeTitle: String {
        switch draft.resizeMode {
        case "fit": return "适配最大宽高"
        case "percent": return "百分比"
        default: return "最长边"
        }
    }

    /// #48：输出后动作菜单。
    private var afterOutputMenu: some View {
        Menu {
            Button("保留结果") { binding(\.afterOutput).wrappedValue = "keep" }
            Button("替换架内条目") { binding(\.afterOutput).wrappedValue = "replace" }
            Button("结果进新架子") { binding(\.afterOutput).wrappedValue = "newShelf" }
            Button("打开所在文件夹") { binding(\.afterOutput).wrappedValue = "reveal" }
        } label: {
            Text(afterOutputTitle).lineLimit(1)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible)
        .frame(maxWidth: .infinity, minHeight: 28)
        .padding(.horizontal, 8)
        .background(ShelfGlassControlBackground(radius: 6))
        .accessibilityLabel("输出后动作")
        .help("操作完成后对产物做什么：保留现行为、替换源条目、收进新架子，或在 Finder 中打开。")
    }

    private var afterOutputTitle: String {
        switch draft.afterOutput {
        case "replace": return "替换架内条目"
        case "newShelf": return "结果进新架子"
        case "reveal": return "打开所在文件夹"
        default: return "保留结果"
        }
    }

    /// #40：改名实时预览——前 5 项「当前名 → 新名」，模板/查找替换两模式都算。
    /// 预览与引擎取名同源（ShelfActionDraft.previewRenames），输入不合法时收起。
    @ViewBuilder private var renamePreview: some View {
        let rows = draft.previewRenames(sources: selectedSources)
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(selectedSources.count > rows.count
                     ? "预览（前 \(rows.count) / \(selectedSources.count) 项）"
                     : "预览（\(rows.count) 项）")
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: 6) {
                        Text(row.current).lineLimit(1).truncationMode(.middle)
                            .foregroundStyle(.secondary)
                        ShelfIcon(named: "arrow.right", size: ShelfSymbols.compactSize).foregroundStyle(.secondary)
                        Text(row.next).lineLimit(1).truncationMode(.middle)
                            .foregroundStyle(row.next == row.current ? .secondary : Color.primary)
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 11))
                    .help(row.current + " → " + row.next)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ShelfGlassPalette.controlFill.opacity(0.4), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private var clipboardDestinationMenu: some View {
        Menu {
            Button("新建文本文件") { binding(\.toClipboard).wrappedValue = false }
            Button("复制到剪贴板") { binding(\.toClipboard).wrappedValue = true }
        } label: {
            Text(draft.toClipboard ? "复制到剪贴板" : "新建文本文件").lineLimit(1)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible)
        .frame(maxWidth: .infinity, minHeight: 28)
        .padding(.horizontal, 8)
        .background(ShelfGlassControlBackground(radius: 6))
        .accessibilityLabel("文字保存位置")
    }

    private func pathRow(_ label: String, text: Binding<String>, placeholder: String, isApplication: Bool = false) -> some View {
        HStack(spacing: 8) {
            if editingPath {
                TextField(placeholder, text: text, prompt: Text(placeholder).foregroundColor(Color(nsColor: .secondaryLabelColor)))
                    .textFieldStyle(ShelfGlassFieldStyle()).help(text.wrappedValue).accessibilityLabel(label + "路径")
                Button { editingPath = false } label: { ShelfIcon(.success) }
                    .buttonStyle(ShelfQuietIconStyle()).help("完成路径编辑").accessibilityLabel("完成路径编辑")
            } else {
                Button { choosePath(isApplication: isApplication, target: text) } label: {
                    HStack(spacing: 8) {
                        ShelfIcon(isApplication ? .application : .folder).foregroundStyle(Color.accentColor)
                        Text(text.wrappedValue.isEmpty ? placeholder : URL(fileURLWithPath: (text.wrappedValue as NSString).expandingTildeInPath).lastPathComponent)
                            .lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                        ShelfIcon(.expand, size: ShelfSymbols.compactSize).foregroundStyle(.secondary)
                    }.padding(.horizontal, 9).frame(height: 32)
                        .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ShelfGlassPalette.controlStroke, lineWidth: 0.5))
                }.buttonStyle(.plain).help(text.wrappedValue.isEmpty ? placeholder : text.wrappedValue)
                    .accessibilityLabel(isApplication ? "选择应用" : "选择目标文件夹")
                Button { editingPath = true } label: { ShelfIcon(.edit) }
                    .buttonStyle(ShelfQuietIconStyle()).help("编辑完整路径").accessibilityLabel("编辑完整路径")
            }
        }
    }

    private var primaryTitle: String {
        let count = selectedSources.count
        switch draft.kind {
        case .copy: return "复制 \(count) 项"
        case .move: return "移动 \(count) 项"
        case .archive: return "创建压缩文件"
        case .rename: return "重命名 \(count) 项"
        case .openApp: return "打开 \(count) 项"
        default: return actionTitle(draft.kind)
        }
    }

    private var missingRequiredPath: Bool {
        (draft.requiresDestination && draft.destination.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            || (draft.kind == .openApp && draft.application.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func parameterLabel(_ title: String) -> some View {
        Text(title).foregroundStyle(.secondary).frame(width: 30, alignment: .leading)
    }

    private var imageFormatTitle: String {
        switch imageFormatBinding.wrappedValue {
        case "png": return "PNG（无损图片）"
        case "tiff": return "TIFF（高质量图片）"
        case "heic": return "HEIC（高效图片）"
        case "jpeg": return "JPEG（压缩图片）"
        default: return draft.format.uppercased()
        }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<ShelfActionDraft, Value>) -> Binding<Value> {
        Binding(get: { draft[keyPath: keyPath] }, set: { value in
            var updated = draft; updated[keyPath: keyPath] = value
            if !store.setActionDraft(updated, for: id) { error = store.lastError }
            else { error = nil }
        })
    }

    private var imageFormatBinding: Binding<String> {
        Binding(get: {
            switch draft.format.lowercased() {
            case "jpg": return "jpeg"
            case "tif": return "tiff"
            default: return draft.format.lowercased()
            }
        }, set: { binding(\.format).wrappedValue = $0 })
    }

    private func choosePath(isApplication: Bool, target: Binding<String>) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = isApplication; panel.canChooseDirectories = !isApplication
        panel.canCreateDirectories = false; panel.prompt = "选择"
        if isApplication { panel.allowedContentTypes = [.applicationBundle] }
        if !target.wrappedValue.isEmpty {
            let url = URL(fileURLWithPath: (target.wrappedValue as NSString).expandingTildeInPath)
            panel.directoryURL = isApplication ? url.deletingLastPathComponent() : url
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        target.wrappedValue = url.standardizedFileURL.path
    }

    private func run() {
        do {
            let request = try draft.makeRequest(sources: selectedSources)
            guard store.setActionDraft(draft, for: id) else { error = store.lastError; return }
            error = nil
            onRun(request)
        } catch { self.error = error.localizedDescription }
    }

    private func actionTitle(_ kind: ActionKind) -> String {
        kind == .imagePDF ? "图片转PDF（便携文档）" : kind.title
    }
}
