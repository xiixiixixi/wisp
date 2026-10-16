import AppKit
import SwiftUI
import ShelfCore

@MainActor
final class ShelfActivity: ObservableObject {
    @Published var busy: Set<UUID> = []
    @Published var numbers: [UUID: Int] = [:]
    @Published var progress: [UUID: String] = [:]
    @Published var retryRequests: [UUID: ActionRequest] = [:]
    @Published var uploads: [UUID: ShelfUploadController] = [:]
    @Published var currentShelfID: UUID?
}

/// #48：完成卡片上的一个操作按钮（标题+符号+闭包）。
struct ShelfCompletionAction: Identifiable {
    let id = UUID()
    let title: String
    let symbol: String
    let handler: () -> Void
}

@MainActor
final class ShelfCompletionWindow {
    private var panel: NSPanel?
    private var dismissal: DispatchWorkItem?

    func show(below shelf: NSWindow, title: String, message: String, outputs: [URL],
              actions: [ShelfCompletionAction] = []) {
        dismiss()
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 84),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.contentView = NSHostingView(rootView: CompletionView(title: title, message: message,
            outputs: outputs, actions: actions, dismiss: { [weak self] in self?.dismiss() }))
        let visible = (shelf.screen ?? NSScreen.main)?.visibleFrame ?? shelf.frame
        let x = min(max(shelf.frame.midX - 180, visible.minX), visible.maxX - 360)
        let below = shelf.frame.minY - 92
        let y = below >= visible.minY ? below : min(shelf.frame.maxY + 8, visible.maxY - 84)
        panel.setFrameOrigin(NSPoint(x: x, y: y))
        self.panel = panel
        let animated = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if animated { panel.alphaValue = 0 }
        panel.orderFrontRegardless()
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                panel.animator().alphaValue = 1
            }
        }
        let dismissal = DispatchWorkItem { [weak self] in self?.dismiss() }
        self.dismissal = dismissal
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: dismissal)
    }

    func dismiss() {
        dismissal?.cancel()
        dismissal = nil
        panel?.contentView = nil
        panel?.close()
        panel = nil
    }
}

private struct CompletionView: View {
    let title: String
    let message: String
    let outputs: [URL]
    let actions: [ShelfCompletionAction]
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            ShelfIcon(.info, size: 20)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                // #46：文案区可选中——OCR 等结果提示里的文字能直接抹选复制。
                Text(message).font(.system(size: 12)).foregroundStyle(.secondary)
                    .lineLimit(2).textSelection(.enabled)
            }
            Spacer(minLength: 0)
            // #48：输出相关的对应操作（进新架/替换条目），加上既有的「显示结果」。
            ForEach(actions) { action in
                Button(action: action.handler) { ShelfIcon(named: action.symbol, size: 12) }
                    .buttonStyle(ShelfQuietIconStyle(size: 28))
                    .help(action.title).accessibilityLabel(action.title)
            }
            if !outputs.isEmpty {
                Button { NSWorkspace.shared.activateFileViewerSelecting(outputs) } label: {
                    ShelfIcon(.reveal, size: 12)
                }
                .buttonStyle(ShelfQuietIconStyle(size: 28))
                .help("显示生成结果").accessibilityLabel("显示生成结果")
            }
            Button(action: dismiss) { ShelfIcon(.close, size: 10) }
                .buttonStyle(ShelfQuietIconStyle(size: 24))
                .help("关闭结果提示").accessibilityLabel("关闭结果提示")
        }
        .padding(12)
        .frame(width: 360, height: 84)
        .background(ShelfGlassBackground(material: .hudWindow))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
