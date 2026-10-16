import Foundation
import CoreServices
import Darwin
import UniformTypeIdentifiers

@MainActor
public final class FolderMonitor {
    private let onFiles: ([URL]) -> Void
    private let onError: (String) -> Void
    private let onScreenshots: (([URL]) -> Void)?
    // #33：观察路径的健康快照（path → "active"/"error"），变化时上报给设置页徽标。
    private let onStates: (([String: String]) -> Void)?
    private let queue: DispatchQueue
    private let scanner: WatchedFolderScanner
    private var timer: DispatchSourceTimer?
    private var activePaths: Set<String> = []
    private var activeFilePaths: Set<String> = []
    private var activeRules: [String: [WatchedFolder]] = [:]
    private var activeScreenshotPath: String?
    private var runID: UUID?
    private var configurationID: UUID?
    private var folderHealth: [String: String] = [:]

    public init(onFiles: @escaping ([URL]) -> Void, onError: @escaping (String) -> Void,
                onScreenshots: (([URL]) -> Void)? = nil, onStates: (([String: String]) -> Void)? = nil) {
        self.onFiles = onFiles
        self.onError = onError
        self.onScreenshots = onScreenshots
        self.onStates = onStates
        let queue = DispatchQueue(label: "com.wisp.shelf.folder-monitor", qos: .utility)
        self.queue = queue
        scanner = WatchedFolderScanner(queue: queue)
    }

    public func update(_ folders: [WatchedFolder], screenshotDirectory: String? = nil) {
        func normalized(_ value: String) -> String? {
            let path = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !path.isEmpty else { return nil }
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
                .resolvingSymlinksInPath().standardizedFileURL.path
        }
        var rules: [String: [WatchedFolder]] = [:]
        for folder in folders where folder.enabled {
            guard let path = normalized(folder.path) else { continue }
            var rule = folder; rule.path = path
            rules[path, default: []].append(rule)
        }
        for path in rules.keys { rules[path]?.sort { $0.id.uuidString < $1.id.uuidString } }
        let filePaths = Set(rules.keys)
        let screenshotPath = screenshotDirectory.flatMap(normalized)
        var paths = filePaths
        if let screenshotPath { paths.insert(screenshotPath) }
        guard rules != activeRules || screenshotPath != activeScreenshotPath || timer == nil else { return }
        guard !paths.isEmpty else {
            stop()
            return
        }
        activePaths = paths
        activeFilePaths = filePaths
        activeRules = rules
        activeScreenshotPath = screenshotPath
        let revision = UUID()
        configurationID = revision

        if timer == nil {
            let identifier = UUID()
            runID = identifier
            let scanner = self.scanner
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now() + 0.5, repeating: 0.5, leeway: .milliseconds(100))
            source.setEventHandler { [weak self, scanner] in
                let batch = scanner.scan()
                Task { @MainActor [weak self] in self?.deliver(batch, runID: identifier) }
            }
            timer = source
            source.resume()
        }
        guard let identifier = runID else { return }
        let scanner = self.scanner
        let configuredRules = rules
        queue.async { [weak self, scanner] in
            scanner.configure(fileRules: configuredRules, screenshotPath: screenshotPath, configurationID: revision)
            let batch = scanner.scan()
            Task { @MainActor [weak self] in self?.deliver(batch, runID: identifier) }
        }
    }

    public func stop() {
        timer?.cancel()
        timer = nil
        runID = nil
        activePaths.removeAll()
        activeFilePaths.removeAll()
        activeRules.removeAll()
        activeScreenshotPath = nil
        configurationID = nil
        folderHealth.removeAll()
        // 停止即全部下线：把清空后的快照发出去，设置页的 error 徽标不会残留。
        onStates?([:])
        let scanner = self.scanner
        queue.async { scanner.reset() }
    }

    private func deliver(_ batch: FolderScanBatch, runID: UUID) {
        guard self.runID == runID, batch.configurationID == configurationID else { return }
        for error in batch.errors where activePaths.contains(error.folder) { onError(error.message) }
        // #33：每轮扫描都带回各路径的当前错误（nil=健康），据此维护健康快照。
        for entry in batch.health where activeFilePaths.contains(entry.folder) {
            folderHealth[entry.folder] = entry.message == nil ? "active" : "error"
        }
        onStates?(folderHealth.filter { activeFilePaths.contains($0.key) })
        let files = batch.files.filter {
            activeFilePaths.contains($0.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path)
        }
        if !files.isEmpty { onFiles(files) }
        let screenshots = batch.screenshots.filter {
            $0.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL.path == activeScreenshotPath
        }
        if !screenshots.isEmpty { onScreenshots?(screenshots) }
    }

    deinit { timer?.cancel() }
}

