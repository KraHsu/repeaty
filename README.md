<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme-hero-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/media/readme-hero-light.svg" />
  <img src="docs/media/readme-hero-light.svg" alt="Repeaty：制卡、回想与间隔复习" width="100%" />
</picture>

<div align="center">

# 卡片与间隔复习

[在线使用](https://krahsu.github.io/repeaty/) · [使用指南](docs/USAGE.md) · [开发文档](docs/DEVELOPMENT.md)

[![MIT License](https://img.shields.io/badge/license-MIT-37634b?style=flat-square)](LICENSE) [![Build checks](https://github.com/KraHsu/repeaty/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/KraHsu/repeaty/actions/workflows/ci.yml)

</div>

Repeaty 是一个在浏览器里使用的间隔复习工具，专注 Anki 式制卡与学习。

把单词、概念或自己的笔记做成卡片，按 FSRS 安排每天的复习。支持正反面、双向和挖空卡片，也可以加入图片、音频、Markdown 和数学公式。界面可随时切换 English / 中文（简体）。

无需注册。纯前端版将学习数据保存在浏览器，可离线使用；带后端版由 Rust 提供服务，学习数据和附件保存在 SQLite。两版使用相同的卡片、调度和备份格式。

## 使用

| 版本     | 数据存储         | 插件                                  | 使用方式                                                                        |
| -------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| 纯前端版 | 浏览器 IndexedDB | 纯前端插件                            | [在线使用](https://krahsu.github.io/repeaty/)；也可部署 `dist/`，支持离线 / PWA |
| 带后端版 | Rust + SQLite    | 纯前端插件及带后端插件，内置 LeetCode | [自行部署](docs/SELF_HOSTING.md)，需连接服务                                    |

首次打开是空白空间。可以加载入门示例，或先建一个卡组，再添加自己的卡片。复习时先回想答案，翻面后选择「重来 / 困难 / 良好 / 简单」，Repeaty 会安排下次复习时间。每个卡组可以调整每日学习量和目标记忆保留率，误评分也可以撤销。

已有笔记可从 CSV / TSV 批量导入。需要集中练习时，可以按标签、题型、到期时间等条件搜索，保存常用筛选，再选择只练习或更新复习进度。具体操作见[使用指南](docs/USAGE.md)。

插件由部署者安装，用户在「插件」中开启或关闭；关闭后题目和进度保留。纯前端插件只需提供显示题目、显示答案两个组件，也可添加制题表单。[插件接口与示例](docs/PLUGINS.md)

带后端版内置 LeetCode：读取题目、编写代码、提交正式判题，支持手动评分和按尝试次数、用时自动评分。默认中国站，也可选择国际站。连接由 Rust 服务处理，无需浏览器扩展；需由部署者配置 LeetCode 登录信息。[配置与使用](docs/LEETCODE.md)

在线版由 GitHub Pages 托管，部署纯前端版，不包含 LeetCode 插件；上面的链接会跳转到账号已有的自定义域名 `www.krahsu.top/repeaty/`。

## 当前进度

当前源码为 **0.6.0**。已实现两种部署版本、前端 / 后端题目插件接口、SQLite 存储、内置 LeetCode 插件、FSRS 调度、三种基础笔记类型、多媒体制卡、批量管理、专项练习、双语界面和离线 PWA。浏览器回归测试覆盖制卡与复习、断网重载、移动端布局，以及合计 128 MiB 的图片 / 音频和接近 10000 字长文本的备份往返。

两版都按记录分表保存，媒体独立保存为 Blob / BLOB，评分只提交变化的记录。默认导出 `.repeaty` 备份包，也兼容旧版 JSON；两版之间可通过备份手动迁移。自动快照可恢复最近的修改，但不能替代独立备份。纯前端版清除网站数据会删除学习库；后端版需要保留服务器上的 SQLite 数据文件。[数据与备份](docs/USAGE.md#图片音频与备份)

后端版仍是个人学习工具，一个服务对应一个学习库，不提供账号、云同步、订阅或支付。

已提供 1 万张卡片、10 万条复习记录的浏览器性能基准；启动时仍会将结构化学习数据读入内存，大卡库的体验取决于设备。当前还不支持 Anki `.apkg` 导入、自定义字段 / HTML 模板、所见即所得编辑、图片遮挡、嵌套挖空或 FSRS 参数训练。[存储与性能边界](docs/DEVELOPMENT.md#大数据量存储)

## 开发

前端使用 Vue 3 + TypeScript + Vite，需要 Node.js 24.12+（24.x）。后端使用 Rust + Axum + SQLite，CI 使用 Rust 1.97.1。

```bash
nvm use
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。生产构建使用 `npm run build`，完整检查使用 `npm run check`；首次运行浏览器测试先执行 `npx playwright install chromium`。带后端版使用 `npm run build:server` 构建网页，`cargo run --manifest-path server/Cargo.toml` 启动服务；对应检查为 `npm run check:server`。其余命令、项目结构和性能基准见[开发文档](docs/DEVELOPMENT.md)。

PR 会自动执行格式、单元、类型、构建和浏览器检查。合并到 `main` 并通过检查后，自动将纯前端版部署到 GitHub Pages，后端产物不上传。`main` 要求通过 PR 合并并通过检查，禁止强推和删除。[CI 与分支保护](docs/DEVELOPMENT.md#ci-与-github-pages)

遇到问题可以提 [Issue](https://github.com/KraHsu/repeaty/issues)，写明浏览器、操作步骤和报错即可。也欢迎直接提 PR。

[MIT](LICENSE) © 2026 CharlesHsu。第三方依赖保留各自的许可证。
