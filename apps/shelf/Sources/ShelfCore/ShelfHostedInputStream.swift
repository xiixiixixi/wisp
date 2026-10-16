import Foundation
import Darwin

public final class ShelfHostedInputStream: @unchecked Sendable {
    public static let maximumLineBytes = 2 * 1024 * 1024
    private let descriptor: Int32
    private let onLine: (Data) -> Void
    private let onEnd: () -> Void

    public init(descriptor: Int32 = STDIN_FILENO, onLine: @escaping (Data) -> Void, onEnd: @escaping () -> Void) {
        self.descriptor = descriptor; self.onLine = onLine; self.onEnd = onEnd
    }

    public func start() {
        DispatchQueue(label: "com.wisp.shelf.hosted.input").async { [self] in
            var buffer = Data()
            var chunk = [UInt8](repeating: 0, count: 16 * 1024)
            while true {
                // A live pipe must deliver each small request without waiting for EOF or a full buffer.
                let count = chunk.withUnsafeMutableBytes { bytes in
                    Darwin.read(descriptor, bytes.baseAddress, bytes.count)
                }
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { break }
                buffer.append(contentsOf: chunk.prefix(count))
                while let newline = buffer.firstIndex(of: 10) {
                    let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
                    guard line.count <= Self.maximumLineBytes else { onEnd(); return }
                    if !line.isEmpty { onLine(line) }
                }
                guard buffer.count <= Self.maximumLineBytes else { onEnd(); return }
            }
            onEnd()
        }
    }
}
