# 知识库浏览与搜索页面

- 状态：`in_progress`
- 优先级：P1
- 创建：2026-08-03
- 更新：2026-08-03
- 负责人：Codex
- 整合者：Codex
- 分支：`codex/knowledge-library-search`
- Worktree：`/Users/hanmingyu/Documents/Recallo2.0/Omo-next`
- 依赖：`codex/continue-from-latest-main` 的主动回忆首页与卡片详情实现（基线 `cfa7b02`）
- 推进模式：`auto`
- 可写路径：`Omo/Omo/`、`Omo/OmoTests/`、`Omo/OmoUITests/`、`Omo/Omo.xcodeproj/project.pbxproj`、`docs/`、`plans/codex-knowledge-library-search.md`、`PLANS.md`
- 禁止路径：`backend/migrations/`、生产环境配置、真实用户数据
- 高冲突文件唯一写者：Codex（`Omo/Omo.xcodeproj/project.pbxproj`、`PLANS.md`）

## 动机与证据

当前 `LibraryView` 只用系统 `List` 展示完整知识卡片，没有 Figma node `884:324` 所定义的品牌化知识库页面，也没有文字输入、语音输入、搜索状态、结果分页或语义检索数据边界。现有稳定文档只确认“知识库直接展示完整卡片”；历史 PRD 曾把搜索排除在早期 MVP 外，因此本计划把它作为新增产品模块明确记录，而不是把缺失能力描述为已存在。

用户已经提供整页 Figma 链接、返回按钮与麦克风 SVG、搜索框和卡片组件 SVG，并要求使用 `frontend-ui-standards` 完成 SwiftUI 还原、可替换 mock 数据、自动测试和 Simulator 全状态验收。

## 范围

- 用独立 SwiftUI 页面替换当前系统 `List` 知识库，保留从首页收藏夹进入、返回首页、加号上传和完整卡片详情能力。
- 默认展示全部完整知识卡片；知识库内不使用刮开交互，也不隐藏承重语义。
- 支持文字输入、键盘 Search、“帮我找”按钮、语音转写入口、清空查询和取消过期请求。
- 为搜索定义可替换协议与状态机；本轮使用显式、确定性的本地 mock 搜索实现完成页面和测试，稳定合同明确真实后端向量服务尚未接入。
- 结果按实际文字排版高度生成两列错落布局；容纳不下时横向分页，页点与当前页同步。
- 覆盖加载、全部卡片、搜索结果、无结果、失败、空知识库、语音监听和语音权限失败状态。
- 复用现有 Omo 品牌素材与 Recall Token；新增素材必须来自用户 SVG 或 Figma 导出并登记来源。
- 补齐产品 PRD、iOS 架构、布局、数据契约、素材来源和验证证据。

## 非目标

- 不建设生产 embedding 服务、向量数据库、后端索引任务或远端搜索 Endpoint。
- 不把字符串匹配、Fixture 或 mock 宣称为真实语义向量搜索。
- 不增加分类、标签筛选、知识图谱、搜索历史、推荐内容或卡片编辑。
- 不改变截图生成、来源恢复、主动回忆调度、刮刮乐和滑动自评合同。
- 不修改或直接推送 `main`，不合并任何 PR。

## 合同冻结

