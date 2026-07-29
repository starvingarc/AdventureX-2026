# 恢复“我的”页面视觉层级

- 状态：`in_progress`
- 优先级：P2
- 创建：2026-07-30
- 更新：2026-07-30
- 负责人：Codex
- 整合者：Codex
- 分支：`feat/profile-visual-hierarchy`
- Worktree：`/private/tmp/omo-issue31`
- 依赖：无；父 Issue #9 的账号、头像与跨设备持久化仍受 #19 阻塞
- 推进模式：`manual`（用户已于 2026-07-30 明确批准先改“我的”页面）
- 可写路径：`Omo/Omo/ProfileView.swift`、`Omo/Omo/ContentView.swift`、`docs/frontend/v2-layout-system.md`、本计划与 `PLANS.md`
- 禁止路径：`Omo/Omo/OmoStore.swift`、`Omo/Omo/APIClient.swift`、`Omo/Omo.xcodeproj/project.pbxproj`、`backend/`、`api/`、素材目录、其他 PR 分支
- 高冲突文件唯一写者：Codex（`ContentView.swift`、`PLANS.md`）

## 动机与证据

当前 `main` 的“我的”页只有标题、角色图、两项数字和一句说明，视觉层级与信息组织弱于历史提交 `3c11e77f3ff83d3347444cf1f6fe374ef3b37dc7` 中实际默认启用的 `V2ProfileTabView`。旧版提供了更清楚的身份卡、数据卡和分组层级，但其中账号、头像编辑、通知、旧数据模型、Fixture 数字和未登记素材不能直接恢复。

Issue #31 已把这次工作限定为视觉层级恢复；PR #28 可能改动相邻入口，但不是实现依赖。本分支从当前最新 `origin/main` 独立施工，后续主线变化只在本分支内同步和解决，不覆盖其他作者成果。

## 范围

- 新建独立 `ProfileView.swift`，把“我的”页面从 `ContentView.swift` 中拆出。
- 参考旧版的卡片层级，恢复身份区、真实记忆统计和待召回概览。
- 使用当前已登记的 `OmoPoseHeart` 素材与现有主题，不引入旧素材。
- 使用响应式布局、语义字体和可访问性标签，支持小屏、Dynamic Type、VoiceOver 与 Reduce Motion。
- 在稳定布局文档中记录已实现的页面结构与边界。

## 非目标

- 不实现登录、账号、头像编辑、跨设备同步、通知设置、隐私删除入口或任何新的持久化。
- 不恢复旧版 `Chapter`、`Review` 等已删除数据模型，不展示 Fixture 或推断的“掌握”“连续学习”数据。
- 不修改 #9、#19、PR #28 的代码或评审状态，不合并本 PR。
- 不增加新素材、依赖、API、Schema 或路由。

## 合同冻结

- 输入：`OmoStore.cards` 与 `OmoStore.dueCards` 的当前内存状态。
- 输出：只读的身份卡、记忆卡总数、累计召回次数与今日待召回数。
- Schema / API：无变化；不新增请求、响应字段或持久化键。
- 兼容要求：`ContentView` 继续以 `ProfileView()` 进入页面；生产构建只显示真实 Store 派生值。
- 失败语义：无数据时明确显示零值或“暂无待召回”，不伪造账号、统计或服务状态。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 页面、文档与整合 | Codex | `feat/profile-visual-hierarchy` / `/private/tmp/omo-issue31` | 计划列出的可写路径 | 文档门禁、构建、测试、Simulator 视觉与可访问性检查 | 需要 API、持久化、新素材或覆盖他人改动 |

本计划不派发子 Agent；`ContentView.swift` 与 `PLANS.md` 由唯一写者修改。

## 任务

- [x] 修订 Issue #31 的并行整合说明，并把 Roadmap 状态更新为 In progress。
- [x] 将 `ProfileView` 拆为独立文件并实现响应式身份展示区、真实统计和待召回概览。
- [x] 更新稳定布局文档，记录页面结构、数据边界与响应式规则。
- [x] 完成静态检查、iOS 构建与测试。
- [x] 在选定的 iPhone 17e Simulator 上检查默认布局、VoiceOver 语义、无动画依赖、滚动、安全区和横向溢出并记录证据。
- [ ] 完成、退役计划，推送主题分支并创建面向 `main` 的 Ready-for-review PR。

## 验收标准

- “我的”页在不增加账号能力的前提下，具有清楚的标题、身份、统计与状态层级。
- 页面所有数字均由当前 Store 派生；空数据和大数字不会制造错误状态或破坏布局。
- 选定的 iPhone 17e 可在默认场景首屏完整呈现核心内容；兜底滚动无裁切、横向溢出或底部导航遮挡。
- 大号 Dynamic Type 下内容保持可读；VoiceOver 能读出统计名称、值和单位；Reduce Motion 下不依赖动画理解内容。
- 生产代码不含旧版头像持久化键、Fixture 统计、账号按钮、未登记素材或后端合同变化。
- PR 仅关闭 #31，并引用父 Issue #9；#9 保持未完成。

