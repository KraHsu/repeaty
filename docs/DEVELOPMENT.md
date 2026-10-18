# 开发文档

[返回首页](../README.md) · [使用指南](USAGE.md) · [后端部署](SELF_HOSTING.md) · [插件接口](PLUGINS.md)

## 开发与验证

需要 Node.js 24.12+（24.x）。运行后端及对应测试还需 Rust，CI 固定使用 1.97.1。

```bash
npm ci
npm run dev
```

默认开发地址为 `http://127.0.0.1:5173`。首次使用自动添加入门卡组，删除后不会自动补回。

```bash
npm run format:check # 格式检查；npm run format 自动整理
npm run typecheck    # Vue / TypeScript 类型检查
npm test             # 核心逻辑、离线缓存、语言偏好与 DOM 交互测试
npm run build        # 纯前端构建到 dist/，检查不包含后端 / LeetCode 模块
npm run build:server # 后端版网页到 dist-server/，不生成离线缓存
npm run preview      # 本地预览生产构建
npm run test:e2e     # 构建后执行 Playwright，使用生产站点而非开发服务器
npm run check        # 格式检查 + 单元测试 + 静态构建 + 浏览器测试
npm run check:server # Schema 一致性、插件测试、Rust fmt/clippy/test、后端浏览器测试
npm run schema:server # 修改实体模型后重新生成 Rust 使用的 JSON Schema
```

首次运行浏览器测试先执行 `npx playwright install chromium`。静态版测试也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome` 使用已有 Chrome。浏览器测试启动 `127.0.0.1:4175`，覆盖制卡、复习、撤销、额度、批量管理、媒体恢复、快捷制卡、常用筛选、两种专项练习、自动暂缓、双语切换与偏好持久化、移动端布局和断网重载。另有合计 128 MiB 的原始音频与图片、接近 10000 字长文本的归档恢复／离线复习／再次导出测试，对所有媒体比较 SHA-256。

浏览器测试默认访问根路径。用与 Pages 一致的子路径运行完整检查：

```bash
VITE_BASE_PATH=/repeaty/ npm run check
```

CI 使用两个 Chromium worker，禁止提交 `test.only`，失败时保留浏览器 trace 和 HTML 报告。测试在独立浏览器上下文中运行，不读写日常浏览器的学习库。

## 界面文案

标题使用功能名或当前状态，按钮写明操作。提示说明操作结果、限制和下一步，不添加励志口号、装饰性英文或无关说明。中英文一起维护，修改时保留计数参数与用户内容；已存储的筛选状态和快照原因不能随文案改名。

文案集中在 `src/i18n/en.ts`，使用中文源文案作为翻译键；`t()` 负责响应式显示，带参数的通知与错误通过 `msg()` / `LocalizedError` 保留原始信息，避免切换语言后仍显示旧语言。用户内容作为参数插入，不参与翻译。已持久化的中文筛选状态和快照原因只翻译显示，不修改存储格式。

## 大数据量存储

纯前端版的 IndexedDB v5 将卡组、笔记、卡片、复习记录、媒体元数据和常用筛选分别存储，图片音频继续保存为独立 Blob。评分只校验并更新变化的卡片、追加复习记录；修订号检查和写入处于同一事务，旧标签页不能覆盖新数据。首次打开自动迁移旧数据库，迁移校验失败时保留原记录。

新快照保存修订号和数量摘要，后续只记录变更前的数据；恢复时从当前记录逆向重建。保留最近 10 个快照，随过期快照清理不再需要的变更及媒体。快照列表只读取摘要，旧版完整快照仍可恢复。

卡片列表通过数据库读取每页 50 张，普通列表和卡组列表使用顺序／卡组索引；复杂搜索逐条匹配，专项练习最多读取 500 个候选 ID。当前调度、编辑和首页仍保留结构化学习数据的内存视图，启动成本随记录数量增长；媒体不会随启动整体加载。当前校验上限为 10 万条笔记、20 万张卡片、50 万条复习记录，并不代表所有设备上的性能保证。

执行 `npm run benchmark` 在真实 Chromium 中测量 1 万张卡片、10 万条历史记录的首次保存、重新加载、快照、分页、搜索和评分耗时；结果写入 `test-results/storage-benchmark.json`。该命令使用独立临时数据库，结束后删除，不触碰日常学习库。

带后端版使用 SQLite：六个实体表按记录保存 JSON 字段，附件放入独立 BLOB 表，引用使用外键与索引。请求只发送变更记录；服务在一个事务中检查修订号、记录格式和引用，写入增量历史与新记录。SQLite 数据库版本使用 `PRAGMA user_version`，当前为 1，学习数据版本仍为 4。实体 JSON Schema 从前端 Zod 模型生成并由 CI 检查一致性，Rust 另行检查跨记录引用和附件大小。它不是把整个学习库保存成一份 JSON 文件。

媒体先上传，之后与学习记录的引用一起提交；同一 ID 的内容不可改写，防止破坏旧快照。上传失败不提交学习记录，未引用上传保留一天再清理。客户端失去写入响应时不会自动重试覆盖，修订冲突要求刷新。当前后端加载完整结构化学习库到前端，搜索仍在内存中执行，单次结构化提交上限 64 MiB；媒体独立上传。详情见[后端部署](SELF_HOSTING.md)。

## 离线启动与部署

```bash
npm run build
npm run preview
```

将 `dist/` 部署到 HTTPS 静态站点即可，本机 `localhost` / `127.0.0.1` 也支持 Service Worker。首次联网打开后，在「数据与备份」看到 **离线已就绪**，即可断网重新打开、刷新、制卡和复习。保存过的媒体也可离线使用。可通过支持的浏览器安装为独立 PWA。

生产构建按版本预缓存完整应用页面、脚本、样式及图标；任一资源下载失败不会激活不完整版本。新版本就绪时提示刷新，由用户选择更新，避免复习中突然重载。开发服务器不启用 Service Worker，必须用生产构建验证离线功能。没有运行时 CDN、账号服务或遥测。

默认构建的资源根路径为 `/`。部署到子目录时，构建和本地预览需使用相同的 `VITE_BASE_PATH`，路径以 `/` 开头、结尾：

```bash
VITE_BASE_PATH=/repeaty/ npm run build
VITE_BASE_PATH=/repeaty/ npm run preview
```

此时预览地址为 `http://127.0.0.1:4173/repeaty/`。Service Worker、离线资源、语言清单和 CSV 示例均使用该路径。

