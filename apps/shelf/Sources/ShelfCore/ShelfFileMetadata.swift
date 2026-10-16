import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct ShelfFileMetadata: Equatable, Sendable {
    public var byteCount: Int64?
    public var pixelWidth: Int?
    public var pixelHeight: Int?
    public var isDirectory: Bool

    public var compactDescription: String {
        if isDirectory { return "文件夹" }
        var components: [String] = []
        if let byteCount { components.append(ByteCountFormatter.string(fromByteCount: byteCount, countStyle: .file)) }
        if let pixelWidth, let pixelHeight { components.append("\(pixelWidth)×\(pixelHeight)") }
        return components.joined(separator: " · ")
    }
}

public enum ShelfFileMetadataReader {
    public static func read(_ url: URL) -> ShelfFileMetadata? {
        guard url.isFileURL,
              let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey, .contentTypeKey]) else { return nil }
        let isDirectory = values.isDirectory == true
        var result = ShelfFileMetadata(byteCount: isDirectory ? nil : values.fileSize.map(Int64.init),
                                       pixelWidth: nil, pixelHeight: nil, isDirectory: isDirectory)
        guard !isDirectory,
              (values.contentType ?? UTType(filenameExtension: url.pathExtension))?.conforms(to: .image) == true,
              let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) as? [CFString: Any],
              let width = dimension(properties[kCGImagePropertyPixelWidth]),
              let height = dimension(properties[kCGImagePropertyPixelHeight]) else { return result }
        // Reading dimensions must not decode an unbounded pixel surface.
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        result.pixelWidth = (5...8).contains(orientation) ? height : width
        result.pixelHeight = (5...8).contains(orientation) ? width : height
        return result
    }

    private static func dimension(_ value: Any?) -> Int? {
        guard let value = value as? NSNumber else { return nil }
        let number = value.doubleValue
        guard number.isFinite, number > 0, number < Double(Int.max), number.rounded(.towardZero) == number else { return nil }
        return Int(number)
    }
}