- 输入：`OmoStore.cards` 中当前用户的完整 `MemoryCard`；文本查询或语音转写后的非空查询。
- 输出：默认态按稳定顺序展示全部卡片；搜索态返回按相关性排序的卡片 ID，再映射到当前本地卡片；页面从第一组结果开始显示。
- Schema / API：iOS 定义 `KnowledgeLibrarySearching` 协议、查询请求、结果与错误类型。Mock 实现只在显式注入或 Debug 验收参数下启用；生产默认不得把 mock 当远端能力。未来真实服务应返回当前用户范围内的卡片 ID、稳定游标/版本和相关性排序，不在 UI 显示内部相似度分值。
- 兼容要求：旧卡缺少合法 `hiddenSemantic` 时仍在知识库完整显示和被搜索；删除、详情和上传沿用现有行为；搜索结果不得生成或改写卡片内容。
- 失败语义：空查询立即恢复全部卡片；新请求取消旧请求；失败保留输入并显示可重试状态；无匹配与服务失败必须区分；语音无权限、无可用识别器和转写失败分别提供可恢复反馈。
- 分页：按可用内容高度与真实排版高度分组，不按知识文字数硬编码；搜索结果变化、Dynamic Type 变化或容器尺寸变化时重新分页并回到第一页。
- 语音：真实 App 使用 Apple Speech/Audio 权限与转写边界；Simulator 验收通过显式 Debug 注入合成转写结果，不声称验证了真机麦克风或线上识别质量。

## 分工

本计划不使用子 Agent；所有改动由 Codex 在当前 worktree 串行完成，避免共享 Xcode 工程和 `PLANS.md` 冲突。

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| 产品与交互规格 | Codex | 当前分支 / 当前 worktree | `docs/` | `docs:check`、规格覆盖审查 | 需要改变证据或主动回忆合同 |
| 搜索与语音状态层 | Codex | 当前分支 / 当前 worktree | `Omo/Omo/`、`Omo/OmoTests/` | 单元测试、build | 需要真实后端或付费服务 |
| Figma 页面与分页 | Codex | 当前分支 / 当前 worktree | `Omo/Omo/`、Assets、Xcode 工程 | Simulator、截图、可访问性检查 | 设计资源来源不明 |
| 验收与文档 | Codex | 当前分支 / 当前 worktree | tests、`docs/`、本计划 | 全量门禁与证据审计 | 真实设备或生产验证被错误要求为已通过 |

## 任务

- [x] 写入经确认的产品设计规格和逐步实施计划，并完成自审。
- [x] 补齐知识库 PRD：用户故事、范围、状态机、文字/语音搜索、分页、无障碍、数据与埋点边界。
- [x] 以测试先行定义搜索协议、请求取消、mock 结果、无结果和失败状态。
- [x] 以测试先行定义按测量高度分页的纯布局模型，覆盖不同卡片长度、容器高度和 Dynamic Type 缩放。
- [ ] 实现 Figma 知识库壳层、搜索栏、麦克风、错落卡片、动态页点、上传和详情入口。
- [ ] 实现语音权限与转写控制器，并提供仅 Debug 可用的 Simulator 转写注入。
- [ ] 增加合成 mock 卡片和确定性搜索场景，不污染 Release 或生产数据路径。
- [ ] 更新稳定架构、布局、合同、素材和本地化文档，明确 mock 与真实向量服务边界。
- [ ] 运行单元测试、iOS build、文档检查和静态差异检查。
- [ ] 在 Simulator 验收全部卡片、文字搜索、语音模拟、分页、详情、上传、无结果、失败、空库和权限状态，保存截图证据。
- [ ] 覆盖常见与较小/较大 iPhone、Dynamic Type、Reduce Motion、VoiceOver 语义、键盘焦点和安全区检查。
- [ ] 完成逐项验收审计，提交完成证据，退役临时计划，推送独立分支并创建/更新清晰的团队评审入口。

## 验收标准

