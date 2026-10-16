import AppKit
import ShelfCore
import SwiftUI

struct ShelfView: View {
  @ObservedObject var store: ShelfStore
  @ObservedObject var activity: ShelfActivity
  let id: UUID
  var close: () -> Void
  var addFiles: () -> Void
  var paste: () -> Void
  var receive: (NSPasteboard) -> Bool
  var instantDrop: (NSPasteboard, String) -> Bool
  var resize: (NSSize) -> Void
  var dock: () -> Void
  var run: (ActionKind, [UUID]) -> Void
  var execute: (ActionRequest) -> Void
  var utility: (String, [UUID]) -> Void
  var preset: (ActionPreset, [UUID]) -> Void
  var share: (String, [UUID]) -> Void
  var preview: ([URL]) -> Void
  var dragEnded: (NSDragOperation, [URL], Bool) -> Void
  var detailSurface = false
  var detailsVisibility: (Bool) -> Void = { _ in }
  var focusDetails: () -> Void = {}
  var focusCompact: () -> Void = {}
  var contextAction: (String, [UUID]) -> Void = { _, _ in }
  var retryUpload: () -> Void = {}
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var selection: Set<UUID> = []
  @State private var customizing = false
  @State private var hovering = false
  @State private var commandVisible = false
  @State private var recentVisible = false
  @State private var notice: String?
  @State private var composerHeight: CGFloat = 112
  @State private var menuTarget = ShelfMenuTarget()
  @State private var receivedCount = 0
  @State private var feedbackToken = UUID()
  @State private var knownItems: Set<UUID> = []
  @State private var draggingOut = false
  @State private var receivingDrop = false
  @State private var keepOpenFeedback = false
  @State private var totalBytes: Int64?
  private var shelf: Shelf { store.shelf(id) ?? Shelf() }
  private var viewMode: ShelfViewMode { shelf.viewMode ?? .gallery }
  private var showingDetails: Bool {
    shelf.detailsVisible == true || draft != nil || commandVisible || recentVisible
  }
  private var motion: Animation? {
    ShelfMotion.animation(.state, reduceMotion: reduceMotion)
  }
  // 142 = 22(顶部留白) + 142(卡片区) + 34(胶囊行) + 8(胶囊行下边距) - 2，
  // 刚好把 208pt 的面板铺满、还留 2pt 余量。这样卡片区的几何中心正好落在
  // y=94pt —— 与参考应用实测的整堆中心 y=94pt 一致（面板正中偏上 10pt）。
  private let compactPreviewHeight: CGFloat = 142
  private var collectionLabel: String {
    // 实测参考应用：单个文件显示文件名（"a.txt"），多个才显示数量（"4 个文件"）。
    // 与竞品一致，不要改。
    if shelf.items.count == 1 { return shelf.items[0].name }
    let images = Set(["png", "jpg", "jpeg", "gif", "heic", "webp", "tif", "tiff"])
    if !shelf.items.isEmpty, shelf.items.allSatisfy({ $0.kind == .image || images.contains($0.resolvedURL.pathExtension.lowercased()) }) {
      return "\(shelf.items.count) 张图片"
    }
    return "\(shelf.items.count) 个文件"
  }
  private var chosen: [ShelfItem] {
    selection.isEmpty ? shelf.items : shelf.items.filter { selection.contains($0.id) }
  }
  private var detailCollectionLabel: String {
    let images = Set(["png", "jpg", "jpeg", "gif", "heic", "webp", "tif", "tiff"])
    if !shelf.items.isEmpty, shelf.items.allSatisfy({ $0.kind == .image || images.contains($0.resolvedURL.pathExtension.lowercased()) }) {
      return "\(shelf.items.count) 张图片"
    }
    return "\(shelf.items.count) 个文件"
  }
  private var processing: Bool { activity.busy.contains(id) }
  private var draft: ShelfActionDraft? { store.actionDraft(for: id) }
  private var outputs: [URL] {
    Array(Set(chosen.compactMap(\.outputURL))).filter {
      FileManager.default.fileExists(atPath: $0.path)
    }.sorted { $0.path < $1.path }
  }
  private var failures: [ShelfItem] {
    guard let request = activity.retryRequests[id] else { return [] }
    return chosen.filter {
      $0.lastActionSucceeded == false && request.sources.contains($0.resolvedURL)
    }
  }
  private var canRetryIndividually: Bool {
    activity.retryRequests[id].map { ![.archive, .imagePDF, .stitchImages].contains($0.kind) }
      ?? false
  }

