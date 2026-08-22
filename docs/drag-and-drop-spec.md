# Wisp 拖拽功能规格说明（macOS）

> 平台范围：**仅 macOS**。交互语义以 macOS 访达（Finder）习惯为基准，不覆盖 Windows/Linux 特化行为（任务栏固定、.lnk 快捷方式、盘符概念等）。
>
> 关联文档：[architecture.md](./architecture.md)、[drag-and-drop-implementation.md](./drag-and-drop-implementation.md)
> 文档日期：2026-08-22（根据 A 组真机反馈补充刷新、离窗状态与链接标识）

## 1. 目标与范围

**目标**：把 Wisp 的拖拽能力整理为一套完整、可预期、符合 macOS 习惯的体系，覆盖五个方向：

1. **拖出**（Wisp → 其他应用）：微信、访达、终端、Dock 等
2. **拖入**（其他应用 → Wisp）：访达、微信、浏览器等
3. **内部整理**（Wisp 内）：移动 / 复制 / 符号链接
4. **界面布局**：标签页、收藏夹的拖拽重排
5. **通用交互**：overlay 预览、目标高亮、修饰键语义、进度、撤销

**范围**：桌面端 macOS，鼠标 / 触控板输入统一走系统原生拖拽通道（`tauri-plugin-drag` + Tauri `onDragDropEvent`）。

**非目标（明确排除）**：

- Windows / Linux 特化行为
- 触屏手势、移动端
- 云存储 / 远程节点的拖拽同步语义
- 拖拽固定到系统任务栏（macOS 无此概念）

## 2. 总体架构

### 2.1 分层与职责

```
┌─ OS 原生层 ───────────────────────────────────────────────────────┐
│ @crabnebula/tauri-plugin-drag  startDrag()  → 发起系统级拖出       │
│ Tauri onDragDropEvent  (enter / over / drop / leave)               │
│   → 接收外部应用拖入，也接收本窗口拖出的"回投"                      │
└────────────────────────────────────────────────────────────────────┘
┌─ 全局协调层 ───────────────────────────────────────────────────────┐
│ contexts/DragDropContext.tsx                                       │
│   状态机（reducer）+ overlay 渲染 + 落点查找 + 校验 + 执行          │
│   + 弹簧加载（500ms 展开）+ 修饰键监听                              │
│ lib/drag-utils.ts  校验 / 目标路径构建 / MIME 序列化                │
└────────────────────────────────────────────────────────────────────┘
┌─ 接入层 ───────────────────────────────────────────────────────────┐
│ hooks/use-draggable.ts        文件条目拖出（5px 阈值判定）           │
│ data-drop-target / data-is-folder  各视图的落点 DOM 标记            │
│ 专项 drop zone：ChatDropZone（AI 附件）、PaneTabBar（标签重排）      │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 状态机（DragDropContext reducer）

| 状态 | 类型 | 说明 |
|---|---|---|
| `isDragging` | boolean | 是否处于拖拽中 |
| `dragSource` | `'internal' \| 'external' \| null` | 内部拖出 / 外部拖入 |
| `draggedPaths` | string[] | 被拖拽的路径集合 |
| `hoveredDropTarget` | string \| null | 当前悬停落点 |
| `isOverWindow` | boolean | 原生拖拽是否仍在当前 Wisp 窗口内；离窗立即隐藏 Web 标签 |
| `operation` | `'copy' \| 'move' \| 'link'` | 当前操作语义（`link` 为改造新增） |

Actions：`START_DRAG` / `SET_HOVER` / `SET_OVER_WINDOW` / `SET_OPERATION` / `END_DRAG`

### 2.3 两条主数据流

**内部拖拽（拖出后再落回本窗口）：**

```
mousedown（记录坐标）
  → mousemove 超过 5px 阈值 → startInternalDrag(paths) + startDrag({ item: paths, icon })
  → 系统接管拖拽（光标、Esc、目标应用由 OS 处理）
  → 落回本窗口 → onDragDropEvent 依次触发 enter / over / drop / leave
      over：elementFromPoint 找落点 → 高亮 / 无效标记 → 文件夹则启动 500ms 弹簧加载计时
      drop：validateDrop 校验 → 执行传输 → 进度完成事件刷新所有窗口
      leave：清理高亮与计时器，立即隐藏仅能在 WebView 内绘制的文字标签
```

**外部拖入：**

```
系统拖文件入窗口
  → enter（paths 非空且当前未在拖拽）→ START_DRAG(source: 'external', op: 'copy')
  → over（高亮 / 弹簧加载）
  → drop → 逐项复制进目标目录 → files-changed
  → leave → 清理