- Figma `884:324` 的视觉结构可辨识还原：橙色背景、品牌面板、顶部返回/角色、搜索框、两列错落完整卡片、动态页点、底部收藏夹和上传入口。
- 卡片高度由真实 SwiftUI 文字排版和容器测量决定；短卡与长卡均无截断、重叠或横向溢出，容纳不下时进入下一页。
- 默认态、文字搜索、语音转写、加载、结果、无结果、失败和空库状态可以从真实 App 入口或显式 Debug 场景稳定复现。
- 搜索使用可注入 `KnowledgeLibrarySearching`；mock 有明确测试标记并被单元测试覆盖，Release 路径不会把 mock 声称为远端向量服务。
- 新搜索会取消旧请求，清空查询恢复全部卡片，结果变化回到第一页，点击结果打开完整详情。
- 语音入口具备权限、监听、停止、成功、失败与不可用状态；Simulator 只证明注入交互，未把真机麦克风验证写成已通过。
- 44pt 触控目标、VoiceOver label/value/hint、键盘提交与焦点、Dynamic Type、Reduce Motion 和安全区通过人工检查。
- `xcodebuild` 相关测试与 build、`npm --prefix backend run docs:check`、`git diff --check` 均通过。
- 交付包含各关键状态的 Simulator 截图、设备/视口、操作路径、验证结果和明确未验证项。

## 验证

- 文档：`npm --prefix backend run docs:check`、`git diff --check`。
- 单元测试：使用实际 Simulator destination 运行 `OmoTests`，覆盖搜索状态、请求竞态、布局分页和模型兼容。
- 构建：`xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations`，然后针对已启动 Simulator 执行 Debug build。
- UI：安装并启动 Debug App，通过启动参数加载合成卡片、搜索成功/失败/空结果、语音转写和空库场景；逐状态截图并核对 Figma。
- 设备：至少一个常见 iPhone 与一个较小或较大 iPhone；补充最大可用 Dynamic Type、Reduce Motion、深浅色适用性、键盘和 VoiceOver Inspector/语义审查。
- 边界：不执行生产向量服务、真机麦克风或真实用户数据验证；这些未验证项必须在交付中明确。

## 原则检验

- 证据边界：知识库只搜索、排序和展示已有卡片，不生成答案，不改变 `sourceEvidenceIds`，不把 mock 当成真实来源或生产语义搜索。
- UI / 美学：稀有度仅作为视觉层级；知识库完整显示卡片，不引入刮层；一次状态只突出搜索或卡片浏览的主要动作。
- 可访问性：视觉旋转不改变 VoiceOver 阅读顺序；卡片完整内容可读；隐藏装饰素材；所有按钮有稳定标签和至少 44pt 命中区域。
- 隐私与素材：语音只在用户主动触发后请求权限；不持久化音频；测试数据全部合成；素材哈希和授权进入 `docs/asset-provenance.md`。

## 决定记录

- 2026-08-03：基线选用 `codex/continue-from-latest-main` 的 `cfa7b02`，因为该分支包含团队最新 `main` 之上的已验收主动回忆 UI；新页面单独建 stacked topic branch，避免扩大原 PR。
- 2026-08-03：采用完整 UI/交互与可替换 mock 搜索层；真实后端向量服务只冻结接口边界，本轮不建设、不伪装。
- 2026-08-03：知识库卡片直接展示完整知识，不使用刮开；分页由真实排版高度与可用空间决定，不按字数硬编码。
- 2026-08-03：采用 SF 系统字体，与本产品此前已确认的字体选择和 iOS Dynamic Type 保持一致。
- 2026-08-03：设计规格保存于 `docs/superpowers/specs/2026-08-03-knowledge-library-search-design.md`；测试先行实施计划保存于 `docs/superpowers/plans/2026-08-03-knowledge-library-search.md`，已完成覆盖、占位符与类型一致性自审。
- 2026-08-03：新增 `docs/knowledge-library-prd.md`；搜索状态测试已先观察到缺失类型的编译失败，随后实现请求取消、结果去重与 mock 搜索边界。`build-for-testing` 通过；iOS 26.5 Simulator 在启动 XCTest runner 时异常关机，实际测试执行仍待恢复后验证，未记为通过。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：不适用。
- 下一位 Agent 从哪里继续：先读取本计划、设计规格和实施计划；以 `KnowledgeLibrarySearching` 冻结合同为准，不把 mock 扩展为生产声明。

## 相关文档

- [[docs/index]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/asset-provenance]]
- [[docs/quality-baseline]]
