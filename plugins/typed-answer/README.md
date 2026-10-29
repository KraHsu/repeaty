# Typed answer

输入答案后再查看参考答案的示例题型，适用于桌面版和网页版。

## 使用

添加卡片时选择插件题型 `Typed answer`，填写题目和预期答案。复习时先在 `Your answer` 中输入答案；答案匹配后可使用全部评分，未匹配时只能选择重来。比较时忽略大小写与首尾空格。

此插件没有全局配置项。每张卡片的题目和预期答案在卡片编辑器中设置。

## 数据与权限

不需要联网、设备凭据或文件权限。题目、预期答案与学习进度保存在当前学习库中，关闭或卸载插件不会删除这些数据。

## 开发

本插件 1.6.0 也是公开 SDK 1.6.0 的独立项目示例，运行预构建包不需要 Node.js。修改源码时需要 Node.js 24.15+，插件通过 `@repeaty/plugin-api` 使用宿主接口，不导入主程序源码。Nuxt UI 控件与 Vue 运行时由宿主提供，插件包不重复打入这些库。

在仓库根目录安装依赖后，进入此插件目录运行：

```sh
npm test
npm run typecheck
npm run build
npm run dev
```

在主侧栏「插件」中安装 `dist/typed-answer.repeaty-plugin` 即可更新，无需重编译 Repeaty。独立开发方式见 [插件开发文档](https://github.com/KraHsu/repeaty/blob/main/docs/PLUGINS.md#独立开发与构建)。
