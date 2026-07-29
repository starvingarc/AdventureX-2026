# 生产配置缺失时 fail closed

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`fix/production-config-fail-closed`
- Worktree：`/private/tmp/omo-issue18.m3AqeD`
- 依赖：Issue #18；与 PR #28 在 `backend/src/cardService.js`、`backend/test/store.test.js` 存在重叠，合并顺序为本计划先合入，#28 后续 rebase 并保留 fail-closed 合同
- 推进模式：`manual`（用户已明确批准处理 Issue #18、推送分支并创建 PR；不自动合并）
- 可写路径：`backend/`、`api/`、`README.md`、`railway.json`、`vercel.json`、`docs/`、`PLANS.md`、`plans/fix-production-config-fail-closed.md`
- 禁止路径：`Omo/`、PR #28 的分支与 worktree、其他主题分支
- 高冲突文件唯一写者：Codex 负责本分支的 `backend/src/cardService.js` 与 `backend/test/store.test.js`

## 动机与证据

当前 `createMemoryCard` 在 `QWEN_API` 缺失时直接返回“本地演示卡”，`/api/health` 始终返回成功，JSON 存储写入失败时退化到内存并继续响应。这会让缺失生产配置、模型不可用或存储不可用被误报为业务成功。环境变量还同时存在 `BASE_URL` / `QWEN_*` 与误拼的 `TICKHUB_API_KEY`，部署和文档无法形成单一合同。

## 范围

- 集中读取并校验 Qwen、TikHub、Fixture、存储与运行环境配置。
- 把 `/api/health` 明确为 liveness，新增稳定的 `/api/readiness`。
- 生产依赖未就绪时让 readiness 与业务请求 fail closed。
- 默认禁止演示回退；只允许非生产环境显式开启 Fixture。
- 对模型缺失、上游失败、超时、无效响应和存储写入失败返回稳定、安全的错误码。
- 统一 canonical 环境变量并保留有标记的兼容别名。
- 更新部署健康检查、API 合同、质量基线、决定记录和测试。

## 非目标

- 不实现 PostgreSQL 或其他耐久存储 Adapter；在实现前生产 readiness 必须明确失败。
- 不扩展 TikHub 平台覆盖或来源匹配策略。
- 不修改 iOS、UI、素材或 PR #28。
- 不执行真实生产部署，不使用或索取 Qwen、TikHub、数据库密钥。
- 不合并本计划产生的 PR。

## 合同冻结

- 输入：运行环境变量与现有 HTTP 请求；Fixture 仅通过 `OMO_DEMO_MODE=1` 或 `true` 显式开启。
- 输出：`/api/health` 仅证明进程可响应；`/api/readiness` 返回无敏感信息的依赖检查、阻塞码和 200/503。
- Schema / API：业务错误返回 `{ code, message }`；来源降级使用 `sourceStatus=screenshot_only` 与稳定 `sourceReason`，不伪装为 `verified`。
- 兼容要求：canonical 名称为 `QWEN_BASE_URL`、`QWEN_MODEL`、`QWEN_TIMEOUT_MS`、`TIKHUB_API_KEY`、`TIKHUB_BASE_URL`、`TIKHUB_TIMEOUT_MS`；只在代码中兼容旧 `BASE_URL`、`AI_MODEL`、`MODEL_REQUEST_TIMEOUT_MS`、`TICKHUB_API_KEY`，文档和示例不再推荐旧名。
- 失败语义：模型未配置为 503，上游不可用或无效响应为 502，模型超时为 504，存储不可写为 503；不得返回上游响应正文、密钥或完整模型载荷。
- 生产门禁：Qwen、TikHub 与耐久存储任一未就绪时 `/api/readiness` 返回 503，业务路由返回 `service_not_ready`；当前 JSON Store 只允许本地/测试，不被声明为生产就绪。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 配置、readiness 与业务门禁 | Codex | 本分支 / 本 worktree | `backend/src/`、`api/`、部署配置 | 后端合同测试、语法检查 | 需要新增真实存储 Adapter 或改变 API 合同 |
| Fixture、上游与存储失败测试 | Codex | 本分支 / 本 worktree | `backend/test/` | `npm --prefix backend run test:all` | 需要真实密钥或外部部署 |
| 稳定文档 | Codex | 本分支 / 本 worktree | `README.md`、`docs/` | `docs:check`、`git diff --check` | 文档必须声称未经验证的生产能力 |

## 任务

- [ ] 新增集中配置校验与纯函数 readiness 合同。
- [ ] 移除默认演示成功，只保留显式非生产 Fixture。
- [ ] 为 Qwen 与 TikHub 上游失败提供稳定且不泄密的语义。
- [ ] 让 JSON Store 写入失败回滚并返回失败，不静默退化为成功。
- [ ] 新增 liveness/readiness 与生产业务门禁。
- [ ] 统一环境变量、部署探针与稳定文档。
- [ ] 覆盖缺失、错误、超时、无效上游与存储失败测试。
- [ ] 完成范围匹配验证并记录未验证的真实服务/部署边界。

## 验收标准

- 缺失必需配置时，readiness 或业务请求明确失败；生产环境不能开启 Fixture。
- Qwen、TikHub 或存储不可用时不产生伪造的模型、来源核验或持久化成功。
- 代码、`.env.example`、部署配置与文档使用一致的 canonical 环境变量。
- 错误响应和日志不包含密钥、上游正文或完整模型请求/响应。
- 后端测试覆盖配置缺失、错误值、超时、上游错误、无效响应和存储失败。
- PR 明确记录与 #28 的冲突文件、合并顺序和真实部署未验证边界。

## 验证

- 计划创建：`npm --prefix backend run docs:check`。
- 目标测试：新增配置、服务、模型/来源错误和存储失败测试。
- 正式本地门禁：`npm --prefix backend run check`、`npm --prefix backend run test:all`。
- 通用门禁：`npm --prefix backend run docs:check`、`git diff --check`。
- HTTP 合同：本地临时端口验证 liveness、readiness 与 fail-closed 响应。
- 真实环境：不使用真实 Qwen/TikHub/Postgres，不部署 Railway/Vercel；这些结果不得标记为 Passed。

## 原则检验

- 证据边界：Fixture、Mock、本地 JSON、真实提供方和生产部署分别报告。
- UI / 美学：本计划不修改任何 UI，无需 Simulator 或浏览器视觉检查。
- 可访问性：本计划不改变客户端可访问性树。
- 隐私与素材：错误与日志只输出稳定码和安全消息，不输出密钥、截图 Base64、上游正文或完整模型载荷；不修改素材。

## 决定记录

- 2026-07-29：用户批准优先处理 Issue #18，并授权按仓库规范推分支、创建 PR；不自动合并。
- 2026-07-29：选择“生产 readiness + 业务路由双重 fail closed”，避免探针失败时业务仍返回演示成功。
- 2026-07-29：当前 JSON Store 明确为本地能力，耐久存储由后续独立 Issue 实现。
- 2026-07-29：#18 先合入，#28 随后 rebase；不得在本分支改写 #28。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：若验收要求真实提供方或耐久存储实现，拆分或链接对应 Issue，不在本计划伪造证据。
- 下一位 Agent 从哪里继续：先读取本计划与 [[docs/quality-baseline]]，确认 PR #28 未被修改，再从集中配置模块开始。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[docs/quality-baseline]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/decision-log]]
- [[docs/issue-management-workflow]]
