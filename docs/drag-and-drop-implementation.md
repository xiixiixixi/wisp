# Wisp 拖拽功能实施文档（macOS）

> 平台范围：**仅 macOS**。本文是 [drag-and-drop-spec.md](./drag-and-drop-spec.md) 的实施分解：每个功能对应哪些文件（新建 / 修改）、按什么顺序做、怎么验证。
> 文档日期：2026-08-22（补充真机反馈修复）

## 1. 现状盘点

### 1.1 已具备但拖拽未使用的后端能力（重要结论）

| 能力 | 命令 / 位置 | API 层接线 |
|---|---|---|
| 带进度复制（可取消） | `copy_with_progress` — `operations/file_ops/copy_move.rs` | ✅ SDK + `lib/tauri-api/file-system.ts` 已接 |
| 带进度移动（可取消） | `move_with_progress` — 同上 | ✅ 已接 |
| 取消传输 | `cancel_file_operation` — 同上 | ✅ 已接 |
| 冲突检测 | `check_conflicts` — `operations/file_ops/batch.rs` | ✅ 已接 |
| 重名目标名 | `get_rename_destination` — 同上 | ✅ 已接 |
| 撤销 / 历史 | `undo_operation` / `get_undo_history` — `operations/undo_redo/` | ✅ 已接 |
| 移入废纸篓 | `move_to_trash` — `operations/trash_ops.rs` | ✅ 已接 |

**结论：改造重心在前端接线，Rust 侧只有三处小改**（见 3.1 第 6 项、第 9 项、4.9）。

### 1.2 前端缺口

- `DragDropContext.tsx` 的 drop 执行用的是简单 `copy` / `move_file`（无进度、无撤销、无冲突处理）
- 修饰键监听的是 Ctrl（Windows 习惯），需改为 macOS 语义
- overlay 文案硬编码英文（"Copy" / "Move" / "N files"）
- `DetailsView.tsx` / `TreeView.tsx` 行没有拖出（只有落点）
- 无废纸篓 / 收藏夹 / 面包屑 / 驱动器落点
- 无冲突对话框、无进度 UI、无撤销 toast、无跨卷判定、无符号链接

## 2. 阶段划分

| 阶段 | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| Phase 0 修复 ✅（2026-08-20 完成） | i18n、修饰键 macOS 化、列表/树拖出、validateDrop 补 is_dir | 高 | 无 |
| Phase 1 闭环（核心）✅（2026-08-20 完成） | 冲突对话框、进度+取消 UI、撤销接入、跨卷判定、符号链接执行 | 高 | Phase 0 |
| Phase 2 落点扩展 ✅（2026-08-20 完成） | drop-action 机制、废纸篓、收藏、面包屑、驱动器 | 中 | Phase 0 |
| Phase 3 拖入/拖出增强 ✅（2026-08-20 完成） | ⌘+拖路径文本（已实现）、浏览器文本/图片拖入（已实现，macOS Tauri 下平台限制不触发） | 中 | Phase 0 |
| Phase 4 布局（可选） | 网格手动排序、标签拖出新窗、收藏排序 | 低 | 无 |

Phase 1 进度（2026-08-20）：
- ✅ §3.2-9 跨卷判定：Rust `same_volume` 命令（copy_move.rs，含单测，main.rs 已注册）+ SDK / facade 接线 + DragDropContext drop 时判定，跨卷自动复制
- ✅ §3.2-10 符号链接执行：复用已有 `create_symlink`（write.rs，三层均已接线），⌘+Option 拖放直接执行；Phase 0 的临时 `linkUnsupported` 拒绝逻辑与 i18n 键已移除
- ✅ §3.2-5/6/7/8 冲突 + 进度 + 撤销（2026-08-20 完成）：
  - Rust `copy_with_progress` / `move_with_progress` 新增 `overwrite` 参数（`prepare_destination` 辅助函数，含 3 个单测）；新增 `copy_dir_merge` 命令（复用 `copy_dir_recursive` 的合并语义）并注册
  - 新建 `lib/drag-transfer.ts`（planTransfer 传输计划，6 个单测）、`hooks/use-transfer-history.ts`（撤销记录，5 个单测）、`dialogs/ConflictResolutionDialog.tsx`、`explorer/TransferProgressToast.tsx`
  - DragDropContext：drop 前 `check_conflicts` 检测，有冲突弹对话框（逐项策略 + 应用到全部）；执行切换为 `copy/move_with_progress`；>10 项显示进度 toast（含取消，走 `cancel_file_operation`）；完成后记录撤销（toast 内 撤销按钮 + 窗口内 Cmd+Z，复用 `undo_operation` 逐项回滚）
  - v1 简化：merge 策略 = 内容并入已有文件夹（同名子项覆盖），且 merge 传输不进撤销历史；撤销窗口 = toast 可见期（8s 后自动清除记录）

