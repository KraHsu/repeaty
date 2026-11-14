# 材料扩展 SDK

[插件开发](PLUGINS.md) · [独立材料示例](examples/material-plugin/README.md)

当前开发分支的 SDK 1.11 在 `apiVersion: 1` 上提供材料扩展、正文编辑、离线文档资源和区域遮挡接口。旧1.7/1.8/1.9插件仍可加载；新增接口需要相应宿主，升级开发SDK不会升级用户已经安装的软件。此页描述接口边界，不表示既有0.27.0安装包已包含这些接口。

插件只导入 `@repeaty/plugin-api` 和共享 Vue；不导入宿主源码，不假定存在 Node、文件系统模块或进程。`type: 'extension'` 的插件可只注册导入器、阅读器、命令或搜索提供者，无需为了激活而添加无关的侧栏页面。

## 导入与材料身份

`registerImporter({ id, title, extensions, parse })` 声明支持的文件后缀和解析器。宿主传入用户选择的 `File` 及任务上下文；解析结果是候选数组，包含稳定的 `key`、`title`、`text`、`format`、`documentFormat`、可选的 `readerId` 和 `parentKey`。文本为可独立阅读的投影，`format` 为 `plain` 或 `markdown`。父子键在同一候选集合内引用；身份、原件、投影媒体、去重和提交由宿主分配与验证。

插件通过 `materials.prepareImport()` 获取预览计划，再使用 `commitImport({ planId, expectedRevision, operationId })` 请求宿主事务。未确认的计划可用 `discardImport()` 丢弃；不要循环直接保存每个章节，不要自行写SQLite或学习库目录。请求属于当前插件激活实例和学习库，不能把计划ID从一个插件或库传给另一个。

当前宿主允许单个 PDF / EPUB / HTML 原件最多64 MiB，每批最多20个原件、原件及附属资源合计128 MiB、最多1000份材料候选；单份投影最多250,000个UTF-16字符。普通图片、音频及单个附属资源仍最多10 MiB。插件可以收紧这些限制，例如 EPUB 阅读器限制99章、32 MiB 原件与64 MiB 解压数据。待确认计划有数量和有效期限制，超限应明确失败，不静默截断内容。

候选还可提供 `documentPath`（容器内相对路径）、`documentData`（最多16 KiB JSON）、`url`（HTTP(S)来源）、`resources: { path, blob }[]` 与 `container`。宿主保存资源并按同版本绑定；`container: true` 的目录或纯图片封面不进入学习队列，但仍可浏览。路径不得包含绝对路径、反斜杠或越界段。`prepareImport({ relatedFiles })` 把用户明确选择的配套文件作为解析上下文的 `files` 传入，不提供未授权目录访问。

章节可声明 `studySequence: { groupKey, index, mode }`，其中根候选是 `container`，章节的 `parentKey` 指向它。宿主分配实际分组ID。`mode` 为 `free` 或 `sequential`；顺序模式按已有章节的 `completed` 状态锁定后续章节。`materials.setSequence({ sourceId, mode?, completed?, expectedRevision, operationId })` 切换模式或完成章节，保持原材料身份。读取与修改之间应使用同一预览修订，先核对当前正文版本；不要在滚动、打开目录或重复导入时自动完成章节。

`materials.capabilities()` 提供协议版本、学习库作用域及本次环境的能力；`snapshot()` 提供当前修订、材料摘要和卡组，`get(sourceId, versionId?)` 读取投影，`original()` 按需读取同版本原件，`resource(sourceId, path, versionId?)` 读取同版本附属资源。快照是数据，不是可变仓库引用。关闭插件后，宿主仍保留文本投影、原件与资源，允许通用阅读和原件导出；重新安装原阅读器无需重建材料身份。

## 阅读器、选区与摘录

`registerReader({ id, title, formats, component })` 注册读取格式。组件接收 `MaterialReaderProps`：当前 `material`、`text`、按需读取的 `original`、选区以及 `onSelect()`。可选的 `position` / `onPosition({ locator, projectionOffset })` 用于恢复和报告同版本阅读位置；宿主核对版本与投影偏移后沿用材料阅读位置保存流程。使用 SDK 共享控件，复杂阅读区可以自定义布局。阅读器本身不持有评分仓库或全库文件句柄。

`resource(path)` 已绑定当前显示版本；`onOpen(sourceId, locator?)` 请求宿主通过正常的离开草稿检查导航到另一章。`readOnly` 表示历史出处等只读视图，不显示修改章节、正文或学习安排的操作。材料摘要中的 `locked` 可用于解释顺序模式锁定；直接浏览锁定章并不解锁学习队列。