  var body: some View {
    VStack(spacing: 0) {
      if !detailSurface {
        // 空架子走单独一套版式。塞在 compactCollection 里的话，文字会被上面
        // 那条 22pt 留白和下面 142pt 卡片区一起带偏——实测落在 y=115，
        // 而参考应用是整个面板正中 y=103（面板 207pt）。
        if shelf.items.isEmpty { emptyCompact } else { compactCollection }
      } else {
        header.opacity(
          draggingOut ? 0.35 : 1)
        if commandVisible {
          ShelfCommandBar(
            store: store,
            run: { kind in
              commandVisible = false
              run(kind, chosen.map(\.id))
              fit()
            },
            utility: { action in
              commandVisible = false
              utility(action, chosen.map(\.id))
              fit()
            },
            preset: { action in
              commandVisible = false
              preset(action, chosen.map(\.id))
              fit()
            },
            share: { command in
              commandVisible = false
              share(command, chosen.map(\.id))
              fit()
            },
            close: {
              commandVisible = false
              fit()
            }
          ).disabled(processing)
        } else {
          contents.frame(maxWidth: .infinity, maxHeight: .infinity)
          if !failures.isEmpty, draft == nil {
            footer.opacity(
              draggingOut ? 0.35 : 1)
          }
          if recentVisible, !store.recentActions.isEmpty { recentActions }
          if draft != nil {
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 0.5)
            ActionComposerView(
              store: store, id: id, selectedSources: chosen.map(\.resolvedURL),
              onRun: execute, onDismiss: fit
            ).disabled(processing)
              .fixedSize(horizontal: false, vertical: true)
              .background(
                GeometryReader { geometry in
                  Color.clear.preference(key: ComposerHeightKey.self, value: geometry.size.height)
                }
              )
              .transition(.opacity.combined(with: .move(edge: .bottom)))
          }
          if let notice {
            Text(notice).font(.caption).foregroundStyle(.red).fixedSize(
              horizontal: false, vertical: true
            ).padding(10)
          }
          if let upload = activity.uploads[id] {
            ShelfUploadProgressView(controller: upload, retry: retryUpload, dismiss: { activity.uploads.removeValue(forKey: id); fit() }).padding(10)
          } else if processing {
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text(activity.progress[id] ?? "正在处理内容…").font(.caption).foregroundStyle(.secondary)
              Spacer(minLength: 0)
            }.padding(.horizontal, 12).frame(height: 30)
          }
        }
      }
    }
    .background(ShelfWindowGlass())
    // 不做 clipShape：圆角半径 24 会让窗口内容顶部 24 像素的形状宽度为零，
    // 系统层面那块收不到鼠标事件 —— 表现为架子顶部怎么拖都没反应。
    // 圆角改由 ShelfWindowGlass 自己画（形状一致），但不裁剪、不改变窗口可点击形状。
    .overlay {
      RoundedRectangle(cornerRadius: 24, style: .continuous)
        .strokeBorder(receivingDrop ? Color.accentColor : .clear, lineWidth: 2)
        .allowsHitTesting(false)
    }
    .overlay(alignment: .top) {
      // 开着「给架子着色」时常驻，否则跟着悬停淡入。颜色一律取架子自己的颜色——
      // 原来写死白色，等于"有颜色"这个设置形同虚设。
      // #8：单架「始终显示指示器」（showsPinIndicator）也让这条常显，不随悬停淡入；
      // 缺省 nil = 跟随全局行为（着色常驻 / 否则悬停淡入）。
      if store.settings.colorShelves || shelf.showsPinIndicator == true {
        Capsule().fill(shelfColor.opacity(0.85)).frame(width: 35, height: 3.5).padding(.top, 5)
          .allowsHitTesting(false)
      }
    }
    // 架子名常显在拖动胶囊正下方：名字原先只存在于窗口属性里，视觉上不渲染，
    // 同屏多块无名玻璃窗分不清谁是谁，智能命名（如「1 张图片」）对用户不可见。
    // 名字不跟悬停走（胶囊照旧悬停淡入），allowsHitTesting(false) 保住顶部
    // 留白整条交给 isMovableByWindowBackground 拖窗口；宽度收在 88pt 内，
    // 避开左上 ✕／图钉（到 x≈53）和右上 ⌄（自 x≈161 起）。
    .overlay(alignment: .top) {
      if !detailSurface {
        Text(shelf.name)
          .font(.system(size: 10, weight: .medium))
          .foregroundStyle(ShelfGlassPalette.secondaryText)
          .lineLimit(1).truncationMode(.middle)
          .frame(maxWidth: 88)
          .padding(.top, 11)
          .allowsHitTesting(false)
      }
    }
    .overlay(alignment: .topTrailing) {
      if let number = activity.numbers[id] {
        Text(String(number)).font(.system(size: 22, weight: .semibold, design: .rounded))
          .foregroundStyle(Color.accentColor)
          .frame(width: 38, height: 38).background(
            ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 8)
          )
          .padding(.top, 48).padding(.trailing, 12).allowsHitTesting(false)
      }
    }
    .overlay(alignment: .topLeading) {
      if shelf.showsPinIndicator == true || shelf.pinned && hovering {
        ShelfIcon(shelf.pinned ? .pinned : .pin, size: 10)
          .foregroundStyle(shelfColor).padding(.leading, 43).padding(.top, 14)
          .allowsHitTesting(false)
      }
    }
    .animation(motion, value: viewMode)
    .contextMenu {
      Button("添加文件…", action: addFiles).disabled(processing)
      Button("从剪贴板添加", action: paste).disabled(processing)
      Divider()
      Button(shelf.pinned ? "取消固定" : "固定收集架") {
        store.updateShelf(id) { $0.pinned.toggle() }
      }.disabled(processing)
      Button("关闭收集架", action: close).disabled(processing)
      Divider()
      Button("收集架设置…") { (NSApp.delegate as? ShelfApplication)?.showPreferences() }
    }
    .animation(motion, value: showingDetails)
    .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: receivingDrop)
    .animation(motion, value: draft?.kind)
    .animation(motion, value: receivedCount)
    .onHover { hovering = $0 }
    .animation(ShelfMotion.animation(.state, reduceMotion: reduceMotion), value: draggingOut)
    .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
    .onAppear {
      knownItems = Set(shelf.items.map(\.id))
      fit()
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragStarted"))) {
      note in
      if note.object as? UUID == id, detailSurface { draggingOut = true }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragEnded"))) {
      note in
      if note.object as? UUID == id { draggingOut = false; keepOpenFeedback = false }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDragModifiers"))) {
      note in
      if note.object as? UUID == id { keepOpenFeedback = note.userInfo?["keepOpen"] as? Bool ?? false }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfDropHighlight"))) {
      note in
      if note.object as? UUID == id { receivingDrop = note.userInfo?["active"] as? Bool ?? false }
    }
    .onReceive(
      NotificationCenter.default.publisher(for: Notification.Name("ShelfCommand.\(id.uuidString)"))
    ) { note in
      if let command = note.object as? String,
        (note.userInfo?["detail"] as? Bool) == detailSurface || ["compose", "collapse"].contains(command) { handle(command) }
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfSelection.\(id.uuidString)"))) { note in
      if detailSurface, let ids = note.object as? [UUID] { selection = Set(ids) }
    }
    .onChange(of: shelf.items.map(\.id)) { ids in
      selection.formIntersection(Set(ids))
      let count = Set(ids).subtracting(knownItems).count
      knownItems = Set(ids)
      if count > 0 {
        receivedCount = count
        let token = UUID()
        feedbackToken = token
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.7) {
          if feedbackToken == token { receivedCount = 0 }
        }
      }
      fit()
    }
    .onChange(of: viewMode) { _ in fit() }
    .onChange(of: showingDetails) { _ in fit() }
    .onChange(of: draft?.kind) { _ in
      commandVisible = false
      notice = nil
      fit()
    }
    .onChange(of: processing) { _ in fit() }
    .task(id: chosen.map(\.resolvedURL)) {
      totalBytes = nil
      let urls = chosen.map(\.resolvedURL)
      let bytes = await Task.detached(priority: .utility) {
        urls.reduce(Int64(0)) { sum, url in sum + (ShelfFileMetadataReader.read(url)?.byteCount ?? 0) }
      }.value
      if !Task.isCancelled { totalBytes = bytes }
    }
    .onPreferenceChange(ComposerHeightKey.self) { height in
      if height > 0, abs(composerHeight - height) > 1 {
        composerHeight = height
        fit()
      }
    }
    .popover(isPresented: $customizing,
             attachmentAnchor: .point(UnitPoint(x: detailSurface ? 0.79 : 0.90, y: 0.08)),
             arrowEdge: .leading) {
      ShelfCustomizationView(store: store, id: id)
    }
  }

  /// 空架子。参考应用把架子清空后同屏对比：整块面板只有左上角一个 ✕，
  /// 正中一行「放置你的内容项」，**没有大图标、没有底部按钮、右上角连 ⌄ 都没有**。
  /// 原来这里是「蓝色大图标 + 空架子」加底下一排 +/粘贴，看着像"出错了 / 还没加载完"
  /// 的中间态，而不是"往这里拖东西"的提示。
  /// 字号按同屏量出来的字高对齐：参考应用约 14pt，我原来 12pt 明显偏小。
  private var emptyCompact: some View {
    ZStack {
      VStack(spacing: 10) {
        Text("放置你的内容项")
          .font(.system(size: 14))
          .foregroundStyle(ShelfGlassPalette.secondaryText)
      }
      if let upload = activity.uploads[id] {
        ShelfUploadProgressView(controller: upload, retry: retryUpload,
          dismiss: { activity.uploads.removeValue(forKey: id); fit() }, framed: false).padding(.horizontal, 10)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .overlay(alignment: .topLeading) {
      Button(action: closeOrClear) { ShelfIcon(.close, size: 12) }
        .buttonStyle(ShelfRoundIconStyle(size: 30)).disabled(processing)
        .padding(.leading, 9).padding(.top, 9)
        .opacity(1)
        .help("收起架子；按住 Option 清空架子").accessibilityLabel("收起架子；按住 Option 清空架子")
    }
    .shelfGrabBar(id, color: shelfColor)
    .transition(.opacity)
  }

  private var compactCollection: some View {
    VStack(spacing: 0) {
      // 顶部 30pt 留白，交给"拖窗口"。必须是一个独立的、allowsHitTesting(false) 的
      // 空隙：如果把空白做进卡片自己的 frame 里，SwiftUI 会把整块都认领掉，
      // 而它自己不会拖窗 —— 那 30pt 就成了既拖不动窗、也拖不出文件的死区。
      Color.clear.frame(height: 22).allowsHitTesting(false)
      // 顶部不再单独占一行。原先那条 40pt 的标题行是整块面板唯一收不到鼠标事件的
      // 区域（点下去会穿透到后面的窗口），而下面主体区的拖动是正常的。
      // 把 ✕ / ⌄ 改成浮在主体上面的按钮，整块面板连成一整片，就不存在这条坏带了。
      ZStack {
        if let upload = activity.uploads[id] {
          ShelfUploadProgressView(controller: upload, retry: retryUpload,
            dismiss: { activity.uploads.removeValue(forKey: id); fit() }, framed: false).padding(.horizontal, 10)
        } else if shelf.items.isEmpty {
          emptyCompact
        } else {
          FileDragView(
            urls: shelf.items.map(\.resolvedURL), copyOnly: store.settings.copyOnDrag,
            doubleClick: { preview(shelf.items.map(\.resolvedURL)) }, completed: { _ in },
            completedDetails: dragEnded,
            missing: { urls in
              notice = "\(urls.count) 个原文件不可访问。"
              fit()
            }, disabled: processing, shelfID: id,
            presentation: .stack, memberIDs: shelf.items.map(\.id)
          )
          .frame(width: 148, height: compactPreviewHeight)
          // 实测整堆亮区中心 y=89.2pt，参考应用 94.5pt，差 5pt，这里 +2 把中心推到 94 附近。
          .offset(y: 2)
          // 原本这里是 .opacity(draggingOut ? 0 : 1)：拖拽一开始，卡片堆就淡到全透明。
          // 两个问题——一是拖出会话启动的那一刻，系统要同时重渲染整个面板、启动好几个
          // 淡出动画，正好和拖拽循环抢主线程，"第一下顿挫"就是这么来的；二是 macOS 的
          // 惯例（也是参考应用的做法）是拖出时源窗口留在原地，架子不该自己消失。
          .opacity(1)
          .help("拖出全部文件；双击快速预览").accessibilityLabel("拖出全部文件")
          .scaleEffect(receivingDrop && !reduceMotion ? 1.025 : 1)
        }
        if draggingOut, keepOpenFeedback {
          // 只看 keepOpenFeedback 就够了：紧凑视图里 draggingOut 不参与任何渲染
          // （它只在 detailSurface 下压暗表头），而上面那条 ShelfDragStarted 在紧凑
          // 视图下已经不再赋值了。拖拽起始那一刻的面板重画实测 p95 2.18ms / 最大
          // 5.79ms，能省一次是一次。
          Text("保持打开").font(.system(size: 14, weight: .medium))
            .foregroundStyle(ShelfGlassPalette.secondaryText).allowsHitTesting(false)
        }
      }
      .frame(maxWidth: .infinity).frame(height: compactPreviewHeight)
      // ✕ / ⌄ 各自独立成一个浮层，不放进同一个 HStack。
      // 放进 HStack（哪怕中间是 Spacer）时，SwiftUI 会把整条容器都算成可点击区域，
      // 按钮之间的空隙也被吃掉，于是那一行再也拖不动架子。现在两个浮层各自只占
      // 按钮本身那么大，中间留白归还给 isMovableByWindowBackground。
      // 按钮的纵向位置也是量出来的：参考应用圆心在面板 y=21pt。
      // 主体区从面板 y=23 起，所以这里是 -17 —— 按钮整排顶到面板最上沿，
      // 中间不留那条空白带（那条空白带原本是我为了"拖窗口"留的，
      // 但实测参考应用根本没有空白带，整块面板都能拖）。
      .overlay(alignment: .topLeading) {
        Button(action: closeOrClear) { ShelfIcon(.close, size: 12) }
          .buttonStyle(ShelfRoundIconStyle(size: 30)).disabled(processing)
          .padding(.leading, 9).padding(.top, -17)
          .opacity(1)
          .help("收起架子；按住 Option 清空架子").accessibilityLabel("收起架子；按住 Option 清空架子")
      }
      // 空架子时**不摆 ⌄**：参考应用把架子清空后同屏对比，右上角是空的，
      // 只有 ✕。空架子能做的操作本来就只有"关闭"，给它挂一个 27 项的菜单没有意义。
      .overlay(alignment: .topTrailing) {
        if !shelf.items.isEmpty {
          ShelfMenuButton(symbol: "chevron.down", symbolSize: 13, size: 30, enabled: !processing,
                          nodes: panelMenuNodes)
            .frame(width: 30, height: 30)
            .padding(.trailing, 9).padding(.top, -17)
            .opacity(1)
            .help("架子操作").accessibilityLabel("架子操作")
        }
      }
      // 空架子时底下这一行整条不画：参考应用那里是空的，没有 +/粘贴两个按钮。
      // 要加内容直接把文件拖到面板上（面板整块都接拖放）。
      if !shelf.items.isEmpty {
        HStack(spacing: 6) {
          // 参考应用实测：点底部胶囊「8 个文件 ›」展开的是**文件清单**（400×304 的
          // 列表面板，左上角返回、右上角三个视图切换），不是下拉菜单。原来这里把
          // 文字做成了 Menu，点一下弹出 24 项操作菜单 —— 和参考应用完全不是一回事，
          // 同一个面板里出现两个一模一样的菜单，功能还互相打架。
          // 现在整颗胶囊都是"展开/收起内容面板"这一个动作，右侧那个 › 只是形状的一部分。
          Button { setDetailsVisible(!showingDetails) } label: {
            HStack(spacing: 2) {
              Text(collectionLabel).font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.white)
                .lineLimit(1).truncationMode(.middle).monospacedDigit()
              // 箭头要跟参考应用一样粗：原来是 8pt / 常规粗细，画出来是一条细线，
              // 跟旁边 11pt 的文字一比明显"轻"。改成 10pt 中粗。
              ShelfIcon(named: showingDetails ? "chevron.left" : "chevron.right", size: 10, weight: .medium)
                .frame(width: 10, height: 24)
            }
            // 架底提示行截断修复：先把内容宽度收进胶囊里（164 = 胶囊上限，
            // 扣掉左右的 5pt 内边距），文字才会走「中段省略号」；
            // 之前 maxWidth 挂在背景外面，内容照样按理想宽度排，
            // 长文件名会从 x=0 往两侧溢出、被面板边缘硬切掉开头。
            .frame(maxWidth: 154)
            .contentShape(Rectangle())
          }.buttonStyle(.plain)
            .help(showingDetails ? "收起内容面板" : "展开内容面板")
            .accessibilityLabel("\(showingDetails ? "收起" : "展开")内容，\(shelf.items.count) 项")
            .accessibilityValue(showingDetails ? "已展开" : "已收起")
            .modifier(ShelfCountMenuSurface())
        }.frame(height: 34).padding(.bottom, 8).opacity(1).disabled(processing)
      }
      if let notice {
        Text(notice).font(.caption).foregroundStyle(.red).lineLimit(2).padding(.horizontal, 10)
          .frame(height: 40)
      }
      if processing, activity.uploads[id] == nil { ProgressView().controlSize(.small).frame(height: 30) }
    }
    // 顶部中间那条拖动提示条在 `shelfGrabBar` 里加：参考应用是 35×3.5pt 的
    // 胶囊、水平居中、距顶 5pt、**鼠标移进面板才淡入**。
    .shelfGrabBar(id, color: shelfColor)
    // 撑满宿主给的尺寸。少了它 SwiftUI 会把整棵树的理想尺寸算成里面那个
    // 148×142 的卡片堆，NSHostingView 随之缩到 148×206，和 200×208 的窗口错位。
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    // 面板移动全权交给 isMovableByWindowBackground：SwiftUI 不在空白处认领
    // 事件，AppKit 就会接管拖动。两处旧实现都已移除，因为都不可靠——
    // 根视图的 DragGesture 一旦移动窗口就会自我失效；NSWindow.performDrag
    // 在 nonactivating 面板上因为拿不到焦点而静默失效。
    // 卡片堆、✕、⌄、胶囊是子视图，仍优先拿到自己的事件。
    // 卡片那一块还额外声明了 mouseDownCanMoveWindow = false（见 FileDragSource），
    // 否则 AppKit 会把按在卡片上的这一次点击直接当成"拖窗口"，文件就再也拖不出来。
    .transition(.opacity)
  }

  private var header: some View {
    HStack(spacing: 7) {
      Button { setDetailsVisible(false) } label: { ShelfIcon(named: "chevron.left", size: 10) }
        .buttonStyle(ShelfRoundIconStyle(size: 30)).help("收起内容面板")
        .accessibilityLabel("收起内容面板").disabled(processing || draft != nil)
      VStack(alignment: .leading, spacing: 2) {
        Text(detailCollectionLabel).font(.system(size: 13, weight: .semibold)).lineLimit(1)
          .truncationMode(.middle).help(shelf.name)
        Text(selection.isEmpty ? totalSize : "已选 \(selection.count) 项 · \(totalSize)")
          .font(.system(size: 11)).monospacedDigit().foregroundStyle(ShelfGlassPalette.secondaryText)
          .lineLimit(1).contentTransition(.opacity)
      }.frame(maxWidth: .infinity, alignment: .leading)
      if viewMode == .list {
        Button(action: revealChosen) { ShelfIcon(.reveal, size: 13) }
          .buttonStyle(ShelfRoundIconStyle(size: 28)).help("在 Finder 中显示")
          .accessibilityLabel("在 Finder 中显示").disabled(processing || chosen.isEmpty)
      }
      Button { share("airdrop", chosen.map(\.id)) } label: { ShelfIcon(.airdrop, size: 16) }
        .buttonStyle(ShelfRoundIconStyle(size: 30)).help("隔空投送")
        .accessibilityLabel("隔空投送").disabled(processing || chosen.isEmpty)
      Button { customizing.toggle() } label: { ShelfIcon(named: "slider.horizontal.3", size: 13) }
        .buttonStyle(ShelfRoundIconStyle(size: 30)).help("自定义窗口")
        .accessibilityLabel("自定义窗口").disabled(processing)
      Picker("视图", selection: Binding(get: { viewMode }, set: setViewMode)) {
        Label("缩略图视图", systemImage: ShelfSymbols.name(.grid)).labelStyle(.iconOnly)
          .tag(ShelfViewMode.gallery).help("缩略图视图")
        Label("列表视图", systemImage: ShelfSymbols.name(.list)).labelStyle(.iconOnly)
          .tag(ShelfViewMode.list).help("列表视图")
      }.pickerStyle(.segmented).labelsHidden().frame(width: 64).controlSize(.regular)
        .help("列表与缩略图视图").accessibilityLabel("列表与缩略图视图")
    }.padding(.horizontal, 10).frame(height: 48)
  }
  @ViewBuilder private var contents: some View {
    if shelf.items.isEmpty {
      VStack {
        Spacer()
        ShelfIcon(.shelf, size: 34)
          .foregroundStyle(Color.accentColor.opacity(0.9)).padding(.bottom, 6)
        Text("收集架").foregroundStyle(.secondary).font(.system(size: 13, weight: .medium))
        HStack(spacing: 12) {
          Button(action: addFiles) { Label("添加文件", systemImage: ShelfSymbols.name(.add)) }.buttonStyle(
            ShelfPrimaryButtonStyle())
          Button(action: paste) { ShelfIcon(.copyPaths) }.buttonStyle(
            ShelfQuietIconStyle()
          ).help("粘贴剪贴板内容").accessibilityLabel("粘贴剪贴板内容")
        }.padding(.top, 8).disabled(processing)
        Spacer()
      }
    } else if viewMode == .list {
      ShelfItemTable(
        shelfID: id, items: shelf.items, selection: $selection,
        copyOnly: store.settings.copyOnDrag, disabled: processing,
        localBindings: store.settings.localShortcutBindings,
        onOpen: open, onPreview: preview, onRemove: remove,
        onReorder: reorder, onDrop: receive, onDragEnd: dragEnded, onCommand: handle,
        onMissing: { urls in
          notice = "\(urls.count) 个原文件不可访问。"
          fit()
        }, onDropHighlight: { receivingDrop = $0 },
        onContextAction: { command, ids in contextAction(command, Array(ids)) }, contextActions: fileContextActions,
        favoriteActions: store.settings.favoriteActionIDs
      )
      .transition(.opacity)
    } else {
      ShelfGalleryView(
        shelfID: id, items: shelf.items, selection: $selection,
        copyOnly: store.settings.copyOnDrag, disabled: processing,
        localBindings: store.settings.localShortcutBindings,
        onOpen: open, onPreview: preview, onRemove: remove,
        onReorder: reorder, onDrop: receive, onDragEnd: dragEnded, onCommand: handle,
        onMissing: { urls in
          notice = "\(urls.count) 个原文件不可访问。"
          fit()
        }, onDropHighlight: { receivingDrop = $0 },
        onContextAction: { command, ids in contextAction(command, Array(ids)) }, contextActions: fileContextActions,
        favoriteActions: store.settings.favoriteActionIDs, onReveal: revealChosen
      )
      .transition(.opacity)
    }
  }
  private var footer: some View {
    VStack(spacing: 0) {
      if !failures.isEmpty {
        HStack {
          Text("失败 \(failures.count) 项").font(.caption).foregroundStyle(.secondary)
          Spacer()
          if canRetryIndividually {
            Button {
              retryFailures()
            } label: {
              Label("仅重试失败项", systemImage: ShelfSymbols.name(.retry))
            }.buttonStyle(.borderless).controlSize(.small).disabled(processing)
          } else {
            Text("合并结果缺少部分内容").font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }.padding(.horizontal, 12).frame(height: 28)
      }
    }
  }
  private func tool(_ icon: String, _ title: String, _ action: @escaping () -> Void) -> some View {
    Button(action: action) { ShelfIcon(named: icon, size: 12) }
      .buttonStyle(ShelfQuietIconStyle()).help(title).accessibilityLabel(title)
  }
  private func menuIcon(_ icon: String) -> some View {
    ShelfMenuGlyph(name: icon)
  }
  private func revealChosen() {
    NSWorkspace.shared.activateFileViewerSelecting(chosen.filter(\.isAvailable).map(\.resolvedURL))
  }
  // MARK: - ⌄ 菜单
  //
  // 菜单是一棵 `ShelfMenuNode` 数据树，弹出时交给独立菜单面板绘制。
  // 之所以不用 SwiftUI 的 `Menu`：实测它在 macOS 上会把条目标签里的图标整个丢掉
  // （`Label(systemImage:)`、手写 `HStack { Image; Text }`、`.labelStyle(.titleAndIcon)`
  // 三种写法弹出来全是纯文字），而参考应用每一项都带图标。
  // 每次弹出都重新构造这棵树，菜单内容永远反映当下的选择、输出结果和忙碌状态。

  // 保留模块内可见性，便于直接检查真实菜单树，无需打开测试窗口。
  func panelMenuNodes() -> [ShelfMenuNode] {
    let files = shelf.items.isEmpty
      ? [ShelfMenuNode.item("从剪贴板添加", "doc.on.clipboard", enabled: !processing, paste)]
      : fileMenuNodes
    return files + [.separator] + shelfMenuNodes
  }

  private var menuSelection: ShelfMenuSelection { ShelfMenuSelection(items: chosen) }
  private var fileCommandsEnabled: Bool { !processing && !chosen.isEmpty && chosen.allSatisfy(\.isAvailable) }

  /// 文件组的顺序来自竞品完整菜单：打开 → 分享 → 已配置的云 → 剪贴板与操作。
  private var fileMenuNodes: [ShelfMenuNode] {
    let ids = chosen.map(\.id)
    let targets = openWithTargets
    var openWith: [ShelfMenuNode] = targets.map { target in
      .item(target.title, image: target.image, symbol: "app", enabled: fileCommandsEnabled) {
        contextAction(ShelfFileMenuAction.openWithCommand(for: URL(fileURLWithPath: target.identifier)), ids)
      }
    }
    if !openWith.isEmpty { openWith.append(.separator) }
    openWith.append(.item("其他应用…", "app", enabled: fileCommandsEnabled) { run(.openApp, ids) })
    let defaultApplication = chosen.first.flatMap { NSWorkspace.shared.urlForApplication(toOpen: $0.resolvedURL) }
    let defaultIcon = defaultApplication.map { NSWorkspace.shared.icon(forFile: $0.path) }
    var nodes: [ShelfMenuNode] = [
      .submenu("打开用", image: defaultIcon, symbol: "app", enabled: fileCommandsEnabled, openWith),
      .item("在 Finder 中显示", image: ShelfAppIcons.image(bundleID: ShelfAppIcons.finder),
            symbol: "folder", enabled: fileCommandsEnabled, revealChosen),
      .item("快速查看", "eye", enabled: fileCommandsEnabled) { preview(chosen.map(\.resolvedURL)) },
      .separator
    ]
    nodes += shareMenuNodes
    if !cloudMenuNodes.isEmpty {
      nodes.append(.separator)
      nodes += cloudMenuNodes
    }
    nodes.append(.separator)
    nodes += actionMenuNodes
    return nodes
  }

  /// 分享目标沿用系统应用／共享服务的真实图标。
  private var shareMenuNodes: [ShelfMenuNode] {
    let ids = chosen.map(\.id)
    var nodes: [ShelfMenuNode] = [
      .item("隔空投送", image: NSSharingService(named: .sendViaAirDrop)?.image, symbol: "airplay.audio", enabled: fileCommandsEnabled) { share("airdrop", ids) },
      .item("邮件", image: ShelfAppIcons.image(bundleID: ShelfAppIcons.mail), symbol: "envelope",
            enabled: fileCommandsEnabled) { share("mail", ids) },
      .item("信息", image: ShelfAppIcons.image(bundleID: ShelfAppIcons.messages), symbol: "message",
            enabled: fileCommandsEnabled) { share("messages", ids) },
      .item("备忘录", image: ShelfAppIcons.image(bundleID: ShelfAppIcons.notes), symbol: "note.text",
            enabled: fileCommandsEnabled) { share("notes", ids) }
    ]
    let extras = extraShareServices
    nodes.append(.submenu("更多", "ellipsis", extras.map { entry in
      ShelfMenuNode.item(entry.service.title, image: entry.service.image, symbol: "square.and.arrow.up", enabled: fileCommandsEnabled) {
        entry.service.perform(withItems: chosen.filter(\.isAvailable).map(\.resolvedURL))
      }
    }, enabled: fileCommandsEnabled && !extras.isEmpty))
    return nodes
  }

  /// 仅展示已有上传实现的账户；苹果云的公开链接能力尚未接入。
  private var cloudMenuNodes: [ShelfMenuNode] {
    return store.settings.cloudAccounts.filter { ShelfMenuSelection.uploadProviders.contains($0.provider.lowercased()) }.map { account in
      let title = "上传到 \(account.name) 并获取链接…" + (account.shelfMenuConfigurationReady ? "" : "（需配置）")
      return .item(title, "cloud", enabled: !processing && menuSelection.supportsUpload(account.provider)
                  && !store.settings.onlineDisabled && account.shelfMenuConfigurationReady) {
        share(account.id.uuidString, chosen.map(\.id))
      }
    }
  }

  /// 已单列分享目标以外，系统实际接受当前文件的其他分享服务。
  private var extraShareServices: [(key: String, service: NSSharingService)] {
    let urls = chosen.filter(\.isAvailable).map(\.resolvedURL)
    guard !urls.isEmpty else { return [] }
    let names: [String] = [
      NSSharingService.Name.sendViaAirDrop.rawValue,
      NSSharingService.Name.composeEmail.rawValue,
      NSSharingService.Name.composeMessage.rawValue,
      "com.apple.notes"
    ]
    let listed: Set<String> = Set(
      names.compactMap { NSSharingService(named: NSSharingService.Name(rawValue: $0))?.title }
        + ["AirDrop", "Mail", "Messages", "Notes", "备忘录", "邮件", "信息", "隔空投送"]
    )
    let preferred = ["微信", "WeChat", "Slack", "DEVONTEAM"]
    return NSSharingService.sharingServices(forItems: urls)
      .filter { !listed.contains($0.title) && $0.image != nil }
      .sorted { lhs, rhs in
        let lp = preferred.firstIndex(of: lhs.title) ?? Int.max
        let rp = preferred.firstIndex(of: rhs.title) ?? Int.max
        return lp == rp ? lhs.title < rhs.title : lp < rp
      }
      .map { (key: $0.title, service: $0) }
  }

  /// 窗口组只保留竞品第一层的四项；其他既有操作收在「所有操作」。
  private var shelfMenuNodes: [ShelfMenuNode] {
    [
      .item("清空收集项（保留文件）", "delete.left", enabled: !processing && !shelf.items.isEmpty) {
        remove(Set(shelf.items.map(\.id)))
      },
      .item("停靠到边缘", "rectangle.leadinghalf.inset.filled", enabled: !processing, dock),
      .submenu("自定义窗口", "slider.horizontal.3", customizationMenuNodes, enabled: !processing),
      .item("收集架设置…", "gearshape") { (NSApp.delegate as? ShelfApplication)?.showPreferences() }
    ]
  }

  private var customizationMenuNodes: [ShelfMenuNode] {
    let colorNodes = ShelfTintPalette.choices.map { choice -> ShelfMenuNode in
      let dot = ShelfSymbols.image(named: "circle.fill", pointSize: 12).map {
        ShelfSymbols.tinted($0, color: NSColor(choice.2))
      }
      return .item(choice.1, image: dot, symbol: "circle.fill", checked: shelf.color == choice.0) {
        store.updateShelf(id) { $0.color = choice.0 }
      }
    }
    return [
      .item("名称…", "textformat", enabled: !processing, renameShelf),
      .submenu("颜色", "circle", colorNodes),
      .item("始终显示指示器", "pin", checked: shelf.showsPinIndicator ?? false) {
        store.updateShelf(id) { $0.showsPinIndicator = !($0.showsPinIndicator ?? false) }
      },
      .separator,
      .item("固定窗口", "pin.fill", checked: shelf.pinned) {
        store.updateShelf(id) { $0.pinned.toggle() }
      },
      .item("仅在当前桌面显示", "rectangle.on.rectangle", checked: shelf.ownSpace ?? store.settings.ownSpace) {
        store.updateShelf(id) { $0.ownSpace = !($0.ownSpace ?? store.settings.ownSpace) }
        (NSApp.delegate as? ShelfApplication)?.applySettings()
      }
    ]
  }

  /// 复制、移动各自有目标子菜单；「复制」标题反映当前文件，行为仍是复制文件。
  private var actionMenuNodes: [ShelfMenuNode] {
    let copyTitle = chosen.count == 1 ? "复制 \"\(chosen[0].name)\"" : "复制 \(chosen.count) 个文件"
    return [
      .item("从剪贴板添加", "doc.on.clipboard", enabled: !processing, paste),
      .item(copyTitle, "doc.on.doc", enabled: fileCommandsEnabled, copyItems),
      .submenu("将文件复制到…", "arrow.right.circle.fill", transferMenuNodes(.copy), enabled: fileCommandsEnabled),
      .submenu("将文件移动到…", "arrow.right.circle", transferMenuNodes(.move), enabled: fileCommandsEnabled),
      .submenu("所有操作", "ellipsis", allActionMenuNodes, enabled: !processing)
    ]
  }

  private func transferMenuNodes(_ kind: ActionKind) -> [ShelfMenuNode] {
    var seen: Set<String> = []
    let destinations = store.recentActions.filter { $0.kind == kind }.compactMap { draft -> URL? in
      guard !draft.destination.isEmpty else { return nil }
      let folder = URL(fileURLWithPath: (draft.destination as NSString).expandingTildeInPath).standardizedFileURL
      var isDirectory = ObjCBool(false)
      guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue,
            seen.insert(folder.path).inserted else { return nil }
      return folder
    }
    var nodes = destinations.prefix(5).map { folder in
      ShelfMenuNode.item(FileManager.default.displayName(atPath: folder.path), "folder", enabled: fileCommandsEnabled) {
        transfer(kind, to: folder)
      }
    }
    if !nodes.isEmpty { nodes.append(.separator) }
    nodes.append(.item("其他文件夹…", "folder", enabled: fileCommandsEnabled) {
      let picker = NSOpenPanel()
      picker.canChooseDirectories = true
      picker.canChooseFiles = false
      picker.canCreateDirectories = true
      picker.allowsMultipleSelection = false
      picker.prompt = kind == .copy ? "复制到此处" : "移动到此处"
      guard picker.runModal() == .OK, let folder = picker.url else { return }
      transfer(kind, to: folder)
    })
    return nodes
  }

  private func transfer(_ kind: ActionKind, to folder: URL) {
    guard fileCommandsEnabled, kind == .copy || kind == .move else { return }
    execute(ActionRequest(kind: kind, sources: chosen.map(\.resolvedURL), destination: folder))
  }

  private var allActionMenuNodes: [ShelfMenuNode] {
    let ids = chosen.map(\.id)
    let capabilities = menuSelection
    var nodes: [ShelfMenuNode] = []
    // #76：最爱操作置顶（带分隔线），之后才是完整清单。
    let favoriteNodes = favoriteMenuNodes(ids: ids, capabilities: capabilities)
    if !favoriteNodes.isEmpty {
      nodes += favoriteNodes + [.separator]
    }
    nodes += ActionKind.allCases.filter { capabilities.supports($0) }.map { kind in
      ShelfMenuNode.item(kind.title + "…", ShelfSymbols.action(kind), enabled: fileCommandsEnabled) { run(kind, ids) }
    }
    let utilities = utilityCommands.filter { capabilities.supportsUtility($0.0) }.map { command in
      ShelfMenuNode.item(command.1, command.2, enabled: fileCommandsEnabled) { utility(command.0, ids) }
    }
    if !utilities.isEmpty { nodes += [.separator] + utilities }
    if !outputs.isEmpty {
      nodes += [.separator, .submenu("生成结果", "arrow.down.to.line", [
        .item("打开结果文件", "arrow.up.forward.app") { outputs.forEach { NSWorkspace.shared.open($0) } },
        .item("在 Finder 中显示结果", image: ShelfAppIcons.image(bundleID: ShelfAppIcons.finder), symbol: "folder") {
          NSWorkspace.shared.activateFileViewerSelecting(outputs)
        },
        .item("结果文件加入架子", "plus", enabled: !processing) { _ = store.addOutputs(from: Set(ids), to: id) }
      ])]
    }
    let presets = store.settings.customActions.filter { capabilities.supports($0.kind) }
    if !presets.isEmpty {
      nodes += [.separator, .submenu("自定义操作", "hammer", presets.map { action in
        .item(action.name, ShelfSymbols.action(action.kind), enabled: fileCommandsEnabled) { preset(action, ids) }
      })]
    }
    let recent = store.recentActions.filter { capabilities.supports($0.kind) }
    if !recent.isEmpty {
      nodes.append(.submenu("最近操作", "clock.arrow.circlepath", recent.map { action in
        .item(recentTitle(action), ShelfSymbols.action(action.kind), enabled: fileCommandsEnabled) { useRecent(action) }
      }))
    }
    if !store.settings.scriptPaths.isEmpty {
      nodes.append(.submenu("自定义脚本", "terminal", store.settings.scriptPaths.map { path in
        .item(URL(fileURLWithPath: path).lastPathComponent, "terminal", enabled: fileCommandsEnabled) {
          share("script:\(path)", ids)
        }
      }))
    }
    nodes += [
      .separator,
      .item("添加文件…", "plus", enabled: !processing, addFiles),
      .item("展开内容", "square.grid.2x2", enabled: !processing) { setDetailsVisible(true) },
      .item("全选", "checkmark.circle", enabled: !processing) { selection = Set(shelf.items.map(\.id)) },
      .item("清除选择", "circle", enabled: !processing && !selection.isEmpty) { selection.removeAll() },
      .item("搜索操作", "magnifyingglass", enabled: !processing) {
        store.updateShelf(id) { $0.detailsVisible = true }
        NotificationCenter.default.post(
          name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "commandBar", userInfo: ["detail": true]
        )
        focusDetails()
        fit()
      },
      .item("关闭收集架", "xmark", enabled: !processing, close)
    ]
    return nodes
  }

  /// #76：把 favoriteActionIDs 解析成菜单节点。解析不了的（操作已删）静默跳过，
  /// 能力不匹配的（如对纯文本选「压缩图片」）置灰而不是消失——保持位置稳定。
  private func favoriteMenuNodes(ids: [UUID], capabilities: ShelfMenuSelection) -> [ShelfMenuNode] {
    store.settings.favoriteActionIDs.compactMap { favorite in
      if favorite.hasPrefix("action:"), let kind = ActionKind(rawValue: String(favorite.dropFirst(7))) {
        let supported = capabilities.supports(kind)
        return ShelfMenuNode.item(kind.title + "…", ShelfSymbols.action(kind),
                                  enabled: fileCommandsEnabled && supported) { run(kind, ids) }
      }
      if favorite.hasPrefix("utility:"), let command = utilityCommands.first(where: { "utility:" + $0.0 == favorite }) {
        let supported = capabilities.supportsUtility(command.0)
        return ShelfMenuNode.item(command.1, command.2,
                                  enabled: fileCommandsEnabled && supported) { utility(command.0, ids) }
      }
      if favorite.hasPrefix("preset:"),
         let action = store.settings.customActions.first(where: { "preset:" + $0.id.uuidString == favorite }) {
        let supported = capabilities.supports(action.kind)
        return ShelfMenuNode.item(action.name, ShelfSymbols.action(action.kind),
                                  enabled: fileCommandsEnabled && supported) { preset(action, ids) }
      }
      if favorite.hasPrefix("script:"), store.settings.scriptPaths.contains(String(favorite.dropFirst(7))) {
        return ShelfMenuNode.item(URL(fileURLWithPath: String(favorite.dropFirst(7))).lastPathComponent,
                                  "terminal", enabled: fileCommandsEnabled) { share(favorite, ids) }
      }
      if favorite.hasPrefix("cloud:"),
         let account = store.settings.cloudAccounts.first(where: { "cloud:" + $0.id.uuidString == favorite }),
         ShelfMenuSelection.uploadProviders.contains(account.provider.lowercased()) {
        let uploadable = capabilities.supportsUpload(account.provider)
        return ShelfMenuNode.item("上传到 \(account.name) 并获取链接…", ShelfSymbols.name(.cloud),
                                  enabled: !processing && !store.settings.onlineDisabled
                                  && account.shelfMenuConfigurationReady && uploadable) { share(account.id.uuidString, ids) }
      }
      return nil
    }
  }

  private func renameShelf() {
    guard !processing else { return }
    let alert = NSAlert()
    alert.messageText = "窗口名称"
    let field = NSTextField(string: shelf.name)
    field.frame = NSRect(x: 0, y: 0, width: 240, height: 24)
    alert.accessoryView = field
    alert.addButton(withTitle: "好")
    alert.addButton(withTitle: "取消")
    alert.window.initialFirstResponder = field
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    store.updateShelf(id) { $0.name = name }
  }

  private var openWithTargets: [ShelfMenuOpenTarget] {
    let urls = chosen.filter(\.isAvailable).map(\.resolvedURL)
    guard let first = urls.first, urls.count == chosen.count else { return [] }
    let choices = urls.map { NSWorkspace.shared.urlsForApplications(toOpen: $0) }
    let common = choices.dropFirst().reduce(Set(choices.first ?? [])) { $0.intersection($1) }
    let defaultApp = NSWorkspace.shared.urlForApplication(toOpen: first)
    return Array(Set(choices.first ?? [])).filter { common.contains($0) }.sorted { lhs, rhs in
      if lhs == rhs { return false }
      if lhs == defaultApp { return true }
      if rhs == defaultApp { return false }
      return FileManager.default.displayName(atPath: lhs.path).localizedStandardCompare(
        FileManager.default.displayName(atPath: rhs.path)) == .orderedAscending
    }.map { application in
      ShelfMenuOpenTarget(
        title: FileManager.default.displayName(atPath: application.path) + (application == defaultApp ? "（默认）" : ""),
        image: NSWorkspace.shared.icon(forFile: application.path),
        identifier: application.path
      )
    }
  }

  private var recentActions: some View {
    VStack(alignment: .leading, spacing: 2) {
      Divider()
      Text("最近操作").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(
        .top, 6)
      ForEach(Array(store.recentActions.enumerated()), id: \.offset) { _, action in
        Button {
          useRecent(action)
        } label: {
          Label(recentTitle(action), systemImage: ShelfSymbols.action(action.kind)).font(.system(size: 11))
            .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
            .frame(height: 27)
        }.buttonStyle(.plain).disabled(processing)
      }
    }.padding(.bottom, 4)
  }
  private var instantActions: some View {
    HStack(spacing: 2) {
      ForEach(Array(store.settings.instantActionIDs.prefix(6).enumerated()), id: \.offset) {
        _, action in
        if let descriptor = instantDescriptor(action) {
          InstantDropView(icon: ShelfSymbols.name(descriptor.0)) { instantDrop($0, action) }.frame(
            width: 28, height: 30
          ).help(descriptor.1).accessibilityLabel(descriptor.1)
        }
      }
    }
  }
  private var utilityCommands: [(String, String, String)] {
    [
      ("copyPaths", "复制文件路径", "doc.on.clipboard"), ("copyTextContents", "复制文本正文", "doc.text"),
      // #47：手动涂黑（整批图片时可用）。智能档（Vision 文本定位）后续批次再做，
      // 入口就留在这条命令上。
      ("redactImages", "涂黑…", "highlighter"),
      ("removeImageMetadata", "去除图片元数据", "photo"), ("moveToTrash", "将实际文件移到废纸篓…", "trash"),
    ]
  }
  private var shelfColor: Color {
    ShelfTintPalette.color(shelf.color)
  }
  private func instantDescriptor(_ action: String) -> (String, String)? {
    switch action {
    case "airdrop": return (ShelfSymbols.name(.airdrop), "隔空投送")
    case "messages": return ("message", "信息")
    case "mail": return ("envelope", "邮件")
    case "cloud": return (ShelfSymbols.name(.cloud), "云分享")
    default:
      if action.hasPrefix("utility:"),
        let command = utilityCommands.first(where: { $0.0 == String(action.dropFirst(8)) })
      {
        return (command.2, command.1)
      }
      if action.hasPrefix("action:"), let kind = ActionKind(rawValue: String(action.dropFirst(7))) {
        return (ShelfSymbols.action(kind), kind.title)
      }
      if action.hasPrefix("preset:"),
        let preset = store.settings.customActions.first(where: {
          $0.id.uuidString == String(action.dropFirst(7))
        })
      {
        return (ShelfSymbols.action(preset.kind), preset.name)
      }
      return nil
    }
  }
  private func fit() {
    if !detailSurface {
      resize(
        NSSize(
          width: 200,
          height: 208 + (notice == nil ? 0 : 40) + (processing && activity.uploads[id] == nil ? 30 : 0)))
      detailsVisibility(showingDetails)
      return
    }
    let parameters: CGFloat = draft == nil ? 0 : composerHeight + 1
    let recent: CGFloat =
      recentVisible && !store.recentActions.isEmpty
      ? 40 + CGFloat(store.recentActions.count) * 27 : 0
    let content: CGFloat =
      shelf.items.isEmpty
      ? 166
      : viewMode == .list
        ? min(368, max(172, CGFloat(shelf.items.count) * 60 + 8))
        : min(416, max(252, CGFloat((shelf.items.count + 3) / 3) * 136 + 8))
    let chrome: CGFloat = 48
    let height =
      commandVisible
      ? 400
      : content + chrome + parameters + recent + (activity.uploads[id] != nil ? 150 : processing ? 30 : 0)
        + (failures.isEmpty || draft != nil ? 0 : 28) + (notice == nil ? 0 : 40)
    resize(NSSize(width: 400, height: height))
  }
  private func setViewMode(_ mode: ShelfViewMode) {
    guard mode != viewMode else { return }
    store.updateShelf(id) { $0.viewMode = mode }
  }
  private func setDetailsVisible(_ visible: Bool, restoreFocus: Bool = true) {
    if !visible {
      selection.removeAll()
      commandVisible = false
      recentVisible = false
    }
    store.updateShelf(id) { $0.detailsVisible = visible }
    detailsVisibility(visible || draft != nil)
    if visible { focusDetails() }
    else if restoreFocus { focusCompact() }
    fit()
  }
  private func closeOrClear() {
    if NSEvent.modifierFlags.contains(.option) {
      remove(Set(shelf.items.map(\.id)))
      if draft == nil { setDetailsVisible(false) }
    } else { close() }
  }
  private var totalSize: String {
    totalBytes.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } ?? "计算大小…"
  }
  private var fileContextActions: [ShelfFileMenuAction] {
    store.settings.scriptPaths.map {
      ShelfFileMenuAction(title: URL(fileURLWithPath: $0).lastPathComponent,
                         action: "script:\($0)", symbol: "terminal", group: "自定义脚本",
                         // #51：脚本描述作菜单 tooltip，脚本不再是无说明的黑盒。
                         detail: store.settings.scriptDescriptions[$0])
    } + store.settings.customActions.map {
      ShelfFileMenuAction(title: $0.name, action: "preset:\($0.id.uuidString)", symbol: ShelfSymbols.action($0.kind), kind: $0.kind)
    } + store.settings.cloudAccounts.filter { ShelfMenuSelection.uploadProviders.contains($0.provider.lowercased()) }.map {
      ShelfFileMenuAction(title: "上传到 \($0.name) 并获取链接…" + ($0.shelfMenuConfigurationReady ? "" : "（需配置）"),
                         action: "cloud:\($0.id.uuidString)", symbol: ShelfSymbols.name(.cloud), group: "云分享",
                         enabled: !store.settings.onlineDisabled && $0.shelfMenuConfigurationReady, uploadProvider: $0.provider)
    }
  }
  private func handle(_ command: String) {
    switch command {
    case "a": selection = Set(shelf.items.map(\.id))
    case "c": copyItems()
    case "v": if !processing { paste() }
    case "close", "w": if !processing { close() }
    case "o": if !processing { addFiles() }
    case "preview": preview(chosen.map(\.resolvedURL))
    case "dock": dock()
    case "dockLeft", "dockRight": (NSApp.keyWindow as? ShelfPanel)?.onCommand?(command)
    case "details": if draft == nil { setDetailsVisible(!showingDetails) }
    case "commandBar":
      if !processing {
        if !detailSurface {
          setDetailsVisible(true)
          NotificationCenter.default.post(name: Notification.Name("ShelfCommand.\(id.uuidString)"), object: "commandBar", userInfo: ["detail": true])
          return
        }
        commandVisible.toggle()
        fit()
      }
    case "actionMenu":
      if !processing {
        if let draft {
          do { execute(try draft.makeRequest(sources: chosen.map(\.resolvedURL))) } catch {
            notice = error.localizedDescription
            fit()
          }
        } else {
          showActionMenu()
        }
      }
    case "clear": remove(ShelfMenuSelection.removalIDs(selection: selection, items: shelf.items))
    case "compose":
      commandVisible = false
      fit()
    case "recentOn":
      if detailSurface, showingDetails { recentVisible = true; fit() }
    case "recentOff":
      recentVisible = false
      fit()
    // #74：最近操作列表显示期间按 Return，立即用最近一次操作的参数执行（不走确认面板）。
    case "recentReturn":
      if detailSurface, recentVisible, !processing, let latest = store.recentActions.first {
        do { execute(try latest.makeRequest(sources: chosen.map(\.resolvedURL))) }
        catch {
          notice = error.localizedDescription
          fit()
        }
      }
    // #20：copy-content——把整个架子的内容写入剪贴板（文件写 URL，托管文字写文本）。
    case "copyContent":
      if !processing { copyShelfContent() }
    case "collapse": if draft == nil { setDetailsVisible(false, restoreFocus: false) }
    default: break
    }
  }
  private func copyItems() {
    let board = NSPasteboard.general
    board.clearContents()
    board.writeObjects(chosen.filter(\.isAvailable).map { $0.resolvedURL as NSURL })
  }
  /// #20 copy-content 的剪贴板写入：文件条目写文件 URL，托管文字条目写其文本。
  private func copyShelfContent() {
    let payloads = ShelfInteractionRules.clipboardPayloads(for: shelf.items)
    guard !payloads.isEmpty else { return }
    let board = NSPasteboard.general
    board.clearContents()
    board.writeObjects(payloads.compactMap { payload -> NSPasteboardWriting? in
      if let url = payload.url { return url as NSURL }
      if let text = payload.text { return text as NSString }
      return nil
    })
  }
  private func remove(_ ids: Set<UUID>) {
    guard !processing, !ids.isEmpty else { return }
    selection.subtract(ids)
    store.remove(ids, from: id)
  }
  private func reorder(_ ids: [UUID]) {
    guard !processing else { return }
    store.updateShelf(id) { shelf in
      let members = Dictionary(uniqueKeysWithValues: shelf.items.map { ($0.id, $0) })
      guard Set(ids) == Set(members.keys), ids.count == members.count else { return }
      shelf.items = ids.compactMap { members[$0] }
    }
  }
  private func retryFailures() {
    guard !processing, canRetryIndividually, var request = activity.retryRequests[id],
      !failures.isEmpty
    else { return }
    request.sources = failures.map(\.resolvedURL)
    notice = nil
    execute(request)
  }
  private func useRecent(_ action: ShelfActionDraft) {
    guard !processing else { return }
    _ = store.setActionDraft(action, for: id)
    recentVisible = false
    commandVisible = false
    fit()
  }
  private func recentTitle(_ action: ShelfActionDraft) -> String {
    let detail =
      action.destination.isEmpty
      ? action.name : URL(fileURLWithPath: action.destination).lastPathComponent
    return action.kind.title + (detail.isEmpty ? "" : " · " + detail)
  }
  private func open(_ item: ShelfItem) {
    guard item.isAvailable else {
      notice = "原文件不可访问，请重新连接磁盘。"
      fit()
      return
    }
    // 双击作用面：点击的条目在多选里则作用于整个选择，否则只作用于该条目。
    let targets = selection.contains(item.id) && selection.count > 1
      ? shelf.items.filter { selection.contains($0.id) }
      : [item]
    performDoubleClick(on: targets)
  }
  /// #4：双击文件统一分派（reveal/open/preview/none）。
  /// 打开与在 Wisp 中显示作用于多个文件时先弹确认（单文件、快速预览不弹）。
  private func performDoubleClick(on targets: [ShelfItem]) {
    let behavior = ShelfInteractionRules.doubleClickOutcome(for: store.settings.doubleClickBehavior)
    guard behavior != "none" else { return }
    let urls = targets.filter(\.isAvailable).map(\.resolvedURL)
    if ShelfInteractionRules.doubleClickNeedsConfirmation(behavior: behavior, fileCount: urls.count) {
      let confirmation = NSAlert()
      if behavior == "open" {
        confirmation.messageText = "将要打开 \(urls.count) 个文件"
        confirmation.informativeText = "根据文件的不同，可能会打开多个应用程序。"
      } else {
        confirmation.messageText = "将要显示 \(urls.count) 个文件"
        confirmation.informativeText = "可能会打开多个窗口。"
      }
      confirmation.addButton(withTitle: "打开")
      confirmation.addButton(withTitle: "取消")
      guard confirmation.runModal() == .alertFirstButtonReturn else { return }
    }
    switch behavior {
    case "open": urls.forEach { NSWorkspace.shared.open($0) }
    case "preview": preview(urls)
    default: (NSApp.delegate as? ShelfApplication)?.revealInWisp(urls)
    }
  }
  private func showActionMenu() {
    guard let window = NSApp.keyWindow, let content = window.contentView else { return }
    menuTarget.handlers.removeAll()
    let menu = NSMenu()
    menu.autoenablesItems = false
    let ids = chosen.map(\.id)
    // #76：最爱操作置顶分组，分隔线之后是完整清单。
    let favorites = favoriteMenuNodes(ids: ids, capabilities: menuSelection)
    for node in favorites {
      if case .item(let title, let symbol, _, let enabled, _, let action) = node {
        menuTarget.add(title, to: menu, symbol: symbol, enabled: enabled && !processing, action: action)
      }
    }
    if !favorites.isEmpty { menu.addItem(.separator()) }
    for kind in ActionKind.allCases where menuSelection.supports(kind) {
      menuTarget.add(kind.title, to: menu, symbol: ShelfSymbols.action(kind), enabled: fileCommandsEnabled) { run(kind, chosen.map(\.id)) }
    }
    menu.addItem(.separator())
    for command in utilityCommands where menuSelection.supportsUtility(command.0) {
      menuTarget.add(command.1, to: menu, symbol: command.2, enabled: fileCommandsEnabled) { utility(command.0, chosen.map(\.id)) }
    }
    if !store.settings.customActions.isEmpty { menu.addItem(.separator()) }
    for action in store.settings.customActions where menuSelection.supports(action.kind) {
      menuTarget.add(action.name, to: menu, symbol: ShelfSymbols.action(action.kind), enabled: fileCommandsEnabled) { preset(action, chosen.map(\.id)) }
    }
    menu.popUp(
      positioning: nil, at: NSPoint(x: 12, y: min(content.bounds.height - 34, 80)), in: content)
  }
}

