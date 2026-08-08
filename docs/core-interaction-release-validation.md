# Omo 核心交互 Release 验收证据

- 日期：2026-08-09
- 分支：`codex/omo-independent-app`
- App：Omo `1.0 (3)`，Bundle ID `com.maxhan.omo`
- TestFlight 目标：独立 Omo 外部测试组 `Omo`
- staging：`https://omo-api-staging-staging.up.railway.app`

## 自动化结果

- iPhone 16 Pro / iOS 18.5 Simulator。
- Debug 与 Release 优化配置分别运行 52 项 XCTest / UI Test：每套 52 通过、0 失败、0 跳过。其中 44 项为逻辑、持久化与 API 测试，8 项为真实 UI 操作流程。
- 测试命令只在测试构建中启用 `ENABLE_TESTABILITY=YES` 和 `OMO_TESTING`；普通 Release Archive 不包含 Fixture、Mock 或本地地址回退。
- 普通 Release 已另行构建并扫描：不包含 `OmoLibraryFixture`、`OmoScreenshotJobFixture`、`OmoAssessmentFixture`、`OMO_STAGING_UI`、`localhost` 或 `127.0.0.1`，仍为 `com.maxhan.omo` / build 3 / Omo staging。
- 状态测试覆盖 79% 不揭示、80% 揭示、自评取消区、三个正式节点、评估失败重试与牌组推进。
- UI Test 覆盖空库、处理中、失败、知识库、刮开和揭示后自评，并逐个断言菜单、Profile、Settings、知识库与上传入口可达且可以返回首页。
- 完整单卡旅程使用真实滑动手势完成刮开和自评，最后断言卡层退出、知识库和上传入口恢复可用，避免“控件存在但用户仍被困住”。

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
| 完成最后一张后回到可操作首页 | [09-recall-complete-home.png](assets/core-interaction-release/09-recall-complete-home.png) |
| 空库用户遍历页面并返回首页 | [10-empty-journey-returned-home.png](assets/core-interaction-release/10-empty-journey-returned-home.png) |
| 处理中取消另一次上传且任务仍在 | [11-processing-journey-returned-home.png](assets/core-interaction-release/11-processing-journey-returned-home.png) |

## 真实 staging 证据

- 提供的真实截图通过 App 的系统照片选择器上传到真实 staging；同一条自动化旅程验证了首次 AI 许可、异步任务接收、杀 App、重新启动和任务恢复。
- 重启后任务生成 canonical 卡片，自动化继续点击 IP、真实刮开承重语义、拖动自评，并从首页进入知识库确认卡片仍存在。
- [12-staging-upload-accepted.png](assets/core-interaction-release/12-staging-upload-accepted.png) 记录任务已接收且其他入口仍可用；[13-staging-recall-complete-library.png](assets/core-interaction-release/13-staging-recall-complete-library.png) 记录完整复习后卡片仍在知识库。
- 另一次 App 内真实上传遇到 Qwen 60 秒超时，任务进入明确 `failed / retryable`，而不是页面永久卡死。
- 点击失败任务重试后，同一个 task ID 回到处理中；菜单、知识库、上传入口保持可用。
- 处理中杀 App 并重新启动后任务仍存在；再次超时后重新显示明确重试状态。
- Railway readiness 为 `ready=true`，Postgres migration `001` / `002` / `003` 均已应用，pending 为空。

## Release 与 TestFlight

- build 3 Archive 包内 Bundle ID 为 `com.maxhan.omo`，版本为 `1.0 (3)`，API 地址只指向 Omo staging。
- `testFlightInternalTestingOnly=false` 已写入导出配置并由自动化门禁保护，构建可送交 Beta App Review；该配置不会发布 App Store 正式版。
- 外部测试组 `Omo` 使用独立 Omo App 记录，公开链接为 <https://testflight.apple.com/join/rZ8pBE7e>；从未使用 Recallo App 或测试组。

## 尚需人工确认

- Apple Beta App Review 批准外部构建后，实体手机仍应按 [[docs/frontend-interaction-prd#15-前端验收清单]] 做一次公开链接安装复核；这属于分发确认，不替代本页已经通过的 Simulator 与真实 staging 用户旅程。
- Share Extension 的首次 AI 授权跳转仍是 [[docs/frontend-interaction-prd#17-请产品重点复核的边界]] 中的待确认产品决定；本轮没有以错误的设备身份或假成功方式实现。