Phase 2 进度（2026-08-20 完成）：
- ✅ §3.3-10 drop-action 机制：`findDropTarget` 返回 `action`（读 `data-drop-action`），新增 `isDropTargetValid` 校验（特殊落点接受任意拖拽）；drop 按 action 分派
- ✅ §3.3-11 废纸篓落点：`TrashPage.tsx` 根容器 `data-drop-action="trash"`，逐项 `move_to_trash`。原计划里 LeftSidebar 的废纸篓节点不存在（侧栏没有回收站入口），跳过
- ✅ §3.3-12 收藏落点：`SidebarBookmarks.tsx` 区域容器 `bookmark-add`（逐项 `add_bookmark` + 派发 `bookmarks-changed`）；收藏条目本身（目录）注册为普通目录落点（移动/复制进该目录）
- ✅ §3.3-13 面包屑落点：`NavigationBar.tsx` 各级 crumb（当前级除外）注册 `data-drop-target` + `data-is-folder`
- ✅ §3.3-14 驱动器落点：`SidebarDrives.tsx` 盘根与 Home 节点注册为目录落点（配合跨卷判定自动变复制）

Phase 3 进度（2026-08-20 完成）：
- ✅ §3.4-15 终端路径文本拖出：`use-draggable.ts` 支持 ⌘+拖 = 以纯文本拖出路径（`startDrag({ item: { data, types: ['public.utf8-plain-text'] } })`，插件 v2.1.0 API 已确认支持自定义类型；含 3 个单测验证无修饰键/⌘/阈值三种路径）
- ✅ §3.4-16 浏览器文本/URL/图片拖入：新建 `lib/drag-drop-content.ts`（解析 text/uri-list、纯文本、图片 blob；.webloc/.txt/二进制落盘），DragDropContext 增加窗口级 dragover/drop 处理；新增 Rust `write_binary_file` 命令（含 2 个单测）用于图片落盘；8 个单测覆盖解析矩阵
- ⚠️ 平台限制结论（真机探针实测）：macOS Tauri 下 WRY 原生拖拽处理器吞掉所有非文件拖拽，HTML5 drop 事件不会到达页面 → 浏览器拖入代码在 macOS 桌面端不触发（web 模式仍可用）。后续支持需 Rust 侧扩展 WRY drag handler
- 待手工验收：⌘+拖文本拖出（自动化验证到 startDrag 载荷为止）、全部交互项见 §6.2

评审修复（2026-08-20，代码审查后）：
- P0-1 补上所有目录落点的 `data-is-folder`（FileGrid/GalleryView 背景、EditorGroupPane、PaneTabBar 文件夹标签、DetailsView/TreeView 行），修复 Phase 0.4 校验引入的"背景落点全废"回归
- P0-2 拖拽启动时已按住的修饰键生效：`useDraggable` 把启动时 op 传入 `startInternalDrag`，`DragState` 新增 `baseOperation`
- P0-2 附带：`⌘⌥` 同时按住起步不再被文本拖拽分支吞掉（`metaKey && !altKey` 才走文本拖出），INT-03 符号链接可正常触发
- P1-3 撤销计数改为实际 `Completed` 的操作数（Rust 只在成功时入撤销栈；merge 项不计），全失败/取消时不记录
- P1-4 HTML5 拖入处理改为两种模式都注册（见 §7-2）
- P2-5 `planTransfer` 过滤 `dest === source` 的自冲突项，避免覆盖策略删除源文件
- P2-6 跨卷判定补齐：悬停时 badge 即时切换 + drop 逐项判定（带缓存），替代原先仅 drop 时查首个路径
- 次要：进度条改为按操作均值（不回退）；DetailsView/TreeView 行移除 `select-none`，改为"存在文本选择时不启动拖拽"；§4.6 i18n 键表对齐实际代码

