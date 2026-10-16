import AppKit
import SwiftUI

/// #25：WispShelfShare.appex 的入口与主类。
///
/// appex 的 main 等价于系统模板里的 NSApplicationMain（本项目无 nib 无 delegate，
/// 二者都归结为「拿到共享 NSApplication 再 run」）。NSApplication 跑起来之后，
/// 扩展托管按 Info.plist 的 NSExtensionPrincipalClass 实例化 ShareViewController、
/// 挂上系统给的分享窗口；收尾由视图通过 NSExtensionContext 完成。
@main
enum WispShelfShareMain {
    static func main() {
        let application = NSApplication.shared
        application.run()
    }
}

/// NSExtension 主类：宿主 SwiftUI 确认页，交接动作经闭包进 NSExtensionContext。
final class ShareViewController: NSViewController {
    private var model: ShareModel?

    override func loadView() {
        let context = extensionContext
        let model = ShareModel(
            opener: { url in
                await context?.open(url) ?? false
            },
            complete: {
                context?.completeRequest(returningItems: nil, completionHandler: nil)
            },
            cancel: {
                // 本 SDK 未把 NSExtensionErrorDomain 暴露给 Swift；用户取消语义
                // 用 Foundation 的 NSUserCancelledError 表达即可，宿主只看取消事实。
                context?.cancelRequest(withError: NSError(
                    domain: "com.wisp.app.shelfshare",
                    code: NSUserCancelledError))
            }
        )
        self.model = model
        view = NSHostingView(rootView: ShareScene(model: model))
        // 场景内容 340×460 + 四周 16pt 留白。
        preferredContentSize = NSSize(width: 372, height: 492)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.compactMap(\.attachments).flatMap { $0 }
        model?.load(inputProviders: providers)
    }
}
