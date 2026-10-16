import AppKit
import Combine
import ShelfCore
import UniformTypeIdentifiers

@MainActor
final class ShelfHostedBridge {
    private weak var app: ShelfApplication?
    private var bindings: Set<AnyCancellable> = []
    private let output = DispatchQueue(label: "com.wisp.shelf.hosted.output")
    private var stateScheduled = false
    private var hostDisconnected = false
    private var shortcutCaptureActive = false
    private var revision = 0

    init(app: ShelfApplication) { self.app = app }

    func start() {
        guard let app else { return }
        app.store.didCommit.sink { [weak self] in self?.scheduleState() }.store(in: &bindings)
        app.activity.$busy.dropFirst().sink { [weak self] _ in self?.scheduleState() }.store(in: &bindings)
        // #33：观察状态徽标随 FolderMonitor 上报实时刷新到前端设置页。
        app.store.$watchedFolderHealth.dropFirst().removeDuplicates().sink { [weak self] _ in self?.scheduleState() }.store(in: &bindings)
        let reader = ShelfHostedInputStream { [weak self] data in
            DispatchQueue.main.async { self?.receive(data) }
        } onEnd: { [weak self] in
            DispatchQueue.main.async { self?.inputEnded() }
        }
        reader.start()
        scheduleState()
    }

    func navigate(_ target: String) { send(["event": "navigate", "target": target]) }

    /// #66：测试连接的分步结果（Rust 侧转发为 shelf-cloud-test-result 事件）。
    func sendCloudTestResult(accountID: String, progress: CloudConnectionTestProgress) {
        let steps = CloudTestStep.allCases.map { step -> [String: Any] in
            ["step": step.rawValue,
             "status": progress.failed == step ? "failed" : progress.completed.contains(step) ? "passed" : "skipped"] as [String: Any]
        }
        send(["event": "cloudTest", "result": [
            "accountId": accountID,
            "succeeded": progress.success,
            "message": progress.message,
            "steps": steps,
        ] as [String: Any]])
    }

    /// #67：删除并撤销的结果（Rust 侧转发为 shelf-cloud-revoke-result 事件）。
    func sendCloudRevokeResult(recordID: String, message: String, succeeded: Bool) {
        send(["event": "cloudRevoke", "result": [
            "recordId": recordID,
            "message": message,
            "succeeded": succeeded,
        ] as [String: Any]])
    }

    func revealInWisp(_ urls: [URL]) throws { send(try Self.revealMessage(for: urls)) }

    static func revealMessage(for urls: [URL]) throws -> [String: Any] {
        ["event": "navigate", "target": "reveal", "paths": try validatedHostedPaths(urls)]
    }

    func shareAirDropIfHosted(_ type: String, urls: [URL], hosted: Bool) throws -> Bool {
        if hosted && type == "airdrop", hostDisconnected { throw ShelfAutomationError.unavailable }
        return try Self.routeHostedSharing(type, urls: urls, hosted: hosted) { send($0) }
    }

    static func routeHostedSharing(_ type: String, urls: [URL], hosted: Bool,
                                   send: ([String: Any]) -> Void) throws -> Bool {
        guard hosted && type == "airdrop" else { return false }
        send(try airDropMessage(for: urls))
        return true
    }

    static func airDropMessage(for urls: [URL]) throws -> [String: Any] {
        ["event": "airdrop", "paths": try validatedHostedPaths(urls)]
    }

    private static func validatedHostedPaths(_ urls: [URL]) throws -> [String] {
        _ = try ShelfAutomationRequest.validatedFiles(urls)
        // Keep the source path so a symbolic link is selected in its own folder.
        var seen: Set<String> = []
        let paths = urls.map { $0.standardizedFileURL.path }.filter { seen.insert($0).inserted }
        guard paths.allSatisfy({ $0.utf8.count <= 4096 }),
              paths.reduce(0, { $0 + $1.utf8.count }) <= ShelfAutomationRequest.maximumAddressBytes else {
            throw ShelfAutomationError.addressTooLong
        }
        return paths
    }

