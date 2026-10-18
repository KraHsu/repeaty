<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/readme-hero-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/media/readme-hero-light.svg" />
  <img src="docs/media/readme-hero-light.svg" alt="Repeaty：制卡、回想与间隔复习" width="100%" />
</picture>

<div align="center">

# 每一次回想，都算数。

[在线使用](https://krahsu.github.io/repeaty/) · [使用指南](docs/USAGE.md) · [开发文档](docs/DEVELOPMENT.md)

[![MIT License](https://img.shields.io/badge/license-MIT-37634b?style=flat-square)](LICENSE) [![Build checks](https://github.com/KraHsu/repeaty/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/KraHsu/repeaty/actions/workflows/ci.yml)

</div>

Repeaty 是一个在浏览器里使用的间隔复习工具，专注 Anki 式制卡与学习。

把单词、概念或自己的笔记做成卡片，按 FSRS 安排每天的复习。支持正反面、双向和挖空卡片，也可以加入图片、音频、Markdown 和数学公式。界面可随时切换 English / 中文（简体）。

打开就能用，无需注册。卡片与复习进度保存在当前浏览器，准备好离线缓存后，断网也能继续学习。

## 使用

| 方式       | 适合场景                   | 入口                                           |
| ---------- | -------------------------- | ---------------------------------------------- |
| Web        | 打开浏览器，开始制卡和复习 | [在线使用](https://krahsu.github.io/repeaty/)  |
| 离线 / PWA | 断网学习，或安装为独立窗口 | [离线使用](docs/USAGE.md#离线使用)             |
| 自行部署   | 使用自己的 HTTPS 静态站点  | [部署说明](docs/DEVELOPMENT.md#离线启动与部署) |

首次打开是空白空间。可以加载入门示例，或先建一个卡组，再添加自己的卡片。复习时先回想答案，翻面后选择「重来 / 困难 / 良好 / 简单」，Repeaty 会安排下次复习时间。每个卡组可以调整每日学习量和目标记忆保留率，误评分也可以撤销。

已有笔记可从 CSV / TSV 批量导入。需要集中练习时，可以按标签、题型、到期时间等条件搜索，保存常用筛选，再选择只练习或更新复习进度。具体操作见[使用指南](docs/USAGE.md)。

在线版由 GitHub Pages 托管；上面的链接会跳转到账号已有的自定义域名 `www.krahsu.top/repeaty/`。

## 当前进度

当前源码为 **0.4.0**。已实现 FSRS 调度、三种笔记类型、多媒体制卡、批量管理、专项练习、双语界面和离线 PWA。浏览器回归测试覆盖制卡与复习、断网重载、移动端布局，以及合计 128 MiB 的图片 / 音频和接近 10000 字长文本的备份往返。

学习数据使用 IndexedDB 分表保存，媒体独立保存为原始文件。默认导出 `.repeaty` 备份包，也兼容旧版 JSON；自动快照可恢复最近的修改。**数据只在当前浏览器中，清除网站数据会一起删除卡片、媒体和快照，请定期导出备份。** 更换浏览器或设备需要手动导入，不提供账号、云同步、订阅或支付。[数据与备份](docs/USAGE.md#图片音频与备份)

已提供 1 万张卡片、10 万条复习记录的浏览器性能基准；启动时仍会将结构化学习数据读入内存，大卡库的体验取决于设备。当前还不支持 Anki `.apkg` 导入、自定义字段 / HTML 模板、所见即所得编辑、图片遮挡、嵌套挖空或 FSRS 参数训练。[存储与性能边界](docs/DEVELOPMENT.md#大数据量存储)

## 开发

Vue 3 + TypeScript + Vite，当前无需后端。需要 Node.js 24.12+（24.x）；如果以后需要服务端，使用 Rust。

```bash
nvm use
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:5173`。生产构建使用 `npm run build`，完整检查使用 `npm run check`；首次运行浏览器测试先执行 `npx playwright install chromium`。其余命令、项目结构和性能基准见[开发文档](docs/DEVELOPMENT.md)。

PR 会自动执行格式、单元、类型、构建和浏览器检查。合并到 `main` 并通过检查后，自动部署到 GitHub Pages。`main` 要求通过 PR 合并并通过检查，禁止强推和删除。[CI 与分支保护](docs/DEVELOPMENT.md#ci-与-github-pages)

遇到问题可以提 [Issue](https://github.com/KraHsu/repeaty/issues)，写明浏览器、操作步骤和报错即可。也欢迎直接提 PR。

[MIT](LICENSE) © 2026 CharlesHsu。第三方依赖保留各自的许可证。
