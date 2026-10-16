import AppKit
import ShelfCore
import SwiftUI

enum ShelfSymbol: String, CaseIterable {
    case add = "plus"
    case remove = "minus"
    case close = "xmark"
    case more = "ellipsis"
    case edit = "pencil"
    case rename = "character.cursor.ibeam"
    case pin = "pin"
    case pinned = "pin.fill"
    case settings = "gearshape"
    case preview = "eye"
    case reveal = "arrowshape.turn.up.right"
    case list = "list.bullet"
    case grid = "square.grid.2x2"
    case collapse = "chevron.up"
    case expand = "chevron.down"
    case dock = "sidebar.left"
    case shelf = "square.stack.3d.up"
    case newShelf = "rectangle.stack.badge.plus"
    case share = "square.and.arrow.up"
    case cloud = "cloud"
    case link = "link"
    case script = "terminal"
    case run = "play"
    case stop = "stop"
    case retry = "arrow.clockwise"
    case success = "checkmark"
    case warning = "exclamationmark.triangle"
    case info = "info.circle"
    case search = "magnifyingglass"
    case returnKey = "return"
    case folder = "folder"
    case application = "app"
    case open = "arrow.up.forward.app"
    case copy = "doc.on.doc"
    case move = "folder.badge.plus"
    case archive = "doc.zipper"
    case copyPaths = "doc.on.clipboard"
    case text = "doc.text"
    case photo = "photo"
    case trash = "trash"
    // macOS does not expose an `airdrop` SF Symbol. Use Apple's native
    // rings-and-triangle glyph everywhere instead of a hand-drawn substitute.
    case airdrop = "airplay.audio"
    case mail = "envelope"
    case messages = "message"
    case notes = "note.text"
    case followOutput = "arrow.down.to.line"
    case activation = "cursorarrow.rays"
    case interaction = "hand.draw"
    case customActions = "hammer"
    case instantAction = "bolt"
    case watching = "folder.badge.gearshape"
    case keyboard = "keyboard"
}

enum ShelfSymbols {
    static let toolSize: CGFloat = 13
    static let compactSize: CGFloat = 11
    static let menuSize: CGFloat = 14

    static func name(_ symbol: ShelfSymbol) -> String { name(symbol.rawValue) }

    static func name(_ requested: String) -> String {
        let preferred = aliases[requested] ?? requested
        let candidates = [preferred] + (fallbacks[preferred] ?? []) + ["questionmark"]
        return candidates.first { NSImage(systemSymbolName: $0, accessibilityDescription: nil) != nil } ?? "questionmark"
    }

    static func action(_ kind: ActionKind) -> String {
        let symbol: String
        switch kind {
        case .copy: symbol = ShelfSymbol.copy.rawValue
        case .move: symbol = ShelfSymbol.move.rawValue
        case .archive: symbol = ShelfSymbol.archive.rawValue
        case .openApp: symbol = ShelfSymbol.open.rawValue
        case .rename: symbol = ShelfSymbol.rename.rawValue
        case .resizeImages: symbol = "arrow.up.left.and.arrow.down.right"
        case .compressImages: symbol = "arrow.down.right.and.arrow.up.left"
        case .convertImages: symbol = "photo.on.rectangle.angled"
        case .imagePDF: symbol = "doc.text.image"
        case .extractText: symbol = "text.viewfinder"
        case .stitchImages: symbol = "rectangle.split.1x2"
        case .mergePDFs: symbol = "doc.badge.plus"
        case .protectPDF: symbol = "lock.doc"
        case .desktopPicture: symbol = "menubar.dock.rectangle"
        }
        return name(symbol)
    }

    static func image(_ symbol: ShelfSymbol, pointSize: CGFloat = menuSize,
                      accessibilityDescription: String? = nil) -> NSImage? {
        image(named: symbol.rawValue, pointSize: pointSize, accessibilityDescription: accessibilityDescription)
    }

    static func image(named requested: String, pointSize: CGFloat = menuSize,
                      accessibilityDescription: String? = nil) -> NSImage? {
        image(named: requested, pointSize: pointSize, weight: .regular, accessibilityDescription: accessibilityDescription)
    }