`MaterialReaderProps.workspaceScope` 是必填的当前学习库作用域。阅读器缓存和异步任务须同时绑定作用域、材料ID与版本ID；作用域改变时中止旧请求并释放资源，不能只凭相同材料ID复用前一个学习库的结果。

宿主传入的 `position` 可以只含 `projectionOffset`，用于「从头阅读」等没有几何区域的跳转；阅读器应监听显式位置变更。阅读器向 `onPosition()` 回报持久化位置时仍必须提供真实、同版本的 `locator`，不要为跳转伪造选区。

阅读器若能把投影中的精确范围映射回自己的页面或章节，可声明 `supportsTextLocation: true`，接收统一材料搜索传入的 `text` 选区。必须使用投影偏移映射，不能通过重复文本的首次匹配猜测位置；不声明时宿主使用通用文字阅读器定位搜索结果。

定位器一律携带 `schemaVersion: 1`、`sourceId`、不可变 `versionId`，并按类型描述位置：

| 类型      | 位置                                                                |
| --------- | ------------------------------------------------------------------- |
| `text`    | UTF-16 `start/end` 与精确 `quote`；不是UTF-8字节偏移                |
| `pdf`     | 一个或多个零起点页码与归一化矩形区域                                |
| `epub`    | 相对章节 `href`、可选CFI、成对文本偏移                              |
| `image`   | 归一化 `x/y/width/height`，区域必须在图像内                         |
| `formula` | Markdown公式的精确 `start/end`、`latex` 和渲染元素叶子索引 `leaves` |

`onSelect({ locator, text, projection? })` 报告选区。文本定位器本身提供投影范围；非文本定位器必须附带 `projection: { start, end }`，让宿主核对选中内容等于对应版本投影中的范围。不能凭重复文本猜测位置，也不能把旧定位器应用到新正文。

`materials.createExcerpt()` 和 `materials.createNote()` 请求宿主创建材料摘录或卡片，携带来源、选区、当前修订和操作标识。宿主验证选区、事务与幂等收据，用户仍通过正常的阅读、编辑和制卡流程操作。`annotate({ sourceId, selection, body, id?, expectedRevision, operationId })` 和 `removeAnnotation()` 使用相同事务和撤销语义保存区域或公式批注。官方格式阅读器由用户另行安装，类型声明本身不会激活插件。

题目插件可在 `PluginData.variants` 中保存稳定区域键，宿主据此生成各自独立调度的卡片；`variantLocators` 可按区域键保存与笔记出处同版本的定位器。移动、改名应保留键，退役后恢复也沿用原键；新增键表示新卡片。插件保留区域结构，宿主保留退役卡片及其完整学习历史，不能用“删除旧卡再建新卡”模拟编辑。

## 命令与检索

### 正文编辑（SDK 1.9）

`materials.editContent({ sourceId, versionId, content, expectedRevision, operationId })` 把用户确认的正文保存为新的不可变版本，返回 `{ sourceId, versionId, revision }`。调用前展示差异供用户确认；不要在后台静默改写材料。`versionId` 必须仍是材料当前版本，`expectedRevision` 必须对应预览的学习库快照。正文最多250,000个UTF-16字符且不能为空。

正文和媒体通过宿主同一事务保存，可正常撤销/重做；材料身份、调度、既有摘录、批注、卡片、草稿与历史版本保留。当前文本投影与旧PDF/EPUB等原件脱离，旧原件仍绑定旧版本。相同操作标识及相同内容的重试返回原结果；不同内容复用标识会拒绝，撤销后的旧请求也不能重新应用。切库、卸载和迟到响应沿用材料接口的作用域校验。

官方[格式清理插件](../plugins/format-cleanup/README.md)独立使用这个接口，并在宿主管理的 Worker 中执行带超时的替换。它通过统一 `AppPage` 提供预览页面，通过设置注册提供文字/正则规则，不要求宿主导入插件源码。

`registerCommand({ id, title, shortcut?, run })` 提供材料命令。宿主执行前和开始运行时检查修订，向回调传入当前学习库、操作标识、可选材料/选区及任务上下文。命令中的学习数据修改继续调用 `materials` 事务，不绕过仓库。`shortcut` 只是建议元数据，宿主拥有快捷键冲突与绑定；当前注册本身不会安装全局键盘监听，也不等于实现了用户可配置快捷键。

