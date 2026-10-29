<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme-hero-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/media/readme-hero-light.svg" />
  <img src="docs/media/readme-hero-light.svg" alt="Repeaty — Create. Repeat. Internalize." width="100%" />
</picture>

<p align="center">
  <a href="https://github.com/KraHsu/repeaty/releases">下载客户端</a> ·
  <a href="https://www.krahsu.top/repeaty/">在线体验</a> ·
  <a href="docs/USAGE.md">使用指南</a> ·
  <a href="docs/PLUGINS.md">编写插件</a>
</p>

<p align="center">
  <a href="https://github.com/KraHsu/repeaty/actions/workflows/ci.yml"><img src="https://github.com/KraHsu/repeaty/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-37634b" alt="MIT License" /></a>
</p>

Repeaty 是一个开源的记忆卡片工具。把想记住的内容做成卡片，按 FSRS 安排复习。

以桌面客户端为主，一个文件夹保存卡片、材料、附件与学习进度，无需注册。在线版无需后端，提供制卡、复习、阅读等体验。核心免费开源，目前没有订阅或收费服务。

![Repeaty 的入门卡组与学习概览](docs/media/workspace.png)

## 开始使用

本分支的桌面工作目录接管尚未发布，使用 `npm run desktop:dev` 启动后，在「工作目录」中选择空文件夹创建学习库。入门卡组会自动添加，包含 24 条笔记、27 张卡片，介绍 FSRS、评分、挖空、公式、图片和音频。支持 English / 中文（简体）。

