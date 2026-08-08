# Omo 核心交互 Release 验收证据

- 日期：2026-08-09
- 分支：`codex/omo-independent-app`
- App：Omo `1.0 (2)`，Bundle ID `com.maxhan.omo`
- TestFlight Build ID：`a387a603-dc77-4dda-b0a3-862e1d490936`
- staging：`https://omo-api-staging-staging.up.railway.app`

## 自动化结果

- iPhone 16 Pro / iOS 18.5 Simulator。
- Release 优化配置运行 49 项 XCTest / UI Test：49 通过、0 失败、0 跳过。
- 测试命令只在测试构建中启用 `ENABLE_TESTABILITY=YES` 和 `OMO_TESTING`；普通 Release Archive 不包含 Fixture、Mock 或本地地址回退。
- 普通 Release 已另行构建并扫描：不包含 `OmoLibraryFixture`、`OmoScreenshotJobFixture`、`OmoRecallRevealed` 或 `127.0.0.1:5174`，仍为 `com.maxhan.omo` / build 2 / Omo staging。
- 状态测试覆盖 79% 不揭示、80% 揭示、自评取消区、三个正式节点、评估失败重试与牌组推进。
- UI Test 覆盖空库、处理中、失败、知识库、刮开和揭示后自评，并逐个断言菜单、知识库与上传入口可达。

## Release 状态截图

以下截图来自上述成功的 Release UI Test。它们证明布局、入口层级和核心状态可达；Fixture 只用于确定性 UI 验收，不替代真实 staging 证据。

| 状态 | 截图 |
|---|---|
| 空库首页 | [01-empty-home.png](assets/core-interaction-release/01-empty-home.png) |
| 空知识库 | [02-empty-library.png](assets/core-interaction-release/02-empty-library.png) |
| 处理中首页 | [03-processing-home.png](assets/core-interaction-release/03-processing-home.png) |
| 处理中知识库 | [04-processing-library.png](assets/core-interaction-release/04-processing-library.png) |
| 失败首页 | [05-failed-home.png](assets/core-interaction-release/05-failed-home.png) |
| 失败知识库 | [06-failed-library.png](assets/core-interaction-release/06-failed-library.png) |
| 待刮开的复习卡 | [07-recall-scratch.png](assets/core-interaction-release/07-recall-scratch.png) |
| 揭示后的三档自评 | [08-recall-rating.png](assets/core-interaction-release/08-recall-rating.png) |

## 真实 staging 证据

- 提供的真实截图通过异步任务接口成功生成过 canonical 卡片；测试卡随后删除。
- 另一次 App 内真实上传遇到 Qwen 60 秒超时，任务进入明确 `failed / retryable`，而不是页面永久卡死。
- 点击失败任务重试后，同一个 task ID 回到处理中；菜单、知识库、上传入口保持可用。
- 处理中杀 App 并重新启动后任务仍存在；再次超时后重新显示明确重试状态。
- Railway readiness 为 `ready=true`，Postgres migration `001` / `002` / `003` 均已应用，pending 为空。

## Release 与 TestFlight

- IPA 包内 Bundle ID 为 `com.maxhan.omo`，版本为 `1.0 (2)`，API 地址只指向 Omo staging。
- 正式签名通过，`get-task-allow=false`，App Store Connect 状态为 `VALID / IN_BETA_TESTING`。
- Build 2 只加入独立的 Omo 内部测试组，未使用 Recallo App 或测试组。

## 尚需人工确认

- 在实体手机从 TestFlight 安装 build 2 后，按 [[docs/frontend-interaction-prd#15-前端验收清单]] 完成最终手势验收。
- Share Extension 的首次 AI 授权跳转仍是 [[docs/frontend-interaction-prd#17-请产品重点复核的边界]] 中的待确认产品决定；本轮没有以错误的设备身份或假成功方式实现。