    /// 操作图标保持系统字形和常规粗细；紧凑按钮可由调用方指定粗细。
    static func image(named requested: String, pointSize: CGFloat, weight: NSFont.Weight,
                      accessibilityDescription: String? = nil) -> NSImage? {
        guard let image = NSImage(systemSymbolName: name(requested), accessibilityDescription: accessibilityDescription) else { return nil }
        let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight, scale: .medium)
        let configured = image.withSymbolConfiguration(configuration) ?? image
        configured.isTemplate = true
        return configured
    }

    /// 原生控件使用原始模板图；自行绘制时显式把颜色合成到字形遮罩。
    /// `NSColor.set()` 本身不会替 `NSImage.draw` 的模板图染色。
    static func tinted(_ image: NSImage, color: NSColor) -> NSImage {
        guard image.isTemplate else { return image }
        // 先解析当前外观的动态颜色，避免把动态颜色交给符号调色配置。
        let ink = color.usingColorSpace(.deviceRGB) ?? color
        let rendered = NSImage(size: image.size, flipped: false) { bounds in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.saveGState()
            image.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1,
                       respectFlipped: false, hints: nil)
            // Source-atop（源覆盖目标）保留字形透明度，不会给透明边缘添底色。
            context.setBlendMode(.sourceAtop)
            context.setFillColor(ink.cgColor)
            context.fill(bounds)
            context.restoreGState()
            return true
        }
        rendered.isTemplate = false
        return rendered
    }

    // Tool chrome is unframed; status and toggle states retain their own semantics.
    private static let aliases: [String: String] = [
        "minus.circle": ShelfSymbol.remove.rawValue,
        "xmark.circle": ShelfSymbol.close.rawValue,
        "ellipsis.circle": ShelfSymbol.more.rawValue,
        "bolt.circle.fill": ShelfSymbol.instantAction.rawValue,
        "person.crop.circle": ShelfSymbol.customActions.rawValue,
        "square.stack.3d.up.fill": ShelfSymbol.shelf.rawValue,
        "cloud.fill": ShelfSymbol.cloud.rawValue,
        "stop.fill": ShelfSymbol.stop.rawValue,
        "play.fill": ShelfSymbol.run.rawValue,
        "airdrop": ShelfSymbol.airdrop.rawValue,
    ]

    private static let fallbacks: [String: [String]] = [
        "airplay.audio": ["antenna.radiowaves.left.and.right", "square.and.arrow.up"],
        "folder.badge.gearshape": ["folder"],
        "folder.badge.plus": ["folder"],
        "rectangle.stack.badge.plus": ["square.stack.3d.up", "plus"],
        "character.cursor.ibeam": ["pencil"],
        "sidebar.left": ["rectangle.leadinghalf.inset.filled", "rectangle"],
        "photo.on.rectangle.angled": ["photo.on.rectangle", "photo"],
        "doc.text.image": ["doc.richtext", "doc.text"],
        "text.viewfinder": ["viewfinder", "doc.text"],
        "cursorarrow.rays": ["cursorarrow"],
        "hand.draw": ["hand.point.up", "cursorarrow"],
    ]
}

struct ShelfIcon: View {
    private let name: String
    private let size: CGFloat
    /// 普通操作使用常规粗细；紧凑按钮可以显式传入中等粗细。
    private let weight: Font.Weight

    init(_ symbol: ShelfSymbol, size: CGFloat = ShelfSymbols.toolSize, weight: Font.Weight = .regular) {
        name = ShelfSymbols.name(symbol)
        self.size = size
        self.weight = weight
    }

    init(named symbol: String, size: CGFloat = ShelfSymbols.toolSize, weight: Font.Weight = .regular) {
        name = ShelfSymbols.name(symbol)
        self.size = size
        self.weight = weight
    }

    var body: some View {
        Image(systemName: name)
            .symbolRenderingMode(.monochrome)
            .font(.system(size: size, weight: weight))
            .imageScale(.medium)
            .accessibilityHidden(true)
    }
}
