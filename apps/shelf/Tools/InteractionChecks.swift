import AppKit
import Darwin
import QuartzCore
import ShelfCore

// These windows never enter the Window Server's visible ordering list.
@MainActor
private final class InvisibleWindow: NSWindow {
    var simulatedVisible = false
    var frontCalls = 0
    var outCalls = 0

    override var isVisible: Bool { simulatedVisible }

    override func orderFrontRegardless() {
        frontCalls += 1
        simulatedVisible = true
    }

    override func orderOut(_ sender: Any?) {
        outCalls += 1
        simulatedVisible = false
    }
}

private final class CountingLayer: CALayer {
    private(set) var animationAdds: [String: Int] = [:]
    private(set) var animationRemovals: [String: Int] = [:]

    override func add(_ anim: CAAnimation, forKey key: String?) {
        if let key { animationAdds[key, default: 0] += 1 }
        super.add(anim, forKey: key)
    }

    override func removeAnimation(forKey key: String) {
        animationRemovals[key, default: 0] += 1
        super.removeAnimation(forKey: key)
    }
}

@MainActor
private struct PanelHarness {
    let window: InvisibleWindow
    let view: NSView
    let layer: CountingLayer
    let motion: ShelfPanelMotionController

    init(restingTransform: CATransform3D = CATransform3DIdentity) {
        window = InvisibleWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 208),
                                 styleMask: .borderless, backing: .buffered, defer: true)
        window.isReleasedWhenClosed = false
        view = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 208))
        view.wantsLayer = true
        layer = CountingLayer()
        layer.opacity = 1
        view.layer = layer
        window.contentView = view
        layer.transform = restingTransform
        motion = ShelfPanelMotionController(window: window)
    }
}

@main
@MainActor
private enum InteractionChecks {
    private static var passed = 0
    private static var failed = 0
    private static var skipped = 0