private struct ShelfRevealButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    ShelfRevealButtonSurface(configuration: configuration)
  }
}

private struct ShelfRevealButtonSurface: View {
  let configuration: ButtonStyleConfiguration
  @State private var hovering = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    configuration.label
      .foregroundStyle(ShelfGlassPalette.secondaryText)
      .background(Color.primary.opacity(configuration.isPressed ? 0.12 : hovering ? 0.06 : 0),
                  in: RoundedRectangle(cornerRadius: 6))
      .contentShape(Rectangle()).onHover { hovering = $0 }
      .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: hovering)
      .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: configuration.isPressed)
  }
}

private struct ComposerHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = max(value, nextValue())
  }
}

final class ShelfMenuTarget: NSObject {
  var handlers: [Int: () -> Void] = [:]
  func add(_ title: String, to menu: NSMenu, symbol: String? = nil, enabled: Bool = true, action: @escaping () -> Void) {
    let item = NSMenuItem(title: title, action: #selector(invokeAction(_:)), keyEquivalent: "")
    if let symbol { item.image = ShelfSymbols.image(named: symbol) }
    item.target = self
    item.isEnabled = enabled
    item.tag = handlers.count
    handlers[item.tag] = action
    menu.addItem(item)
  }
  @objc private func invokeAction(_ sender: NSMenuItem) { if sender.isEnabled { handlers[sender.tag]?() } }
}
struct InstantDropView: NSViewRepresentable {
  var icon: String
  var receive: (NSPasteboard) -> Bool
  func makeNSView(context: Context) -> DropIcon { DropIcon(frame: .zero) }
  func updateNSView(_ view: DropIcon, context: Context) {
    view.icon = icon
    view.onReceive = receive
    view.needsDisplay = true
  }
}
final class DropIcon: DropHostView {
  var icon = "tray"
  private var hovering = false
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    trackingAreas.forEach(removeTrackingArea)
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
  override func mouseExited(with event: NSEvent) { hovering = false; needsDisplay = true }
  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    if hovering {
      NSColor.labelColor.withAlphaComponent(0.06).setFill()
      NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 2), xRadius: 6, yRadius: 6).fill()
    }
    let color = highlight ? NSColor.controlAccentColor : hovering ? NSColor.labelColor : ShelfGlassPalette.secondaryLabel
    ShelfSymbols.image(named: icon, pointSize: 13)?.withSymbolConfiguration(.init(paletteColors: [color]))?
      .draw(in: NSRect(x: bounds.midX - 7, y: bounds.midY - 7, width: 14, height: 14))
  }
}

