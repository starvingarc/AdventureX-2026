# Omo iOS 前端架构

当前 iOS 客户端采用精简的 SwiftUI 单向状态结构；旧 V2 多层页面和兼容服务已经退役。

## 运行时边界

- `OmoApp.swift`：应用入口并注入唯一的 `OmoStore`。
- `ContentView.swift`：Figma 首页、知识库、我的、设置、上传和卡片详情路由；不再承载召回手势细节。
- `RecallHomeView.swift`：首页、侧边菜单、持续存在的收藏夹／上传入口和最多十张的冻结牌组。
- `RecallRoundView.swift`：当前牌堆、提交、失败重试与换卡编排。
- `RecallKnowledgeCardView.swift`：四层卡堆、句内语义遮挡、80% 揭示和完整上下文 Sheet。
- `RecallRatingSlider.swift`：取消区与 forgot / fuzzy / remembered 三个节点的拖动自评。
- `RecallInteractionState.swift`：不依赖 View 的刮开、提交、失败、重试和换卡状态。
- `KnowledgeLibraryView.swift`：Figma 知识库壳层、完整卡片浏览、搜索输入、结果状态和两列分页。
- `KnowledgeLibraryViewModel.swift`：文字／语音查询状态、请求竞态、结果 ID 映射和恢复动作。
- `KnowledgeLibrarySearch.swift`：可替换的搜索协议；Debug mock 与 Release 不可用 Adapter 明确隔离。
- `KnowledgeLibraryPagination.swift`：根据 SwiftUI 实测高度分页的纯布局模型。
- `KnowledgeLibrarySpeech.swift`：Apple Speech／Audio 权限、生命周期和转写事件边界。
- `MotionKit.swift`：逐帧图集、粒子、轨道、刮除和按钮反馈，不承载业务状态。
- `OmoStore.swift`：卡片集合、加载、上传、反馈和删除状态。
- `APIClient.swift`：设备隔离的 HTTP 合同。
- `OmoModels.swift`：客户端可解码模型和展示派生值。

视图只触发 `OmoStore` 动作；Store 通过 `APIClient` 调用后端并发布新状态。后端是卡片、掌握阶段和下次复习时间的事实来源。

## 状态与兼容

- 加载、生成、空状态和错误均显式展示。
- `MemoryCard` 的来源核验字段和 `hiddenSemantic` 为可选，以兼容旧卡片；只有 `hiddenSemantic` 是 `coreKnowledge` 精确连续子串的到期卡进入召回牌组。
- 点击 IP 时复制 `dueCards.prefix(10)` 形成本轮固定牌组；本轮中新上传或重新调度的卡不会改变现有顺序。
- 召回发生在首页同一场景，收藏夹和上传入口在刮卡与自评期间仍可使用；Library 始终显示完整知识，不使用刮层。
- 团队独立的 `ProfileView` 保持页面实现和数据来源，只增加从侧边菜单进入后的返回首页能力。
- Debug 启动参数仅用于 Simulator 路径验证，不改变 Release 行为。
- 知识库生产向量搜索尚未接入；Release 不回退到本地字符串匹配，也不把 Debug Fixture 伪装成远端能力。
- 新增页面或状态前优先扩展现有 Store 和共享组件，避免恢复平行架构。

## 相关文档

- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-layout-system]]
- [[docs/product-principles]]
- [[docs/quality-baseline]]
