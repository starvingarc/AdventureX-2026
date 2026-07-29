# 重新评审 PR #17 Active Recall Interaction

- 状态：`in_progress`
- 优先级：P1
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`review/pr-17-active-recall-interaction-v2`
- Worktree：`/private/tmp/omo-review-pr17-v2.JqShkq`
- 依赖：回退 PR #27 已合入；用户批准用新 PR 重新进入 review
- 推进模式：`manual`
- 可写路径：PR #17 相对 `05ae8ba` 改变的路径、`PLANS.md`、本计划
- 禁止路径：`.env`、凭据、生产数据、PR #17 原分支、`main`
- 高冲突文件唯一写者：Codex（`Omo/Omo.xcodeproj/project.pbxproj`、`docs/ios-api-data-contract-zh.md`、`PLANS.md`）

## 动机与证据

PR #17 已经合入后由 PR #27 撤销。GitHub 不支持把已合并 PR 恢复为同一编号的 review 状态，因此需要从回退后的 `main` 重建同等代码差异，并用新的 Pull Request 继续评审。

## 范围

- 反向撤销回退提交 `a706789`，精确重建 PR #17 的 50 文件差异。
- 重新运行文档、后端、iOS 与 UI 门禁。
- 创建 Ready for review 的新 PR，关联 #17 与 #27，并请求原 reviewer。

## 非目标

- 不修改、关闭、删除或重写 PR #17 及其原分支。
- 不修改 `main`，不合并新的 review PR。
- 不在原 #17 范围外修复问题或扩展产品能力。

## 合同冻结

- 输入：已回退的 `origin/main`，文件树等同 `05ae8ba`。
- 输出：新 PR diff 与 `05ae8ba..2f6bd7e` 的 #17 变更一致。
- Schema / API：恢复 #17 的 `hiddenSemantic` 合同与客户端召回交互，不额外改变字段。
- 兼容要求：原 PR #17、回退 PR #27 和全部 Git 历史保持可追溯。
- 失败语义：出现主线漂移、冲突、diff 不一致或测试失败时停止发布并记录证据。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 重建、验证与发布 | Codex | `review/pr-17-active-recall-interaction-v2` / `/private/tmp/omo-review-pr17-v2.JqShkq` | 冻结范围内路径 | diff、文档、后端、iOS、UI | 主线漂移、冲突或验证失败 |

## 任务

- [ ] 重建 PR #17 的代码差异。
- [ ] 验证重建 diff 与原 #17 一致。
- [ ] 运行文档、后端、iOS 与 UI 原则门禁。
- [ ] 记录证据、退役计划并创建 Ready for review PR。

## 验收标准

- 新分支相对回退后 `main` 的文件差异与原 #17 相对 `05ae8ba` 的差异一致。
- 正式门禁通过，受影响 UI 在 iPhone 17 与 iPhone 17e 上实际检查。
- 新 PR 关联 #17 与 #27、请求原 reviewer、处于 Ready for review 且未合并。
- 原 #17 和原分支不变。

## 验证

- `npm ci --prefix backend --ignore-scripts`
- `npm --prefix backend run docs:check`
- `npm --prefix backend run check`
- `npm --prefix backend run test:all`
- `git diff --check`
- XcodeBuildMCP：iPhone 17 与 iPhone 17e build/run/test
- 比较新 PR diff 与 `05ae8ba..2f6bd7e`

## 原则检验

- 证据边界：保留 #17 已声明的 Fixture、Mock 与真实外部服务边界。
- UI / 美学：两档 Simulator 检查首页、召回入口与可见布局。
- 可访问性：检查主要按钮、文本和导航出现在运行时可访问性树。
- 隐私与素材：仅恢复 #17 已记录来源的素材，不引入用户数据或凭据。

## 决定记录

- 2026-07-29：用户批准在 #27 回退后，以新 PR 重新进入 review，不合并新 PR。
- 2026-07-29：使用 `git revert a706789` 重建同等补丁，避免重写原分支历史。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：确认 `origin/main` 包含 #27，再检查任务清单与 diff 一致性。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[plans/README]]
- [[docs/quality-baseline]]
