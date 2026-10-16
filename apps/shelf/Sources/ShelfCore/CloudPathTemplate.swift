import Foundation

/// #63：上传对象键的路径模板（S3/对象存储）。占位符只有 {filename} 与 {date}；
/// 校验文案照 Dropover 句式：不能以“/”开头、禁双斜杠与 ?*\ 字符、首尾无空白。
public enum CloudPathTemplate {
    public static let defaultTemplate = "{filename}"
    public static let placeholders = ["{filename}", "{date}"]
    /// 模板示例（设置页与校验提示共用同一句）。
    public static let example = "photos/{date}/{filename}"

    /// 返回 nil 表示合法；否则返回可直接展示的错误文案。
    public static func validationError(for template: String) -> String? {
        guard !template.isEmpty else { return "上传路径模板不能为空。" }
        guard template == template.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return "上传路径模板首尾不能有空格。"
        }
        guard !template.hasPrefix("/") else { return "上传路径模板不能以“/”开头。" }
        guard !template.contains("//") else { return "上传路径模板不能包含连续的“/”。" }
        let forbidden = CharacterSet(charactersIn: "?*\\")
        guard template.unicodeScalars.allSatisfy({ !forbidden.contains($0) }) else {
            return "上传路径模板不能包含“?”“*”“\\”字符。"
        }
        var remaining = Substring(template)
        while let opening = remaining.range(of: "{") {
            guard let closing = remaining[opening.upperBound...].range(of: "}") else {
                return "上传路径模板的可用占位符为 {filename} 和 {date}。"
            }
            guard placeholders.contains(String(remaining[opening.lowerBound..<closing.upperBound])) else {
                return "上传路径模板的可用占位符为 {filename} 和 {date}。"
            }
            remaining = remaining[closing.upperBound...]
        }
        return nil
    }

    /// 首尾去空白；空值回落 {filename}（旧档/清空输入的统一出口）。
    public static func normalized(_ template: String) -> String {
        let trimmed = template.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? defaultTemplate : trimmed
    }

    /// 按模板生成对象键：{filename} → 文件名（lastPathComponent，天然无斜杠），
    /// {date} → 上传当天日期（本机时区，yyyy-MM-dd）。日期分段可配合 "photos/{date}/…"。
    public static func objectKey(template: String, filename: String, date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return normalized(template)
            .replacingOccurrences(of: "{date}", with: formatter.string(from: date))
            .replacingOccurrences(of: "{filename}", with: filename)
    }
}

/// #64：预签名链接的到期档位（1 小时 / 1 天 / 7 天 / 30 天，默认 7 天）。
/// AWS 官方 S3 上限是 7 天；30 天档供兼容端点使用，官方端会在请求期拒绝。
public enum S3PresignExpiry {
    public static let tiers = ["1h", "1d", "7d", "30d"]
    public static let defaultTier = "7d"

    public static func normalize(_ value: String) -> String {
        tiers.contains(value) ? value : defaultTier
    }

    public static func seconds(for value: String) -> Int {
        switch normalize(value) {
        case "1h": return 3600
        case "1d": return 86_400
        case "30d": return 2_592_000
        default: return 604_800
        }
    }
}
