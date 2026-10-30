# 插件学习服务

SDK `1.12.0` 提供顶层 `study` 导出，类型位于 [`packages/plugin-api/study.d.ts`](../packages/plugin-api/study.d.ts)。所有调用绑定当前插件激活实例及当前学习库；插件初始化尚未发布、停用、替换或切库后不能继续访问。

下面的调用用于插件页面挂载之后。`activate` 阶段只注册贡献；需要启动后台任务时，应等待宿主和学习库就绪，并在取消或卸载时停止等待。官方优化器的 `startup.ts` 提供了可取消的退避重试示例。

```ts
import { study, onDispose } from '@repeaty/plugin-api'

const controller = new AbortController()
onDispose(() => controller.abort())
const data = await study.statistics({ from: '2026-10-01', to: '2026-10-31' }, controller.signal)
const stop = study.subscribe(() => {
  // 刷新视图时合并连续事件，并丢弃旧请求的迟到结果。
})
onDispose(stop)
```

`statistics` 一次最多查询连续 366 天，返回学习日、记录覆盖起点、实际次数、活跃时长及当前安排。`statisticsDetails` 按日期和种类分页，每页最多 200 条；分页应核对 `workspaceScope` 与 `revision`，版本变化时从第一页重读。`null` 表示未记录，不等于零。日界线、正式评分和实际安排的口径见[学习说明](STUDY_SETTINGS.md)。插件应使用返回的 `today`，不要假设 UTC 午夜或系统午夜就是学习日边界。

`trainingState` 返回目标范围的记录数、候选、当前模型和活动状态。`trainingSnapshot` 建立有限期的不可变训练数据副本；调用方必须保留 `token`，并在任务结束后 `discardTraining(token)`。最多同时保留或准备八个快照，30 分钟过期；卸载会释放所属快照。

`submitCandidate({ token, weights, engine })` 只接受 FSRS-6 的 21 个权重，由宿主独立校验边界、历史、连续性及留出效果。调用方不能传入自己的成功标记或验证指标。取消、快照过期或历史变化会拒绝提交。候选和模型选择属于正常持久化事务，备份和撤销会保留它们。

`activateModel` 必须传入快照所属 `workspaceScope`；采用前再次核对历史和原生效参数。`rollbackModel` 要求 `expectedActiveModelId`，避免覆盖他人刚完成的选择。回退恢复该范围之前的显式选择；卡组之前没有覆盖时重新继承全库参数。两种操作都不修改既有 `due`。

`activity()` 提供前台、是否正在学习和空闲毫秒数。自动任务应避开学习和后台，并持续遵守取消信号。训练可用 `tasks.run`、`resources.createScope` 和 Worker 执行；不能假定宿主有 Node.js，不能直接写入数据库或绕过宿主候选校验。

实现示例为独立官方项目 `plugins/study-statistics` 与 `plugins/fsrs-optimizer`。它们通过 SDK 使用宿主的 `AppPage` 和统一控件；插件源码不进入宿主构建图。