## 3. 分阶段实施细节

### 3.1 Phase 0 — 修复现有问题

**1) overlay 文案 i18n 化**

- 文件：`apps/client/src/contexts/DragDropContext.tsx`（DragOverlay 组件）、`apps/client/src/locales/en.json`、`apps/client/src/locales/zh.json`
- 要点：硬编码 "Copy" / "Move" / `${count} files` 改为 `t('dragOverlay.copy')` 等；`${count}` 用 i18next 插值 `t('dragOverlay.files', { count })`
- 注意：只维护 en / zh 两个语言文件，不动 ja / id

**2) 修饰键 macOS 化**

- 文件：`apps/client/src/contexts/DragDropContext.tsx`
- 要点：
  - `DragState.operation` 类型扩为 `'copy' | 'move' | 'link'`
  - keydown/keyup 监听从 `e.key === 'Control'` 改为 `e.altKey`（Option）；同时检测 `e.metaKey && e.altKey` → op = `'link'`
  - 外部拖入（dragSource === 'external'）恒为 copy，不受修饰键影响
  - `link` 状态的落点执行（创建符号链接）在 Phase 1 接入（见 §3.2-10）；Phase 0 期间 link 落点会派发 `drag-drop-error`（i18n 键 `dragOverlay.linkUnsupported`），拒绝执行而非误移动
  - 风险：原生拖拽期间 webview 可能收不到 keydown（见 §7-3），需实测；fallback 按拖拽启动时修饰键状态定 op

**3) 列表 / 树视图拖出**

- 文件：`apps/client/src/components/explorer/DetailsView.tsx`、`apps/client/src/components/explorer/TreeView.tsx`
- 要点：行元素接入 `useDraggable`（复用现有 hook）；注意行内文本选择与 5px 拖拽阈值的冲突——仅在左键且未处于文本选择状态时允许触发拖拽
- 测试：`FileGridItem.test.tsx` 已有对应 mock 模式，新增 DetailsView / TreeView 测试时沿用

**4) validateDrop 补 is_dir 校验**

- 文件：`apps/client/src/lib/drag-utils.ts`、`apps/client/src/contexts/DragDropContext.tsx`
- 要点（实际实现，比原计划简化）：
  - `validateDrop` 增加第三个可选参数 `targetIsDir`（默认 true），目标不是文件夹直接判无效
  - DragDropContext 在 over / drop 时从落点 DOM 的 `data-is-folder` 属性取目标是否文件夹
  - 原计划的 Rust `stat_paths` 命令推迟——当前没有场景需要外部拖入路径的目录属性，等 Phase 1 冲突合并需要时再加

### 3.2 Phase 1 — 内部拖拽闭环（核心）

**5) 冲突解析（INT-08）**

- 新建：`apps/client/src/components/dialogs/ConflictResolutionDialog.tsx`
- 流程：
  1. drop 校验通过后，先调 `TauriAPI.checkConflicts(paths, targetDir)`（已接线的 `check_conflicts`）
  2. 无冲突 → 直接传输
  3. 有冲突 → 弹框：逐项展示源/目标信息，每项可选 覆盖 / 跳过 / 保留两者 / 合并（仅文件夹）；提供「应用到全部」
  4. 保留两者 → `TauriAPI.getRenameDestination(dir, name)` 生成目标名
- 样式参照 `apps/client/src/components/dialogs/` 现有对话框组件与 `--xp-*` CSS 变量

**6) 覆盖策略（Rust 小改 1）**

- 文件：`apps/src-tauri/src/operations/file_ops/copy_move.rs`、`packages/sdk/src/services/file-system.ts`、`apps/client/src/lib/tauri-api/file-system.ts`（三处同步）
- 要点：`copy_with_progress` / `move_with_progress` 增加 `overwrite: bool` 参数；为 true 且目标存在时先在 Rust 侧移除已有目标再传输（避免前端删原件的风险）。当前实现是"目标存在即报错"，此改动是覆盖策略的前提
- 注册：命令已注册，仅改签名；`main.rs` 无需动

**7) 执行切换到带进度命令（INT-10）**

