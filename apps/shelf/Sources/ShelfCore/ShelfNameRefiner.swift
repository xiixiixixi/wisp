import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// #9：FoundationModels 智能命名升级。
///
/// 仅当系统模型可用（macOS 26+ 且 Apple 就绪）时，对**新架首批文件**的文件名集合
/// 生成描述性架子名（≤12 字）；模型不可用、响应不合格或运行失败一律返回 nil，
/// 调用方（ShelfStore.add）静默保留现有规则名。总闸仍是 intelligentShelfName 设置。
/// 链接侧由 Package.swift 的 -weak_framework FoundationModels 保底：老系统上
/// 弱符号解析为 NULL，代码路径被下面的 canImport/@available 双门挡住。
public enum ShelfNameRefiner {
    /// 建议名的长度上限（按字素计）。
    public static let maxLength = 12
    /// 模型明确表示「没有明显共同主题」的哨兵词。
    static let skipSentinel = "跳过"

    /// 生成入口。任何一步失败都返回 nil（回退规则名），绝不抛错打扰收集流程。
    public static func generate(for fileNames: [String]) async -> String? {
        // 单元测试必须离线确定性——这里不该出现真模型调用。
        guard NSClassFromString("XCTestCase") == nil, !fileNames.isEmpty else { return nil }
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            return sanitize(await describe(fileNames: Array(fileNames.prefix(40))))
        }
        #endif
        return nil
    }

    #if canImport(FoundationModels)
    @available(macOS 26, *)
    private static func describe(fileNames: [String]) async -> String? {
        do {
            let model = SystemLanguageModel.default
            guard model.isAvailable else { return nil }
            let session = LanguageModelSession(model: model)
            let prompt = """
            下面是用户一次性拖入文件收集架的文件名列表。请为这批文件起一个简短的中文架子名。
            要求：
            - 不超过 \(maxLength) 个字，概括这批文件的共同主题（例如「发票截图」「设计稿」「会议记录」）。
            - 只输出名字本身，不要引号、不要标点、不要任何解释。
            - 如果文件之间看不出明显共同主题，只输出三个字：\(skipSentinel)
            文件名列表：
            \(fileNames.joined(separator: "\n"))
            """
            let response = try await session.respond(to: prompt)
            return response.content
        } catch { return nil }
    }
    #endif

    /// 输出修剪：去包裹引号/书名号与结尾句读、压掉换行；空、「跳过」或超长返回 nil
    /// （= 保留规则名）。公开纯函数，修剪规则直接单测。
    public static func sanitize(_ raw: String?) -> String? {
        guard var text = raw?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        for wrapper in ["「", "」", "“", "”", "《", "》", "\"", "'"] {
            text = text.replacingOccurrences(of: wrapper, with: "")
        }
        while let last = text.last, "。，,.！!？?：:；; ".contains(last) { text.removeLast() }
        text = text
            .components(separatedBy: .newlines).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text != skipSentinel, text.count <= maxLength else { return nil }
        return text
    }
}