## CI 与 GitHub Pages

[CI 工作流](../.github/workflows/ci.yml)在提交到 `main`、向 `main` 提交 PR，以及手动运行时执行：

1. 按 `.nvmrc` 安装 Node.js，使用 `npm ci` 安装锁定依赖，另行安装 Playwright Chromium 及系统依赖。
2. 运行格式检查、单元 / DOM 测试、类型检查、纯前端生产构建和浏览器测试，使用 `/repeaty/` 子路径。
3. 安装 Rust 1.97.1，检查生成 Schema、插件开关、Rust 格式、Clippy 与测试，再构建后端版、启动临时 SQLite 服务执行浏览器测试。后端测试使用根路径和独立临时数据库，覆盖账户隔离、登录会话、写入冲突、128 MiB 媒体 / 长文本与静态版备份互通。
4. 仅在 `main` 的检查通过后上传已经测试的 `dist/`，通过 `github-pages` 环境部署到 [GitHub Pages](https://krahsu.github.io/repeaty/)。`dist-server/` 与 Rust 二进制不上传 Pages；PR 只检查，不部署。

工作流使用固定提交版本的官方 GitHub Actions。检查任务仅授予仓库读取权限；部署任务单独授予 `pages: write` 和 `id-token: write`，不需要配置个人访问令牌。失败报告保留 7 天。

仓库的 Pages 发布源为 **GitHub Actions**，继承账号主页的自定义域名 `www.krahsu.top`，实际访问地址为 `https://www.krahsu.top/repeaty/`；`https://krahsu.github.io/repeaty/` 会重定向到该地址。托管与部署均由 GitHub Pages 完成，不需要连接自己的服务器。

分支保护配置在 GitHub 的 `Settings → Branches`，`main` 的规则为：

- 必须通过 PR 合并，`Quality checks` 必须通过，且分支需与最新 `main` 保持同步。
- 所有审阅对话必须解决；禁止强制推送和删除分支，管理员也遵守这些规则。
- 额外批准人数为 0，个人维护者可以在检查通过后合并自己的 PR。

日常修改请推送功能分支、创建 PR，检查通过后合并。Pages 部署失败时，在 Actions 中查看 `Deploy Pages` 日志并重试；不要跳过质量检查直接上传产物。

Fork 后需在自己的仓库启用 Pages 的 GitHub Actions 发布源，并单独配置分支保护。仓库名或部署位置变化时，同步修改工作流中的 `VITE_BASE_PATH`。参考 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)和 [Vite 部署说明](https://vite.dev/guide/static-deploy.html#github-pages)。

## 技术边界与结构

纯前端版独立运行于浏览器；带后端版使用 Rust + Axum + SQLite，由同一服务托管网页与 API。范围不包含账号、订阅、支付、商业化、云同步或团队协作。

尚未实现 Anki `.apkg` 导入、自定义字段 / HTML 模板、所见即所得富文本编辑器、图片遮挡、嵌套挖空、FSRS 参数训练。

```text
src/core/
  model.ts           # v4 笔记 / 卡片 / 媒体模型与卡片生成
  legacy.ts          # 冻结的 v1 校验模型
  scheduler.ts       # 按卡组 FSRS、额度、撤销、自动暂缓与顽固卡
  content.ts         # 安全 Markdown 与数学公式渲染
  authoring.ts       # 选中文字插入挖空
  search.ts          # 组合搜索、常用筛选及专项练习队列
  batch.ts           # CSV / TSV 校验与批量操作
  storage.ts         # IndexedDB 分表存储、增量快照与媒体回收
  archive.ts         # 流式 ZIP / NDJSON 备份与原始媒体
  backups.ts         # 旧版 JSON 备份兼容
  media.ts           # 附件校验
src/plugins/        # 题目 / 答案接口、应用插件开关、LeetCode 题型
src/backend/        # HTTP 客户端、SQLite 服务的增量存储适配
src/platform/       # 构建时选择 IndexedDB 或后端适配器
repeaty.plugins.*.ts # 静态 / 后端版部署插件清单
examples/plugins/   # 可安装的纯前端插件示例
server/             # Rust 账户服务、每账户 SQLite、Schema 与测试
src-tauri/          # Tauri 桌面入口、上游客户端与本地插件接口
crates/leetcode-local/ # 本机 LeetCode 请求和凭据存储
src/i18n/           # 双语词典、语言偏好、格式化与 DOM 回归测试
src/composables/     # 工作空间状态与离线更新状态
src/components/      # 笔记编辑、卡片列表、导入、复习和媒体展示
build/              # 构建时生成预缓存清单与 Service Worker
public/             # PWA 元数据、图标及 CSV 示例
tests/              # 生产构建的浏览器回归测试
scripts/            # 真实 Chromium 大卡库性能基准
.github/workflows/  # CI 检查与 GitHub Pages 部署
docs/               # 使用指南、开发文档与 README 插图
```

## 题目插件

插件按部署安装，前端接口统一为 `showQuestion` / `showAnswer`，可选编辑器和设置页。`kind: 'frontend'` 可在所有版本使用，`kind: 'local'` 只在桌面版使用。服务端不加载插件。纯前端清单的类型仅接受前端插件；Vite 通过构建别名隔离模块，而不是在运行时隐藏菜单。

接口、完整示例、本地注册方式及版本兼容规则见[插件开发](PLUGINS.md)。内置 LeetCode 的登录配置、判题规则和限制见[LeetCode 插件](LEETCODE.md)。

桌面构建与原生 WebKit 测试见[桌面版开发说明](DESKTOP.md#测试)。桌面 CI 为 Linux、Windows、macOS 分别构建安装包；LeetCode UI 测试模拟 IPC，Rust 测试使用受控上游服务，均不提交到真实账号。
