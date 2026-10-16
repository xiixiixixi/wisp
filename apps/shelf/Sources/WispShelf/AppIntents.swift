import AppIntents
import AppKit
import ShelfCore
import UniformTypeIdentifiers

@MainActor
enum ShelfIntentBridge {
    static var collectFiles: (([URL]) throws -> Void)?
    /// #27：FilesFromShelf 的取材闭包（引擎在跑时直接读状态）。
    static var filesFromShelf: (() -> [URL])?
    /// #27：OpenLastShelf 的执行闭包（重开最后一个收起的架子）。
    static var openLastShelf: (() throws -> Void)?
    /// #27：兜底读的清单地址。生产固定本机路径（nil）；测试注入临时地址——
    /// 开发机真实 state.json 常年有文件，兜底会合法成功，失败分支在真机上无从钉住。
    static var storedStateURL: URL?

    static func collect(_ files: [URL]) async throws {
        let files = try ShelfAutomationRequest.validatedFiles(files)
        if let collectFiles {
            try collectFiles(files)
            return
        }
        let address = try ShelfAutomationRequest.address(for: files)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NSWorkspace.shared.open(address, configuration: NSWorkspace.OpenConfiguration()) { application, error in
                if let error { continuation.resume(throwing: error) }
                else if application == nil { continuation.resume(throwing: ShelfAutomationError.unavailable) }
                else { continuation.resume() }
            }
        }
    }

    /// #27：引擎没在跑时兜底——直接读本机清单，取最近活动的可见架的文件。
    static func filesFromStoredState() throws -> [URL] {
        let directory = storedStateURL ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WispShelf", isDirectory: true)
            .appendingPathComponent("state.json")
        guard let snapshot = try? JSONDecoder().decode(ShelfSnapshot.self, from: Data(contentsOf: directory)) else {
            throw ShelfAutomationError.unavailable
        }
        guard let selection = ShelfInteractionRules.filesFromShelf(
            current: nil,
            shelves: snapshot.shelves.map { ($0.id, $0.visible ?? true, $0.items) }) else {
            throw ShelfAutomationError.emptyFiles
        }
        return selection.items.map(\.resolvedURL)
    }
}

// #27：把当前可见架子的文件作为输出返回——快捷指令可把收集架当「文件变量」用。
struct FilesFromShelfIntent: AppIntent {
    static var title: LocalizedStringResource = "从收集架取出文件"
    static var description = IntentDescription("返回当前可见收集架里的文件，供快捷指令继续使用；原文件保留原位置。")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<[IntentFile]> {
        let urls = try ShelfIntentBridge.filesFromShelf?() ?? ShelfIntentBridge.filesFromStoredState()
        guard !urls.isEmpty else { throw ShelfAutomationError.emptyFiles }
        return .result(value: urls.map { IntentFile(fileURL: $0) })
    }
}

// #27：重开最近收起的架子（与「重新打开最近的窗口」快捷键同语义）。
struct OpenLastShelfIntent: AppIntent {
    static var title: LocalizedStringResource = "打开上次的收集架"
    static var description = IntentDescription("重新显示最近收起或关闭的收集架窗口。")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        if let reopen = ShelfIntentBridge.openLastShelf {
            try reopen()
        } else {
            guard let address = URL(string: "\(ShelfAutomationRequest.scheme)://shelf/last") else {
                throw ShelfAutomationError.invalidRequest
            }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                NSWorkspace.shared.open(address, configuration: NSWorkspace.OpenConfiguration()) { application, error in
                    if let error { continuation.resume(throwing: error) }
                    else if application == nil { continuation.resume(throwing: ShelfAutomationError.unavailable) }
                    else { continuation.resume() }
                }
            }
        }
        return .result()
    }
}

// #27：Siri/快捷指令短语（中英并列）。
struct ShelfAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: FilesFromShelfIntent(),
                    phrases: ["从收集架取文件 (Files from Shelf)"],
                    shortTitle: "取收集架文件",
                    systemImageName: "square.stack.3d.up")
        AppShortcut(intent: OpenLastShelfIntent(),
                    phrases: ["打开上次的收集架 (Open Last Shelf)"],
                    shortTitle: "打开上次架子",
                    systemImageName: "rectangle.stack.badge.plus")
    }
}

struct AddFilesToShelfIntent: AppIntent {
    static var title: LocalizedStringResource = "添加文件到收集架"
    static var description = IntentDescription("把文件或访达选中的项目放到收集架中，普通文件保留原位置。")
    static var openAppWhenRun = true

    @Parameter(title: "文件", supportedTypeIdentifiers: ["public.item"])
    var files: [IntentFile]

    static var parameterSummary: some ParameterSummary {
        Summary("将 \(\.$files) 添加到收集架")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard !files.isEmpty, files.count <= ShelfAutomationRequest.maximumFiles else {
            throw files.isEmpty ? ShelfAutomationError.emptyFiles : ShelfAutomationError.tooManyFiles
        }
        var urls: [URL] = []
        var importedDirectories: [URL] = []
        var accessedURLs: [URL] = []
        defer { for url in accessedURLs { url.stopAccessingSecurityScopedResource() } }
        do {
            for file in files {
                if let url = file.fileURL {
                    let access = url.startAccessingSecurityScopedResource()
                    if access { accessedURLs.append(url) }
                    guard url.isFileURL, FileManager.default.isReadableFile(atPath: url.path) else {
                        throw ShelfAutomationError.unreadableFile
                    }
                    if !ShelfAutomationRequest.needsManagedCopy(url, removedOnCompletion: file.removedOnCompletion) {
                        urls.append(url)
                    } else {
                        let destination = try importDestination(filename: file.filename, directories: &importedDirectories)
                        try FileManager.default.copyItem(at: url, to: destination)
                        urls.append(destination)
                    }
                } else {
                    let data = file.data
                    guard data.count <= 32 * 1024 * 1024 else { throw WebImageReceiveError.oversizedBytes }
                    let destination = try importDestination(filename: file.filename, directories: &importedDirectories)
                    try data.write(to: destination, options: .withoutOverwriting)
                    urls.append(destination)
                }
            }
            try await ShelfIntentBridge.collect(urls)
        } catch {
            // Only remove directories created for this failed import, never an original input.
            for directory in importedDirectories { try? FileManager.default.removeItem(at: directory) }
            throw error
        }
        return .result()
    }

    private func importDestination(filename: String, directories: inout [URL]) throws -> URL {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                              appropriateFor: nil, create: true)
            .appendingPathComponent("WispShelf/Contents/Shortcuts", isDirectory: true)
        let directory = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        directories.append(directory)
        let last = URL(fileURLWithPath: filename).lastPathComponent
        let safeName = last.isEmpty || last == "." || last == ".." ? "文件" : last
        return directory.appendingPathComponent(safeName)
    }
}
