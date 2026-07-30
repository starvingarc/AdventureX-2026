# 知识库卡片详情与来源交互

- 状态：`in_progress`
- 优先级：P1
- 创建：2026-07-30
- 更新：2026-07-30
- 负责人：Codex
- 整合者：Codex
- 分支：`feat/library-card-detail`
- Worktree：`/Users/liqingsong/Desktop/advx/Omo`
- 依赖：Issue #25；当前 iOS MemoryCard 合同
- 推进模式：`auto`
- 可写路径：`Omo/Omo/`、`Omo/OmoTests/`、`docs/frontend/`、`PLANS.md`、`plans/feat-library-card-detail.md`
- 禁止路径：`backend/`、`api/`、`backend/migrations/`、`image/`
- 高冲突文件唯一写者：Codex（`Omo/Omo/ContentView.swift`）

## 动机与证据

知识库列表当前把卡片点击直接映射到全局 `presentedCard`，随后进入召回、刮开和自评流程。它没有知识库浏览语境下的独立详情、缺失来源说明或稳定的导航返回路径，与 Issue #25 的验收不一致。

## 范围

- 为知识库增加独立卡片详情导航，展示完整知识、解释、来源和可用元数据。
- 复用现有主题、稀有度与来源语义，补充详情页组件级布局指标。
- 对缺失来源、截图来源、无效 URL、旧卡可选字段和长文本提供明确降级。
- 增加展示派生逻辑测试，并同步稳定前端文档。
- 在两个 iPhone Simulator 尺寸验证导航、布局、Dynamic Type、Reduce Motion 和无障碍语义。

## 非目标

- 不改变召回、刮卡、自评或调度状态机。
- 不改变 R / SR / SSR 的语义或判定。
- 不改变 API、数据库、来源恢复或后端持久化。
- 不把 Fixture、缺失或无效来源显示为真实可追溯来源。

## 合同冻结

- 输入：当前 `MemoryCard` 及其可选来源字段。
- 输出：只读知识库详情页面；返回后保留 `NavigationStack` 中的列表浏览位置。
- Schema / API：不变。
- 兼容要求：可选来源字段为空时仍可展示；只有 `verified` 且 URL 可打开时提供外链。
- 失败语义：缺失或不可靠来源显示“仅依据截图”或“来源暂不可追溯”，不伪造平台、作者或核验状态。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| iOS 详情与测试 | Codex | `feat/library-card-detail` / 当前 Worktree | 已声明可写路径 | XCTest、Simulator、截图、文档门禁 | 合同或后端 Schema 必须变化 |

## 任务

- [x] 实现知识库详情导航和信息层级。
- [x] 实现来源、旧卡、长文本和可访问性降级。
- [x] 增加派生状态测试并同步稳定文档。
- [x] 完成自动门禁与双尺寸 Simulator 人工检查。
- [ ] Push、创建 PR，并在门禁通过后以 merge commit 合入 `main`。

## 验收标准

- 从知识库打开卡片可查看完整知识、答案、解释、来源和可用元数据，不进入召回或提交自评。
- 返回后知识库列表导航和浏览上下文保持。
- 旧卡、无来源、截图来源及无效 URL 有诚实且可理解的表现。
- 触控尺寸、长文本、Dynamic Type、Reduce Motion 和 VoiceOver 语义满足仓库门禁。
- Xcode build/test、文档门禁和差异检查通过，并留存 Simulator 截图证据。

## 验证

- `npm --prefix backend run docs:check`：通过，17 篇 Markdown / 146 个双链目标有效。
- `git diff --check`：阶段检查通过。
- `xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations`：通过，确认 iOS 26.3.1 Simulator 目标。
- `xcodebuild ... -destination 'platform=iOS Simulator,id=A2558B90-9896-4B9A-8DCD-546E501B153C' -derivedDataPath /tmp/OmoIssue25Derived test`：通过，3/3 XCTest。
- iPhone 16e，Accessibility Extra Large + Reduce Motion，合成长文本详情：通过；无横向溢出、遮挡或底栏侵入，截图 `/tmp/Omo-issue25-iPhone16e-a11y.png`，SHA-256 `3434ad1658b9d842e21b782b83651dd9e807ccc6c48fa8de183fb938b70a10fd`。
- iPhone 17 Pro Max，标准字号，已核验详情：通过；完整信息层级与来源入口可见，截图 `/tmp/Omo-issue25-iPhone17ProMax.png`，SHA-256 `731f95941927c97d2b64fe878601529d168e6dee54ecf980c157225d3fcedbb1`。
- iPhone 17 Pro Max，仅截图来源：通过；无外链或核验措辞，截图 `/tmp/Omo-issue25-screenshot-only.png`。
- iPhone 17 Pro Max，不可连接 API：通过；显示明确可重试错误而非空库，截图 `/tmp/Omo-issue25-error.png`，SHA-256 `927b77085c4db8937b66ca57bf7a08acbe2fb7056d42f0dff7b02b2e5b245b73`。
- 以上 UI 使用显式 Debug Fixture 或不可连接本地地址，只证明受测 Simulator 的布局与状态映射，不证明真实 Qwen / TikHub 或生产服务。

## 原则检验

- 证据边界：来源标签严格由当前合同派生，不提升不可靠来源。
- UI / 美学：沿用 OmoTheme、共享徽章和卡片节奏；详情为单一阅读流，不嵌套装饰卡。
- 可访问性：信息顺序、按钮标签、触控区域、Dynamic Type、Reduce Motion 均需实际检查。
- 隐私与素材：不新增数据收集、权限或素材。

## 决定记录

- 2026-07-30：使用独立 `NavigationLink` 详情而非复用 `RecallView`，保证知识库浏览与主动召回语义分离。
- 2026-07-30：不修改后端合同；旧卡兼容只在现有可选来源字段边界内实现。
- 2026-07-30：新增高对比度 `primaryInk` 作为强调文字 token，保留原 `primary` 用于面积和装饰角色。
- 2026-07-30：知识库加载和连接失败使用独立状态；已有卡片时保留列表并通过全局消息报告刷新失败。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：复核当前 diff，提交实现后同步 `origin/main`，执行最终门禁并完成计划。

## 相关文档

- [[docs/index]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
