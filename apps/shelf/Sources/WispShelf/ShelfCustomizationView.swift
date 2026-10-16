import AppKit
import ShelfCore
import SwiftUI

enum ShelfTintPalette {
    static let choices: [(String, String, Color)] = [
        ("gray", "灰色", .gray), ("orange", "橙色", .orange),
        ("yellow", "黄色", .yellow), ("green", "绿色", .green),
        ("mint", "薄荷色", .mint), ("blue", "蓝色", .blue),
        ("purple", "紫色", .purple), ("pink", "粉色", .pink),
        ("olive", "橄榄色", Color(red: 0.52, green: 0.52, blue: 0.08)),
        ("sage", "草绿色", Color(red: 0.35, green: 0.53, blue: 0.31)),
    ]

    static func color(_ name: String) -> Color {
        if name == "red" { return .red }
        return choices.first { $0.0 == name }?.2 ?? .blue
    }
}

struct ShelfCustomizationView: View {
    @ObservedObject var store: ShelfStore
    let id: UUID
    @State private var name = ""
    @FocusState private var editingName: Bool
    private var shelf: Shelf? { store.shelf(id) }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    Text("名称")
                    TextField("收集架名称", text: $name)
                        .textFieldStyle(.roundedBorder)
                        .focused($editingName)
                        .onSubmit(saveName)
                }
                // #8：同一字段驱动顶部指示条与图钉的常显；缺省 nil=跟随全局行为。
                Toggle("始终显示指示器", isOn: value(\.showsPinIndicator, fallback: false))
                HStack(alignment: .top, spacing: 18) {
                    Text("图钉颜色").padding(.top, 4)
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(22), spacing: 8), count: 5), spacing: 8) {
                        ForEach(ShelfTintPalette.choices, id: \.0) { choice in
                            Button {
                                saveName()
                                store.updateShelf(id) { $0.color = choice.0 }
                            } label: {
                                Circle().fill(choice.2).frame(width: 18, height: 18)
                                    .padding(2)
                                    .overlay(Circle().strokeBorder(shelf?.color == choice.0 ? Color.accentColor : .clear, lineWidth: 2))
                            }.buttonStyle(.plain).help(choice.1).accessibilityLabel(choice.1)
                                .accessibilityValue(shelf?.color == choice.0 ? "已选" : "未选")
                        }
                    }.frame(width: 142)
                }
            }
            Section {
                Toggle("固定窗口", isOn: Binding(get: { shelf?.pinned ?? false }, set: { pinned in
                    saveName()
                    store.updateShelf(id) { $0.pinned = pinned }
                }))
                Toggle("仅在当前桌面显示", isOn: value(\.ownSpace, fallback: store.settings.ownSpace))
            }
        }
        .formStyle(.grouped).toggleStyle(.switch).controlSize(.small)
        .font(.system(size: 12))
        .frame(width: 304, height: 274)
        .safeAreaInset(edge: .bottom) {
            Text("仅适用于此收集架。")
                .font(.system(size: 11)).foregroundStyle(ShelfGlassPalette.secondaryText)
                .padding(.bottom, 12)
        }
        .onAppear { name = shelf?.name ?? ""; editingName = true }
        .onDisappear(perform: saveName)
    }

    private func value(_ key: WritableKeyPath<Shelf, Bool?>, fallback: Bool) -> Binding<Bool> {
        Binding(get: { shelf?[keyPath: key] ?? fallback }, set: { next in
            saveName()
            store.updateShelf(id) { $0[keyPath: key] = next }
            (NSApp.delegate as? ShelfApplication)?.applySettings()
        })
    }

    private func saveName() {
        let next = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !next.isEmpty, next != shelf?.name else { return }
        store.updateShelf(id) { $0.name = next }
    }
}
