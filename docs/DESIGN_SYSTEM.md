# 共用界面与排版

软件本体和外置插件以 Nuxt UI 4 为统一组件基础，共用宿主主题、控件和交互语义。覆盖设置、卡片编辑、复习、学习材料、应用弹窗，以及官方插件的编辑、提交、恢复和历史交互。插件管理展示详情、权限与安装操作，软件和插件配置通过同一贡献模型进入设置分类。

## 字体层级

系统无衬线字体包含中文回退；代码使用等宽字体。不加载远程字体。所有字号使用 `rem`，跟随默认字号及页面缩放。

| 区域                       | 变量                                       | 默认字号 |
| -------------------------- | ------------------------------------------ | -------- |
| 说明、时间、状态、计数     | `--font-size-meta`                         | 14px     |
| 导航、按钮、表单、普通正文 | `--font-size-control` / `--font-size-body` | 16px     |
| 阅读正文、卡片问答         | `--font-size-reading`                      | 18px     |
| 分组标题                   | `--font-size-section`                      | 20px     |
| 页面标题                   | `--font-size-page`                         | 28px     |
| 首页主要统计               | `--font-size-display`                      | 32px     |

品牌单独使用30px；Markdown标题、公式和用户内嵌内容保留语义比例。行高为界面1.5、标题1.35、阅读1.75、代码1.6；字重使用400/500/600，品牌可用700。定义见 `src/styles/tokens.css`。新代码引用区域变量，不再增加零散字号；旧的 `--text-*` 别名保留。

## Nuxt UI 基础

项目继续使用 Vue / Vite / Tauri，通过 `@nuxt/ui/vite` 与 Vue 插件接入；无需 Nuxt 服务端或用户设备上的 Node.js。`config/ui.ts` 定义组件配置，`src/styles/nuxt-ui.css` 定义 Tailwind 主题色与字号映射；`style.css` / `controls.css` 只保留业务布局、排版和滚动条，位于 base / components 层，不覆盖组件库的控件皮肤。图标由本地 lucide 集合打包，不使用远程字体。Tailwind 关闭自动全仓扫描，仅扫描宿主与 Nuxt UI；图标扫描同样只读取宿主源码，插件维护自己的样式，更新插件无需重新生成本体 CSS。

| 公开组件 / 界面                         | Nuxt UI 实现                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SettingGroup / SettingSection           | UCard                                                                                              |
| SettingField                            | UFormField 与 UInput、UTextarea、USelect、USwitch、UCheckbox、URadioGroup、UCheckboxGroup、USlider |
| UiButton / UiIconButton                 | UButton                                                                                            |
| UiNotice / UiStatus                     | UAlert / UBadge                                                                                    |
| UiInput / UiTextarea / UiSelect         | UInput / UTextarea / USelect，薄适配保留输入法、原生引用和领域空值                                 |
| UiCheckbox / UiProgress / UiCollapsible | UCheckbox / UProgress / UCollapsible                                                               |
| AppModal / 复习菜单 / 历史分页          | UModal + UCard / UDropdownMenu / UPagination                                                       |