- 文件：`apps/client/src/contexts/DragDropContext.tsx`（drop handler）、新建 `apps/client/src/components/explorer/TransferProgressToast.tsx`
- 要点：
  - drop 执行从 `TauriAPI.copy` / `moveFile` 改为 `copyWithProgress` / `moveWithProgress`，逐项调用并收集返回的 operation_id
  - 超过 10 项或总体积 > 100MB → 显示 TransferProgressToast：总进度 + 当前文件名 + 取消按钮
  - 取消 → `cancelFileOperation(operationId)`（Rust 侧会清理半成品文件）
  - 进度事件订阅方式沿用 `progress.rs` ProgressManager 现有事件（参考现有使用 `copy_with_progress` 的粘贴/批量重命名代码路径）

**8) 撤销接入（INT-09）**

- 新建：`apps/client/src/hooks/use-transfer-history.ts`
- 要点：
  - `copy/move_with_progress` 内部已 `record_operation`，**拖拽自动进入撤销历史**，无需新 Rust
  - 前端记录「最近一次拖拽」的摘要（数量、方向），完成后弹 toast「已移动 N 项 — 撤销」，点击或 Cmd+Z（窗口聚焦且非输入框焦点时）触发 `TauriAPI.undoOperation()`
  - Cmd+Z 监听放 DragDropContext 或全局快捷键 hook，注意与文本输入焦点冲突
  - 废纸篓操作不走此通道（废纸篓自身有恢复入口）

**9) 跨卷判定（INT-04，Rust 小改 2）**

- 文件：`apps/src-tauri/src/operations/file_ops/copy_move.rs`（新增 `same_volume(a: String, b: String) -> Result<bool, String>`，用 `std::os::unix::fs::MetadataExt::dev()` 比较设备号）、SDK + 前端 facade 接线
- 要点：
  - 拖拽启动时查询源目录与目标目录是否同卷；不同卷 → 默认 op = copy（overlay badge 即时显示）
  - 结果按 `(srcDir, dstDir)` 缓存，避免 over 事件高频查询
  - 同卷时才允许 move / link 语义

**10) 符号链接执行（INT-03）**

- 依赖 §4.8 的 `create_symlink`（Rust 小改 3）与 Phase 0 的 `link` 状态
- 文件：`apps/client/src/contexts/DragDropContext.tsx`（drop handler 按 op === 'link' 分支，逐项调 createSymlink，校验通过且同卷时可用）
- 完成后同样派发 `files-changed`；符号链接不产生撤销记录（目标文件在拖拽结束时即已生成，撤销由用户手动删除）

### 3.3 Phase 2 — 落点扩展

**10) drop-action 机制**

- 文件：`apps/client/src/contexts/DragDropContext.tsx`
- 要点：`findDropTarget` 返回值扩为 `{ path, action? }`，`action` 读 `data-drop-action` 属性；drop 执行处按 action 分派：

| action | 行为 | 后端命令 |
|---|---|---|
| （无） | 目录移动 / 复制（现有逻辑） | copy/move_with_progress |
| `trash` | 逐项移入废纸篓 | `move_to_trash` |
| `bookmark-add` | 添加收藏 | 现有收藏存储逻辑 |

**11) 废纸篓落点（DRI-06）**

- 文件：`apps/client/src/components/TrashPage.tsx`（视图空白区）、`apps/client/src/components/explorer/LeftSidebar.tsx`（废纸篓节点）
- 要点：两处加 `data-drop-target` + `data-drop-action="trash"`；悬停时不需要 `data-is-folder`（不触发弹簧加载）

**12) 收藏夹落点（DRI-07）**

- 文件：`apps/client/src/components/explorer/sidebar/SidebarBookmarks.tsx`
- 要点：收藏夹分组标题节点 = `bookmark-add`；具体收藏条目 = 普通目录落点（移动/复制进该目录）

**13) 面包屑落点（DRI-10）**

- 文件：`apps/client/src/components/explorer/NavigationBar.tsx`
- 要点：面包屑每一级路径 span 加 `data-drop-target`（当前级除外；「已在父目录」由 validateDrop 兜底）

**14) 驱动器落点（DRI-08）**

- 文件：`apps/client/src/components/explorer/sidebar/SidebarDrives.tsx`
- 要点：盘根节点 = 目录落点；配合跨卷判定，拖到不同盘自动变复制

