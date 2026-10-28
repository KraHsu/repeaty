# 应用插件

[返回开发文档](DEVELOPMENT.md) · [LeetCode](LEETCODE.md)

设置与表单使用 SDK 的 `SettingGroup`、`SettingSection`、`SettingField`，状态和提示分别使用 `UiStatus`、`UiNotice`，操作使用 `UiButton`、`UiIconButton`；需要原生选区、代码缩进或现有表单结构时使用 `vUiControl` / `vUiButton`，与软件本体共享控件和状态样式。官方插件的编辑、答题、提交恢复及历史交互也使用这套接口。见[界面规范](DESIGN_SYSTEM.md)及[控件独立示例](examples/settings-plugin/README.md)。

本页描述当前开发分支的外置插件机制，尚未随新安装包发布。发布页既有的 0.27.0 安装包不代表本分支的实现，也不能作为这套插件机制的安装或 GUI 验收产物。

Repeaty 在运行时加载外置插件。官方答题历史、LeetCode 和第三方插件使用同一包格式与公开 SDK；安装、更新或移除插件不需要重新编译主程序。普通卡片渲染和缺失插件提示保留为核心能力。

插件的 JavaScript 在应用 WebView 中运行，共用宿主提供的 Vue。运行环境不是 Node.js，不提供 Node 文件系统、`require()` 或任意原生模块；桌面能力通过公开 SDK 调用。开发者可以使用 TypeScript 和 Vue 单文件组件，单独构建成可安装的 JavaScript 包。

安装和运行预构建插件的使用者无需安装 Node.js、npm 或编译器。编写和构建插件的开发者需要 Node.js 24.15+，以及 SDK 与插件自身的开发依赖。

## 安装与管理

1. 获取可信来源的 `.repeaty-plugin` 文件。
2. 在「设置 → 插件」页面选择插件包，核对标识、版本及所需能力后安装。同一标识的新包用于更新已有插件。
3. 可以关闭、重新启用、移除或重新加载插件。正在复习或编辑时，先结束当前操作，避免替换仍在使用的组件。

关闭题目插件后，相应题目暂停参与复习；关闭显示插件后隐藏其界面。移除插件代码保留卡片、调度、评分、练习、完整提交、草稿与插件数据；重新安装兼容的数据版本后可继续使用。通过安装包更新失败时显示具体错误，并保留此前的有效版本。手工替换目录文件后重新扫描，如新文件损坏或未获信任，则须修复、重新安装或确认启用，不能假定旧磁盘文件仍可恢复。

更新会暂存文件并重命名目录，不是跨崩溃的原子目录交换。若进程在切换期间意外退出，插件目录可能暂时缺失并留下中间目录；当前不自动恢复这些目录，可重新安装可信插件包恢复代码。题目、调度、评分、完整历史和插件业务数据保存在代码目录之外，不因代码路径暂时缺失而删除。

插件属于可信代码，与应用处于同一 JavaScript 环境，不是隔离沙箱。安装与启用意味着信任其代码。能力声明用于限制宿主提供的原生接口，不代表可以隔离恶意插件。

## 存放位置与复制目录

| 内容           | 桌面版                                                                             | 浏览器版                         |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| 已安装代码     | 学习目录的 `.repeaty/plugins/<id>/`，包含 `manifest.json`、`main.js`、`styles.css` | 独立浏览器存储中的插件副本       |
| 开关与显示设置 | 随当前工作目录保存，由 SDK 按插件命名空间读写                                      | 当前浏览器的插件设置，不写原目录 |
| 草稿等业务数据 | 按插件和工作目录作用域保存                                                         | 按浏览器学习库或试用作用域保存   |
| 登录凭据       | 设备私有的 `plugin-secrets.sqlite3`，不进入学习目录                                | 不提供桌面凭据能力               |
| 代码信任记录   | 设备私有，绑定插件包内容摘要                                                       | 用户在当前浏览器主动安装的代码   |

复制学习目录可以携带插件代码、设置及业务数据，但不会携带本机凭据或另一设备的代码信任。在新设备上，未知代码不会仅因出现在目录中而执行；用户须在插件页确认启用。外部替换插件代码后重新加载，内容摘要变化也会要求重新确认。

完整目录复制与 `.repeaty` 学习备份用途不同。学习备份保存笔记、评分和完整提交等学习内容，不隐式安装插件代码，也不包含设备凭据、信任记录或所有插件私有草稿。

浏览器只读打开工作目录时不修改原目录，也不自动执行原目录中复制来的插件代码。可安装的前端插件保存在浏览器副本中。原有网页制卡、复习、阅读、导入导出及前端插件能力仍可使用；需要原生网络或凭据能力的插件保留在桌面版。

## 插件项目与包格式

一个插件项目通常包含：

