# 应用插件

[返回开发文档](DEVELOPMENT.md) · [LeetCode](LEETCODE.md)

设置与表单使用 SDK 的 `SettingGroup`、`SettingSection`、`SettingField`，状态和提示分别使用 `UiStatus`、`UiNotice`，操作使用 `UiButton`、`UiIconButton`。这些接口由宿主中的 Nuxt UI 绘制；官方插件的编辑、答题、提交恢复及历史交互使用同一实现。复杂编辑器使用 `UiInput`、`UiTextarea` 等公开控件，不导入 Nuxt UI 或软件内部模块。见[界面规范](DESIGN_SYSTEM.md)及[控件独立示例](examples/settings-plugin/README.md)。

本页描述当前开发分支的外置插件机制，尚未随新安装包发布。发布页既有的 0.27.0 安装包不代表本分支的实现，也不能作为这套插件机制的安装或 GUI 验收产物。

Repeaty 在运行时加载外置插件。官方答题历史、LeetCode、复习热力图和第三方插件使用同一包格式与公开 SDK；安装、更新或移除插件不需要重新编译主程序。普通卡片渲染和缺失插件提示保留为核心能力。

插件的 JavaScript 在应用 WebView 中运行，共用宿主提供的 Vue。运行环境不是 Node.js，不提供 Node 文件系统、`require()` 或任意原生模块；桌面能力通过公开 SDK 调用。开发者可以使用 TypeScript 和 Vue 单文件组件，单独构建成可安装的 JavaScript 包。

安装和运行预构建插件的使用者无需安装 Node.js、npm 或编译器。编写和构建插件的开发者需要 Node.js 24.15+，以及 SDK 与插件自身的开发依赖。

## 页面与界面扩展边界

SDK 1.14.0 增加[公开发布投影和受确认的网站连接](PLUGIN_PUBLISHING.md)。独立官方静态站、WordPress 与 Discourse 发布插件从插件页安装，配置注册到统一设置页，发布绑定随学习库保存，设备凭据不随库移动。操作方式见[发布学习材料](PUBLISHING.md)。

SDK 1.13.0 增加带宿主授权、预览、事务及幂等收据的[自动化接口](PLUGIN_AUTOMATION.md)，以及设备模型连接。独立官方[学习助手](../plugins/assistant/README.md)提供会话、授权材料问答和可审查的整理建议；通过插件页面安装、启停和卸载。

SDK 1.7.0 支持通过 `registerPage()` 注册独立页面及对应主侧栏入口，通过 `registerWidget()` 在学习概览的指定位置嵌入组件。题目插件、复习面板插件都可注册；只提供页面或嵌入组件的插件导出 `type: 'extension'` 的 `ExtensionPlugin`，激活时至少注册一项页面或组件。现有题目、答案、编辑器、历史记录渲染以及 `registerSettings()` 保持原接口。

SDK 1.8.0 增加材料导入器、阅读器、命令、搜索提供者及可取消任务；仅注册材料贡献的 `ExtensionPlugin` 也可以激活。独立材料插件通过宿主预览/事务完成导入、阅读、选区、摘录与制卡，保留文本投影供插件缺失时阅读。详细契约与边界见 [材料扩展 SDK](PLUGIN_MATERIALS.md)。

当前开发分支还提供离线包资源、材料附属资源、组件式材料命令、章节学习安排、区域批注与稳定插件卡片变体。三个新的官方插件均独立安装、构建和更新，源码不进入软件本体构建：

| 插件                                                      | 使用入口与能力                                                                               | 主要边界                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [PDF 阅读器](../plugins/pdf-reader/README.md)             | 材料页导入 PDF；连续阅读、缩放旋转、页码 / 章内搜索、跨页选区与精确回源                      | 原件最大 64 MiB；保留扫描页原图，不提供 OCR；不执行 PDF 脚本或外部链接                                       |
| [EPUB 与 HTML 阅读](../plugins/document-reader/README.md) | 材料页选择自由 / 顺序 EPUB，或 HTML 及其配套文件夹；保留目录、章节、图片、内部链接与离线位置 | EPUB 最大 32 MiB、99 章；顺序模式通过「完成本章」释放下一章；不支持 DRM，不自动加载远程资源，不执行活动 HTML |
| [图像与公式遮挡](../plugins/visual-occlusion/README.md)   | 导入图片后框选、批注、制卡；在 Markdown 材料中选择渲染后的公式元素制卡                       | 图片最大 10 MiB / 4000 万像素；每组最多 128 区域；公式保存固定渲染器与元素签名，不提供 OCR                   |