[Releases](https://github.com/KraHsu/repeaty/releases) 提供已发布安装包，目前仍使用此前的存储方式；也可打开 [在线体验](https://www.krahsu.top/repeaty/)。

已有自己的材料？创建卡组并添加卡片，或从 Anki `.apkg`、CSV / TSV 导入。复习时先回答，再翻面，按实际表现选择「重来 / 困难 / 良好 / 简单」。

在线版由 GitHub Pages 托管，数据只保存在当前浏览器。换浏览器或清理网站数据前，请在「数据与备份」中导出 `.repeaty` 文件。

本分支的在线版还支持只读打开桌面工作目录：先在桌面版中关闭学习库，再到「工作目录」选择整个文件夹。网页会读取卡片、材料、附件和已有进度，在独立副本中试用，不上传或写回原目录。试用修改只保留在当前页面，需要保留时导出 `.repeaty`；返回后，原有浏览器学习库仍在。[能力与读取范围](docs/WORKSPACE_MODE.md#无后端在线工作目录)。

## 功能

- **制卡**：正反面、双向、挖空；Markdown、带样式的 HTML、按语言高亮的代码块、数学公式、图片和音频。正文左对齐，图片、独立公式和表格默认居中。
- **复习**：FSRS 调度，按卡组设置目标记忆保留率和每日学习量；查看新卡、学习中和待复习数量。支持暂停、暂缓、顽固卡标记，以及复习中添加、编辑和删除笔记。按 `Ctrl / ⌘ + Z` 撤销最近操作，按 `?` 查看快捷键。
- **整理与练习**：标签、组合搜索、常用筛选、批量编辑；专项练习可选择是否更新复习进度。
- **阅读与摘录**：在文本 / Markdown 工作区中直接选文摘录、制卡和批注；支持目录整理、正文编辑与草稿、历史版本、YAML 属性、Wiki 链接和全文检索。记住阅读位置，可按理解反馈安排下次阅读，在混合学习中穿插卡片复习。[使用说明](docs/SOURCES.md)。
- **数据导入导出**：Anki `.apkg` 导入问答、双向和挖空卡及媒体，先预览，已有笔记可逐条比较和更新并保留进度；支持 CSV / TSV，`.repeaty` 备份包含附件和学习进度；工作目录可整体复制。
- **插件**：运行时安装、更新、关闭、移除与重新加载，无需重编译主程序。官方答题历史和桌面 LeetCode 也以独立插件包提供。代码和设置随桌面工作目录保存，登录凭据与代码信任留在设备；复制来的未知代码需主动确认启用。关闭或移除插件保留学习进度与完整历史。
- **MCP**：桌面版支持连接 Codex、Claude Code 和 Claude Desktop，查询学习库；主动分享摘录后，可接收制卡草稿，保存未完成的编辑，重启后继续确认。[连接说明](docs/MCP.md)。

不使用 MCP 时，可从「设置 → 工具 → AI 制卡」复制说明或下载 [制卡 skill](public/skills/repeaty-cards/SKILL.md)，将材料交给 AI 生成 CSV，再在 Repeaty 中预览并导入。通用设置也可分别配置各级通知是否弹出。

目前不支持 Anki 进度迁移、自定义字段 / Anki 卡片模板、图片遮挡或个人 FSRS 参数训练。[Anki 导入范围](docs/ANKI.md) · [完整用法](docs/USAGE.md) · [存储与性能](docs/DEVELOPMENT.md#大数据量存储)

## 运行与构建

|                  | 桌面客户端                        | 无后端在线版                             |
| ---------------- | --------------------------------- | ---------------------------------------- |
| 日常学习库       | 工作目录，Markdown、附件与 SQLite | 当前浏览器 IndexedDB                     |
| 打开本地工作目录 | 直接读写，保留学习进度            | 只读，试用操作在当前页面的独立副本中进行 |
| 制卡、复习、阅读 | 支持                              | 支持                                     |
| 外部编辑与检测   | 检查并确认接受                    | 展示已接受版本，文件更新使用桌面版       |
| 插件             | 安装外置前端与本地插件            | 安装外置前端插件，保存在浏览器副本中     |
| LeetCode         | 题目与判题，凭据留在本机          | 可读取已有代码和判题记录，不提供联网判题 |
| 离线             | 支持                              | 页面缓存后支持，包括只读打开本地目录     |

需要 Node.js 24.15+（24.x）；桌面构建另需 Rust、C 编译工具及 Tauri 系统依赖。CI 使用 Rust 1.97.1。

```bash
git clone https://github.com/KraHsu/repeaty.git
cd repeaty
npm ci
```

**在线版**：构建后将 `dist/` 上传到静态托管，无需后端。目录读取使用浏览器接口与 SQLite WASM。

```bash
npm run build
# 部署在子路径时，例如 /repeaty/：
VITE_BASE_PATH=/repeaty/ npm run build
```

**桌面客户端**：安装 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)后运行或构建。

```bash
npm run desktop:dev
npm run desktop:build
```

客户端直接打开本地学习目录，保存 Markdown 正文、附件及 SQLite 学习状态，不配置上游 endpoint。复制或备份前关闭学习库，并复制整个目录。可从外部新建、修改和改名笔记，经检查确认后进入学习库。移除的笔记与题目变体保留记录，恢复后沿用原有进度。

[桌面使用与开发](docs/DESKTOP.md) · [目录格式与当前边界](docs/WORKSPACE_MODE.md) · [LeetCode 配置](docs/LEETCODE.md)

## 开发与贡献

新版本合并到 `main` 后，核心检查与三平台构建全部通过才会自动发布 Release，附安装包和 SHA256 校验文件；同版本的后续提交不覆盖已发布产物。[发布流程](docs/RELEASING.md)

正在准备 v1.0.0。用户另行授权的 0.27.0 范围是内容渲染、内嵌 HTML、撤销与快捷键、弹窗和复习菜单；完成后继续冻结其他新功能，仅处理发布准备和修复。[发布清单](docs/RELEASE_1_0.md)

本轮另行授权了外置插件机制：官方插件与第三方插件独立构建、分发和安装，运行在 WebView 的 JavaScript 环境，通过公开 SDK 使用宿主能力。主程序构建只携带固定的预构建插件包，不编译插件源码；其余新功能继续冻结。

本轮将桌面学习存储接入[工作目录](docs/WORKSPACE_MODE.md)，取消桌面本地 / 上游分支。项目暂无其他使用者，因此直接采用新格式，不开发旧库过渡或自动迁移，也不删除旧数据。已支持外部笔记新建、移除、恢复和变体退役，以及材料版本和 Markdown 相对路径图片、音频。旧摘录保留原文和附件快照。外部修改会自动检测并提示，确认后用于学习。在线版已接入本地目录的只读试用，同步仍未完成。

界面使用 Vue 3、TypeScript、Pinia 和 Vite；原生存储使用 Rust 与 SQLite；调度使用 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)。页面、应用服务和共享状态的分工见[前端结构](docs/FRONTEND_ARCHITECTURE.md)。

```bash
npm run desktop:dev
npm test
npm run typecheck
npm run test:workspace:native    # 共享仓库与真实 Rust 存储联测
npm run test:e2e:desktop         # 界面回归，连接真实 Rust 存储
```

欢迎提交 Issue 和 PR。报告问题时，请附上复现步骤、浏览器版本和报错；修改功能时，一并更新相关测试和文档。

[开发文档](docs/DEVELOPMENT.md)介绍代码结构、测试与性能基准。[插件文档](docs/PLUGINS.md)说明运行时安装、独立 SDK、插件项目与分发包。PR 通过检查后合并；`main` 自动部署纯前端版到 GitHub Pages。

## License

[MIT](LICENSE) © 2026 CharlesHsu
