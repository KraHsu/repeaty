# 题目插件

[返回开发文档](DEVELOPMENT.md) · [后端部署](SELF_HOSTING.md)

插件是 Repeaty 的应用模块。部署者将模块加入清单，重新构建并部署；用户在「插件」中选择开启或关闭。没有插件商店、远程脚本安装或浏览器扩展。

## 两类插件

| 类型       | 声明               | 安装位置                                        | 可用版本 |
| ---------- | ------------------ | ----------------------------------------------- | -------- |
| 纯前端插件 | `kind: 'frontend'` | `repeaty.plugins.static.ts`                     | 所有版本 |
| 本地插件   | `kind: 'local'`    | `repeaty.plugins.desktop.ts` 和桌面 Rust 注册表 | 仅桌面版 |

后端版和桌面版继承纯前端清单。默认前端清单为空，桌面清单内置 LeetCode。开源服务没有插件路由。构建选择清单与存储适配器，静态产物不包含账户客户端、Tauri 或 LeetCode 模块。

关闭插件保留题目与进度。要从安装包移除插件代码，需移出清单并重新构建。

## 前端接口

接口位于 [`src/plugins/types.ts`](../src/plugins/types.ts)：

```ts
interface QuestionPlugin {
  id: string
  kind: 'frontend' | 'local'
  label: string
  version: number
  showQuestion: Component
  showAnswer: Component
  editor?: Component
  description?: string
  settings?: Component
  history?: Component
}
```

`showQuestion` 与 `showAnswer` 接收 `QuestionProps`：

- `card`：当前题面、答案、调度状态与 `card.plugin.data`。
- `media`、`getMedia(id)`：媒体元数据与按需读取 Blob 的接口，兼容本地与服务端存储。
- `revealed`：宿主是否已经翻面。
- `state`：插件设置 `allowedGrades`、可选 `suggestedGrade`、`assessment` 与 `busy`。评分为 1 重来、2 困难、3 良好、4 简单；忙碌时宿主禁止评分。可提供 `complete()`，宿主仅在评分成功保存后调用。
- `workspaceScope`、`practices`、`attempts`：当前学习库作用域、当前卡片的练习和库内的提交记录。使用 `saveAttempt(practice, attempt, workspaceScope)` 保存原始提交；宿主核对作用域、所属卡片和状态转换。通过 `state.practiceId` 将本轮练习交给宿主，在用户确认评分时关联复习记录。

宿主负责复习队列、翻面、FSRS、持久化与撤销。`editor` 使用 `NoteInput` 的 `v-model`，写入 `front`、`back` 和 `plugin: { id, version, data }`。可复用宿主表单样式，校验自己的插件数据；组件卸载时清理计时器和网络请求。题目、答案应按文本或安全渲染器显示，不直接执行导入内容中的 HTML。

可选的 `history` 组件接收 `PracticeHistoryProps`：`practices`、`attempts`、`getAttempt(id, signal?)`、可选 `activeId` 和 `standalone`。它只显示已保存记录，不调用裁判或更新评分；历史代码成功显示后发送 `reveal(practiceId)`，由宿主记录未完成练习的答案查看状态。主导航和复习中的历史每页 20 次练习。没有对应组件或插件未启用时，宿主使用通用视图显示代码和结果，不加载插件专用界面。

`QuestionProps.attempts` 和 `PracticeHistoryProps.attempts` 接收 `AttemptRecord[]`，其中可能只有摘要。使用 `hasAttemptBody(record)` 判断；需要原始代码或裁判详情时调用 `getAttempt`，不能把未加载的 `code` 当作空字符串。关闭详情、切换题目或卸载组件时取消请求并释放正文；读取失败保留摘要并允许重试。宿主会核对账户、工作空间和记录状态。摘要仅供运行时使用，提交记录的备份与保存仍要求完整正文。

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

运行 `npm run dev`，添加卡片时选择「插件题目 → Typed answer」。`npm run build` 将示例打包到静态站点；`npm run build:server` 与 `npm run build:desktop` 也会包含它。示例默认不部署到本仓库的 GitHub Pages。

插件与应用在同一 JavaScript 环境执行，不是隔离沙箱。只安装信任的本地或 npm 模块；备份只携带数据，不安装或执行插件代码。

## 本地接口

本地插件的 Vue 模块仍实现上述接口，声明 `kind: 'local'`，注册到 `repeaty.plugins.desktop.ts`。原生部分实现 [`src-tauri/src/plugins.rs`](../src-tauri/src/plugins.rs) 的接口：

```rust
pub trait LocalPlugin: Send + Sync {
    fn id(&self) -> &'static str;
    fn call(&self, operation: String, payload: Value) -> PluginFuture<'_>;
}
```

在桌面启动时加入 `Plugins::new` 清单。前端通过 `localPlugin(id, operation, payload)` 调用；宿主使用 Tauri IPC，不借道上游 HTTP 服务。未知插件或操作返回错误，插件负责参数、目标域名和响应校验。新增原生模块需要重新编译桌面应用，不动态加载下载的库。

LeetCode 实现位于 `crates/leetcode-local`，只连接固定的中国站与国际站。Cookie 存于本机独立文件；学习库在上游时，判题仍由本机执行。凭据不放入 `card.plugin.data`。

原生命令只授权安装包内的主窗口，不授权远程网址；上游只提供学习数据，不提供执行代码。前端和本地插件均属于可信应用代码，不是安全沙箱。安装桌面插件意味着信任它访问本机所授权的资源。