图片 / 公式区域各有稳定卡片身份。编辑时退役一个区域会停止出题，之后恢复该区域可恢复原调度、评分、练习和完整提交；重新画一个区域是新增卡片。桌面学习库、普通浏览器库和只读工作目录的试用副本都保留退役记录。JSON / `.repeaty` 备份包含这些记录、原件和资源，恢复时重新分配媒体身份并同步修正回源引用。停用或卸载代码不删除上述学习数据，备份恢复也不隐式安装插件代码。

软件的八个主导航页面使用共享 `AppPage`，同一实现通过公开 SDK 导出。建议插件独立页面使用它统一标题、说明、宽度、留白和操作区，也允许完全自定义布局；宿主不会在插件页面外强制再包一个 `AppPage`。插件设置、详情、历史记录及概览组件已经由相应宿主页面承载，不应再嵌套页面容器。可运行用例见[独立页面与热力图示例](examples/page-plugin/README.md)。

## 安装与管理

侧栏「插件」中的「安装或更新官方插件」展示软件随附的独立插件包，逐个选择「安装并启用」或「更新并启用」，只修改所选插件；同版本或已安装更新版本时不会覆盖。此入口不查询远程商店，也不自动更新插件。

1. 获取可信来源的 `.repeaty-plugin` 文件。
2. 在侧栏「插件」页面选择插件包，核对标识、版本及所需能力后安装。同一标识的新包用于更新已有插件。
3. 可以关闭、重新启用、移除或重新加载插件。正在复习或编辑时，先结束当前操作，避免替换仍在使用的组件。

官方「复习热力图」1.1.0 是可选插件，新旧学习库均需主动安装。安装后在学习概览的卡组区域下方，以 GitHub 贡献图形式显示最近365个本地日期的正式评分次数：每列一周、七行星期，月份与星期标签配合五档绿色深浅；悬停、聚焦或轻点日期可读取详情，窄窗在日历内部横向滚动。统计包含正式调度的专项练习，不包含纯练习、阅读或未提交作答。同一卡片多次评分分别计数，撤销评分会更新热力图。关闭后隐藏，重新启用恢复显示；卸载、刷新及重开不会自动安装回来，重新安装使用已有评分记录。已安装1.0.0时，需在官方插件列表主动选择1.1.0的「更新并启用」，不会自动更新。它不注册额外侧栏页面、不请求原生权限，也不改变 FSRS 或另外保存统计副本。详见[官方插件说明](../plugins/review-heatmap/README.md)。

关闭题目插件后，相应题目暂停参与复习；关闭显示插件后隐藏其界面。移除插件代码保留卡片、调度、评分、练习、完整提交、草稿与插件数据；重新安装兼容的数据版本后可继续使用。通过安装包更新失败时显示具体错误，并保留此前的有效版本。手工替换目录文件后重新扫描，如新文件损坏或未获信任，则须修复、重新安装或确认启用，不能假定旧磁盘文件仍可恢复。

更新会暂存文件并重命名目录，不是跨崩溃的原子目录交换。若进程在切换期间意外退出，插件目录可能暂时缺失并留下中间目录；当前不自动恢复这些目录，可重新安装可信插件包恢复代码。题目、调度、评分、完整历史和插件业务数据保存在代码目录之外，不因代码路径暂时缺失而删除。

插件属于可信代码，与应用处于同一 JavaScript 环境，不是隔离沙箱。安装与启用意味着信任其代码。能力声明用于限制宿主提供的原生接口，不代表可以隔离恶意插件。

## 存放位置与复制目录

| 内容           | 桌面版                                                                                                                | 浏览器版                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 已安装代码     | 学习目录的 `.repeaty/plugins/<id>/`，包含 `manifest.json`、`main.js`、`styles.css`、可选 `README.md` 与 `assets.json` | 独立浏览器存储中的插件副本       |
| 开关与显示设置 | 随当前工作目录保存，由 SDK 按插件命名空间读写                                                                         | 当前浏览器的插件设置，不写原目录 |
| 草稿等业务数据 | 按插件和工作目录作用域保存                                                                                            | 按浏览器学习库或试用作用域保存   |
| 登录凭据       | 设备私有的 `plugin-secrets.sqlite3`，不进入学习目录                                                                   | 不提供桌面凭据能力               |
| 代码信任记录   | 设备私有，绑定插件包内容摘要                                                                                          | 用户在当前浏览器主动安装的代码   |

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