### 3.4 Phase 3 — 拖入/拖出增强（均含 POC）

**15) 终端路径文本拖出（DRO-05）**

- POC：`tauri-plugin-drag` 是否支持 `startDrag` 附带 text/uri-list 数据类型
- 可行 → `apps/client/src/hooks/use-draggable.ts` 增加可选 payload 类型；不可行 → 保持规划状态

**16) 浏览器文本/图片拖入（DRI-04/05）**

- POC：WKWebView 的 `onDragDropEvent` 是否携带非文件数据（文本 / URL / 图片）
- 可行 → `DragDropContext.tsx` 的 enter/drop 增加分支：文本 → .txt、URL → .webloc、图片 → 原格式存盘；不可行 → 保持规划状态

### 3.5 Phase 4 — 布局（可选）

- **网格手动排序（SRT-03）**：`FileGrid.tsx` + 手动排序模式 + per-folder localStorage 持久化（独立于 `wisp:settings`）
- **标签拖出新窗（SRT-02）**：`PaneTabBar.tsx` + Tauri `WebviewWindow`，新窗口复用当前会话状态
- **收藏排序（SRT-04）**：`SidebarBookmarks.tsx` HTML5 拖拽重排（参照 PaneTabBar 的现有实现）

## 4. 关键设计

### 4.1 修饰键与操作三态

- 判定优先级：`link`（⌘+Option）> `copy`（Option 或外部拖入）> `move`（默认）
- overlay 三态：move = 蓝色箭头 ｜ copy = 绿色 + ｜ link = 橙色链（沿用现有 overlay 样式，加第三态）
- 跨卷时强制 copy，与修饰键取并集

### 4.2 冲突解析流程

```
drop 校验通过
  → checkConflicts(paths, targetDir)
  → 无冲突 ──→ 逐项 copy/moveWithProgress
  → 有冲突 ──→ ConflictResolutionDialog
        ├─ 覆盖 → overwrite=true
        ├─ 跳过 → 过滤该项
        ├─ 保留两者 → getRenameDestination 生成目标名
        └─ 合并（仅文件夹）→ 递归应用所选策略
  → 收集 operation_id → 进度 UI → 全部完成 → 记录撤销摘要 → toast → files-changed
```

### 4.3 跨卷判定

- Rust：`same_volume` 命令（unix 用 `st_dev`、windows 用卷序列号），两路径设备号不同即为跨卷
- 前端：`DragDropContext` 维护 `volumeCacheRef` 按 `(source, targetDir)` 缓存结果
  - 拖拽启动：`useDraggable` 把启动时修饰键决定的 op（move/copy/link）传入 `START_DRAG`，存入 `baseOperation`
  - 悬停：`baseOperation === 'move'` 且目标为目录落点时异步查卷，跨卷即时把 badge 切为复制（`SET_OPERATION`），悬停回同卷目标时还原
  - drop：`runTransfer` 逐项判定（缓存命中），跨卷项用复制、同卷项用移动
- 修饰键（⌥=复制、⌘⌥=链接）优先于跨卷语义：`baseOperation` 非 move 时不做跨卷覆盖

### 4.4 撤销

- 依赖 `copy/move_with_progress` 内部已有的 `record_operation`（`FileOperation::Copy/Move`）
- 前端触发：toast 按钮或 Cmd+Z（窗口聚焦、无输入框焦点）
- 撤销执行：`undo_operation()`（Rust 已有，会做反向移动/删除），完成后派发 `files-changed`

### 4.5 进度与取消

- 进度事件：ProgressManager（`progress.rs`）现有事件通道，前端按 operation_id 关联
- 取消：`cancel_file_operation(operation_id)`；Rust 侧会清理半成品文件并记录审计日志
- UI 阈值：> 10 项或 > 100MB；低于阈值静默传输

### 4.6 i18n 键（en.json / zh.json，仅这两个语言，实际落地键）

