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

- [ ] 实现知识库详情导航和信息层级。
- [ ] 实现来源、旧卡、长文本和可访问性降级。
- [ ] 增加派生状态测试并同步稳定文档。
- [ ] 完成自动门禁与双尺寸 Simulator 人工检查。
- [ ] Push、创建 PR，并在门禁通过后以 merge commit 合入 `main`。

## 验收标准

- 从知识库打开卡片可查看完整知识、答案、解释、来源和可用元数据，不进入召回或提交自评。
- 返回后知识库列表导航和浏览上下文保持。
- 旧卡、无来源、截图来源及无效 URL 有诚实且可理解的表现。
- 触控尺寸、长文本、Dynamic Type、Reduce Motion 和 VoiceOver 语义满足仓库门禁。
- Xcode build/test、文档门禁和差异检查通过，并留存 Simulator 截图证据。

## 验证

- `npm --prefix backend run docs:check`
- `git diff --check`
- `xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations`
- 在实际可用的两个 iPhone Simulator 目标执行 build/test、安装、启动和截图。
- UI 路径：`-OmoSkipLaunch -OmoOpenLibrary`，检查知识库列表、详情、返回、长文本和缺失来源。

## 原则检验

- 证据边界：来源标签严格由当前合同派生，不提升不可靠来源。
- UI / 美学：沿用 OmoTheme、共享徽章和卡片节奏；详情为单一阅读流，不嵌套装饰卡。
- 可访问性：信息顺序、按钮标签、触控区域、Dynamic Type、Reduce Motion 均需实际检查。
- 隐私与素材：不新增数据收集、权限或素材。

## 决定记录

- 2026-07-30：使用独立 `NavigationLink` 详情而非复用 `RecallView`，保证知识库浏览与主动召回语义分离。
- 2026-07-30：不修改后端合同；旧卡兼容只在现有可选来源字段边界内实现。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：读取本计划、Issue #25、`ContentView.swift` 与 `OmoModels.swift`。

## 相关文档

- [[docs/index]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
