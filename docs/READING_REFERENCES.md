# 渐进阅读参考

[开发计划](../open-learning-runtime-roadmap.md) · [材料使用说明](SOURCES.md)

参考项目：[Foliole](https://github.com/campfirium/foliole)。以下记录基于其 `dev` 分支提交 [`708d977`](https://github.com/campfirium/foliole/tree/708d977634c87cd2464dfcfe65413fa45457a159)（2026-10-20 读取）；这是开发分支，后续评估以具体版本为准。

## 与当前功能的对应

| Foliole 中的做法                                               | Repeaty 的对应与选择                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 阅读时可以选择尽快再看、稍后再看、读过后再安排，或停止自动出现 | 目前采用明确日期的稍后阅读、待阅读和归档。保持操作可见、随时恢复；自动间隔和轮换另立任务                    |
| 选中文字后提取为子 Topic                                       | 已有 Source 快照与 Note.excerpt，用现有编辑器制卡。以后若需要保留“摘录本身待阅读”，先验证独立片段的最小流程 |
| 文档可设 P0–P9 优先级，设置可沿父级继承                        | 当前只用高、普通、低，直接保存在 Source 上。尚无片段树，不引入父级继承                                      |
| 阅读与 FSRS 是两类队列，可配置混合比例和阅读间隔规则           | 保留阅读安排与 FSRS 评分的分别处理。当前只排序待阅读，不让阅读优先级改变卡片到期时间                        |

对应源码与说明：[阅读操作](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/docs/i18n/guides/en/welcome-to-foliole.reading-break-the-whole-into-pieces.md)、[选区提取](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/docs/i18n/guides/en/welcome-to-foliole.highlight-extract-the-essence.md)、[优先级控件](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/src/app/components/DocumentPriorityControl.tsx)、[继承规则](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/src/features/nodes/model/nodeReviewSettings.ts)、[队列规则](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/lib/core/review/unifiedPushQueueRules.ts)。

## 后续评估顺序

1. 根据实际使用确认是否需要“读一段 → 暂停 → 切换下一篇”的连续阅读操作，再确定手动轮换或自动间隔。
2. 若摘录需要多次提炼，再增加独立片段，保留来源快照、父片段、选区与卡片关联；不先重写笔记模型。
3. 用重复文本、原文变化、删除和备份样例验证引用恢复，然后再考虑 PDF、网页或外部文件连接。

这些是设计参考，不构成本轮交付承诺。0.17.0 的范围仍是手动阅读优先级，具体数据与兼容决定见 [ADR 007](adr/007-reading-priority.md)。
