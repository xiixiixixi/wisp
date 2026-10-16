import Foundation

public enum ShelfDetailLayout {
    /// 内容面板摆在哪。
    ///
    /// **参考应用实测**：点底部胶囊之后，架子是**同一个窗口原地长大**，不是旁边
    /// 弹出一个新窗口——(1393,347) 198×207 变成 (1292,298) 400×304，
    /// 前后中心点 (1492, 450.5) 一模一样，宽高各涨了 202 / 97。
    /// 所以这里返回的是「和架子同心、只放大不挪窝」的位置，夹回屏幕内即可。
    ///
    /// 屏幕实在放不下 400×304（`area` 比它还小）时，退回原来的"贴着架子摆到
    /// 旁边"，至少保证控制项还在屏幕里。
    public static func frame(anchor: CGRect, proposed: CGSize, visible: CGRect) -> CGRect {
        let area = visible.insetBy(dx: 4, dy: 4)
        let gap: CGFloat = 8
        let size = CGSize(width: min(proposed.width, area.width), height: min(proposed.height, area.height))
        if size.width >= anchor.width - 1, size.height >= anchor.height - 1 {
            return CGRect(
                x: clamp(anchor.midX - size.width / 2, low: area.minX, high: area.maxX - size.width),
                y: clamp(anchor.midY - size.height / 2, low: area.minY, high: area.maxY - size.height),
                width: size.width, height: size.height
            )
        }
        var fitted = size
        let below = max(0, anchor.minY - area.minY - gap)
        let above = max(0, area.maxY - anchor.maxY - gap)
        if max(below, above) >= min(180, fitted.height) {
            let useBelow = below >= fitted.height || below >= above
            fitted.height = min(fitted.height, useBelow ? below : above)
            return CGRect(x: clamp(anchor.midX - fitted.width / 2, low: area.minX, high: area.maxX - fitted.width),
                          y: useBelow ? anchor.minY - gap - fitted.height : anchor.maxY + gap,
                          width: fitted.width, height: fitted.height)
        }
        let left = max(0, anchor.minX - area.minX - gap)
        let right = max(0, area.maxX - anchor.maxX - gap)
        if max(left, right) >= min(320, fitted.width) {
            let useRight = right >= fitted.width || right >= left
            fitted.width = min(fitted.width, useRight ? right : left)
            return CGRect(x: useRight ? anchor.maxX + gap : anchor.minX - gap - fitted.width,
                          y: clamp(anchor.midY - fitted.height / 2, low: area.minY, high: area.maxY - fitted.height),
                          width: fitted.width, height: fitted.height)
        }
        // A display smaller than both surfaces cannot keep them separate; keep controls on screen.
        return CGRect(x: clamp(anchor.midX - fitted.width / 2, low: area.minX, high: area.maxX - fitted.width),
                      y: clamp(anchor.minY - gap - fitted.height, low: area.minY, high: area.maxY - fitted.height),
                      width: fitted.width, height: fitted.height)
    }
    /// 架子收起时的起始矩形：内容面板从架子原来的位置开始放大。
    public static func collapsedFrame(anchor: CGRect) -> CGRect { anchor }
    private static func clamp(_ value: CGFloat, low: CGFloat, high: CGFloat) -> CGFloat {
        min(max(value, low), max(low, high))
    }
}
