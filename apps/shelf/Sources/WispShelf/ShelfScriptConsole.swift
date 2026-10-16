import AppKit
import SwiftUI
import ShelfCore

@MainActor
final class ShelfScriptSession: ObservableObject {
    let path: String
    let count: Int
    @Published var status = "未执行"
    @Published var output = ""
    @Published var errors = ""
    @Published var busy = false
    private var runID = UUID()
    init(path: String, count: Int) { self.path = path; self.count = count }
    func beginRun() -> UUID {
        runID = UUID()
        busy = true
        status = "正在执行…"
        output = ""
        errors = ""
        return runID
    }
    func receive(_ snapshot: ShelfScriptOutputSnapshot, runID: UUID? = nil) {
        guard busy, runID == nil || runID == self.runID else { return }
        output = snapshot.stdout
        errors = snapshot.stderr
        if snapshot.outputLimitReached { status = "输出达到上限，正在停止…" }
    }
}

@MainActor
final class ShelfScriptConsole {
    let window: NSWindow
    let session: ShelfScriptSession
    init(path: String, count: Int, run: @escaping (Bool) -> Void, cancel: @escaping () -> Void) {
        session = ShelfScriptSession(path: path, count: count)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 420),
                          styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "脚本 · " + URL(fileURLWithPath: path).lastPathComponent
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 420, height: 320)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: ShelfScriptConsoleView(session: session, run: run, cancel: cancel))
        window.center()
    }
    func show() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
}

private struct ShelfScriptConsoleView: View {
    @ObservedObject var session: ShelfScriptSession
    @State private var followOutput = true
    let run: (Bool) -> Void
    let cancel: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 10) {
                    ShelfIcon(.script, size: 18)
                        .frame(width: 34, height: 34)
                        .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(URL(fileURLWithPath: session.path).lastPathComponent)
                            .font(.system(size: 14, weight: .semibold)).lineLimit(1)
                            .help(URL(fileURLWithPath: session.path).lastPathComponent)
                        Text(session.path).font(.system(size: 11)).foregroundStyle(.secondary)
                            .lineLimit(2).textSelection(.enabled).help(session.path)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 8) {
                    if session.busy { ProgressView().controlSize(.small) }
                    else { ShelfIcon(.script, size: ShelfSymbols.compactSize).foregroundStyle(.secondary) }
                    Text(session.status).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button { followOutput.toggle() } label: {
                        ShelfIcon(.followOutput, size: 12)
                            .foregroundStyle(followOutput ? Color.accentColor : Color.secondary)
                    }
                    .buttonStyle(ShelfGlassIconButtonStyle())
                    .help(followOutput ? "暂停跟随最新输出" : "跟随最新输出")
                    .accessibilityLabel("跟随最新输出").accessibilityValue(followOutput ? "开启" : "关闭")
                    Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(session.output, forType: .string) } label: {
                        ShelfIcon(.copy, size: 12)
                    }
                    .buttonStyle(ShelfGlassIconButtonStyle())
                    .help("复制脚本输出").accessibilityLabel("复制脚本输出").disabled(session.output.isEmpty)
                }
            }
            .padding(14)
            .background(ShelfGlassBackground(material: .popover))
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(session.output.isEmpty ? "暂无输出" : session.output)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(session.output.isEmpty ? Color.secondary : Color.primary)
                            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                        if !session.errors.isEmpty {
                            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
                            Label("错误输出", systemImage: ShelfSymbols.name(.warning))
                                .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                            Text(session.errors).font(.system(size: 12, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                        }
                        Color.clear.frame(height: 1).id("output-end")
                    }.padding(14)
                }
                .onChange(of: session.output) { _ in if followOutput { reader.scrollTo("output-end", anchor: .bottom) } }
                .onChange(of: session.errors) { _ in if followOutput { reader.scrollTo("output-end", anchor: .bottom) } }
                .onChange(of: followOutput) { enabled in if enabled { reader.scrollTo("output-end", anchor: .bottom) } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(ShelfGlassPalette.canvas)
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
            HStack(spacing: 8) {
                Button { run(true) } label: { Label("无输入试运行", systemImage: ShelfSymbols.name(.run)) }
                    .buttonStyle(ShelfGlassButtonStyle()).disabled(session.busy)
                Spacer(minLength: 8)
                if session.busy {
                    Button(action: cancel) { Label("停止", systemImage: ShelfSymbols.name(.stop)) }
                        .buttonStyle(ShelfGlassButtonStyle())
                } else {
                    Button { run(false) } label: { Label("执行 \(session.count) 项", systemImage: ShelfSymbols.name(.run)) }
                        .buttonStyle(ShelfGlassButtonStyle(prominent: true)).disabled(session.count == 0)
                }
            }
            .controlSize(.small)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(ShelfGlassBackground(material: .popover))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
