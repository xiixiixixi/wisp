import AppKit
import ShelfCore

final class ShelfFileMetadataCache {
    static let shared = ShelfFileMetadataCache()
    private final class Entry: NSObject {
        let value: ShelfFileMetadata?
        let createdAt = Date()
        init(_ value: ShelfFileMetadata?) { self.value = value }
    }
    private let entries = NSCache<NSURL, Entry>()
    private var waiting: [URL: [(ShelfFileMetadata?) -> Void]] = [:]
    private let queue = DispatchQueue(label: "com.wisp.shelf.file-metadata", qos: .utility)

    private init() { entries.countLimit = 256 }

    func metadata(for url: URL, ready: @escaping (ShelfFileMetadata?) -> Void) -> ShelfFileMetadata? {
        let key = url.standardizedFileURL
        if let entry = entries.object(forKey: key as NSURL), Date().timeIntervalSince(entry.createdAt) < 10 {
            return entry.value
        }
        if waiting[key] != nil {
            waiting[key]?.append(ready)
            return nil
        }
        waiting[key] = [ready]
        queue.async {
            let metadata = ShelfFileMetadataReader.read(key)
            DispatchQueue.main.async {
                self.entries.setObject(Entry(metadata), forKey: key as NSURL)
                let callbacks = self.waiting.removeValue(forKey: key) ?? []
                callbacks.forEach { $0(metadata) }
            }
        }
        return nil
    }
}
