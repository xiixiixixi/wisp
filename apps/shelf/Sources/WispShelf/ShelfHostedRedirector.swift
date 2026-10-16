import AppKit
import ShelfCore

@MainActor
final class ShelfHostedRedirector: NSObject, NSApplicationDelegate {
    private let hostURL: URL
    private var exitWork: DispatchWorkItem?
    private var forwarding = 0

    static var hostApplicationURL: URL? {
        var candidate = Bundle.main.bundleURL.deletingLastPathComponent()
        while candidate.path != "/" {
            if candidate.pathExtension == "app" { return candidate }
            candidate.deleteLastPathComponent()
        }
        return nil
    }

    init(hostURL: URL) { self.hostURL = hostURL }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NSApp.servicesProvider = self
        NSUpdateDynamicServices()
        ShelfIntentBridge.collectFiles = { [weak self] files in
            guard let self else { throw ShelfAutomationError.unavailable }
            try self.collect(files)
        }
        forwarding += 1
        NSWorkspace.shared.openApplication(at: hostURL, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error { self.showError(error.localizedDescription) }
                self.forwarding -= 1
                self.scheduleExit()
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        do {
            let files = urls.filter(\.isFileURL)
            if !files.isEmpty { try collect(files) }
            for address in urls where !address.isFileURL {
                try collect(ShelfAutomationRequest.files(from: address))
            }
        } catch { showError(error.localizedDescription); scheduleExit() }
    }

    private func collect(_ files: [URL]) throws {
        let address = try ShelfAutomationRequest.address(for: files)
        exitWork?.cancel()
        forwarding += 1
        NSWorkspace.shared.open([address], withApplicationAt: hostURL, configuration: NSWorkspace.OpenConfiguration()) { [weak self] _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error { self.showError(error.localizedDescription) }
                self.forwarding -= 1
                self.scheduleExit()
            }
        }
    }

    @objc func collectService(_ pasteboard: NSPasteboard, userData: String?, error serviceError: AutoreleasingUnsafeMutablePointer<NSString?>) {
        do {
            if let files = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !files.isEmpty {
                try collect(files)
                return
            }
            let data: Data
            let suffix: String
            if let image = pasteboard.data(forType: .png) {
                guard try WebImageReceiver.validatedImage(image).fileExtension == "png" else { throw WebImageReceiveError.notAnImage }
                data = image; suffix = "png"
            } else if let value = pasteboard.string(forType: .URL), let url = URL(string: value), WebImageReceiver.isAllowedAddress(url) {
                data = try PropertyListSerialization.data(fromPropertyList: ["URL": url.absoluteString], format: .xml, options: 0)
                suffix = "webloc"
            } else if let value = pasteboard.string(forType: .string), !value.isEmpty, value.utf8.count <= 32 * 1024 * 1024 {
                data = Data(value.utf8); suffix = "txt"
            } else { throw ShelfHostedError.emptyContent }
            let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let directory = base.appendingPathComponent("WispShelf/Contents/Services/\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent("收集内容").appendingPathExtension(suffix)
            try data.write(to: file, options: .withoutOverwriting)
            try collect([file])
        } catch { serviceError.pointee = error.localizedDescription as NSString }
    }

    private func scheduleExit() {
        guard forwarding == 0 else { return }
        exitWork?.cancel()
        let work = DispatchWorkItem { NSApp.terminate(nil) }
        exitWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }

    private func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "无法加入 Wisp 收集架"
        alert.informativeText = message; alert.addButton(withTitle: "好"); alert.runModal()
    }
}
