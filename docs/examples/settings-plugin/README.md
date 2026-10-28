# 共享设置控件示例

这个独立插件使用公开 SDK 1.3.0，导入 `SettingGroup`、`SettingField`、`UiButton`、`UiIconButton`、`vUiControl` 和 `vUiButton`。分组、控件、字体、焦点和窄屏布局均由宿主提供；插件只声明标签、选项、值与业务动作。

在此目录运行：

```bash
npm install
npm run typecheck
npm run build
```

在 Repeaty「设置 → 插件」安装生成的 `dist/settings-design-example.repeaty-plugin`。开发时可使用 `npm run dev` 监视此插件项目，重新构建后重新安装插件包。无需编译 Repeaty。

示例覆盖文本、密码、多行文本、数字、下拉选项、单选、多选、滑块、开关和勾选框，并展示说明、错误、只读、禁用和恢复默认。偏好通过 SDK 保存，使用插件自己的命名空间；滑块在拖动时预览，松手后保存。

原生编辑示例通过指令统一文本框和滑块，通过图标按钮清空、恢复临时草稿；插件仍持有原生引用、选区和键盘事件。此处滑块故意不设置可选的轨道进度变量，以展示默认样式，草稿不保存。

SDK 1.3.0 另提供 `SettingSection`划分插件内的功能、`UiStatus`显示简短状态、`UiNotice`展示提示和错误。本例侧重控件行为，尚未演示这三个结构组件；其属性和页面层级见[设计规范](../../DESIGN_SYSTEM.md#插件设置的信息结构)。

密码框只演示输入遮蔽，输入的演示文字不会保存。真实凭据应通过设备凭据 API 管理，不能写入普通偏好。示例不会修改卡片、评分或学习进度。

[`src/Settings.vue`](src/Settings.vue) 是完整用例；共享组件的布局和类型约定见[设计规范](../../DESIGN_SYSTEM.md)。
