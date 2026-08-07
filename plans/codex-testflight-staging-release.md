# Omo TestFlight Staging Release 实施计划

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-08-08
- 更新：2026-08-08
- 负责人：Codex `/root`
- 整合者：Codex `/root`
- 分支：`codex/testflight-staging-release`
- Worktree：`/Users/hanmingyu/Documents/Recallo2.0/Omo-next`
- 依赖：PR #30 PostgreSQL、PR #36 主动召回、PR #37 知识库
- 推进模式：`manual`（用户已授权 TestFlight 与隔离 staging；明确禁止生产部署和生产环境变更）
- 可写路径：`Omo/`、`backend/`、`api/`、`docs/`、`plans/`、`PLANS.md`、`.github/`、根目录部署配置
- 禁止路径：任何 Railway 生产项目／生产环境、生产数据库、生产变量、`main` 分支、真实用户数据
- 高冲突文件唯一写者：Codex `/root`（`Omo/Omo.xcodeproj/project.pbxproj`、`backend/package-lock.json`、`backend/migrations/`、`docs/ios-api-data-contract-zh.md`、`PLANS.md`）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Every behavior change follows test-first Red → Green → Refactor; every completion claim requires fresh verification.

## Goal

在不触碰现有生产环境和 `main` 的前提下，把最新主线、已确认的主动召回／知识库 UI 与耐久后端整合成一个真实用户可测的 Omo TestFlight 构建；构建只连接独立 staging，且 Mock 只能在 Debug 显式启用。

## Architecture

iOS 保留一个 App target，但通过显式运行配置隔离 Debug Fixture 与 TestFlight Staging：Debug 可用启动参数注入合成状态，Archive/Release 不编译或不激活 Fixture，并从构建配置读取 staging API URL。后端复用 PR #30 的 PostgreSQL Store，在一个全新 Railway staging 项目中使用独立 Postgres；搜索通过用户隔离的服务端接口完成，客户端只接收排序后的卡片 ID。通知 MVP 使用本机通知，在到期时以卡片 `recallCue` 提问，点击后在首页当前层级叠加对应刮刮卡，不引入生产 APNs。

## Tech Stack

SwiftUI、PhotosUI、Speech、UserNotifications、XCTest、Node.js 20、`node:test`、PostgreSQL、Railway、Xcode 26.6、App Store Connect/TestFlight。

## Global Constraints

- 绝不部署、迁移、改变量或读取现有生产 Railway 服务和数据库。
- 绝不向 `main` push；所有更改只在 `codex/testflight-staging-release`，最终仅创建 PR。
- TestFlight 与 staging 不得展示 Fixture、测试卡、Debug 菜单或 Mock 成功。
- Debug Fixture 只能由 `#if DEBUG` 与显式启动参数启用。
- 截图链保持“截图 → 来源识别 → 受限来源恢复 → Evidence → 记忆卡 → 调度”；来源失败只能降级为 `screenshot_only`。
- 揭示前不得通过可见 UI、日志或 Accessibility 泄露 `hiddenSemantic`。
- R / SR / SSR 仅为视觉等级，不影响调度、概率或付费。
- 搜索、卡片、assessment 与删除必须按匿名设备 ID 隔离。
- TestFlight 目标是内部测试可安装和真实闭环，不包含 App Store 正式公开发布。

## 动机与证据

- 2026-08-08 审计：当前已确认 UI 位于 PR #36/#37，尚未进入最新 `main`。
- 当前 `main` 的生产配置会因 JSON Store 返回 `durable_storage_unavailable`；直接部署无法支持真实用户。
- PR #30 已实现 PostgreSQL Store 与 migration，但尚未合并，也未在 Railway 验证。
- 当前 Release 的知识库搜索使用 `UnavailableKnowledgeLibrarySearcher`，真实搜索不可用。
- 当前 API 默认 Release URL 指向已有 `shibei-production`，违反本计划的生产隔离约束。
- 本机 Railway CLI 已登录但当前仓库未关联项目；可见现有项目“拾贝”，本计划禁止连接或修改它。
- 本机只有 Apple Development 证书，未发现 Distribution profile；`asc` 尚未安装，签名与 App Store Connect 权限需先自动探测，缺失时再收敛用户输入。
- 后端基线：`check`、31 项 `test:all`、`docs:check` 均通过。
- iOS 基线：编译完成，但 CoreSimulator 未启动，XCTest 未真正开始；该问题列入 Simulator 基础设施诊断，不能记为测试通过。

