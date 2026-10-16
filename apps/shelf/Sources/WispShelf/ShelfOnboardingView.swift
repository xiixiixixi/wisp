import AppKit
import Combine
import ShelfCore
import SwiftUI

/// #84：三页交互式快速上手。核心是第一页的「晃动试玩」——晃动是唯一一件
/// 文字教不会的事，所以页面直接等真实拖动激活信号（ActivationMonitor →
/// ShelfDragActivated 通知）落地，检测到了才打勾；其余两页是收尾说明。
/// 不做视频；「不再显示」持久化到 settings.onboardingCompleted。
struct ShelfOnboardingView: View {
    @ObservedObject var store: ShelfStore
    let onFinish: () -> Void
    @State private var page = 0
    @State private var shakeDetected = false
    @State private var dropDetected = false
    // 完成即默认「不再显示」；想保留提醒可以手动取消勾选。
    @State private var dismissForGood = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: ShelfStore, onFinish: @escaping () -> Void = {}) {
        self.store = store
        self.onFinish = onFinish
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TabView(selection: $page) {
                shakePage.tag(0)
                dropPage.tag(1)
                collapsePage.tag(2)
            }
            .tabViewStyle(.automatic)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: page)
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 1)
            HStack {
                Text("第 \(page + 1) 步，共 3 步").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("跳过引导") { finish() }
                    .buttonStyle(ShelfGlassButtonStyle())
                if page < 2 {
                    Button(page == 0 && !shakeDetected ? "下一步" : "继续") { withAnimation { page += 1 } }
                        .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                        .keyboardShortcut(.defaultAction)
                } else {
                    Button("完成") { finish() }
                        .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                        .keyboardShortcut(.defaultAction)
                }
            }
            .padding(16)
        }
        .frame(width: 460, height: 420)
        .background(ShelfGlassPalette.canvas)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragActivated"))) { _ in
            // 拖动中晃动/按修饰键真的点亮了架子——第一页的试玩就算过关。
            if page == 0 { shakeDetected = true }
        }
        .onReceive(store.$shelves) { shelves in
            if shelves.contains(where: { !$0.items.isEmpty }) { dropDetected = true }
        }
    }

    private func finish() {
        if dismissForGood {
            store.settings.onboardingCompleted = true
            store.persist()
        }
        onFinish()
    }

    private func stepBadge(_ done: Bool) -> some View {
        ShelfIcon(done ? .success : .info, size: 13)
            .foregroundStyle(done ? Color.green : Color.secondary)
    }

    private var shakePage: some View {
        guidePage(title: "① 晃动试玩", symbol: ShelfSymbols.name(.activation)) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    stepBadge(shakeDetected)
                    Text(shakeDetected ? "已检测到晃动——架子亮出来了！" : "等待你真的晃一次…")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(shakeDetected ? Color.green : Color.secondary)
                }
                Text("1. 在访达或桌面按住任意文件开始拖动。\n2. 按住不放，在屏幕上快速左右晃动几次。\n3. 松手前收集架就会在光标旁亮出来——把文件放进去即可。")
                Text("也可以在拖动时按住修饰键（默认 Shift）激活；灵敏度可在「窗口激活」设置里调整。")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private var dropPage: some View {
        guidePage(title: "② 投放完成", symbol: ShelfSymbols.name(.shelf)) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    stepBadge(dropDetected)
                    Text(dropDetected ? "已收到内容，架子里有了第一件东西。" : "等待第一次投放…")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(dropDetected ? Color.green : Color.secondary)
                }
                Text("放入的文件原地不动，架子上只是收集引用。展开内容面板可以多选、预览，或从 ⌄ 菜单对整批执行操作（复制、压缩、改名…）。")
                Text("不放文件也可以：菜单栏「从剪贴板创建」直接收集剪贴板里的文字、图片或链接。")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private var collapsePage: some View {
        guidePage(title: "③ 收起与找回", symbol: ShelfSymbols.name(.collapse)) {
            VStack(alignment: .leading, spacing: 12) {
                Text("点架子左上角的 ✕ 是「收起」：内容、位置都保留，随时从菜单栏图标里重新打开；按住 Option 点 ✕ 才会清空内容。")
                Text("收起后去哪里找回：菜单栏收集架图标 → 「所有架子」列表，点名字即恢复；管理页 wisp://shelves 还能总览全部架子。")
                    .font(.callout).foregroundStyle(.secondary)
                Divider()
                Toggle("不再显示快速上手（之后可从设置页顶部重新打开）", isOn: $dismissForGood)
                    .toggleStyle(.checkbox)
            }
        }
    }

    private func guidePage<Body: View>(title: String, symbol: String, @ViewBuilder content: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                ShelfIcon(named: symbol, size: 20).foregroundStyle(Color.accentColor)
                Text(title).font(.system(size: 16, weight: .semibold))
            }
            content()
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
