# Omo 决定记录

本文件按时间追加重大且难以逆转的产品、合同、迁移、隐私、协作或关键依赖决定。不要静默改写旧记录；如果方向改变，新增一条并链接被替代决定。

## 记录模板

```markdown
## YYYY-MM-DD：决定标题

- 状态：accepted / superseded / reversed
- 决策者：
- 相关计划：

### 背景

问题、限制和证据。

### 决定

选择了什么。

### 理由

为什么这样选，以及拒绝了哪些替代方案。

### 后果

代码、数据、文档、团队和迁移影响。

### 验证或复审条件

怎样证明决定仍成立；何时需要复审。
```

## 2026-07-29：采用分支派生的幂等 Plan 生命周期

- 状态：accepted
- 决策者：Project owner / Agent handbook
- 相关计划：无；协作基础设施初始化

### 背景

Omo 同时包含 SwiftUI、Node.js、平台 Adapter、数据库、部署、公开文档和大量素材。多人 Agent 并行时，如果计划依赖全局编号、共享工作树或聊天中的隐式状态，容易发生覆盖、重复施工和不可追溯的范围扩张。

### 决定

- 复杂任务使用 `plans/<branch-slug>.md`。
- 计划身份由主题分支派生，不使用全局编号。
- [[PLANS]] 只索引当前 checkout 的活动计划，不充当跨分支数据库。
- 计划按创建、完成/取消、退役三个可追溯阶段提交。
- 依赖计划历史的 PR 不使用 squash merge。

### 理由

分支是 Git 中已经存在的并发隔离单位。用分支派生计划身份可以让创建、恢复、登记和退役保持幂等，同时由 Git/PR 历史承担跨 Agent 的长期追溯。

### 后果

- 主线通常保持空的活动索引。
- 每个并行 Agent 应使用独立分支/worktree。
- 临时计划完成后不留在工作树；稳定事实进入 `docs/`。
- 团队需要保留计划生命周期提交。

### 验证或复审条件

如果仓库未来强制 squash merge，必须先设计新的计划归档机制，再修改本决定。

## 2026-07-29：稳定文档与施工状态分层

- 状态：accepted
- 决策者：Project owner / Agent handbook
- 相关计划：无；协作基础设施初始化

### 背景

长期产品/工程事实与分支施工过程混在一起时，后续 Agent 容易把未来设想当成当前能力，或让已完成计划永久堆积。

### 决定

- `docs/` 只保存已实现、已决定且可复用的稳定事实。
- `plans/` 只保存当前主题分支的动机、范围、分工、进度和验收。
- 复杂任务完成时先把稳定结果迁入 `docs/`，记录完成证据，再退役临时计划。
- 内部文档通过双链形成可检查的图，由 `npm --prefix backend run docs:check` 验证目标存在。

### 理由

该分层让 Agent 能区分“系统现在是什么”和“当前分支准备怎样改变”，减少过时计划、孤岛文档和未经验证的能力声明。

### 后果

- 新稳定文档必须进入 [[docs/index]] 或被已索引文档引用。
- 代码、合同、素材或质量边界变化必须在同一 PR 更新稳定文档。
- 文档链接检查成为文档与计划变更的最低门禁。

### 验证或复审条件

当文档数量或链接规则显著增长时，复审现有双链检查是否需要增加标题锚点、孤岛检测或 CI 门禁。

## 2026-07-29：采用 Issue → Project → Plan → PR 的统一工作链路

- 状态：accepted
- 决策者：Project owner
- 相关计划：`plans/agent-issue-management-workflow.md`

### 背景

Omo 的开放 Issue 缺少统一标签、Milestone、验收和依赖；部分 Issue 同时包含多个可独立结果。若让 Issue、Project 和临时 Plan 同时复制任务状态，多人 Agent 会看到相互漂移的排期。

### 决定

- Issue 保存长期问题、动机、范围、验收和依赖。
- Omo Roadmap Project 保存跨分支状态、Priority、Estimate 和 Iteration。
- 复杂任务仍以分支派生的临时 Plan 冻结合同并记录施工证据。
- PR 保存实际 diff、Plan 历史、稳定文档和验证结果。
- 只有完整满足验收的 PR 使用 `Closes #N`；部分覆盖使用 `Refs #N`。
- 标签只表达类型、范围和风险，状态与优先级不在标签中重复维护。

### 理由

每一层只维护一种事实，能让需求长期追踪、分支施工和合并证据互相连接，同时保持 [[PLANS]] 的 checkout 局部性和幂等生命周期。

### 后果

