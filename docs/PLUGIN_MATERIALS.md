# 材料扩展 SDK

[插件开发](PLUGINS.md) · [独立材料示例](examples/material-plugin/README.md)

当前开发分支的 SDK 1.8 在 `apiVersion: 1` 上增加材料扩展。旧1.7插件仍可加载；新增接口需要相应宿主，升级开发SDK不会升级用户已经安装的软件。此页描述接口边界，不表示既有0.27.0安装包已包含这些接口。

插件只导入 `@repeaty/plugin-api` 和共享 Vue；不导入宿主源码，不假定存在 Node、文件系统模块或进程。`type: 'extension'` 的插件可只注册导入器、阅读器、命令或搜索提供者，无需为了激活而添加无关的侧栏页面。

## 导入与材料身份

`registerImporter({ id, title, extensions, parse })` 声明支持的文件后缀和解析器。宿主传入用户选择的 `File` 及任务上下文；解析结果是候选数组，包含稳定的 `key`、`title`、`text`、`format`、`documentFormat`、可选的 `readerId` 和 `parentKey`。文本为可独立阅读的投影，`format` 为 `plain` 或 `markdown`。父子键在同一候选集合内引用；身份、原件、投影媒体、去重和提交由宿主分配与验证。

插件通过 `materials.prepareImport()` 获取预览计划，再使用 `commitImport({ planId, expectedRevision, operationId })` 请求宿主事务。未确认的计划可用 `discardImport()` 丢弃；不要循环直接保存每个章节，不要自行写SQLite或学习库目录。请求属于当前插件激活实例和学习库，不能把计划ID从一个插件或库传给另一个。

P1沿用现有附件边界：单个原件必须非空且最多10 MiB，每批最多20个文件、合计64 MiB，最多100份材料候选，单份文本投影最多250,000个UTF-16字符。待确认计划有数量和有效期限制。大于这些边界的文件会在解析/提交前拒绝；存在PDF定位器或Worker工厂不代表已经支持任意大小的PDF解析。

`materials.capabilities()` 提供协议版本、学习库作用域及本次环境的能力；`snapshot()` 提供当前修订、材料摘要和卡组，`get(sourceId, versionId?)` 读取投影，`original()` 按需读取同版本原件。快照是数据，不是可变仓库引用。关闭插件后，宿主仍保留文本投影与原始附件，允许通用阅读和原件导出；重新安装原阅读器无需重建材料身份。

## 阅读器、选区与摘录

`registerReader({ id, title, formats, component })` 注册读取格式。组件接收 `MaterialReaderProps`：当前 `material`、`text`、按需读取的 `original`、选区以及 `onSelect()`。可选的 `position` / `onPosition({ locator, projectionOffset })` 用于恢复和报告同版本阅读位置；宿主核对版本与投影偏移后沿用材料阅读位置保存流程。使用 SDK 共享控件，复杂阅读区可以自定义布局。阅读器本身不持有评分仓库或全库文件句柄。

定位器一律携带 `schemaVersion: 1`、`sourceId`、不可变 `versionId`，并按类型描述位置：

| 类型    | 位置                                                 |
| ------- | ---------------------------------------------------- |
| `text`  | UTF-16 `start/end` 与精确 `quote`；不是UTF-8字节偏移 |
| `pdf`   | 一个或多个零起点页码与归一化矩形区域                 |
| `epub`  | 相对章节 `href`、可选CFI、成对文本偏移               |
| `image` | 归一化 `x/y/width/height`，区域必须在图像内          |

`onSelect({ locator, text, projection? })` 报告选区。文本定位器本身提供投影范围；非文本定位器必须附带 `projection: { start, end }`，让宿主核对选中内容等于对应版本投影中的范围。不能凭重复文本猜测位置，也不能把旧定位器应用到新正文。

`materials.createExcerpt()` 和 `materials.createNote()` 请求宿主创建材料摘录或卡片，携带来源、选区、当前修订和操作标识。宿主验证选区、事务与幂等收据，用户仍通过正常的阅读、编辑和制卡流程操作。PDF/EPUB/图片定位类型是扩展协议；存在类型声明不代表本版本已经附带这些格式的阅读器。

