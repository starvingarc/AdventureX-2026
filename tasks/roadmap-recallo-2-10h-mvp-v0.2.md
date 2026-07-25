# Recallo 2.0：10 小时 MVP Roadmap

> 版本：v0.2
>
> 日期：2026-07-24
>
> 总工期：10 小时
>
> 目标：做出可以在 iPhone 上完整演示的产品闭环，不在 10 小时内追求生产级可靠性
>
> 对应 PRD：[`prd-recallo-2-screenshot-awakening-v0.6.md`](./prd-recallo-2-screenshot-awakening-v0.6.md)

## 1. 10 小时后必须能演示什么

演示者在 iPhone 上：

```text
从相册选择一张真实平台截图
→ Recallo 调用现有 Qwen 截图理解链
→ 显示“正在整理”
→ 得到一张知识卡或记忆碎片
→ 卡面直接显示 R / SR / SSR
→ 用户先尝试回忆，再刮开或揭示承重语义
→ 选择“想起来了 / 有点印象 / 没想起来”
→ 回到首页，选择抽 1 张或连续抽取
```

至少准备 2 张经授权、脱敏、已经在服务器验证的主链演示截图：

- Bilibili 1 张；
- 抖音 1 张。

小红书保留 adapter 自动化回归，但不作为本轮现场演示和 MVP 完成声明的阻塞项。

来源恢复失败时必须诚实显示“来源未确认”，但截图理解和记忆卡仍可继续。不能为了 demo 伪造确定来源。

## 2. 当前代码直接复用

本轮不重写已有能力：

| 已有能力 | 路径 | 10 小时内的用法 |
| --- | --- | --- |
| 截图 API Client | `拾贝/拾贝/Services/APIClient.swift` | 直接调用 `analyzeScreenshot` |
| 后端截图入口 | `POST /api/sources/image-flow` | 保留现有同步/异步行为 |
| Qwen 视觉识图 | `backend/src/flow/vision.js` | 继续使用已选模型 |
| 平台 adapter | `backend/src/flow/index.js` | 现场主测 Bilibili/抖音，小红书保留自动化回归 |
| 来源与复习结果 | `backend/src/flow/source.js`、`review.js` | 映射成一张 MVP 卡 |
| 现有唤醒 UI | `拾贝/拾贝/V2/Screens/Home/V2AwakeningViews.swift` | 改造成抽卡/揭示容器 |
| 现有唤醒状态 | `backend/src/v2/state/awakeningSessionV2.js` | 能复用则复用，不做 V3 重构 |

允许保留的 demo 技术债：

- `imageFlowJobs.js` 继续使用进程内 Map；
- 不建立完整 V3 数据库迁移；
- 不引入 `pg-boss`；
- 不引入 GRDB；
- 连续抽取先由客户端对当前卡池组成本地 session；
- 复习结果先写入现有 V2 状态或设备内存；
- 服务器重启后未完成截图任务可能丢失。

这些限制必须写进演示说明，不能称为已生产化。

## 3. MVP 范围

### 3.1 必须完成

- 从 App 内通过 PhotosPicker 选择截图；
- 调用真实服务器和真实 Qwen 模型；
- 显示聚合处理状态；
- 一张截图最多生成一张卡；
- 来源可靠时展示来源，不可靠时显示未确认；
- 正式卡显示 R / SR / SSR；
- 记忆碎片不显示稀有度；
- 单张抽取；
- 连续抽取，最多 10 张、卡池不足时抽当前全部；
- 任意一张后可退出连续模式；
- 语义遮盖与揭示；
- 三段自评；
- Bilibili、抖音各 1 张真实演示 fixture；
- 小红书 adapter 自动化回归继续通过；
- 后端测试在 `bridge-amax:/data1/yuxiao/recallo` 通过；
- iOS 至少成功构建并在 Simulator 或真机跑通一次。

### 3.2 有时间再做

- 最小 Share Extension；
- 真正的手势刮开轨迹与粒子动效；
- 抽卡翻面、卡堆层次与声音；
- 稀有度反馈“系统高估 / 低估”；
- 把真实生成卡持久化到 Postgres；
- 处理完成通知。

### 3.3 明确不做

- durable queue、断网恢复和进程重启恢复；
- 完整 App Group/GRDB outbox；
- `pg-boss` 与 V3 全量数据模型；
- 新平台 adapter；
- 全面改善来源搜索；
- 长视频完整下载或重新设计 ASR；
- 账号级彻底删除；
- 社交、分享、排行榜；
- 知识图谱、星图、回忆云图；
- FSRS 与长期个性化调度；
- App Store 上架准备。

## 4. 10 小时时间盒

## H0:00–H0:30：冻结演示合同

交付：

- 选定 Bilibili、抖音各 1 张脱敏演示截图；
- 记录 `main` commit；
- 确认服务器地址、Qwen/TikHub 环境变量只存在服务器；
- 写死本轮卡片最小字段；
- 停止讨论范围外功能。

