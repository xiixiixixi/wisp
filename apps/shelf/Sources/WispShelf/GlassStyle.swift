import AppKit
import SwiftUI

enum ShelfGlassPalette {
    static let secondaryLabel = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.74)
            : NSColor.black.withAlphaComponent(0.68)
    }
    static let secondaryText = Color(nsColor: secondaryLabel)
    // 竞品的数量胶囊文字实测峰值 lum 255 = 纯白，不是 secondaryLabel 的 74% 白。
    // 这个胶囊是面板上唯一的文字主信息，压到 74% 会和图标按钮糊在一起。
    static let countText = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white
            : NSColor.black
    })
    static let separator = Color(nsColor: .separatorColor).opacity(0.55)
    static let canvas = Color(nsColor: .textBackgroundColor).opacity(0.72)
    static let controlFill = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.08)
            : NSColor.white.withAlphaComponent(0.62)
    })
    static let controlStroke = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.15)
            : NSColor.black.withAlphaComponent(0.10)
    })
}

struct ShelfQuietIconStyle: ButtonStyle {
    var size: CGFloat = 26
    var active = false
    func makeBody(configuration: Configuration) -> some View {
        QuietIconSurface(configuration: configuration, size: size, active: active)
    }
}

private struct QuietIconSurface: View {
    let configuration: ButtonStyleConfiguration
    let size: CGFloat
    let active: Bool
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    var body: some View {
        configuration.label
            .foregroundStyle(active ? Color.accentColor : hovering || focused ? Color.primary : ShelfGlassPalette.secondaryText)
            .frame(width: size, height: size)
            .background(Color.primary.opacity(configuration.isPressed ? 0.12 : hovering ? 0.06 : 0), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 2))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(enabled ? 1 : 0.4)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

struct ShelfPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { PrimaryButtonSurface(configuration: configuration) }
}

private struct PrimaryButtonSurface: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    var body: some View {
        configuration.label.font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 12).frame(height: 30)
            .foregroundStyle(Color.white)
            .background(Color.accentColor.opacity(enabled ? (configuration.isPressed ? 0.78 : 1) : 0.4), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(focused ? Color.primary : .clear, lineWidth: 2))
            .brightness(hovering && enabled ? 0.04 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

struct ShelfCountButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        CountButtonSurface(configuration: configuration)
    }
}

private struct CountButtonSurface: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(hovering || focused ? Color.primary : ShelfGlassPalette.secondaryText)
            .padding(.horizontal, 10).frame(minWidth: 44, minHeight: 30)
            .background {
                Capsule().fill(ShelfGlassPalette.controlFill)
                    .overlay(Capsule().fill(Color.primary.opacity(configuration.isPressed ? 0.12 : hovering ? 0.05 : 0)))
                    .overlay(Capsule().strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 2))
                    .frame(height: 24)
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(enabled ? 1 : 0.4)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

struct ShelfMenuGlyph: View {
    var name: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        ShelfIcon(named: name, size: 13)
            .foregroundStyle(hovering ? Color.primary : ShelfGlassPalette.secondaryText)
            .frame(width: 26, height: 26)
            .background(Color.primary.opacity(hovering ? 0.06 : 0.001), in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
    }
}

// 参考应用实测（同一把尺子、同一张截图）：
//   按钮圆盘 lum 60，压在 lum 43 的面板底上 → 白 8%；里面的 ✕ / ⌄ 峰值 lum 250 → 白 92%。
//   也就是"暗圆底 + 亮字"。我原先写成白 58% 圆底 + 黑 72% 字，是把明暗关系整个
//   反过来了：架子上会并排两坨刺眼的白圆，看着像常亮的选中态，而不是安静的图标按钮。
enum ShelfReferenceControlPalette {
    /// 同一组数值的 NSColor 版本，给不走 SwiftUI 的控件用。
    ///
    /// `ShelfMenuButtonView`（⌄ 按钮）必须用这一份：它自己 `draw()` 画圆盘，
    /// **不能写死白色**——浅色外观下面板底本身就是白的，白 12% 的圆等于看不见，
    /// 于是「⌄ 没有圆圈」。写死过一次，白色面板上肉眼就是一个裸的箭头。
    static var roundFillNS: NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor.white.withAlphaComponent(0.12)
                : NSColor.black.withAlphaComponent(0.07)
        }
    }
    static var roundHoverNS: NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor.white.withAlphaComponent(0.16)
                : NSColor.black.withAlphaComponent(0.07)
        }
    }
    static var roundInkNS: NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor.white.withAlphaComponent(0.92)
                : NSColor.black.withAlphaComponent(0.82)
        }
    }

    static let roundFill = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            // 面板底压到 lum 22 后重测：竞品 ✕ 圆盘 lum 50 → 白 12.0%
            ? NSColor.white.withAlphaComponent(0.12)
            : NSColor.black.withAlphaComponent(0.07)
    })
    static let roundInk = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.92)
            : NSColor.black.withAlphaComponent(0.82)
    })
    static let roundHover = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.16)
            : NSColor.black.withAlphaComponent(0.07)
    })
    static let countFill = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            // 竞品胶囊底 lum 48，压在 lum 22 的面板上 → 白 11.2%
            ? NSColor.white.withAlphaComponent(0.11)
            : NSColor.black.withAlphaComponent(0.07)
    })
}