| 键 | 英文 | 中文 |
|---|---|---|
| `dragOverlay.copy` | Copy | 复制 |
| `dragOverlay.move` | Move | 移动 |
| `dragOverlay.link` | Link | 创建链接 |
| `dragOverlay.files` | {{count}} files | {{count}} 个文件 |
| `dragOverlay.webModeHint` | File drag & drop requires the desktop app | 文件拖拽需在桌面版应用中使用 |
| `conflict.title` | File conflict | 文件冲突 |
| `conflict.overwrite` | Overwrite | 覆盖 |
| `conflict.skip` | Skip | 跳过 |
| `conflict.keepBoth` | Keep both | 保留两者 |
| `conflict.merge` | Merge | 合并 |
| `conflict.applyToAll` | Apply to all: | 应用到全部： |
| `conflict.confirm` | Apply | 应用 |
| `conflict.cancel` | Cancel | 取消 |
| `transfer.progressTitle` | Transferring… | 正在传输… |
| `transfer.doneMove` | Moved {{count}} items | 已移动 {{count}} 项 |
| `transfer.doneCopy` | Copied {{count}} items | 已复制 {{count}} 项 |
| `transfer.failed` | {{count}} failed | {{count}} 项失败 |
| `transfer.undo` | Undo | 撤销 |
| `transfer.cancel` | Cancel | 取消 |

### 4.7 边缘自动滚动（UX-04）

- over 事件中检测光标距最近可滚动容器四边 < 24px → rAF 以 12px/帧滚动该容器
- 找最近 scrollable ancestor（`overflow-y: auto/scroll` 且 `scrollHeight > clientHeight`）

### 4.8 符号链接（INT-03，Rust 小改 3）

- 新增命令：`create_symlink(source: String, dest: String) -> Result<(), String>`（`std::os::unix::fs::symlink`，校验 dest 不存在），放 `copy_move.rs`；SDK + 前端 facade 接线
- UI 文案统一用「创建符号链接」，避免与 Finder「替身」混淆
- `read_directory` 同时返回 `is_symlink` / `symlink_target` / `is_alias`：symlink 用 `symlink_metadata` + `read_link` 识别；macOS Finder 替身读取 `com.apple.FinderInfo` 的 `kIsAlias` 标志
- `FileReferenceBadge.tsx` 统一渲染：链条 = symlink，箭头 = Finder 替身；创建/解析真 Finder 替身仍列为后续项

### 4.9 多分栏、多窗口刷新

- `files-changed` 只在一个 WebView 内有效，因此只能刷新单个 Wisp 窗口；原实现不能满足两窗口验收
- `file-change-events.ts` 先立即派发本地 `files-changed`，再通过 Tauri `wisp-files-changed` 广播给其他窗口；来源窗口用 source id 去重
- `EditorGroupPane` 收到本地事件后统一失效 `['files']` 查询，因此同一窗口的左、右分栏一起重新读取
- 手动刷新、symlink、废纸篓、撤销、浏览器内容落盘等无进度操作统一走 `notifyFilesChanged`
- `file-operation-progress.ts` 在传输前建立唯一监听、缓存最后进度；每个窗口收到 Completed/Failed/Cancelled 后刷新本窗，避免快速 rename 的完成事件早于 toast 挂载

### 4.10 离开窗口与操作交接

- 新增 `isOverWindow`：收到 native `leave` 立即清高亮、停 rAF、隐藏 Web overlay；外部应用继续显示 macOS 原生幽灵图
- 原生拖拽结束回调延迟 250ms 清理内部操作，给目的 WebView 的 `drop` 留出交接时间，避免 ⌘⌥ 的 `link` 被提前重置为 `move`
- 拖拽活动期在 document 根节点临时禁用文字选择；END_DRAG 和卸载时必定清理

## 5. 文件改动总表