## 非目标

- 不合并 PR、不发布 App Store 正式版本、不邀请外部测试员。
- 不接触或迁移现有生产用户数据。
- 不实现账号登录、跨设备同步、付费、分类、知识图或远程 APNs 服务。
- 不重新设计已确认的首页、抽卡、刮刮卡、自评条和知识库视觉。
- 不为了发布进行无关的全机型重构；只修复验收设备上可复现的阻塞缺陷。

## 合同冻结

- 输入：用户选择的截图、文字／语音搜索词、三档自评、通知点击。
- 输出：真实生成并持久化的记忆卡、用户隔离搜索结果、幂等调度更新、对应卡片叠加展示。
- API：保留现有 `/api/health`、`/api/readiness`、`/api/memory-cards`、`/api/sources/image-flow`、assessment、delete；新增 `POST /api/memory-cards/search`，请求 `{ query }`，响应 `{ orderedCardIDs }`。
- 配置：Archive/Release 的 API URL 必须由 TestFlight staging 构建配置提供；不存在时 fail closed，不回退到生产 URL。
- 存储：staging 只允许 `STORE_DRIVER=postgres` 与 staging `DATABASE_URL`；migration 由显式命令执行，不在进程启动时自动修改数据库。
- 通知：只调度本机到期提醒；通知 payload 仅包含卡片 ID 与提问文案，不包含答案、解释或截图。
- 失败语义：网络、模型、来源、搜索、存储和权限错误均显示可恢复状态；不伪造成功、不泄露上游正文或密钥。

## 任务

### Task 1：整合最新主线与已验收能力

**Files:** PR #36/#37 与 PR #30 变更范围；冲突只由本计划整合者处理。

- [x] 合并 `codex/knowledge-library-search` 到当前最新 `origin/main`，保留完整提交历史并确认首页、抽卡、刮刮、自评、知识库和卡片详情文件存在。
- [x] 合并 `feat/postgres-persistence`，逐项解决 backend/docs 冲突，不删除任一侧的幂等、readiness 或来源证据测试。
- [x] 运行 `npm --prefix backend run check`、`npm --prefix backend run test:all`、`npm --prefix backend run docs:check` 与 iOS `build-for-testing`，记录整合基线。
- [x] 提交整合结果与本计划进度。

### Task 2：隔离 Debug Fixture 与 TestFlight Staging

**Files:** `Omo/Omo/Services/APIClient.swift`、`Omo/Omo/KnowledgeLibrary/KnowledgeLibraryDebugFixtures.swift`、`Omo/Omo.xcodeproj/project.pbxproj`、`Omo/OmoTests/ReleaseConfigurationTests.swift`、`docs/ios-api-data-contract-zh.md`。

- [x] 先写失败 XCTest：Release 配置缺少合法 HTTPS API URL 时拒绝创建真实客户端，Debug 显式启动参数才允许 Fixture。
- [x] 运行目标测试并确认因当前硬编码生产 URL／Fixture 边界不足而失败。
- [x] 实现 `AppEnvironment`：从 Bundle/build setting 读取 API URL，Release 仅接受 HTTPS staging URL，移除任何生产域名默认回退；Debug Fixture 保持 `#if DEBUG`。
- [x] 运行目标测试与全部 iOS 测试，确认 TestFlight 构建无法进入 Mock。
- [x] 更新稳定合同并提交。