## 命令与检索

`registerCommand({ id, title, shortcut?, run })` 提供材料命令。宿主执行前和开始运行时检查修订，向回调传入当前学习库、操作标识、可选材料/选区及任务上下文。命令中的学习数据修改继续调用 `materials` 事务，不绕过仓库。`shortcut` 只是建议元数据，宿主拥有快捷键冲突与绑定；当前注册本身不会安装全局键盘监听，也不等于实现了用户可配置快捷键。

命令编排按应用串行执行；后台解析、搜索及 `tasks.run()` 共用每应用最多2个运行任务、16个等待任务的队列。两种队列分开，避免命令占满后台槽位后又等待自己的导入任务。执行回调中的任意远端副作用不会自动获得本地事务幂等保证；应先使用相应宿主协议，此处不提供发布或同步功能。

`registerSearchProvider({ id, title, search })` 接收查询文本、分页cursor、上限和任务上下文，返回带 `sourceId/versionId` 的结果、摘要和可选定位器。分页最多100项；P1搜索结果必须绑定当前学习库中材料的当前版本，宿主验证来源、版本和定位器类型。历史卡片仍可通过 `materials.get(sourceId, versionId)` 回源；搜索索引过期时应更新或重建，不能返回伪造或过期版本。插件可以用按库的 `pluginData` 保存可重建派生索引，不把索引当作正文或唯一数据副本。通用全文检索界面及大型索引器不是注册API自动生成的功能。

## 任务与生命周期

`tasks.run({ id, title, signal?, onProgress? }, async context => …)` 返回任务Promise。标识在同一激活实例中不能重复并发；不同插件及插件更新后的实例互相隔离。`context` 提供：

- `signal`：取消、卸载、替换或切库时中止。
- `progress({ completed, total?, message? })`：有界进度；任务结束后的迟到进度会被拒绝。
- `onCleanup(stop)`：终止Worker、释放对象URL、关闭读取器等；成功、失败或取消都执行一次。任务已结束后注册的清理立即执行。
- `createWorker(source, { type?, name? })`：用自包含脚本创建宿主管理的 Blob Worker，支持 `classic`（默认）或 `module`，代码上限为1 MiB UTF-8，名称最多100字符。任务成功、失败、取消、卸载都由宿主终止Worker并回收URL；构造失败也回收URL。旧宿主或手写上下文可以没有此方法，先检查 `materials.capabilities().worker` 和方法存在性。该能力表示宿主工厂可用，不只是全局有Worker构造器。
- `yield()`：在有界批次间让出主线程，并检查取消。

队列并不把同步JavaScript自动移到Worker。CPU密集解析应调用任务上下文的 `createWorker`，通过消息和Transferable传递数据；Worker内没有Vue、插件SDK或材料写库入口，复杂依赖须打包进Worker脚本。不要把原始二进制变成巨大的内联源字符串。宿主桌面CSP只为Worker增加 `blob:`，未扩大主线程脚本执行策略；静态页面沿用其现有部署策略，额外部署CSP也须允许同源与Blob Worker。

宿主自动回收Worker资源，但插件等待消息的Promise仍需响应 `signal.abort`，及时拒绝等待并移除事件监听。取消是协作式；忽略取消且永不返回的解析器仍占用运行槽，宿主不会以假完成突破并发上限。不要在某个后台任务内部再次排队并等待同一有界队列的子任务；在同一上下文分批处理，或从命令编排启动多个后台任务。

注册在插件成功激活后一起发布。模块求值和入口工厂执行期间可注册贡献，但材料能力返回 `available: false`，材料读写会被拒绝；只有成功发布的当前实例可使用宿主材料服务，不能在更新候选初始化时提前导入或制卡。加载失败保留原来有效的插件与阅读器；卸载、关闭、替换和切库删除贡献并取消工作，旧回调不能返回迟到结果。插件无需也不能为恢复注册重新建立学习数据。权限声明、设备信任和运行时隔离是不同边界：当前可信JavaScript插件不是强安全沙箱。

接口完整类型见 [materials.d.ts](../packages/plugin-api/materials.d.ts)，最小可构建项目见 [material-plugin](examples/material-plugin/README.md)。
