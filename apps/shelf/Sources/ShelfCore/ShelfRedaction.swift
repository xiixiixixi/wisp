import Foundation
import CoreGraphics
import ImageIO

/// #47：手动涂黑框。坐标归一化到**图片内容区**（0...1，左上原点），与窗口尺寸、
/// 缩放比例无关；渲染时一次性映射回原图像素。几何全部做成纯函数便于单测
/// （框叠加/命中/移动钳制/删框）。
public struct RedactionBox: Equatable, Identifiable {
    public var id: UUID
    /// 归一化 x/y（左上原点，0...1）与宽高。
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    public init(id: UUID = UUID(), x: Double, y: Double, w: Double, h: Double) {
        self.id = id; self.x = x; self.y = y; self.w = w; self.h = h
    }
    /// 小于内容区 1% 的框视为误触，不算有效涂黑。
    public var isUsable: Bool { w >= 0.01 && h >= 0.01 }
}

public enum ShelfRedaction {
    public enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight
        var opposite: Corner {
            switch self {
            case .topLeft: return .bottomRight
            case .topRight: return .bottomLeft
            case .bottomLeft: return .topRight
            case .bottomRight: return .topLeft
            }
        }
    }
    public enum Grab: Equatable { case body, corner(Corner) }

    /// 空白处拖拽 → 归一化框。矩形先夹回内容区，退化为点/线的返回 nil（那是点选，不是画框）。
    public static func box(fromDrag start: CGPoint, to end: CGPoint, in content: CGRect) -> RedactionBox? {
        guard content.width > 0, content.height > 0 else { return nil }
        let dragged = CGRect(x: min(start.x, end.x), y: min(start.y, end.y),
                             width: abs(end.x - start.x), height: abs(end.y - start.y))
        let clamped = dragged.intersection(content)
        guard !clamped.isNull, !clamped.isEmpty else { return nil }
        let box = RedactionBox(x: (clamped.minX - content.minX) / content.width,
                               y: (clamped.minY - content.minY) / content.height,
                               w: clamped.width / content.width,
                               h: clamped.height / content.height)
        return box.isUsable ? box : nil
    }

    /// 归一化框 → 内容区坐标矩形（视图坐标系，左上原点）。
    public static func rect(_ box: RedactionBox, in content: CGRect) -> CGRect {
        CGRect(x: content.minX + box.x * content.width,
               y: content.minY + box.y * content.height,
               width: box.w * content.width,
               height: box.h * content.height)
    }

    static func cornerPoint(_ rect: CGRect, _ corner: Corner) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: rect.minX, y: rect.minY)
        case .topRight: return CGPoint(x: rect.maxX, y: rect.minY)
        case .bottomLeft: return CGPoint(x: rect.minX, y: rect.maxY)
        case .bottomRight: return CGPoint(x: rect.maxX, y: rect.maxY)
        }
    }

    /// 命中测试：先角把手（后画的框在上层），再框身；返回被抓住框的下标与抓法。
    public static func grab(at point: CGPoint, boxes: [RedactionBox], in content: CGRect,
                            handleRadius: CGFloat = 8) -> (index: Int, grab: Grab)? {
        for (index, box) in boxes.enumerated().reversed() {
            let rect = rect(box, in: content)
            for corner in Corner.allCases where
                hypot(point.x - cornerPoint(rect, corner).x, point.y - cornerPoint(rect, corner).y) <= handleRadius {
                return (index, .corner(corner))
            }
        }
        for (index, box) in boxes.enumerated().reversed() where rect(box, in: content).contains(point) {
            return (index, .body)
        }
        return nil
    }

    /// 整框移动，钳制在 0...1 内容区内（不许拖出画面）。
    public static func move(_ box: RedactionBox, byDX dx: Double, byDY dy: Double) -> RedactionBox {
        var moved = box
        moved.x = min(max(0, box.x + dx), 1 - box.w)
        moved.y = min(max(0, box.y + dy), 1 - box.h)
        return moved
    }

    /// 拖角调框：对角为锚点，新框=锚点与光标张成的矩形（夹回内容区，保持可用的最小尺寸）。
    public static func resize(_ box: RedactionBox, corner: Corner, to point: CGPoint, in content: CGRect) -> RedactionBox {
        guard content.width > 0, content.height > 0 else { return box }
        let rect = rect(box, in: content)
        let anchor = cornerPoint(rect, corner.opposite)
        let clampedX = min(max(point.x, content.minX), content.maxX)
        let clampedY = min(max(point.y, content.minY), content.maxY)
        let left = min(anchor.x, clampedX)
        let top = min(anchor.y, clampedY)
        let width = max(abs(clampedX - anchor.x), 0.01 * content.width)
        let height = max(abs(clampedY - anchor.y), 0.01 * content.height)
        // 折叠成零尺寸的框保留 1% 骨架，选中态与后续拖拽不会丢。
        return RedactionBox(id: box.id,
                            x: (left - content.minX) / content.width,
                            y: (top - content.minY) / content.height,
                            w: width / content.width,
                            h: height / content.height)
    }

    /// 删除选中框（纯函数便于单测）。未选中/选不中返回原数组。
    public static func deleted(_ boxes: [RedactionBox], selection: UUID?) -> [RedactionBox] {
        guard let selection else { return boxes }
        return boxes.filter { $0.id != selection }
    }

    /// 黑块覆盖渲染。归一化坐标是左上原点，CGContext 是左下原点，这里翻转一次。
    public static func render(original: CGImage, boxes: [RedactionBox]) throws -> CGImage {
        let width = original.width
        let height = original.height
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw Failure("无法分配图片内存")
        }
        context.interpolationQuality = .high
        context.draw(original, in: CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
        let pixelsW = CGFloat(width)
        let pixelsH = CGFloat(height)
        for box in boxes where box.isUsable {
            let left = box.x * pixelsW
            let top = pixelsH - (box.y + box.h) * pixelsH
            let rect = CGRect(x: left, y: top, width: box.w * pixelsW, height: box.h * pixelsH).integral
            context.fill(rect)
        }
        guard let image = context.makeImage() else { throw Failure("图片生成失败") }
        return image
    }

    public enum ExportMode {
        /// 同目录「原名-redacted」副本；已有同名文件时报错不覆盖（ActionEngine.writeOutput 语义）。
        case copy
        /// 原子替换原文件（先写临时文件，再整体换位；失败时原文件不动）。
        case replace
    }

    /// 落盘：解码复用 ActionEngine.image（含方向校正），发布复用 ActionEngine 的原子写。
    /// 重编码到原扩展名对应格式；顺带剥掉全部 EXIF/GPS 元数据——涂黑本就该这么干。
    public static func export(original source: URL, boxes: [RedactionBox], mode: ExportMode,
                              quality: Double = 0.92) throws -> URL {
        let usable = boxes.filter(\.isUsable)
        guard !usable.isEmpty else { throw Failure("还没有画出有效的涂黑框") }
        let format = try ActionEngine.imageFormat(source.pathExtension.lowercased())
        let rendered = try render(original: try ActionEngine.image(source), boxes: usable)
        switch mode {
        case .copy:
            let stem = source.deletingPathExtension().lastPathComponent
            let output = source.deletingLastPathComponent()
                .appendingPathComponent("\(stem)-redacted.\(format.ext)")
            try ActionEngine.encode(rendered, output: output, format: format.type, quality: quality)
            return output
        case .replace:
            let temporary = source.deletingLastPathComponent()
                .appendingPathComponent(".wisp-shelf-redact-" + UUID().uuidString + "." + format.ext)
            do {
                try ActionEngine.encode(rendered, output: temporary, format: format.type, quality: quality)
                // replaceItemAt 原子换位：观察者要么看到旧文件、要么看到完整新文件。
                _ = try FileManager.default.replaceItemAt(source, withItemAt: temporary)
                return source
            } catch {
                try? FileManager.default.removeItem(at: temporary)
                throw Failure("替换原文件失败：\(error.localizedDescription)")
            }
        }
    }

    private struct Failure: LocalizedError {
        var text: String
        init(_ text: String) { self.text = text }
        var errorDescription: String? { text }
    }
}
