# 开发文档

[返回首页](../README.md) · [使用指南](USAGE.md) · [桌面客户端](DESKTOP.md) · [插件接口](PLUGINS.md)

## 开发与验证

需要 Node.js 24.15+（24.x）、Rust 与 Tauri 系统依赖，CI 固定使用 Rust 1.97.1。桌面是当前主要开发入口。

```bash
npm ci
npm run desktop:dev
```

首次启动选择空目录创建学习库，入门卡组会自动添加；删除后不会自动补回。网页体验可用 `npm run dev` 单独运行。

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
npm run schema:workspace # 修改实体模型后重新生成 Rust 使用的 JSON Schema
```

首次运行浏览器测试先执行 `npx playwright install chromium`。静态版测试也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome` 使用已有 Chrome。浏览器测试启动 `127.0.0.1:4175`，覆盖制卡、复习、撤销、额度、批量管理、媒体恢复、快捷制卡、常用筛选、两种专项练习、自动暂缓、双语切换与偏好持久化、移动端布局和断网重载。另有合计 128 MiB 的原始音频与图片、接近 10000 字长文本的归档恢复／离线复习／再次导出测试，对所有媒体比较 SHA-256。

浏览器测试默认访问根路径。用与 Pages 一致的子路径运行完整检查：

```bash
VITE_BASE_PATH=/repeaty/ npm run check
```

CI 使用两个 Chromium worker，禁止提交 `test.only`，失败时保留浏览器 trace 和 HTML 报告。测试在独立浏览器上下文中运行，不读写日常浏览器的学习库。

### 浏览器工作目录

`src/browser/` 提供无后端的目录读取与试用。`workspace-files.ts` 只暴露读接口；`workspace-reader.ts` 在 Worker 中通过已有 `sql.js` WASM 读取 SQLite 副本，校验身份、引用和接受版本。`repository.ts` 适配共享学习接口，修改仅保存在页面内存中；原有 IndexedDB 学习库独立保留。

浏览器回归使用 Rust 运行时创建并关闭真实目录，所以执行 `test:e2e` 需要 Rust；基本单元测试和静态构建无需编译原生程序。目录选择回退、真实目录句柄传入 Worker、取消、失败保护、评分撤销、媒体、旧材料、代码、完整导出、千张卡和离线打开位于 `tests/browser-workspace.spec.ts`，Rust / WASM 联测位于 `tests/workspace-native/browser.test.ts`。

```bash
npx vitest run src/browser
npm run test:workspace:native
VITE_BASE_PATH=/repeaty/ npm run build
VITE_BASE_PATH=/repeaty/ npx playwright test tests/browser-workspace.spec.ts --workers=2
```