构建输出为 `dist/manifest.json`、`dist/main.js`、`dist/styles.css` 和 `<id>.repeaty-plugin`。后者是包含 `manifest`、`main`、可选 `styles` / `readme` / `assets` 的 JSON 包，不是可直接执行的系统程序。当前单包读取上限为 40 MiB，入口代码上限 4 MiB，样式上限 1 MiB；包内资源单个最多 8 MiB、合计 24 MiB、最多 2000 个。资源路径必须是包内受限相对路径，不接受符号链接、绝对路径或目录穿越。

开发项目可以声明 `prepare:assets` 脚本，构建器在打包前执行它，再将 `assets/` 中的 Worker、字体、CMap、WASM 等离线依赖纳入包。安装预构建包不会执行这个开发脚本。资源参与包摘要与代码信任，更新资源也需要走同一插件更新流程；这不赋予插件 Node 运行时能力。

插件项目根目录的 `README.md` 会作为 UTF-8 文本打入 `readme`，同时输出到 `dist/README.md`；上限为256KiB，监视构建也会响应此文件的修改或移除。已有包可以不带说明。安装到学习库后，原始说明保存为插件目录中的 `README.md`，可在插件管理页的「介绍与使用」中阅读；配置页的「插件说明」操作会定位并展开该区域。

README用于功能简介、使用步骤、配置教程和数据说明，具体设置控件留在统一设置页。说明通过宿主现有的安全 Markdown 渲染，未知或关闭插件也可阅读，不会因此执行插件代码。说明的存在与完整内容参与包摘要，新增、修改或移除说明均须重新确认信任；无说明旧包的摘要保持不变。

## 独立开发与构建

公开 SDK 位于 [packages/plugin-api](../packages/plugin-api)。它提供类型和独立构建命令 `repeaty-plugin`，运行时实现由 Repeaty 提供。插件作者只需要 SDK、Vue 和自己使用的依赖，不需要复制或导入主程序源码。当前 SDK 为1.9.0，LeetCode 与 typed-answer 为1.6.0，答题历史为1.6.1，复习热力图为1.1.0，格式清理为1.0.0；官方插件的 `apiVersion` / `dataVersion` 仍为1。新增接口需要配套宿主，SDK 版本不会隐式更新已安装的软件。已有学习库需在侧栏「插件」主动更新官方插件代码。

软件与插件共用浅色、深色主题，默认跟随系统，在「设置 → 通用 → 界面 → 颜色模式」修改。SDK 控件自动跟随宿主；插件自定义绘图使用 `--ui-text`、`--ui-bg`、`--ui-border` 及语义色变量，避免固定白底或深色文字。答题历史1.6.1将评分圆点和圆环改为主题变量，已有库需更新该插件包；题目、调度、历史与设置不变。

SDK 当前是本地 workspace 包，尚未发布到 npm。可以在 Repeaty 仓库根目录将它打包，然后在另一个独立插件仓库中安装生成的 tarball：

