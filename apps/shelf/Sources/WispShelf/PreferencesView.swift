import AppKit
import Carbon
import ShelfCore
import SwiftUI
import UniformTypeIdentifiers

@MainActor
struct PreferencesView: View {
    @ObservedObject var store: ShelfStore
    private let newShelf: () -> Void
    private let onGuide: () -> Void
    private let onScreenshotTest: () -> Void
    @State private var page: PreferencesPage = .activation
    @State private var advancedPresented = false
    @State private var shortcutsPresented = false
    @State private var ignoredAppsPresented = false
    @State private var scriptsPresented = false
    @State private var screenshotPresented = false
    @State private var selectedAction: UUID?
    @State private var editingAction: ActionPreset?
    @State private var editingCloud: CloudAccount?
    @State private var cloudHistoryPresented = false
    @State private var editingShortcut: ShortcutBinding?
    @State private var editingLocalShortcut = false
    @State private var editingWatchedFolder: WatchedFolder?
    @State private var copiedCommand = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: ShelfStore, newShelf: @escaping () -> Void,
         onGuide: @escaping () -> Void = {}, onScreenshotTest: @escaping () -> Void = {}) {
        self.store = store
        self.newShelf = newShelf
        self.onGuide = onGuide
        self.onScreenshotTest = onScreenshotTest
    }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(ShelfGlassPalette.separator).frame(width: 1)
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text(page.rawValue)
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // #84：设置页顶部的「快速上手」入口（三页交互式引导）。
                    Button("快速上手…") { onGuide() }
                        .buttonStyle(ShelfGlassButtonStyle())
                        .help("三步学会晃动、投放与收起/找回")
                        .accessibilityLabel("快速上手")
                    Button(action: newShelf) {
                        ShelfIcon(.add)
                    }
                    .buttonStyle(ShelfQuietIconStyle(size: 28))
                    .help("新的悬浮窗")
                    .accessibilityLabel("新的悬浮窗")
                }
                .padding(.horizontal, 22)
                .frame(height: 58)
                .background(ShelfGlassBackground(material: .popover))
                Rectangle().fill(ShelfGlassPalette.separator).frame(height: 1)
                content
                    .id(page)
                    .transition(.opacity)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: page)
                    .scrollContentBackground(.hidden)
                    .buttonStyle(ShelfGlassButtonStyle())
                    .textFieldStyle(ShelfGlassFieldStyle())
                if let error = store.lastError {
                    HStack(alignment: .top, spacing: 8) {
                        ShelfIcon(.warning)
                        Text(error).textSelection(.enabled)
                        Spacer(minLength: 0)
                        Button("重试保存") { store.persist() }
                            .buttonStyle(ShelfGlassButtonStyle())
                    }
                    .font(.callout)
                    .foregroundStyle(.red)
                    .padding(12)
                    .background(ShelfGlassPalette.controlFill)
                }
            }
            .frame(minWidth: 529, maxWidth: .infinity, maxHeight: .infinity)
            .background(ShelfGlassPalette.canvas)
        }
        .frame(minWidth: 700, idealWidth: 740, minHeight: 560, idealHeight: 600)
        .background(ShelfGlassPalette.canvas)
        .toggleStyle(.switch)
        .sheet(isPresented: $advancedPresented) { advancedSheet }
        .sheet(isPresented: $shortcutsPresented) { shortcutsSheet }
        .sheet(isPresented: $ignoredAppsPresented) { ignoredAppsSheet }
        .sheet(isPresented: $screenshotPresented) { screenshotSheet }
        .sheet(isPresented: $cloudHistoryPresented) { CloudShareHistoryView(store: store) }
        .sheet(item: $editingAction) { action in
            ActionPresetEditor(initial: action) { updated in
                upsertAction(updated)
            }
        }
        .sheet(item: $editingCloud) { account in
            CloudAccountEditor(initial: account, hasCredential: store.credential(for: account) != nil,
                               test: { draft, secret in
                // #66：测试用编辑中的配置；未新填密钥时回落到本机已保存的凭据。
                if store.settings.onlineDisabled {
                    var progress = CloudConnectionTestProgress()
                    progress.fail(.upload, message: "在线功能已关闭，未执行测试连接。")
                    return progress
                }
                let credential = secret ?? store.credential(for: draft)
                return await CloudConnectionTest.run(account: draft, credential: credential)
            }) { updated, secret in
                saveCloud(updated, secret: secret)
            }
        }
        .sheet(item: $editingWatchedFolder) { folder in
            WatchedFolderEditor(initial: folder, save: saveWatchedFolder)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                ShelfIcon(.shelf, size: 18)
                    .foregroundStyle(.primary)
                    .frame(width: 30, height: 30)
                    .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 7))
                Text("收集架").font(.system(size: 15, weight: .semibold))
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 12)
            List(PreferencesPage.allCases, selection: Binding<PreferencesPage?>(get: { page }, set: {
                if let value = $0 { page = value }
            })) { item in
                HStack(spacing: 10) {
                    ShelfIcon(named: item.symbol)
                        .foregroundStyle(.white)
                        .frame(width: 25, height: 25)
                        .background(item.tint, in: RoundedRectangle(cornerRadius: 6))
                    Text(item.rawValue)
                        .font(.system(size: 13, weight: page == item ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 4)
                .tag(item)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            Spacer(minLength: 16)
            HStack(spacing: 6) {
                Text("测试版")
                Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    .monospacedDigit()
            }
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(width: 170)
        .background(ShelfGlassBackground(material: .sidebar))
    }

    @ViewBuilder private var content: some View {
        switch page {
        case .activation: activationPage
        case .interaction: interactionPage
        case .general: generalPage
        case .cloud: cloudPage
        case .custom: customPage
        case .instant: instantPage
        case .watching: watchingPage
        }
    }

    private var activationPage: some View {
        Form {
            Section {
                Toggle("晃动激活", isOn: setting(\.shakeEnabled))
                HStack {
                    Text("灵敏度")
                    Slider(value: setting(\.shakeSensitivity), in: 0.3...1)
                        .frame(maxWidth: 210)
                        .disabled(!store.settings.shakeEnabled)
                    Text(store.settings.shakeSensitivity.formatted(.number.precision(.fractionLength(1))))
                        .monospacedDigit().frame(width: 28)
                }
            }
            Section {
                Toggle("按键激活", isOn: setting(\.modifierEnabled))
                Picker("拖动时按住", selection: setting(\.activationModifier)) {
                    Text("Shift（上档键）").tag("shift")
                    Text("Option（选项键）").tag("option")
                    Text("Control（控制键）").tag("control")
                    Text("Command（命令键）").tag("command")
                }
                .disabled(!store.settings.modifierEnabled)
                settingsRow("键盘快捷键", symbol: "keyboard") {
                    Button("编辑…") { shortcutsPresented = true }
                }
            }
            Section {
                Toggle("拖放到刘海", isOn: setting(\.notchEnabled))
                Picker("默认架子位置", selection: setting(\.defaultPosition)) {
                    Text("右上角").tag("topRight")
                    Text("左上角").tag("topLeft")
                    Text("右下角").tag("bottomRight")
                    Text("左下角").tag("bottomLeft")
                    Text("中央").tag("center")
                    Text("光标附近").tag("cursor")
                }
                Picker("添加文件的行为", selection: setting(\.additionBehavior)) {
                    Text("在新窗口中显示").tag("new")
                    Text("添加到当前窗口").tag("current")
                    Text("添加到可见窗口").tag("visible")
                }
                settingsRow("忽略的应用", symbol: "app.badge") {
                    Button("编辑…") { ignoredAppsPresented = true }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var interactionPage: some View {
        Form {
            Section {
                Picker("双击文件", selection: setting(\.doubleClickBehavior)) {
                    Text("在 Wisp 中显示").tag("reveal")
                    Text("打开文件").tag("open")
                    Text("快速预览").tag("preview")
                    Text("无操作").tag("none")
                }
                Picker("双击窗口边缘", selection: setting(\.edgeDoubleClick)) {
                    Text("将窗口停靠").tag("dock")
                    Text("收起此窗口").tag("hide")
                    Text("无操作").tag("none")
                }
            }
            Section {
                settingsRow("自定义操作", symbol: "star") {
                    Button("编辑…") { page = .custom }
                }
                settingsRow("屏幕截图", symbol: "camera.viewfinder") {
                    Button("设置截图…") { screenshotPresented = true }
                }
                Picker("拖出后关闭", selection: setting(\.closeAfterDrag)) {
                    Text("仅在文件被移动时").tag("moved")
                    Text("始终（复制到目标后也关闭）").tag("always")
                    Text("从不").tag("never")
                }
                Toggle("将窗口自动放置到位", isOn: setting(\.autoPlace))
                Toggle("首次拖放后缩回窗口", isOn: setting(\.retractAfterDrop))
            }
            Section {
                settingsRow("高级交互", symbol: "slider.horizontal.3") {
                    Button("高级…") { advancedPresented = true }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var generalPage: some View {
        Form {
            Section {
                Toggle("显示菜单栏图标", isOn: setting(\.showMenuBar))
                Toggle("登录时启动", isOn: setting(\.startAtLogin))
                Toggle("在程序坞显示", isOn: setting(\.showDock))
            }
            Section {
                Toggle("禁用在线功能", isOn: setting(\.onlineDisabled))
            }
        }
        .formStyle(.grouped)
    }

    private var customPage: some View {
        Form {
            Section {
                List(selection: $selectedAction) {
                    ForEach(store.settings.customActions) { action in
                        HStack(spacing: 10) {
                            ShelfIcon(named: actionSymbol(action.kind)).frame(width: 20)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(action.name).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                                Text(actionTitle(action.kind)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .tag(action.id)
                        .contextMenu {
                            Button("编辑…") { editingAction = action }
                            Button("移除操作", role: .destructive) { removeAction(action.id) }
                        }
                    }
                }
                .frame(minHeight: 250)
                .overlay {
                    if store.settings.customActions.isEmpty {
                        Text("尚无自定义操作").foregroundStyle(.secondary).allowsHitTesting(false)
                    }
                }
                HStack(spacing: 12) {
                    Menu {
                        ForEach(actionKinds, id: \.self) { kind in
                            Button {
                                editingAction = ActionPreset(name: actionTitle(kind), kind: kind)
                            } label: { Label(actionTitle(kind), systemImage: actionSymbol(kind)) }
                        }
                    } label: { ShelfIcon(.add) }
                    .menuStyle(.borderlessButton).modifier(PreferenceToolMenuStyle())
                    .help("添加操作").accessibilityLabel("添加操作")
                    iconButton("minus", label: "移除操作", disabled: selectedAction == nil) {
                        if let id = selectedAction { removeAction(id) }
                    }
                    Spacer()
                    iconButton("pencil", label: "编辑操作", disabled: selectedAction == nil) {
                        editingAction = store.settings.customActions.first { $0.id == selectedAction }
                    }
                }
            }
            // #76：最爱操作（≤5）置顶显示在架子的动作菜单里。
            Section("最爱操作") {
                if store.settings.favoriteActionIDs.isEmpty {
                    Text("未选择。勾选的操作会置顶出现在架子动作菜单，最多五项。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(store.settings.favoriteActionIDs, id: \.self) { id in
                    if let choice = favoriteCandidates.first(where: { $0.id == id }) {
                        HStack(spacing: 10) {
                            ShelfIcon(named: choice.symbol).frame(width: 20)
                            Text(choice.title).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 8)
                            iconButton("star.slash", label: "取消最爱") { toggleFavorite(id) }
                        }
                    }
                }
                Menu {
                    ForEach(favoriteCandidates.filter { !store.settings.favoriteActionIDs.contains($0.id) }) { choice in
                        Button {
                            toggleFavorite(choice.id)
                        } label: { Label(choice.title, systemImage: ShelfSymbols.name(choice.symbol)) }
                    }
                } label: { Label("添加最爱", systemImage: "star") }
                    .menuStyle(.borderlessButton).modifier(PreferenceToolMenuStyle())
                    .disabled(store.settings.favoriteActionIDs.count >= 5)
                    .help("从标准操作、自定义操作、脚本和云上传里挑，最多五项")
                    .accessibilityLabel("添加最爱")
                Text("\(store.settings.favoriteActionIDs.count)/5")
                    .font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .formStyle(.grouped)
    }

    /// #76：最爱动作的候选全集（动作菜单里能出现的都在这里）。
    private var favoriteCandidates: [InstantActionChoice] {
        let standard = ActionKind.allCases.map {
            InstantActionChoice(id: "action:\($0.rawValue)", title: actionTitle($0), symbol: actionSymbol($0))
        }
        let utilities = [
            InstantActionChoice(id: "utility:copyPaths", title: "复制文件路径", symbol: "doc.on.clipboard"),
            InstantActionChoice(id: "utility:copyTextContents", title: "复制文本正文", symbol: "doc.text"),
            InstantActionChoice(id: "utility:removeImageMetadata", title: "去除图片元数据", symbol: "photo"),
            InstantActionChoice(id: "utility:moveToTrash", title: "移到废纸篓", symbol: "trash")
        ]
        let presets = store.settings.customActions.map {
            InstantActionChoice(id: "preset:\($0.id.uuidString)", title: $0.name, symbol: actionSymbol($0.kind))
        }
        let scripts = store.settings.scriptPaths.map {
            InstantActionChoice(id: "script:\($0)", title: URL(fileURLWithPath: $0).lastPathComponent, symbol: "terminal")
        }
        let clouds = store.settings.cloudAccounts
            .filter { ShelfMenuSelection.uploadProviders.contains($0.provider.lowercased()) }
            .map { InstantActionChoice(id: "cloud:\($0.id.uuidString)", title: "上传到 \($0.name)", symbol: ShelfSymbols.name(.cloud)) }
        return standard + utilities + presets + scripts + clouds
    }

    private func toggleFavorite(_ id: String) {
        if let index = store.settings.favoriteActionIDs.firstIndex(of: id) {
            store.settings.favoriteActionIDs.remove(at: index)
        } else if store.settings.favoriteActionIDs.count < 5,
                  favoriteCandidates.contains(where: { $0.id == id }) {
            store.settings.favoriteActionIDs.append(id)
        }
        store.persist()
    }

    private var instantPage: some View {
        Form {
            Section {
                Toggle("启用即时操作", isOn: setting(\.instantActionsEnabled))
            }
            Section {
                if store.settings.instantActionIDs.isEmpty {
                    Text("尚无即时操作").foregroundStyle(.secondary)
                }
                ForEach(Array(store.settings.instantActionIDs.enumerated()), id: \.offset) { index, id in
                    instantActionRow(id, at: index)
                }
                HStack {
                    Menu {
                        instantActionMenu
                    } label: { ShelfIcon(.add) }
                    .menuStyle(.borderlessButton).modifier(PreferenceToolMenuStyle())
                    .disabled(store.settings.instantActionIDs.count >= 6)
                    .help("添加即时操作，最多六项").accessibilityLabel("添加即时操作")
                    Text("\(store.settings.instantActionIDs.count)/6")
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    Spacer()
                    Button("还原默认值") {
                        store.settings.instantActionIDs = ["airdrop", "messages", "mail", "cloud"]
                        store.persist()
                    }
                }
            }
            .disabled(!store.settings.instantActionsEnabled)
        }
        .formStyle(.grouped)
    }

    private func instantActionRow(_ id: String, at index: Int) -> some View {
        let choice = instantChoices.first { $0.id == id }
        return HStack(spacing: 10) {
            ShelfIcon(named: choice?.symbol ?? ShelfSymbols.name(.warning))
                .foregroundStyle(choice == nil ? .secondary : .primary)
                .frame(width: 22)
            Text(choice?.title ?? "已失效的操作")
                .foregroundStyle(choice == nil ? .secondary : .primary)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            iconButton("arrow.up", label: "向前移动", disabled: index == 0) {
                moveInstantAction(at: index, offset: -1)
            }
            iconButton("arrow.down", label: "向后移动", disabled: index == store.settings.instantActionIDs.count - 1) {
                moveInstantAction(at: index, offset: 1)
            }
            iconButton("minus.circle", label: "移除即时操作") {
                guard store.settings.instantActionIDs.indices.contains(index) else { return }
                store.settings.instantActionIDs.remove(at: index)
                store.persist()
            }
        }
    }

    @ViewBuilder private var instantActionMenu: some View {
        Section("分享") {
            ForEach(instantChoices.filter { !$0.id.contains(":") }) { choice in
                instantChoiceButton(choice)
            }
        }
        Section("标准操作") {
            ForEach(instantChoices.filter { $0.id.hasPrefix("action:") }) { choice in
                instantChoiceButton(choice)
            }
        }
        Section("辅助操作") {
            ForEach(instantChoices.filter { $0.id.hasPrefix("utility:") }) { choice in
                instantChoiceButton(choice)
            }
        }
        if !store.settings.customActions.isEmpty {
            Section("自定义操作") {
                ForEach(instantChoices.filter { $0.id.hasPrefix("preset:") }) { choice in
                    instantChoiceButton(choice)
                }
            }
        }
    }

    private func instantChoiceButton(_ choice: InstantActionChoice) -> some View {
        Button {
            guard store.settings.instantActionIDs.count < 6,
                  !store.settings.instantActionIDs.contains(choice.id),
                  instantChoices.contains(where: { $0.id == choice.id }) else { return }
            store.settings.instantActionIDs.append(choice.id)
            store.persist()
        } label: { Label(choice.title, systemImage: ShelfSymbols.name(choice.symbol)) }
        .disabled(store.settings.instantActionIDs.contains(choice.id))
    }

    private var instantChoices: [InstantActionChoice] {
        let sharing = [
            InstantActionChoice(id: "airdrop", title: "隔空投送", symbol: ShelfSymbols.name(.airdrop)),
            InstantActionChoice(id: "messages", title: "信息", symbol: ShelfSymbols.name(.messages)),
            InstantActionChoice(id: "mail", title: "邮件", symbol: ShelfSymbols.name(.mail)),
            InstantActionChoice(id: "cloud", title: "云链接", symbol: ShelfSymbols.name(.link))
        ]
        let standard = actionKinds.map {
            InstantActionChoice(id: "action:\($0.rawValue)", title: actionTitle($0), symbol: actionSymbol($0))
        }
        let utilities = [
            InstantActionChoice(id: "utility:copyPaths", title: "复制文件路径", symbol: "doc.on.clipboard"),
            InstantActionChoice(id: "utility:copyTextContents", title: "复制文字内容", symbol: "doc.text"),
            InstantActionChoice(id: "utility:removeImageMetadata", title: "移除图片元数据", symbol: "photo"),
            InstantActionChoice(id: "utility:moveToTrash", title: "移至废纸篓", symbol: "trash")
        ]
        let presets = store.settings.customActions.map {
            InstantActionChoice(id: "preset:\($0.id.uuidString)", title: $0.name, symbol: actionSymbol($0.kind))
        }
        return sharing + standard + utilities + presets
    }

    private func moveInstantAction(at index: Int, offset: Int) {
        let destination = index + offset
        guard store.settings.instantActionIDs.indices.contains(index),
              store.settings.instantActionIDs.indices.contains(destination) else { return }
        store.settings.instantActionIDs.swapAt(index, destination)
        store.persist()
    }

    private var watchingPage: some View {
        Form {
            Section {
                if store.settings.watchedFolders.isEmpty {
                    Text("尚无观察文件夹").foregroundStyle(.secondary)
                }
                ForEach(store.settings.watchedFolders) { folder in
                    HStack(spacing: 12) {
                        ShelfIcon(.folder)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(URL(fileURLWithPath: folder.path).lastPathComponent)
                                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            Text(folder.path).font(.caption).foregroundStyle(.secondary)
                                .lineLimit(2).textSelection(.enabled)
                            Text(watchedFolderSummary(folder)).font(.caption).foregroundStyle(.secondary)
                                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 4)
                        // #33：状态徽标（监听中/已停止/有问题），error 态给「重选文件夹」。
                        watchedStatusBadge(folder)
                        Toggle("观察", isOn: watchedFolderEnabled(folder.id))
                            .labelsHidden().help("观察此文件夹")
                        if store.watchedFolderStatus(for: folder) == "error" {
                            iconButton("arrow.uturn.backward", label: "重选文件夹") { editingWatchedFolder = folder }
                        }
                        iconButton("pencil", label: "编辑观察规则") { editingWatchedFolder = folder }
                        iconButton("minus.circle", label: "停止观察并移除引用") {
                            store.settings.watchedFolders.removeAll { $0.id == folder.id }
                            store.persist()
                        }
                    }
                }
                HStack {
                    iconButton("plus", label: "添加观察文件夹", action: addWatchedFolders)
                    Spacer()
                }
            }
        }
        .formStyle(.grouped)
    }

    private var cloudPage: some View {
        Form {
            Section {
                if store.settings.cloudAccounts.isEmpty {
                    Text("尚无云服务配置").foregroundStyle(.secondary)
                }
                ForEach(store.settings.cloudAccounts) { account in
                    HStack(spacing: 10) {
                        ShelfIcon(.cloud).frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(account.name).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            Text(providerTitle(account.provider)).font(.caption).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        Text("未连接").font(.caption).foregroundStyle(.secondary)
                        iconButton("pencil", label: "编辑云配置") { editingCloud = account }
                        iconButton("minus.circle", label: "移除本机配置") {
                            store.settings.cloudAccounts.removeAll { $0.id == account.id }
                            store.persist()
                        }
                    }
                }
                HStack {
                    Menu {
                        ForEach(cloudProviders, id: \.self) { provider in
                            Button(providerTitle(provider)) {
                                var account = CloudAccount(provider: provider)
                                account.name = providerTitle(provider)
                                editingCloud = account
                            }
                        }
                    } label: { ShelfIcon(.add) }
                    .menuStyle(.borderlessButton).modifier(PreferenceToolMenuStyle())
                    .help("添加云配置").accessibilityLabel("添加云配置")
                    Spacer()
                }
            }
            .disabled(store.settings.onlineDisabled)
            Section {
                settingsRow("本机分享历史", symbol: "clock.arrow.circlepath") {
                    Button("查看…") { cloudHistoryPresented = true }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var advancedSheet: some View {
        PreferenceSheet(title: "高级交互") {
            Form {
                Toggle("使用颜色区分窗口", isOn: setting(\.colorShelves))
                Toggle("点击外部关闭详情", isOn: setting(\.closeDetailsOutside))
                Toggle("文字使用纯文本", isOn: setting(\.plainText))
                Toggle("使用单独的系统桌面空间", isOn: setting(\.ownSpace))
                Toggle("拖出时复制到目标", isOn: setting(\.copyOnDrag))
                Toggle("出现时聚焦窗口", isOn: setting(\.focusOnShow))
                Toggle("智能命名新窗口", isOn: setting(\.intelligentShelfName))
                    .help("放入文件后，按内容组成自动命名，例如「4 张图片」。手动改过名字的窗口不受影响。")
                settingsRow("脚本", symbol: "terminal") {
                    Button("编辑…") { scriptsPresented = true }
                }
            }.formStyle(.grouped)
        }.sheet(isPresented: $scriptsPresented) { scriptsSheet }
    }

    private var screenshotSheet: some View {
        PreferenceSheet(title: "屏幕截图") {
            Form {
                Section {
                    Toggle("自动接收新截图", isOn: setting(\.screenshotMonitoringEnabled))
                        .disabled(store.settings.screenshotDirectory.isEmpty)
                    HStack(alignment: .top, spacing: 12) {
                        ShelfIcon(.folder).foregroundStyle(.secondary)
                        Text(store.settings.screenshotDirectory.isEmpty ? "未选择截图文件夹" : store.settings.screenshotDirectory)
                            .font(.callout).lineLimit(3).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button("选择…") { chooseScreenshotDirectory() }
                        iconButton("xmark.circle", label: "移除截图文件夹", disabled: store.settings.screenshotDirectory.isEmpty) {
                            store.settings.screenshotMonitoringEnabled = false
                            store.settings.screenshotDirectory = ""
                            store.persist()
                        }
                    }
                }
                Section {
                    Picker("接收方式", selection: setting(\.screenshotAdditionBehavior)) {
                        Text("连续添加到当前窗口").tag("current")
                        Text("每次创建新窗口").tag("new")
                    }
                    .disabled(!store.settings.screenshotMonitoringEnabled)
                }
                // #34：「拍一张试试」与禁用系统浮动缩略图的指引。
                Section("验证与系统设置") {
                    HStack {
                        Button("拍一张试试") { onScreenshotTest() }
                            .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                            .disabled(!store.settings.screenshotMonitoringEnabled || store.settings.screenshotDirectory.isEmpty)
                            .help("调起系统交互截图，直接落在上方文件夹里；60 秒内检测到新截图，收集架会自动亮起。")
                        Text("调起系统截图，拍完自动进收集架。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("不想看到截图右下角的浮动缩略图？在系统设置的「截屏」里关闭「显示浮缩略图」。")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button("打开系统设置…") {
                                if let url = URL(string: "x-apple.systempreferences:com.apple.Screenshots") {
                                    NSWorkspace.shared.open(url)
                                }
                            }
                            Button(copiedCommand ? "已复制" : "复制终端指令") { copyThumbnailCommand() }
                            Text("defaults write com.apple.screencapture show-thumbnail -bool FALSE；killall SystemUIServer")
                                .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                                .lineLimit(1).truncationMode(.middle)
                                .help("defaults write com.apple.screencapture show-thumbnail -bool FALSE\nkillall SystemUIServer")
                        }
                    }
                }
            }.formStyle(.grouped)
        }
    }

    private var shortcutsSheet: some View {
        PreferenceSheet(title: "键盘快捷键") {
            Form {
                Section("全局快捷键") {
                    ForEach(store.settings.shortcutBindings) { shortcut in
                        shortcutRow(shortcut, local: false)
                    }
                }
                Section("架子内快捷键") {
                    ForEach(store.settings.localShortcutBindings) { shortcut in
                        shortcutRow(shortcut, local: true)
                    }
                }
            }.formStyle(.grouped)
        }.sheet(item: $editingShortcut) { shortcut in
            ShortcutRecorder(initial: shortcut, requiresModifier: !editingLocalShortcut) { updated in
                saveShortcut(updated, local: editingLocalShortcut)
            }
        }
    }

    private func shortcutRow(_ shortcut: ShortcutBinding, local: Bool) -> some View {
        HStack {
            Toggle(isOn: shortcutEnabled(shortcut.id, local: local)) {
                Text(shortcut.title).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(shortcutDisplay(shortcut)) {
                editingLocalShortcut = local
                editingShortcut = shortcut
            }
            .frame(minWidth: 110)
            .help(local ? "录入架子内快捷键" : "录入全局快捷键")
        }
    }

    private var ignoredAppsSheet: some View {
        PreferenceSheet(title: "忽略的应用") {
            VStack(spacing: 12) {
                List {
                    ForEach(store.settings.ignoredApps, id: \.self) { identifier in
                        HStack {
                            Text(applicationName(identifier))
                            Spacer()
                            iconButton("minus.circle", label: "移除忽略项") {
                                store.settings.ignoredApps.removeAll { $0 == identifier }
                                store.persist()
                            }
                        }
                    }
                }
                .frame(minHeight: 220)
                HStack {
                    iconButton("plus", label: "添加忽略应用", action: addIgnoredApps)
                    Spacer()
                }
            }.padding(.horizontal, 20)
        }
    }

    private var scriptsSheet: some View {
        PreferenceSheet(title: "脚本配置") {
            VStack(spacing: 12) {
                List {
                    ForEach(store.settings.scriptPaths, id: \.self) { path in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(URL(fileURLWithPath: path).lastPathComponent)
                                    Text(path).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer()
                                iconButton("minus.circle", label: "移除脚本引用") {
                                    store.settings.scriptPaths.removeAll { $0 == path }
                                    store.settings.scriptDescriptions.removeValue(forKey: path)
                                    store.persist()
                                }
                            }
                            // #51：每条脚本一个描述，菜单里作 tooltip，避免脚本成了黑盒。
                            TextField("描述（可选，悬停菜单时显示）", text: scriptDescription(path))
                                .font(.callout)
                        }
                        .padding(.vertical, 2)
                    }
                }.frame(minHeight: 220)
                Divider()
                Toggle("复制脚本输出", isOn: setting(\.scriptCopyOutput))
                Toggle("成功后关闭架子", isOn: setting(\.scriptCloseOnSuccess))
                HStack {
                    iconButton("plus", label: "添加脚本引用", action: addScripts)
                    Spacer()
                }
            }.padding(.horizontal, 20)
        }
    }

    private func scriptDescription(_ path: String) -> Binding<String> {
        Binding(get: { store.settings.scriptDescriptions[path] ?? "" }, set: { value in
            var descriptions = store.settings.scriptDescriptions
            if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { descriptions.removeValue(forKey: path) }
            else { descriptions[path] = value }
            store.settings.scriptDescriptions = descriptions
            store.persist()
        })
    }

    private func setting<Value>(_ keyPath: WritableKeyPath<ShelfSettings, Value>) -> Binding<Value> {
        Binding(get: { store.settings[keyPath: keyPath] }, set: { value in
            store.settings[keyPath: keyPath] = value
            store.persist()
        })
    }

    private func watchedFolderEnabled(_ id: UUID) -> Binding<Bool> {
        Binding(get: { store.settings.watchedFolders.first { $0.id == id }?.enabled ?? false }, set: { value in
            guard let index = store.settings.watchedFolders.firstIndex(where: { $0.id == id }) else { return }
            store.settings.watchedFolders[index].enabled = value
            store.persist()
        })
    }

    private func shortcutEnabled(_ id: String, local: Bool) -> Binding<Bool> {
        Binding(get: {
            let bindings = local ? store.settings.localShortcutBindings : store.settings.shortcutBindings
            return bindings.first { $0.id == id }?.enabled ?? false
        }, set: { value in
            var bindings = local ? store.settings.localShortcutBindings : store.settings.shortcutBindings
            guard let index = bindings.firstIndex(where: { $0.id == id }) else { return }
            let shortcut = bindings[index]
            if value, bindings.contains(where: {
                $0.id != id && $0.enabled && $0.keyCode == shortcut.keyCode && $0.modifiers == shortcut.modifiers
            }) {
                store.lastError = local ? "这个组合已用于其他架子内快捷键。" : "这个组合已用于其他全局快捷键。"
                return
            }
            bindings[index].enabled = value
            if local { store.settings.localShortcutBindings = bindings }
            else { store.settings.shortcutBindings = bindings }
            store.persist()
        })
    }

    private func addWatchedFolders() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.allowsMultipleSelection = true
        panel.prompt = "添加"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            let path = url.standardizedFileURL.path
            if !store.settings.watchedFolders.contains(where: { $0.path == path }) {
                store.settings.watchedFolders.append(WatchedFolder(path: path))
            }
        }
        store.persist()
    }

    private func watchedFolderSummary(_ folder: WatchedFolder) -> String {
        let suffixes = folder.normalizedExtensions
        var filter = suffixes.isEmpty ? folder.fileType.title : folder.fileType.title + " · " + suffixes.joined(separator: ", ")
        // #30/#32：摘要里带上名称条件与每文件开窗的声明，规则一眼可读。
        let keyword = folder.nameText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !keyword.isEmpty {
            let condition = folder.nameCondition == "startsWith" ? "名称开头「\(keyword)」" : "名称包含「\(keyword)」"
            filter += " · " + condition
        }
        if folder.perFileNewShelf { filter += " · 每个文件单独开窗" }
        return filter + " · 延迟 " + folder.effectiveCollectionDelay.formatted(.number.precision(.fractionLength(1))) + " 秒"
    }

    /// #33：三态徽标。error 优先于 stopped（有问题的文件夹即使关掉开关也要能重选修复）。
    @ViewBuilder private func watchedStatusBadge(_ folder: WatchedFolder) -> some View {
        let status = store.watchedFolderStatus(for: folder)
        let (title, color): (String, Color) = {
            switch status {
            case "error": return ("有问题", .red)
            case "stopped": return ("已停止", .secondary)
            default: return ("监听中", .green)
            }
        }()
        Text(title).font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
            .help(status == "error" ? "文件夹不可访问：磁盘未挂载或路径已移动。点「重选文件夹」修复。" : title)
    }

    private func saveWatchedFolder(_ folder: WatchedFolder) -> Bool {
        let normalized = URL(fileURLWithPath: folder.path).resolvingSymlinksInPath().standardizedFileURL
        guard !store.settings.watchedFolders.contains(where: {
            $0.id != folder.id && URL(fileURLWithPath: $0.path).resolvingSymlinksInPath().standardizedFileURL == normalized
        }) else { store.lastError = "该文件夹已有观察规则。"; return false }
        guard let index = store.settings.watchedFolders.firstIndex(where: { $0.id == folder.id }) else {
            store.lastError = "观察规则已移除。"; return false
        }
        store.settings.watchedFolders[index] = folder
        return store.persist()
    }

    private func chooseScreenshotDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false; panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = false
        panel.prompt = "选择"
        if !store.settings.screenshotDirectory.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: store.settings.screenshotDirectory)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.settings.screenshotDirectory = url.standardizedFileURL.path
        store.persist()
    }

    /// #34：复制关闭系统浮动缩略图的终端指令（深链打不开时的兜底路径）。
    private func copyThumbnailCommand() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(
            "defaults write com.apple.screencapture show-thumbnail -bool FALSE\nkillall SystemUIServer",
            forType: .string)
        copiedCommand = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copiedCommand = false }
    }

    private func addIgnoredApps() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.applicationBundle]; panel.allowsMultipleSelection = true
        panel.prompt = "添加"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            guard let identifier = Bundle(url: url)?.bundleIdentifier else {
                store.lastError = "无法读取所选应用的标识。"
                continue
            }
            if !store.settings.ignoredApps.contains(identifier) { store.settings.ignoredApps.append(identifier) }
        }
        store.persist()
    }

    private func addScripts() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.prompt = "添加引用"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls where !store.settings.scriptPaths.contains(url.path) {
            store.settings.scriptPaths.append(url.path)
        }
        store.persist()
    }

    private func upsertAction(_ action: ActionPreset) -> Bool {
        if let index = store.settings.customActions.firstIndex(where: { $0.id == action.id }) {
            store.settings.customActions[index] = action
        } else { store.settings.customActions.append(action) }
        return store.persist()
    }

    private func removeAction(_ id: UUID) {
        store.settings.customActions.removeAll { $0.id == id }
        selectedAction = nil
        store.persist()
    }

    private func saveCloud(_ account: CloudAccount, secret: String?) -> Bool {
        var updated = account
        let index = store.settings.cloudAccounts.firstIndex(where: { $0.id == account.id })
        if let index, updated.credentialIdentityChanged(from: store.settings.cloudAccounts[index]) {
            updated.credentialKey = UUID().uuidString
        }
        if let secret, !secret.isEmpty, !store.setCredential(secret, for: updated) { return false }
        if let index {
            store.settings.cloudAccounts[index] = updated
        } else { store.settings.cloudAccounts.append(updated) }
        return store.persist()
    }

    private func saveShortcut(_ shortcut: ShortcutBinding, local: Bool) -> String? {
        var bindings = local ? store.settings.localShortcutBindings : store.settings.shortcutBindings
        if bindings.contains(where: {
            $0.id != shortcut.id && $0.enabled && $0.keyCode == shortcut.keyCode && $0.modifiers == shortcut.modifiers
        }) { return local ? "这个组合已用于其他架子内快捷键。" : "这个组合已用于其他全局快捷键。" }
        guard let index = bindings.firstIndex(where: { $0.id == shortcut.id }) else {
            return "快捷键条目不存在。"
        }
        bindings[index] = shortcut
        if local { store.settings.localShortcutBindings = bindings }
        else { store.settings.shortcutBindings = bindings }
        return store.persist() ? nil : (store.lastError ?? "快捷键保存失败。")
    }
}

private enum PreferencesPage: String, CaseIterable, Identifiable {
    case activation = "窗口激活", interaction = "窗口交互", general = "通用"
    case cloud = "云分享", custom = "自定义操作", instant = "直接行动", watching = "文件夹观察"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .activation: return ShelfSymbols.name(.activation)
        case .interaction: return ShelfSymbols.name(.interaction)
        case .general: return ShelfSymbols.name(.settings)
        case .cloud: return ShelfSymbols.name(.cloud)
        case .custom: return ShelfSymbols.name(.customActions)
        case .instant: return ShelfSymbols.name(.instantAction)
        case .watching: return ShelfSymbols.name(.watching)
        }
    }
    var tint: Color {
        switch self {
        case .activation: return Color(red: 0.13, green: 0.48, blue: 0.29)
        case .interaction: return Color(red: 0.16, green: 0.39, blue: 0.73)
        case .general: return Color(red: 0.38, green: 0.40, blue: 0.44)
        case .cloud: return Color(red: 0.04, green: 0.44, blue: 0.62)
        case .custom: return Color(red: 0.04, green: 0.45, blue: 0.43)
        case .instant: return Color(red: 0.68, green: 0.24, blue: 0.39)
        case .watching: return Color(red: 0.31, green: 0.35, blue: 0.59)
        }
    }
}

private struct InstantActionChoice: Identifiable {
    let id: String
    let title: String
    let symbol: String
}

@MainActor
private struct CloudShareHistoryView: View {
    @ObservedObject var store: ShelfStore
    // #67：过滤（全部/有效/已过期）+ 从列表删除 + 删除并撤销。
    @State private var filter = "all"
    @State private var revokingRecordID: UUID?
    @State private var revokeError: String?
    @Environment(\.dismiss) private var dismiss
    private var filtered: [CloudShareRecord] {
        ShelfInteractionRules.historyFilter(store.cloudHistory, filter: filter)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("本机分享历史").font(.system(size: 18, weight: .semibold))
                Spacer()
                Picker("过滤", selection: $filter) {
                    Text("全部").tag("all")
                    Text("有效").tag("valid")
                    Text("已过期").tag("expired")
                }
                .pickerStyle(.segmented).frame(width: 220)
                Text("\(filtered.count) 条").font(.callout).foregroundStyle(.secondary)
            }
            List {
                if filtered.isEmpty {
                    Text(filter == "all" ? "尚无本机云分享记录" : "没有符合此过滤条件的记录")
                        .foregroundStyle(.secondary).padding(.vertical, 16)
                }
                ForEach(filtered) { record in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(record.accountName).font(.headline)
                                .fixedSize(horizontal: false, vertical: true)
                            // #64：链接来源标注（预签名 / 公开基址）+ 到期状态。
                            Text(record.badgeText).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                                .background(badgeColor(record).opacity(0.18), in: Capsule())
                                .foregroundStyle(badgeColor(record))
                            Spacer(minLength: 8)
                            Text(record.createdAt.formatted(date: .numeric, time: .shortened))
                                .font(.caption).foregroundStyle(.secondary)
                            iconButton("doc.on.doc", label: "复制此批成功链接", disabled: record.validLinks.isEmpty) {
                                copy(record.validLinks)
                            }
                        }
                        Text(record.message).font(.callout).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(Array(record.links.enumerated()), id: \.offset) { _, link in
                            HStack(alignment: .top, spacing: 8) {
                                Text(link.absoluteString).font(.caption).foregroundStyle(.secondary)
                                    .textSelection(.enabled).lineLimit(2)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                iconButton("doc.on.doc", label: "复制成功链接", disabled: !CloudShareRecord.isValidShareLink(link)) {
                                    copy([link])
                                }
                                iconButton("arrow.up.right.square", label: "打开分享链接", disabled: !CloudShareRecord.isValidShareLink(link)) {
                                    guard CloudShareRecord.isValidShareLink(link) else { return }
                                    NSWorkspace.shared.open(link)
                                }
                            }
                        }
                        // #67：记录操作行——从列表删除人人可用；删除并撤销按提供商能力开放。
                        HStack(spacing: 12) {
                            Button("从列表删除") { _ = store.removeCloudRecord(record.id) }
                                .buttonStyle(.link).font(.callout)
                            if let account = account(for: record), canRevoke(record, account: account) {
                                Button(revokingRecordID == record.id ? "正在撤销…" : "删除并撤销") {
                                    revoke(record, account: account)
                                }
                                .buttonStyle(.link).font(.callout)
                                .disabled(revokingRecordID != nil || store.settings.onlineDisabled)
                            }
                            Spacer()
                        }
                    }
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            if let revokeError {
                Text(revokeError).font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("关闭") { dismiss() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(minWidth: 580, idealWidth: 620, minHeight: 420, idealHeight: 500)
        .modifier(PreferenceSheetSurface())
    }
    private func account(for record: CloudShareRecord) -> CloudAccount? {
        guard let raw = record.accountID, let id = UUID(uuidString: raw) else { return nil }
        return store.settings.cloudAccounts.first { $0.id == id }
    }
    /// 删除并撤销的门槛：提供商支持 DELETE、记录里有可撤销句柄、本机存有凭据。
    private func canRevoke(_ record: CloudShareRecord, account: CloudAccount) -> Bool {
        CloudRevocation.canRevoke(provider: account.provider)
            && record.revocableHandles.contains(where: { $0 != nil })
            && store.credential(for: account) != nil
    }
    private func revoke(_ record: CloudShareRecord, account: CloudAccount) {
        let alert = NSAlert()
        alert.messageText = "删除并撤销这条分享？"
        alert.informativeText = "将删除远端对象并移除本机记录；收到链接的人将无法再访问。此操作不可撤销。"
        alert.addButton(withTitle: "撤销分享"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        revokingRecordID = record.id
        revokeError = nil
        let credential = store.credential(for: account)
        Task {
            do {
                try await CloudRevocation.revoke(record: record, account: account, credential: credential)
                _ = store.removeCloudRecord(record.id)
            } catch {
                revokeError = (error as? CloudUploadFailure)?.message ?? error.localizedDescription
            }
            revokingRecordID = nil
        }
    }
    private func badgeColor(_ record: CloudShareRecord) -> Color {
        record.isExpired() ? .red : (record.linkSource == "presigned" ? .orange : .accentColor)
    }
    private func copy(_ links: [URL]) {
        let validLinks = links.filter(CloudShareRecord.isValidShareLink)
        guard !validLinks.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(validLinks.map(\.absoluteString).joined(separator: "\n"), forType: .string)
    }
}

@MainActor
private struct WatchedFolderEditor: View {
    @State private var draft: WatchedFolder
    @State private var extensionsText: String
    @State private var error: String?
    let save: (WatchedFolder) -> Bool
    @Environment(\.dismiss) private var dismiss
    init(initial: WatchedFolder, save: @escaping (WatchedFolder) -> Bool) {
        _draft = State(initialValue: initial)
        _extensionsText = State(initialValue: initial.normalizedExtensions.joined(separator: ", "))
        self.save = save
    }
    var body: some View {
        VStack(spacing: 16) {
            Text("观察规则").font(.system(size: 18, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
            Form {
                HStack {
                    TextField("文件夹", text: $draft.path)
                    Button("选择…", action: chooseFolder)
                }
                Toggle("观察此文件夹", isOn: $draft.enabled)
                Picker("文件类型", selection: $draft.fileType) {
                    ForEach(WatchedFileType.allCases, id: \.rawValue) { type in Text(type.title).tag(type) }
                }
                TextField("扩展名", text: $extensionsText, prompt: Text("留空为全部扩展名"))
                    .help("使用逗号分隔扩展名，可包含 .png、.pdf 或 tar.gz（压缩包扩展名）。")
                // #30：名称包含/开头两运算；与扩展名清单叠加生效，不区分大小写。
                Picker("名称条件", selection: $draft.nameCondition) {
                    Text("不限").tag("any")
                    Text("名称包含").tag("contains")
                    Text("名称开头").tag("startsWith")
                }
                TextField("名称关键字", text: $draft.nameText, prompt: Text("留空为不限"))
                    .help("按文件名过滤：包含或开头匹配，不区分大小写；可与扩展名清单叠加。")
                // #32：批量落盘场景——规则命中的每个新文件各开一个收集架窗口。
                Toggle("每个文件单独开新窗口", isOn: $draft.perFileNewShelf)
                    .help("适合下载器/导出器批量落盘的场景。注意：一次涌入大量文件时，每个文件都会亮一个窗口。")
                Stepper(value: $draft.collectionDelay, in: 0.5...30, step: 0.5) {
                    TextField("收集延迟（秒）", value: $draft.collectionDelay,
                              format: .number.precision(.fractionLength(1))).frame(maxWidth: 260)
                }
                .help("文件停止变化后等待；短时间新增会合并成一批。")
            }.formStyle(.grouped)
            if let error { Text(error).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") { commit() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 560).frame(minHeight: 390)
        .modifier(PreferenceSheetSurface())
    }
    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false; panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        draft.path = url.standardizedFileURL.path
    }
    private func commit() {
        let path = draft.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { error = "请选择观察文件夹。"; return }
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL
        var isDirectory = ObjCBool(false)
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            error = "文件夹不存在或不可用。"; return
        }
        guard draft.collectionDelay.isFinite, (0.5...30).contains(draft.collectionDelay) else {
            error = "收集延迟须在0.5至30秒之间。"; return
        }
        // #30：旧草稿的非法条件回落「不限」；关键字去空白。
        if !["any", "contains", "startsWith"].contains(draft.nameCondition) { draft.nameCondition = "any" }
        draft.nameText = draft.nameText.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.path = url.path
        draft.extensions = extensionsText.components(separatedBy: CharacterSet(charactersIn: ",，;； \n\t"))
        let suffixes = draft.normalizedExtensions
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_+"))
        guard suffixes.allSatisfy({ $0.unicodeScalars.allSatisfy(allowed.contains) }) else {
            error = "请填写扩展名，不使用路径或通配符。"; return
        }
        draft.extensions = suffixes
        guard save(draft) else { error = "保存失败，请查看设置窗口中的错误。"; return }
        dismiss()
    }
}

@MainActor
private struct PreferenceSheet<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            Text(title).font(.system(size: 18, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24).padding(.vertical, 20)
                .background(ShelfGlassBackground(material: .popover))
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 1)
            content()
                .padding(.vertical, 8)
            Rectangle().fill(ShelfGlassPalette.separator).frame(height: 1)
            HStack {
                Spacer()
                Button("完成") { dismiss() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 24).padding(.vertical, 16)
            .background(ShelfGlassBackground(material: .popover))
        }.frame(width: 560).frame(minHeight: 340)
        .modifier(PreferenceSheetSurface())
    }
}

@MainActor
private struct ActionPresetEditor: View {
    @State private var draft: ActionPreset
    @State private var error: String?
    let save: (ActionPreset) -> Bool
    @Environment(\.dismiss) private var dismiss
    init(initial: ActionPreset, save: @escaping (ActionPreset) -> Bool) {
        _draft = State(initialValue: initial); self.save = save
    }
    var body: some View {
        VStack(spacing: 16) {
            Text("自定义操作").font(.system(size: 18, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
            Form {
                TextField("名称", text: $draft.name)
                Picker("操作", selection: $draft.kind) {
                    ForEach(actionKinds, id: \.self) { kind in Text(actionTitle(kind)).tag(kind) }
                }
                parameters
            }.formStyle(.grouped)
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") { commit() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 560).frame(minHeight: 350)
        .modifier(PreferenceSheetSurface())
    }
    @ViewBuilder private var parameters: some View {
        switch draft.kind {
        case .copy, .move:
            HStack {
                TextField("目标文件夹", text: $draft.destination)
                Button("选择…") { pickDirectory() }
            }
        case .openApp:
            HStack {
                TextField("应用", text: $draft.application)
                Button("选择…") { pickApplication() }
            }
        case .rename:
            Picker("方式", selection: $draft.renameMode) {
                Text("自定义格式").tag("template")
                Text("查找替换").tag("replace")
            }
            if draft.renameMode == "replace" {
                TextField("查找", text: $draft.findText, prompt: Text("要替换的文字"))
                TextField("替换", text: $draft.replaceText, prompt: Text("替换为（可留空）"))
                Toggle("区分大小写", isOn: $draft.caseSensitive)
            } else {
                TextField("名称模板", text: $draft.nameTemplate, prompt: Text("{name}-{n}"))
                // #41：{n} 序号的起始值。
                Stepper(value: $draft.counterStart, in: 1...999_999) {
                    TextField("起始序号", value: $draft.counterStart, format: .number).frame(maxWidth: 250)
                }
                .help("模板里的 {n} 从这个数开始递增。")
            }
        case .resizeImages:
            // #45：三种缩放模式——最长边（历史）/ 最大宽高 contain / 百分比。
            Picker("缩放方式", selection: $draft.resizeMode) {
                Text("最长边").tag("edge")
                Text("适配最大宽高").tag("fit")
                Text("百分比").tag("percent")
            }
            switch draft.resizeMode {
            case "fit":
                HStack {
                    TextField("最大宽度（像素）", value: $draft.maxWidth, format: .number).frame(maxWidth: 130)
                    Text("×")
                    TextField("最大高度（像素）", value: $draft.maxHeight, format: .number).frame(maxWidth: 130)
                }
            case "percent":
                Stepper(value: $draft.scalePercent, in: 1...1000) {
                    TextField("缩放百分比", value: $draft.scalePercent, format: .number).frame(maxWidth: 180)
                }
            default:
                Stepper(value: $draft.width, in: 1...16384) {
                    TextField("最长边（像素）", value: $draft.width, format: .number).frame(maxWidth: 250)
                }
            }
            formatControl
            qualityControl
            afterOutputControl
            outputDirectory
        case .compressImages:
            formatControl
            qualityControl
            afterOutputControl
            outputDirectory
        case .convertImages:
            formatControl
            qualityControl
            afterOutputControl
            outputDirectory
        case .stitchImages:
            Stepper(value: $draft.width, in: 1...16384) {
                TextField("拼接宽度（像素）", value: $draft.width, format: .number).frame(maxWidth: 250)
            }
            formatControl
            qualityControl
            outputDirectory
        case .archive:
            TextField("归档名称", text: $draft.nameTemplate)
            SecureField("可选密码（至少3个字符）", text: $draft.password)
            afterOutputControl
            outputDirectory
        case .imagePDF, .mergePDFs:
            afterOutputControl
            outputDirectory
        case .extractText:
            Picker("输出", selection: Binding(
                get: { draft.toClipboard ? "clipboard" : "file" },
                set: { draft.toClipboard = $0 == "clipboard" })) {
                Text("新建文本文件").tag("file")
                Text("复制到剪贴板").tag("clipboard")
            }
            outputDirectory
        case .protectPDF:
            SecureField("密码（至少3个字符）", text: $draft.password)
            outputDirectory
        case .desktopPicture:
            EmptyView()
        }
    }
    private var outputDirectory: some View {
        HStack {
            TextField("输出文件夹", text: $draft.destination, prompt: Text("原文件所在目录"))
            Button("选择…") { pickDirectory() }
        }
    }
    private var formatControl: some View {
        Picker("格式", selection: $draft.format) {
            Text("JPEG（压缩图片）").tag("jpeg")
            Text("PNG（无损图片）").tag("png")
            Text("TIFF（高质量图片）").tag("tiff")
            // #43：HEIC 输出；旧系统编码失败会在执行时明确报错。
            Text("HEIC（高效图片）").tag("heic")
        }
    }
    /// #48：输出后动作四选（keep=现行为）。
    private var afterOutputControl: some View {
        Picker("输出后", selection: $draft.afterOutput) {
            Text("保留结果").tag("keep")
            Text("替换架内条目").tag("replace")
            Text("结果进新架子").tag("newShelf")
            Text("打开所在文件夹").tag("reveal")
        }
    }
    @ViewBuilder private var qualityControl: some View {
        if ["jpg", "jpeg", "heic"].contains(draft.format.lowercased()) {
            HStack {
                Text("质量")
                Slider(value: $draft.quality, in: 0.1...1)
                Text(draft.quality.formatted(.percent.precision(.fractionLength(0)))).monospacedDigit().frame(width: 45)
            }
        }
    }
    private func pickDirectory() {
        let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        draft.destination = url.path
    }
    private func pickApplication() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.applicationBundle]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        draft.application = url.path
    }
    private func commit() {
        draft.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.name.isEmpty else { error = "请填写操作名称。"; return }
        if [.copy, .move].contains(draft.kind), draft.destination.isEmpty {
            error = "请选择目标文件夹。"; return
        }
        if draft.kind == .openApp, draft.application.isEmpty { error = "请选择应用。"; return }
        // #41：改名模板两种方式各有必填项；起始序号全模式校验。
        if draft.kind == .rename {
            if draft.renameMode == "replace" {
                if draft.findText.isEmpty { error = "请填写要查找的文字。"; return }
            } else if draft.nameTemplate.isEmpty {
                error = "请填写名称模板。"; return
            }
            if !(1...999_999).contains(draft.counterStart) { error = "起始序号须在1至999999之间。"; return }
        }
        if [.resizeImages, .stitchImages].contains(draft.kind), !(1...16384).contains(draft.width) {
            error = "图片尺寸须在1到16384像素之间。"; return
        }
        // #45：fit/percent 模式各校验自己的参数面。
        if draft.kind == .resizeImages {
            switch draft.resizeMode {
            case "fit":
                guard (1...16384).contains(draft.maxWidth), (1...16384).contains(draft.maxHeight) else {
                    error = "图片尺寸须在1到16384像素之间。"; return
                }
            case "percent":
                guard (1...1000).contains(draft.scalePercent) else {
                    error = "缩放百分比须在1到1000之间。"; return
                }
            default: break
            }
        }
        // #48：非法「输出后」值回落保留现行为。
        if !["keep", "replace", "newShelf", "reveal"].contains(draft.afterOutput) { draft.afterOutput = "keep" }
        guard save(draft) else { error = "保存失败，请查看设置窗口中的错误。"; return }
        dismiss()
    }
}

@MainActor
private struct CloudAccountEditor: View {
    @State private var draft: CloudAccount
    @State private var secret = ""
    @State private var error: String?
    // #66：三步测试连接的状态与结果。
    @State private var testing = false
    @State private var testProgress: CloudConnectionTestProgress?
    private let original: CloudAccount
    let hasCredential: Bool
    let test: ((CloudAccount, String?) async -> CloudConnectionTestProgress)?
    let save: (CloudAccount, String?) -> Bool
    @Environment(\.dismiss) private var dismiss
    init(initial: CloudAccount, hasCredential: Bool,
         test: ((CloudAccount, String?) async -> CloudConnectionTestProgress)? = nil,
         save: @escaping (CloudAccount, String?) -> Bool) {
        _draft = State(initialValue: initial); original = initial
        self.hasCredential = hasCredential; self.test = test; self.save = save
    }
    var body: some View {
        VStack(spacing: 16) {
            Text("云服务配置").font(.system(size: 18, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
            Form {
                TextField("名称", text: $draft.name)
                Picker("服务", selection: $draft.provider) {
                    ForEach(cloudProviders, id: \.self) { provider in Text(providerTitle(provider)).tag(provider) }
                }
                if draft.provider != "icloud" {
                    TextField("接口地址", text: $draft.endpoint, prompt: Text("https://"))
                    TextField("公开链接地址", text: $draft.publicBaseURL, prompt: Text("https://"))
                    if draft.provider == "s3" {
                        TextField("存储桶", text: $draft.bucket)
                        TextField("区域", text: $draft.region)
                        // #63：上传路径模板 + 示例与校验提示。
                        TextField("上传路径模板", text: $draft.pathTemplate, prompt: Text("{filename}"))
                            .help("对象键按此模板生成。示例：\(CloudPathTemplate.example)，可用占位符 {filename} 和 {date}。")
                        Text("示例：\(CloudPathTemplate.example)（可用占位符 {filename} 和 {date}；不能以“/”开头，不能包含连续“/”或“?”“*”“\\”）")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        // #64：预签名链接开关 + 到期档位（与匿名公开基址二选一）。
                        Toggle("生成预签名链接", isOn: $draft.presignEnabled)
                            .help("上传后本地生成带签名的临时读取链接，无需公开存储桶；记录到期自动失效。")
                        if draft.presignEnabled {
                            Picker("预签名有效期", selection: $draft.presignExpiry) {
                                Text("1 小时").tag("1h")
                                Text("1 天").tag("1d")
                                Text("7 天").tag("7d")
                                Text("30 天").tag("30d")
                            }
                            Text("官方 S3 端点最长 7 天；30 天档适用于 MinIO 等兼容端点。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    SecureField("密钥", text: $secret, prompt: Text(credentialPrompt))
                    // #66：凭据测试连接——上传→列出→删除三步全过才报成功。
                    if ["s3", "custom"].contains(draft.provider.lowercased()), let test {
                        HStack {
                            Button(testing ? "正在测试连接…" : "测试连接") { runTest(test) }
                                .disabled(testing || !canTest)
                            ForEach(CloudTestStep.allCases, id: \.self) { step in
                                Image(systemName: stepSymbol(step))
                                    .foregroundStyle(stepColor(step))
                                    .help(step.title)
                            }
                        }
                        if !canTest {
                            Text("服务或接口地址已改动：请先保存，或重新填写密钥后再测试。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let message = testProgress?.message, !message.isEmpty {
                            Text(message).font(.caption)
                                .foregroundStyle(testProgress?.success == true ? Color.green : Color.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                LabeledContent("连接状态", value: "未连接")
            }.formStyle(.grouped)
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存配置") { commit() }
                    .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                    .keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 570).frame(minHeight: 370)
        .modifier(PreferenceSheetSurface())
        .onChange(of: draft.provider) { _ in secret = "" }
        .onChange(of: draft.endpoint) { _ in secret = "" }
    }
    /// 换过服务身份时本机旧凭据不再可靠：要么没改身份，要么现场填了新密钥。
    private var canTest: Bool {
        !draft.credentialIdentityChanged(from: original) || !secret.isEmpty
    }
    private func runTest(_ test: @escaping (CloudAccount, String?) async -> CloudConnectionTestProgress) {
        testing = true
        testProgress = CloudConnectionTestProgress()
        let account = draft
        let provided = secret.isEmpty ? nil : secret
        Task {
            testProgress = await test(account, provided)
            testing = false
        }
    }
    private func stepSymbol(_ step: CloudTestStep) -> String {
        guard let progress = testProgress else { return "circle.dotted" }
        if progress.failed == step { return "xmark.circle.fill" }
        if progress.completed.contains(step) { return "checkmark.circle.fill" }
        return "circle.dotted"
    }
    private func stepColor(_ step: CloudTestStep) -> Color {
        guard let progress = testProgress else { return .secondary }
        if progress.failed == step { return .red }
        if progress.completed.contains(step) { return .green }
        return .secondary
    }
    private var credentialPrompt: String {
        if draft.credentialIdentityChanged(from: original) { return "服务已变化，请重新填写" }
        return hasCredential ? "已保存，留空保持不变" : "尚未保存"
    }
    private func commit() {
        draft.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.endpoint = draft.endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.publicBaseURL = draft.publicBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.name.isEmpty else { error = "请填写配置名称。"; return }
        for address in [draft.endpoint, draft.publicBaseURL] where !address.isEmpty {
            guard let url = URL(string: address), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
                error = "地址必须是有效的HTTP（网络协议）或HTTPS（加密网络协议）地址。"; return
            }
        }
        // #63：路径模板逐条校验（照 Dropover 文案句式），通过后按规范化值保存。
        if draft.provider == "s3" {
            draft.pathTemplate = CloudPathTemplate.normalized(draft.pathTemplate)
            if let message = CloudPathTemplate.validationError(for: draft.pathTemplate) { error = message; return }
            draft.presignExpiry = S3PresignExpiry.normalize(draft.presignExpiry)
        }
        guard save(draft, secret.isEmpty ? nil : secret) else { error = "保存失败，请查看设置窗口中的错误。"; return }
        secret = ""; dismiss()
    }
}

@MainActor
private struct ShortcutRecorder: View {
    @State private var draft: ShortcutBinding
    @State private var monitor: Any?
    @State private var isRecording = false
    @State private var error: String?
    let requiresModifier: Bool
    let save: (ShortcutBinding) -> String?
    @Environment(\.dismiss) private var dismiss
    init(initial: ShortcutBinding, requiresModifier: Bool = true, save: @escaping (ShortcutBinding) -> String?) {
        _draft = State(initialValue: initial); self.requiresModifier = requiresModifier; self.save = save
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(draft.title).font(.system(size: 18, weight: .semibold))
            Text(shortcutDisplay(draft)).font(.system(size: 24, weight: .medium, design: .monospaced))
                .frame(maxWidth: .infinity, minHeight: 72)
                .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(ShelfGlassPalette.controlStroke, lineWidth: 1))
            HStack {
                Text(isRecording ? "正在录入…" : "已录入").font(.callout).foregroundStyle(.secondary)
                Spacer()
                iconButton("arrow.clockwise", label: "重新录入", disabled: isRecording, action: beginRecording)
            }
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") {
                    if let message = save(draft) { error = message } else { dismiss() }
                }
                .buttonStyle(ShelfGlassButtonStyle(prominent: true))
                .keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 420)
        .modifier(PreferenceSheetSurface())
        .onAppear { beginRecording() }
        .onDisappear { endRecording() }
    }
    private func beginRecording() {
        guard monitor == nil else { return }
        isRecording = true
        NotificationCenter.default.post(name: Notification.Name("WispShelfShortcutCaptureStarted"), object: nil)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
            if event.keyCode == 53 && flags.isEmpty { dismiss(); return nil }
            if requiresModifier, flags.isEmpty { error = "全局快捷键至少包含一个修饰键。"; return nil }
            var modifiers: UInt32 = 0
            if flags.contains(.command) { modifiers |= UInt32(cmdKey) }
            if flags.contains(.option) { modifiers |= UInt32(optionKey) }
            if flags.contains(.control) { modifiers |= UInt32(controlKey) }
            if flags.contains(.shift) { modifiers |= UInt32(shiftKey) }
            draft.keyCode = UInt32(event.keyCode); draft.modifiers = modifiers; error = nil
            endRecording()
            return nil
        }
        if monitor == nil { endRecording(); error = "键盘录入暂不可用。" }
    }
    private func endRecording() {
        guard isRecording || monitor != nil else { return }
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        isRecording = false
        NotificationCenter.default.post(name: Notification.Name("WispShelfShortcutCaptureEnded"), object: nil)
    }
}

@MainActor
private func settingsRow<Content: View>(_ title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
    HStack {
        Label(title, systemImage: ShelfSymbols.name(symbol))
            .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 12)
        content()
    }
}

@MainActor
private func iconButton(_ symbol: String, label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) { ShelfIcon(named: symbol).frame(width: 22, height: 22) }
        .buttonStyle(ShelfGlassIconButtonStyle(size: 28))
        .disabled(disabled).help(label).accessibilityLabel(label)
}

@MainActor
private struct PreferenceToolMenuStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 12, weight: .medium))
            .frame(width: 28, height: 28)
            .background(ShelfGlassPalette.controlFill, in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(ShelfGlassPalette.controlStroke, lineWidth: 1))
    }
}

@MainActor
private struct PreferenceSheetSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(ShelfGlassPalette.canvas)
            .scrollContentBackground(.hidden)
            .buttonStyle(ShelfGlassButtonStyle())
            .textFieldStyle(ShelfGlassFieldStyle())
            .toggleStyle(.switch)
    }
}

private let actionKinds: [ActionKind] = [.move, .copy, .archive, .openApp, .rename, .resizeImages, .compressImages, .convertImages, .imagePDF, .extractText, .stitchImages]
private let cloudProviders = ["custom", "icloud", "s3", "dropbox", "gdrive", "onedrive", "imgur"]

private func actionTitle(_ kind: ActionKind) -> String {
    kind == .imagePDF ? "图片转PDF（便携文档）" : kind.title
}

private func actionSymbol(_ kind: ActionKind) -> String {
    ShelfSymbols.action(kind)
}

private func providerTitle(_ provider: String) -> String {
    switch provider {
    case "custom": return "自定义云服务"
    case "icloud": return "iCloud（苹果云服务）"
    case "s3": return "S3（对象存储）"
    case "dropbox": return "Dropbox（云盘）"
    case "gdrive": return "Google Drive（谷歌云盘）"
    case "onedrive": return "Microsoft OneDrive（微软云盘）"
    case "imgur": return "Imgur（图床）"
    default: return provider
    }
}

@MainActor
private func applicationName(_ identifier: String) -> String {
    NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier)?.deletingPathExtension().lastPathComponent ?? identifier
}

private func shortcutDisplay(_ shortcut: ShortcutBinding) -> String {
    var value = ""
    if shortcut.modifiers & UInt32(controlKey) != 0 { value += "⌃" }
    if shortcut.modifiers & UInt32(optionKey) != 0 { value += "⌥" }
    if shortcut.modifiers & UInt32(shiftKey) != 0 { value += "⇧" }
    if shortcut.modifiers & UInt32(cmdKey) != 0 { value += "⌘" }
    let keys: [UInt32: String] = [0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0", 30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 36: "↩", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/", 45: "N", 46: "M", 47: ".", 48: "⇥", 49: "空格", 50: "`", 51: "⌫", 53: "Esc（退出键）", 123: "←", 124: "→", 125: "↓", 126: "↑"]
    return value + (keys[shortcut.keyCode] ?? "按键\(shortcut.keyCode)")
}
