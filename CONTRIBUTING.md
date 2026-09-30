# 参与 Wisp 开发

问题修复、功能建议和代码贡献均通过[当前仓库](https://github.com/xiixiixixi/wisp)提交。

## 准备开发环境

- Node.js（脚本运行环境）22.19 或以上、pnpm（包管理工具）10 或以上及 Git（版本管理工具）。
- Rust（系统编程语言）由仓库中的 [rust-toolchain.toml](rust-toolchain.toml) 固定版本，通过 rustup（工具链管理工具）安装。
- Tauri（桌面应用框架）2 所需的系统依赖，见[官方环境准备文档](https://v2.tauri.app/start/prerequisites/)。

当前发行包面向 macOS（苹果桌面系统）。该系统需要 Xcode Command Line Tools（苹果命令行开发工具），可运行 `xcode-select --install` 安装。

开发其他平台时还需准备相应系统库。原有 Linux（开放源代码操作系统）环境依赖示例如下，请同时核对官方环境准备文档。

**Ubuntu / Debian（Linux 发行版）**：

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev
```

**Fedora（Linux 发行版）**：

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel libsoup3-devel libappindicator-gtk3-devel librsvg2-devel
```

**Arch（Linux 发行版）**：

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libsoup3 libappindicator-gtk3 librsvg
```

## 启动桌面开发

```bash
git clone https://github.com/xiixiixixi/wisp.git
cd wisp
pnpm install --frozen-lockfile
node scripts/sync-pdf-worker.mjs
pnpm dev:app
```

同步脚本对齐 PDF（便携文档格式）解析文件；`pnpm dev:app` 同时启动 Vite（界面开发服务）与桌面窗口，修改界面代码后自动刷新。

## 目录用途

- `apps/client/`：桌面界面、页面与共享组件。
- `apps/src-tauri/`：本机文件操作、系统集成、搜索与代理能力。
- `packages/sdk/`：界面调用本机能力的内部接口。
- `packages/extension-sdk/`：供扩展开发使用的接口。
- `packages/create-extension/`：创建扩展项目的命令行工具。
- `packages/extensions/`：随仓库维护的扩展源码。
- `apps/web/`：独立网页与扩展市场服务。
- `infra/`：本地数据库服务配置。
- `scripts/`：构建、签名、发布与维护工具。

## 检查改动

先检查类型和代码规范，再运行与改动有关的测试。以下测试文件与筛选词只是示例，请替换为本次涉及的功能。

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm exec vitest run apps/client/src/__tests__/lib/preview-factory.test.ts
cargo test --manifest-path apps/src-tauri/Cargo.toml compression
```

Vitest（界面测试工具）用于界面与逻辑测试。文件操作、系统预览、连接和终端还需要在桌面窗口中检查实际结果。默认按影响范围验证，不要求每次运行整个测试库。

## 开发扩展

```bash
# 创建扩展项目
node packages/create-extension/bin/index.js my-extension
# 构建仓库内的扩展，或监听后续改动
pnpm extensions:build
pnpm extensions:dev
```

扩展接口和权限说明见 [packages/extension-sdk/README.md](packages/extension-sdk/README.md)。扩展代码随当前仓库提供，无需初始化子模块。

## 启动网页与市场服务

市场开发需要 PostgreSQL（关系数据库），使用 Docker Compose（容器服务编排工具）启动本地数据库：

```bash
# 启动数据库
docker compose -f infra/docker-compose.yml up -d

# 复制环境变量示例，填写数据库与服务配置
cp apps/web/.env.example apps/web/.env

# 进入市场目录，更新数据库结构并启动服务
cd apps/web
pnpm exec prisma migrate dev
pnpm dev
```

根目录的 `pnpm dev` 会同时启动桌面界面、本机程序和市场服务；仅开发桌面功能时使用 `pnpm dev:app`。环境变量里的私人资料和密钥不要提交到仓库。

## 提交与反馈

- 改动围绕一个问题或功能，说明原有行为、改后行为和修改原因。
- 沿用现有代码与组件约定；有新增界面文字时补齐中文和英文。
- 附复现步骤、验证方法与结果；提交示例文件和日志前移除私人资料。
- 提交 Pull Request（合并请求）时，说明尚未验证的部分。

问题与功能建议均在 [GitHub Issues（问题反馈）](https://github.com/xiixiixixi/wisp/issues) 提交。安全问题请按 [SECURITY.md](SECURITY.md) 联系维护者，公开内容不要包含漏洞细节。
