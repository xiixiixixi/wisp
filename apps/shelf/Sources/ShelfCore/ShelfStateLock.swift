import Foundation
import Darwin

final class ShelfStateLock {
    private let descriptor: Int32

    init(directory: URL) throws {
        let path = directory.appendingPathComponent(".writer.lock").path
        descriptor = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw ShelfStorageError.unavailable }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw ShelfStorageError.alreadyOpen
        }
    }

    deinit {
        flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
    }
}

public enum ShelfStorageError: LocalizedError {
    case alreadyOpen, unavailable, saveFailed, nestedTransaction
    public var errorDescription: String? {
        switch self {
        case .alreadyOpen: return "收集架正在另一个进程中运行。请先退出独立收集架，再由 Wisp 打开。"
        case .unavailable: return "收集架清单暂时无法读写，原记录未被覆盖。"
        case .saveFailed: return "收集架清单未能保存，此次管理修改未提交。"
        case .nestedTransaction: return "收集架正在提交上一项修改，请稍后重试。"
        }
    }
}
