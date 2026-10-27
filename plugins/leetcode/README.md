# LeetCode

这是独立的 Repeaty 插件项目。宿主只加载构建后的插件包，不编译这里的源码。

构建插件需要 Node.js 24.15+；在应用中安装和运行预构建包不需要 Node.js、npm 或编译器。当前外置插件机制仍在开发分支中，发布页旧安装包不代表这里的实现或 GUI 验收结果。

在仓库根目录安装开发依赖后，进入本目录运行：

```sh
npm test
npm run typecheck
npm run build
npm run dev
```

构建产物位于 `dist/`：`manifest.json`、`main.js`、`styles.css` 和 `leetcode.repeaty-plugin`。`npm run dev` 持续监视插件源码并重新构建；在 Repeaty 的插件管理页安装生成的包，无需重新编译主程序。

桌面开发时先创建专用的临时学习目录，不使用日常学习库。可以直接输出到该测试目录：

```sh
npm run dev -- --outdir /path/to/test-library/.repeaty/plugins/leetcode
```

Windows 可改为 `D:/tmp/repeaty-plugin-dev/.repeaty/plugins/leetcode`。等待构建成功后在应用中点击「重新扫描插件」，再确认启用改变后的代码；监视构建不会自动执行或信任代码。

插件通过已安装的 `@repeaty/plugin-api` 使用公开接口和类型，不导入宿主源码，也不设置指向 Repeaty 仓库的 TypeScript `paths`。运行时共享宿主的 Vue。

SDK 当前是本地 workspace 包，尚未发布到 npm。在 Repeaty 仓库根目录运行 `npm pack --workspace @repeaty/plugin-api`，然后在独立插件仓库安装生成的 tarball、Vue 及插件自身依赖，即可脱离应用源码进行类型检查和构建。详见[独立开发说明](../../docs/PLUGINS.md#独立开发与构建)。
