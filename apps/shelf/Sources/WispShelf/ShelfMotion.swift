import AppKit
import QuartzCore
import SwiftUI

enum ShelfMotion {
    enum Role {
        case feedback, state, receipt, panelEnter, panelExit, docking

        var duration: TimeInterval {
            switch self {
            case .feedback: return 0.12
            case .state: return 0.18
            case .receipt: return 0.20
            case .panelEnter: return 0.20
            case .panelExit: return 0.14
            case .docking: return 0.22
            }
        }

        var curve: (Float, Float, Float, Float) {
            switch self {
            case .feedback: return (0.20, 0.0, 0.20, 1.0)
            case .state, .docking: return (0.25, 0.10, 0.25, 1.0)
            case .receipt, .panelEnter: return (0.16, 1.0, 0.30, 1.0)
            case .panelExit: return (0.40, 0.0, 1.0, 1.0)
            }
        }
    }

    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    static func duration(_ role: Role) -> TimeInterval { reduceMotion ? 0 : role.duration }

    static func timingFunction(_ role: Role) -> CAMediaTimingFunction {
        let curve = role.curve
        return CAMediaTimingFunction(controlPoints: curve.0, curve.1, curve.2, curve.3)
    }

    /// 架子出现时驱动【窗口外框】从几乎为零弹到目标尺寸。
    ///
    /// 参考应用实测（120Hz 抓帧）：外框 4×5 → 232×241 → 198×207，约 360ms、19 帧，
    /// 峰值比终态大约 17%。阻尼比 ζ 与超调的关系是 e^(-πζ/√(1-ζ²))，ζ=0.5 正好
    /// 约 16%；再由峰值时刻反推 ω₀≈19.1 rad/s 得到刚度 190、阻尼 13.1。
    ///
    /// 两条踩过的坑，都写在下面：
    /// 1. 定时器回调里不能再包一层 `Task { @MainActor }`。定时器本来就挂在主
    ///    RunLoop 上，多这一跳异步会被推迟到主线程空下来才跑。
    /// 2. 主线程忙的时候（应用启动那一刻）120Hz 定时器挤不进来，首帧实测迟到
    ///    660ms，早过了收尾线，于是动画一帧不播、架子直接"啪"一下出现。
    ///    这里接受这个降级——最坏是少一段动画，而不是架子出问题。
    ///    试过改用 `animator().setFrame` 让 Core Animation 驱动，结果更糟：
    ///    这种无边框非激活面板上它根本不动，架子会长时间不可见。已撤回。
    @MainActor
    final class WindowPop {
        private let mass = 1.0
        private let stiffness = 190.0
        private let damping = 13.1
        private weak var window: NSWindow?
        private var timer: Timer?
        private var start: CFTimeInterval = 0
        private var from = NSRect.zero
        private var to = NSRect.zero

