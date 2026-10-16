import Darwin
import Foundation

public struct ShelfScriptRequest: Sendable {
    public var script: URL
    public var sources: [URL]
    public var timeoutSeconds: TimeInterval
    public var terminationGraceSeconds: TimeInterval
    public var maxOutputBytes: Int
    public var currentDirectory: URL?

    public init(script: URL, sources: [URL] = [], timeoutSeconds: TimeInterval = 60,
                terminationGraceSeconds: TimeInterval = 1, maxOutputBytes: Int = 524_288,
                currentDirectory: URL? = nil) {
        self.script = script
        self.sources = sources
        self.timeoutSeconds = timeoutSeconds
        self.terminationGraceSeconds = terminationGraceSeconds
        self.maxOutputBytes = maxOutputBytes
        self.currentDirectory = currentDirectory
    }
}

public enum ShelfScriptTermination: String, Sendable {
    case exited, signalled, timedOut, outputLimitExceeded, cancelled, ioFailed
}

public struct ShelfScriptResult: Sendable {
    public let standardOutput: Data
    public let standardError: Data
    public let exitCode: Int32
    public let termination: ShelfScriptTermination
    public let durationSeconds: TimeInterval
    public let message: String
    public var stdout: String { String(decoding: standardOutput, as: UTF8.self) }
    public var stderr: String { String(decoding: standardError, as: UTF8.self) }
    public var succeeded: Bool { termination == .exited && exitCode == 0 }

    public init(standardOutput: Data, standardError: Data, exitCode: Int32,
                termination: ShelfScriptTermination, durationSeconds: TimeInterval, message: String) {
        self.standardOutput = standardOutput
        self.standardError = standardError
        self.exitCode = exitCode
        self.termination = termination
        self.durationSeconds = durationSeconds
        self.message = message
    }
}

public struct ShelfScriptOutputSnapshot: Sendable {
    public let standardOutput: Data
    public let standardError: Data
    public let outputLimitReached: Bool
    public var stdout: String { String(decoding: standardOutput, as: UTF8.self) }
    public var stderr: String { String(decoding: standardError, as: UTF8.self) }
}

