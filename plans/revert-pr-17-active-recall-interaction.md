# 回退 PR #17 Active Recall Interaction

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`revert/pr-17-active-recall-interaction`
- Worktree：`/private/tmp/omo-revert-pr17.KOCr8z`
- 依赖：用户已明确批准回退并合入；目标 merge commit `2f6bd7e`
- 推进模式：`manual`
- 可写路径：PR #17 相对第一父提交改变的路径、`PLANS.md`、本计划
- 禁止路径：`.env`、凭据、生产数据、PR #17 原分支
- 高冲突文件唯一写者：Codex（`Omo/Omo.xcodeproj/project.pbxproj`、`docs/ios-api-data-contract-zh.md`、`PLANS.md`）

## 动机与证据

PR #17 已通过 merge commit `2f6bd7e` 合入 `main`。用户确认该版本不适合作为当前主线，要求撤销这次 merge，同时保留原 PR、原分支和可追溯历史。

## 范围

- 以第一父提交为主线，反向撤销 merge commit `2f6bd7e`。
- 验证回退后的文件树等同 `05ae8ba`。
- 通过受保护主线流程创建并合入 revert PR。

## 非目标

- 不 force push 或重写 `main`。
- 不关闭、重开、修改或删除 PR #17 及其原分支。
- 不在本分支重建 #17 的 review PR。
- 不顺带修复回退基线中的其他问题。

## 合同冻结

- 输入：`origin/main` 位于 `2f6bd7e`，目标 merge 的第一父提交为 `05ae8ba`。
- 输出：仅撤销 PR #17 相对第一父提交的变更，其他主线提交保持可达。
- Schema / API：恢复到 `05ae8ba` 已有合同，不引入新字段或兼容逻辑。
- 兼容要求：原 PR、原 head commit `e7ade41` 和 merge 历史全部保留。
- 失败语义：出现主线漂移、revert 冲突、测试失败或树不一致时停止合入并记录证据。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 回退、验证与集成 | Codex | `revert/pr-17-active-recall-interaction` / `/private/tmp/omo-revert-pr17.KOCr8z` | 冻结范围内路径 | 文档、后端、iOS、树一致性 | 主线漂移、冲突或验证失败 |

## 任务

- [ ] 反向撤销 merge commit `2f6bd7e`。
- [ ] 运行文档、后端、iOS 与 UI 原则门禁。
- [ ] 记录证据、退役计划并创建 revert PR。
- [ ] 合并 revert PR，确认远端 `main` 已恢复。

## 验收标准

- PR diff 只包含 #17 的反向变化。
- 计划退役后分支文件树与 `05ae8ba` 一致。
- 正式门禁通过，UI 在 iPhone 17 与 iPhone 17e 上实际检查。
- revert PR 使用 merge commit 合入，原 #17 与原分支不变。

## 验证

- `npm ci --prefix backend --ignore-scripts`
- `npm --prefix backend run docs:check`
- `npm --prefix backend run check`
- `npm --prefix backend run test:all`
- `git diff --check`
- XcodeBuildMCP：iPhone 17 与 iPhone 17e build/run/test
- `git diff --exit-code 05ae8ba HEAD`（计划退役后）

## 原则检验

- 证据边界：回退恢复既有合同，不把旧 Fixture 或 Mock 表述为真实外部能力。
- UI / 美学：两档 Simulator 检查受影响入口，无截断、溢出或层级异常。
- 可访问性：检查关键按钮和文本出现在运行时可访问性树。
- 隐私与素材：只撤销 #17 引入的内容，不新增素材或用户数据。

## 决定记录

- 2026-07-29：用户批准通过 revert PR 回退 #17，并在后续新 PR 中重新进入 review。
- 2026-07-29：采用 merge commit 保留计划生命周期和原 PR 历史。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：检查当前任务清单与最新提交，先确认 `origin/main` 仍包含目标 merge。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[plans/README]]
- [[docs/quality-baseline]]