- 新 Issue 通过结构化表单进入 `needs:triage`。
- 多目标 Issue 需要拆为父 Issue 和可独立验收的子 Issue。
- Project 状态变化不能替代代码、测试、真实环境证据或 PR 评审。
- 团队在 Issue 创建、开工、PR 创建／合入和阻塞变化时触发分诊；不设置固定短周期清理。

### 验证或复审条件

当维护 Project 的成本高于带来的全局可见性，或 GitHub 原生字段与自动化能力发生重大变化时，复审字段数量和自动化范围；不得退回到 Issue、Plan 和 PR 三处复制同一进度。

## 2026-07-29：生产依赖缺失时使用 readiness 与业务双重 fail closed

- 状态：accepted
- 决策者：Project owner / Codex
- 相关计划：`plans/fix-production-config-fail-closed.md`

### 背景

后端曾在 `QWEN_API` 缺失时自动返回本地演示卡，`/api/health` 无条件成功，JSON Store 写入失败时继续以内存状态响应。该组合会把模型、来源或存储依赖缺失误报为可用，并让 Fixture、本地能力和生产证据混在一起。

### 决定

- `/api/health` 仅表示进程存活；`/api/readiness` 负责模型、来源服务与存储依赖。
- 生产 readiness 不通过时，业务路由同步返回 `service_not_ready`。
- 缺失 Qwen 默认失败；Fixture 只能在非生产环境通过 `OMO_DEMO_MODE` 显式开启。
- 当前 JSON Store 明确为本地能力，在接入耐久 Adapter 前不满足生产 readiness。
- 上游错误只返回稳定码和安全消息；来源服务失败只能形成带原因的 `screenshot_only`，不能形成 `verified`。

### 理由

只依靠部署探针不能阻止仍被直接访问的实例返回伪成功；只拦业务请求又无法让编排平台停止导流。双重门禁同时保护部署和请求边界，并让 Fixture、降级证据与真实生产能力可区分。

### 后果

- Railway 健康检查改为 `/api/readiness`。
- 现有 JSON Store 的生产部署会保持未就绪，这是有意的安全状态，不是生产可用声明。
- 新部署使用 canonical Qwen / TikHub 变量；旧别名仅保留迁移兼容。
- 耐久存储、真实凭据 smoke 与目标环境 readback 必须由对应后续工作提供，不能由本计划的 Mock/本地测试替代。

### 验证或复审条件

接入并验证耐久存储 Adapter 后，更新 storage readiness 的实现与部署证据；若 TikHub 不再是生产必需依赖，必须先明确新的来源证据合同，再调整其 required 状态。

## 2026-07-29：PostgreSQL 使用显式顺序 migration 与过渡 owner 合同

- 状态：accepted
- 决策者：Project owner / Codex
- 相关计划：`plans/feat-postgres-persistence.md`

### 背景

生产 fail-closed 已明确拒绝 JSON Store，但直接在服务启动时自动建表、静默导入本地 JSON 或提前把 `X-Device-Id` 当账号，会混淆 migration 授权、数据来源和 #19 的身份边界。

### 决定

- `DATABASE_URL` 显式选择 PostgreSQL；配置存在但错误时不回退 JSON。
- migration 只通过显式 CLI 顺序执行，记录 checksum，并用 advisory lock 串行化；服务与 readiness 不自动修改 Schema。
- 当前 owner 是不透明的 `device` 过渡键，不是认证；#19 再定义账号、会话和旧 owner 迁移。
- 重复卡片保留首次 canonical 状态，assessment 使用数据库唯一 attempt 与版本 fencing。
- JSON 导入只能显式 dry-run／确认授权；生产恢复使用新数据库验证后切换，不提供破坏性 down migration。

### 理由

显式 migration 把生产副作用留在人工授权的发布步骤；checksum 和锁使多人／多实例执行可复核。过渡 owner 让存储先落地，同时避免把可伪造请求头误写成已完成账号体系。

### 后果

- 后端 Store 调用统一为可等待合同，非生产 JSON 仍兼容。
- PostgreSQL readiness 同时检查连接、版本和 checksum。
- #19 必须在现有 owner 合同上增加认证映射，不能把 `X-Device-Id` 直接升级为可信账号。
- #20 负责真实 Railway migration、连接池容量、备份权限、发布停止条件和部署 readback。

### 验证或复审条件

当 #19 冻结认证 subject 或 #20 确认 Railway/Postgres 网络与备份能力时，复审 owner 映射、TLS、连接池和迁移发布步骤；任何生产数据操作仍需新的 manual 授权。

## 相关文档

- [[AGENTS]]
- [[docs/index]]
- [[docs/issue-management-workflow]]
- [[docs/postgres-persistence]]
- [[docs/documentation-guide]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/quality-baseline]]
- [[plans/README]]
- [[PLANS]]