### Task 3：实现真实用户隔离的知识库搜索

**Files:** `backend/src/searchService.js`、`backend/src/server.js`、`backend/src/runtimeConfig.js`、`backend/test/searchService.test.js`、`backend/test/server.test.js`、`Omo/Omo/KnowledgeLibrary/KnowledgeLibrarySearch.swift`、`Omo/OmoTests/KnowledgeLibrarySearchTests.swift`、`backend/.env.example`、`docs/ios-api-data-contract-zh.md`。

- [x] 先写失败后端测试：空查询拒绝、只搜索当前 owner 卡片、返回稳定去重 ID、模型失败返回安全错误、超时可恢复。
- [x] 运行目标 Node 测试并确认缺少 endpoint/service 而失败。
- [x] 实现服务端语义排序 Adapter，使用 staging Qwen 配置处理当前 owner 的候选卡片，永不返回卡片正文、embedding 或其他 owner ID。
- [x] 先写失败 XCTest：客户端请求携带设备 ID、正确解码 ID、取消旧请求、服务错误不保留旧结果。
- [x] 实现 Release `APIKnowledgeLibrarySearcher` 并注入知识库；Debug mock 仍需显式启动参数。
- [x] 运行 Node/iOS 目标测试与全量门禁，更新合同并提交。

### Task 4：补齐截图、回顾与通知的真实闭环

**Files:** `Omo/Omo/OmoStore.swift`、`Omo/Omo/OmoApp.swift`、`Omo/Omo/RecallHomeView.swift`、`Omo/Omo/RecallRoundView.swift`、`Omo/Omo/Services/RecallNotificationScheduler.swift`、对应 `OmoTests`、隐私／支持文档。

- [x] 先写失败测试：生成卡后调度不泄露答案的本机通知；点击通知后在首页当前层叠加对应卡；找不到卡时安全回首页；assessment 成功后按新 `nextReviewAt` 重排；失败不误切下一张。
- [x] 运行目标测试并确认缺少通知路由／调度实现而失败。
- [x] 实现本机通知的系统权限请求、到期调度与点击路由；MVP 不新增独立权限教育页，不添加 APNs entitlement，不向任何服务注册 token。
- [x] 验证相册选择、生成等待、抽取不足 10 张、80% 揭示、自评取消／确认、卡间切换、库内完整展示、详情与通知叠卡；本轮新增 Simulator 实际刮擦、阈值、自评提交失败重试证据，成功联调留待隔离 staging。
- [x] 更新隐私与支持文档，使其准确描述 TestFlight 的本机通知和匿名设备数据。
- [x] 运行相关测试并提交。

### Task 5：建立完全隔离的 Railway Staging

**Files:** `railway.json`、`railpack.json`、`backend/migrations/`、`backend/.env.example`、`docs/staging-testflight-runbook.md`。

- [x] 创建全新 Railway 项目 `Omo TestFlight Staging`，不 link、不读取、不修改现有“拾贝”项目；添加独立 Postgres 服务。
- [ ] 仅在 staging 设置 `NODE_ENV=production`、`STORE_DRIVER=postgres`、staging `DATABASE_URL`、Qwen/TikHub 所需变量；变量值不写入仓库或日志。
- [x] 在 staging 数据库执行只读 migration status，再执行顺序 migration；记录版本和 checksum，不导入生产数据。
- [ ] 部署当前分支 backend，验证 `/api/health`、`/api/readiness`、空库、真实授权截图生成、重启后读取、assessment 幂等、删除和搜索。
- [ ] 将 staging HTTPS URL 注入 TestFlight 构建配置，形成可复现但不含密钥的 runbook。
- [ ] 提交配置与文档；Railway 外部状态只限新 staging 项目。

### Task 6：Simulator 全流程与缺陷修复循环

**Files:** 仅修改能够复现缺陷的最小代码与对应测试；证据写入 `artifacts/testflight-staging-release/`。