struct ShelfRoundIconStyle: ButtonStyle {
    var size: CGFloat = 24

    func makeBody(configuration: Configuration) -> some View {
        ShelfRoundIconSurface(configuration: configuration, size: size)
    }
}

private struct ShelfRoundIconSurface: View {
    let configuration: ButtonStyleConfiguration
    let size: CGFloat
    @State private var hovering = false

    var body: some View {
        configuration.label
            .modifier(ShelfReferenceRoundChrome(size: size, hovering: hovering, pressed: configuration.isPressed))
            .onHover { hovering = $0 }
    }
}

private struct ShelfReferenceRoundChrome: ViewModifier {
    let size: CGFloat
    let hovering: Bool
    let pressed: Bool
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .font(.system(size: 11, weight: .regular))
            .foregroundStyle(ShelfReferenceControlPalette.roundInk)
            .frame(width: size, height: size)
            .background {
                Circle().fill(ShelfReferenceControlPalette.roundFill)
                    .overlay(Circle().fill(ShelfReferenceControlPalette.roundHover.opacity(pressed ? 0.16 : hovering ? 0.07 : 0)))
            }
            .overlay(Circle().strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 2))
            .contentShape(Circle())
            .opacity(enabled ? 1 : 0.38)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: pressed)
    }
}

struct ShelfRoundMenuGlyph: View {
    var name: String = "ellipsis"
    var size: CGFloat = 24
    var symbolSize: CGFloat = 11
    var active = false
    @State private var hovering = false

    var body: some View {
        ShelfIcon(named: name, size: symbolSize)
            .modifier(ShelfReferenceRoundChrome(size: size, hovering: hovering, pressed: active))
            .onHover { hovering = $0 }
    }
}

struct ShelfRoundMenuSurface: ViewModifier {
    var size: CGFloat = 24
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .modifier(ShelfReferenceRoundChrome(size: size, hovering: hovering, pressed: false))
            .onHover { hovering = $0 }
    }
}

struct ShelfRoundMenuImage: View {
    var name: String
    var size: CGFloat = 11

    var body: some View {
        // ⌄ 的颜色跟着圆盘里的图标一起走：深色下是亮字（参考应用实测峰值 lum 250），
        // 之前写死黑色 0.72，在"暗圆底+亮字"的配色下会变成圆盘里一个黑洞。
        if let image = ShelfSymbols.image(named: name, pointSize: size)?
            .withSymbolConfiguration(.init(paletteColors: [ShelfRoundMenuImage.ink])) {
            Image(nsImage: image).renderingMode(.original)
                .resizable().scaledToFit().frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }

    private static let ink = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor.white.withAlphaComponent(0.92)
            : NSColor.black.withAlphaComponent(0.82)
    }
}

struct ShelfReferenceCountStyle: ButtonStyle {
    var height: CGFloat = 24

    func makeBody(configuration: Configuration) -> some View {
        ShelfReferenceCountSurface(configuration: configuration, height: height)
    }
}

