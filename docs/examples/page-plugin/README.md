# 独立页面插件示例

本目录保留为页面与组件注册的开发示例。日常使用热力图，请在软件「插件 → 安装或更新官方插件」中单独安装[官方复习热力图](../../../plugins/review-heatmap/README.md)，无需安装本示例的两个演示页面。

此示例使用公开 SDK 1.7.0 的 `registerPage()` 和 `registerWidget()`，安装后提供两个主侧栏入口和一块概览组件：

- 「页面容器示例」使用 `AppPage`，复用软件相同的标题、说明、右上角操作区及窄窗布局。计数只保存在页面内，离开后重新开始。
- 「自定义布局示例」直接渲染自己的布局，说明共享容器为推荐用法，并非强制。
- 「每日复习」显示在概览卡组区域之后，读取宿主提供的只读评分摘要，显示最近28个本地日期的评分次数；它不访问学习库内部模块或原生接口。

插件没有题型或复习面板。它导出 `type: 'extension'` 的 `ExtensionPlugin`，在激活工厂中注册页面和组件；纯扩展插件在激活时至少注册一项。现有题目插件和复习面板插件也可以调用相同接口。注册 `id` 在相应插件内唯一；不同插件可以使用相同的页面 `id`。

## 构建与安装

在此目录运行：

```bash
npm install
npm run typecheck
npm test
npm run build
```

在「插件」页安装 `dist/page-design-example.repeaty-plugin`。运行插件无需 Node.js，也无需重新编译 Repeaty。页面接口需要支持 SDK 1.7.0 的宿主；`apiVersion` 与 `dataVersion` 仍为1。

在独立仓库中使用时，先打包公开 SDK，再将 `package.json` 中的本地文件依赖替换为该 tarball：

```bash
# 在 Repeaty 仓库执行
npm pack --workspace @repeaty/plugin-api

# 在独立插件仓库执行
npm install --save-dev /path/to/repeaty-plugin-api-1.7.0.tgz
```

所有代码只从 `@repeaty/plugin-api` 和宿主共享的 `vue` 导入。不导入 Repeaty 内部源码，也不打入第二份 Vue、Nuxt UI 或 Reka UI。

## 页面与生命周期

宿主传入 `PluginPageProps.workspaceScope`，页面随插件注册实例和学习库重新挂载。组件内的临时状态不会跨库复用；监听器、计时器和异步请求应在 `onUnmounted()` 中释放或取消。`onDispose()` 则用于插件级资源，不代表页面每次离开。热力图使用 `PluginWidgetProps.reviews` 摘要，在本地午夜刷新日期，并在卸载时清理计时器。单测覆盖 UTC、北京时间和纽约夏令时切换。

`registerPage()` 返回幂等注销函数。关闭、卸载、更新和切换学习库会撤销旧入口并清理旧页面；更新失败保留有效的旧插件。当前页被移除后宿主回到安全的内置页面。插件自己的设置和数据不会因注销页面而删除。

页面标题使用 getter 跟随界面语言。可选的 `icon` 是 Vue 组件；未提供时使用宿主默认图标。`AppPage` 提供 `title` / `description` 属性，以及 `#description`、`#actions` 和默认内容插槽；它只是布局组件，不负责注册、存储或导航。