最小卡片合同：

```ts
type DemoMemoryCard = {
  id: string
  state: "formal" | "fragment"
  coreKnowledge: string
  hiddenSemantic?: string
  recallCue: string
  explanation: string
  rarity?: "R" | "SR" | "SSR"
  rarityReason?: string
  sourceTitle?: string
  sourceUrl?: string
  sourceStatus: "verified" | "unconfirmed"
  screenshotThumbnail?: string
}
```

退出条件：

- 2 张主链图片、字段和演示脚本已冻结；
- 没有真实 key 出现在仓库或 shell 输出中。

## H0:30–H2:00：让后端稳定返回一张卡

工作：

- 在 `bridge-amax:/data1/yuxiao/recallo` 同步最新 `main`；
- 用 Bilibili、抖音 fixture 运行现有 image flow；
- 运行小红书 adapter 自动化回归；
- 将 `review.cards` 或核心复习结果收敛为一张 `DemoMemoryCard`；
- 当来源未验证时返回 `unconfirmed`，不阻断卡片生成；
- 为卡片增加确定性的 R / SR / SSR 和简短理由；
- 为正式卡输出一个明确 `hiddenSemantic`；
- 失败时返回可展示的 fragment，而不是 HTTP 500；
- 增加 3–5 个合同测试。

本轮稀有度允许使用简单、可解释的规则：

```text
来源证据不足 → fragment，无稀有度
具体事实或局部技巧 → R
可迁移方法、模型或机制 → SR
高复用且能改变判断框架，并有明确证据 → SSR
置信度不足时向较低等级回退
```

退出条件：

- 三张 fixture 都返回 `formal` 或诚实的 `fragment`；
- 每张最多一张卡；
- 返回结构能被 iOS 解码；
- 后端合同测试通过。

止损：

- 到 H2:00 仍不能稳定完成来源恢复时，冻结来源改善；
- 使用截图直接理解生成卡，来源显示“未确认”；
- 不进入媒体下载和 ASR 深坑。

## H2:00–H3:30：iOS 截图导入闭环

工作：

- 在首页或添加页加入 PhotosPicker；
- 限制 JPEG/PNG/WebP 或转换为 JPEG；
- 压缩到后端允许的大小；
- 调用现有 `analyzeScreenshot`；
- 处理同步结果或轮询异步 job；
- 展示三个用户状态：
  - 正在整理；
  - 卡片已生成；
  - 暂时无法整理，可重试；
- 不向用户展示 OCR、搜索、ASR 内部阶段百分比。

退出条件：

- Simulator 或真机可以选择一张截图；
- 截图到达真实后端；
- App 能显示一张解码后的卡或 fragment；
- 错误可重试且界面不崩溃。

## H3:30–H5:00：抽卡首页与两种模式

工作：

- 首页提供“抽 1 张”和“连续抽取”；
- 复用当前唤醒卡容器；
- 单张模式只打开一张；
- 连续模式从当前卡池取至多 10 张；
- 卡池不足时使用现有全部卡；
- 同一回合不重复；
- 任意一张后显示“结束本次”；
- R / SR / SSR 直接显示在卡面；
- fragment 显示中性“待补全”状态。

本轮不做后端 `DrawSession`。客户端创建：

```swift
struct DemoDrawSession {
    let mode: Mode
    let cardIDs: [String]
    var currentIndex: Int
}
```

退出条件：

- 两种模式均可进入；
- 连续模式任意位置可退出；
- 稀有度不改变卡片抽取概率；
- 没有“保底”“概率”“货币”等文案。

## H5:00–H6:30：语义揭示与自评

工作：

- 显示包含遮盖 span 的核心知识；
- 首先实现可靠的点击揭示；
- 再增加简单拖动刮开；
- 达到覆盖阈值后完整揭示；
- 展示解释和来源；
- 加入“想起来了 / 有点印象 / 没想起来”；
- 自评只记录 demo 状态，不宣称已经实现科学调度；
- Reduce Motion 下禁用强动效；
- VoiceOver 至少可通过“揭示答案”完成流程。

退出条件：

- 用户必须在答案隐藏时先看到 recall cue；
- 正确答案与解释来自同一张卡；
- 三种自评都能完成并进入下一张或退出。

## H6:30–H7:30：Share Extension 一小时 spike

目标：

验证系统分享入口能否在当前签名、Bundle ID 和工程配置下快速跑通。

最小实现：

```text
分享截图到 Recallo
→ extension 直接上传
→ 显示“已发送，稍后在 Recallo 查看”
```

本轮不做 App Group durable outbox。

硬止损：

- H7:00 前未成功创建 target、签名并接收图片，则停止；
- 不为 Share Extension 牺牲已经可演示的 PhotosPicker 主链；
- 未完成时在 UI 标为“下一步”，不伪装成可用。

## H7:30–H8:30：服务器与 iOS 验证

后端在 `bridge-amax:/data1/yuxiao/recallo`：