        func run(_ window: NSWindow, to target: NSRect) {
            stop()
            guard !reduceMotion, target.width > 1, target.height > 1 else { return }
            self.window = window
            self.to = target
            self.from = NSRect(
                x: target.midX - target.width * 0.02,
                y: target.midY - target.height * 0.02,
                width: max(target.width * 0.02, 1),
                height: max(target.height * 0.02, 1)
            )
            window.setFrame(from, display: true)
            start = CACurrentMediaTime()
            tick()
            let t = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] _ in
                self?.tick()
            }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        }

        /// 中断也要落帧。动画跑到一半被 stop() 掐断时，窗口会停在某个中间帧上——
        /// 欠阻尼弹簧的中间帧和终态差几个百分点，架子的大小就永久性地小了一圈
        ///（实测重启一次 200×208 变成 196×204，正好是 98%）。反复重启就会漂。
        /// 所以 stop 不只是"关掉定时器"，还得把目标帧真正提交上去。
        func stop() {
            timer?.invalidate(); timer = nil
            if let window, to.width > 1, to.height > 1 { window.setFrame(to, display: true) }
            window = nil
        }

        private func tick() {
            guard let window else { return stop(); return }
            let t = CACurrentMediaTime() - start
            let value = Self.displacement(at: t, mass: mass, stiffness: stiffness, damping: damping)
            window.setFrame(Self.frame(from: from, to: to, value: value), display: true)
            // 落定后必须把目标帧真正写回去。少了这一句，窗口会永远停在最后一个
            // 动画中间帧上——欠阻尼弹簧在 0.6s 时还有约 2% 的残振，于是每次启动
            // 架子都会差几像素，而这个差值又被保存进存档，下一次启动从偏差处
            // 继续动画、再差几像素。反复重启下来架子会一路漂出屏幕。
            if t > 0.6 { window.setFrame(to, display: true); stop() }
        }

        private static func frame(from: NSRect, to: NSRect, value: CGFloat) -> NSRect {
            // 注意 NSRect 的 x/y 是「左下角」，不是中心点。直接把插值后的 midX/midY
            // 塞进 x/y，等于把窗口的左边缘钉在目标中心上：动画期间架子会整体往右
            // 窜出屏幕（实测峰值帧 x=1820、宽 232），落定那一帧才弹回来。
            let midX = from.midX + (to.midX - from.midX) * value
            let midY = from.midY + (to.midY - from.midY) * value
            let width = from.width + (to.width - from.width) * value
            let height = from.height + (to.height - from.height) * value
            return NSRect(x: midX - width / 2, y: midY - height / 2, width: width, height: height)
        }

        /// 欠阻尼谐振子的归一化位移：0 = 起点，1 = 目标，可超过 1。
        private static func displacement(at t: CFTimeInterval, mass: Double, stiffness: Double, damping: Double) -> CGFloat {
            let w0 = (stiffness / mass).squareRoot()
            let zeta = damping / (2 * (stiffness * mass).squareRoot())
            let wd = w0 * (1 - zeta * zeta).squareRoot()
            return 1 - exp(-zeta * w0 * t) * (cos(wd * t) + (zeta * w0 / wd) * sin(wd * t))
        }
    }

    static func animation(_ role: Role, reduceMotion requestedReduction: Bool = false) -> Animation? {
        guard !requestedReduction, !reduceMotion else { return nil }
        let curve = role.curve
        return .timingCurve(Double(curve.0), Double(curve.1), Double(curve.2), Double(curve.3), duration: role.duration)
    }

    static func opacity(_ layer: CALayer, to target: Float, role: Role = .feedback,
                        key: String = "shelfMotion.opacity") {
        let current = layer.presentation()?.opacity ?? layer.opacity
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.opacity = target
        CATransaction.commit()
        layer.removeAnimation(forKey: key)
        guard !reduceMotion, abs(current - target) > 0.001 else { return }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = current
        fade.toValue = target
        fade.duration = role.duration
        fade.timingFunction = timingFunction(role)
        layer.add(fade, forKey: key)
    }

    static func arrive(_ view: NSView, role: Role = .receipt, offset: CGFloat = 4,
                       scale: CGFloat = 1, key: String = "shelfMotion.arrival") {
        view.wantsLayer = true
        guard let layer = view.layer else { return }
        let active = layer.animation(forKey: key) != nil
        let targetOpacity = layer.opacity
        let targetTransform = layer.transform
        let initialTransform = CATransform3DScale(CATransform3DTranslate(targetTransform, 0, offset, 0), scale, scale, 1)
        let fromOpacity = active ? (layer.presentation()?.opacity ?? targetOpacity) : 0
        let fromTransform = active ? (layer.presentation()?.transform ?? targetTransform) : initialTransform
        transition(layer, fromOpacity: fromOpacity, toOpacity: targetOpacity,
                   fromTransform: fromTransform, toTransform: targetTransform, role: role, key: key)
    }

    // Only the presentation layer moves; layout and native dragging rectangles stay fixed.
    fileprivate static func transition(_ layer: CALayer, fromOpacity: Float, toOpacity: Float,
                                      fromTransform: CATransform3D, toTransform: CATransform3D,
                                      role: Role, key: String, completion: (() -> Void)? = nil) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.opacity = toOpacity
        layer.transform = toTransform
        CATransaction.commit()
        layer.removeAnimation(forKey: key)
        guard !reduceMotion else { completion?(); return }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = fromOpacity
        fade.toValue = toOpacity
        let movement = CABasicAnimation(keyPath: "transform")
        movement.fromValue = NSValue(caTransform3D: fromTransform)
        movement.toValue = NSValue(caTransform3D: toTransform)
        let group = CAAnimationGroup()
        group.animations = [fade, movement]
        group.duration = role.duration
        group.timingFunction = timingFunction(role)
        CATransaction.begin()
        CATransaction.setCompletionBlock(completion)
        layer.add(group, forKey: key)
        CATransaction.commit()
    }
}