并行运行静态与桌面浏览器套件时，应分别传入 `--output=/tmp/repeaty-web-tests` 和 `--output=/tmp/repeaty-desktop-tests`，避免两个进程清理同一个 trace 目录。千张卡的浏览器回归会在该测试输出目录保存 `rating-responsiveness.json`，记录操作耗时和帧间隔，测量口径见[性能记录](PERFORMANCE.md#浏览器工作目录试用)。

## 界面文案

标题使用功能名或当前状态，按钮写明操作。提示说明操作结果、限制和下一步，不添加励志口号、装饰性英文或无关说明。中英文一起维护，修改时保留计数参数与用户内容；已存储的筛选状态和快照原因不能随文案改名。

文案集中在 `src/i18n/en.ts`，使用中文源文案作为翻译键；`t()` 负责响应式显示，带参数的通知与错误通过 `msg()` / `LocalizedError` 保留原始信息，避免切换语言后仍显示旧语言。用户内容作为参数插入，不参与翻译。已持久化的中文筛选状态和快照原因只翻译显示，不修改存储格式。

## 大数据量存储

纯前端版的 IndexedDB v16 将卡组、笔记、卡片、复习记录、练习、提交、材料元数据、媒体元数据和常用筛选分别存储，图片、音频和材料原文保存为独立 Blob。提交另有不含代码与裁判详情的摘要索引，首次升级时从原记录建立。完整提交、摘要和修订号在同一事务中更新；旧标签页不能覆盖新数据。首次打开自动迁移旧数据库，迁移校验失败时保留原记录。v9 起另有桌面本地库使用的 `cardDrafts` 辅助表，网页版本不提供草稿入口；v10 起的阅读位置、v11 的日期安排与归档状态、v12 的阅读优先级、v13 的独立摘录类型 / 出处、v14 的递增间隔与 v15 的多级出处与 v16 的自适应反馈保存在材料记录中，沿用原表。

启动时读取题面、调度状态和历史摘要，提交代码与裁判详情在展开时读取，收起后释放视图中的正文。提交、判题状态和评分只校验变化记录及引用关系；导入、编辑等结构变化继续执行完整校验。两处历史入口每页显示 20 次练习，查看往次代码须成功读取后才记为查看答案。

新快照保存修订号和数量摘要，后续只记录变更前的数据；恢复时从当前记录逆向重建。保留最近 10 个快照，随过期快照清理不再需要的变更及媒体。快照列表只读取摘要，旧版完整快照仍可恢复。

卡片列表通过数据库读取每页 50 张，普通列表和卡组列表使用顺序／卡组索引；复杂搜索逐条匹配，专项练习最多读取 500 个候选 ID。当前调度、编辑和首页仍保留结构化学习数据的内存视图，启动成本随记录数量增长；媒体不会随启动整体加载。当前校验上限为 10 万条笔记、20 万张卡片、50 万条复习记录，并不代表所有设备上的性能保证。

执行 `npm run benchmark` 在真实 Chromium 中测量 1 万张卡片、10 万条历史记录的首次保存、重新加载、快照、分页、搜索和评分耗时；结果写入 `test-results/storage-benchmark.json`。该命令使用独立临时数据库，结束后删除，不触碰日常学习库。

`npm run benchmark -- --review --cards 1000 --runs 3` 测量真实 Vue 界面的评分按钮到下一题绘制；可改为 `--cards 10000`。基准在隔离 Chromium 上下文中重载数据，使用 4 倍 CPU 降速，包含数据库事务、组件更新和两帧绘制等待。它不计首次下载应用或真实后端网络延迟。

评分热路径按变更记录保存，验证不变的历史前缀后只校验追加评分；其他导入、删除和历史修改继续完整校验。`createCardViewReader` 仅供使用不可变快照的界面复用未变化的卡片，普通 `cardViews` 仍是无缓存的纯函数。每日额度不再为统计生成整库题面，也不在每条历史上重复计算日期。评分和撤销等到事务成功才切题，快照列表在后台更新；响应检查库作用域和请求顺序。

「设置」页独立于学习库加载状态，桌面不再提供上游 endpoint。桌面的界面偏好和插件开关随工作目录保存，网页偏好保存在当前浏览器；凭据不进入学习目录。通知按级别控制顶部弹出 / 页内显示，信息自动关闭，警告和错误保留关闭按钮；开始新操作时清除上一条信息提示，避免把旧成功提示误认为本次已保存。切换学习库后，旧备份和操作的迟到响应不能改写新库的状态提示。

Markdown 使用 [highlight.js 的显式语言接口](https://highlightjs.readthedocs.io/en/latest/api.html)，未识别语言和超过 100,000 字符的代码块保持转义文本，不做自动语言检测。中文闭合加粗通过行内 token 修正，只在渲染结果中补空格，不更改原文、代码或阅读定位。AI 制卡 skill 位于 `public/skills/repeaty-cards`，通过现有 CSV 导入；两个文件加入静态离线缓存。

`npm run benchmark -- --history --runs 3` 另测 2 万次练习、6 万份代码下的加载、堆内存、历史筛选、提交、评分与流式导出。先建立数据，再重载页面测量，逐轮输出原始值和中位数。[基准方法、结果与限制](PERFORMANCE.md)。

带后端版使用 SQLite：九个实体表按记录保存 JSON 字段，附件放入独立 BLOB 表，引用使用外键与索引。请求只发送变更记录；服务在一个事务中检查修订号、记录格式和引用，写入增量历史与新记录。SQLite 数据库版本使用 `PRAGMA user_version`，当前为 10，学习数据版本为 13，后端 API 为 v11。实体 JSON Schema 从前端 Zod 模型生成并由 CI 检查一致性，Rust 另行检查跨记录引用和附件大小。它不是把整个学习库保存成一份 JSON 文件。

媒体先上传，之后与学习记录的引用一起提交；同一 ID 的内容不可改写，防止破坏旧快照。上传失败不提交学习记录，未引用上传保留一天再清理。客户端失去写入响应时不会自动重试覆盖，修订冲突要求刷新。支持 `historyVersion: 1` 的 API v11 服务提供 `/library/summary` 与 `/library/attempts`，代码单独按编号或批次读取；请求绑定账户与修订号。没有摘要能力的 API v11 服务读取完整库；API v10 及更早服务需先升级。搜索仍使用内存中的题面和摘要；单次结构化提交上限 64 MiB，媒体独立上传。详情见[桌面客户端](DESKTOP.md)。

`.repeaty` 导出按修订号分批读取完整提交，批次之间检查版本与记录顺序，库发生变化时中止导出。JSON 导出与快照恢复按需载入完整记录。当前学习数据为 v13、`.repeaty` 容器为 v10，摘要不属于备份格式，不会替代已保存的代码。

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

[单元工作流](../.github/workflows/unit.yml)在功能分支与 PR 运行 `npm test` 和发布脚本单元测试，不构建安装包或运行浏览器。完整 [CI](../.github/workflows/ci.yml) 与 [Desktop](../.github/workflows/desktop.yml) 只在 main 运行，手动触发也受相同分支约束。

main 检查网页构建与回归、原生目录事务和跨语言测试，并构建三平台安装包。桌面浏览器测试连接真实 Rust 目录存储；Linux 原生测试另外使用真实 WebKit、IPC 与系统选择器，产物和截图按实际运行保存。账户服务不再是桌面构建依赖。

工作流使用固定提交版本的官方 GitHub Actions。检查任务仅授予仓库读取权限；部署任务单独授予 `pages: write` 和 `id-token: write`，不需要配置个人访问令牌。失败报告保留 7 天。

仓库的 Pages 发布源为 **GitHub Actions**，继承账号主页的自定义域名 `www.krahsu.top`，实际访问地址为 `https://www.krahsu.top/repeaty/`；`https://krahsu.github.io/repeaty/` 会重定向到该地址。托管与部署均由 GitHub Pages 完成，不需要连接自己的服务器。

分支保护配置在 GitHub 的 `Settings → Branches`，`main` 的规则为：

- 必须通过 PR 合并，`Unit tests` 必须通过，且分支需与最新 `main` 保持同步。
- 所有审阅对话必须解决；禁止强制推送和删除分支，管理员也遵守这些规则。
- 额外批准人数为 0，个人维护者可以在检查通过后合并自己的 PR。

日常修改请推送功能分支、创建 PR，检查通过后合并。Pages 部署失败时，在 Actions 中查看 `Deploy Pages` 日志并重试；不要跳过质量检查直接上传产物。

Fork 后需在自己的仓库启用 Pages 的 GitHub Actions 发布源，并单独配置分支保护。仓库名或部署位置变化时，同步修改工作流中的 `VITE_BASE_PATH`。参考 [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)和 [Vite 部署说明](https://vite.dev/guide/static-deploy.html#github-pages)。

## 技术边界与结构

纯前端版独立运行于浏览器；带后端版使用 Rust + Axum + SQLite，由同一服务托管网页与 API。带后端版提供基本账户；范围不包含订阅、支付、商业云同步或团队协作。

Anki `.apkg` 在同源 Worker 中通过 sql.js 读取，HTML 用 parse5 作为纯数据转换，单独打包的 SQLite Wasm 随应用离线缓存。新版压缩使用有大小检查的 fzstd 解码。Anki 的 `unicase` 排序规则仅在临时内存副本的模型表定义中替换为 BINARY，查询只按数值身份与序号读取，不按名称比较；原包不改写。解析不访问学习库；随后按 GUID 比较当前库，附件逐个计算 SHA-256 并复用相同文件的已有引用，比较结果绑定工作空间与修订。确认后批量更新笔记，按变体保留原卡片，只在明确确认时移除变体及关联历史；沿用现有存储事务和操作前快照，GUID 编码为稳定笔记 ID，无需改变学习数据、SQLite 或备份版本。[格式、边界与实际 Anki 样例](ANKI.md)。

学习材料保存为 `sources` 元数据记录，正文采用 `text/plain` / `text/markdown` Blob，沿用附件的不可覆盖 ID、上传、快照保留与回收机制；加载学习库时不读取正文。卡片选区以内联的 `Note.excerpt` 保存来源 ID、UTF-16 起止位置与原文引用。独立阅读摘录复用 Source，不建立片段树。导入统一换行为 LF，复习打开原文时再按需读取并检查位置。[用法与边界](SOURCES.md)。

0.15.0 的阅读位置保存在可选 `Source.reading` 字段中，以 UTF-16 位置和 Markdown 块内比例定位，避免保存视口像素。`SourceReader` 处理滚动与恢复，根组件中的 `useReadingProgress` 合并连续移动，停留 700ms 后调用 `useLibrary.saveSourceReading`，复用原事务与修订检查；保存失败保留待处理位置供重试。切库、恢复和删除会清理旧任务。它不改变笔记、卡片、评分或 FSRS 状态。[ADR 005](adr/005-reading-positions.md)。

0.16.0 增加可选 `Source.queue`，保存 active / archived 与 `availableOn` 本机日期。`core/source-queue.ts` 负责可读状态、日期排序、延后与恢复；到期只改变筛选结果，不写库。`useLibrary.arrangeSource` 在同一事务中保存当前位置和安排，并创建操作前快照；界面确认成功后只移除已包含的待保存位置，较新的滚动仍保留。卡片与 FSRS 不使用材料的归档或延后状态。[ADR 006](adr/006-reading-queue.md)。

0.17.0 增加可选 `Source.priority`，缺省为普通。只对待阅读按高、普通、低再按日期排序，稍后阅读与归档继续按日期排列。优先级变更复用安排操作，保存当前位置，失败保留原值；阅读自动保存不覆盖新优先级。界面保留选中的材料，跨页排序时跟随当前材料。[ADR 007](adr/007-reading-priority.md) · [Foliole 设计参考](READING_REFERENCES.md)。

0.18.0 的临时阅读轮次由 `core/reading-round.ts` 保存当前待阅读的来源与快照 ID，按开始时的顺序推进；删除、替换、延后或归档的材料自动跳过。`SourcePanel` 等待位置保存成功再推进，失败保留索引；操作完成检查作用域、组件生命周期与轮次身份。轮次不进入库、检查点或备份，离开材料页面即结束，没有数据格式或后端接口变更。[ADR 008](adr/008-reading-rounds.md)。

0.19.0 的独立摘录采用 `Source.kind` 与 `Source.origin`，正文沿用独立 Blob；创建操作与父材料位置原子保存。范围、原文类型、格式和正文一致性由前端与 Rust 分别验证，按来源逐份读取；仅位置与安排变化不触发前端正文重读。删除原文只解除出处，保留摘录、卡片与进度。[ADR 009](adr/009-independent-reading-excerpts.md)。

0.20.0 增加 `core/source-navigation.ts` 与 `SourceExcerptList`：从现有出处建立按原文位置排序的列表并统计实际卡片，预览仅取当前原文，每页五条。精确重复按来源 ID 和 UTF-16 范围判断，定位通过 `SourceReader.locate` 切回原始文本并保留选区；打开摘录先保存位置，轮次内使用只读弹窗。导航检查作用域、快照和组件生命周期，失败不跳转。沿用 0.19.0 的全部数据版本与 API。[ADR 010](adr/010-source-excerpt-navigation.md)。

0.21.0 为「稍后阅读」加入明天、3 天后、1 周后三个快捷日期，复用 `nextReadingDay` 按本机日历计算并显示实际日期。点击选项只更新表单，手动日期与选中状态保持一致，提交仍通过原有 `arrangeSource` 事务保存位置和日期，成功后才推进轮次。原文与独立摘录共用此流程，不增加存储字段或 API；沿用现有全部数据格式与备份版本。

0.22.0 增加可选 `Source.readingIntervalDays`。`nextReadingInterval` 与 `arrangeSource` 负责固定阶梯、陈旧确认和重置，位置与安排继续在一个事务中保存。手动日期、归档及优先级保留阶梯；原文和摘录互不继承。[ADR 011](adr/011-progressive-reading-intervals.md)。

0.23.0 的材料筛选复用 `core/source-queue.ts` 的 `SourceFilter` 和标题 / 类型 / 优先级匹配，四个队列的数量与列表使用同一条件。`startReadingRound` 可接收同一筛选，在开始时捕获全部符合条件的待阅读身份；后续只核对快照与可读状态，不重新应用筛选。「再读一轮」重新匹配原条件。界面清除筛选以显示主动打开或新保存的目标；筛选本身不写入库、快照或备份，数据与 API 版本沿用 0.22.0。

0.24.0 通过 `sourceDetailsSchema` 复用既有标题和 URL 字段，`editSourceDetails` 只接受这两个字段，并校验来源 / 快照 ID 与打开表单时的原信息。`useLibrary.editSourceDetails` 等待已有保存，校验库作用域，再把信息与可用阅读位置一起提交，复用操作前快照。正文、媒体、出处、队列和学习记录继续保留，原文与摘录不联动改名或改链接。筛选照常刷新，轮次不重新匹配成员；迟到响应不能在新的材料页重开弹窗。材料信息编辑不增加端点；IndexedDB 的纯信息修改不重读正文，服务仍执行既有来源校验。

0.24.0 还补齐渐进学习核心流程：`reading-operations.ts` 先校验所有目标，再生成整批变更，并仅捕获日期、优先级和间隔的撤销。工作空间一次提交全部记录与可用位置；撤销也走同一保存、快照和修订检查。最近一次撤销只保留在当前打开的工作空间，恢复与切库时清除。`source-tree.ts` 校验循环与最多 32 层出处，并逐级转换 UTF-16 选区；来源正文仍按需读取。首页统计与日常入口复用已有队列，阅读结束进入正常 FSRS 复习。[ADR 012](adr/012-incremental-learning-core.md)。

桌面 MCP 的学习查询通过 Rust 本机 HTTP 监听和 IPC Channel 请求当前窗口的只读应用接口。`useLibrary.readLearning` 校验作用域与忙碌状态，`core/learning-reader.ts` 从已提交的内存视图投影有上限的结果；不绕过 IndexedDB，也不读取提交正文。授权仅存于本次进程，切库和重载撤销。查询沿用现有修订号，无存储或备份格式变更。[设计与验证](adr/002-desktop-mcp-bridge.md) · [客户端配置](MCP.md)。

0.13.0 增加受选区授权限制的 `repeaty_selected_excerpt` 与 `repeaty_propose_cards`；0.14.0 将已接收草稿保存到独立 IndexedDB 表，写入成功后才返回回执。`core/draft-proposals.ts` 管理选区、批次重试与容量；`core/card-draft-data.ts` 校验持久记录与附件，`desktop/drafts.ts` 负责恢复与作用域代次检查。`DraftWorkbench` 复用 NoteEditor，明确保存编辑或确认调用 `saveExcerptNote`；确认时生成正式记录与消费草稿使用同一事务。辅助表不参与正式修订、检查点和备份，不持久化授权。[ADR 003](adr/003-mcp-card-drafts.md) · [ADR 004](adr/004-persistent-card-drafts.md)。

当前数据格式为 Library v13、IndexedDB v16、SQLite v10、HTTP API v11、`.repeaty` v10 和 JSON 备份 v13。0.26.0 为阅读自适应状态升级版本门槛，Library v12 不补写反馈与确认次数。0.24.0 为多级出处语义升级版本门槛，旧客户端不能处理新关系；记录表结构不变。Library v11 保留全部既有来源与学习记录。Library v10 保留已有阅读设置与独立摘录，不补写间隔。Library v9 保留已有阅读设置，不补写摘录类型；v8 升级时保留阅读安排，未设置优先级时按普通处理；v7 保留阅读位置，没有安排的材料默认可读；v6 保留材料且不补写位置，更早版本补空材料列表。原 ID、FSRS 状态、记录、检查点与待确认草稿保留；旧客户端拒绝写入新版本数据库。旧 `.repeaty` v1–v9 和 JSON 备份仍可恢复。服务端校验来源、快照和摘录引用，按材料逐份读取正文验证位置，避免批量恢复时同时缓存全部原文。

Anki 集成只规划导入，不计划提供 Repeaty → Anki 导出。尚未实现 Anki 进度迁移、自定义字段 / HTML 模板、所见即所得富文本编辑器、图片遮挡、嵌套挖空、FSRS 参数训练。

```text
src/core/
  model.ts           # v13 笔记 / 卡片 / 媒体 / 练习模型与卡片生成
  practice-data.ts   # 练习、代码提交与结果 Schema
  practice.ts        # 提交状态、幂等与练习完成
  legacy.ts          # 冻结的 v1 校验模型
  scheduler.ts       # 按卡组 FSRS、额度、撤销、自动暂缓与顽固卡
  content.ts         # 安全 Markdown 与数学公式渲染
  authoring.ts       # 选中文字插入挖空
  search.ts          # 组合搜索、常用筛选及专项练习队列
  batch.ts           # CSV / TSV 校验与批量操作
  anki/              # .apkg 解析、HTML 转换、媒体比较与选择性导入更新
  source-data.ts     # 材料元数据、阅读安排与优先级、阅读与摘录位置
  source-tree.ts     # 出处层级校验与逐级选区偏移
  reading-operations.ts # 批量阅读安排与撤销
  source-queue.ts    # 材料筛选、阅读排序、优先级、日期安排与归档
  reading-round.ts   # 临时阅读顺序、快照校验与逐篇推进
  sources.ts         # 原文快照、读取、阅读位置、摘录与独立删除
  card-draft-data.ts  # 待确认草稿与附件校验
  draft-proposals.ts # 选区授权、批次与重试
  storage.ts         # IndexedDB 分表存储、增量快照与媒体回收
  archive.ts         # 流式 ZIP / NDJSON 备份与原始媒体
  backups.ts         # 旧版 JSON 备份兼容
  media.ts           # 附件校验
src/plugins/        # 题目 / 答案接口、应用插件开关、LeetCode 题型
src/backend/        # HTTP 客户端、SQLite 服务的增量存储适配
src/platform/       # 构建时选择 IndexedDB 或后端适配器
src/desktop/        # 原生连接、MCP 桥接、持久草稿与确认界面
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

桌面安装程序支持 `--mcp-stdio --connection-file <绝对路径>`，在创建 Tauri 窗口前进入无界面 MCP 模式。它只代理运行中应用的本机接口，不读取 IndexedDB 或直接写入卡片。客户端配置生成、独占连接文件与协议限制见 [ADR 013](adr/013-mcp-clients.md)。构建后运行 `node scripts/test-mcp-stdio.mjs` 检查真实进程的初始化、工具发现、离线错误与 stdin EOF；三平台 CI 均运行此检查。Linux 原生测试再覆盖本机 HTTP、stdio 到 WebView 的查询、草稿确认和重启恢复，不调用付费模型或修改开发者的 Codex / Claude 配置。

## v1.0 功能冻结

自适应阅读和混合学习规则见 [ADR 014](adr/014-adaptive-mixed-study.md)。用户追加授权了本批渲染、性能、设置、历史、复习中编辑、通知、卡组状态与制卡 skill 收尾，完成后继续冻结其他新功能。验证、迁移、安装包及正式发布门槛见 [发布清单](RELEASE_1_0.md)。