```
my-plugin/
  package.json
  manifest.json
  tsconfig.json
  src/
    index.ts
    Panel.vue
```

清单示例：

```json
{
  "id": "rating-count",
  "name": "Rating count",
  "version": "1.0.0",
  "apiVersion": 1,
  "dataVersion": 1,
  "kind": "frontend"
}
```

| 字段          | 含义                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `id`          | 稳定的插件标识：小写字母开头，可含小写字母、数字和连字符，最长 64 字符 |
| `version`     | 插件代码版本，如 `1.2.3` 或 `1.2.3-beta.1`，独立于主程序版本           |
| `apiVersion`  | 所需公开 SDK 协议版本，目前为 `1`                                      |
| `dataVersion` | 笔记中 `plugin.version` 的数据版本；修复代码时无需改变它               |
| `kind`        | `frontend` 不依赖桌面能力；`local` 需要桌面原生接口                    |
| `permissions` | 可选的桌面网络源、凭据和插件文件能力声明                               |

`flashcard` 和 `unavailable` 是宿主保留标识。安装包中的定义必须与清单的标识、种类及数据版本一致。

构建输出为 `dist/manifest.json`、`dist/main.js`、`dist/styles.css` 和 `<id>.repeaty-plugin`。后者是包含 `manifest`、`main`、可选 `styles` / `readme` 的 JSON 包，不是可直接执行的系统程序。当前单包读取上限为 8 MiB，入口代码上限 4 MiB，样式上限 1 MiB。

插件项目根目录的 `README.md` 会作为 UTF-8 文本打入 `readme`，同时输出到 `dist/README.md`；上限为256KiB，监视构建也会响应此文件的修改或移除。已有包可以不带说明。安装到学习库后，原始说明保存为插件目录中的 `README.md`，可在插件管理页的「介绍与使用」中阅读；配置页的「插件说明」操作会定位并展开该区域。

README用于功能简介、使用步骤、配置教程和数据说明，具体设置控件留在统一设置页。说明通过宿主现有的安全 Markdown 渲染，未知或关闭插件也可阅读，不会因此执行插件代码。说明的存在与完整内容参与包摘要，新增、修改或移除说明均须重新确认信任；无说明旧包的摘要保持不变。

## 独立开发与构建

公开 SDK 位于 [packages/plugin-api](../packages/plugin-api)。它提供类型和独立构建命令 `repeaty-plugin`，运行时实现由 Repeaty 提供。插件作者只需要 SDK、Vue 和自己使用的依赖，不需要复制或导入主程序源码。当前 SDK 与官方预构建包为1.5.0；这是 API v1的加法更新，官方插件的 `apiVersion` / `dataVersion` 仍为1。已有学习库需在「设置 → 插件」主动更新官方插件代码。

SDK 当前是本地 workspace 包，尚未发布到 npm。可以在 Repeaty 仓库根目录将它打包，然后在另一个独立插件仓库中安装生成的 tarball：

```bash
# Repeaty 仓库根目录
npm pack --workspace @repeaty/plugin-api

# 独立插件仓库；将路径替换为实际生成的 SDK 包
npm install vue
npm install --save-dev /path/to/repeaty-plugin-api-1.5.0.tgz typescript vue-tsc
```

类型从已安装的 SDK 包解析，不设置指向 Repeaty 仓库的 TypeScript `paths`，也不导入应用源码。插件的 package.json 可配置：

```json
{
  "type": "module",
  "scripts": {
    "build": "repeaty-plugin .",
    "dev": "repeaty-plugin . --watch",
    "typecheck": "vue-tsc --noEmit"
  }
}
```

在本仓库开发官方插件时：

```bash
npm ci
npm run typecheck --prefix plugins/review-history
npm test --prefix plugins/review-history
npm run build --prefix plugins/review-history
npm run dev --prefix plugins/review-history
```

`npm run dev` 监视插件自己的源码并重新构建到 `dist/`，不重新构建或启动 Repeaty。将 `dist/review-history.repeaty-plugin` 安装到应用即可验证修改。

开发时先在 Repeaty 中创建独立的临时学习目录，避免使用日常学习库。进入插件项目后，也可以把构建输出直接放入该测试目录：

```bash
npm run dev -- --outdir /path/to/test-library/.repeaty/plugins/review-history
```

Windows 可使用 `D:/tmp/repeaty-plugin-dev/.repeaty/plugins/review-history` 这样的绝对路径。等待构建成功后，在应用中点击「重新扫描插件」，再确认启用已变化的代码。监视构建不会自动执行或信任代码；复习或编辑期间先结束当前操作。整个流程不需要重新编译主程序。

仓库中的 [plugins/review-history](../plugins/review-history)、[plugins/leetcode](../plugins/leetcode) 和 [plugins/typed-answer](../plugins/typed-answer) 是独立项目；测试使用自己的宿主适配器，不导入主程序内部模块。

