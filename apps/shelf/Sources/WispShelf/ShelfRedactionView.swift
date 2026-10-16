import AppKit
import ShelfCore
import SwiftUI

/// #47：手动涂黑窗口的宿主。持有 NSWindow 与回调管道；SwiftUI 视图
/// （ShelfRedactionView）驱动全部编辑状态，这里只负责开/关与**恰好一次**的收尾。
final class ShelfRedactionController: NSObject, NSWindowDelegate {
    /// SwiftUI 的 rootView 是不可变值，闭包先落到盒子上、init 完成后再接线。
    private final class Relay {
        var handler: (() -> Void)?
        func finish() { handler?() }
    }

    let window: NSWindow
    private let onComplete: () -> Void
    private var finished = false

    init(sources: [URL],
         apply: @escaping (ActionOutcome) -> Void,
         onComplete: @escaping () -> Void) {
        self.onComplete = onComplete
        let relay = Relay()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 420),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "涂黑"
        window.minSize = NSSize(width: 480, height: 360)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: ShelfRedactionView(
            sources: sources, apply: apply, finish: { relay.finish() }))
        super.init()
        relay.handler = { [weak self] in self?.finish() }
        window.delegate = self
    }

    func show() {
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        window.close()
        onComplete()
    }

    func windowWillClose(_ notification: Notification) {
        // 用户直接关窗也走同一条收尾（视图侧保证 finish 只发一次）。
        (window.contentView as? NSHostingView<ShelfRedactionView>)?.rootView.finishIfPending()
    }
}

/// #47：手动涂黑编辑器。逐张处理：空白处拖框画黑块（可多个）、点选后可整框拖动、
/// 拖四角调框、Delete 删选中框；底部「导出副本 / 替换原文件 / 跳过」。
/// 框存归一化坐标（相对图片内容区），窗口缩放不影响；渲染与落盘在 ShelfRedaction。
struct ShelfRedactionView: View {
    let sources: [URL]
    let apply: (ActionOutcome) -> Void
    let finish: () -> Void

    private enum DragPhase {
        case create(CGPoint)
        case move(index: Int, previous: CGPoint)
        case resize(index: Int, corner: ShelfRedaction.Corner)
    }

    @State private var index = 0
    @State private var boxes: [RedactionBox] = []
    @State private var selection: RedactionBox.ID?
    @State private var drag: DragPhase?
    @State private var draft = CGRect.zero
    @State private var draftContent = CGRect.zero
    @State private var image: NSImage?
    @State private var notice: String?
    @State private var processing = false
    @State private var outcomes: [ActionOutcome] = []
    @State private var finished = false

    var body: some View {
        VStack(spacing: 0) {
            if index < sources.count { editor } else { summary }
        }
        .frame(minWidth: 480, minHeight: 360)
        .background(ShelfGlassPalette.canvas)
        .onDeleteCommand { deleteSelected() }
    }

    // MARK: 编辑页