    static func main() async {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.prohibited)
        print("Native interaction checks; no desktop windows are shown.")
        print("OS: \(ProcessInfo.processInfo.operatingSystemVersionString)")
        print("Reduce Motion: \(ShelfMotion.reduceMotion)")
        checkSymbols()
        checkMotionModels()
        await checkPanels()
        print("SUMMARY: \(passed) passed, \(failed) failed, \(skipped) skipped.")
        print("BOUNDARY: Tests use real production symbol/motion code and invisible NSWindow/CALayer objects.")
        print("BOUNDARY: No desktop interaction, screen rendering, drag destination, frame-rate, or older macOS validation.")
        exit(failed == 0 ? 0 : 1)
    }

    private static func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        if condition() {
            passed += 1
            print("PASS: \(name)")
        } else {
            failed += 1
            print("FAIL: \(name)")
        }
    }

    private static func skip(_ name: String) {
        skipped += 1
        print("SKIP: \(name)")
    }

    private static func checkSymbols() {
        check("All semantic symbols have unique names",
              Set(ShelfSymbol.allCases.map(\.rawValue)).count == ShelfSymbol.allCases.count)
        for symbol in ShelfSymbol.allCases {
            let resolved = ShelfSymbols.name(symbol)
            let image = ShelfSymbols.image(symbol)
            check("Symbol \(symbol.rawValue) resolves to a usable template (\(resolved))",
                  resolved != "questionmark" && image != nil && image?.isTemplate == true)
        }
        for kind in ActionKind.allCases {
            let resolved = ShelfSymbols.action(kind)
            check("Action \(kind.rawValue) has a usable symbol (\(resolved))",
                  resolved != "questionmark" && ShelfSymbols.image(named: resolved) != nil)
        }
        let oldNames = ["minus.circle", "xmark.circle", "ellipsis.circle", "bolt.circle.fill",
                        "person.crop.circle", "square.stack.3d.up.fill", "cloud.fill", "stop.fill",
                        "play.fill", "airplay.audio", "checkmark.circle.fill",
                        "exclamationmark.circle.fill", "exclamationmark.triangle.fill"]
        check("Legacy tool names normalize without a missing-symbol placeholder",
              oldNames.allSatisfy { ShelfSymbols.name($0) != "questionmark" })
    }

    private static func checkMotionModels() {
        check("Explicit reduced motion disables SwiftUI animation",
              ShelfMotion.animation(.state, reduceMotion: true) == nil)
        let roles: [ShelfMotion.Role] = [.feedback, .state, .receipt, .panelEnter, .panelExit, .docking]
        check("Motion roles have bounded positive durations",
              roles.allSatisfy { $0.duration > 0 && $0.duration <= 0.25 })

        let layer = CountingLayer()
        layer.opacity = 0.8
        ShelfMotion.opacity(layer, to: 0.25)
        check("Opacity feedback writes its final model value immediately", near(layer.opacity, 0.25))
        ShelfMotion.opacity(layer, to: 0.65)
        check("Interrupted opacity feedback retains the new final model value", near(layer.opacity, 0.65))

        let view = NSView(frame: NSRect(x: 0, y: 0, width: 148, height: 102))
        view.wantsLayer = true
        let receiptLayer = CountingLayer()
        let resting = CATransform3DScale(CATransform3DIdentity, 0.98, 0.98, 1)
        receiptLayer.opacity = 0.83
        view.layer = receiptLayer
        receiptLayer.transform = resting
        let originalFrame = view.frame
        ShelfMotion.arrive(view, offset: 4, scale: 0.985)
        check("Receipt arrival preserves final model opacity", near(receiptLayer.opacity, 0.83))
        check("Receipt arrival preserves final model transform", CATransform3DEqualToTransform(receiptLayer.transform, resting))
        check("Receipt arrival leaves the drag hit rectangle unchanged", view.frame == originalFrame)
        if !ShelfMotion.reduceMotion {
            let group = receiptLayer.animation(forKey: "shelfMotion.arrival") as? CAAnimationGroup
            let fade = group?.animations?.first as? CABasicAnimation
            check("Receipt arrival uses the production receipt duration", group?.duration == ShelfMotion.Role.receipt.duration)
            check("First receipt arrives from transparent presentation", (fade?.fromValue as? NSNumber)?.floatValue == 0)
            ShelfMotion.arrive(view, offset: 4, scale: 0.985)
            let interrupted = receiptLayer.animation(forKey: "shelfMotion.arrival") as? CAAnimationGroup
            let interruptedFade = interrupted?.animations?.first as? CABasicAnimation
            check("Repeated receipt does not restart from fully transparent",
                  (interruptedFade?.fromValue as? NSNumber)?.floatValue != 0)
        } else {
            skip("Receipt animation timing and interruption (Reduce Motion is enabled)")
        }
        receiptLayer.removeAllAnimations()
    }

    private static func checkPanels() async {
        let key = "shelfMotion.panel"
        let harness = PanelHarness()
        let originalFrame = harness.window.frame
        harness.motion.reveal()
        let firstAdds = harness.layer.animationAdds[key, default: 0]
        let firstRemovals = harness.layer.animationRemovals[key, default: 0]
        for _ in 0..<10 { harness.motion.reveal() }
        check("Repeated reveal does not add another enter animation",
              harness.layer.animationAdds[key, default: 0] == firstAdds)
        check("Repeated reveal does not remove the active enter animation",
              harness.layer.animationRemovals[key, default: 0] == firstRemovals)
        check("Reveal leaves the panel frame and native hit rectangles fixed", harness.window.frame == originalFrame)
        check("Reveal orders the simulated panel visible with opaque final state",
              harness.window.isVisible && near(harness.layer.opacity, 1) && harness.window.alphaValue == 1)

        var cancelledCompletion = 0
        harness.motion.conceal { cancelledCompletion += 1 }
        harness.motion.reveal()
        await settle()
        check("Reopening during conceal is not hidden by an old animation callback", harness.window.isVisible)
        check("Reopening cancels the obsolete conceal completion", cancelledCompletion == 0)
        check("Reopening restores opaque final presentation", near(harness.layer.opacity, 1))

        var earlierCompletion = 0
        var newestCompletion = 0
        let beforeConcealOuts = harness.window.outCalls
        harness.motion.conceal { earlierCompletion += 1 }
        let concealAdds = harness.layer.animationAdds[key, default: 0]
        harness.motion.conceal { newestCompletion += 1 }
        check("Repeated conceal does not add another exit animation",
              harness.layer.animationAdds[key, default: 0] == concealAdds)
        await settle()
        check("A completed conceal really invokes the completion path",
              newestCompletion == 1 && earlierCompletion == 0)
        check("Completed conceal orders the panel out exactly once", harness.window.outCalls == beforeConcealOuts + 1)
        check("Completed conceal restores reusable opaque layer state",
              !harness.window.isVisible && near(harness.layer.opacity, 1) && harness.layer.animation(forKey: key) == nil)

        let resting = CATransform3DTranslate(CATransform3DIdentity, 2, -3, 0)
        let immediate = PanelHarness(restingTransform: resting)
        immediate.motion.reveal()
        var immediateCompletion = 0
        immediate.motion.conceal { immediateCompletion += 1 }
        immediate.layer.opacity = 0.2
        immediate.layer.transform = CATransform3DScale(resting, 0.9, 0.9, 1)
        immediate.window.alphaValue = 0.4
        immediate.motion.hideImmediately()
        let immediateOuts = immediate.window.outCalls
        check("Immediate hide removes the running panel animation", immediate.layer.animation(forKey: key) == nil)
        check("Immediate hide restores window and layer opacity",
              immediate.window.alphaValue == 1 && near(immediate.layer.opacity, 1))
        check("Immediate hide restores the original resting transform",
              CATransform3DEqualToTransform(immediate.layer.transform, resting))
        await settle()
        check("Immediate hide invalidates pending conceal callbacks",
              immediateCompletion == 0 && immediate.window.outCalls == immediateOuts && !immediate.window.isVisible)
        immediate.motion.reveal()
        check("Immediately hidden panels can be reopened", immediate.window.isVisible && near(immediate.layer.opacity, 1))
        immediate.motion.hideImmediately()
        harness.motion.hideImmediately()
    }

    private static func near(_ first: Float, _ second: Float) -> Bool { abs(first - second) < 0.0001 }

    private static func settle() async {
        CATransaction.flush()
        let deadline = Date().addingTimeInterval(0.45)
        while Date() < deadline {
            pumpRunLoop()
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    private static func pumpRunLoop() {
        RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    }
}
