# Omo 主动召回首页

## 目标

首页直接承载“抽取—刮开—自评—下一张”的二次唤醒主流程。用户点击 IP 开始一轮默认连续抽取；一轮最多十张，不足十张时使用全部当前到期卡片。流程不增加分类卡池、单抽切换、文字确认按钮或结算页。

视觉依据为 Figma `825:79`、`825:137`、`825:181`、`825:540`，并延续首次首页 `825:434` 的橙色背景、奶油色主体、菜单、IP、收藏夹和上传入口。

## 当前工程映射

- `ContentView` 保留团队主线的页面路由、Library、Profile、Settings 与启动场景，首页改为 `RecallHomeView`。
- `RecallHomeView` 直接读取 `OmoStore.cards` 与 `dueCards`，不复制后端数据源或持久化状态。
- `RecallRoundView` 管理本轮最多十张卡片的提交与换卡编排；`RecallKnowledgeCardView` 负责卡堆、句内排版、刮层和上下文详情。
- `RecallRatingSlider` 独立承载四位置拖动与无障碍语义；`RecallInteractionState` 只描述可测试的本地状态。
- `MemoryCard.hiddenSemantic` 与后端生成校验共同构成刮开合同；assessment 仍调用 `OmoStore.assess` 和现有幂等 API。
- `RecallDesign` 集中保存页面 Palette、402 × 874 参考画布、卡片与滑杆 Metrics；SwiftUI View 不散落 Figma 坐标。

## 首页与抽取

- 有到期卡时，IP 是开始本轮的唯一主入口；箭头只用于暗示点击 IP。
- 点击后取合法 `dueCards.prefix(10)`，因此候选不足十张时自然抽取全部；缺失或非法 `hiddenSemantic` 的旧卡保留在知识库，但不进入牌组。
- 卡堆最多显示四层外观，顶层之外只呈现纸张外壳；数量由实际剩余卡片决定，不伪造背卡。
- 深度 1 对应真实下一张卡，可用稀有度颜色产生轻微光效。稀有度只作视觉装饰，不作为步骤、按钮或抽取概率。
- 当前卡确认自评后离场，剩余卡堆收拢；下一张从封住状态开始。最后一张完成后回到首页待机状态。
- 当前 MVP 不提供中途关闭按钮，不恢复半轮会话。

## 刮开

- 主卡连续显示完整 `coreKnowledge`；刮层只覆盖其中逐字匹配的 `hiddenSemantic`，不展示原截图，也不显示独立的 `answer` 区块。
- 前后文使用常规字重和深青色；承重语义由 Canvas 绘制，揭示后使用 semibold 与珊瑚橙建立视觉权重。
- 揭示前，承重语义文字不会进入 VoiceOver label、value、hint 或无障碍树。
- 手势轨迹按网格计算覆盖率；小于 80% 时只局部揭示且不显示自评。
- 达到 80% 后自动完整揭示，并提供一次轻触觉与 VoiceOver 宣告。
- 句首、句中和句尾的承重语义使用相同排版行为；重复子串默认遮住第一次精确匹配。
- 不显示“直接揭晓”等额外文字按钮。

## 自评滑杆

滑杆包含一个最左取消区和三个语义节点：

1. 最左端取消区，不是 assessment；
2. 忘记了，对应 `.forgot`；
3. 没记清，对应 `.fuzzy`；
4. 记住了，对应 `.remembered`。

拖动跨入节点时触发轻震并改变进度、描边与投影颜色。在任一节点松开即提交；拖回最左取消区松开则回到起点、不提交、不切卡。提交期间锁定滑杆，失败时保留当前揭示状态并提供原地重试，成功后自动进入下一张。

## 次级入口

- 左上菜单包含 Profile 和 Settings；菜单打开时底层页面从无障碍树隐藏。
- 左下收藏夹进入 Library；库内知识卡直接显示完整内容，不使用刮层。
- 右下上传入口直接打开系统单选照片选择器。
- 当前卡右上入口原地展开“完整上下文”sheet，展示完整知识、解释和真实来源；打开与关闭不改变刮开进度。

## 可访问性与动画

- 菜单、IP、收藏夹、上传和卡片次级入口的触控区域不小于 44pt，并提供 label/hint。
- 揭示前无障碍树不包含 `hiddenSemantic`；揭示后才朗读真实承重语义。
- 自评暴露为单一 Slider，值为未选择或三个真实记忆状态，不返回 NaN。
- Reduce Motion 保留抽取、揭示、提交和换卡的因果顺序，但移除大幅位移与旋转。
- 页面按 402 × 874 参考画布等比缩放，装饰坐标集中在 `RecallHomeMetrics`。

## 非目标

- 不回迁旧版完整 V2 来源恢复、多卡生成、数据库迁移或通知系统。
- 不增加单抽模式、分类抽取、关键词筛选、纠错流程或自评结算。
- 不重新设计 IP 形象和复杂动画。
- 不把全机型适配扩展成独立功能；尺寸检查只作为 UI 门禁。

## 验证证据

首次 Figma 还原证据见 [[docs/validation/omo-figma-active-recall-2026-07-29/README]]；句内承重语义、滑条取消/确认和原地换卡的修复验证见 [[docs/validation/omo-active-recall-interaction-2026-07-29/README]]。

## 相关文档

- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/frontend/v2-first-launch-empty-home]]
- [[docs/quality-baseline]]