```bash
# Repeaty 仓库根目录
npm pack --workspace @repeaty/plugin-api

# 独立插件仓库；将路径替换为实际生成的 SDK 包
npm install vue
npm install --save-dev /path/to/repeaty-plugin-api-1.7.0.tgz typescript vue-tsc
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

仓库中的 [plugins/review-history](../plugins/review-history)、[plugins/leetcode](../plugins/leetcode)、[plugins/typed-answer](../plugins/typed-answer) 和 [plugins/review-heatmap](../plugins/review-heatmap) 是独立项目；测试使用自己的宿主适配器，不导入主程序内部模块。

官方预构建包固定在 `plugins/packages/*.repeaty-plugin`。更新官方插件时，先独立构建、测试并更新对应包。`npm run build`、桌面构建和开发服务器只复制或提供这些已有产物，不编译插件源码，也不会在用户安装时调用 npm 或 Rust 编译器。

官方「格式清理」1.0.0 同样为可选插件。安装后提供独立的「格式清理」页面，使用统一 AppPage 和宿主控件选择材料、对比清理前后正文，并明确确认应用；规则配置进入「设置 → 工具 → 格式清理」。文字/正则替换始终保护代码和链接地址，运行于可取消且有超时的宿主 Worker。保存使用 SDK 1.9 的版本事务，支持全局撤销；停用、卸载或切换学习库不会删除正文、历史版本、卡片或调度。详见[格式清理说明](../plugins/format-cleanup/README.md)。

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

## 独立页面、侧栏入口与概览组件

在插件入口或激活工厂中注册页面：

```ts
import { locale, registerPage, registerWidget, type ExtensionPlugin } from '@repeaty/plugin-api'
import Dashboard from './Dashboard.vue'
import Heatmap from './Heatmap.vue'

export default () => {
  registerPage({
    id: 'dashboard',
    get title() {
      return locale.value === 'zh-CN' ? '学习看板' : 'Learning dashboard'
    },
    component: Dashboard,
  })
  registerWidget({
    id: 'activity',
    title: 'Review activity',
    placement: 'overview.after-decks',
    component: Heatmap,
  })
  return {
    id: 'learning-dashboard',
    kind: 'frontend',
    type: 'extension',
    label: 'Learning dashboard',
    version: 1,
  } satisfies ExtensionPlugin
}
```

页面声明包含插件内唯一的 `id`、非空 `title`、Vue `component`，以及可选 `description` 和 Vue 图标组件 `icon`。每个注册页面自动获得侧栏入口，标题可用 getter 跟随语言；未提供图标时使用宿主默认图标。页面标识按插件命名空间隔离，不会覆盖内置页面或其他插件的同名页面。当前接口不接受任意 URL、路由路径或自定义侧栏注入。

页面组件收到 `PluginPageProps.workspaceScope`，可通过既有 SDK 读写当前插件的设置或数据。推荐的页面结构为：

```vue
<script setup lang="ts">
import { AppPage, UiButton, type PluginPageProps } from '@repeaty/plugin-api'
defineProps<PluginPageProps>()
</script>

<template>
  <AppPage title="Learning dashboard" description="Your plugin's own content.">
    <template #actions><UiButton>Refresh</UiButton></template>
    <p>Page content</p>
  </AppPage>
</template>
```

`AppPage` 提供可选 `title` / `description` 属性、`#description` 富文本说明槽、`#actions` 操作槽和默认内容槽。它与软件使用同一实现，操作区在窄窗口整组换行，没有操作时不保留空列；容器本身不负责注册、存储或导航。自定义页面可不使用容器，但应保留标题语义、主题兼容和可访问操作名称。

`registerWidget()` 接受 `id`、`title`、Vue `component` 和 `placement`。当前开放 `overview.after-decks`（卡组区域之后）与 `overview.bottom`（概览底部）两处插槽。同一插槽采用稳定的插件安装/加载顺序，再按各插件内部的注册顺序展示；动态增加组件不会改变其他插件的相对位置。组件收到 `PluginWidgetProps.workspaceScope` 及只读 `reviews`；每条评分只提供既有 SDK `Review` 的 `id`、`cardId`、`rating`、`reviewedAt`，不包含题目正文或代码提交。可据此绘制复习热力图；日期应按用户本地日历归组，跨夏令时使用日历加减，不能把一天固定为24小时。这里不提供任意页面的DOM插入或完整学习库写权限。

两种注册均返回幂等注销函数，插件主动调用只移除对应注册。宿主在关闭、卸载、切库或成功替换插件时撤销旧入口并卸载视图；加载或更新失败不发布新注册。页面临时状态按注册实例和学习库隔离，旧作用域的延迟注册会被拒绝，当前页面失效时返回内置页面。注销不删除插件的持久设置或数据。组件的监听器、计时器和异步请求应在 `onUnmounted()` 中清理，插件级资源使用 `onDispose()`；宿主不能替插件释放其自行创建而未注册清理的资源。

## 设置、存储与清理

侧栏「插件」只管理安装、更新、启用、卸载、权限、包信息和使用说明。已启用插件的配置与软件配置一起进入左侧分类树：答题历史位于「学习 → 复习」，LeetCode 位于「连接 → LeetCode」。插件详情中的「配置插件」可直接定位相应分类和分组；配置分组的「插件说明」可返回详情。

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

SDK1.6.0提供 `UiInput`、`UiTextarea`、`UiSelect`、`UiCheckbox`、`UiProgress` 和 `UiCollapsible`。前两者是保留组字提交和 DOM 引用的薄适配；其余控件同样复用宿主 Nuxt UI。`UiSelect`通过 `items`声明选项，选择器是具有 `combobox`语义的按钮；`UiCheckbox`使用复选框语义控件，`UiProgress`使用 `modelValue` / `max`，`UiCollapsible`通过 `#content`提供折叠内容。动作使用 `UiButton`，评分使用 `rating`变体及四档 `tone`。

复杂编辑器的组件引用通过 `inputRef` / `textareaRef`访问原生元素：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { UiButton, UiTextarea, type UiTextareaInstance } from '@repeaty/plugin-api'
const code = ref('')
const editor = ref<UiTextareaInstance>()
function focusCode() {
  editor.value?.textareaRef?.focus()
}
</script>
<template>
  <UiTextarea ref="editor" v-model="code" :ui="{ base: 'font-mono' }" aria-label="Code" />
  <UiButton @click="focusCode">Focus code</UiButton>
</template>
```

`SettingField type="range"`使用 Nuxt UI 滑块，拖动中预览、松手或键盘调整完成后按 `commit`提交；数值步进按 `step`处理。兼容的 `step="any"`在滑块界面中使用百万分之一的步进；需要更精确的数值时使用 `type="number" step="any"`。

Nuxt UI、Reka UI、图标和 Vue 运行时由宿主提供，插件包不重复打入这些库；运行插件也不需要 Node.js。插件仍负责草稿、校验、提交与资源回收，新接口需要配套宿主。`vUiControl` / `vUiButton`保留为 deprecated 兼容导出，不再用于新插件或官方插件。

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

2026-10-28，SDK 与官方包 1.6.0 在 Windows 本地完成：

- 三个官方插件独立构建与类型检查通过，40 项插件测试和4项 SDK 构建测试通过。
- 打包后的 SDK 解包到独立测试项目，六个公开控件、`inputRef` / `textareaRef` 在 `strictTemplates` 和 `skipLibCheck: false` 下编译通过；该项目也通过 SDK 构建命令生成插件包。
- 三个官方包和独立测试包均引用宿主 Vue 与控件，未重复打入 Nuxt UI、Reka UI 或 Vue 运行时。共享控件11项单元测试通过，覆盖组字、数值回滚、选择控件、滑块键盘提交、动态清错与辅助语义。
- 宿主的 CSS 与图标扫描不读取插件项目。插件自己的布局样式由插件包分发，不依赖宿主扫描源码生成新的 Tailwind 工具类。独立样式探针和宿主模块隔离检查通过。
- 桌面插件相关28个唯一用例均通过，包含真实安装确认、README、凭据、历史、共享分类、200% 字号与严格独立 SDK 示例；最终构建相关4项再次通过。完整软件回归与原生验证边界见[界面规范](DESIGN_SYSTEM.md#nuxt-ui-迁移验证2026-10-28)。

2026-10-27，在 Windows 本地完成：

- 主程序单元测试在 `TZ=Asia/Shanghai` 和 `TZ=UTC` 下均为 501 项通过、1 项既有跳过；独立插件 36 项测试及各自类型检查通过。
- SDK 打包后，在仓库外的独立临时项目中安装并完成类型检查、Vue 插件构建和 `--outdir` 输出；不使用宿主源码、workspace 链接或指向仓库的类型路径。
- Chromium 静态完整回归 78 项通过；桌面浏览器回归分批覆盖全部 67 项。新增用例覆盖运行时创建的独立代码安装、界面和样式、开关清理、更新失败恢复、卸载保留数据、复制与修改包后的重新确认。
- 原生桌面 Rust 测试 29 项通过，其中通用插件宿主 15 项；包含 Windows junction / hardlink 拒绝、凭据修订、坏包移除和重装，以及与前端共用固定 SHA256 期望的校验。工作目录 Rust 测试 46 项、跨语言联测 41 项通过。
- 静态 `/repeaty/` 子路径、桌面和既有服务版前端构建通过，静态隔离与离线资源检查通过。既有服务版复习、历史和设置浏览器回归 3 项通过。
- Windows Tauri 调试客户端构建、真实 MCP stdio、Rust 格式与 Clippy、共享 Schema、发布元数据、28 项发布规则检查通过；未生成或发布新安装包。

桌面浏览器回归使用真实 Rust 学习库，并在测试夹具中适配系统对话框与插件 IPC；原生通用能力另外通过 Rust 测试验证。这些结果不等同于 Windows WebView 实机交互、macOS / Linux 新插件机制、客户端安装或正式发布验收。LeetCode 联网用例使用受控响应，不访问真实账号。

学习统计、个人 FSRS 参数及候选校验接口见 [插件学习服务](PLUGIN_STUDY.md)，软件中的设置和使用方式见 [学习安排](STUDY_SETTINGS.md)。
