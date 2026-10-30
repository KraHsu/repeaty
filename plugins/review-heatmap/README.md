# 复习热力图 · Review heatmap

在「学习概览」的卡组区域之后，用 GitHub 贡献图形式查看最近365天的正式复习次数。每列是一周，每行对应星期日到星期六；月份和星期标记帮助定位日期，绿色深浅表示当天评分次数。界面跟随软件的语言、字体与深浅主题。

## 安装与使用

在主侧栏打开「插件」，搜索「复习热力图」，点击目录行内的「安装」；也可通过页头「安装插件包」选择 `review-heatmap.repeaty-plugin` 文件。安装完成后插件保持关闭，通过详情右上角的开关单独启用。新建和已有学习库都需要主动安装，本插件不会默认预装。启用后进入「学习概览」即可查看，无需创建题目或添加页面。可随时在插件详情中关闭、重新启用或卸载。

已有旧版本时，在同一目录中找到热力图并点击「更新」，也可使用「可更新」筛选。插件不会自动更新；更新保留原启用状态和评分记录，关闭的插件不会因更新而启用。1.1.2 更新了本使用说明，日历与评分统计保持原有行为。

- 按设备当前本地日期统计，包含今天在内的365天，支持北京时间、UTC及夏令时切换。日历前后的占位格不属于统计范围。
- 悬停、键盘聚焦或轻点日期格，可查看完整日期与复习次数。方向键在日期间移动；窄窗口保留方格大小，在日历内部横向滚动，初始显示最近日期。
- 五档色阶依次表示0次、1–2次、3–5次、6–9次和10次及以上，图例由浅到深排列。次数较少和没有复习的日期也保留。
- 统计的是**正式评分次数**，不是不同卡片数：同一张卡片评分两次计为两次。专项练习中采用正式评分的记录也会计入；只练不改进度的练习、阅读与未提交的作答不计入。
- 数据来自当前学习库保存的正式评分摘要。撤销评分、恢复备份或切换学习库后，显示随当前数据更新。
- 页面打开期间跨午夜会更新日期；从后台或休眠恢复时也会重新检查。没有评分记录时保留空网格。
- 本插件没有额外设置，不更改 FSRS、调度或任何学习记录。关闭、卸载和重新安装都不会删除评分历史。

## 数据与权限

仅使用公开 SDK 提供的只读记录 ID、卡片 ID、评分和时间。无需联网、设备凭据或文件权限；不读取题目正文、代码提交，也不另外保存历史副本。插件代码随学习目录安装；网页中安装到独立浏览器副本，不写入只读打开的原目录。

## English

Review heatmap is an official external plugin for the Learning overview. It shows **formal rating counts** for the last 365 local calendar days, including today, below the deck section. The GitHub-style contribution calendar has one column per week and seven weekday rows, from Sunday to Saturday, with month and weekday labels. Dates, counts and the interface follow the host language and theme.

Open Plugins, search for Review heatmap, and choose Install on its directory row. You can also choose Install plugin package in the page header and select the `review-heatmap.repeaty-plugin` file. A new installation stays disabled; turn it on separately using the switch at the top right of its details. Both new and existing libraries require an explicit installation; the plugin is not preinstalled. You can later disable, enable or uninstall it from the same details. No extra page or question type is created.

For an older installation, choose Update on its directory row, or find it through the Updates filter. Updates are manual and preserve its enabled or disabled state and rating history. Updating a disabled plugin does not enable it. Version 1.1.2 refreshes these instructions without changing the calendar or rating calculations.

Hover, focus or tap a day to read its date and rating count. Use the arrow keys to move between dates. On narrow screens, scroll horizontally within the calendar; the most recent dates are initially visible. Five intensity levels represent 0, 1–2, 3–5, 6–9 and 10 or more ratings. Padding cells before and after the date range do not represent rating days.

Each saved formal rating counts once, including repeated ratings of one card and practice sessions that use formal scheduling. Practice-only attempts, reading sessions and unsubmitted answers do not count. Undo, backup restoration and library changes are reflected in the current data. The calendar refreshes at local midnight and after focus or visibility restoration, including daylight-saving changes.

The plugin consumes only read-only rating summaries through the public SDK. It requests no network, credential or file permissions and does not modify scheduling or learning history. Disabling, uninstalling or reinstalling it preserves the library's records.

## 独立开发 / Development

版本1.1.2，使用公开 SDK 1.7.0 的 `ExtensionPlugin` 与 `registerWidget()`。运行预构建包不需要 Node.js，也不需要重编译 Repeaty。开发时使用 Node.js 24.15+，安装依赖后在本目录执行：

```sh
npm test
npm run typecheck
npm run build
npm run dev
```

构建产物位于 `dist/review-heatmap.repeaty-plugin`。源码只依赖公开 `@repeaty/plugin-api` 和共享 Vue；宿主组件及运行时不会重复打包，插件源码不进入 Repeaty 本体构建图。生命周期测试覆盖午夜刷新、后台恢复及卸载清理。