- 运行现有后端测试；
- 运行新增 demo card 合同测试；
- 对三张 fixture 各跑一次真实外网流程；
- 保存脱敏结果、耗时和错误分类；
- 确认没有下载超出当前安全预算的大视频；
- 确认日志不包含 key 和完整图片 Base64。

iOS 在 macOS/Xcode：

- 编译 App；
- 运行关键单元测试；
- Simulator 跑通 PhotosPicker；
- 若 Share Extension spike 成功，真机或 Simulator 验证分享入口。

退出条件：

- 后端测试通过；
- iOS 构建通过；
- 至少一张真实截图完成端到端；
- Bilibili、抖音真实 fixture 的结果可解释，小红书 adapter 回归通过。

## H8:30–H9:30：演示打磨

只处理影响理解的问题：

- 首页主按钮和两种模式是否清楚；
- 处理状态是否简洁；
- 卡面层级是否清楚；
- R / SR / SSR 是否像价值等级，而不是抽奖；
- fragment 是否不会被误解为失败卡；
- 来源未确认是否醒目但不打断流程；
- 刮开和自评是否能在 30 秒内理解；
- 加入必要的 loading、empty 和 retry 状态。

禁止：

- 重做整套设计系统；
- 增加更多平台；
- 调整后端架构；
- 为动画引入大型依赖。

## H9:30–H10:00：锁定交付

交付：

- 最终 commit；
- 推送 `main` 前的变更审查；
- 3 分钟演示脚本；
- Bilibili、抖音两张演示截图及其预期结果；
- 服务器测试记录；
- iOS 构建记录；
- 已知限制；
- 10 小时后生产化 backlog。

演示脚本：

```text
1. 展示一张真实内容截图
2. 在 Recallo 中导入
3. AI 整理出一张带来源状态的卡
4. 展示 R / SR / SSR 的价值解释
5. 抽 1 张并完成语义揭示
6. 选择一次自评
7. 切换连续模式，展示可随时退出
8. 说明来源未确认和记忆碎片如何避免 AI 伪造
```

## 5. MVP 验收标准

10 小时 MVP 只有全部满足才算完成：

- [ ] iPhone/Simulator 能导入真实截图；
- [ ] 调用真实 Qwen 流程，不使用伪造 AI 输出；
- [ ] 一张截图最多得到一张卡；
- [ ] 正式卡有 core knowledge、遮盖语义、解释和稀有度；
- [ ] 无法可靠生成时显示 fragment；
- [ ] 来源未验证时明确显示“未确认”；
- [ ] R / SR / SSR 是核心可见字段；
- [ ] 可以选择单张或连续抽取；
- [ ] 连续模式任意一张后可退出；
- [ ] 用户先看到线索，再揭示答案；
- [ ] 三段自评可用；
- [ ] 后端在 `bridge-amax:/data1/yuxiao/recallo` 通过合同测试；
- [ ] iOS 构建通过；
- [ ] 仓库和输出无真实 key；
- [ ] 有一条现场可重复的 3 分钟演示路径。

以下不属于 10 小时完成声明：

- 截图任务不会因服务器重启丢失；
- Share Extension 已生产可用；
- 来源恢复覆盖所有真实截图；
- 稀有度已经被用户研究验证；
- 自评已经驱动长期科学调度；
- 删除满足正式隐私 SLA；
- App 已达到上架标准。

## 6. 关键风险与止损

| 风险 | 止损时间 | 处理 |
| --- | ---: | --- |
| Bilibili/抖音来源搜索不稳定 | H2:00 | 回退 screenshot-only card；只有严格匹配链接后才显示来源已核对 |
| iOS 无法解码当前响应 | H3:00 | 增加薄 adapter，不重构后端全部 Schema |
| Share Extension 签名/App Group 卡住 | H7:00 | 停止 spike，保留 PhotosPicker |
| 真刮卡交互耗时 | H6:00 | 使用点击揭示 + 简单拖动 mask |
| 卡池不足十张 | H4:30 | 连续模式抽取当前全部，并加入真实 fixture/旧卡 |
| 外部模型临时失败 | H8:00 | 使用此前真实生成且标注时间/模型的缓存演示结果，不伪装为实时 |
| 大视频拖慢流程 | 任意时刻 | 停止下载，使用截图可见内容生成 fragment/card |
| UI 打磨挤占闭环 | H8:30 | 只修阻断理解的问题 |

## 7. 10 小时之后

生产化工作保留在：

[`roadmap-recallo-2-production-backlog.md`](./roadmap-recallo-2-production-backlog.md)

优先顺序仍是：

1. 密钥轮换与 PR #1 历史清理；
2. V3 数据合同；
3. Postgres durable queue；
4. Share Extension + App Group + GRDB；
5. 来源证据质量门与 60 张 Golden Set；
6. 长视频预算和故障恢复；
7. 正式卡版本、服务端 DrawSession 和长期调度；
8. 删除、隐私和封闭 Beta。
