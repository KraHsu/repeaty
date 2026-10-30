# 插件发布接口

SDK 1.14.0 提供公开内容投影 `publishing` 与受授权的原生网络 `network`。静态站、WordPress、Discourse 官方插件使用同一接口，独立构建和按学习库安装，源码不进入本体构建。

## 选择与预览

```ts
import { publishing } from '@repeaty/plugin-api'

const index = publishing.list()
const snapshot = await publishing.prepare(
  {
    sourceIds: selectedIds,
    expectedRevision: index.revision,
    publicFields: ['author', 'tags'],
  },
  signal,
)

for (const source of snapshot.sources) {
  // Only these explicitly named fields are part of the public projection.
  // id/versionId are local binding identities; do not pass them into templates.
  for (const asset of source.assets) {
    const blob = await publishing.asset(snapshot.id, asset.id, signal)
    // Rewrite asset.reference to the generated public asset URL.
  }
}
publishing.validate(snapshot.id) // Before export or remote mutation.
publishing.release(snapshot.id)
```

`list()` 仅返回当前库的标题、身份及修订，用于用户选择。`prepare()` 只读取指定的材料，不自动包含子材料；最多 1,000 份、正文合计 32 MiB。草稿或标记为私有的材料会拒绝生成。正文开头的 YAML frontmatter 不直接输出；字段只允许明确指定的标量或字符串数组，拒绝内部身份、私有和凭据字段。未知嵌套属性不会默默转为公开 JSON。

明确传入空选择会生成空快照，可用于移除静态站中的全部文章。`links` 仅解析正文实际引用的材料身份，目标可以不在本次选择中，方便连接器查找先前的公开 URL；不会附带目标正文、字段或附件。内部 ID 不应直接输出到公开内容，尚无公开地址的链接需要明确处理或阻止发布。

快照的附件句柄仅指向这些正文实际引用的资源，不能传任意媒体 ID 读取原件或其他附件。附件 MIME 有白名单，单件不超过 25 MiB。原始 PDF/EPUB、注释、调度、历史、草稿、设备路径、凭据和插件私有数据不自动加入投影。正文中用户自行写入的内容仍需在发布前审查。

快照最多同时保留四份，有效期十分钟。准备时检查调用方提供的库修订；之后所选材料内容、属性、关联附件或链接解析身份变化时失效。纯学习时长或评分保存不会让未变化的公开预览失效，校验也不会重新读取正文。学习库替换、插件停用或卸载使快照失效；返回后还会复核作用域，不能用迟到读取继续发布。插件保存生成物和最终提交远端前都应重新验证；失败保留上一个完整结果，不把半份文件集标记为可发布。

## 网络与凭据

固定网站可沿用 manifest 的 `permissions.origins`。用户指定的网站声明 `permissions.network: true`，先调用 `network.authorize('https://example.org')`；宿主展示实际插件与完整 HTTPS origin，用户同意后才能访问。该授权仅保留在当前库的本次启用实例中，切库或重新启用后重新确认。普通 `nativePlugin` 不能直接调用内部的 `network.authorize` 操作。

```ts
import { network } from '@repeaty/plugin-api'
await network.authorize(new URL(site).origin)
const response = await network.request(
  {
    url: `${site}/api/posts`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(publicPost),
    secret: { slot: 'site-account', headers: { Authorization: 'Bearer {{token}}' } },
  },
  signal,
)
```

密钥通过已有 `nativePlugin('secrets', …)` 写入设备私有存储，不能放入 `pluginData`。原生宿主将凭据绑定到保存时的网站 origin，在发送时插入指定头；不跟随重定向。XML-RPC 可以使用同一 `secret` 的 `body: {template, encoding:'xml'}`，其中凭据插值由宿主进行 XML 转义；不能同时传普通 body。公开凭据状态不回传密钥。

XML 模板中的 `{{field}}` 专用于凭据插槽。文章、标题等用户内容需先进行 XML 转义，并将字面 `{`、`}` 编码为 `&#123;`、`&#125;`，再与凭据插槽组装模板，防止正文中的同形文字被当作凭据插值。插值在每次追加前检查输出限额。

网络请求支持字符串、base64 二进制或 multipart，完整类型见 [publishing.d.ts](../packages/plugin-api/publishing.d.ts)。请求体最多 32 MiB，multipart 单项最多 25 MiB，响应最多 8 MiB；超限明确拒绝。插件调用绑定本次启用实例，AbortSignal、停用、卸载和切库会取消相关请求；更改凭据会停止使用旧凭据的请求。不会因此中断其他插件实例。

## 发布结果和恢复

取消等待、超时和网络异常不代表远端回滚。连接器应在第一次远端写入前持久保存操作意图，以稳定的本地材料身份关联远端 ID。结果不明时先读取并核对远端，禁止直接重新创建。更新前再次核对内容、目标和修订；删除必须是用户明确选择的独立动作。

发布绑定和待核对记录保存到按库的 `pluginData`，随完整工作目录备份保留；凭据仍留在设备。恢复本地备份或撤销学习操作不会撤回已经发生的外部发布，必须重新核对远端。模板、模型输出和文章内容均不能授予网络访问权限。

插件仍是用户信任的 JavaScript；这些接口约束公开发布路径和资源生命周期，不是任意恶意插件代码的强沙箱。网页可以生成、预览和导出静态站；原生网络和设备凭据需要桌面版。
