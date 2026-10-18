<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme-hero-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/media/readme-hero-light.svg" />
  <img src="docs/media/readme-hero-light.svg" alt="Repeaty — Create. Repeat. Internalize." width="100%" />
</picture>

<p align="center">
  <a href="https://www.krahsu.top/repeaty/">在线体验</a> ·
  <a href="docs/USAGE.md">使用指南</a> ·
  <a href="docs/SELF_HOSTING.md">自行部署</a> ·
  <a href="docs/PLUGINS.md">编写插件</a>
</p>

<p align="center">
  <a href="https://github.com/KraHsu/repeaty/actions/workflows/ci.yml"><img src="https://github.com/KraHsu/repeaty/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-37634b" alt="MIT License" /></a>
</p>

Repeaty 是一个开源的网页记忆卡片工具。把想记住的内容做成卡片，按 FSRS 安排复习。

无需注册，也没有订阅或付费功能。可以直接在浏览器里离线使用，也可以部署 Rust + SQLite 后端。

![Repeaty 的入门卡组与学习概览](docs/media/workspace.png)

## 开始使用

打开 **[Repeaty 在线版](https://www.krahsu.top/repeaty/)**，点击「开始复习」即可。默认的入门卡组有 24 条笔记、27 张卡片，一边介绍 FSRS，一边带你试用评分、挖空、公式、图片和音频。支持 English / 中文（简体）。

已有自己的材料？创建卡组并添加卡片，或从 CSV / TSV 导入。复习时先回答，再翻面，按实际表现选择「重来 / 困难 / 良好 / 简单」。

在线版由 GitHub Pages 托管，数据只保存在当前浏览器。换浏览器或清理网站数据前，请在「数据与备份」中导出 `.repeaty` 文件。

## 功能

- **制卡**：正反面、双向、挖空；Markdown、代码块、数学公式、图片和音频。
- **复习**：FSRS 调度，按卡组设置目标记忆保留率和每日学习量；支持撤销评分、暂停、暂缓与顽固卡标记。
- **整理与练习**：标签、组合搜索、常用筛选、批量编辑；专项练习可选择是否更新复习进度。
- **数据导入导出**：CSV / TSV 导入笔记，`.repeaty` 备份包含附件和进度，两种部署版本之间可以迁移。
- **插件**：部署时安装，使用时开关。支持纯前端插件；后端版内置 LeetCode 题目与判题插件。

目前不支持 Anki `.apkg` 导入、自定义字段 / HTML 模板、图片遮挡或个人 FSRS 参数训练。[完整用法](docs/USAGE.md) · [存储与性能](docs/DEVELOPMENT.md#大数据量存储)

## 自行部署

|          | 纯前端版              | 带后端版                   |
| -------- | --------------------- | -------------------------- |
| 存储     | 浏览器 IndexedDB      | 服务端 SQLite              |
| 部署产物 | `dist/`，任意静态托管 | Rust 程序 + `dist-server/` |
| 离线使用 | 支持，含已保存的附件  | 需要连接服务               |
| 插件     | 纯前端插件            | 纯前端及后端插件           |
| LeetCode | 不包含                | 内置，需配置连接           |

两版都没有账号系统。一个后端服务对应一个学习库，公开部署时使用访问密钥保护。

需要 Node.js 24.12+（24.x）；后端另需 Rust 与 C 编译工具。CI 使用 Rust 1.97.1。

```bash
git clone https://github.com/KraHsu/repeaty.git
cd repeaty
npm ci
```

**纯前端版**：构建后将 `dist/` 上传到静态托管。

```bash
npm run build
# 部署在子路径时，例如 /repeaty/：
VITE_BASE_PATH=/repeaty/ npm run build
```

**带后端版**：默认在 `http://127.0.0.1:8080` 提供服务，数据写入 `data/repeaty.sqlite3`。

```bash
npm run build:server
cargo run --release --locked --manifest-path server/Cargo.toml
```

公网部署、反向代理、访问密钥与数据库备份见[部署指南](docs/SELF_HOSTING.md)。LeetCode 默认连接中国站，可切换国际站；判题需要配置 LeetCode 登录信息，见[LeetCode 文档](docs/LEETCODE.md)。

## 开发与贡献

前端使用 Vue 3、TypeScript 和 Vite；后端使用 Rust、Axum 和 SQLite，调度使用 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)。

```bash
npm run dev                      # http://127.0.0.1:5173
npx playwright install chromium  # 首次运行浏览器测试前安装
npm run check                    # 格式、单元测试、构建、浏览器测试
npm run check:server             # Rust 与后端版检查
```

欢迎提交 Issue 和 PR。报告问题时，请附上复现步骤、浏览器版本和报错；修改功能时，一并更新相关测试和文档。

[开发文档](docs/DEVELOPMENT.md)介绍代码结构、测试与性能基准。[插件文档](docs/PLUGINS.md)包含显示题目、显示答案接口和插件示例。PR 通过检查后合并；`main` 自动部署纯前端版到 GitHub Pages。

## License

[MIT](LICENSE) © 2026 CharlesHsu
