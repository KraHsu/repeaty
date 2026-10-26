# M0 内容与原生存储对接

这是 [M0](WORKSPACE_M0.md) 的第三批实现，基于[文件保存与恢复协议](WORKSPACE_PERSISTENCE.md)。运行范围仍是独立实验目录，保存流程没有接入客户端制卡 / 复习仓库，也不执行真实学习库迁移。后续已新增[桌面只读预览入口](WORKSPACE_DESKTOP_PREVIEW.md)，可以查看原型文件与已接受正文。

## 一份校验结果进入保存协议

[`acceptance.ts`](../src/workspace/acceptance.ts) 复用现有 Markdown 编解码器、变体规划器、`newCard()` 和 `CardDraft` schema。它生成原生保存请求及按摘要取用的 Blob：

- 工作目录身份、操作 ID、原 Note ID、文件原字节摘要与预期接受版本。
- 从文件解析出的题型、卡组、有效变体；当前已知的 Card ID / 变体 / 生命周期。
- 新增变体的卡片初始状态，旧卡不生成替代状态。
- 本地图片 / 音频的原媒体 ID、工作路径、名称、类型、大小、时间与字节摘要。
- 原出处的 Source ID、不可变版本、UTF-16 范围与逐字引文。
- 草稿确认的原 Draft ID 和完整保存内容的指纹。

Rust 的 [`acceptance.rs`](../crates/workspace-store/src/prototype/acceptance.rs) 检查请求绑定的文件字节、工作目录、引用对象、卡组及 SQLite 中的当前映射。Markdown 语义由共享的 TypeScript 校验器解释；Rust 不再维护第二套 Markdown 解析规则。这个边界目前只通过测试驱动器相连，尚未成为 Tauri / 服务端 API。

非法 YAML、缺少答案、错误挖空、无法读取的本地附件、错误卡组或不符的出处版本，不生成正式保存计划。未知插件数据保留并标为不可用；声明插件不调用插件，也不恢复执行信任。

## 接受版本包含本地附件

文件摘要与接受版本是两个不同字段：

```text
raw_hash = SHA256(Markdown 原字节)
revision = SHA256(JSON([1, noteId, raw_hash,
  [[mediaId, path, blobHash, mediaType, byteLength], ...]]))
```

附件按媒体 ID 的 UTF-16 顺序排列，两侧使用同一编码。中文、emoji、CRLF 和 BOM 都参与字节校验；普通正文不经过 `trim()` 或格式化。

因此只替换图片或音频、Markdown 原字节未变时，也生成新的接受版本。旧版本继续引用原附件对象。媒体 ID 可以不同而字节相同，此时只对不可变对象去重；工作文件各自复制，编辑其中一份不会改动另一份或历史对象。

本批识别显式 `frontMedia` / `backMedia`、Markdown 图片 / 本地附件链接，以及内嵌 HTML 的 `img` / `audio` / `source` 的 `src`。代码示例不登记为附件；正反面分别解析，题面未闭合的代码围栏不会吞掉答案面的图片。本地路径不得越过目录，原型仍限于可移植的扁平文件名。

HTTP 媒体保持 URL 引用，返回未保存快照的标记，不自动联网下载；不能据此承诺远程资源可离线或永远不变。同一已登记媒体版本的元数据发生矛盾时停止接受，保留输入，而不静默舍弃新字段。一般笔记 / 材料超链接、附件重命名及完整路径能力仍需正式目录适配。

## 卡片退役与恢复

保存前，原生层再次比较 SQLite 中的 Card ID / 变体 / 生命周期，防止陈旧计划改写另一个映射。比较不包含调度值，正文编辑不会覆盖刚完成的评分。

一个 SQLite 事务同时：

1. 保存 Note 接受版本、附件版本引用和不可变出处关系。
2. 插入真正新增的变体；移除的方向 / 挖空编号退役，保留 Card ID、原状态 JSON 和最后有效内容版本。
3. 恢复相同编号时启用原卡及状态；相似答案不把编号 1 的进度移给编号 2。
4. 消费已预约且内容指纹仍匹配的草稿，提交变更记录与回执。

