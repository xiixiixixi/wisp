# Changelog

## v0.99.43 (2026-10-17)

### ChatGPT（对话助手）连接器

- 将“连接对话助手”统一命名为“ChatGPT 连接器”，同步菜单入口、侧栏标题、启停提示与其他语言名称。
- 更新首页介绍和使用步骤，重拍连接器的真实界面配图，明确连接网页助手与选定的本地文件夹。
- 保留现有连接配置与只读访问方式，更新后可继续使用已有连接。

## v0.99.40 (2026-10-02)

### 对话助手连接
- 安装包内置官方连接程序和配套程序，无需终端安装或填写程序位置。
- 连接页面按文件夹、连接信息和网页助手分步配置，补充插件表单选项说明。
- 支持助手发现已授权文件夹；两台电脑同时连接时使用不同连接编号。
- 保持只读授权，版本更新不主动重建连接编号或清除用户设置。

### 内置助手与界面
- Pi（内置智能助手引擎）升级至 0.99.2，适配会话保存和云记忆注入。
- 移除外部助手配置，兼容旧面板布局并保留其他设置。
- 常用窄分栏保持单行工具栏，次要操作收进“更多”，左右栏独立适配。
- 美化磁盘推出和移除收藏按钮，扩大点击区域，补充处理中状态及重复点击防护。

### 发布
- 隧道程序按目标架构和固定校验值准备，保留上游许可与依赖说明。
- 云端只生成构建检查产物，不覆盖本机签名的正式安装包与自动更新索引。

## v2.0.0 (Unreleased)

Complete ground-up rewrite of Wisp.

### Architecture
- Migrated from Tauri 1.x to **Tauri 2**
- Frontend rewritten from scratch with **React 18** + TypeScript + Vite
- Backend rewritten in **Rust** with async Tokio runtime
- Monorepo structure: `apps/client` (frontend), `apps/src-tauri` (backend), `packages/` (SDK, extensions)
- pnpm workspaces replacing yarn

### New Features
- **Extension system** with marketplace, SDK, and CLI scaffolding tool
- **AI chat and agent** — Claude and Ollama integration for file analysis and autonomous file operations
- **Git integration** — branch management, staging, commits, diffs, blame, stash, commit history
- **SSH remote access** — connection management, remote file browsing via SFTP, SSH terminal
- **Search and indexing** — background tokenizer, fuzzy/semantic/natural language search
- **Duplicate finder** — SHA-256 content hashing with parallel scanning
- **File organizer** — AI-powered directory analysis and reorganization suggestions
- **Storage analytics** — disk space breakdown, type distribution, size categories
- **Hardware-accelerated file operations** — memory-mapped I/O, SIMD-optimized paths, parallel transfers
- **Archive support** — ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ with password protection
- **File comparison** — side-by-side diff view with SHA-256 hash verification
- **File tags and colors** — custom tag system with per-file color categorization
- **Advanced selection** — filter by extension, size, date, glob/regex patterns
- **Bookmarks** — persistent path bookmarks with custom names
- **Bulk rename** — regex pattern-based renaming with live preview
- **Recycle bin management** — browse, restore, permanently delete

### UI Improvements
- **Multiple view modes** — Grid, List, Details, Column, Gallery, Tree
- **Split pane** — side-by-side directory browsing
- **Bottom panel system** — Terminal, Activity Log, Clipboard, Notifications, Changes
- **Right sidebar** — Preview, Properties, Extensions panels
- **Command palette** — quick access to all commands
- **6 built-in themes** — Tokyo Night, Dracula, Nord, Cyberpunk, Ocean Deep, Catppuccin
- **Integrated terminal** — with SSH terminal support
- **Vim mode** — keyboard navigation for power users

### Developer Experience
- **Extension SDK** (`@wisp/extension-sdk`) — public API for building extensions
- **Create Extension CLI** (`@wisp/create-extension`) — scaffold new extensions
- **IIFE extension format** — sandboxed execution with require() shim
- **28 free extensions** included (themes, tools, previews)
- **CI/CD** — GitHub Actions for lint, test, build across Windows/macOS/Linux

### Security
- Tauri IPC boundary for all file operations
- Extension sandbox with Proxy-based global blocking
- CSRF protection on API routes
- Extension permission model
- No telemetry or data collection

### Open Source
- Fully open source under **AGPL-3.0** — desktop app, Extension SDK, and web marketplace (`apps/web/`)
- Extensions are distributed through a separate public repository