- [x] 先修复 CoreSimulator 无法启动／XCTest 未执行的环境问题，确认至少一个测试方法真实执行而非仅编译；当前 iOS XCTest 36/36 实际通过。
- [ ] 在 iPhone 17 Pro 跑空用户、上传、生成、首页、十连抽、不足十张、局部刮开、80% 揭示、自评取消／三档确认、卡间切换、库搜索、语音权限、详情、删除、错误恢复、通知点击。
- [ ] 在一个小屏 iPhone 仅复核安全区、键盘、长文本、触控与滚动；不做无关全机型重构。
- [ ] 对每个缺陷执行：复现与根因证据 → 失败测试 → 最小修复 → 目标测试 → 全量回归 → Simulator 复验。
- [ ] 检查 Dynamic Type、Reduce Motion 和 VoiceOver 揭示前不泄露答案；保存关键截图和步骤。
- [ ] 提交缺陷修复与验收证据。

### Task 7：签名、Archive 与 TestFlight 内测发布

**Files:** Xcode 版本配置、`ExportOptions.plist`（不含秘密）、`docs/staging-testflight-runbook.md`、TestFlight notes。

- [ ] 探测 Apple Developer/App Store Connect 账号、Bundle ID `com.maxhan.shibei` 对应 App 记录、团队权限和远端安全 build number；不创建重复 App。
- [ ] 若 CLI 缺失，安装并验证当前 `asc`；若本机授权不足，只向用户请求最小的 App Store Connect API key/角色或一次 Xcode 登录。
- [ ] 使用自动签名或现有团队资产生成 Release archive；验证 bundle、版本、隐私 manifest、图标、HTTPS staging URL、Fixture 隔离和 export compliance。
- [ ] 导出 IPA，运行本地 Release smoke；上传 App Store Connect 并等待 build processing 为 `VALID`。
- [ ] 配置内部 TestFlight group 与“测试内容”，只分发该 staging build，不提交 App Store 正式审核，不邀请外部测试员。
- [ ] 从 TestFlight 安装后走真实 staging 闭环；记录 build ID、测试组、验证结果和仍需真机验证的权限行为。
- [ ] 提交最终稳定文档与证据，完成并退役计划，push 当前分支并创建面向 `main` 的非 squash PR。

## 验收标准

- 当前分支包含最新 `main`、已确认主动召回／知识库体验和 PostgreSQL，未删除团队既有改动。
- Release/TestFlight 无 Mock、无 Fixture、无生产 URL 回退，且只连接隔离 staging。
- staging readiness 为 200，真实截图生成、持久化、重启读取、搜索、assessment 和删除闭环通过。
- Simulator XCTest 真正执行且全量通过；关键 UI 路径在常见和小屏设备完成检查。
- Archive 与 IPA 验证通过，App Store Connect build 处理为 `VALID`，内部 TestFlight 测试组可安装。
- 现有生产 Railway 项目、变量、数据库、部署与 `main` 均未改变。

## 验证

- Backend：`npm ci --prefix backend --ignore-scripts && npm --prefix backend run check && npm --prefix backend run test:all && npm --prefix backend run docs:check`
- PostgreSQL：`npm --prefix backend run test:postgres`，再在 staging 执行 migration status、migration 和重启 readback。
- iOS：`xcodebuild ... build-for-testing` 与 `xcodebuild ... test-without-building`，结果必须列出实际执行的测试数和 0 failure。
- Release：generic iOS archive、export IPA、包内容／签名／PrivacyInfo 检查、staging URL 检查、Fixture 字符串检查。
- Simulator：iPhone 17 Pro 主闭环；小屏 iPhone 只做布局与可达性回归；保存截图。
- TestFlight：build processing `VALID`、内部组已关联、真机安装与真实 staging smoke。

## 原则检验

