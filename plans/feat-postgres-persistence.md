# PostgreSQL 耐久持久化与迁移

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`feat/postgres-persistence`
- Worktree：`/private/tmp/omo-issue21.L9WAa7`
- 依赖：Issue #21；基线为已合入 PR #29 的 `origin/main@0751dc6`
- 推进模式：`manual`（用户已明确批准继续处理 #21；授权完成后推主题分支并创建 PR，不自动合并、不执行生产迁移）
- 可写路径：`backend/`、`README.md`、`docs/`、`PLANS.md`、`plans/feat-postgres-persistence.md`
- 禁止路径：`Omo/`、Railway/Vercel 生产项目、真实用户数据、PR #28 分支/worktree、其他主题分支
- 高冲突文件唯一写者：Codex 负责本分支的 `backend/package-lock.json`、`backend/migrations/`、`backend/test/store.test.js`、`docs/ios-api-data-contract-zh.md` 与 `PLANS.md`

## 动机与证据

PR #29 已让生产配置 fail closed；当前 JSON Store 被明确标记为非耐久存储，因此生产 readiness 必然包含 `durable_storage_unavailable`。Issue #21 要求用版本化 migration 建立 PostgreSQL 持久化，使卡片写入在进程重启后可回读，并覆盖重复写入、幂等 assessment、并发、删除竞争、失败回滚与恢复边界。

本机已确认有 PostgreSQL 17.10 的 `initdb`、`postgres`、`pg_ctl`、`psql` 与 Docker，但当前没有运行中的数据库。计划使用临时本地 PostgreSQL 集群和合成数据验证，不连接或迁移任何生产数据库。

## 范围

- 增加 PostgreSQL 连接配置、Store factory 和动态 storage readiness。
- 新增不可改写的顺序 SQL migrations、checksum、并发 migration lock 与状态检查。
- 持久化 owner、记忆卡、内部调度字段、assessment 幂等键与版本 fencing。
- 将服务端 Store 调用改为可等待的统一合同，同时保留非生产 JSON Store。
- 提供显式 migration CLI 与合成 JSON 导入工具；不在服务启动时自动运行 migration。
- 使用临时 PostgreSQL 验证空库、升级、重启回读、重复 capture、assessment 幂等、并发、删除竞争、失败与备份恢复。
- 更新 API/存储合同、质量基线、环境变量、README、决定记录和新的 PostgreSQL 运维文档。

## 非目标

- 不实现 #19 的注册、登录、登出、会话或权限；`X-Device-Id` 仍是不可信的过渡 owner key。
- 不执行 #20 的 Railway 部署、生产 migration、付费升级、真实备份或回滚。
- 不修改 iOS、UI、素材、召回交互、Qwen/TikHub Adapter 或 PR #28。
- 不实现多区域高可用、分析仓库、后台 worker 或跨账号合并。
- 不把本地 PostgreSQL、Mock、Fixture 或 HTTP 200 声称为生产验证。

## 合同冻结

- 输入：canonical `DATABASE_URL`；可选的连接池大小和连接/空闲超时使用明确的 `DATABASE_*` 名称。
- Store 接口：`list`、`get`、`save`、`assess`、`delete` 可以返回 Promise；server 对所有 Store 调用使用 `await`，JSON Store 保持兼容。
- Schema：owner 是不透明字符串；当前请求头只创建 `device` 类型 owner。卡片主体保留完整 JSONB，查询/调度所需时间与 `version` 单独列化；assessment `attemptId` 使用唯一约束。
- 重复 capture：同一 `(owner_id, card_id)` 首次写入为 canonical；重复 `save` 返回现有卡，不覆盖 assessment、mastery 或 schedule。
- assessment：事务内 `SELECT ... FOR UPDATE`、唯一 attempt、版本条件更新；重复 attempt 返回当前卡且不重复计数。
- 删除：硬删除 card，并由外键级联 assessment attempts；并发 assessment/delete 后不得复活卡片。
- Migration：只增加 `NNN_*.sql`；记录 checksum；并发 runner 使用 PostgreSQL advisory lock；服务不自动 migrate。
- Readiness：仅 `DATABASE_URL` 存在不等于就绪；必须连接成功且所有仓库 migration checksum 与版本匹配。输出只含安全 driver/status/reason。
- 失败语义：缺失/错误 URL、连接失败、migration 未应用/漂移、写入失败和 stale write 使用稳定安全码；不得返回连接串、SQL 参数、卡片 JSON 或驱动原始错误。
- 兼容要求：无 `DATABASE_URL` 时非生产继续使用 JSON；生产环境仍 fail closed。旧 JSON 数据只通过显式合成/人工授权的导入命令处理，不在启动时静默搬迁。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| Migration 与 Postgres Store | Codex | 本分支 / 本 worktree | `backend/migrations/`、`backend/src/` | 目标单元测试、临时 PostgreSQL 集成测试 | 需要改变身份合同或处理真实数据 |
| Server/readiness 与兼容 | Codex | 本分支 / 本 worktree | `backend/src/server.js`、`backend/src/runtimeConfig.js`、现有测试 | HTTP 合同、完整后端门禁 | 需要生产部署配置或 #19 会话 |
| 数据导入、恢复与稳定文档 | Codex | 本分支 / 本 worktree | `backend/src/`、`backend/test/`、`README.md`、`docs/` | 合成导入、dump/restore、本地文档检查 | 需要真实备份、生产权限或付费资源 |