/// 顶部中间的拖动提示条。
///
/// 参考应用实测（把鼠标移进面板才量得到）：
///   - 尺寸 **35 × 3.5pt** 的圆角胶囊，水平居中，距面板顶 **5pt**
///   - **鼠标移进面板才淡入**；不悬停时顶部中段逐像素差为 0，完全量不出来
///   - 悬停后比面板底亮约 21%
///
/// 之前我把这条删掉了，理由写在注释里是「参考应用的架子上没有这个东西」——
/// **那个判断是错的**，因为当时是在没悬停的截图上量的。用户提供的那张竞品截图里
/// 就能看见它，于是又加回来。教训：量「悬停才出现」的元素，必须先把鼠标放上去。
private struct ShelfGrabBar: View {
  var visible: Bool
  var color: Color
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    // 颜色取架子自己的颜色。参考应用那条横杠就是**有颜色的**（它那个架子是珊瑚色），
    // 写死白/灰等于"图钉没有颜色"——用户指出的正是这一点。
    Capsule().fill(color.opacity(visible ? 0.85 : 0.5))
      .frame(width: 35, height: 3.5)
      .opacity(visible ? 1 : 0)
      .allowsHitTesting(false)
      .animation(ShelfMotion.animation(.feedback, reduceMotion: reduceMotion), value: visible)
  }
}

private struct ShelfPanelHover: ViewModifier {
  let shelfID: UUID
  var color: Color
  @State private var hovering = false
  func body(content: Content) -> some View {
    content.overlay(alignment: .top) {
      ShelfGrabBar(visible: hovering, color: color).padding(.top, 5)
    }
    .onReceive(NotificationCenter.default.publisher(for: Notification.Name("ShelfPanelHover"))) { note in
      guard let id = note.object as? UUID, id == shelfID else { return }
      hovering = (note.userInfo?["hovering"] as? Bool) ?? hovering
    }
  }
}

extension View {
  fileprivate func shelfGrabBar(_ shelfID: UUID, color: Color) -> some View {
    modifier(ShelfPanelHover(shelfID: shelfID, color: color))
  }
}
