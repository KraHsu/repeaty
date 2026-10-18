# 题目插件

[返回开发文档](DEVELOPMENT.md) · [后端部署](SELF_HOSTING.md)

插件是 Repeaty 的应用模块。部署者将模块加入清单，重新构建并部署；用户在「插件」中选择开启或关闭。没有插件商店、远程脚本安装或浏览器扩展。

## 两类插件

| 类型       | 声明               | 安装位置                                   | 可用版本           |
| ---------- | ------------------ | ------------------------------------------ | ------------------ |
| 纯前端插件 | `kind: 'frontend'` | `repeaty.plugins.static.ts`                | 纯前端版、带后端版 |
| 带后端插件 | `kind: 'backend'`  | `repeaty.plugins.server.ts` 和 Rust 注册表 | 带后端版           |

后端版会继承纯前端清单。默认纯前端清单为空，后端清单内置 LeetCode。构建通过别名选择清单与存储适配器，`dist/` 不包含 LeetCode 代码、后端客户端或浏览器扩展下载包。关闭插件开关不会删除已打包代码；要从部署中移除，需移出清单并重新构建。

## 前端接口

接口位于 [`src/plugins/types.ts`](../src/plugins/types.ts)：

```ts
interface QuestionPlugin {
  id: string
  kind: 'frontend' | 'backend'
  label: string
  version: number
  showQuestion: Component
  showAnswer: Component
  editor?: Component
  description?: string
  settings?: Component
}
```

`showQuestion` 与 `showAnswer` 接收 `QuestionProps`：

- `card`：当前题面、答案、调度状态与 `card.plugin.data`。
- `media`、`getMedia(id)`：媒体元数据与按需读取 Blob 的接口，兼容两种存储。
- `revealed`：宿主是否已经翻面。
- `state`：插件设置 `allowedGrades`、可选 `suggestedGrade`、`assessment` 与 `busy`。评分为 1 重来、2 困难、3 良好、4 简单；忙碌时宿主禁止评分。可提供 `complete()`，宿主仅在评分成功保存后调用。

宿主负责复习队列、翻面、FSRS、持久化与撤销。`editor` 使用 `NoteInput` 的 `v-model`，写入 `front`、`back` 和 `plugin: { id, version, data }`。可复用宿主表单样式，校验自己的插件数据；组件卸载时清理计时器和网络请求。题目、答案应按文本或安全渲染器显示，不直接执行导入内容中的 HTML。

`data` 仅接受 JSON，最大 200,000 字符。每条插件笔记生成一张独立调度的卡片。插件 ID 唯一，采用小写字母、数字和连字符；`flashcard`、`unavailable` 为保留 ID。当前只加载与 `version` 完全匹配的数据，不自动迁移插件版本。

未知、关闭或版本不匹配的插件题目仍能保留、备份、导出；不会进入复习与专项练习队列，也不占每日额度。开关存于当前来源的 `localStorage`，同源标签页会同步开关；它不是服务端权限控制。

## 运行纯前端示例

[`examples/plugins/typed-answer`](../examples/plugins/typed-answer) 提供了完整的“输入答案”插件：输入内容与标准答案比较，忽略大小写及两端空白，匹配后允许选择四档评分。无需任何 API。示例文案使用英文，正式插件可提供自己的语言包。

将 `repeaty.plugins.static.ts` 改为：

```ts
import type { FrontendPluginInstallation } from './src/plugins/types'
import typedAnswer from './examples/plugins/typed-answer'

export default [
  { plugin: typedAnswer, enabledByDefault: true },
] satisfies FrontendPluginInstallation[]
```

运行 `npm run dev`，添加卡片时选择「插件题目 → Typed answer」。`npm run build` 将示例打包到静态站点；`npm run build:server` 也会包含它。示例默认不部署到本仓库的 GitHub Pages。

插件与应用在同一 JavaScript 环境执行，不是隔离沙箱。只安装信任的本地或 npm 模块；备份只携带数据，不安装或执行插件代码。

## 后端接口

带后端插件的 Vue 模块仍使用相同接口，额外声明 `kind: 'backend'`。在 `repeaty.plugins.server.ts` 注册它，并在 [`server/src/plugins.rs`](../server/src/plugins.rs) 实现与注册：

```rust
pub trait BackendPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn routes(&self) -> axum::Router<AppState>;
}
```

路由相对于 `/api/plugins`，例如 LeetCode 提供 `/api/plugins/leetcode`。共享访问密钥、来源校验与请求体限制；前端可复用 `src/backend/client.ts` 的 `api` / `apiJson` 发送请求。插件 ID 与前端一致，部署时加入 `REPEATY_PLUGINS`；未启用的后端模块不注册路由。

`GET /api/status` 返回 API 版本及已启用的后端插件 ID。前端据此禁用缺少后端支持的插件；服务端配置始终决定 API 是否可用。新增模块需要重新编译 Rust，不在运行时加载动态库。

后端插件负责外部请求的目标限制、认证与响应校验。内置 LeetCode 只支持固定的读取题目、提交和查询操作，固定访问 `leetcode.cn` / `leetcode.com`，不提供通用代理。登录信息只留在服务环境。
