# Omo Issue 管理工作流

- 状态：`in_progress`
- 优先级：P1
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`agent/issue-management-workflow`
- Worktree：`/private/tmp/omo-issue-management`
- 依赖：GitHub CLI 认证、GitHub Issues / Projects 写权限
- 推进模式：`manual`
- 可写路径：`.github/`、`docs/issue-management-workflow.md`、`docs/index.md`、`docs/decision-log.md`、`AGENTS.md`、`PLANS.md`、`plans/agent-issue-management-workflow.md`
- 禁止路径：`Omo/`、`backend/src/`、`backend/test/`、`api/`、部署配置与生产数据
- 高冲突文件唯一写者：Codex（`PLANS.md`、`AGENTS.md`、`docs/index.md`、`docs/decision-log.md`）

## 动机与证据

Omo 当前有 8 个开放 Issue，但都没有标签、Milestone 或讨论记录；部分 Issue 同时包含多个可独立验收的目标，Issue、PR、临时 Plan 和全局排期之间也没有稳定映射。用户已于 2026-07-29 明确批准建立统一 Issue 管理方案。

目标链路为：

`Issue 收集需求 → Project 排优先级 → 主题分支 + Plan 施工 → PR 验证 → Issue 关闭`

## 范围

- 建立 Bug、Feature、Product change 三类 Issue Form。
- 建立 Pull Request 模板，要求范围、Issue、Plan、文档和验证证据。
- 新增稳定 Issue 管理文档，并从 `AGENTS.md` 与文档索引链接。
- 在决定记录中登记 Issue / Project / Plan / PR 的职责边界。
- 建立精简标签、三个发布 Milestone 与 Omo Roadmap Project。
- 整理当前开放 Issue 的优先级、范围、负责人、Milestone、父子任务与阻塞关系。
- 把 PR #16 纳入对应 Milestone / Project，并保留其 Draft 与评审状态。

## 非目标

- 不修改 Omo iOS、后端、API、部署或生产数据。
- 不直接合并、关闭或改写任何开放 PR。
- 不把 Issue 中描述的产品功能顺带实现。
- 不用 Issue 替代分支内临时 Plan，也不在 Project 中复制 Plan 的逐项施工进度。

## 合同冻结

- 输入：现有开放 Issue、开放 PR、当前 `AGENTS.md` 与计划规范。
- 输出：仓库模板与稳定文档；GitHub 标签、Milestone、Project 字段；结构化后的现有 Issue。
- Schema / API：不改变产品 API；Issue 必填字段为问题与证据、目标、范围、非目标、验收、依赖、验证和风险。
- 兼容要求：保留原 Issue 的动机和作者表述；只追加或结构化，不静默删除事实。
- 失败语义：外部配置因权限或 GitHub 能力阻塞时记录为“未配置”，不得在文档中声称已经上线。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 仓库模板与稳定文档 | Codex | `agent/issue-management-workflow` / `/private/tmp/omo-issue-management` | `.github/`、`docs/`、`AGENTS.md` | YAML 解析、`docs:check`、`git diff --check` | 现有合同需要改变 |
| GitHub 标签与 Milestone | Codex | GitHub 外部配置 | Repo labels / milestones | 重新读取配置 | 权限不足或同名配置冲突 |
| Project 与 Issue 整理 | Codex | GitHub 外部配置 | Omo Roadmap、Issue #7–#14、PR #16 | 重新读取 Issue / Project | 会关闭 PR、删除数据或改变产品实现 |

## 任务

- [x] 创建并验证 Issue Forms 与 PR 模板。
- [x] 写入 Issue 管理稳定文档、索引和决定记录。
- [ ] 创建标签、Milestone 和 Project 字段。
- [ ] 拆分 #7 与 #8，建立父子任务和依赖关系。
- [ ] 整理 #9–#14 的结构、优先级、Milestone 与负责人。
- [ ] 把 PR #16 纳入全局视图，但不改变其 Draft / 合并状态。
- [ ] 完成仓库门禁与外部配置回读验证。

## 验收标准

- 新 Issue 通过表单获得最小可评审信息并自动进入 `needs:triage`。
- Project 能区分 Inbox、Ready、In progress、In review、Blocked、Done，并记录 Priority、Estimate 和迭代。
- 当前 8 个开放 Issue 均有清晰范围、优先级、Area、Milestone、负责人或明确待分配状态。
- #7 与 #8 的多目标范围被拆成可独立验收的子 Issue。
- #11 / #14 / #9 的已知阻塞关系可追溯。
- Issue、Project、Plan、PR 的职责和关闭规则进入稳定文档。
- 仓库变更通过主题分支 PR 交付，`main` 不被直接修改。

## 验证

- `npm --prefix backend run docs:check`
- `git diff --check`
- YAML 解析 `.github/ISSUE_TEMPLATE/*.yml`
- 回读所有新标签、Milestone、Project 字段和被修改 Issue。
- 明确区分仓库验证、GitHub 外部配置回执和未验证项。

## 原则检验

- 证据边界：只把 GitHub 回读结果写成已配置；计划中的未来动作不算完成。
- UI / 美学：不修改产品 UI；检查 Issue Form 的信息层级与中文可读性。
- 可访问性：表单字段使用清晰标签和说明，不仅依赖颜色表达优先级。
- 隐私与素材：Issue Form 提醒不得上传密钥、真实用户截图和个人信息。

## 决定记录

- 2026-07-29：用户批准采用 Issue → Project → Plan → PR 的统一管理方案。
- 2026-07-29：使用独立主题分支和 manual Plan，不直接在 `main` 修改。
- 2026-07-29：标签只表达类型、范围与风险；状态和优先级进入 Project 字段。
- 2026-07-29：仓库模板覆盖 Bug、Feature 与 Product / Contract change；稳定文档定义 Ready / Done 和部分覆盖规则。

## 阻塞与恢复

- 当前阻塞：无。GitHub CLI 已更新到 2.96.0 并重新完成 `starvingarc` HTTPS 登录。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：检查本计划任务列表、GitHub 当前配置与分支提交历史。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[plans/README]]
- [[docs/index]]
- [[docs/documentation-guide]]
- [[docs/decision-log]]