需要选区编辑器的命令可用 `component` 替代 `run`，两者只能提供一个。组件接收 `{ context, onClose }`，可通过公开材料接口读取原件、编辑多个区域并在用户确认后一次制卡。窗口关闭、插件停用和切库仍由宿主取消上下文。

命令编排按应用串行执行；后台解析、搜索及 `tasks.run()` 共用每应用最多2个运行任务、16个等待任务的队列。两种队列分开，避免命令占满后台槽位后又等待自己的导入任务。执行回调中的任意远端副作用不会自动获得本地事务幂等保证；应先使用相应宿主协议，此处不提供发布或同步功能。

`registerSearchProvider({ id, title, search })` 接收查询文本、分页cursor、上限和任务上下文，返回带 `sourceId/versionId` 的结果、摘要和可选定位器。分页最多100项；P1搜索结果必须绑定当前学习库中材料的当前版本，宿主验证来源、版本和定位器类型。历史卡片仍可通过 `materials.get(sourceId, versionId)` 回源；搜索索引过期时应更新或重建，不能返回伪造或过期版本。插件可以用按库的 `pluginData` 保存可重建派生索引，不把索引当作正文或唯一数据副本。通用全文检索界面及大型索引器不是注册API自动生成的功能。

## 任务与生命周期

`tasks.run({ id, title, signal?, onProgress? }, async context => …)` 返回任务Promise。标识在同一激活实例中不能重复并发；不同插件及插件更新后的实例互相隔离。`context` 提供：

- `signal`：取消、卸载、替换或切库时中止。
- `progress({ completed, total?, message? })`：有界进度；任务结束后的迟到进度会被拒绝。
- `onCleanup(stop)`：终止Worker、释放对象URL、关闭读取器等；成功、失败或取消都执行一次。任务已结束后注册的清理立即执行。
- `createWorker(source, { type?, name? })`：用自包含脚本创建宿主管理的 Blob Worker，支持 `classic`（默认）或 `module`，代码上限为4 MiB UTF-8，名称最多100字符。任务成功、失败、取消、卸载都由宿主终止Worker并回收URL；构造失败也回收URL。旧宿主或手写上下文可以没有此方法，先检查 `materials.capabilities().worker` 和方法存在性。该能力表示宿主工厂可用，不只是全局有Worker构造器。
- `yield()`：在有界批次间让出主线程，并检查取消。

队列并不把同步JavaScript自动移到Worker。CPU密集解析应调用任务上下文的 `createWorker`，通过消息和Transferable传递数据；Worker内没有Vue、插件SDK或材料写库入口，复杂依赖须打包进Worker脚本。不要把原始二进制变成巨大的内联源字符串。宿主桌面CSP只为Worker增加 `blob:`，未扩大主线程脚本执行策略；静态页面沿用其现有部署策略，额外部署CSP也须允许同源与Blob Worker。

`resources.read(path)` 返回包内 `assets/` 下的只读 Blob，调用路径不含 `assets/` 前缀。阅读器等长寿命视图可使用 `resources.createScope()` 的 `signal`、`onCleanup`、`createWorker`、`url(path)` 和 `dispose()` 管理离线 Worker、字体及对象URL；卸载、替换或切库也会释放作用域。它只读取当前插件包资源，不是任意文件接口。纯文本解析等有限任务仍优先使用 `tasks.run()`；持续渲染的 Worker 不应占着有限任务槽等待用户操作。

宿主自动回收Worker资源，但插件等待消息的Promise仍需响应 `signal.abort`，及时拒绝等待并移除事件监听。取消是协作式；忽略取消且永不返回的解析器仍占用运行槽，宿主不会以假完成突破并发上限。不要在某个后台任务内部再次排队并等待同一有界队列的子任务；在同一上下文分批处理，或从命令编排启动多个后台任务。

注册在插件成功激活后一起发布。模块求值和入口工厂执行期间可注册贡献，但材料能力返回 `available: false`，材料读写会被拒绝；只有成功发布的当前实例可使用宿主材料服务，不能在更新候选初始化时提前导入或制卡。加载失败保留原来有效的插件与阅读器；卸载、关闭、替换和切库删除贡献并取消工作，旧回调不能返回迟到结果。插件无需也不能为恢复注册重新建立学习数据。权限声明、设备信任和运行时隔离是不同边界：当前可信JavaScript插件不是强安全沙箱。

接口完整类型见 [materials.d.ts](../packages/plugin-api/materials.d.ts)，最小可构建项目见 [material-plugin](examples/material-plugin/README.md)。

来源连接器与统一收集接口见 [来源连接器 SDK](PLUGIN_COLLECTION.md)。
