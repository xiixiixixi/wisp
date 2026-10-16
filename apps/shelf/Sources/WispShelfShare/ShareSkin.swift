import AppKit
import SwiftUI

/// #25：appex 简化玻璃皮肤。只取 Wisp 收集架玻璃风的三件事——
/// 毛玻璃底、次级文字随明暗、主按钮走强调色；圆角/尺寸按系统分享面板的习惯收敛。
/// 独立于 WispShelf 的 GlassStyle（不链接 ShelfCore/WispShelf，appex 启动最小化）。
enum ShareSkin {
    static let secondaryText = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.72)
            : NSColor.black.withAlphaComponent(0.66)
    })
    static let separator = Color(nsColor: .separatorColor).opacity(0.55)
    static let rowFill = Color.primary.opacity(0.045)
    static let capsuleFill = Color.primary.opacity(0.06)
}

struct ShareGlassBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Group {
            if reduceTransparency {
                Color(nsColor: .windowBackgroundColor)
            } else {
                NativeShareMaterial()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct NativeShareMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.blendingMode = .behindWindow
        view.state = .active
        view.material = .popover
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

struct SharePrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 14).frame(height: 30)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.accentColor.opacity(enabled ? (configuration.isPressed ? 0.78 : 1) : 0.4))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .onHover { hovering = $0 }
            .brightness(hovering && enabled ? 0.04 : 0)
    }
}

struct ShareSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.primary.opacity(enabled ? 1 : 0.45))
            .padding(.horizontal, 12).frame(height: 30)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.1 : 0.05))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}
