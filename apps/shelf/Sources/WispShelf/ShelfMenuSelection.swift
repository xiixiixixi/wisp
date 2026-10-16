import Foundation
import ShelfCore
import UniformTypeIdentifiers

/// 菜单按当前选择的真实文件类型显示命令，不把图片操作塞给文字或文件夹。
struct ShelfMenuSelection {
    static let uploadProviders: Set<String> = ["custom", "s3", "dropbox", "gdrive", "onedrive", "imgur"]
    let items: [ShelfItem]
    let filesAvailable: Bool
    let allImages: Bool
    let allText: Bool
    let allPDFs: Bool

    init(items: [ShelfItem]) {
        self.items = items
        filesAvailable = !items.isEmpty && items.allSatisfy(\.isAvailable)
        let types = items.map { Self.contentType($0) }
        allImages = !items.isEmpty && types.allSatisfy { $0?.conforms(to: .image) == true }
        allText = !items.isEmpty && types.allSatisfy { $0?.conforms(to: .text) == true }
        allPDFs = !items.isEmpty && types.allSatisfy { $0?.conforms(to: .pdf) == true }
    }

    func supports(_ kind: ActionKind) -> Bool {
        guard !items.isEmpty else { return false }
        switch kind {
        case .copy, .move, .archive, .openApp, .rename: return true
        case .resizeImages, .compressImages, .convertImages, .imagePDF, .extractText: return allImages
        case .stitchImages: return allImages && items.count > 1
        case .mergePDFs: return allPDFs && items.count > 1
        case .protectPDF: return allPDFs
        case .desktopPicture: return allImages
        }
    }

    func supportsUtility(_ command: String) -> Bool {
        guard !items.isEmpty else { return false }
        switch command {
        case "copyPaths", "moveToTrash": return true
        case "copyTextContents": return allText
        // #47：涂黑仅对整批图片开放。
        case "redactImages", "removeImageMetadata": return allImages
        default: return false
        }
    }

    /// 上传只接收普通文件；目录不会自动压缩，图床只接受图片。
    func supportsUpload(_ provider: String) -> Bool {
        guard filesAvailable, Self.uploadProviders.contains(provider.lowercased()) else { return false }
        if provider.lowercased() == "imgur", !allImages { return false }
        return items.allSatisfy {
            let url = $0.resolvedURL
            return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
                && FileManager.default.isReadableFile(atPath: url.path)
        }
    }

    /// 删除键只移出明确选中的条目；清空整架必须走明确的菜单入口。
    static func removalIDs(selection: Set<UUID>, items: [ShelfItem]) -> Set<UUID> {
        selection.intersection(Set(items.map(\.id)))
    }

    private static func contentType(_ item: ShelfItem) -> UTType? {
        let url = item.resolvedURL
        guard url.isFileURL else { return nil }
        let values = try? url.resourceValues(forKeys: [.contentTypeKey, .isDirectoryKey])
        guard values?.isDirectory != true else { return nil }
        return values?.contentType ?? UTType(filenameExtension: url.pathExtension)
    }
}

extension CloudAccount {
    /// 仅检查菜单可见的非秘密配置；凭据仍由上传入口验证，不在菜单中读取钥匙串。
    var shelfMenuConfigurationReady: Bool {
        func usableURL(_ value: String) -> Bool {
            guard let parts = URLComponents(string: value), parts.url != nil,
                  let host = parts.host?.lowercased(), !host.isEmpty,
                  parts.user == nil, parts.password == nil, parts.fragment == nil else { return false }
            let loopbackHost = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            let octets = loopbackHost.split(separator: ".", omittingEmptySubsequences: false)
            let loopback = loopbackHost == "localhost" || loopbackHost == "::1"
                || (octets.count == 4 && octets[0] == "127" && octets.allSatisfy {
                    !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber })
                        && Int($0).map { (0...255).contains($0) } == true
                })
            return parts.scheme?.lowercased() == "https" || (parts.scheme?.lowercased() == "http" && loopback)
        }
        switch provider.lowercased() {
        case "custom": return usableURL(endpoint)
        case "s3":
            return !bucket.isEmpty && !bucket.contains("/") && !region.isEmpty
                && region.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
                && usableURL(publicBaseURL) && URLComponents(string: publicBaseURL)?.query == nil
                && (endpoint.isEmpty || (usableURL(endpoint) && URLComponents(string: endpoint)?.query == nil))
        default: return ShelfMenuSelection.uploadProviders.contains(provider.lowercased())
        }
    }
}
