# 渐进阅读参考

[开发计划](../open-learning-runtime-roadmap.md) · [材料使用说明](SOURCES.md)

参考项目：[Foliole](https://github.com/campfirium/foliole)。以下记录基于其 `dev` 分支提交 [`708d977`](https://github.com/campfirium/foliole/tree/708d977634c87cd2464dfcfe65413fa45457a159)（2026-10-20 读取）；这是开发分支，后续评估以具体版本为准。

## 与当前功能的对应

| Foliole 中的做法                                               | Repeaty 的对应与选择                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 阅读时可以选择尽快再看、稍后再看、读过后再安排，或停止自动出现 | 目前采用明确日期的稍后阅读、待阅读和归档。保持操作可见、随时恢复；0.18.0 增加临时轮次与手动下一篇；0.22.0 已发布固定阶梯的递增间隔 |
| 选中文字后提取为子 Topic                                       | 0.19.0 以独立 Source 保存摘录；0.24.0 沿用直接父级出处支持多级提取、独立阅读与制卡                                                 |
| 文档可设 P0–P9 优先级，设置可沿父级继承                        | 当前只用高、普通、低，直接保存在 Source 上。每级摘录默认普通优先级，不继承父材料；不引入父级设置继承                               |
| 阅读与 FSRS 是两类队列，可配置混合比例和阅读间隔规则           | 0.26.0 增加显式开始的混合学习与按理解反馈调整的阅读间隔；两类记录分别保存，混合不改写卡片到期时间或每日额度                        |

对应源码与说明：[阅读操作](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/docs/i18n/guides/en/welcome-to-foliole.reading-break-the-whole-into-pieces.md)、[选区提取](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/docs/i18n/guides/en/welcome-to-foliole.highlight-extract-the-essence.md)、[优先级控件](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/src/app/components/DocumentPriorityControl.tsx)、[继承规则](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/src/features/nodes/model/nodeReviewSettings.ts)、[队列规则](https://github.com/campfirium/foliole/blob/708d977634c87cd2464dfcfe65413fa45457a159/lib/core/review/unifiedPushQueueRules.ts)。

## 后续评估顺序

1. 0.18.0 已实现“读一段 → 保存位置 → 下一篇”的手动轮次，顺序固定，失败不推进。0.22.0 用逐篇固定阶梯安排下次日期；0.26.0 在原模型上收尾自适应阅读与混合学习，规则按 Repeaty 的显式反馈、现有 FSRS 与保存边界确定，见 [ADR 014](adr/014-adaptive-mixed-study.md)。
2. 0.19.0 已实现独立一级摘录，保留正文快照、原文位置与卡片关联；0.24.0 沿用 Source 支持多级提取和出处导航，不重写笔记模型。
3. 重复文本、父快照替换、删除与备份均检查精确引用。0.24.0 对多级出处增加循环与深度校验。可编辑原文、PDF、网页或外部文件连接仍单独评估。

以上区分已实现范围与长期评估。手动优先级见 [ADR 007](adr/007-reading-priority.md)，0.18.0 的阅读轮次与生命周期见 [ADR 008](adr/008-reading-rounds.md)，0.19.0 的独立摘录见 [ADR 009](adr/009-independent-reading-excerpts.md)，0.22.0 的固定阶梯与手动日期边界见 [ADR 011](adr/011-progressive-reading-intervals.md)。

0.24.0 的批量安排、撤销、32 层出处与每日入口见 [ADR 012](adr/012-incremental-learning-core.md)，这些规则按 Repeaty 当前存储与个人开发范围确定。