@MainActor
final class ShelfPanelMotionController {
    private weak var window: NSWindow?
    private weak var animatedLayer: CALayer?
    private var restingTransform = CATransform3DIdentity
    private var generation = 0
    private var visible = false
    private var transitioningOut = false
    private var concealCompletion: (() -> Void)?
    private var accessibilityObserver: NSObjectProtocol?
    private let key = "shelfMotion.panel"
    private lazy var pop = ShelfMotion.WindowPop()

    init(window: NSWindow) {
        self.window = window
        visible = window.isVisible
        accessibilityObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.finishIfReduced() }
        }
    }

    deinit {
        if let accessibilityObserver { NSWorkspace.shared.notificationCenter.removeObserver(accessibilityObserver) }
    }

    func reveal(order: (() -> Void)? = nil) {
        guard let window else { return }
        if visible, !transitioningOut, window.isVisible {
            if ShelfMotion.reduceMotion { finishIfReduced() }
            if let order { order() } else { window.orderFrontRegardless() }
            return
        }
        let entering = !window.isVisible
        visible = true
        transitioningOut = false
        generation += 1
        concealCompletion = nil
        window.alphaValue = 1
        guard let layer = contentLayer else {
            if let order { order() } else { window.orderFrontRegardless() }
            return
        }
        let opacity = entering ? Float(0) : (layer.presentation()?.opacity ?? layer.opacity)
        let targetTransform = restingTransform
        let transform = entering ? CATransform3DTranslate(targetTransform, 0, 4, 0) : (layer.presentation()?.transform ?? targetTransform)
        if let order { order() } else { window.orderFrontRegardless() }
        guard entering || layer.animation(forKey: key) != nil || layer.opacity < 0.999 else { return }
        if entering {
            // 出现时动的是【窗口外框】本身：参考应用实测 4×5 → 232×241 → 198×207，
            // 约 360ms、峰值超调 17%。这里用同样反推出来的弹簧驱动整块窗口长大，
            // 里面那一层只保留透明度过渡。
            pop.run(window, to: window.frame)
        }
        ShelfMotion.transition(layer, fromOpacity: opacity, toOpacity: 1,
                               fromTransform: transform, toTransform: targetTransform,
                               role: .panelEnter, key: key)
    }

    func hideImmediately() {
        pop.stop()
        generation += 1
        visible = false
        transitioningOut = false
        concealCompletion = nil
        window?.orderOut(nil)
        window?.alphaValue = 1
        resetPresentation()
    }

    func conceal(completion: (() -> Void)? = nil) {
        guard let window else { completion?(); return }
        if transitioningOut {
            if let completion { concealCompletion = completion }
            return
        }
        visible = false
        generation += 1
        let token = generation
        concealCompletion = completion
        pop.stop()
        guard window.isVisible, let layer = contentLayer else { finishConceal(token); return }
        transitioningOut = true
        let opacity = layer.presentation()?.opacity ?? layer.opacity
        let transform = layer.presentation()?.transform ?? layer.transform
        ShelfMotion.transition(layer, fromOpacity: opacity, toOpacity: 0,
                               fromTransform: transform, toTransform: restingTransform,
                               role: .panelExit, key: key) { [weak self] in
            // Cancelled animations also finish their transaction; an old callback must not hide a reopened panel.
            Task { @MainActor [weak self] in self?.finishConceal(token) }
        }
    }

    private var contentLayer: CALayer? {
        window?.contentView?.wantsLayer = true
        guard let layer = window?.contentView?.layer else { return nil }
        if animatedLayer !== layer {
            animatedLayer = layer
            restingTransform = layer.transform
        }
        return layer
    }

    private func resetPresentation() {
        guard let layer = contentLayer else { return }
        layer.removeAnimation(forKey: key)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.opacity = 1
        layer.transform = restingTransform
        CATransaction.commit()
    }

    private func finishConceal(_ token: Int) {
        guard generation == token, !visible else { return }
        transitioningOut = false
        window?.orderOut(nil)
        resetPresentation()
        let completion = concealCompletion
        concealCompletion = nil
        completion?()
    }

    private func finishIfReduced() {
        guard ShelfMotion.reduceMotion else { return }
        if visible {
            resetPresentation()
        } else { finishConceal(generation) }
    }
}