private struct ShelfReferenceCountSurface: View {
    let configuration: ButtonStyleConfiguration
    let height: CGFloat
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(ShelfGlassPalette.countText)
            .padding(.horizontal, 9)
            .frame(minWidth: 44).frame(height: height)
            .background {
                Capsule().fill(ShelfReferenceControlPalette.countFill)
                    .overlay(Capsule().fill(Color.primary.opacity(enabled ? (configuration.isPressed ? 0.12 : hovering ? 0.05 : 0) : 0)))
            }
            .overlay(Capsule().strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 2))
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.38)
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

struct ShelfGlassBackground: View {
    var material: NSVisualEffectView.Material = .popover
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Group {
            if reduceTransparency {
                Color(nsColor: .windowBackgroundColor)
            } else {
                NativeShelfMaterial(material: material)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct ShelfWindowGlass: View {
    // 新的完整参考截图显示背景会透入架子；黑色桌面上的低亮度不能证明架子不透明。
    // 使用系统浮动工具窗材质，避免把一张截图的黑色硬写成所有场景的底色。
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)

    var body: some View {
        Group {
            if !reduceTransparency {
                NativeShelfMaterial(material: .hudWindow)
                    .clipShape(shape)
                shape.stroke(Color.white.opacity(0.08), lineWidth: 0.5)
            } else {
                shape.fill(Color(nsColor: .windowBackgroundColor))
            }
        }
        .allowsHitTesting(false).accessibilityHidden(true)
    }

}

struct ShelfCountMenuSurface: ViewModifier {
    @State private var hovering = false
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.font(.system(size: 11, weight: .medium))
            .foregroundStyle(ShelfGlassPalette.countText)
            // 参考应用的胶囊实测高 28pt（不是我原先设的 24pt）。它比文字只多一圈
            // 上下留白，看起来更"坐得住"，底部也因此离面板底只剩 11pt。
            .padding(.horizontal, 5).frame(height: 28)
            .background(Capsule().fill(ShelfReferenceControlPalette.countFill)
                .overlay(Capsule().fill(Color.primary.opacity(hovering ? 0.05 : 0))))
            .overlay(Capsule().strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 2))
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
    }
}

private struct NativeShelfMaterial: NSViewRepresentable {
    let material: NSVisualEffectView.Material

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.blendingMode = .behindWindow
        view.state = .active
        view.material = material
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
    }
}

struct ShelfGlassIconButtonStyle: ButtonStyle {
    var size: CGFloat = 28
    func makeBody(configuration: Configuration) -> some View {
        GlassButtonSurface(configuration: configuration, size: size, prominent: false, iconOnly: true)
    }
}

struct ShelfGlassControlBackground: View {
    var prominent = false
    var radius: CGFloat = 8
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        if #available(macOS 26.0, *), !reduceTransparency {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(prominent ? Color.accentColor : Color.clear)
                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(prominent ? Color.accentColor : ShelfGlassPalette.controlFill)
        }
    }
}

struct ShelfGlassButtonStyle: ButtonStyle {
    var prominent = false
    func makeBody(configuration: Configuration) -> some View {
        GlassButtonSurface(configuration: configuration, size: 30, prominent: prominent, iconOnly: false)
    }
}

private struct GlassButtonSurface: View {
    let configuration: ButtonStyleConfiguration
    let size: CGFloat
    let prominent: Bool
    let iconOnly: Bool
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var hovering = false

    var body: some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .padding(.horizontal, iconOnly ? 0 : 12)
            .frame(width: iconOnly ? size : nil, height: size)
            .background {
                ShelfGlassControlBackground(prominent: prominent)
                    .overlay {
                        if configuration.isPressed || hovering {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.primary.opacity(configuration.isPressed ? 0.12 : 0.04))
                        }
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(focused ? Color.accentColor : ShelfGlassPalette.controlStroke,
                                  lineWidth: focused || contrast == .increased ? 2 : 0.75)
            }
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .onHover { hovering = $0 }
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
            .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

struct ShelfGlassFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.textFieldStyle(.plain).modifier(GlassFieldSurface())
    }
}

private struct GlassFieldSurface: ViewModifier {
    @FocusState private var focused: Bool
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .font(.system(size: 12))
            .padding(.horizontal, 9).padding(.vertical, 7)
            .focused($focused)
            .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(focused ? Color.accentColor : ShelfGlassPalette.controlStroke,
                                  lineWidth: focused || contrast == .increased ? 2 : 0.75)
                    .allowsHitTesting(false)
            }
    }
}
