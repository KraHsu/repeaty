# 共享设置控件示例

这个独立插件通过公开 SDK 1.6.0 的 `registerSettings` 注册配置视图，使用宿主提供的 `SettingGroup`、`SettingField`、`UiButton`、`UiIconButton` 和 `UiTextarea`。这些控件由宿主 Nuxt UI 绘制，插件不导入或打包 Nuxt UI、Reka UI 和 Vue 运行时，只声明标签、选项、值与业务动作。

在此目录运行：

```bash
npm install
npm run typecheck
npm run build
```

在 Repeaty侧栏「插件」安装生成的 `dist/settings-design-example.repeaty-plugin`，再通过「配置插件」或「设置 → 通用 → 控件示例」查看控件。管理页不挂载此配置视图。开发时可使用 `npm run dev` 监视此插件项目，重新构建后重新安装插件包。无需编译 Repeaty。

示例覆盖文本、密码、多行文本、数字、下拉选项、单选、多选、滑块、开关和勾选框，并展示说明、错误、只读、禁用和恢复默认。偏好通过 SDK 保存，使用插件自己的命名空间；滑块在拖动时预览，松手后保存。

编辑示例通过 `UiTextarea`绘制文本框，通过 `SettingField type="range"`绘制滑块，通过图标按钮清空、恢复临时草稿。组件引用的 `textareaRef`可访问原生选区与焦点，组字和键盘事件继续保留；草稿不保存。已弃用的原生样式指令不再用于本例。

SDK还提供 `SettingSection`划分插件内的功能、`UiStatus`显示简短状态、`UiNotice`展示提示和错误。本例侧重控件行为；其属性和页面层级见[设计规范](../../DESIGN_SYSTEM.md#插件设置的信息结构)。运行构建后的插件无需 Node.js。

密码框只演示输入遮蔽，输入的演示文字不会保存。真实凭据应通过设备凭据 API 管理，不能写入普通偏好。示例不会修改卡片、评分或学习进度。

[`src/Settings.vue`](src/Settings.vue) 是完整用例；共享组件的布局和类型约定见[设计规范](../../DESIGN_SYSTEM.md)。
