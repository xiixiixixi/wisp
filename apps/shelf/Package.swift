// swift-tools-version: 5.9
import PackageDescription
import Foundation

// #9：FoundationModels 弱链接。链接标志只有在当前工具链认识这个 framework 时才能给
// （老 SDK 上连 tbd 都找不到，加了反而链接失败），源码侧由同一道 canImport 门同步关闭；
// 两道门一起保证：老系统上运行时弱符号解析为 NULL、被 @available 挡住不进任何代码路径。
let foundationModelsLinker: [LinkerSetting] = {
    #if canImport(FoundationModels)
    return [.unsafeFlags(["-weak_framework", "FoundationModels"])]
    #else
    return []
    #endif
}()

let package = Package(
    name: "WispShelf",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "WispShelf", targets: ["WispShelf"]), .library(name: "ShelfCore", targets: ["ShelfCore"])],
    targets: [
        .target(name: "ShelfCore", linkerSettings: foundationModelsLinker),
        .executableTarget(name: "WispShelf", dependencies: ["ShelfCore"], linkerSettings: foundationModelsLinker),
        // #82：桌面小组件扩展。SwiftPM 只负责编出可执行文件；.appex 外壳
        // （Info.plist + 签名）由 build-widget.sh 手工组装，产物嵌进主 Wisp.app。
        .executableTarget(name: "WispShelfWidget", dependencies: ["ShelfCore"], linkerSettings: foundationModelsLinker),
        // #25：分享扩展。刻意不依赖 ShelfCore——appex 只要「分类→物化 inbox→
        // collect 交接」的最小逻辑，语义对齐 ShareIntake 注释所列的各处常量。
        // .appex 外壳由 build-share.sh 组装，与小组件同一套嵌入方式。
        .executableTarget(name: "WispShelfShare"),
        .testTarget(name: "ShelfCoreTests", dependencies: ["ShelfCore"], linkerSettings: foundationModelsLinker),
        .testTarget(name: "WispShelfInteractionTests", dependencies: ["WispShelf", "ShelfCore"], linkerSettings: foundationModelsLinker),
        .testTarget(name: "WispShelfShareTests", dependencies: ["WispShelfShare"]),
    ]
)