private struct FolderScanBatch: Sendable {
    var configurationID: UUID?
    var files: [URL] = []
    var screenshots: [URL] = []
    var errors: [(folder: String, message: String)] = []
    var health: [(folder: String, message: String?)] = []
}

// Queue confinement is enforced below; no scanner state is accessed by the main actor.
private final class WatchedFolderScanner: @unchecked Sendable {
    private let queue: DispatchQueue
    private enum Identity: Hashable {
        case resource(AnyHashable)
        case path(String)
    }
    private struct Signature: Equatable {
        let size: Int
        let modified: Date?
    }
    private struct Entry {
        let url: URL
        let identity: Identity
        let signature: Signature
        let contentType: UTType?
    }
    private struct Candidate {
        var entry: Entry
        var changedAt: TimeInterval
        var stableScans = 0
        var awaitingMetadataSince: TimeInterval?
    }
    private struct FolderState {
        var initialized = false
        var known: Set<Identity> = []
        var pending: [Identity: Candidate] = [:]
        var lastError: String?
    }
    private var states: [String: FolderState] = [:]
    private var delivered: Set<Identity> = []
    private var fileRules: [String: [WatchedFolder]] = [:]
    private var screenshotPath: String?
    private var configurationID: UUID?
    private let temporaryExtensions: Set<String> = ["download", "crdownload", "part", "partial", "tmp", "temp"]

    init(queue: DispatchQueue) { self.queue = queue }

    func configure(fileRules: [String: [WatchedFolder]], screenshotPath: String?, configurationID: UUID) {
        dispatchPrecondition(condition: .onQueue(queue))
        self.fileRules = fileRules
        self.screenshotPath = screenshotPath
        self.configurationID = configurationID
        var paths = Set(fileRules.keys)
        if let screenshotPath { paths.insert(screenshotPath) }
        states = states.filter { paths.contains($0.key) }
        for path in paths where states[path] == nil { states[path] = FolderState() }
    }

    func reset() {
        dispatchPrecondition(condition: .onQueue(queue))
        states.removeAll()
        delivered.removeAll()
        fileRules.removeAll()
        screenshotPath = nil
        configurationID = nil
    }