官方预构建包固定在 `plugins/packages/*.repeaty-plugin`。更新官方插件时，先独立构建、测试并更新对应包。`npm run build`、桌面构建和开发服务器只复制或提供这些已有产物，不编译插件源码，也不会在用户安装时调用 npm 或 Rust 编译器。

## 前端接口

在 `src/index.ts` 导出定义：

```ts
import type { ReviewPanelPlugin } from '@repeaty/plugin-api'
import Panel from './Panel.vue'

export default {
  id: 'rating-count',
  kind: 'frontend',
  label: 'Rating count',
  version: 1,
  reviewPanel: Panel,
} satisfies ReviewPanelPlugin
```

`Panel.vue` 使用公开类型和宿主共享的 Vue：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { t, type ReviewPanelProps } from '@repeaty/plugin-api'

const props = defineProps<ReviewPanelProps>()
const count = computed(
  () => props.reviews.filter((review) => review.cardId === props.card.id).length,
)
</script>

<template>
  <p>{{ t('Saved ratings: {count}', { count }) }}</p>
</template>
```

题目插件实现 `QuestionPlugin`：必须提供 `showQuestion`、`showAnswer`，可选 `editor` 和 `history`。编辑器通过 `NoteInput` 的 `v-model` 更新表单；显示插件实现 `ReviewPanelPlugin`，提供只读的 `reviewPanel`。配置由独立的 `registerSettings()` 接口注册，不作为插件详情页中的一块界面。

题面和答案通过 `QuestionProps` 获取当前卡片、媒体和读取回调。`state.allowedGrades` 控制可用评分，`busy` 表示处理中；`complete()` 只在评分成功保存后调用。练习回调携带当前工作目录作用域，插件不能用旧作用域写入另一个学习库。

历史数据可能只有提交摘要。用 `hasAttemptBody()` 判断，需要正文时调用 `getAttempt()`，关闭视图时取消并释放读取。通用 `PracticeHistory`、`AttemptBody`、`CardContent` 和 `MediaList` 由 SDK 提供，不需要导入宿主组件文件。

未知、关闭或数据版本不匹配的插件数据仍会保存、备份和导出；对应题目不进入复习队列，也不占每日额度。备份保存学习内容，不隐式安装或执行代码。

## 设置、存储与清理

「设置 → 插件」只管理安装、更新、启用、卸载、权限、包信息和使用说明。已启用插件的配置与软件配置一起进入左侧分类树：答题历史位于「学习 → 复习」，LeetCode 位于「连接 → LeetCode」。插件详情中的「配置插件」可直接定位相应分类和分组；配置分组的「插件说明」可返回详情。

在插件入口求值或激活工厂中调用 `registerSettings(contribution)`，返回函数可主动注销。每项贡献包含插件内唯一的 `id`、`title`、可选 `description` / `error`，以及二选一的 `fields` 或 `component`；`fields` 至少包含一项，每个字段的 `key` 唯一。

```ts
import { registerSettings, type SettingsContribution } from '@repeaty/plugin-api'
import { preferences, setPreference } from './preferences'

const configuration: SettingsContribution = {
  id: 'display',
  title: 'Review history',
  category: [
    { id: 'study', title: 'Study' },
    { id: 'review', title: 'Review' },
  ],
  fields: [
    {
      key: 'historyLength',
      type: 'number',
      label: 'Number of ratings',
      min: 1,
      max: 50,
      get modelValue() {
        return preferences.historyLength
      },
      onChange(value) {
        setPreference('historyLength', Number(value))
      },
    },
  ],
}
registerSettings(configuration)
```

普通字段复用 `SettingFieldProps`，额外声明唯一 `key` 和 `onChange`；类型、范围、选项、标签、错误与提交时机由宿主控件统一处理。标题、说明和值可使用 getter 跟随语言或插件状态更新。插件仍负责偏好读取、校验与保存，宿主不会将声明写成另一份设置文件。

`category` 是最多4层的路径，每段包含小写字母开头的字母、数字或连字符 `id`，以及非空的 `title`；同一路径内不能重复标识。宿主按完整标识路径合并软件和插件配置，例如 `study.review`，常规分类名称由宿主统一。选择父分类会显示其自身和所有子类内容。缺省归入 `general`，不为插件另建一套分类。SDK 导出共用 `SettingsCategory`、`SettingsContribution`、`SettingsField`，旧 `PluginSettingsContribution`、`PluginSettingField` 仍作为兼容别名。

凭据连接等复杂配置可注册 `component`，用 `SettingSection`、`SettingField` 和共享状态组件组织；组件只在相应设置分类挂载。分区支持 `title`、`description`、`level`（3或4）和 `#actions`。插件名称与总说明由宿主展示一次，字段帮助贴近控件；状态使用 `UiStatus`，错误或操作结果使用 `UiNotice`。长教程写入插件 README，在管理详情中查看。