- 证据边界：`hiddenSemantic` 必须来自截图/来源证据，来源失败不伪造 verified。
- UI / 美学：不重设计已确认 Figma 主线；稀有度仍为视觉装饰，刮开与自评顺序不变。
- 可访问性：揭示前不泄露答案；Reduce Motion 不阻断流程；关键控件有可理解标签与最小触控区域。
- 隐私与素材：Fixture 合成且仅 Debug；staging 无真实生产数据；隐私文档、manifest 和网络行为一致。

## 决定记录

- 2026-08-08：用户授权以 TestFlight 真实测试为终点，并要求自主开发、Simulator 测试和缺陷修复。
- 2026-08-08：用户新增硬约束：所有迭代只留在自己的分支，绝不部署生产；因此采用独立 Railway staging 与独立 Postgres，TestFlight 只连接 staging。
- 2026-08-08：选择从最新 `origin/main` 建 `codex/testflight-staging-release`，再保留历史地整合 PR #36/#37/#30。
- 2026-08-08：Task 1 完成。后端 `check`、38 pass / 1 skipped 的默认门禁、独立 PostgreSQL 1 pass、文档检查与 iOS `build-for-testing` 通过；XCTest 运行仍留待 Task 6 修复 Simulator 启动后验证。
- 2026-08-08：Task 2 完成。Release 缺少合法 HTTPS URL 时 fail closed，旧生产域名回退已删除，Mock 仅能由 Debug 显式启动参数开启；iOS 串行 XCTest 28/28 通过，Release Simulator 构建与包内 staging URL／禁用 Mock 字符串检查通过。
- 2026-08-08：Task 3 完成。新增 owner 隔离的 `POST /api/memory-cards/search` 与 Qwen 请求时语义重排；客户端只提交 query，服务端只返回稳定去重 ID。后端 44 项（43 pass / 1 PostgreSQL 默认 skip）、iOS 31/31、文档与 Release 包门禁通过。
- 2026-08-08：Task 4 完成。本机通知仅携带回忆问题与卡片 ID，点击后在首页当前层叠卡；生成／assessment／删除与通知时间同步。Simulator 实际验证刮擦、80% 揭示、自评和失败重试；iOS 35/35、Release build 与文档门禁通过，无 APNs entitlement 或 Debug/旧生产字符串。
- 2026-08-08：Task 5 部分完成。已新建 `Omo TestFlight Staging` 与独立 `staging` 环境、`omo-api-staging` 和 Postgres；001/002 migration 已应用并验证 ready，临时 TCP proxy 已删除。新增 production 必须显式 `STORE_DRIVER=postgres` 的 fail-closed 门禁。backend 尚缺 staging 专用 `QWEN_API` 与 `TIKHUB_API_KEY`，因此未部署。
- 2026-08-08：Task 6 本地发布审计阶段完成。iOS 36/36 与 backend 45 pass / 1 默认 skip，Release clean build 和隐私 manifest 包检查通过。Simulator 真实选图发现首页上传绕过 AI 许可，已修复并验证取消、同意、Settings 撤回和重新询问；同时移除 Release 二进制中的 localhost 字符串。未部署任何环境。

## 阻塞与恢复

- 当前阻塞：staging backend 的真实部署需要两个 staging 专用密钥 `QWEN_API` 和 `TIKHUB_API_KEY`，本机与新服务均未配置；禁止从生产项目读取或复制。App Store Connect 仍需后续探测 `asc` 与 Distribution 权限。
- 解除条件：用户通过安全方式提供 staging 专用 Qwen/TikHub 密钥；若 Apple 权限不足，再提供最小 App Store Connect API key 或在 Xcode 完成一次登录。
- 下一位 Agent 从哪里继续：密钥未就绪时可先执行 Task 6/7 的本地审计与无密钥验证；密钥就绪后回到 Task 5 部署 `omo-api-staging`，禁止连接 Railway 项目“拾贝”。

## 相关文档

- [[AGENTS]]
- [[docs/product-principles]]
- [[docs/quality-baseline]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/privacy-policy-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[PLANS]]