public enum ShelfScriptRunner {
    public static func run(_ request: ShelfScriptRequest,
                           onOutput: (@Sendable (ShelfScriptOutputSnapshot) -> Void)? = nil) async throws -> ShelfScriptResult {
        try Task.checkCancellation()
        let operation = Operation(request, onOutput: onOutput)
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                operation.start(continuation)
            }
        }, onCancel: { operation.cancel() })
    }

    struct LaunchPlan {
        let executable: URL
        let arguments: [String]
        let standardInput: Data?
    }

    static func plan(_ request: ShelfScriptRequest) throws -> LaunchPlan {
        guard request.timeoutSeconds.isFinite, request.timeoutSeconds > 0, request.timeoutSeconds <= 3600,
              request.terminationGraceSeconds.isFinite, (0...10).contains(request.terminationGraceSeconds),
              (1...524_288).contains(request.maxOutputBytes) else {
            throw RunnerFailure("脚本限制无效：执行时间须大于 0 且最多 3600 秒，停止等待最多 10 秒，输出最多 512 KiB（524288 字节）。")
        }
        let fm = FileManager.default
        guard request.script.isFileURL, fm.fileExists(atPath: request.script.path),
              fm.isReadableFile(atPath: request.script.path) else {
            throw RunnerFailure("脚本不存在或不可读取，没有执行。")
        }
        if let directory = request.currentDirectory {
            guard directory.isFileURL, (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                throw RunnerFailure("脚本工作目录不是存在的本机文件夹，没有执行。")
            }
        }
        guard request.sources.count <= 10_000 else { throw RunnerFailure("输入文件过多，最多允许 10000 项，没有执行。") }
        var paths: [String] = []
        var pathBytes = 0
        let workflow = request.script.pathExtension.lowercased() == "workflow"
        if workflow, request.sources.isEmpty {
            throw RunnerFailure("工作流程需要至少一个输入文件；没有输入时未执行。")
        }
        for source in request.sources {
            guard source.isFileURL, fm.fileExists(atPath: source.path) else {
                throw RunnerFailure("输入文件不存在或不是本机文件，没有执行。")
            }
            let path = source.path
            if workflow, path.contains("\n") || path.contains("\r") {
                throw RunnerFailure("工作流程不支持名称带换行符的输入文件，没有执行。")
            }
            pathBytes += path.utf8.count + 1
            guard pathBytes <= 1_048_576 else { throw RunnerFailure("输入路径总长度超过 1 MiB（1048576 字节），没有执行。") }
            paths.append(path)
        }
        if workflow {
            return .init(executable: URL(fileURLWithPath: "/usr/bin/automator"),
                         arguments: ["-i", "-", request.script.path],
                         standardInput: Data((paths.isEmpty ? "" : paths.joined(separator: "\n") + "\n").utf8))
        }
        guard (try? request.script.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
            throw RunnerFailure("Shell（命令）脚本须为普通文件，不能把文件夹交给解释器。")
        }
        return .init(executable: URL(fileURLWithPath: "/bin/sh"), arguments: [request.script.path] + paths,
                     standardInput: nil)
    }

    // All process, pipe, timer, and continuation state is confined to this private serial queue.
    private final class Operation: @unchecked Sendable {
        private let queue = DispatchQueue(label: "com.wisp.shelf.script." + UUID().uuidString, qos: .utility)
        private let request: ShelfScriptRequest
        private let process = Process()
        private let outputPipe = Pipe()
        private let errorPipe = Pipe()
        private var readSources: [Int32: DispatchSourceRead] = [:]
        private var timeoutTimer: DispatchSourceTimer?
        private var killTimer: DispatchSourceTimer?
        private var outputTimer: DispatchSourceTimer?
        private let onOutput: (@Sendable (ShelfScriptOutputSnapshot) -> Void)?
        private var outputChanged = false
        private var inputHandle: FileHandle?
        private var inputDirectory: URL?
        private var continuation: CheckedContinuation<ShelfScriptResult, Error>?
        private var output = Data()
        private var errors = Data()
        private var startedAt: DispatchTime?
        private var stopReason: ShelfScriptTermination?
        private var failureMessage: String?
        private var cancelledBeforeStart = false
        private var finished = false

        init(_ request: ShelfScriptRequest, onOutput: (@Sendable (ShelfScriptOutputSnapshot) -> Void)?) {
            self.request = request
            self.onOutput = onOutput
        }

        func start(_ continuation: CheckedContinuation<ShelfScriptResult, Error>) {
            queue.async { [self] in
                self.continuation = continuation
                guard !cancelledBeforeStart else { fail(CancellationError()); return }
                do {
                    let plan = try ShelfScriptRunner.plan(request)
                    process.executableURL = plan.executable
                    process.arguments = plan.arguments
                    process.currentDirectoryURL = request.currentDirectory
                    process.standardOutput = outputPipe
                    process.standardError = errorPipe
                    process.standardInput = FileHandle.nullDevice
                    if let input = plan.standardInput {
                        // A private input file avoids blocking a pipe writer when a workflow never reads input.
                        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("WispShelfScriptInput-" + UUID().uuidString)
                        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                               attributes: [.posixPermissions: 0o700])
                        inputDirectory = directory
                        let file = directory.appendingPathComponent("paths")
                        guard FileManager.default.createFile(atPath: file.path, contents: input,
                                                             attributes: [.posixPermissions: 0o600]) else {
                            throw RunnerFailure("无法准备工作流程的输入路径，没有执行。")
                        }
                        inputHandle = try FileHandle(forReadingFrom: file)
                        process.standardInput = inputHandle
                    }
                    try watch(outputPipe.fileHandleForReading, isError: false)
                    try watch(errorPipe.fileHandleForReading, isError: true)
                    process.terminationHandler = { [weak self] _ in
                        guard let self else { return }
                        self.queue.async { self.completed() }
                    }
                    startedAt = .now()
                    try process.run()
                    try? outputPipe.fileHandleForWriting.close()
                    try? errorPipe.fileHandleForWriting.close()
                    try? inputHandle?.close()
                    inputHandle = nil
                    if onOutput != nil {
                        let updates = DispatchSource.makeTimerSource(queue: queue)
                        updates.schedule(deadline: .now() + 0.05, repeating: 0.05)
                        updates.setEventHandler { [weak self] in self?.publishOutput() }
                        outputTimer = updates
                        updates.resume()
                    }
                    let timer = DispatchSource.makeTimerSource(queue: queue)
                    timer.schedule(deadline: .now() + request.timeoutSeconds)
                    timer.setEventHandler { [weak self] in self?.requestStop(.timedOut) }
                    timeoutTimer = timer
                    timer.resume()
                } catch {
                    fail(RunnerFailure("无法启动脚本：" + error.localizedDescription))
                }
            }
        }

        func cancel() {
            queue.async { [self] in
                guard !finished else { return }
                if startedAt == nil { cancelledBeforeStart = true }
                else { requestStop(.cancelled) }
            }
        }

        private func watch(_ handle: FileHandle, isError: Bool) throws {
            let descriptor = handle.fileDescriptor
            let flags = fcntl(descriptor, F_GETFL)
            guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else {
                throw RunnerFailure("无法建立非阻塞脚本输出读取，没有执行。")
            }
            let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
            source.setEventHandler { [weak self] in self?.drain(handle, isError: isError) }
            readSources[descriptor] = source
            source.resume()
        }

        private func drain(_ handle: FileHandle, isError: Bool) {
            guard !finished else { return }
            var buffer = [UInt8](repeating: 0, count: 16_384)
            // Bound each event so an endlessly writing child cannot starve the timeout timer.
            for _ in 0..<64 {
                let count = buffer.withUnsafeMutableBytes { Darwin.read(handle.fileDescriptor, $0.baseAddress, $0.count) }
                if count > 0 {
                    let remaining = request.maxOutputBytes - output.count - errors.count
                    let kept = min(count, remaining)
                    if kept > 0 {
                        if isError { errors.append(contentsOf: buffer.prefix(kept)) }
                        else { output.append(contentsOf: buffer.prefix(kept)) }
                        outputChanged = true
                    }
                    if kept < count { requestStop(.outputLimitExceeded) }
                } else if count == 0 {
                    readSources[handle.fileDescriptor]?.cancel()
                    return
                }
                else if errno == EINTR { continue }
                else if errno == EAGAIN || errno == EWOULDBLOCK { return }
                else {
                    failureMessage = "读取脚本输出失败：" + String(cString: strerror(errno))
                    requestStop(.ioFailed)
                    return
                }
            }
        }

        private func requestStop(_ reason: ShelfScriptTermination) {
            guard !finished else { return }
            if stopReason == nil {
                stopReason = reason
                if reason == .outputLimitExceeded { outputChanged = true }
            }
            guard process.isRunning, killTimer == nil else { return }
            process.terminate()
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + request.terminationGraceSeconds, repeating: .seconds(1))
            timer.setEventHandler { [weak self] in
                guard let self, !self.finished, self.process.isRunning else { return }
                _ = Darwin.kill(self.process.processIdentifier, SIGKILL)
            }
            killTimer = timer
            timer.resume()
        }

        private func completed() {
            guard !finished else { return }
            // Read buffered bytes without waiting for EOF; a script's descendant may retain the pipe.
            drain(outputPipe.fileHandleForReading, isError: false)
            drain(errorPipe.fileHandleForReading, isError: true)
            publishOutput()
            let termination = stopReason ?? (process.terminationReason == .exit ? .exited : .signalled)
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - (startedAt ?? .now()).uptimeNanoseconds) / 1_000_000_000
            let result = ShelfScriptResult(standardOutput: output, standardError: errors,
                                          exitCode: process.terminationStatus, termination: termination,
                                          durationSeconds: elapsed, message: message(termination))
            finished = true
            cleanup()
            let completion = continuation
            continuation = nil
            completion?.resume(returning: result)
        }

        private func fail(_ error: Error) {
            guard !finished else { return }
            finished = true
            cleanup()
            let completion = continuation
            continuation = nil
            completion?.resume(throwing: error)
        }

        private func cleanup() {
            timeoutTimer?.cancel()
            killTimer?.cancel()
            outputTimer?.cancel()
            for source in readSources.values { source.cancel() }
            readSources.removeAll()
            process.terminationHandler = nil
            try? outputPipe.fileHandleForReading.close()
            try? outputPipe.fileHandleForWriting.close()
            try? errorPipe.fileHandleForReading.close()
            try? errorPipe.fileHandleForWriting.close()
            try? inputHandle?.close()
            inputHandle = nil
            if let directory = inputDirectory { try? FileManager.default.removeItem(at: directory) }
            inputDirectory = nil
        }

        private func message(_ termination: ShelfScriptTermination) -> String {
            switch termination {
            case .exited: return process.terminationStatus == 0 ? "脚本主进程已完成" : "脚本主进程退出，返回码 \(process.terminationStatus)"
            case .signalled: return "脚本主进程被系统信号结束（\(process.terminationStatus)）；独立后台进程不保证停止。"
            case .timedOut: return "脚本主进程超过 \(request.timeoutSeconds) 秒，已停止；输出保留，独立后台进程不保证停止。"
            case .outputLimitExceeded: return "脚本主进程输出超过 \(request.maxOutputBytes) 字节，已停止；仅保留上限内输出，独立后台进程不保证停止。"
            case .cancelled: return "脚本主进程已取消并停止；已捕获输出保留。另行启动的独立进程不保证停止。"
            case .ioFailed: return (failureMessage ?? "脚本输出读取失败") + "；主进程已停止，独立后台进程不保证停止。"
            }
        }

        private func publishOutput() {
            guard !finished, outputChanged, let onOutput else { return }
            outputChanged = false
            onOutput(ShelfScriptOutputSnapshot(standardOutput: output, standardError: errors,
                outputLimitReached: stopReason == .outputLimitExceeded))
        }
    }
}

private struct RunnerFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