    func scan() -> FolderScanBatch {
        dispatchPrecondition(condition: .onQueue(queue))
        var batch = FolderScanBatch(configurationID: configurationID)
        let now = ProcessInfo.processInfo.systemUptime
        for path in states.keys.sorted() {
            guard var state = states[path] else { continue }
            do {
                let entries = try readDirectory(path)
                state.lastError = nil
                if !state.initialized {
                    state.known.formUnion(entries.keys)
                    state.initialized = true
                    states[path] = state
                    continue
                }
                state.pending = state.pending.filter { entries[$0.key] != nil }
                for (identity, entry) in entries where !state.known.contains(identity) {
                    if delivered.contains(identity) {
                        state.known.insert(identity)
                        state.pending.removeValue(forKey: identity)
                        continue
                    }
                    let matching = fileRules[path]?.filter { $0.matches(entry.url, contentType: entry.contentType) } ?? []
                    if matching.isEmpty, path != screenshotPath {
                        state.known.insert(identity)
                        state.pending.removeValue(forKey: identity)
                        continue
                    }
                    if var candidate = state.pending[identity] {
                        if candidate.entry.signature == entry.signature {
                            candidate.stableScans += 1
                        } else {
                            candidate.changedAt = now
                            candidate.stableScans = 0
                            candidate.awaitingMetadataSince = nil
                        }
                        candidate.entry = entry
                        if path == screenshotPath, candidate.stableScans >= 2, now - candidate.changedAt >= 3 {
                            if matching.isEmpty,
                               let started = candidate.awaitingMetadataSince, now - started >= 30 {
                                state.known.insert(identity)
                                state.pending.removeValue(forKey: identity)
                                continue
                            }
                            if isScreenshot(entry.url) {
                                batch.screenshots.append(entry.url)
                                delivered.insert(identity)
                                state.known.insert(identity)
                                state.pending.removeValue(forKey: identity)
                                continue
                            } else if matching.isEmpty {
                                // ScreenCapture can write its metadata after closing the image file.
                                candidate.awaitingMetadataSince = candidate.awaitingMetadataSince ?? now
                                state.pending[identity] = candidate
                                continue
                            }
                        }
                        state.pending[identity] = candidate
                    } else {
                        state.pending[identity] = Candidate(entry: entry, changedAt: now)
                    }
                }
                let collectible = state.pending.compactMap { identity, candidate -> (Identity, Candidate, Double)? in
                    let matching = fileRules[path]?.filter { $0.matches(candidate.entry.url, contentType: candidate.entry.contentType) } ?? []
                    guard let delay = matching.map(\.effectiveCollectionDelay).min() else { return nil }
                    if path == screenshotPath, isScreenshot(candidate.entry.url) { return nil }
                    return (identity, candidate, delay)
                }
                let ready = collectible.filter { $0.1.stableScans >= 2 && now - $0.1.changedAt >= $0.2 }
                let firstChange = collectible.map { $0.1.changedAt }.min() ?? now
                let longestDelay = collectible.map { $0.2 }.max() ?? 3
                // Coalesce a short burst, but a still-writing file must not hold ready files indefinitely.
                if !ready.isEmpty, ready.count == collectible.count || now - firstChange >= longestDelay + 3 {
                    for (identity, candidate, _) in ready {
                        batch.files.append(candidate.entry.url)
                        delivered.insert(identity)
                        state.known.insert(identity)
                        state.pending.removeValue(forKey: identity)
                    }
                }
            } catch {
                let message = "无法监听文件夹“\(path)”：\(error.localizedDescription)"
                if state.lastError != message {
                    batch.errors.append((folder: path, message: message))
                    state.lastError = message
                }
            }
            states[path] = state
            batch.health.append((folder: path, message: state.lastError))
        }
        batch.files.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        batch.screenshots.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        return batch
    }

    private func isScreenshot(_ url: URL) -> Bool {
        // ScreenCapture marks files with a binary-plist Boolean. Filename and format are not evidence.
        let attribute = "com.apple.metadata:kMDItemIsScreenCapture"
        let marked = url.withUnsafeFileSystemRepresentation { path -> Bool in
            guard let path else { return false }
            let size = getxattr(path, attribute, nil, 0, 0, 0)
            guard size > 0, size <= 4096 else { return false }
            var data = Data(count: size)
            let read = data.withUnsafeMutableBytes { buffer in
                getxattr(path, attribute, buffer.baseAddress, size, 0, 0)
            }
            guard read == size, let value = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) else { return false }
            return value as? Bool == true
        }
        if marked { return true }
        guard let item = MDItemCreateWithURL(kCFAllocatorDefault, url as CFURL),
              let value = MDItemCopyAttribute(item, "kMDItemIsScreenCapture" as CFString) else { return false }
        return value as? Bool == true
    }

    private func readDirectory(_ path: String) throws -> [Identity: Entry] {
        let folder = URL(fileURLWithPath: path, isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .fileResourceIdentifierKey, .contentTypeKey]
        let urls = try FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles]
        )
        var entries: [Identity: Entry] = [:]
        for listed in urls where !temporaryExtensions.contains(listed.pathExtension.lowercased()) {
            let url = listed.resolvingSymlinksInPath().standardizedFileURL
            let values = try url.resourceValues(forKeys: keys)
            guard values.isRegularFile == true else { continue }
            let identity: Identity
            if let resource = values.fileResourceIdentifier as? AnyHashable {
                identity = .resource(resource)
            } else {
                identity = .path(url.standardizedFileURL.path)
            }
            entries[identity] = Entry(
                url: url, identity: identity,
                signature: Signature(size: values.fileSize ?? 0, modified: values.contentModificationDate), contentType: values.contentType
            )
        }
        return entries
    }
}
