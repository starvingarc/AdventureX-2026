# Omo Issue 管理工作流

本页定义 Omo 如何把长期需求转成可追溯的分支、Plan 和 Pull Request。Issue、Project、临时 Plan 与 PR 各自只维护一层事实，避免多人 Agent 重复排期或互相覆盖状态。

## 单一工作链路

`Issue 收集需求 → Project 排优先级 → 主题分支 + Plan 施工 → PR 验证 → Issue 关闭`

| 载体 | 负责 | 不负责 |
|---|---|---|
| GitHub Issue | 长期问题、动机、范围、验收、依赖与讨论 | 分支内逐项施工进度 |
| Omo Roadmap Project | 全局状态、优先级、估算、迭代与跨 Issue 视图 | 代码和验证证据本身 |
| `plans/<branch-slug>.md` | 复杂任务在当前主题分支内的合同、任务、决定和验证 | 跨分支全局排期 |
| Pull Request | 实际 diff、关联 Issue、Plan 历史、稳定文档和验证证据 | 未落地的未来设想 |

## Issue 入口

仓库提供三种 Issue Form：

- Bug：可复现错误、回归或失败语义。
- Feature：可独立验收的产品或工程改进。
- Product / Contract change：产品原则、API、Schema、证据、持久化或兼容行为变化。

新 Issue 默认带 `needs:triage`，并必须包含：

- 当前问题与证据；
- 目标结果；
- 范围与非目标；
- 验收标准；
- 父子任务、阻塞或外部依赖；
- 验证方法；
- 风险和敏感信息确认。

Issue 只接受可公开的最小证据；不得上传密钥、真实用户截图、个人信息、生产数据库、内部地址、完整模型请求/响应或未授权素材。

## Project 状态

Omo Roadmap 使用以下状态：

- `Inbox`：新进入、尚未完成分诊。
- `Ready`：范围、验收、负责人、依赖和验证已经明确。
- `In progress`：已有主题分支；复杂任务已有活动 Plan。
- `In review`：已有面向 `main` 的 PR，等待验证或评审。
- `Blocked`：有明确阻塞关系与解除条件。
- `Done`：验收全部满足并已合入。

Project 记录：

- Priority：P0 / P1 / P2 / P3。
- Estimate：S / M / L / XL。
- Iteration：当前两周周期或明确的后续周期。
- Linked pull requests、父 Issue 与子 Issue 进度。

状态和 Priority 不重复做成标签；Project 是全局视图，[[PLANS]] 只描述当前 checkout。
Project 默认保持私有，维护者按最小权限加入；仓库写权限不自动等于 Project 写权限。

## 标签

标签只表达三类稳定维度：

- 类型：`type:bug`、`type:feature`、`type:design`、`type:debt`。
- 范围：`area:ios`、`area:backend`、`area:product`、`area:infra`、`area:docs`、`area:assets`。
- 风险：`risk:production`、`risk:migration`、`risk:privacy`。

`needs:triage` 是新 Issue 入口标记。完成分诊后移除；阻塞状态使用原生 Issue dependency 与 Project 状态表达。

## Milestone

- `Motion-first stabilization`：当前召回主链、来源恢复、语义和交互稳定。
- `Production beta`：账号、持久化、生产配置、部署和真实环境门禁。
- `Knowledge library`：分类、语义搜索、知识图与详情体验。

Milestone 表示一个可观察的交付目标，不表示团队、代码目录或永久产品路线。

## Ready 门槛

Issue 进入 `Ready` 前必须同时满足：

- 只有一个可独立验收的主要结果；多个结果使用父 Issue 与子 Issue。
- 有明确负责人，或明确标记等待分配。
- 范围、非目标和验收标准完整。
- 已登记 blocked by / blocking 关系。
- 验证方法与真实环境边界明确。
- 已设置 Priority、Estimate、Area 和 Milestone。
- 涉及产品合同、生产、迁移、权限或隐私时，明确需要 `manual` Plan。

## 开工与评审

1. 从最新 `origin/main` 创建主题分支。
2. 在 PR 或分支提交中使用 `Refs #N` 关联范围。
3. 复杂任务按 [[plans/README]] 先提交 Plan，再开始实现。
4. 创建 PR 后把 Project 状态改为 `In review`。
5. PR 正文记录范围、Plan 生命周期、稳定文档、验证和未验证项。
6. 使用 Plan 的 PR 通过 merge commit 合入，不 squash。

只有在 PR 完整满足 Issue 验收时使用 `Closes #N`。部分覆盖使用 `Refs #N`；合入后缩小原 Issue 或创建剩余子 Issue，不提前关闭。

## Done 与触发式复审

Issue 只有在以下条件同时满足时进入 `Done`：

- 对应 PR 已合入 `main`；
- 验收标准全部满足；
- 代码、测试、稳定文档和验证证据一致；
- 未完成范围已经形成新的 Issue 或明确标为不计划；
- Project 与 Issue 状态已回读确认。

不设置固定的每周短周期清理。以下事件发生时立即完成对应分诊：

- 新 Issue 创建时，补齐范围、验收、负责人和依赖，或保留在 `Inbox` / `needs:triage`。
- Issue 进入 `Ready` 或开工时，拆分 XL / 多目标范围并复核负责人、依赖和验证。
- PR 创建时关联 Issue；PR 合入时复审相关 Issue 的关闭、缩小或解除阻塞。
- 负责人、优先级或阻塞关系变化时同步 Project；不得因为 Iteration 结束而自动关闭或清理 Issue。

## 相关文档

- [[AGENTS]]
- [[docs/index]]
- [[docs/documentation-guide]]
- [[docs/decision-log]]
- [[docs/quality-baseline]]
- [[PLANS]]
- [[plans/README]]