设置分类适配 [官方 Branched Menu](https://reactbits.dev/micro/branched-menu) 的 Vue 源码，使用 UButton / UCollapsible；保留原分支曲线、路径绘制与折叠动画，并扩展受控分类和键盘树导航。来源版本与许可见 [版权记录](third-party/react-bits-branched-menu.LICENSE.md)，完整许可随静态产物携带。

## 设置控件

分组有标题、可选说明及右侧操作。每行左侧为名称与说明、右侧为控件；窄分组自动上下排列，开关始终靠右。控件44px高、8px圆角，共用背景、边线、焦点及错误状态。

| `SettingField.type`              | 场景               | 默认提交               |
| -------------------------------- | ------------------ | ---------------------- |
| `text` / `password` / `textarea` | 短文本、密码、多行 | 输入时，中文组字结束后 |
| `number`                         | 有范围或步进的数值 | 修改完成时，无效值回滚 |
| `select` / `radio`               | 下拉或少量互斥选项 | 选择后                 |
| `multiselect`                    | 组合选择           | 每次选择后             |
| `range`                          | 连续数值           | 拖动本地预览，松手提交 |
| `switch` / `checkbox`            | 启停或独立确认     | 切换后                 |

`label`必填，`description`解释作用，`error`关联实际控件。`options`为 `{ value, label, description?, disabled? }[]`。支持范围、步进、单位、只读、禁用、占位文字和自动完成等原生属性；完整类型见 `SettingFieldProps`。`monospace`用于配置或代码，`layout="stack"`强制上下布局，`commit="change"`延迟文本提交。

文本输入先更新草稿，按业务保存，不逐字写学习库。保留原生键盘、标签点击、只读复制、忙碌及错误语义。

## 插件设置的信息结构

软件配置和插件配置共用 `SettingsContribution` / `SettingsField`，由 `SettingsContent` 使用相同的 `SettingField` 渲染。插件通过 `registerSettings()` 注册分组，声明类型、标签、值和 `onChange`；管理页不加载配置视图。分组标题20px、说明14px；字段名称16px、帮助14px。一个说明只放在所属分区或字段旁，不重复堆放段落。

设置采用左侧分支分类、右侧内容。贡献的 `category` 是 `{ id, title }[]` 路径，软件和插件按相同路径合并；例如「连接」同时包含软件的 MCP 与插件的 LeetCode，「通用」可同时包含界面选项与插件字段。父分类展示自身和全部子类内容，没有单独的「插件设置」或插件管理分类。旧包未声明分类时归入「通用」，宿主常规分类使用统一名称。

主侧栏的「插件」是独立管理页，展示详情、权限、安装信息和 README。「配置插件」进入设置中的相应主题分类，配置分组的「插件说明」返回独立插件页并展开使用说明。

分支分类使用树形菜单语义，展开箭头与分类选择分别操作。方向键移动、展开、折叠或返回父项，Enter / 空格确认选择；折叠分支不会改变当前配置，长名称保留完整的可访问名称与提示。

| 组件             | 用途                       | 约定                                                                                  |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `SettingSection` | 自定义配置视图内的功能分区 | 必填 `title`，可选 `description`、`level`（3或4）；操作放 `#actions`，不再套一层卡片  |
| `UiStatus`       | 简短状态芯片               | `tone` 为 neutral、success、warning、danger 或 busy；自身不创建实况播报区域           |
| `UiNotice`       | 需要解释或处理的提示       | `tone` 为 info、success、warning 或 error；可选 `title` 与 `#actions`，正文用默认插槽 |

账号连接等复杂配置可通过同一接口注册 `component`，继续复用这些组件。配置视图只在设置分类挂载；标题、说明与定位由宿主统一管理。关闭或卸载插件后撤销配置入口，原偏好和业务数据保留。

`UiNotice` 默认将普通信息和警告标为 `note`、成功标为 `status`、错误标为 `alert`，调用方可按上下文覆盖 `role`。普通字段帮助不使用实况播报。长操作说明放入插件 README，在管理页的「介绍与使用」中展开；配置页保留字段说明、状态和操作。版本、运行环境和权限各有名称与值，不把多项元数据拼成一句话。启用状态由统一开关表达，不在附近重复显示相同状态文字。

## 接入

本体从 `src/components/ui` 导入；插件从 `@repeaty/plugin-api` 导入同名组件，运行时复用宿主组件与样式。`SettingField`通过 `modelValue` / `update:modelValue`更新值；联合值类型需按字段转换，如开关 `$event === true`、文本 `String($event)`。

`SettingGroup`接受 `title`、`description`、`level`，通过 `#actions`放操作，嵌套分组用 `:level="3"`。`UiButton`默认 `type="button"`，表单提交时显式指定 `type="submit"`；提供 `primary`、`secondary`、`ghost`、`danger`、`rating`及 `disabled` / `busy`。评分使用 `rating` 和 `tone="again|hard|good|easy"`，保留四档语义色与间隔说明。`UiIconButton`用于独立图标操作，必须提供 `label`，默认同时作为可访问名称与悬停提示。

[独立示例](examples/settings-plugin/README.md)覆盖全部控件、校验和持久化，不是默认插件，不进入本体构建图。密码演示不保存，真实Cookie使用设备凭据API。

SDK 包与三份官方插件更新为 1.6.0，`apiVersion` / `dataVersion` 均仍为 1。插件编译器把公开组件映射到当前宿主，不将 Nuxt UI 或另一份 Vue 打进插件包。已安装插件不自动覆盖；在侧栏「插件」点击「安装或更新官方插件」使用新版界面，原题目、评分和历史保留。

## 编辑器与业务表单

配置优先使用 `SettingField`；编辑器或复杂表单使用公开的 `UiInput`、`UiTextarea`、`UiSelect` 等 Nuxt UI 组件。文本适配仅处理中文组字完成提交；下拉适配将领域中的空字符串与组件库保留空值分开。输入框暴露 `inputRef`，多行编辑器暴露 `textareaRef`，供原生选区、挖空、代码缩进与阅读位置使用。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { UiButton, UiTextarea, type UiTextareaInstance } from '@repeaty/plugin-api'
const code = ref('')
const editor = ref<UiTextareaInstance>()
function select() {
  editor.value?.textareaRef?.setSelectionRange(0, code.value.length)
}
</script>
<template>
  <UiTextarea ref="editor" v-model="code" :ui="{ base: 'font-mono' }" aria-label="Code" />
  <UiButton @click="select">Select</UiButton>
  <UiButton variant="primary" type="submit">Save</UiButton>
</template>
```

旧 `vUiControl` / `vUiButton` 导出只保留 API 兼容，不再用于软件与官方插件，也不再作为新插件的控件实现。隐藏文件选择器继续使用原生 input，由 Nuxt UI 按钮触发。颜色选择使用库组件，不维护自制选框或滑块。

AppModal 由 UModal 负责焦点范围和弹窗栈。背景仅在同一指针于背景按下且松开时关闭，内部拖出、忙碌、组合输入不能误关闭；Esc 和提交沿用原业务规则。全屏无变换的弹层容纳桌面标题栏，Snap 仍测量真实最大化按钮。插件安装 / 授信 / 卸载确认同样使用共享弹窗，确认前核对库作用域与包身份。

## 滚动条

页面、弹窗、编辑器和插件共用滚动条变量。Chromium/Windows WebView2使用10px轨道、圆角滑块和悬停/按下配色，其他引擎使用标准属性回退。不隐藏滚动条，不替换滚轮、键盘、触摸或拖动逻辑。

高对比模式保留系统滚动条和可访问控件语义，减少动画模式关闭过渡。无头Chromium的布局和样式检查不等同于其他平台实机验收。

## Nuxt UI 迁移验证（2026-10-28）

- 主程序在 UTC 和北京时间下分别通过 585 项单元，保留 1 项既有跳过；独立插件与 SDK 共 44 项通过，三插件与严格独立 SDK 示例类型检查、构建通过。
- 静态网页 84 个、桌面 HTML / IPC 夹具 83 个唯一用例均取得通过结果；最终构建另补验 3 项共用 UI、8 项桌面关键流程及嵌套标题栏。服务版账户历史与空库 2 项通过。
- 保留字号、缩放、选区、IME、保存失败、评分、偏好与完整历史断言。修复数值 / 单选同步、必需确认与卡组校验、阅读优先级回滚、清空错误字符串后的状态，以及表单展开动画导致下拉选项移出视口。
- 高级搜索表单关闭高度动画，使输入控件的定位保持稳定；设置分类继续使用 Branched Menu 动画。回归等待实际动画结束后检查选项完整位于视口内，再执行普通点击。
- 390 / 500px、200% 字号、长表单和滚动条截图检查通过；编辑器保留固定操作栏，原生嵌套 dialog 的夹具明确设置自己的布局，保留标题栏和关闭按钮的真实点击。
- 三种前端构建、静态模块隔离、离线资源与许可分发检查通过。以插件目录中的临时样式探针验证插件源码不会进入宿主 CSS 编译；无需预生成 Nuxt UI 模板的首次类型检查模拟亦通过。
- Windows 独立 Tauri 调试构建通过并嵌入最终前端；未启动或控制真实窗口，原用户进程及程序哈希不变。原生 Snap、拖动 / 缩放和跨平台人工验收保持待测。