## 验证

- `npm --prefix backend run docs:check`
- `git diff --check`
- 使用 Xcode 构建工具构建 `Omo/Omo.xcodeproj`、Scheme `Omo` 并运行 `OmoTests`。
- Simulator：只使用 iPhone 17e，实际打开“我的”页；暂不并行启动第二种机型，避免本机持续高负载。
- UI 场景：真实空数据；使用明确隔离的 Debug 预览或启动参数检查大数字，不把 Fixture 当成真实服务证据。
- 可访问性：默认与大号 Dynamic Type、VoiceOver 语义、Reduce Motion、滚动与安全区。

已执行证据（2026-07-30）：

- `npm --prefix backend run docs:check`：17 个 Markdown、145 个双链全部通过。
- `git diff --check`：通过。
- XcodeBuildMCP `build_run_sim`：
  - iPhone 17e / iOS 26.5 / Debug：成功，无 warning / error；
  - iPhone 17e 使用 `-OmoProfileLargeFixture`：修正一次 getter 显式 `return` 后重新构建成功，无 warning / error。
- XcodeBuildMCP `test_sim`：iPhone 17e / iOS 26.5，`OmoTests` 1/1 通过（`APIClientDecodingTests.testMemoryCardDecodesFromMinimalAPIContract`）。
- 用户反馈后的紧凑化复验：iPhone 17e 默认字号下实际打开“我的”页，标题、身份展示区、两项零值统计和完整召回面板均在首屏呈现；底栏不遮挡内容，也不需要为查看核心内容而拖动。
- Simulator 大数字：iPhone 17e 使用显式 Debug Fixture `123,456 / 987,654 / 4,321`，统计值与召回面板无截断；极端内容可通过一次短滚动完整查看，该 Fixture 未改变 Store / API。
- Dynamic Type：iPhone 17 使用 `accessibility-extra-extra-extra-large` 实际打开页面；身份区和统计切换为纵向/通栏，内容保持可滚动。全局底栏随系统字号显著增高是现有导航行为，不属于本页新入口；本页未用固定设备宽度规避它。
- VoiceOver 语义：运行时可访问性快照确认页面阅读顺序为身份 → 记忆卡 → 已召回 → 今日状态；源码将身份、统计、状态分别合并并提供 label / value / hint，装饰图形隐藏。
- Reduce Motion：本页没有动画、时间线或依赖动效的状态，开启与否不改变信息和操作语义。
- 外部服务：本地 API 未启动，Simulator 显示既有“无法连接服务器”提示；空数据和 Debug Fixture 只验证 UI，不证明真实服务或生产数据。

## 原则检验

- 证据边界：只展示 `cards`、`reviewCount`、`dueCards` 可直接证明的统计；历史 UI 只作为视觉参考。
- UI / 美学：恢复旧版清楚的卡片层级，但使用当前主题、响应式尺寸与单一阅读顺序。
- 可访问性：语义字体、合并后的统计读法、装饰图隐藏、无动画依赖。
- 隐私与素材：不新增收集、上传、权限、账号或素材；继续使用当前已登记的 `OmoPoseHeart`。

## 决定记录

- 2026-07-30：用户明确要求先改“我的”页面，批准 manual 计划进入 `in_progress`。
- 2026-07-30：历史基线采用当时默认入口 `V2ProfileTabView`，而不是未启用的旧 `SettingsViews.ProfileView`。
- 2026-07-30：只恢复视觉层级与当前可证实数据；账号、头像与跨设备持久化继续留在父 Issue #9。
- 2026-07-30：PR #28 不是依赖；使用独立页面文件和最小入口改动降低后续整合冲突。
- 2026-07-30：按用户要求由 Kimi Code K3「极致」在既有 Kimi workspace 中重写 `ProfileView.swift`；主 Agent 保持唯一整合者并负责 Xcode / Simulator 验收。
- 2026-07-30：视觉方向采用 Atlas 的日式清新、白盒画廊、有机亲自然、可爱极简、斯堪的纳维亚和便当网格线索；不复制外部代码或素材。
- 2026-07-30：增加仅 Debug 可用的 `-OmoProfileLargeFixture`，只覆盖本页派生数字以检查极端布局，不写入 Store、API 或生产构建。
- 2026-07-30：用户要求界面更紧凑、不要为了拖动而拖动；继续沿用同一 Kimi workspace 收紧间距、舞台、卡片与状态面板，并删除重复标题和装饰性脚注。默认字号首屏呈现全部核心内容，滚动仅保留为适配兜底。
- 2026-07-30：按用户的设备负载要求，后续 Simulator 验收只保留 iPhone 17e；已关闭其余已启动 Simulator，不再并行测试第二种机型。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：实现与视觉验证已完成；先检查本计划证据与 diff，提交实现阶段，再完成/退役计划并创建 PR。若 `origin/main` 已变化，先在本分支同步并审查 `ContentView.swift` 冲突。

## 相关文档

- [[docs/product-principles]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
- [[docs/issue-management-workflow]]
