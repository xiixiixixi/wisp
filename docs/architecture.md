# Wisp 工程模块架构

> 本文档基于 `next` 分支代码深度分析，覆盖完整的 monorepo 结构、模块职责、数据流与调用链路。

---

## 目录

1. [项目概览](#项目概览)
2. [顶层目录结构](#顶层目录结构)
3. [模块架构图](#模块架构图)
4. [前端模块详解](#前端模块详解-appsclient)
5. [后端模块详解](#后端模块详解-appssrc-tauri)
6. [扩展系统详解](#扩展系统详解)
7. [Marketplace 详解](#marketplace-详解-appsweb)
8. [公共包详解](#公共包详解-packages)
9. [核心调用链路](#核心调用链路)
10. [模块规模统计](#模块规模统计)

---

## 项目概览

| 项目 | 说明 |
|---|---|
| **名称** | Wisp |
| **定位** | 现代化、AI 驱动的跨平台文件管理器 |
| **技术栈** | Tauri 2 (Rust) + React 19 + TypeScript + Vite 5 |
| **包管理** | pnpm monorepo (31 个 workspace 项目) |
| **许可证** | AGPL-3.0 |
| **分支** | `next` — 使用 Tauri 2 + React 19 的完全重写版本 |
| **状态** | Alpha 阶段，功能丰富但未达到生产就绪 |

---

## 顶层目录结构

```
wisp/
├── apps/                    # 可部署应用
│   ├── client/              # 桌面端前端 (React + Vite)
│   ├── src-tauri/           # 桌面端后端 (Rust + Tauri 2)
│   └── web/                 # 扩展市场 (Next.js + Prisma + Stripe)
│
├── packages/                # 共享库和扩展
│   ├── sdk/                 # 内部 SDK: 类型化 IPC 服务层
│   ├── extension-sdk/       # 公开扩展 SDK (第三方使用)
│   ├── cli/                 # CLI 二进制 (`wisp` 命令)
│   ├── create-extension/    # 扩展脚手架
│   └── extensions/          # 25 个内置扩展
│
├── scripts/                 # 构建/签名/发布脚本
├── infra/                   # docker-compose (本地 PostgreSQL)
└── .github/workflows/       # CI/CD
```

---

## 模块架构图

```
                        ┌─────────────────────────────────────┐
                        │     xplorer.space (Vercel)           │
                        │  apps/web  (Next.js 市场)            │
                        │  ─────────────────────────           │
                        │  · 扩展浏览/搜索/安装 API             │
                        │  · 用户认证 (NextAuth)               │
                        │  · 支付 (Stripe)                     │
                        │  · 扩展上传/审核 (管理员)             │
                        │  · 数据: Prisma + PostgreSQL         │
                        └───────┬──────────┬──────────────────┘
                                │          │
                HTTP (浏览/安装)  │          │  HTTP (发布/同步)
                                ▼          ▼
    ┌──────────────────────────────┐   ┌──────────────────────┐
    │  桌面应用 (Tauri)             │   │  CLI (packages/cli)   │
    │                              │   │  ─────────────────    │
    │  ┌────────────────────────┐  │   │  wisp login        │
    │  │ 前端 WebView            │  │   │  wisp publish      │
    │  │ (apps/client)           │  │   │  wisp open <path>  │
    │  │ ─────────────────────── │  │   └──────────────────────┘
    │  │                        │  │
    │  │  App.tsx               │  │     ┌─────────────────────────────┐
    │  │  ├─ pages/             │  │     │  Extension SDK              │
    │  │  │  ├─ wisp.tsx     │  │     │  packages/extension-sdk     │
    │  │  │  └─ settings.tsx    │  │     │  ────────────────────────   │
    │  │  ├─ hooks/             │  │     │                             │
    │  │  │  ├─ use-wisp-    │  │     │  Theme.register()           │
    │  │  │  │  effects.ts  ◄───┼──┐    │  Sidebar.register()         │
    │  │  │  ├─ use-shortcuts   │  │ │    │  Command.register()         │
    │  │  │  └─ use-chat.ts     │  │ │    │  ContextMenu.register()    │
    │  │  ├─ components/        │  │ │    │  Preview.register()        │
    │  │  │  ├─ explorer/       │  │ │    │  Editor.register()         │
    │  │  │  │  ├─ MainLayout   │  │ │    │  BottomTab.register()      │
    │  │  │  │  ├─ LeftSidebar  │  │ │    │                             │
    │  │  │  │  ├─ FileGrid     │  │ │    │  useCurrentPath()          │
    │  │  │  │  └─ TopBar       │  │ │    │  useSelectedFiles()        │
    │  │  │  ├─ panels/         │  │ │    │  navigateTo()              │
    │  │  │  │  ├─ ChatPanel    │  │ │    └──────────┬──────────────────┘
    │  │  │  │  ├─ AgentMgr     │  │ │                │
    │  │  │  │  ├─ Terminal     │  │ │                │
    │  │  │  │  ├─ Extensions   │  │ │                │ window.__wisp_register__()
    │  │  │  │  └─ Marketplace  │  │ │                ▼
    │  │  │  ├─ previews/       │  │ │    ┌────────────────────────────┐
    │  │  │  ├─ dialogs/        │  │ │    │  扩展沙箱 (同一 WebView)    │
    │  │  │  └─ settings/       │  │ │    │  ──────────────────────    │
    │  │  └─ lib/               │  │ │    │                            │
    │  │     ├★ extension-     │  │ │    │  · 25 个内置扩展            │
    │  │     │  host.ts    ◄────┼──┼────┤  · 第三方扩展                │
    │  │     ├★ extension-     │  │    │  · new Function() 执行       │
    │  │     │  sandbox.ts     │  │    │  · Proxy 沙箱环境            │
    │  │     ├★ extension-     │  │    │  · require() 白名单          │
    │  │     │  api-factory.ts │──┼────┼── (react, react-dom, SDK)   │
    │  │     ├─ tauri-api/     │  │    │  · 最大 5 MiB bundle         │
    │  │     │  └─ index.ts    │  │    │                            │
    │  │     ├─ ai-service.ts  │  │    │  扩展可注册:                 │
    │  │     ├─ agent-service  │  │    │  · Panel / SidebarTab       │
    │  │     ├─ context-menu-  │  │    │  · Editor / Preview         │
    │  │     │  factory.ts     │  │    │  · Command / ContextMenu    │
    │  │     └─ theme-registry │  │    │  · Theme / Keybinding       │
    │  └───────────────────────┘  │    │  · Decorator / Dialog       │
    │                              │    └──────────┬─────────────────┘
    │  ┌────────────────────────┐  │               │ Tauri IPC
    │  │ 后端 (apps/src-tauri)   │  │               ▼
    │  │ ─────────────────────── │  │    ┌────────────────────────────┐
    │  │                        │  │    │  扩展 Rust 宿主              │
    │  │  main.rs               │  │    │  apps/src-tauri/src/        │
    │  │  ├─ 注册 280+ 命令      │◄─┼────┤  extensions/               │
    │  │  │                     │  │    │  ───────────────────────    │
    │  │  ├★ operations/       │  │    │                            │
    │  │  │  ├─ file_ops/       │  │    │  manager.rs                │
    │  │  │  ├─ compression/    │  │    │  ├─ 扫描已安装扩展           │
    │  │  │  ├─ undo_redo/      │  │    │  ├─ 安装 .xtension 包       │
    │  │  │  └─ …               │  │    │  ├─ 启用/停用管理           │
    │  │  ├★ search/           │  │    │  ├─ 权限验证                 │
    │  │  │  ├─ index.rs (63KB)│  │    │  └─ 持久化 active_extensions │
    │  │  │  ├─ bm25f.rs        │  │    │                            │
    │  │  │  ├─ hybrid.rs       │  │    │  signing.rs                │
    │  │  │  └─ ollama_client   │  │    │  ├─ 全目录 SHA-256          │
    │  │  ├★ agent/            │  │    │  ├─ Ed25519 签名验证         │
    │  │  │  ├─ planner.rs     │  │    │  └─ 防篡改检测               │
    │  │  │  ├─ tool_executor   │  │    │                            │
    │  │  │  ├─ security.rs    │  │    │  wasm_runtime.rs            │
    │  │  │  └─ streaming.rs   │  │    │  ├─ wasmi 解释器             │
    │  │  ├★ extensions/       │  │    │  ├─ fuel 限制 (1M/调用)      │
    │  │  │  ├─ manager.rs     │  │    │  ├─ 内存 64 MiB 上限         │
    │  │  │  ├─ signing.rs     │  │    │  └─ host functions 注册      │
    │  │  │  ├─ wasm_runtime   │  │    │                            │
    │  │  │  └─ commands/      │  │    │  host_functions.rs          │
    │  │  ├★ git/              │  │    │  ├─ 文件读写                  │
    │  │  │  ├─ service.rs     │  │    │  ├─ HTTP 请求                 │
    │  │  │  └─ parsing.rs     │  │    │  ├─ Git 操作                  │
    │  │  ├★ ai.rs (56KB)     │  │    │  └─ 扩展存储                  │
    │  │  ├★ google_drive.rs  │  │    │                            │
    │  │  ├★ mcp_host.rs       │  │    │  dev_watcher.rs             │
    │  │  ├★ mcp_server.rs     │  │    │  ├─ .hotreload sentinel     │
    │  │  ├★ pty.rs            │  │    │  └─ 5 秒轮询 + change 事件   │
    │  │  ├★ shortcuts/        │  │    │                            │
    │  │  │  └─ manager.rs     │  │    │  commands/                  │
    │  │  ├★ storage/          │  │    │  ├─ install.rs              │
    │  │  │  ├─ bookmarks.rs   │  │    │  ├─ pack.rs (.xtension)     │
    │  │  │  └─ tags.rs        │  │    │  ├─ manage.rs               │
    │  │  ├─ duplicate_finder  │  │    │  └─ wasm.rs                 │
    │  │  ├─ file_organizer    │  │    └────────────────────────────┘
    │  │  ├─ file_versions     │  │
    │  │  ├─ backup.rs         │  │      ┌──────────────────────────┐
    │  │  ├─ secure_credential │  │      │  扩展 WASM 后端            │
    │  │  └─ sync.rs           │  │      │  ────────────────         │
    │  └────────────────────────┘  │      │  backend.wasm            │
    │                              │      │  导出:                    │
    │  数据目录:                    │      │  · handle_call()         │
    │  ~/Library/Application       │      │  · alloc()              │
    │  Support/com.wisp.app/    │      │  · dealloc()            │
    │  ├─ extensions/              │      │  · memory               │
    │  ├─ active_extensions.json   │      └──────────────────────────┘
    │  ├─ extension_storage.json   │
    │  ├─ shortcuts.json           │
    │  ├─ wisp.db (SQLite)      │
    │  └─ backups/                 │
    └──────────────────────────────┘
```

---

## 前端模块详解 (apps/client)

### 入口

| 文件 | 行号 | 职责 |
|---|---|---|
| `src/main.tsx` | 1 | React 根渲染；`window.React/ReactDOM/WispSDK` 暴露给扩展沙箱；主题事件桥接 |
| `src/App.tsx` | 1 | 根组件；wouter 路由 (`/` → Explorer, `/settings` → Settings)；QueryClientProvider、ErrorBoundary、XtensionInstallDialog、UpdateBanner |
| `src/i18n.ts` | 1 | i18next 初始化 (en, zh, ja, id)，自动检测语言 |

### 页面层 (`pages/`)

| 文件 | 职责 |
|---|---|
| `wisp.tsx` | 主文件管理器视图 (ExplorerUnified) |
| `settings.tsx` | 设置页面 |
| `HomePage.tsx` | 欢迎页 |
| `FileComparisonPage.tsx` | 并排文件对比 |
| `ChatFileView.tsx` | AI 聊天文件视图 |
| `FileEditorView.tsx` | 文件编辑器 |
| `gdrive-accounts.tsx` | Google Drive 账户管理 |

### 组件层 (`components/`)

| 目录 | 文件数 | 职责 |
|---|---|---|
| `explorer/` | ~22 | 核心文件管理器 UI：MainLayout, TopBar, NavigationBar, LeftSidebar, FileGrid, DetailsView, ColumnView, GalleryView, TreeView, SearchResultsPanel, DialogLayer, VerticalExtensionsBar |
| `explorer/sidebar/` | ~10 | 左侧栏：Places, Bookmarks, Collections, Drives, FileTree, QuickAccess, Recent, TabBar |
| `panels/` | ~98 | 右侧/底部面板：Chat, AgentManager, Terminal, Extensions, Marketplace, Preview, Properties, Notes, Clipboard, … |
| `panels/agent-manager/` | ~39 | Agent 管理：Workspace, Conversation, ActiveAgents, NewAgentForm, ScheduleAgent, SkillsBrowser, CostTracker, … |
| `dialogs/` | ~38 | 对话框：BatchConfirm, BulkRename, Compress, Encrypt, Extract, FileConflict, KeyboardShortcuts, XtensionInstall, … |
| `previews/` | ~12 | 文件预览：Audio, Code, CSV, Document, Image, JSON, Markdown, PDF, Spreadsheet, Text, Video |
| `settings/` | ~12 | 设置页：AI, Accessibility, Backup, Explorer, FileAssociations, General, Shortcuts, … |
| `split-view/` | ~4 | 多窗格分屏：SplitContainer, EditorGroupPane, PaneFileExplorer, PaneTabBar |
| `ui/` | ~20 | 通用 UI 原语 (shadcn/ui)：Button, Card, Dialog, Input, Select, Tabs, ContextMenu, FileTree, Toast, … |

### Hook 层 (`hooks/`) — ~53 个

#### 文件操作
- `use-file-operations.ts` — 文件 CRUD 操作
- `use-file-actions.ts` — 文件上下文动作
- `use-bulk-rename.ts` — 批量重命名

#### 布局
- `use-split-layout.ts` — 分屏布局状态
- `use-layout-state.ts` — 面板显隐/大小
- `use-grid-layout.ts` — 网格视图布局
- `use-sidebar-resize.ts` — 侧栏拖拽调整

#### 导航
- `use-navigation.ts` — 目录导航
- `use-navigation-actions.ts` — 导航动作封装

#### 搜索
- `use-live-search.ts` — 实时搜索
- `use-search-results.ts` — 搜索结果状态
- `use-type-ahead-search.ts` — 输入即搜

#### AI / 聊天
- `use-chat.ts` — 聊天核心逻辑
- `use-chat-state.ts` — 聊天状态管理
- `use-chat-file.ts` — 文件上下文聊天
- `use-voice-input.ts` — 语音输入

#### 命令 / 快捷键
- `use-command-palette-commands.ts` — 命令面板数据
- `use-shortcuts.ts` — 快捷键注册/监听
- `use-vim-mode.ts` — Vim 快捷键模式

#### 扩展管理
- `use-wisp-effects.ts` — **★ 核心**: 扩展加载、`window.__wisp_state__` 初始化、命令面板扩展条目注入

### 核心库层 (`lib/`) — ~46 个模块

#### 扩展系统 (★ 核心)
| 文件 | 大小 | 职责 |
|---|---|---|
| `extension-host.ts` | ~59KB | **扩展宿主核心单例**: 生命周期、注册表、沙箱执行、激活/停用/卸载/热重载 |
| `extension-sandbox.ts` | — | 沙箱执行器 (`new Function()`) |
| `extension-sandbox-env.ts` | — | 沙箱环境 (Proxy 阻断 fetch/WebSocket/Storage/… ) |
| `extension-api-factory.ts` | — | 为每个扩展构造权限感知的 API 对象 |
| `extension-registry.ts` | — | 扩展注册表 (按文件扩展名匹配 Editor/Preview) |
| `extension-host-types.ts` | — | 前端 manifest 类型定义 |
| `extension-permissions.ts` | — | 前端权限判断 |

#### Tauri API 层
| 文件 | 大小 | 职责 |
|---|---|---|
| `tauri-api/index.ts` | — | 统一 IPC facade，按领域拆分 |
| `tauri-api/file-system.ts` | ~20KB | 文件系统操作 |
| `tauri-api/system.ts` | ~16KB | 系统操作、快捷键、扩展管理 |
| `tauri-api/extensions.ts` | — | 扩展安装/卸载/权限 API |
| `tauri-api/ai.ts` | — | AI 调用 |
| `tauri-api/git.ts` | — | Git 操作 |
| `tauri-api/search.ts` | — | 搜索引擎 |
| `tauri-api/storage.ts` | — | SQLite 存储 |
| `tauri-api/agent-sessions.ts` | — | Agent 会话 |
| `tauri-api/pty.ts` | — | 终端 |
| `tauri-api/transport.ts` | — | IPC 传输层 (Tauri invoke / HTTP fallback) |

#### 服务层
- `ai-service.ts` — AI 服务封装
- `agent-service.ts` — Agent 服务封装
- `context-menu-factory.ts` (38KB) — 右键菜单生成
- `theme-registry.ts` — 主题注册

---

## 后端模块详解 (apps/src-tauri)

### 入口

| 文件 | 行号 | 职责 |
|---|---|---|
| `src/main.rs` | 31 | `main()`: 初始化日志、检查 `--mcp-server` 模式、构建 Tauri app (6 个插件) |
| `src/main.rs` | 59 | `setup()`: 初始化进度管理器、扩展管理器、快捷键管理器、开发监视器、CLI 自动安装 |
| `src/main.rs` | 243 | `.invoke_handler()`: 注册 280+ 个 Tauri 命令 |
| `src/lib.rs` | 1 | 26 个模块声明 |

### 模块清单

| 模块 | 文件数 | 大小 | 职责 |
|---|---|---|---|
| `operations/` | 25 | — | ★ 核心文件操作: 批量、复制/移动、删除、压缩(ZIP/TAR/7z/RAR)、加密、镜像、元数据、回收站、撤销/重做、Docker |
| `search/` | 27 | 63KB (index.rs) | ★ 搜索引擎 v2: BM25F、FST 索引、模糊搜索、混合搜索、语义搜索、Ollama 集成 |
| `extensions/` | 13 | 36KB (manager) | ★ 扩展系统: 生命周期管理、Ed25519 签名、WASM 运行时、主机函数、权限、开发监视器 |
| `agent/` | 8 | 39KB (mod) | ★ AI Agent: 任务规划、工具执行、安全策略、流式输出、记忆系统 |
| `git/` | 11 | 20KB (service) | Git 集成: status, history, blame, diff, staging, branches, remotes |
| `storage/` | 9 | — | SQLite 存储: 书签、标签、笔记、最近文件、聊天历史、扩展存储 |
| `ai.rs` | 1 | 56KB | AI 服务: chat、文件分析、智能建议、自动标签、Ollama |
| `google_drive.rs` | 1 | 38KB | Google Drive: OAuth、文件 CRUD、设置 |
| `shortcuts/` | 3 | 30KB (manager) | 快捷键管理: 注册/注销、全局/上下文、扩展快捷键 |
| `mcp_host.rs` | 1 | 21KB | MCP 主机: 将 Wisp 暴露为 MCP 工具提供者 |
| `mcp_server.rs` | 1 | 10KB | MCP 服务器: headless stdio JSON-RPC 模式 |
| `sync.rs` | 1 | 20KB | 云端同步: 书签/标签同步到 Web API |
| `duplicate_finder.rs` | 1 | 34KB | 重复文件检测 |
| `file_organizer.rs` | 1 | 37KB | 文件整理器 |
| `file_versions.rs` | 1 | 15KB | 文件版本管理 |
| `backup.rs` | 1 | 16KB | 备份管理 |
| `audit_log.rs` | 1 | 11KB | 审计日志 |
| `secure_credentials.rs` | 1 | 2KB | 钥匙串凭据存储 |
| `pty.rs` | 1 | 7KB | 交互式终端 |
| `file_watcher.rs` | 1 | 7KB | 文件系统监视 |

### Tauri 插件依赖

```toml
# apps/src-tauri/Cargo.toml
tauri-plugin-fs = "2"
tauri-plugin-global-shortcut = "2.3.0"
tauri-plugin-dialog = "2"
tauri-plugin-drag = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

---

## 扩展系统详解

### 架构分层

```
┌─────────────────────────────────────────────┐
│  扩展 SDK (packages/extension-sdk)          │
│  ────────────────────────────────────       │
│  Theme.register()  Command.register()        │
│  Sidebar.register()  Preview.register()      │
│  Editor.register()  ContextMenu.register()   │
│  Extension 基类 (activate/deactivate)        │
│  hooks: useCurrentPath, useSelectedFiles     │
│  components: Button, Input, Panel, Card      │
└──────────────────┬──────────────────────────┘
                   │ window.__wisp_register__()
                   ▼
┌─────────────────────────────────────────────┐
│  扩展宿主 (apps/client/lib/extension-host)   │
│  ──────────────────────────────────────     │
│  单例: getExtensionHost()                    │
│  · 扩展实例 Map                              │
│  · Panel/Editor/Preview/Command 注册表        │
│  · 全局/工作区状态                            │
│  · 事件总线                                  │
│  · Bundle 缓存                               │
│  · 更新/热重载管理                           │
│                                              │
│  生命周期:                                    │
│  loadExtension() → activateExtension()       │
│  → deactivateExtension() → uninstallExtension│
└──────────────────┬──────────────────────────┘
                   │ Tauri IPC
                   ▼
┌─────────────────────────────────────────────┐
│  扩展管理 (apps/src-tauri/extensions/)       │
│  ──────────────────────────────────────     │
│  manager.rs                                  │
│  · 安装/卸载/启用/停用                        │
│  · 扫描 app data/extensions/                 │
│  · active_extensions.json 持久化              │
│                                              │
│  signing.rs                                  │
│  · 全目录 SHA-256 哈希                        │
│  · Ed25519 签名验证                           │
│  · 防篡改                                    │
│                                              │
│  wasm_runtime.rs                             │
│  · wasmi WASM 解释器                          │
│  · fuel 计量 (1M/调用)                        │
│  · 线性内存 64 MiB 上限                       │
│                                              │
│  host_functions.rs                           │
│  · WASM host 函数注册                         │
│  · 文件读写、HTTP、Git、存储                   │
└─────────────────────────────────────────────┘
```

### 扩展加载流程

```
应用启动
  │
  ├─ Rust: ExtensionManager::new()
  │   ├─ 创建 extensions/ 目录
  │   ├─ 读取 active_extensions.json
  │   └─ 扫描已安装扩展 (解析 package.json)
  │
  ├─ 前端: use-wisp-effects.ts:567
  │   ├─ 延迟 300ms
  │   └─ host.loadInstalledExtensions()
  │
  ├─ ExtensionHost.loadInstalledExtensions()
  │   ├─ 调用 Tauri API 获取 ExtensionPackage[]
  │   └─ 遍历每个包:
  │       ├─ loadExtension(pkg)
  │       │   ├─ 防重复加载检查
  │       │   ├─ 缓存 package.json 信息
  │       │   ├─ 读取 icon.svg
  │       │   ├─ 依赖检查
  │       │   ├─ 预注册 panel 占位符
  │       │   ├─ ★ 读取 dist/index.js (最大 5 MiB)
  │       │   ├─ ★ 路径穿越防护
  │       │   ├─ ★ 沙箱执行:
  │       │   │   ├─ 替换 window.__wisp_register__
  │       │   │   ├─ 白名单 require(): react, react-dom, @wisp/extension-sdk
  │       │   │   ├─ 注入沙箱环境 (Proxy 阻断 fetch/WebSocket/Storage/…)
  │       │   │   └─ new Function() + <script> blob URL 执行
  │       │   └─ 捕获注册对象 → 连接 render 方法
  │       │
  │       └─ if (pkg.is_active || manifest.onStartup):
  │           ├─ activateExtension(id)
  │           │   ├─ 权限检查 (危险权限触发 UI consent)
  │           │   ├─ 调用实例 activate()
  │           │   ├─ 主题提取 (CSS 变量)
  │           │   ├─ 注册 manifest keybindings
  │           │   ├─ 初始化 WASM backend
  │           │   └─ 持久化 active 状态
  │           └─ 发出 'extensionActivated' 事件
  │
  └─ 停用/卸载:
      ├─ deactivateExtension(): 调用 deactivate(), 注销快捷键
      └─ uninstallExtension(): 清理所有注册表, 删除目录
```

### 扩展点一览

| 扩展点 | 注册方式 | UI 消费位置 |
|---|---|---|
| **Panel** (右侧/左侧面板) | `manifest.contributes.panels[]` | `VerticalExtensionsBar.tsx:43`, `LeftSidebar.tsx:88` |
| **Bottom Tab** (底部面板) | SDK `BottomTab.register()` | `BottomPanel.tsx:103` |
| **Editor** (文件编辑器) | `manifest.contributes.editors[]` + SDK | `EditorGroupPane.tsx:561` |
| **Preview** (文件预览) | SDK `Preview.register()` | `PreviewPanel.tsx:48` |
| **Command** (命令面板) | SDK `Command.register()` | `use-wisp-effects.ts:875` |
| **Context Menu** (右键菜单) | SDK `ContextMenu.register()` | `context-menu-factory.ts:886` |
| **Theme** (主题) | SDK `Theme.register()` + CSS 注入 | `extension-host.ts:1121` |
| **Keybinding** (快捷键) | `manifest.contributes.keybindings[]` | `extension-host.ts:1166` → Tauri 全局快捷键 |
| **File Decorator** | SDK API | `extension-host.ts:1564` |
| **Dialog** | SDK API | `extension-host.ts:1369` |
| **Custom Tab** | SDK API | `extension-host.ts:1405` |
| **URL Scheme** | SDK API | `extension-host.ts:1470` |

---

## Marketplace 详解 (apps/web)

### 技术栈

| 技术 | 用途 |
|---|---|
| Next.js 15 | 全栈 Web 框架 |
| Prisma | ORM (PostgreSQL) |
| NextAuth.js | 用户认证 (GitHub OAuth + Email) |
| Stripe | 支付 (订阅 + 一次性购买) |
| Vercel Blob | 扩展 ZIP 文件存储 |
| TailwindCSS 3 | 样式 |

### 数据模型 (`prisma/schema.prisma`)

```
User ───────────── 用户
  ├─ Account (NextAuth 关联)
  ├─ Session (会话)
  ├─ Extension (发布的扩展)
  │    ├─ Review (评论)
  │    ├─ Download (下载记录)
  │    ├─ Like (收藏)
  │    └─ Version (版本历史)
  ├─ Purchase (购买记录)
  ├─ Bookmark (书签同步)
  └─ Tag (标签同步)

Extension
  ├─ id, name, slug, description
  ├─ category, status (draft/published/reviewed)
  ├─ pricingType (free/paid/subscription)
  ├─ downloadsCount, rating
  ├─ author ↔ User
  ├─ versions → Version[]
  └─ reviews → Review[]

Purchase
  ├─ userId, extensionId
  ├─ stripeSessionId, stripeSubscriptionId
  └─ status, tier (monthly/yearly/lifetime)
```

### 支付系统

**是的，扩展市场支持付费扩展。**

Stripe 集成提供：
- **免费扩展**: 直接下载
- **付费扩展**: Stripe Checkout 一次性购买
- **订阅扩展**: Stripe 按月/年订阅
- **捐赠**: 用户可向扩展作者捐赠

相关文件：
- `apps/web/src/lib/stripe.ts` — Stripe 客户端配置
- `apps/web/src/app/api/billing/checkout/` — 支付结账 API
- `apps/web/src/app/api/billing/status/` — 购买状态查询
- `apps/web/src/app/api/webhooks/stripe/` — Stripe Webhook 处理
- `apps/web/prisma/schema.prisma` — Purchase, SubscriptionTier, PricingType

**注意**: 这是扩展市场的支付系统，让扩展作者可以对自己的扩展收费 (类似 VS Code Marketplace)。Wisp 本身是开源免费的 (AGPL-3.0)。

---

## 公共包详解 (packages)

### SDK (`packages/sdk`) — 内部 IPC 服务层

```
src/
├── index.ts            # 重导出所有服务 + 类型
├── transport.ts        # ★ 传输抽象: Tauri invoke vs HTTP fetch, isTauri()
└── services/           # 24 个领域服务模块
    ├── file-system.ts  # 文件 CRUD, 目录, 属性, 元数据, 回收站, 加密
    ├── search.ts       # 搜索, 分词, 自然语言搜索
    ├── ai.ts           # AI 聊天, 文件分析, 智能建议, 自动标签
    ├── agent.ts        # AI Agent 操作
    ├── chat.ts         # 聊天操作
    ├── git.ts          # Git 状态, 历史, blame, diff, staging
    ├── extensions.ts   # 扩展安装/卸载, 权限, 市场代理
    ├── shortcuts.ts    # 快捷键 CRUD
    ├── storage.ts      # 书签, 标签, 笔记, 最近文件 (SQLite)
    ├── sync.ts         # 云端同步
    └── …               # duplicates, comparison, compression, organizer, ...
```

### Extension SDK (`packages/extension-sdk`) — 第三方扩展 API

```
src/
├── index.ts            # ★ 对外导出: Theme, Sidebar, Command, Preview, Editor, BottomTab,
│                       #   hooks, components, Extension 基类, 类型
├── api/index.ts (747行) # 高层注册 API (Theme.register(), Sidebar.register(), ...)
│                       #   每个 register() 内部调用 window.__wisp_register__()
├── core/
│   ├── Extension.ts    # 基类: abstract activate/deactivate, _setContext() 注入
│   ├── ActionExtension.ts  # 动作扩展基类 (context menu + command)
│   ├── PanelExtension.ts   # 面板扩展基类
│   ├── PreviewExtension.ts # 预览扩展基类
│   └── ThemeExtension.ts   # 主题扩展基类 (CSS 变量注入 + 安全校验)
├── hooks/              # useCurrentPath, useSelectedFiles, navigateTo
├── components/         # 预制 UI (Button, Input, Select, Toggle, Spinner, Panel, Card)
├── types/              # ExtensionManifest, ExtensionContext, FileEntry, WispAPI
└── utils/              # createExtension, registerExtension
```

### 内置扩展 (`packages/extensions/`) — 25 个

**主题 (5):**
- `cyberpunk-theme` — 霓虹赛博朋克配色
- `dracula-theme` — Dracula 暗色主题
- `nord-theme` — Nord 北极蓝配色
- `ocean-deep-theme` — 深蓝海洋主题
- `tokyo-night-theme` — Tokyo Night 风格

**文件工具 (7):**
- `batch-image` — 批量图片处理 (缩放/转换/压缩)
- `code-editor-extension` — 内置代码编辑器 (语法高亮)
- `file-hasher` — 文件校验 (MD5, SHA-256, …)
- `folder-stats` — 文件夹大小统计
- `image-editor` — 基础图片编辑 (裁剪/旋转/滤镜)
- `json-formatter` — JSON 格式化/验证
- `word-counter` — 字数统计

**集成 (7):**
- `claude-code` — Claude Code 集成
- `docker` — Docker 容器/镜像管理
- `gdrive` — Google Drive 文件浏览/同步
- `git-extension` — 全功能 Git UI
- `ssh` — SSH 远程文件浏览
- `collaboration` — 实时协作 (实验性)
- `architect` — 项目架构可视化

**效率 (6):**
- `3d-viewer` — 3D 模型查看器 (GLB, OBJ, STL)
- `backup` — 文件备份/恢复
- `ide-mode` — IDE 风格工作区 (分屏编辑器)
- `problems-panel` — 代码问题/诊断面板
- `software-finder` — 已安装应用发现
- `sqlite-browser` — SQLite 数据库浏览器

---

## 核心调用链路

### 1. 用户点击文件 → 预览

```
FileGrid.tsx (click)
  → use-file-operations.ts
  → tauri-api/file-system.ts
  → IPC invoke("get_file_info")
  → Rust operations/file_ops
  → 返回 FileEntry
  → extension-registry.ts:445 (findBestPreviewProvider)
    → 遍历已注册的 preview providers
    → 按 canPreview(file) + priority 排序
  → PreviewPanel.tsx:48 (渲染最佳匹配)
```

### 2. AI 聊天 → 发送消息 → 流式响应

```
ChatInput.tsx (submit)
  → use-chat.ts
  → ai-service.ts
  → tauri-api/ai.ts
  → IPC invoke("chat_with_ai")
  → Rust ai.rs (56KB)
    → 构造 prompt + 文件上下文
    → HTTP 调用 AI Provider (OpenAI/Anthropic/Google/DeepSeek/Ollama)
    → Tauri event emit "ai-stream-chunk"
  → use-chat.ts (listen event)
  → ChatMessage.tsx (render 增量更新)
```

### 3. Agent 工具执行

```
AgentManagerPanel.tsx (create agent)
  → agent-service.ts
  → tauri-api/agent-sessions.ts
  → IPC invoke("create_agent_session")
  → Rust agent/mod.rs
    → planner.rs: 规划任务步骤
    → tool_executor.rs: 执行每个步骤
      ├─ 文件操作 → operations/
      ├─ Git → git/
      ├─ Shell → pty.rs
      └─ AI → ai.rs
    → security.rs: 权限检查
    → streaming.rs: 流式输出进度
    → memory.rs: 保存上下文
  → 前端通过 event 接收进度
```

### 4. 扩展安装 → 激活 → 快捷键注册

```
MarketplacePanel.tsx (install)
  → tauri-api/extensions.ts
  → IPC invoke("install_extension")
  → Rust extensions/commands/install.rs
    → 下载 .xtension (50 MiB 限制, HTTPS 校验, SSRF 防护)
    → 安全解压 (symlink escape 防护)
    → 解析 manifest
    → 权限验证
    → 签名验证 (Ed25519)
    → 复制到 app data/extensions/

  → 前端: host.loadExtension() → host.activateExtension()
    → extension-host.ts:1023 (权限检查)
    → extension-host.ts:1108 (调用 activate())
    → extension-host.ts:1166 (注册 shortcuts)
      → tauri-api/system.ts: registerExtensionShortcut()
      → IPC invoke("register_extension_shortcut")
      → Rust shortcuts/manager.rs:690
```

### 5. 全局快捷键 (当前状态)

```
extension-host.ts:1166
  → kb.when 默认 ['file-explorer']  (仅应用内)
  → registerExtensionShortcut 中 global: false 硬编码
  → shortcuts/manager.rs:722: global: false

全局快捷键基础设施存在但未对扩展开放:
  · tauri-plugin-global-shortcut 已引入
  · ShortcutBinding.global 字段已定义
  · 前端 global_shortcut_triggered 事件监听已写
  · register_global_shortcuts() 是空函数 (return Ok(()))
```

---

## 模块规模统计

| 层级 | 文件数 | 代码量估算 |
|---|---|---|
| 前端 `apps/client` | ~300 | ~150KB+ TypeScript/TSX |
| 后端 `apps/src-tauri` | ~120 | ~500KB+ Rust |
| 市场 `apps/web` | ~100 | ~80KB+ TypeScript/TSX |
| SDK `packages/sdk` | ~25 | ~30KB TypeScript |
| Extension SDK | ~19 | ~20KB TypeScript |
| 内置扩展 | 25 包 | ~50KB TypeScript/TSX |
| 脚本 | 5 | ~10KB JavaScript |
| **总计** | **~700 源文件** | **~800KB+ 源代码** |

| Tauri 命令 | 280+ |
|---|---|
| 扩展点 | 12 种 |
| 内置扩展 | 25 个 |
| Rust 模块 | 26 个 |
| React Hooks | 53 个 |
| React 组件 | 200+ |
