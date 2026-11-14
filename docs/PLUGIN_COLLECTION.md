# 来源连接器 SDK

SDK 1.11 在 `apiVersion: 1` 上增加 `registerSourceConnector`。官方 Obsidian / Readwise 与第三方插件使用相同注册、独立打包、按库安装和卸载清理流程；运行时不要求 Node.js。

```ts
import { registerSourceConnector } from '@repeaty/plugin-api'

registerSourceConnector({
  id: 'my-export',
  title: '我的导出目录',
  kind: 'directory',
  async scan(request, context) {
    const directory = request.directory
    if (!directory) throw new Error('请先选择目录。')
    const items = []
    for (const entry of directory.files) {
      context.signal.throwIfAborted()
      if (!entry.path.endsWith('.txt')) continue
      const text = await (await directory.read(entry.path)).text()
      if (!text.trim()) throw new Error(`文件正文为空：${entry.path}`)
      items.push({
        key: entry.path,
        path: entry.path,
        title: entry.path.split('/').at(-1)!,
        text,
        format: 'plain' as const,
      })
      context.progress({ completed: items.length })
      await context.yield()
    }
    return { items, complete: true }
  },
})
```

连接器声明 `directory`、`remote` 或 `hybrid`。可提供 `fields`（文本/选项字段）及 `credentialHint`，由统一连接界面绘制。`input` 和 `directoryId` 为宿主保留设置键。敏感配置通过原生凭据槽处理，不能放入 `settings` 或返回的材料。

`request` 包含连接 ID、只读普通配置、可选游标与授权目录。目录仅暴露相对路径、大小、修改标记及按需 `read(path)`；没有任意路径写入能力。宿主校验文件状态和目录授权，切库、关闭插件或替换注册后拒绝后续读取。长任务使用 `context.signal`、进度回调及 `yield()`；不得在主线程同步解析整库。

返回项使用稳定的 `key` 标识上游对象，正文、标题、格式、来源 URL 与资源作为一个候选。`resources` 为相对路径及 Blob；正文可使用 `repeaty-resource:` URI，引用同批资源。跨材料链接使用 `repeaty-source:${encodeURIComponent(key)}`，并在 `links` 提供 `targetKey`；宿主只解析同一连接中已接受的材料，缺失目标不跳转到其他库。

完整快照以 `complete: true` 返回，宿主才会根据缺少的身份推断删除。增量结果使用 `complete: false`，需要删除时显式提供 `deletedKeys`。分页、限流、重试、空正文、格式错误与读取失败应在返回之前解决；不完整结果不能伪称完整。单次最多 1,000 项，候选正文最多 250,000 个 UTF-16 字符，附件最多 10 MiB / 项，候选总字节最多 128 MiB。

`original` 可返回 `{ name, format, url }` 或 `{ name, format, path }`，目前支持 PDF / EPUB。它只用于用户明确选择后的原件导出。URL 不参与内容指纹、不写入学习库或备份；插件不得把 Token 或签名参数混入其他持久字段。

宿主负责连接的生命周期、检查周期、候选存储、版本比较和确认事务。扫描不能直接改写已接受材料；插件不自行建立第二套后台计时器。关闭插件不删除连接、候选、正文、卡片或历史；重新启用后可以继续检查。

## 批量导入的格式选择

宿主收集入口通过 `CollectionHostApi.importers?()` 获取可用导入器的 `pluginId`、`id`、`title` 与 `extensions`。同一文件匹配多个导入器时，界面必须让用户显式选择；`CollectionImportRequest.importers` 使用相对文件路径为键，值为 `${pluginId}:${importerId}`。预览和提交前均校验导入器仍有效；不按插件加载顺序选择。内置 `.md/.markdown/.txt` 优先使用宿主读取方式。

`prepareCollection` 只生成内存预览，不落库；`commitCollection` 使用预览修订号、选择项和操作 ID 保存整个批次，支持同操作重试去重；取消或过期后调用 `discardCollection` 释放预览。来源身份与内容均相同才复用已有材料，不跨不同文件身份按正文强行合并。

参见 [材料 SDK](PLUGIN_MATERIALS.md)、[收集与来源](COLLECTION.md) 和各插件包内 README。
