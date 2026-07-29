# 重新评审 PR #17 Active Recall Interaction

- 状态：`completed`
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

- [x] 重建 PR #17 的代码差异。
- [x] 验证重建 diff 与原 #17 一致。
- [x] 运行文档、后端与一档 iOS Simulator 门禁。
- [x] 记录证据。
- [ ] 退役计划并创建 Ready for review PR。

## 验收标准

- 新分支相对回退后 `main` 的文件差异与原 #17 相对 `05ae8ba` 的差异一致。
- 正式门禁通过，受影响 UI 在 iPhone 17 与 iPhone 17e 上实际检查。
- 新 PR 关联 #17 与 #27、请求原 reviewer、处于 Ready for review 且未合并。
- 原 #17 和原分支不变。

## 验证

- `npm ci --prefix backend --ignore-scripts`：通过，0 vulnerabilities。
- `npm --prefix backend run docs:check`：通过，22 Markdown / 173 wiki links。
- `npm --prefix backend run check`：通过。
- `npm --prefix backend run test:all`：通过，11 passed / 0 failed。
- `git diff --check`：通过。
- XcodeBuildMCP iPhone 17：build/run 通过，XCTest 9 passed / 0 failed。
- `git diff --exit-code 2f6bd7e..HEAD -- . ':(exclude)PLANS.md' ':(exclude)plans/review-pr-17-active-recall-interaction-v2.md'`：通过，重建文件树与原 #17 merge 完全一致。
- 用户要求停止重复验证；未在重建分支重复运行 iPhone 17e 和视觉流程。原 `2f6bd7e` 同一文件树已在本次工作开始前完成 iPhone 17e build/run、XCTest 9 passed 和两档 UI 检查。
- 未验证：真实 Qwen / TikHub、生产持久化与部署、APNs、真机。

## 原则检验

- 证据边界：保留 #17 已声明的 Fixture、Mock 与真实外部服务边界。
- UI / 美学：两档 Simulator 检查首页、召回入口与可见布局。
- 可访问性：检查主要按钮、文本和导航出现在运行时可访问性树。
- 隐私与素材：仅恢复 #17 已记录来源的素材，不引入用户数据或凭据。

## 决定记录

- 2026-07-29：用户批准在 #27 回退后，以新 PR 重新进入 review，不合并新 PR。
- 2026-07-29：使用 `git revert a706789` 重建同等补丁，避免重写原分支历史。
- 2026-07-29：重建无冲突完成；除活动计划外，文件树与原 #17 merge `2f6bd7e` 一致。
- 2026-07-29：用户要求不再重复验证；保留已完成证据并直接发布 review PR。

## 阻塞与恢复

- 当前阻塞：无；重建与必要验证完成，等待按规范退役并发布。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：退役本计划，发布 Ready for review PR，不合并。

## 相关文档

- [[AGENTS]]
- [[PLANS]]
- [[plans/README]]
- [[docs/quality-baseline]]