接受版本、最后有效卡片版本和出处关系有外键约束。已有卡片的状态 JSON 不重序列化，不重新计算到期或重放历史。实验表尚未覆盖实际 Library 的全部评分、练习、检查点与阅读状态，不能直接替换现有库。

## 草稿与媒体的中断

[`adaptCardDraft()`](../src/workspace/acceptance.ts) 接受现有 `CardDraft` 数据结构，包括未完成文字、接收顺序、原媒体 ID、上传 Blob 与原引文。新的 DTO 绑定明确的工作目录 ID；旧的 `local:` 作用域和 MCP 选区授权不会被强转为新权限。

确认时派生稳定的 Note / 新 Card ID，保留原 Draft ID。未完成正文仍不能确认。新 Note 文件复制未知编辑器属性；原草稿及其原始包装正文继续保存在草稿回执数据中，不用派生 Note 覆盖它。

新正文、附件和来源正文先分别保存为不可变对象。新附件以不覆盖方式发布；所有依赖齐备并重新核对后，才发布 Note 并提交 SQLite。如果只发布了音频、图片尚未发布就退出，草稿仍未消费；明确重试核对已有文件后继续，不覆盖外部改动。恢复不自动重做不确定的正文交换。

媒体在正文发布后又变化、草稿在准备后被编辑，或出处引文与快照不符时，停止接受并保留各版本。已经提交的回执不会因为后来的外部修改被当成未提交。尚未实现的冲突解决界面需提供继续处理这些记录的入口。

这里验证的是既有草稿数据结构经过适配后的存储流；实际 MCP 接收 / 确认界面和 `drafts/*.md` 的编辑入口仍未接入。实验草稿 payload 中的 `raw` 只是验证载体，不能据此把正式草稿正文重新设计成 SQLite 独占来源。

## 复现与边界

```bash
npm run test:workspace
cargo test --manifest-path crates/workspace-store/Cargo.toml --locked
npm run test:workspace:native
```

本地结果：内容侧 111 项、Rust 30 项、跨语言 23 项通过；全量 TypeScript 为 429 项通过、1 项既有跳过，类型、静态构建、格式和版本检查通过。

跨语言测试实际构建并运行 [`acceptance-fixture`](../crates/workspace-store/examples/acceptance-fixture.rs)，不是模拟原生返回值。合成 `CardDraft` 携带图片、音频和含 emoji / CRLF 的来源；11 个退出点包含两个媒体发布边界。另覆盖挖空退役 / 恢复、原调度 JSON、8 MiB 附件、相同字节的独立工作文件、媒体竞争、陈旧映射、修改后的草稿及伪造引文。该驱动器不连接用户资料，不是公共 stdio / MCP 服务。

普通 `npm test` 无需安装 Rust；原生集成单独执行，并从 Playwright 的浏览器测试发现范围排除。三平台原型 CI 在 Rust 测试后运行同一跨语言套件，结果按对应提交记录。

提交 `4651933` 的[完整 CI](https://github.com/KraHsu/repeaty/actions/runs/40275269928) 通过：Linux / macOS 各 30 项 Rust、Windows 27 项 Rust，三平台各 23 项跨语言测试通过。Quality 检查包含 429 项单元测试（另 1 项既有跳过）、73 项静态版及 46 项服务端浏览器测试；发布脚本检查、类型、格式和构建也通过。手动分支验证不部署 Pages、不创建 Release。

同一提交的 [Desktop](https://github.com/KraHsu/repeaty/actions/runs/40275269868) 通过三平台安装包和无图形会话 MCP stdio；Linux 另通过 55 项桌面浏览器测试及真实 WebKit / Rust IPC 测试。Windows / macOS 的 GUI 与实际安装仍需人工验收。

实验根目录现为标记版本 2、SQLite `user_version = 1002`，继续使用 RPM0 身份和 `state.prototype.sqlite3`。旧实验根目录明确拒绝，不自动升级。产品版本仍为 0.27.0；正式 `workspace.json` / RPTY 格式、客户端学习库仓库、可编辑 Source / Draft、完整业务状态与旧库迁移仍待后续实现。