    private var editor: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(sources[index].lastPathComponent)
                    .font(.system(size: 13, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                Spacer()
                if sources.count > 1 {
                    Text("第 \(index + 1) / \(sources.count) 张").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
            canvas
                .padding(.horizontal, 14).padding(.bottom, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            bottomBar
        }
    }

    private var canvas: some View {
        GeometryReader { geometry in
            let content = image.map {
                FileDragSource.aspectFit(image: $0, in: CGRect(origin: .zero, size: geometry.size))
            } ?? CGRect(origin: .zero, size: geometry.size)
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.06)
                if let image {
                    Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if image != nil {
                    boxesOverlay(in: content)
                    if case .create = drag {
                        draftOverlay
                    }
                }
            }
            .task(id: index) { await loadImage(at: index) }
        }
    }

    /// 手势挂在**内容区**那块透明层上：拖拽坐标天然以图片内容区为原点，
    /// 内容区外（画布留白）不会误画框。图片小于画布时按 aspect-fit 结果偏移对齐。
    private func boxesOverlay(in content: CGRect) -> some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            ForEach(boxes) { box in
                boxView(box, in: content)
            }
        }
        .frame(width: content.width, height: content.height, alignment: .topLeading)
        .offset(x: content.minX, y: content.minY)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in handleDrag(value, in: content) }
                .onEnded { _ in endDrag() }
        )
    }

    private func boxView(_ box: RedactionBox, in content: CGRect) -> some View {
        let rect = ShelfRedaction.rect(box, in: content)
        let selected = selection == box.id
        return Rectangle()
            .fill(Color.black)
            .frame(width: rect.width, height: rect.height)
            .overlay(
                Rectangle().strokeBorder(
                    selected ? Color.accentColor : Color.white.opacity(0.55),
                    lineWidth: selected ? 1.5 : 0.5))
            .overlay(alignment: .topLeading) { cornerHandle(selected) }
            .overlay(alignment: .topTrailing) { cornerHandle(selected) }
            .overlay(alignment: .bottomLeading) { cornerHandle(selected) }
            .overlay(alignment: .bottomTrailing) { cornerHandle(selected) }
            .position(x: rect.midX, y: rect.midY)
            .onTapGesture { selection = box.id }
    }

    private func cornerHandle(_ visible: Bool) -> some View {
        Circle().fill(Color.white)
            .overlay(Circle().strokeBorder(Color.accentColor, lineWidth: 1.5))
            .frame(width: 10, height: 10)
            .opacity(visible ? 1 : 0)
    }

    private var draftOverlay: some View {
        Rectangle()
            .fill(Color.black.opacity(0.8))
            .border(Color.accentColor, width: 1)
            .frame(width: max(draft.width, 1), height: max(draft.height, 1))
            .position(x: draft.midX, y: draft.midY)
            .allowsHitTesting(false)
    }

    private var bottomBar: some View {
        VStack(spacing: 0) {
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("拖框涂黑；点选后 Delete 删框、拖动调框")
                        .font(.caption).foregroundStyle(.secondary)
                    if let notice {
                        Text(notice).font(.caption).foregroundStyle(Color.accentColor).lineLimit(1)
                    }
                }
                Spacer()
                Button("跳过此项") { advance(notice: "已跳过") }
                    .buttonStyle(ShelfGlassButtonStyle())
                    .disabled(processing)
                Button("替换原文件") { export(.replace) }
                    .buttonStyle(ShelfGlassButtonStyle())
                    .disabled(processing || boxes.isEmpty)
                Button("导出副本") { export(.copy) }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .disabled(processing || boxes.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(14)
        }
    }

    // MARK: 汇总页

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ShelfIcon(outcomes.contains { !$0.succeeded } ? .warning : .success, size: 18)
                    .foregroundStyle(outcomes.contains { !$0.succeeded } ? Color.red : Color.accentColor)
                Text("涂黑处理完成，共 \(outcomes.count) 张").font(.system(size: 15, weight: .semibold))
            }
            if outcomes.isEmpty {
                Text("没有处理任何文件。").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(outcomes.enumerated()), id: \.offset) { _, outcome in
                HStack(alignment: .top, spacing: 6) {
                    ShelfIcon(outcome.succeeded ? .success : .warning, size: 12)
                        .foregroundStyle(outcome.succeeded ? Color.green : Color.red)
                    Text("\(outcome.source.lastPathComponent)：\(outcome.message)")
                        .font(.caption).lineLimit(2)
                }
            }
            Spacer()
            HStack {
                Text("导出的副本在原文件所在文件夹；替换会剥掉原文件的元数据。")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("完成") { finishIfPending() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }

    // MARK: 行为

    private func loadImage(at index: Int) async {
        let source = sources[index]
        let loaded = await Task.detached(priority: .userInitiated) { NSImage(contentsOf: source) }.value
        guard index == self.index else { return }
        image = loaded
        boxes = []
        selection = nil
        notice = nil
    }

    private func handleDrag(_ value: DragGesture.Value, in content: CGRect) {
        guard !processing, image != nil else { return }
        if drag == nil {
            let location = value.startLocation
            if let hit = ShelfRedaction.grab(at: location, boxes: boxes, in: content) {
                selection = boxes[hit.index].id
                switch hit.grab {
                case .body: drag = .move(index: hit.index, previous: location)
                case .corner(let corner): drag = .resize(index: hit.index, corner: corner)
                }
            } else {
                selection = nil
                drag = .create(location)
                draft = CGRect(origin: location, size: .zero)
                draftContent = content
            }
        }
        switch drag {
        case .create(let start):
            let canvas = CGRect(origin: .zero, size: content.size)
            draft = CGRect(x: min(start.x, value.location.x), y: min(start.y, value.location.y),
                           width: abs(value.location.x - start.x), height: abs(value.location.y - start.y))
                .intersection(canvas)
            if draft.isNull { draft = .zero }
        case .move(let index, let previous):
            guard boxes.indices.contains(index) else { return }
            let dx = (value.location.x - previous.x) / content.width
            let dy = (value.location.y - previous.y) / content.height
            boxes[index] = ShelfRedaction.move(boxes[index], byDX: dx, byDY: dy)
            drag = .move(index: index, previous: value.location)
        case .resize(let index, let corner):
            guard boxes.indices.contains(index) else { return }
            boxes[index] = ShelfRedaction.resize(boxes[index], corner: corner, to: value.location, in: content)
        case nil: break
        }
    }

    private func endDrag() {
        defer { drag = nil; draft = .zero }
        guard case .create = drag else { return }
        // 画框落定：归一化到内容区，够大才算一个涂黑框并选中它；太小视为点选（丢弃）。
        let content = draftContent
        guard content.width > 0, content.height > 0 else { return }
        let box = RedactionBox(x: draft.minX / content.width, y: draft.minY / content.height,
                               w: draft.width / content.width, h: draft.height / content.height)
        guard box.isUsable else { return }
        boxes.append(box)
        selection = box.id
    }

    private func deleteSelected() {
        guard index < sources.count, selection != nil else { return }
        boxes = ShelfRedaction.deleted(boxes, selection: selection)
        selection = nil
    }

    private func export(_ mode: ShelfRedaction.ExportMode) {
        guard index < sources.count, !processing, !boxes.isEmpty else { return }
        let source = sources[index]
        let current = boxes
        processing = true
        notice = nil
        Task.detached(priority: .userInitiated) {
            let outcome: ActionOutcome
            do {
                let output = try ShelfRedaction.export(original: source, boxes: current, mode: mode)
                outcome = ActionOutcome(source: source, output: output, succeeded: true,
                                        message: mode == .copy ? "已导出涂黑副本" : "已替换原文件")
            } catch {
                outcome = ActionOutcome(source: source, succeeded: false, message: error.localizedDescription)
            }
            await MainActor.run {
                outcomes.append(outcome)
                apply(outcome)
                processing = false
                advance(notice: outcome.succeeded ? outcome.message : outcome.message)
            }
        }
    }

    private func advance(notice: String?) {
        boxes = []
        selection = nil
        drag = nil
        draft = .zero
        self.notice = notice
        index += 1
    }

    /// finish 只发一次：完成按钮、或用户直接关窗（windowWillClose）。
    func finishIfPending() {
        guard !finished else { return }
        finished = true
        finish()
    }
}