注册随插件实例撤销：加载失败不发布新入口，更新失败保留原入口；关闭、卸载和切换学习库不会让旧注册进入新作用域，也不会删除保存的偏好。旧包的 `settings` 组件由宿主适配为配置贡献，入口同样只出现在集中设置中；新插件使用注册接口。

`UiStatus`提供中性、成功、警告、危险和忙碌外观，不自带实况播报；`UiNotice`支持信息、成功、警告和错误，可设置标题及操作插槽，默认语义分别为 `note`、`status`、`note` 和 `alert`，也可覆盖 `role`。字体和布局约定见[插件设置的信息结构](DESIGN_SYSTEM.md#插件设置的信息结构)。

复杂编辑器可在原生 `textarea`上使用 `v-ui-control="{ monospace: true }"`，保留原生 `ref`、选区、IME和事件；动作使用 `UiButton`或 `vUiButton`，评分使用 `rating`变体及四档 `tone`。共享控件只负责界面，插件继续负责草稿、校验、提交与资源回收。SDK1.5.0中的接口由配套宿主提供，使用新接口的插件需更新宿主；已有插件不会被自动更新。

- `readSetting()` / `writeSetting()` 管理当前插件的设置，宿主自动增加插件命名空间。可通过写入失败回调显示未保存状态。
- `pluginData.get()` / `set()` 按插件和工作目录作用域存储草稿等 JSON 数据；不会混用其他学习库的数据。
- `pluginFiles.read()` / `write()` 在声明 `files` 能力后访问插件自己的工作目录数据区。只接受相对路径，不能遍历父目录；当前单文件上限 2 MiB。
- 用 `onDispose()` 注册计时器、事件、订阅和请求取消的清理函数；也可以提供定义的 `dispose()`。更新、关闭、移除及切换作用域时会释放对应资源。
- 插件自行维护显示设置和词典；通过 SDK `locale` 响应语言切换，可调用 SDK `t()` 处理通用宿主文案。

## 桌面能力

`nativePlugin()` 仅调用通用宿主能力。`permissions.origins` 声明允许访问的 HTTPS 源，`secrets` 控制设备凭据存储，`files` 控制插件私有数据文件。宿主负责检查当前工作目录令牌、插件代码摘要、允许的源、响应体与文件大小，以及不安全路径和链接；凭据不会返回为普通插件配置值。

LeetCode 的请求、解析、账号状态、提交恢复和建议评分逻辑均在外置插件中。宿主只提供通用 HTTP、凭据和存储接口，不再编译 LeetCode 专用原生模块。网络测试使用受控响应，不向真实账号提交。

首次初始化空的插件目录时可装入软件随附的固定官方包；卸载后不会自动补回。其他安装和更新由用户主动执行。当前没有远程插件商店、后台下载第三方代码或后台自动更新。

插件管理和本地开发不等同于跨平台 GUI、安装包或发布验收；具体已完成的检查按实际运行记录。

## 本分支验证记录

2026-10-27，在 Windows 本地完成：

- 主程序单元测试在 `TZ=Asia/Shanghai` 和 `TZ=UTC` 下均为 501 项通过、1 项既有跳过；独立插件 36 项测试及各自类型检查通过。
- SDK 打包后，在仓库外的独立临时项目中安装并完成类型检查、Vue 插件构建和 `--outdir` 输出；不使用宿主源码、workspace 链接或指向仓库的类型路径。
- Chromium 静态完整回归 78 项通过；桌面浏览器回归分批覆盖全部 67 项。新增用例覆盖运行时创建的独立代码安装、界面和样式、开关清理、更新失败恢复、卸载保留数据、复制与修改包后的重新确认。
- 原生桌面 Rust 测试 29 项通过，其中通用插件宿主 15 项；包含 Windows junction / hardlink 拒绝、凭据修订、坏包移除和重装，以及与前端共用固定 SHA256 期望的校验。工作目录 Rust 测试 46 项、跨语言联测 41 项通过。
- 静态 `/repeaty/` 子路径、桌面和既有服务版前端构建通过，静态隔离与离线资源检查通过。既有服务版复习、历史和设置浏览器回归 3 项通过。
- Windows Tauri 调试客户端构建、真实 MCP stdio、Rust 格式与 Clippy、共享 Schema、发布元数据、28 项发布规则检查通过；未生成或发布新安装包。

桌面浏览器回归使用真实 Rust 学习库，并在测试夹具中适配系统对话框与插件 IPC；原生通用能力另外通过 Rust 测试验证。这些结果不等同于 Windows WebView 实机交互、macOS / Linux 新插件机制、客户端安装或正式发布验收。LeetCode 联网用例使用受控响应，不访问真实账号。
