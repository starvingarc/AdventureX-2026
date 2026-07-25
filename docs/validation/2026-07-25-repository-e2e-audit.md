# Recallo 仓库与端到端验收记录

> 日期：2026-07-25
>
> 实施与测试环境：`bridge-amax`
>
> 范围：仓库收口、合成截图图库、后端合同、当前 Web 召回链与 iOS 静态守卫

## 1. 结论

- **仓库收口：通过。** PR #1 已关闭且未合并，旧章节式 `flow-demo.html` 已删除；`/app-demo` 是当前前端，`/demo` 只保留为同页兼容别名。
- **代码与合同回归：通过。** 根检查 396 / 396、独立 security 检查 17 / 17、V2 84 / 84、iOS 静态守卫 8 / 8、UI regression guard 30 / 30。
- **Web mock 链：通过。** 375×812、上传与异步轮询、局部刮开、刷新恢复、反馈、未来调度、删除、422 失败态与 Reduce Motion 均通过。
- **Web→后端 Fixture 链：通过。** B站与抖音两张合成图库图片均通过真实浏览器上传、HTTP 异步任务、正式卡、召回、反馈、调度与删除闭环。
- **外部与基础设施验收：未完成。** 本轮没有测试 live Qwen/TikHub、PostgreSQL、worker restart、Xcode 或 Simulator。

这里的“real 链”表示浏览器和真实后端 HTTP 路由均参与，模型与平台供应商由仅测试环境可启用的确定性 Fixture provider 替代；不能把它表述为真实平台识别率或模型质量结果。

## 2. 仓库状态

### PR 与前端入口

- PR #1 `Improve full-screen screenshot source discovery`：closed、unmerged。
- PR #1 的 Apple Vision、未溯源三卡、旧 V2 知识地图和五张无 provenance JPEG 没有整体进入主线。
- `docs/flow-demo.html` 已删除，不再存在两套 Web 运行时。
- `/app-demo` 提供当前 v0.6 页面；`/demo` 指向相同页面，只兼容旧书签。
- 默认空知识库显示真实空态，不能自动塞入假卡片。

### 合成截图图库

本轮图库只包含两张仓库自制合成图片：

| Fixture ID | 平台 | 文件 | 生成方式 |
| --- | --- | --- | --- |
| `synthetic-bilibili-recall` | Bilibili | `backend/test-fixtures/capture-gallery/bilibili-recall.png` | 仓库 HTML + Playwright Chromium 截图 |
| `synthetic-douyin-spacing` | Douyin | `backend/test-fixtures/capture-gallery/douyin-spacing.png` | 仓库 HTML + Playwright Chromium 截图 |

Manifest 将两项均标记为 repository-authored、无外部视觉素材、无个人信息。服务端 Fixture provider 只有在 `NODE_ENV=test` 且 `RECALLO_E2E_FIXTURE_MODE=1` 同时成立时才能启用，并按登记 SHA-256 接受图片；未知图片不会被强行映射为平台。

这两张图用于确定性回归，不替代授权真实截图或 live 视觉模型评测。

## 3. 自动化回归结果

| Gate | 结果 | 覆盖重点 |
| --- | ---: | --- |
| Root check | 396 / 396 | 后端、工具、合同和工作区总检查 |
| Security | 17 / 17 | 独立仓库守卫 |
| V2 | 84 / 84 | 兼容链回归 |
| iOS static | 8 / 8 | 生产配置静态守卫，不等于 Xcode 编译 |
| UI guard | 30 / 30 | v0.6 单卡、毛球、刮开、反馈和恢复合同 |

以上结果来自 `bridge-amax` 最终集成分支的本轮运行，不沿用 PR #1 自述的旧测试数字。

## 4. Web mock-route E2E

Mock-route 模式用于精确检查前端状态机和失败表达：

- viewport：375×812；无横向溢出；
- 默认空库时召回入口不可用，不生成 Fixture 卡；
- 选择文件后调用同源截图接口并轮询异步任务；
- 自由刮开后的局部覆盖率为 `14.2857%`，低于自动揭示阈值；
- 页面 reload 后恢复到同一卡片与相同 `14.2857%` 覆盖率；
- 完整揭示后只提交 1 次 `remembered` assessment；
- 服务端返回的下一次复习时间位于当前时间之后，首页 due 集合为空；
- 删除从 API 成功返回后才移除知识库卡片；
- 强制返回 HTTP 422 时页面保持明确错误态，不出现上传成功或假卡；
- Reduce Motion 的召回落点为 283ms，且系统媒体查询为 reduce。

报告只判断下一次复习时间是有效且位于未来，不记录会随运行时间变化的具体 `nextReviewAt`。

## 5. Web→后端 Fixture E2E

该模式不拦截截图、卡片、反馈或删除 API；浏览器把图库文件上传给后端，后端以 test-only provider 完成确定性分析与持久化接口闭环。

### Bilibili

`synthetic-bilibili-recall` 结果：

- HTTP screenshot upload：1；
- async job poll：3；
- 返回 `create_card` 正式证据卡，而不是临时假卡；
- 局部刮开覆盖率 `14.2857%`，reload 后保持一致；
- assessment：1，值为 `remembered`；
- 服务端 schedule 位于未来，随后 due 列表为空；
- delete：1，删除后知识库为空。

### Douyin

使用 `RECALLO_WEB_E2E_FIXTURE=synthetic-douyin-spacing` 运行，结果：

- HTTP screenshot upload：1；
- async job poll：3；
- 返回 `create_card` 正式证据卡；
- 局部刮开覆盖率 `14.2857%`，reload 后保持一致；
- assessment：1，值为 `remembered`；
- 服务端 schedule 位于未来，随后 due 列表为空；
- delete：1，删除后知识库为空。

两条链均验证了“文件选择 → HTTP 上传 → 异步任务 → 一张正式卡 → 召回与刮开 → remembered → 未来调度 → due empty → delete”，但没有调用外部模型或平台搜索服务。

## 6. 未验证边界

本轮明确没有验证：

- live Qwen 视觉识别、卡片生成质量、Token、延迟和成本；
- live TikHub 的来源命中、限流、平台响应变化和视频下载；
- PostgreSQL migration、真实数据库隔离和并发行为；
- durable worker 的进程重启、任务接管和恢复；
- 完整 Xcode 编译、XCTest、iOS Simulator、VoiceOver 和动态字体。

因此本报告可以支持“当前仓库的确定性产品纵切片已接通”，不能支持“真实平台与模型已达到生产质量”或“iOS 已通过正式编译/模拟器验收”。