```

### 2.4 DOM 契约（落点声明）

| 属性 / 事件 | 语义 | 现状 |
|---|---|---|
| `data-drop-target` | 落点目录路径（特殊落点放动作名） | 已有 |
| `data-is-folder="true"` | 文件夹落点，触发弹簧加载 | 已有 |
| `data-drop-action` | 特殊动作：`trash`（移入废纸篓）、`bookmark-add`（添加收藏） | **新增** |
| `spring-load-folder` 事件 | 悬停 500ms 后展开文件夹 | 已有 |
| `files-changed` 事件 | 通知当前窗口全部分栏刷新 | 已有（已修复为全分栏） |
| `wisp-files-changed` Tauri 事件 | 通知其他 Wisp 窗口刷新 | **新增** |
| `drag-drop-error` 事件 | 传输失败提示 | 已有 |

### 2.5 现有文件职责表

| 文件 | 职责 | 本次改造动作 |
|---|---|---|
| `apps/client/src/hooks/use-draggable.ts` | 文件条目拖出（原生 startDrag） | 扩展（可选文本数据） |
| `apps/client/src/contexts/DragDropContext.tsx` | 状态机 + 执行 | **核心改造**（修饰键、冲突、进度、撤销、drop-action） |
| `apps/client/src/lib/drag-utils.ts` | 校验 / 路径 / MIME | 扩展（is_dir 校验） |
| `apps/client/src/components/explorer/FileGridItem.tsx` | 网格条目：拖出 + 落点 | 微调 |
| `apps/client/src/components/explorer/GalleryView.tsx` | 画廊视图拖出 | 微调 |
| `apps/client/src/components/explorer/DetailsView.tsx` | 列表视图（已有落点，无拖出） | 加拖出 |
| `apps/client/src/components/explorer/TreeView.tsx` | 树视图（已有落点，无拖出） | 加拖出 |
| `apps/client/src/components/split-view/PaneTabBar.tsx` | 标签重排 + 跨 tab 拖放 | 扩展（拖出新窗，规划） |
| `apps/client/src/components/panels/ChatDropZone.tsx` | AI 聊天附件落点 | 不动 |
| `apps/client/src/components/TrashPage.tsx` | 回收站视图 | 新增废纸篓落点 |
| `apps/client/src/components/explorer/LeftSidebar.tsx` | 侧栏（废纸篓节点） | 新增落点 |
| `apps/client/src/components/explorer/sidebar/SidebarBookmarks.tsx` | 收藏夹 | 新增落点 |
| `apps/client/src/components/explorer/sidebar/SidebarDrives.tsx` | 驱动器 | 新增落点 |
| `apps/client/src/components/explorer/NavigationBar.tsx` | 面包屑 | 新增落点 |
| `apps/client/src/lib/tauri-api/file-system.ts` + `packages/sdk/src/services/file-system.ts` | API 层 | **已具备** checkConflicts / copyWithProgress / moveWithProgress / undoOperation / moveToTrash，直接复用 |
| Rust：`operations/file_ops/copy_move.rs`、`batch.rs`、`trash_ops.rs`、`undo_redo/`、`progress.rs` | 后端能力 | 小改（overwrite 参数、same_volume、stat_paths、create_symlink） |

## 3. macOS 交互语义约定（关键决策）

| 场景 | 语义 |
|---|---|
| 默认拖放 | 同一卷 = 移动；跨卷 = 复制（与访达一致） |
| 按住 Option ⌥ | 强制复制 |
| 按住 ⌘ + Option | 创建符号链接（v1 用 symlink 实现，见 4.9 / INT-03） |
| Esc | 取消拖拽（系统原生行为，无需代码，验收项） |
| 拖到 Dock 图标 | 由 macOS 处理（用该应用打开），无需代码 |
| 拖到微信 / QQ 窗口 | mac 版微信将文件落盘后发起系统拖拽，Wisp 侧无需特判 |
| 外部拖入 | 一律复制，不做移动 |
| 微信文件拖入 Wisp | 微信先落盘再拖出，Wisp 收到真实路径后复制进目标目录 |

## 4. 能力规格

状态标记：✅ 已有 ｜ 🔧 需改造 ｜ ❌ 缺失 ｜ ⏳ 规划

### A. 拖出（Wisp → 外部应用）

| ID | 能力 | 行为 | 涉及文件 | 状态 |
|---|---|---|---|---|
| DRO-01 | 拖文件到其他应用 | 拖文件/文件夹到访达、微信、终端、浏览器上传控件等 | `use-draggable.ts`、`FileGridItem.tsx`、`GalleryView.tsx` | ✅ |
| DRO-02 | 列表/树视图拖出 | DetailsView、TreeView 的行同样可拖 | `DetailsView.tsx`、`TreeView.tsx` | ✅ 已接入 |
| DRO-03 | 多选批量拖出 | 拖任意选中项即拖全部选中项 | `use-draggable.ts`（selectedFiles 逻辑） | ✅ |
| DRO-04 | 拖到 Dock 打开 | 系统行为，验收即可 | — | ✅ 系统自带 |
| DRO-05 | 拖到终端粘贴路径 | ⌘+拖 = 以纯文本拖出路径（插件自定义类型 `public.utf8-plain-text`） | `use-draggable.ts` | ✅ 已实现，待真机验证 |
| DRO-06 | 拖出选中文本 | 搜索/文件路径文本拖进编辑器 | 文本选择逻辑 + use-draggable 变体 | ⏳ 规划 |
| DRO-07 | 拖到另一个 Wisp 窗口 | 原生文件拖放可进入；完成后两窗自动刷新。跨窗口保留“内部源窗口/修饰键”语义仍需独立会话同步 | `DragDropContext.tsx` + `file-change-events.ts` | ⚠️ 部分支持 |

### B. 拖入（外部 → Wisp）

| ID | 能力 | 行为 | 涉及文件 | 状态 |
|---|---|---|---|---|
| DRI-01 | 访达/桌面拖入 | 复制进当前目录 | `DragDropContext.tsx` | ✅ |
| DRI-02 | 微信/QQ 拖出到 Wisp | 复制进目标目录 | `DragDropContext.tsx` | ✅ |
| DRI-03 | 拖到文件夹条目 | 复制进该文件夹 | `FileGridItem.tsx`、`DetailsView.tsx`、`TreeView.tsx`（data-drop-target） | ✅ |
| DRI-04 | 浏览器拖图片 | 保存为文件 | `DragDropContext.tsx` + `drag-drop-content.ts` | ⚠️ 已实现，macOS Tauri 下不触发（见 §7-2） |
| DRI-05 | 浏览器拖 URL/文本 | 存为 .webloc / .txt | 同上 | ⚠️ 已实现，macOS Tauri 下不触发（见 §7-2） |
| DRI-06 | 拖到废纸篓 | 移入废纸篓（不删除） | `TrashPage.tsx`、复用 `trash_ops.rs` move_to_trash | ✅ |
| DRI-07 | 拖到收藏夹节点 | 添加收藏 | `sidebar/SidebarBookmarks.tsx` | ✅ |
| DRI-08 | 拖到侧栏驱动器 | 移动/复制到该盘根 | `sidebar/SidebarDrives.tsx` | ✅ |
| DRI-09 | 拖到标签页 | 切换到该目录并落下 | `PaneTabBar.tsx` | ✅ 部分（跨 tab 拖放已有） |
| DRI-10 | 拖到面包屑某一级 | 移动到那一级目录 | `NavigationBar.tsx` | ✅ |
| DRI-11 | 拖到 AI 聊天框 | 添加附件 | `panels/ChatDropZone.tsx` | ✅ |

### C. 内部拖拽（Wisp 内整理）

| ID | 能力 | 行为 | 涉及文件 | 状态 |
|---|---|---|---|---|
| INT-01 | 拖进文件夹移动 | 默认同卷移动 | `DragDropContext.tsx` + `drag-utils.ts` | ✅ |
| INT-02 | Option 切换复制 | 拖动中实时切换（macOS 语义：⌥=复制、⌘⌥=链接） | `DragDropContext.tsx` | ✅ 已改造 |
| INT-03 | ⌘+Option 创建符号链接 | 目标处创建 symlink | `DragDropContext.tsx` + 复用 `create_symlink` | ✅ |
| INT-04 | 跨卷自动复制 | 目标在不同卷时移动降级为复制 | Rust `same_volume` + `DragDropContext.tsx` | ✅ |
| INT-05 | 拖到非文件夹上 | 忽略并给出无效标记 | `drag-utils.ts` validateDrop（targetIsDir） | ✅ |
| INT-06 | 无效目标校验 | 自身 / 自己的子文件夹 / 当前父目录 | `drag-utils.ts` | ✅ |
| INT-07 | 弹簧加载 | 悬停文件夹 500ms 自动展开 | `DragDropContext.tsx` | ✅ |
| INT-08 | 同名冲突对话框 | 覆盖 / 跳过 / 保留两者 / 合并 | `dialogs/ConflictResolutionDialog.tsx` + 复用 `check_conflicts` / `get_rename_destination` / `copy_dir_merge` | ✅ |
| INT-09 | 撤销上次拖拽 | toast 撤销 + Cmd+Z | 复用 `undo_redo/` + `hooks/use-transfer-history.ts` | ✅ |
| INT-10 | 批量传输进度 | 进度条 + 取消（>10 项） | 复用 `copy/move_with_progress` + `explorer/TransferProgressToast.tsx` | ✅ |
| INT-11 | Esc 取消 | 系统行为 | — | ✅ 验收 |

### D. 排序 / 布局

| ID | 能力 | 涉及文件 | 状态 |
|---|---|---|---|
| SRT-01 | 标签页重排 | `PaneTabBar.tsx` | ✅ |
| SRT-02 | 标签拖出成新窗口 | `PaneTabBar.tsx` + Tauri WebviewWindow | ⏳ 规划 |
| SRT-03 | 网格手动排序（持久化） | `FileGrid.tsx` + 排序状态 | ⏳ 规划（可选） |
| SRT-04 | 收藏夹排序 | `SidebarBookmarks.tsx` | ⏳ 规划（可选） |

### E. 通用交互

| ID | 能力 | 涉及文件 | 状态 |
|---|---|---|---|
| UX-01 | 拖拽预览 overlay（数量 + 操作 badge） | `DragDropContext.tsx` | ✅（文案已 i18n） |
| UX-02 | 目标高亮 / 无效高亮 | `DragDropContext.tsx` | ✅ |
| UX-03 | 修饰键实时切换视觉反馈 | `DragDropContext.tsx` overlay | ✅ 三态（move/copy/link） |
| UX-04 | 拖到边缘自动滚屏 | `DragDropContext.tsx` over 事件 | ❌ 缺失（未实施） |
| UX-05 | 内部拖拽数据 MIME 序列化 | `drag-utils.ts`（WISP_DND_MIME） | ✅ |
| UX-06 | 触控板拖拽 | 系统行为 | ✅ 验收 |
| UX-07 | 离开窗口后的反馈与清理 | Wisp 内显示文字 badge；离开边框立即隐藏，外部仅保留系统原生幽灵图；返回后不残留滚动/划词状态 | `DragDropContext.tsx` + `index.css` | ✅ |
| UX-08 | 链接类文件标识 | symlink 显示链条 badge；Finder 替身显示箭头 badge；tooltip/辅助功能读出类型 | Rust `FileEntry` + `FileReferenceBadge.tsx` | ✅ |
| UX-09 | 多分栏/多窗口刷新 | 操作完成、撤销、手动刷新后，当前窗全部分栏和其他 Wisp 窗口同步刷新 | `file-operation-progress.ts` + `file-change-events.ts` | ✅ |

## 5. 冲突、容错与撤销

- **冲突检测**：drop 执行前批量调用 Rust `check_conflicts(sources, destination_dir)`（`batch.rs`，已接入 API 层），有冲突则弹出 `ConflictResolutionDialog`。
- **四种冲突策略**：
  - 覆盖：传输前移除已有目标（Rust 侧加 overwrite 参数，避免前端删原件）
  - 跳过：保留目标，不传输该项
  - 保留两者：用 `get_rename_destination` 生成「xx (2).ext」形式的目标名
  - 合并：仅当源与目标均为文件夹时提供；v1 对同名子项递归应用所选策略
- **撤销**：`copy_with_progress` / `move_with_progress` 内部已调用 `record_operation`（`undo_redo/`），拖拽执行切换到这两个命令后**自动可撤销**；前端在完成后显示撤销 toast，窗口聚焦时 Cmd+Z 触发 `undo_operation`。
- **进度**：超过 10 项或总体积超过 100MB 时显示进度 UI；进度事件来自 `progress.rs` 的 ProgressManager（已有），支持 `cancel_file_operation` 取消。
- **快速移动事件保护**：前端在启动传输前先建立进度监听，并缓存每个 operation_id 的最后状态，避免同卷 `rename` 太快、toast 尚未挂载就丢掉 Completed 事件。
- **刷新范围**：Rust 进度事件本身是应用级广播；每个窗口收到终态后刷新本窗全部分栏。无进度操作及手动刷新额外发出 `wisp-files-changed`，覆盖其他窗口。
- **失败**：单项失败不中断整体，收集失败列表统一提示（`drag-drop-error`）。
- **取消**：Esc 与拖回原位由系统处理，不产生任何操作记录。

## 6. 验收标准（macOS）

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| 1 | 拖出到微信 | 网格多选拖文件到微信聊天 | 微信收到文件，可发送 |
| 2 | 拖出到访达 | 拖文件到访达目录 | 同卷：移动；不同卷：复制 |
| 3 | 拖到 Dock | 拖文件到 Dock 图标 | 用该应用打开 |
| 4 | 内部移动 | 拖文件进文件夹 | 移动到目标，视图刷新 |
| 5 | Option 拖动 | 按住 ⌥ 拖 | badge 显示复制，落下为复制 |
| 6 | ⌘+Option 拖动 | 按住 ⌘⌥ 拖 | 目标处生成符号链接 |
| 7 | 跨卷拖动 | 拖到外接盘 | 自动变复制，badge 即时切换 |
| 8 | 访达拖入 | 访达拖 3 个文件进当前目录 | 复制进目录 |
| 9 | 微信拖入 | 微信聊天文件拖进 Wisp | 复制进目录 |
| 10 | 拖到废纸篓 | 拖文件到废纸篓视图/侧栏节点 | 移入废纸篓，可恢复 |
| 11 | 拖到收藏夹 | 拖文件到收藏夹节点 | 添加收藏 |
| 12 | 拖到面包屑 | 拖文件到上一级面包屑 | 移动到该级 |
| 13 | 拖到标签页 | 拖文件到另一标签 | 切换目录并落下 |
| 14 | 同名冲突 | 拖入已有同名文件 | 弹对话框，四种策略均生效 |
| 15 | 大量文件 | 拖 50 个文件 | 进度条显示，可取消 |
| 16 | 撤销 | 移动后 Cmd+Z | 恢复原位 |
| 17 | 弹簧加载 | 悬停文件夹 500ms | 自动展开该文件夹 |
| 18 | 无效目标 | 拖文件夹到它自己的子文件夹 | 红色无效标记，不执行 |
| 19 | Esc | 拖拽中按 Esc | 取消，无操作记录 |
| 20 | AI 附件 | 拖文件到 AI 聊天框 | 加入附件列表 |
| 21 | 两个分栏/窗口 | 在 A 中把文件移到 B 当前目录 | A、B 都自动更新，不切目录 |
| 22 | 离开 Wisp 松手 | 拖到终端并松开，再把鼠标移回 Wisp | Wisp 标签不滞留、不自动滚动、不划选文字 |
| 23 | 链接标识 | 查看 symlink 与 Finder 替身 | 两者有可区分 badge，symlink 可显示目标 |
| 24 | 手动刷新 | 两分栏/两窗口打开同一受影响目录后点刷新 | 所有可见目录重新读取 |

## 7. 风险与已知限制

1. **tauri-plugin-drag 多数据类型**（DRO-05 终端路径文本）：✅ 已确认插件 API 支持 `{ data, types }` 自定义数据类型（v2.1.0），⌘+拖 已实现并有单测；真机端到端行为待用户手工验证。
2. **WKWebView 对浏览器文本/图片拖入**（DRI-04/05）：❌ 已实测确认——macOS Tauri 下 WRY 的原生拖拽处理器会吞掉所有非文件拖拽，HTML5 drop 事件不会到达页面（探针验证：窗口级 drop 监听器收不到任何事件）。HTML5 处理在两种模式下都注册：桌面端不触发；网页版解析逻辑生效但落盘依赖后端（当前无）。后续若需桌面端支持，需要 Rust 侧扩展 WRY 的 drag handler。
3. **原生拖拽期间的键盘事件**：系统接管拖拽后 webview 能否收到 keydown（INT-02 实时切换修饰键）未验证；fallback 方案为按拖拽启动时的修饰键状态决定操作。
4. **符号链接 vs Finder 替身**：⌘⌥ 创建的是 symlink（终端可见的符号链接），不是 Finder 替身。Wisp 现在会识别并分别标记两种文件；Finder 替身的创建和目标解析仍是后续项。
5. 原生拖拽由系统接管，Esc 行为与拖拽光标样式部分不可控。
6. 自定义文字 badge 是 WebView 内容，物理上不能绘制到 Wisp 边框外；离窗后由 macOS 原生幽灵图继续反馈，这是预期边界，不再让 Web badge 停在边框。