    func scheduleState() {
        guard !stateScheduled else { return }
        stateScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.stateScheduled = false
            if self.hostDisconnected {
                if self.app?.busy.isEmpty == true { self.app?.terminateHosted() }
                return
            }
            guard self.app?.store.storageAvailable == true else { return }
            self.sendState()
        }
    }

    private func snapshot() throws -> ShelfHostedSnapshot {
        guard let app, app.store.storageAvailable else {
            throw NSError(domain: "WispShelf", code: 1,
                userInfo: [NSLocalizedDescriptionKey: app?.store.lastError ?? ShelfStorageError.unavailable.localizedDescription])
        }
        revision += 1
        return ShelfHostedSnapshot(shelves: app.store.shelves.map { shelf in
            ShelfHostedShelf(shelf, busy: app.busy.contains(shelf.id))
        }, settings: app.store.settings,
            cloudHistory: app.store.cloudHistory.map(ShelfHostedCloudRecord.init),
            credentialAccountIds: app.store.settings.cloudAccounts.filter { app.store.credential(for: $0) != nil }.map { $0.id.uuidString },
            watchedFolderStates: Dictionary(uniqueKeysWithValues: app.store.settings.watchedFolders.map {
                ($0.id.uuidString, app.store.watchedFolderStatus(for: $0))
            }), revision: revision)
    }

    private func sendState() {
        do { send(["event": "state", "state": try object(snapshot())]) }
        catch { writeError(error.localizedDescription) }
    }

    private func receive(_ data: Data) {
        var identifier = -1
        do {
            identifier = try JSONDecoder().decode(ShelfHostedIdentifier.self, from: data).id
            let envelope = try JSONDecoder().decode(ShelfHostedEnvelope.self, from: data)
            identifier = envelope.id
            guard identifier >= 0, let app else { throw ShelfHostedError.invalidRequest }
            let shutdown = envelope.request.action == "shutdown"
            if shutdown {
                guard app.busy.isEmpty else { throw ShelfHostedError.busy }
                if !app.store.storageAvailable {
                    revision += 1
                    let unavailable: [String: Any] = ["supported": false, "revision": revision,
                        "shelves": [], "settings": [:], "cloudHistory": [],
                        "credentialAccountIds": [], "error": app.store.lastError ?? ShelfStorageError.unavailable.localizedDescription]
                    send(["id": identifier, "ok": true, "state": unavailable], then: { [weak app] in
                        DispatchQueue.main.async { app?.terminateHosted() }
                    })
                    return
                }
                guard app.saveWindowPositions() else { throw ShelfStorageError.saveFailed }
            } else {
                _ = try snapshot()
                try handle(envelope.request, app: app)
            }
            send(["id": identifier, "ok": true, "state": try object(snapshot())], then: shutdown ? { [weak app] in
                DispatchQueue.main.async { app?.terminateHosted() }
            } : nil)
        } catch {
            send(["id": identifier, "ok": false, "error": error.localizedDescription])
        }
    }

    private func handle(_ request: ShelfHostedRequest, app: ShelfApplication) throws {
        let store = app.store
        switch request.action {
        case "snapshot": return
        case "settings":
            guard let patch = request.settings else { throw ShelfHostedError.invalidRequest }
            let next = try ShelfHostedSettings.merged(patch, into: store.settings)
            try store.transaction { store.settings = next }
            app.applySettings()
        case "shortcutCapture":
            guard let active = request.active else { throw ShelfHostedError.invalidRequest }
            shortcutCaptureActive = active
            if active { app.activation.stop() }
            else { app.activation.start(); app.shortcutErrors = app.activation.shortcutErrors }
        case "selectIgnoredApplications":
            let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false
            panel.allowsMultipleSelection = true; panel.allowedContentTypes = [.applicationBundle]
            panel.prompt = "选择忽略的应用"; NSApp.activate(ignoringOtherApps: true)
            if panel.runModal() == .OK {
                let ids = panel.urls.compactMap { Bundle(url: $0)?.bundleIdentifier }
                guard !ids.isEmpty else { throw ShelfHostedError.invalidRequest }
                try store.transaction { store.settings.ignoredApps = Array(Set(store.settings.ignoredApps + ids)).sorted() }
            }
        case "screenshotTest":
            // #34：截图设置页「拍一张试试」——系统交互截图直接落进已选的截图文件夹。
            try app.runScreenshotTest()
        case "openScreenshotSettings":
            // #34：系统「截屏」设置深链（关闭浮动缩略图的入口）。
            app.openScreenshotSettings()
        case "showGuide":
            // #84：前端设置页的「快速上手」入口。
            app.presentOnboarding()
        case "create":
            let name = try validatedName(request.name ?? "新的悬浮窗")
            let id = try store.transaction { store.createShelf(name: name) }
            app.show(id)
        case "showLast":
            // #26：URL 子命令 shelf/last——重开最后一个收起的架子（与 reopen 快捷键同语义）。
            if let id = ShelfInteractionRules.lastCollapsedShelf(shelves: store.shelves.map { ($0.id, $0.visible ?? true) }) {
                app.show(id)
            }
        case "addFiles":
            guard let paths = request.paths, !paths.isEmpty,
                  paths.allSatisfy({ $0.hasPrefix("/") }) else { throw ShelfHostedError.invalidRequest }
            let files = try ShelfAutomationRequest.validatedFiles(paths.map { URL(fileURLWithPath: $0) })
            let managedRoot = store.contentDirectory.standardizedFileURL.resolvingSymlinksInPath().path + "/"
            let managed = files.filter { $0.path.hasPrefix(managedRoot) }
            let target = try optionalTarget(request.shelfId, app: app)
            let id = try store.transaction {
                let id = target ?? app.collectionTarget()
                _ = store.add(files.filter { !managed.contains($0) }, to: id)
                _ = store.add(managed, to: id, managed: true)
                return id
            }
            app.show(id)
        case "addContent":
            let target = try optionalTarget(request.shelfId, app: app)
            let content: (Data, String, ItemKind)
            if let value = request.url {
                guard let url = URL(string: value), WebImageReceiver.isAllowedAddress(url) else { throw ShelfHostedError.invalidRequest }
                content = (try PropertyListSerialization.data(fromPropertyList: ["URL": url.absoluteString], format: .xml, options: 0), "webloc", .link)
            } else if !store.settings.plainText, let html = request.html, !html.isEmpty {
                content = (Data(html.utf8), "html", .text)
            } else if let text = request.text, !text.isEmpty {
                content = (Data(text.utf8), "txt", .text)
            } else { throw ShelfHostedError.emptyContent }
            guard content.0.count <= ShelfHostedInputStream.maximumLineBytes / 2 else { throw ShelfHostedError.invalidRequest }
            let id = try store.transaction {
                let id = target ?? app.collectionTarget()
                _ = try store.materialize(content.0, extension: content.1, kind: content.2, to: id)
                return id
            }
            app.show(id)
        case "clipboard":
            if request.forceNew == true, request.shelfId != nil { throw ShelfHostedError.invalidRequest }
            let target = request.forceNew == true ? nil : try optionalTarget(request.shelfId, app: app)
            let id = try store.transaction {
                let id = target ?? (request.forceNew == true ? store.createShelf() : app.collectionTarget())
                guard app.receive(.general, shelf: id) else { throw ShelfHostedError.emptyContent }
                return id
            }
            app.show(id)
        case "removeCloudAccount":
            guard let raw = request.accountId, let accountID = UUID(uuidString: raw) else { throw ShelfHostedError.invalidRequest }
            let account = try store.removeCloudAccountRecord(accountID)
            app.applySettings()
            if !store.settings.cloudAccounts.contains(where: { $0.credentialKey == account.credentialKey }),
               !store.deleteCredential(for: account) {
                throw NSError(domain: "WispShelf", code: 2, userInfo: [NSLocalizedDescriptionKey:
                    "账户已移除，但本机密钥清理失败。\(store.lastError ?? "")"])
            }
            scheduleState()
        case "setCredential", "deleteCredential":
            guard let raw = request.accountId, let accountID = UUID(uuidString: raw),
                  let account = store.settings.cloudAccounts.first(where: { $0.id == accountID }) else { throw ShelfHostedError.invalidRequest }
            if request.action == "setCredential" {
                guard let secret = request.secret, !secret.isEmpty, secret.utf8.count <= 64 * 1024 else { throw ShelfHostedError.invalidRequest }
                guard store.setCredential(secret, for: account) else { throw ShelfStorageError.saveFailed }
            } else if !store.deleteCredential(for: account) { throw ShelfStorageError.saveFailed }
            scheduleState()
        case "testCloudAccount":
            // #66：三步测试（上传→列出→删除）异步执行，结果用 cloudTest 事件回传前端。
            guard let raw = request.accountId, let accountID = UUID(uuidString: raw),
                  let account = store.settings.cloudAccounts.first(where: { $0.id == accountID }) else { throw ShelfHostedError.invalidRequest }
            guard ["s3", "custom"].contains(account.provider.lowercased()) else { throw ShelfHostedError.unsupportedCommand }
            guard !store.settings.onlineDisabled else {
                throw NSError(domain: "WispShelf", code: 3, userInfo: [NSLocalizedDescriptionKey: "在线功能已关闭，未执行测试连接。"])
            }
            let credential = store.credential(for: account)
            Task { [weak self] in
                let progress = await CloudConnectionTest.run(account: account, credential: credential)
                self?.sendCloudTestResult(accountID: accountID.uuidString, progress: progress)
            }
        case "removeCloudRecord":
            // #67：从列表删除一条本机分享记录（不动远端对象）。
            guard let raw = request.recordId, let recordID = UUID(uuidString: raw),
                  store.cloudHistory.contains(where: { $0.id == recordID }) else { throw ShelfHostedError.invalidRequest }
            guard store.removeCloudRecord(recordID) else { throw ShelfStorageError.saveFailed }
            scheduleState()
        case "revokeCloudRecord":
            // #67：删除并撤销——远端 DELETE 成功后移除本机记录；结果用 cloudRevoke 事件回传。
            guard let raw = request.recordId, let recordID = UUID(uuidString: raw),
                  let record = store.cloudHistory.first(where: { $0.id == recordID }),
                  let accountRaw = record.accountID, let accountID = UUID(uuidString: accountRaw),
                  let account = store.settings.cloudAccounts.first(where: { $0.id == accountID }) else { throw ShelfHostedError.invalidRequest }
            guard CloudRevocation.canRevoke(provider: account.provider) else { throw ShelfHostedError.unsupportedCommand }
            guard !store.settings.onlineDisabled else {
                throw NSError(domain: "WispShelf", code: 3, userInfo: [NSLocalizedDescriptionKey: "在线功能已关闭，未执行撤销。"])
            }
            let credential = store.credential(for: account)
            Task { [weak self] in
                do {
                    try await CloudRevocation.revoke(record: record, account: account, credential: credential)
                    _ = store.removeCloudRecord(recordID)
                    self?.sendCloudRevokeResult(recordID: recordID.uuidString, message: "已删除远端对象并移除本机记录。", succeeded: true)
                    self?.scheduleState()
                } catch {
                    self?.sendCloudRevokeResult(recordID: recordID.uuidString,
                        message: (error as? CloudUploadFailure)?.message ?? error.localizedDescription, succeeded: false)
                }
            }
        case "rename", "pin", "clear", "removeItems", "close", "remove", "show", "hide", "dock", "context":
            let id = try requiredTarget(request.shelfId, app: app)
            if ["clear", "removeItems", "close", "remove", "hide", "dock", "context"].contains(request.action), app.busy.contains(id) { throw ShelfHostedError.busy }
            switch request.action {
            case "rename":
                guard let name = request.name else { throw ShelfHostedError.invalidRequest }
                let value = try validatedName(name)
                try store.transaction { store.updateShelf(id) { $0.name = value } }
            case "pin":
                guard let pinned = request.pinned else { throw ShelfHostedError.invalidRequest }
                try store.transaction { store.updateShelf(id) { $0.pinned = pinned } }
            case "clear": try store.transaction { store.updateShelf(id) { $0.items = [] } }
            case "removeItems":
                let ids = try selectedItems(request.itemIds, shelf: id, app: app)
                try store.transaction { store.remove(Set(ids), from: id) }
            case "close":
                // A1：协议里的 close 就是「收起」——架子留在清单里，内容不丢。
                app.close(id)
            case "remove":
                // 管理页「删除架子」：真正移除记录；文件永远不碰。
                app.removeShelf(id)
            case "show": app.show(id)
            case "hide": app.hide(id)
            case "dock":
                if let edge = request.edge, !["left", "right", "top", "bottom"].contains(edge) { throw ShelfHostedError.invalidRequest }
                app.show(id)
                try store.transaction { app.dock(id, edge: request.edge) }
            case "context":
                guard let command = request.command, allowedContext(command, app: app) else { throw ShelfHostedError.unsupportedCommand }
                let ids = try selectedItems(request.itemIds, shelf: id, app: app)
                if command != "remove", !app.items(id, ids).allSatisfy(\.isAvailable) { throw ShelfHostedError.invalidItems }
                // File operations retain their existing native confirmations and completion feedback.
                if command == "remove" || command == "moveToNewShelf" {
                    try store.transaction { app.contextAction(command, shelf: id, itemIDs: ids) }
                } else {
                    app.contextAction(command, shelf: id, itemIDs: ids)
                    guard store.persist() else { throw ShelfStorageError.saveFailed }
                }
            default: break
            }
            scheduleState()
        default: throw ShelfHostedError.unsupportedCommand
        }
    }

    private func requiredTarget(_ raw: String?, app: ShelfApplication) throws -> UUID {
        guard let raw, let id = UUID(uuidString: raw), app.store.shelf(id) != nil else { throw ShelfHostedError.invalidShelf }
        return id
    }
    private func optionalTarget(_ raw: String?, app: ShelfApplication) throws -> UUID? {
        guard let raw else {
            // #38：current=上次活动窗口（即使已收起）；visible=最近使用的可见窗口。
            // 两者都落到具体架子时保留忙碌检查；visible 无可见架则交回新建路径。
            if app.store.settings.additionBehavior == "visible" {
                guard let id = app.visibleCollectionTarget() else { return nil }
                guard !app.busy.contains(id) else { throw ShelfHostedError.busy }
                return id
            }
            guard app.store.settings.additionBehavior == "current" else { return nil }
            let current = app.activity.currentShelfID.flatMap { app.store.shelf($0) } ?? app.store.shelves.last
            if let current, app.busy.contains(current.id) { throw ShelfHostedError.busy }
            return current?.id
        }
        let id = try requiredTarget(raw, app: app)
        guard !app.busy.contains(id) else { throw ShelfHostedError.busy }
        return id
    }
    private func selectedItems(_ raw: [String]?, shelf id: UUID, app: ShelfApplication) throws -> [UUID] {
        guard let raw, !raw.isEmpty, raw.count <= 256 else { throw ShelfHostedError.invalidItems }
        let ids = raw.compactMap(UUID.init(uuidString:))
        guard ids.count == raw.count, Set(ids).count == ids.count,
              app.items(id, ids).count == ids.count else { throw ShelfHostedError.invalidItems }
        return ids
    }
    private func validatedName(_ raw: String) throws -> String {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf8.count <= 1024 else { throw ShelfHostedError.invalidRequest }
        return name
    }
    private func allowedContext(_ command: String, app: ShelfApplication) -> Bool {
        if ["remove", "moveToNewShelf", "preview", "open", "reveal", "copyItems", "getInfo", "airdrop", "mail", "messages"].contains(command) { return true }
        if command.hasPrefix("action:") { return ActionKind(rawValue: String(command.dropFirst(7))) != nil }
        if command.hasPrefix("utility:") { return ShelfUtilityAction(rawValue: String(command.dropFirst(8))) != nil }
        if command.hasPrefix("script:") { return app.store.settings.scriptPaths.contains(String(command.dropFirst(7))) }
        if command.hasPrefix("cloud:") {
            let value = String(command.dropFirst(6))
            return value == "cloud" || app.store.settings.cloudAccounts.contains { $0.id.uuidString == value }
        }
        if command.hasPrefix("preset:") { return app.store.settings.customActions.contains { $0.id.uuidString == String(command.dropFirst(7)) } }
        if command.hasPrefix("openWith:"), let url = URL(string: String(command.dropFirst(9))) { return url.isFileURL && url.pathExtension == "app" }
        return false
    }

    private func inputEnded() {
        hostDisconnected = true
        app?.hostedConnectionClosed = true
        if shortcutCaptureActive { app?.activation.start() }
        if app?.busy.isEmpty == true { app?.terminateHosted() }
    }

    private func object<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
    private func send(_ object: [String: Any], then completion: (() -> Void)? = nil) {
        do {
            var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            data.append(10)
            output.async {
                do { try FileHandle.standardOutput.write(contentsOf: data) }
                catch { /* The parent may have already closed its receiving pipe. */ }
                completion?()
            }
        } catch { writeError(error.localizedDescription) }
    }
    private func writeError(_ message: String) {
        try? FileHandle.standardError.write(contentsOf: Data((message + "\n").utf8))
    }
}

private struct ShelfHostedIdentifier: Decodable { let id: Int }
