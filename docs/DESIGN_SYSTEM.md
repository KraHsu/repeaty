# 共用界面与排版

软件本体和外置插件共用设置组件、原生控件指令与状态样式。覆盖设置、卡片编辑、复习、学习材料、应用弹窗，以及官方插件的编辑、提交、恢复和历史交互。插件管理展示详情、权限与安装操作，软件和插件配置通过同一贡献模型进入设置分类。

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

设置采用左侧分类、右侧内容。贡献的 `category` 是 `{ id, title }[]` 路径，软件和插件按相同路径合并；例如「连接」同时包含软件的 MCP 与插件的 LeetCode，「通用」可同时包含界面选项与插件字段。父分类展示自身和全部子类内容，没有单独的「插件设置」分类。旧包未声明分类时归入「通用」，宿主常规分类使用统一名称。

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

SDK包1.5.0是API v1的加法更新，配置贡献新增分类路径，保留既有控件、注册接口与 `PluginSettingField` / `PluginSettingsContribution` 类型别名。官方插件包同时更新为1.5.0，`apiVersion` / `dataVersion` 均仍为1。已安装插件不会被本体自动覆盖；在「设置 → 插件」点击「安装或更新官方插件」使用新版界面，原题目、评分和历史保留。官方插件继续单独构建为插件包，控件复用不引入插件源码到本体构建图。

## 编辑器与其他原生控件

普通设置优先使用 `SettingField`；需要直接操作选区、插入挖空、处理代码缩进或保留现有表单结构时，在原生元素上使用 `vUiControl`、`vUiButton`。二者与组件使用同一套控件样式，只维护自身的样式类，不替换元素，也不接管 `ref`、`v-model`、IME、选区、事件或业务保存逻辑。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { vUiButton, vUiControl } from '@repeaty/plugin-api'

const code = ref('')
const codeInput = ref<HTMLTextAreaElement>()
</script>

<template>
  <textarea ref="codeInput" v-model="code" v-ui-control="{ monospace: true }" aria-label="Code" />
  <button v-ui-button="'primary'" type="submit">Save</button>
</template>
```

`vUiControl`适用于 `input`、`select`、`textarea`、`progress`，自动识别复选、单选、滑块、文件选择等类型。`monospace`用于代码，`reading`使用阅读字号与行高，`swatch`保留颜色单选项的整块点击区域。隐藏属性、`type="hidden"`和 `.sr-only`控件不加外观类，避免影响由可见按钮触发的文件选择器。可见控件仍需原有的标签与错误关联。

原生滑块可通过 `--ui-range-progress`提供0%–100%的已选轨道比例；未设置时使用0%回退。`SettingField type="range"`会根据当前值与范围自动提供该变量，并保留松手或键盘修改完成后提交的行为。

`vUiButton`接受变体名或 `{ variant, icon, tone }`，也可用于原生链接与 `summary`操作；不会改变元素类型、默认提交或原生展开行为。新表单应明确按钮的 `type`。分页、筛选、只读及禁用状态沿用原有语义；材料阅读位置、评分、提交和弹窗按下 / 松开关闭规则由原业务组件管理。侧栏导航、材料列表标题和原生窗口操作保留各自角色与布局，不强行套用表单按钮尺寸。

## 滚动条

页面、弹窗、编辑器和插件共用滚动条变量。Chromium/Windows WebView2使用10px轨道、圆角滑块和悬停/按下配色，其他引擎使用标准属性回退。不隐藏滚动条，不替换滚轮、键盘、触摸或拖动逻辑。

高对比模式保留系统滚动条与原生控件，减少动画模式关闭过渡。无头Chromium的布局和样式检查不等同于其他平台实机验收。
