# UI 基础依赖归属

Repeaty 使用 Nuxt UI 的 Vue / Vite 集成。以下版本与许可证取自本地安装包及 `package-lock.json`；完整版权与许可文本保存在 [public/licenses/nuxt-ui.txt](../../public/licenses/nuxt-ui.txt)，构建时复制为 `licenses/nuxt-ui.txt`，随静态、服务器与桌面前端产物分发。设置分支菜单另有 [Branched Menu 归属声明](react-bits-branched-menu.LICENSE.md)。

| 安装包                                          | 版本    | 许可证                                |
| ----------------------------------------------- | ------- | ------------------------------------- |
| `@nuxt/ui`                                      | 4.12.0  | MIT                                   |
| `tailwindcss`、`@tailwindcss/vite`              | 4.3.3   | MIT                                   |
| `reka-ui`                                       | 2.11.0  | MIT                                   |
| `@floating-ui/core`、`@floating-ui/dom`         | 1.8.0   | MIT                                   |
| `@floating-ui/utils`                            | 0.2.12  | MIT                                   |
| `@floating-ui/vue`                              | 2.0.1   | MIT                                   |
| `@iconify/vue`                                  | 5.0.4   | MIT                                   |
| `@iconify-json/lucide`                          | 1.2.147 | ISC                                   |
| `@lucide/vue`                                   | 1.31.0  | ISC，含继承自 Feather 图标的 MIT 声明 |
| `tailwind-variants`                             | 3.3.1   | MIT                                   |
| `tailwind-merge`                                | 3.7.0   | MIT                                   |
| Nuxt UI 使用的 `@vueuse/core`、`@vueuse/shared` | 14.4.0  | MIT                                   |
| `defu`                                          | 6.1.7   | MIT                                   |
| Nuxt UI 使用的 `hookable`                       | 6.1.2   | MIT                                   |
| `@standard-schema/spec`                         | 1.1.0   | MIT                                   |
| `@internationalized/date`                       | 3.12.4  | Apache-2.0                            |
| `@internationalized/number`                     | 3.6.9   | Apache-2.0                            |

清单范围为本轮 UI 基础及相关交互依赖，完整依赖版本由锁文件记录。宿主已有的 VueUse 15 与 Nuxt UI 依赖的 VueUse 14 分别解析，许可文件保留的是本轮 UI 依赖副本。Lucide 集合的 `info.json` 指向 Lucide 上游 ISC 许可，分发声明同时保留安装包附带的 Lucide 和 Feather 完整版权文本。更新这些包时，应同步核对安装包中的 `LICENSE` / `NOTICE` 与上述分发文件。

`@tailwindcss/vite` 和 Nuxt UI Vite 插件在开发机生成前端 JavaScript、CSS 及本地图标数据；最终软件和离线页面无需 Nuxt 服务端、Vite 或 Node.js 运行时。图标来自本地 `@iconify-json/lucide` 集合与现有 Lucide Vue 组件；Nuxt UI 的扫描同时收集源码图标名称和默认组件图标。Iconify 运行时代码仍包含缺失图标的远程回退机制，因此新增动态图标时，应声明可被扫描的名称或加入 `icon.clientBundle.icons`，并验证断网使用。

静态构建通过 `scripts/check-static-build.mjs` 检查产物清单，确认没有桌面、Tauri、后端账号或 LeetCode 宿主实现，并核对每个 Service Worker 预缓存文件存在。检查完成后会删除仅供构建校验使用的 `dist/.vite/manifest.json`，复查该脚本前需有新的构建清单；不应把该清单加入离线缓存。