| 文件 | 阶段 | 动作 | 内容 |
|---|---|---|---|
| `apps/client/src/contexts/DragDropContext.tsx` | 0/1/2/3 | 修改 | i18n、修饰键三态、drop-action、进度/撤销/冲突接线、自动滚动 |
| `apps/client/src/lib/drag-utils.ts` | 0 | 修改 | is_dir 校验 |
| `apps/client/src/hooks/use-draggable.ts` | 3 | 修改 | 可选文本数据（POC 通过后） |
| `apps/client/src/components/explorer/DetailsView.tsx` | 0 | 修改 | 行拖出 |
| `apps/client/src/components/explorer/TreeView.tsx` | 0 | 修改 | 行拖出 |
| `apps/client/src/components/dialogs/ConflictResolutionDialog.tsx` | 1 | **新建** | 冲突对话框 |
| `apps/client/src/components/explorer/TransferProgressToast.tsx` | 1 | **新建** | 进度 + 取消 UI |
| `apps/client/src/lib/file-operation-progress.ts` | 修复 | **新建** | 提前监听并缓存快速操作终态 |
| `apps/client/src/lib/file-change-events.ts` | 修复 | **新建** | 当前窗口全分栏 + 跨 Wisp 窗口刷新 |
| `apps/client/src/components/explorer/FileReferenceBadge.tsx` | 修复 | **新建** | symlink / Finder 替身视觉及辅助功能标识 |
| `apps/client/src/hooks/use-transfer-history.ts` | 1 | **新建** | 撤销摘要记录 |
| `apps/client/src/components/TrashPage.tsx` | 2 | 修改 | 废纸篓落点 |
| `apps/client/src/components/explorer/LeftSidebar.tsx` | 2 | 修改 | 侧栏废纸篓落点 |
| `apps/client/src/components/explorer/sidebar/SidebarBookmarks.tsx` | 2/4 | 修改 | 收藏落点 + 排序 |
| `apps/client/src/components/explorer/sidebar/SidebarDrives.tsx` | 2 | 修改 | 驱动器落点 |
| `apps/client/src/components/explorer/NavigationBar.tsx` | 2 | 修改 | 面包屑落点 |
| `apps/client/src/locales/en.json` / `zh.json` | 0/1/修复 | 修改 | 新增 §4.6 与链接标识键 |
| `apps/client/src/lib/tauri-api/file-system.ts` | 0/1/2 | 修改 | overwrite 参数、same_volume、stat_paths、create_symlink 接线 |
| `packages/sdk/src/services/file-system.ts` | 0/1/2 | 修改 | 同上（SDK 服务层） |
| `apps/src-tauri/src/operations/file_ops/copy_move.rs` | 0/1/2 | 修改 | overwrite 参数、same_volume、stat_paths、create_symlink |
| `apps/src-tauri/src/operations/directory_ops.rs` / `types.rs` | 修复 | 修改 | symlink 与 Finder 替身元数据 |
| `apps/client/src/components/explorer/FileGrid.tsx` | 4 | 修改 | 手动排序（可选） |
| `apps/client/src/components/split-view/PaneTabBar.tsx` | 4 | 修改 | 拖出新窗（可选） |
| 测试文件（见 §6） | 各阶段 | 修改/新建 | 单测 |

> 架构规则提醒：新命令一律经 `@wisp/sdk` 服务 + `TauriAPI` facade，组件内禁止直接 `invoke()`。

## 6. 测试与验证

### 6.1 自动化测试

- **前端（vitest + jsdom，`apps/client/src/__tests__/`）**：
  - `lib/drag-utils.test.ts`（新建）：validateDrop 校验矩阵（自身 / 子孙 / 同父目录 / 非文件夹目标）
  - `components/explorer/FileGridItem.test.tsx`（扩展）：修饰键三态、多选拖出路径集合
  - `hooks/use-transfer-history.test.ts`（新建）：撤销摘要记录与清空
  - 注意：新增 lucide-react 图标时同步更新 `__tests__/setup.ts` 的 mock；新 Tauri 命令需在 setup 的 invoke mock 中补 handler
- **Rust（`cd apps/src-tauri && cargo test`）**：
  - `copy_move.rs`：overwrite 行为、same_volume（跨卷目录 vs 同卷目录）、create_symlink
- **命令**：`npx tsc --noEmit` → `npx vitest run <changed-test>` → `pnpm run lint` → `cd apps/src-tauri && cargo test`

### 6.2 手工验收清单（macOS，供逐项检查）

> 完整测试用例（含回归项与已知限制）见 [drag-and-drop-test-cases.md](./drag-and-drop-test-cases.md)。
> 按功能分组，每项独立可测。标注 ⚠️ 的为已知限制或需重点观察项。

**A. 拖出到外部**

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 网格视图多选 2-3 个文件，拖到微信/QQ 聊天窗口 | 对方收到文件，可发送 |
| 2 | 拖一个文件到访达的某个目录 | 同盘=移动；外接盘/不同卷=复制（overlay badge 自动切换为复制） |
| 3 | 拖一个文件到 Dock 上的应用图标 | 用该应用打开 |
| 4 | **⌘+拖**一个文件到终端窗口（Terminal/iTerm） | 终端粘贴出该文件路径 ⚠️ |
| 5 | 从列表视图（Details）和树视图（Tree）的行拖出文件 | 与网格视图行为一致 |

