import Foundation

/// 悬浮窗落点计算。A1/B1：所有「从停靠态恢复悬浮窗」的路径都要把窗口抬离屏幕边
/// 至少 `edgeLift`——12px 吸附圈的 3 倍多，否则恢复的窗口还停在贴边原位上，
/// 用户一拖又会被 `dockIfNearEdge` 吸回去，等于停靠没有出口。
public enum ShelfWindowPlacement {
    public static let edgeLift: CGFloat = 40

    /// 把 `proposed` 原点抬离 `visible` 任一边至少 `edgeLift`。
    ///
    /// 某一轴放不下「屏内缩 2×edgeLift」的窗口（极小屏、或窗口比屏-80 还大）时，
    /// 该轴退回居中兜底，保证窗口仍然完整可见、可抓取。
    public static func liftedOrigin(size: CGSize, proposed: CGPoint, visible: CGRect) -> CGPoint {
        func axis(_ origin: CGFloat, _ length: CGFloat, _ minimum: CGFloat, _ maximum: CGFloat) -> CGFloat {
            // 这一轴内缩 40px 后放不下（极小屏、或窗口比「屏-80」还大）：退回居中兜底。
            // (minimum + maximum) / 2 恒等于该轴中点，所以两种放不下都落在同一公式上。
            guard minimum <= maximum, length <= maximum - minimum else {
                return (minimum + maximum) / 2 - length / 2
            }
            return min(max(origin, minimum), maximum - length)
        }
        return CGPoint(
            x: axis(proposed.x, size.width, visible.minX + edgeLift, visible.maxX - edgeLift),
            y: axis(proposed.y, size.height, visible.minY + edgeLift, visible.maxY - edgeLift)
        )
    }
}
