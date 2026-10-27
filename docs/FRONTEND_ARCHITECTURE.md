# 前端结构与状态归属

[开发文档](DEVELOPMENT.md) · [工作目录](WORKSPACE_MODE.md)

桌面与在线版共用 Vue 界面和应用服务，构建入口选择不同的存储与平台适配器。这次整理不改变界面、快捷键、目录格式或保存协议；产品版本仍为 0.27.0。

## 入口与调用路径

`main.ts` 为每个 Vue 应用创建 Pinia。`App.vue` 调用 `createApplication()`，提供带类型的应用上下文，并组合页面和弹窗。子视图通过 `useApplication()` 获取所需的状态和动作。

```text
main.ts → App.vue → app/createApplication.ts
                        ├─ app/views/       页面与弹窗
                        ├─ app/use*.ts      查询、导航、编辑、阅读、学习与备份控制器
                        └─ composables/useLibrary.ts
                              └─ stores/library.ts
                                    └─ application/library*.ts
                                          └─ 平台仓库 → Rust / IndexedDB / 浏览器试用副本
```

`App.vue` 从 1,896 行缩至 94 行；原来的 `useLibrary.ts` 从 1,059 行缩至 29 行。代码按已有责任移动，没有新增路由、持久化框架或第二份学习库。

| 位置                                 | 责任                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `src/app/views/`                     | 保持现有 DOM、样式和事件绑定；组合原有业务组件       |
| `src/app/useLibraryQueries.ts`       | 卡片读取缓存、到期数量、额度、卡组状态与学习统计     |
| `src/app/use*Actions.ts`             | 连接用户操作、组件方法、应用服务与通知               |
| `src/app/useApplicationLifecycle.ts` | 启动与关闭学习库，拥有全局快捷键、定时器和平台订阅   |
| `src/application/library.ts`         | 仓库生命周期、提交、修订检查、撤销与备份             |
| `src/application/library-*.ts`       | 卡组与笔记、阅读、外部文件、学习记录、导入导出的命令 |
| `src/application/scoped-actions.ts`  | 忽略切库或卸载后返回的旧操作结果                     |
| `src/core/`                          | 模型校验、调度、阅读安排等已有业务规则               |

应用服务通过 `Cell<T>` 接收状态，通过依赖参数接收仓库工厂和平台能力；不导入 Vue、Pinia 或组件实例。`useLibrary()` 保留原有 ref 接口，视图、MCP 和平台读取器可继续使用它。

## Pinia 管理哪些状态

采用 [Pinia 的 setup store](https://pinia.vuejs.org/core-concepts/)，按应用实例隔离共享状态。

| Store               | 内容                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `library`           | 学习库浅引用、作用域、就绪与保存状态、备份摘要、当前会话的撤销记录；委托应用服务执行命令 |
| `navigation`        | 当前页面、所选卡组、搜索与筛选、历史入口、学习入口、弹窗和主动分享的选区                 |
| `notifications`     | 通知队列、去重、关闭与上下文清理                                                         |
| `browser-workspace` | 在线试用的目录身份、修订号和未导出修改标记                                               |

学习库继续使用 `shallowRef` 和不可变快照；未变化的记录保留身份，评分继续按变更记录保存。Pinia 不自动持久化，也不把学习库复制到 localStorage。当前会话撤销可能暂存被删除的附件，仍由现有撤销边界清理，不作为备份格式。

仓库、目录句柄、Worker 和读取队列保留在服务或平台适配器中；计时器与事件订阅由挂载它们的组件管理。复习与阅读组件实例、编辑表单和临时轮次保留原有所有者，不放入全局 store。语言、偏好、插件设置和设备凭据仍通过已有适配器保存，不另建一份镜像状态。

组件外调用 `useLibrary()` 或其他 store 时显式传入所属 Pinia；测试也用 `createPinia()` 创建独立实例。应用卸载时调用 `disposePinia()`，释放该实例的服务。

## 异步操作与卸载

- 同一个 store 的并发初始化共用一个加载任务，避免重复打开仓库。
- 初始化、切库和关闭改变服务代次；迟到的旧加载、保存和错误不能覆盖新库。旧仓库每次只关闭一次。
- 已开始的保存先结束，再关闭仓库；关闭期间的响应不能重新填充界面状态。重新初始化等待旧保存及关闭完成。
- 备份列表同时核对仓库与请求顺序；界面操作结果同时核对学习库作用域和组件生命周期。
- 卸载后才建立的 MCP 读取器或目录监听立即取消；再次挂载不会保留上一轮订阅。

这些检查补足生命周期边界，不替代 Rust / IndexedDB 中已有的事务、修订检查和目录锁。

## VueUse 的使用范围

按 [VueUse 的作用域清理方式](https://vueuse.org/guide/best-practice)替换重复的界面副作用：

- 应用时钟与定时备份用 `useIntervalFn`，挂载后启动，卸载时停止。
- 全局快捷键、通知定位时的滚动 / 窗口变化、试用副本离开提示用 `useEventListener`。
- 通知栏尺寸变化用 `useResizeObserver`。

全局快捷键仍在子组件挂载后注册，保留复习与编辑器处理 `defaultPrevented` 的顺序。`SourceReader` 的字体加载、尺寸观察与位置恢复、文件读取队列、Worker 通信和仓库资源回收继续使用原有协议。

## 验证

状态与生命周期单元回归位于 `src/stores/stores.test.ts`、`src/app/useApplicationLifecycle.test.ts` 和 `src/application/scoped-actions.test.ts`，覆盖实例隔离、共享初始化、浅引用、卸载后的迟到订阅、关闭中的保存与重新打开。

```bash
npm test
npm run typecheck
npm run format:check
npm run test:workspace:native
npm run test:e2e
npm run test:e2e:desktop
```

同时运行两套浏览器测试时，分别给 Playwright 传入 `--output`，避免测试进程互相清理 trace。真实 Linux WebKit / Rust IPC 测试及前端资源打包步骤见[桌面本地验证](DESKTOP.md#本地验证)。浏览器测试和 Linux 结果不能代替 Windows / macOS GUI 验收。
