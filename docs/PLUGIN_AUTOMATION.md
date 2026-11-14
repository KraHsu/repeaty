# 自动化 SDK

SDK 1.13.0 的 `automation` 为独立插件提供与 CLI / MCP 相同的学习库查询、修改预览和事务。官方[学习助手](../plugins/assistant/README.md)使用这个公开接口；插件源码不进入主程序构建。

## 用户授权与作用域

`automation.context()` 只提供材料和目录的名称、身份及层级，供用户选择范围。不要把未授权的目录清单传给模型。读取正文、笔记和记录必须调用受授权约束的 `query()`。

```ts
import { automation } from '@repeaty/plugin-api'

// 用户先在插件界面选择范围；此调用打开 Repeaty 的授权对话框。
await automation.authorize({
  scope: { kind: 'sources', sourceIds: selectedSourceIds },
  write: true,
})
const page = await automation.query({ kind: 'sources', limit: 50 })
```

范围可以是所选材料及其子材料、所选目录及其下级内容，或当前整个学习库。材料范围也包含关联的摘录笔记和卡片。空选择不代表整库。授权仅存于当前激活会话，撤销、停用、卸载或切库即失效；重新进入会话不自动恢复授权。

`write: true` 允许提出修改。插件调用 `apply()` 时由宿主展示本批变更并请求用户确认。CLI / MCP 通过桌面设置独立授予整库读写权限，详见 [MCP 与 CLI](MCP.md)。模型输出、材料中的指令、请求字段或插件保存的会话均不构成授权。

插件运行于受用户信任的 WebView JavaScript 环境；此接口约束自动化工具的访问与生命周期，不是任意恶意插件代码的沙盒。

## 查询与修改

公开类型见 [`automation.d.ts`](../packages/plugin-api/automation.d.ts)。查询包括材料索引及指定版本正文、目录、卡组、笔记、卡片、评分与练习摘要、退役记录和检查点。正文需明确请求 `source.body`，普通索引查询不读取正文、判题代码、凭据或插件私有数据。分页默认 50，最多 200；后续页需携带首个结果的 `revision`，库已变化时重新查询。

```ts
const plan = await automation.preview({
  protocolVersion: 1,
  operationId: crypto.randomUUID(),
  expectedRevision: page.revision,
  commands: [
    {
      kind: 'source.patch',
      sourceId,
      versionId,
      patch: { title: '整理后的标题', body: editedText },
    },
  ],
})
const result = await automation.apply({
  request: plan.request,
  planId: plan.planId,
  fingerprint: plan.fingerprint,
})
```

一次最多 100 条命令。预览不写库，重复预览保留相同的新对象 ID；预览缓存有效期 10 分钟，最多保留 8 个。写入检查当前修订、插件激活、授权、所有直接及间接受影响的记录。移动或重排涉及的兄弟项、移除目录涉及的子项都须在范围内；不能借目标目录或引用扩大权限。`source.create` 可以指定 `destination` 在授权目录或材料下创建内容。创建普通笔记、调整卡组及整库恢复需要整库权限。

修改复用现有领域操作及保存事务，同时生成恢复点、撤销记录和持久收据。正文修改保留材料版本；笔记变体恢复保留原卡片身份和调度。显式删除笔记沿用现有撤销及检查点恢复语义；`retired.restore` 用于已存在于退役存储中的笔记，不把普通删除伪称为永久回收站。

`history.undo`、`history.redo`、`retired.restore`、`checkpoint.restore` 各自单独成批。检查点恢复涉及整库，并清除与恢复状态不兼容的撤销栈；已确认的自动化收据继续保留。

`collections` 查询与 `collection.create/patch/members/reorder/archive/restore` 管理虚拟引用集合，需要整库授权。同一材料可以同时属于多个命名集合，每个集合保存独立顺序，不改变材料的目录或父材料。归档（软删除）和恢复集合保留成员及顺序；已缺失材料的引用不会被重排静默丢弃，查询成员的 `available` 字段可识别它们。集合上限 10,000 个，每个最多 10,000 个去重引用；添加成员必须指向现有材料，重排必须完整列出当前可用成员。

## 重试与取消

调用者为一次逻辑请求生成稳定 `operationId`，只有完全相同的规范化请求可复用它。宿主将指纹绑定到当前学习库和调用者。收据与修改同一事务提交，保存失败不留下成功收据；重试已提交请求返回原结果及原修订号，`replayed: true`。撤销后重试不会重新执行。可用 `operationStatus(operationId)` 查询是否已经提交；CLI 查询外层额外返回 `found` 和 `receipt`。

成功收据重放不依赖内存预览；尚未提交的请求在重启或预览过期后需要重新预览。每库最多保留 100,000 条收据，达到上限会明确拒绝新写入，不静默删除幂等记录。取消发生在持久提交之后时，应按收据确认结果，不能假定已回滚。

`query`、`preview`、`apply` 接受 `AbortSignal`。插件停用、卸载、替换和切库会自动中止所属激活并拒绝迟到响应；不要把应用仓库、文件句柄或授权对象保存到插件数据中。

## 模型连接

插件在 manifest 声明 `permissions.models: true`，使用版本化类型 [`providers.d.ts`](../packages/plugin-api/providers.d.ts) 描述的 `nativePlugin('model.…', payload)` 接口。SDK 绑定激活 ID，原生宿主绑定学习库会话；插件不能选择别人的身份。设备配置、密钥、Codex 隔离登录和传输限制见[模型连接](MODEL_PROVIDERS.md)。

此接口目前由桌面 Rust 宿主实现。浏览器中的已有对话和草稿仍可查看，模型传输不可用时须明确说明，不能假定网页或插件有 Node 运行时。模型连接测试不代表用户账号具有某个模型或计费额度。