**B. 拖入（外部 → Wisp）**

| # | 步骤 | 期望 |
|---|---|---|
| 6 | 从访达拖 3 个文件进当前目录 | 复制成功，视图刷新 |
| 7 | 从微信聊天把文件拖进 Wisp | 复制成功 |
| 8 | 从浏览器拖一段选中文本到 Wisp | ⚠️ 已知限制：macOS 下不会生成文件（WRY 吞掉非文件拖拽），确认无异常报错即可 |
| 9 | 从浏览器拖一张图片到 Wisp | ⚠️ 同 #8 |

**C. 内部拖拽（整理）**

| # | 步骤 | 期望 |
|---|---|---|
| 10 | 拖文件进文件夹 | 移动；悬浮文件夹 500ms 自动展开（弹簧加载） |
| 11 | 按住 Option 拖文件 | badge 变绿「+ 复制」，落下为复制 |
| 12 | 按住 ⌘+Option 拖文件到文件夹 | badge 变黄「创建链接」，目标处生成符号链接（终端 ls -l 可见） |
| 13 | 拖文件到它自己/自己的子文件夹/当前父目录 | 红色无效标记，不执行 |
| 14 | 拖 20 个文件到文件夹 | 进度 toast 出现，可点「取消」；完成后 toast 显示「已移动 N 项 — 撤销」 |
| 15 | 完成一次移动后 8 秒内点 toast 的「撤销」（或按 Cmd+Z） | 文件回到原位 |
| 16 | 拖同名文件到已有同名文件的文件夹 | 弹出冲突对话框：覆盖/跳过/保留两者/合并分别验证（合并仅文件夹冲突可选） |
| 17 | Esc 取消拖拽 | 无任何操作记录 |

**D. 界面落点**

| # | 步骤 | 期望 |
|---|---|---|
| 18 | 拖文件到废纸篓页面 | 移入废纸篓，可恢复 |
| 19 | 拖文件到侧栏「收藏夹」标题区域 | 添加收藏 |
| 20 | 拖文件到侧栏收藏的某个目录条目 | 移动/复制进该目录 |
| 21 | 拖文件到面包屑的上一级 | 移动到那一级 |
| 22 | 拖文件到侧栏「设备」的盘根/Home 节点 | 移动/复制到该位置（跨盘自动变复制） |
| 23 | 拖文件到另一个标签页 | 切换目录并落下 |
| 24 | 拖文件到 AI 聊天输入框 | 加入附件列表 |

## 7. 风险与 POC 结论

1. **tauri-plugin-drag 多数据类型**（DRO-05）：✅ 已确认插件 v2.1.0 支持 `{ data, types }` 自定义类型；⌘+拖文本已实现并有单测，端到端行为待手工验收（清单 #4）。
2. **WKWebView 非文件拖入**（DRI-04/05）：❌ 已探针实测确认——macOS Tauri 下 HTML5 drop 事件不达页面。HTML5 处理现在**两种模式都注册**：桌面端被 WRY 拦截不触发；网页版事件可到达、解析逻辑生效，但落盘依赖后端（当前网页版无文件后端）。后续如需桌面端支持须扩展 WRY Rust 侧 drag handler。
3. **原生拖拽期间键盘事件**（INT-02）：系统接管拖拽后 keydown 可能到不了 webview，修饰键实时切换需手工确认（清单 #11）；fallback 用拖拽启动时的修饰键状态定 op。
4. **overwrite 参数改动**：`copy_with_progress` 默认 `overwrite: false`，现有调用方（paste-helpers 等）行为不变。
5. **symlink 与 Finder 替身差异**：⌘⌥ 明确创建 symlink；列表可识别并区分已有 Finder 替身，但不创建、不解析替身目标。
6. **拖拽期间视图刷新**：只在操作终态刷新，不在传输中持续刷新，避免重渲染打断落点高亮。
7. **跨窗口操作语义**：刷新已跨窗口；若要让目标窗口继承源窗口的 move/copy/link 状态，还需新增跨 WebView drag-session 同步，不能把任意外部文件拖入误判成内部移动。