## 任务

- [ ] 增加 PostgreSQL 配置校验、Store factory 与动态 readiness。
- [ ] 建立顺序 migration runner、checksum、并发锁和 migration 状态。
- [ ] 实现 Postgres owner/card/assessment 持久化与事务语义。
- [ ] 保持 JSON Store 非生产兼容，并让 server await 统一 Store 合同。
- [ ] 增加显式 migration/status 与合成 JSON 导入命令。
- [ ] 覆盖空库、升级、重启、重复、幂等、并发、删除与失败测试。
- [ ] 在临时 PostgreSQL 17 集群完成 migration、业务读写和 dump/restore。
- [ ] 更新稳定合同、运维文档、决定记录与验证边界。
- [ ] 完成范围匹配门禁，记录所有未验证的真实环境边界。

## 验收标准

- 干净 PostgreSQL 可通过顺序 migration 建立，已有旧 migration 的数据库可升级；checksum 漂移与并发 runner 有明确行为。
- 同一 owner 的卡片在关闭并重建 Store/服务后可回读，内部 schedule 与 assessment 状态不丢失。
- 重复 capture、重复 assessment、并发 assessment 与 assessment/delete 竞争保持 canonical、幂等且不复活卡片。
- 数据库缺失、连接失败、migration 未应用或写入失败不会返回伪成功；readiness 与业务错误不泄露秘密或数据载荷。
- JSON 数据迁移只能通过显式命令并使用合成测试；真实数据需要后续人工授权。
- 本地 PostgreSQL 完成备份/恢复演练；生产备份、部署和 readback 明确未验证。
- 代码、migration、环境变量、API 合同、质量基线和运维文档一致。

## 验证

- 计划创建：`npm --prefix backend run docs:check`、`git diff --check`。
- 依赖安装后：`npm ci --prefix backend --ignore-scripts`。
- 目标测试：migration、Postgres Store、readiness、合成 JSON import。
- 正式后端门禁：`npm --prefix backend run check`、`npm --prefix backend run test:all`。
- PostgreSQL 门禁：仓库提供的临时集群测试命令，使用本机 PostgreSQL 17.10 与合成数据。
- 通用门禁：`npm --prefix backend run docs:check`、`git diff --check`。
- 真实环境：不使用真实用户数据、生产 DATABASE_URL 或 Railway；这些不得记录为 Passed。

## 原则检验

- 证据边界：Mock、JSON、临时本地 PostgreSQL、真实部署分别报告。
- UI / 美学：不修改 iOS 或 HTML UI，无需 Simulator/浏览器视觉检查。
- 可访问性：不改变客户端可访问性树。
- 隐私与素材：SQL、错误和日志不得输出连接串、凭据、owner 原值、完整卡片或真实用户数据；测试只用合成值；不修改素材。

## 决定记录

- 2026-07-29：用户在 #29 合入后批准继续处理 Issue #21。
- 2026-07-29：严格遵守最新 `origin/main` 的 [[AGENTS]]；manual Plan 获批进入 `in_progress`，不自动合并 PR。
- 2026-07-29：服务不自动执行 migration；部署前由显式 CLI/发布流程应用，readiness 只检查。
- 2026-07-29：owner 保持不透明过渡键，不在 #21 提前定义 #19 的认证与会话。
- 2026-07-29：PR #28 仍独立 review；若其先合入，本分支从最新 main rebase 并保留 #29/#21 合同；若 #21 先合入，#28 后续 rebase，禁止本分支改写 #28。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：若需要生产 DATABASE_URL、真实数据、Railway 操作或身份产品决定，停止并请求新的人工授权。
- 下一位 Agent 从哪里继续：读取本计划、[[docs/quality-baseline]] 与 [[docs/ios-api-data-contract-zh]]，从 migration runner 和合成测试开始，不触碰 PR #28。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[docs/quality-baseline]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/decision-log]]
- [[docs/issue-management-workflow]]
