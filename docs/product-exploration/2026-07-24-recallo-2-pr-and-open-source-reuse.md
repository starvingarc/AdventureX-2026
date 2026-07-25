# Recallo 2.0 最新 PR、研究与开源复用结论

日期：2026-07-24

对应产品基线：`tasks/prd-recallo-2-screenshot-awakening-v0.6.md`

研究方式：GitHub 当前元数据与补丁核对、官方 Apple 文档、开源仓库许可证与活跃度核对、同行评审研究检索

## 1. 结论摘要

本轮建议：

1. **不直接合并 PR #1。** 它当前与 `main` 冲突，混合了来源搜索、Paddle/Apple OCR、本地 Whisper、性能实验、二进制样本和环境配置，无法作为一个可审查的产品纵切片。
2. **先处理密钥事故。** PR 历史中的示例环境文件包含真实 TikHub 凭据。必须立即轮换凭据，并从分支历史中清除；不能仅在最新提交中删掉后继续合并。
3. **复用设计思想，不直接复用受污染提交。** 建议从最新 `main` 新开干净分支，按小 PR 重写可取部分并补测试。
4. **iOS 捕获队列采用 GRDB 候选方案。** 它适合 App 与 Share Extension 共享的 SQLite outbox。
5. **后端持久任务优先评估 `pg-boss`。** 当前生产 CI 是 Node 24 / Postgres 18，运行时兼容；但仓库声明仍为 Node ≥20，必须先收紧 engine 或锁定兼容版本。
6. **抽卡核心交互保持轻量自研。** 现成卡堆、刮卡和滑杆库可以参考视觉与手势，但不应持有 Recallo 的持久会话、调度和删除状态。
7. **BiliGPT 只借鉴字幕优先与时间戳分段思路。** 其 GPL-3.0 许可证、旧技术栈和随机抽样方法都不适合直接拷贝进当前产品。

## 2. 最新 PR #1 核对

PR：[Improve full-screen screenshot source discovery](https://github.com/starvingarc/AdventureX-2026/pull/1)

核对时状态：

| 项目 | 当前值 |
| --- | --- |
| 状态 | Open，非 Draft |
| Head | `13a06d9ae5a1486b3c844fd0e9f157dcbc4f7a71` |
| Base | `83378937e6882fdbb3a1cf497c4a3175106e5e99` |
| 可合并性 | `CONFLICTING / DIRTY` |
| 提交数 | 6 |
| 文件数 | 34 |
| 变更量 | +1150 / -90 |
| 自动检查 | 0 |
| 评论 / Review thread | 0 |

当前 `main` 已包含后续 Bilibili、抖音和小红书 adapter 整理，因此 PR 的基础分支已经过时。

### 2.1 最新提交做了什么

最新提交 `13a06d9` 主要尝试限制 demo 延迟：

- 平台搜索超时从 8 秒调整为 12 秒；
- 对两个候选媒体 URL 并行启动下载，先完成者获胜并取消另一个；
- 下载函数接受上游 `AbortSignal`；
- 本地 ASR 使用固定成功 quorum；
- 代表性分块保留时间戳。

### 2.2 可以吸收的部分

| 思路 | 结论 | 进入方式 |
| --- | --- | --- |
| 下载/搜索支持 `AbortSignal` | 应吸收 | 在干净分支补充统一取消合同和测试 |
| ASR 分块保留时间戳 | 应吸收 | 写入 `LearningSource` 证据合同 |
| 搜索结果缓存 | 可吸收 | 缓存候选与证据，不缓存错误确定绑定 |
| 持久 Whisper worker | 条件吸收 | 仅在 `bridge-amax` 基准测试证明收益后 |
| ASR 凭据与视觉模型凭据分离 | 应吸收 | 独立环境变量和 capability check |
| 内部阶段进度 | 可保留 | 仅用于诊断；用户只看聚合状态 |

### 2.3 不能直接合并的部分

#### 凭据泄漏

`backend/.env.example` 在 PR 历史中含真实 TikHub 凭据。处理顺序必须是：

1. 在 TikHub 控制台轮换旧 key；
2. 验证旧 key 已失效；
3. 从 PR 分支历史清除；
4. 对仓库和日志做密钥扫描；
5. 只提交空值占位和变量说明。

本文不记录密钥内容。

#### 两路完整下载不是理想 hedge

最新实现立即同时启动两个媒体下载。虽然降低尾延迟，却会放大带宽和第三方请求，尤其不适合大视频。

更合理的 hedge：

```text
启动首选候选
→ 经过 hedge delay 仍无有效响应
→ 再启动备选候选
→ 首个通过内容校验的结果获胜
→ 取消其他请求
```

“先完成”不能等于“正确来源”。获胜结果仍需通过作者、标题、文本/字幕或画面证据验证。

#### 固定 CPU worker 缺少服务器基准

PR 默认预热 5 个本地 Whisper worker，但没有给出：

- `bridge-amax` 上的 CPU、内存和并发占用；
- 1/3/5 worker 的吞吐与 P95；
- 与 Qwen FileTrans 的质量、成本和延迟对照；
- 长音频失败和进程回收行为。

在这些数据之前，它只能是受配置保护的实验能力。

#### 测试图片不应散落源码目录

PR 把多张 JPG 放在 `backend/src` 和 `backend/src/flow`。正式处理方式应为：

- 授权且脱敏的样本进入独立 fixture 或外部受控数据集；
- 仓库只保留小尺寸、许可明确、无个人信息的必要 fixture；
- 大型真实图片不进入源码目录；
- 测试结果引用哈希与数据集版本。

### 2.4 建议的干净合并序列

不要 cherry-pick PR #1 的整块提交。以当前 `main` 为基础拆成：

1. `security/rotate-and-scan-provider-keys`
2. `backend/durable-capture-job-contract`
3. `backend/cancellable-source-resolution`
4. `backend/bounded-video-context`
5. `backend/asr-benchmark-fixtures`

每个 PR 只处理一个合同，并在 `bridge-amax:/yuxiao` 运行对应测试和基准。没有真实服务器结果时，不把性能实验标记为生产默认。

## 3. 目标架构与复用边界

```mermaid
flowchart LR
    A["iOS Share Extension"] --> B["App Group + GRDB outbox"]
    B --> C["Background URLSession"]
    C --> D["Postgres capture"]
    D --> E["Durable job queue"]
    E --> F["Qwen screenshot analysis"]
    F --> G["Platform source adapters"]
    G --> H["Bounded source extraction"]
    H --> I["Evidence-bound MemoryCard"]
    I --> J["DrawSession: 1 or up to 10"]
    J --> K["Semantic reveal + feedback"]
    K --> L["ReviewSchedule"]
```

可复用代码只应负责边界清晰的基础能力。以下状态必须由 Recallo 自己控制：

- Capture 幂等与生命周期；
- 来源证据和自动绑定门槛；
- 卡片版本、稀有度理由与用户反馈；
- 单张/连续抽取会话；
- 调度、删除与隐私语义。

## 4. 开源仓库复用清单

仓库活跃度为 2026-07-24 核对时快照。

| 仓库 | 许可证 / 状态 | 可复用性 | 决策 |
| --- | --- | --- | --- |
| [groue/GRDB.swift](https://github.com/groue/GRDB.swift) | MIT；活跃 | SQLite、迁移、并发、观察、App Group 共享 | **建议采用**，作为 iOS durable outbox |
| [timgit/pg-boss](https://github.com/timgit/pg-boss) | MIT；活跃 | Postgres 持久队列、`SKIP LOCKED`、事务集成 | **先 spike 后采用**；核对 Node engine 与 schema migration |
| [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | MIT；活跃 | 服务端 FSRS 调度 | **P1/P2 参考**；P0 先用简单窗口 |
| [open-spaced-repetition/swift-fsrs](https://github.com/open-spaced-repetition/swift-fsrs) | MIT；活跃 | 端侧 FSRS | **暂不采用**；避免端云双调度源 |
| [dadalar/SwiftUI-CardStackView](https://github.com/dadalar/SwiftUI-CardStackView) | MIT；维护较慢 | 卡堆手势与视觉参考 | **只参考**；内部 index 不适合可恢复/可删除会话 |
| [buh/CompactSlider](https://github.com/buh/CompactSlider) | MIT；活跃 | 自定义 SwiftUI slider | **不作为核心依赖**；三段自评自研更小且更易做 VoiceOver |
| [Yuiffy/BiliGPT](https://github.com/Yuiffy/BiliGPT) | GPL-3.0；代码较旧 | Bilibili 元数据、字幕优先、时间戳分组思路 | **只借鉴架构**；不复制 GPL 代码 |
| [yutto-dev/yutto](https://github.com/yutto-dev/yutto) | GPL-3.0；活跃 | Bilibili 下载/解析能力 | **不嵌入**；除非接受 GPL 分发策略 |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense；活跃 | 已知 URL 的媒体探测和受限 fallback | **继续使用**，但必须受字节/时长预算约束 |
| [mozilla/readability](https://github.com/mozilla/readability) | Apache-2.0；活跃 | 网页正文提取 | **继续使用/对齐** |
| [SocialSisterYi/bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect) | 已归档；许可边界不适合直接商用复制 | Bilibili 非官方接口参考 | **仅查阅**，不复制代码 |

### 4.1 GRDB 采用建议

P0 spike 应验证：

- App 与 Share Extension 通过 App Group 打开同一数据库；
- 写入 capture 与移动图片文件的崩溃一致性；
- extension 终止后主 App 能对账并继续上传；
- WAL、文件保护和数据库迁移行为；
- 重复分享的 SHA-256 幂等。

不要把大图二进制直接放进 SQLite；数据库保存文件 URL、哈希和状态。

### 4.2 `pg-boss` 采用建议

当前项目：

- `package.json` 和 `backend/package.json` 声明 Node `>=20`；
- 生产 workflow 使用 Node 24；
- 生产 workflow 使用 Postgres 18。

核对时最新版 `pg-boss@12.26.2` 要求 Node `>=22.12.0`，高于当前仓库的最低声明。因此只能选择以下一种：

1. 把生产与开发基线统一收紧到兼容版本，并更新 engine/CI/部署文档；
2. 锁定仍支持 Node 20 的经过验证版本；
3. 不采用该依赖，自建最小 Postgres `FOR UPDATE SKIP LOCKED` 队列。

选择前必须完成：

- crash/retry/idempotency 测试；
- job schema 迁移与回滚演练；
- worker 重启和重复投递测试；
- Railway/Postgres 连接池压力测试；
- capture 与 job 原子创建验证。

### 4.3 抽卡、刮开和自评为什么自研

这些控件视觉简单，但业务状态复杂：

- 卡片可能在回合中被删除、更新或判定失效；
- 连续模式可退出、继续和丢弃；
- 刮开结果需要可访问替代；
- 自评需要与客观表现一起入库；
- R / SR / SSR 只是展示，不决定随机概率。

第三方 UI 库可以启发动画，但核心状态必须是 reducer/state machine，而不是组件内部数组 index。

语义刮开可基于 SwiftUI 原生 mask / `destinationOut` 实现；不要复制许可证不清晰的 Gist。

## 5. BiliGPT 可借鉴与不可借鉴部分

### 可借鉴

- 先拿视频元数据，再请求字幕；
- 优先 `zh-CN` 或平台 AI 中文字幕；
- transcript 保留时间戳并按语义窗口分组；
- 缓存键包含 prompt/处理版本，避免旧结果污染新规则；
- 没有字幕时才进入更昂贵的转写。

### 不可直接复用

- GPL-3.0 代码不能在未接受相应许可证义务时复制进当前产品；
- 项目技术栈和接口实现较旧，需要重新验证；
- 随机打散或随机缩减 transcript 不适合 Recallo。

Recallo 需要围绕截图证据定位上下文。随机抽样可能恰好丢掉截图附近字幕、条件和反例，因此只能使用：

```text
截图独特文本 / 画面
→ transcript 检索
→ 命中时间戳
→ 前后语义窗口
→ 必要时补充结构性片段
```

## 6. 学习与游戏机制研究约束

### 6.1 主动回忆与反馈

检索练习通常比只重读更有利于延迟保持，失败后给出纠正反馈也能帮助修正错误（Cranney et al., 2009, [DOI](https://doi.org/10.1002/acp.1630)）。

因此 Recallo 的刮开不是装饰：

```text
先尝试回忆
→ 再揭示
→ 立即给出来源支持的正确表达
```

### 6.2 稀有度必须支持自主，而不是控制用户

教育游戏化对动机可能有正向平均效应，但研究异质性很高，不同元素不能被视为等价（Kurnaz & Koçtürk, 2025, [DOI](https://doi.org/10.1002/pits.70056)）。

一项在线学习实验发现，徽章降低了内在动机，而选择自由通过满足自主需要间接提高内在动机；两者都没有显著提高学习表现（Balci & Morris, 2026, [DOI](https://doi.org/10.1002/jcal.70234)）。

对应设计：

- 单张和连续模式由用户选择；
- R / SR / SSR 解释“为什么值得保留”，不发放外部奖励；
- 不设概率、保底、付费、排行或连续抽取惩罚；
- 产品验证必须观察长期回忆，而不是只看抽卡次数。

### 6.3 自评只能是一个信号

学习者的即时掌握判断容易受表达流畅度、熟悉感和呈现方式影响，可能高估真实记忆。反馈可以改善对正确与错误的区分（Candel et al., 2020, [DOI](https://doi.org/10.1111/jcal.12439)；Wilford et al., 2020, [DOI](https://doi.org/10.1002/acp.3724)）。

因此三段自评保留，但调度同时参考：

- 是否在揭示前形成答案；
- 是否请求提示；
- 揭示用时；
- 过去几次回忆结果；
- 卡片间隔与到期状态；
- 用户的主观“想起来了 / 有点印象 / 没想起来”。

## 7. 下一步实施顺序

### Step 0：安全

- 轮换 PR #1 暴露的 TikHub key；
- 验证旧 key 失效；
- 清理 PR 分支历史；
- 对分支、Actions 日志和服务器环境做密钥扫描。

### Step 1：合同与迁移

- 冻结 v3 Capture/Card/DrawSession API Schema；
- 增加数据库迁移机制；
- 建立 Capture → EvidenceRegion → SourceBinding → MemoryCard 链路；
- 把进程内截图任务替换为可恢复任务。

### Step 2：iOS 捕获纵切片

- 新建 Share Extension target 和 App Group；
- GRDB outbox spike；
- background URLSession 上传；
- 断网、杀进程、重复分享和 App 未安装完整启动场景测试。

### Step 3：来源与媒体预算

- 把当前 Bilibili、抖音、小红书 adapter 统一到 `SourceCandidate` 合同；
- 只允许证据通过的自动绑定；
- 实现字幕优先、音频优先、时间窗口和字节预算；
- 在 `bridge-amax:/yuxiao` 建立真实基准。

### Step 4：一张卡的完整闭环

- 正式卡 / 记忆碎片；
- R / SR / SSR 理由与置信度；
- 单张和连续抽取；
- 语义刮开、揭示、自评和简单调度；
- 删除、恢复和版本一致性测试。

## 8. Go / No-Go 门槛

进入大规模 UI 打磨前，至少满足：

- Share Extension 确认成功后的捕获零丢失；
- 后端重启不丢任务；
- 自动来源错误绑定 ≤1%，目标 0；
- 无界完整视频下载为 0；
- 单截图最多生成一张正式卡；
- 正式卡人工直接接受率 ≥85%；
- 连续模式任意位置无惩罚退出；
- R / SR / SSR 不影响硬性到期优先级；
- 所有密钥扫描通过；
- `bridge-amax` 上的后端合同、恢复与媒体预算测试通过。

## 9. 研究检索范围

Scholar Gateway · educational software 中 badges、choice、intrinsic motivation 与 performance · 5 passages · 4 articles · 2019-06-26–2026-04-09

这组结果主要覆盖教育游戏化与在线学习，不直接证明“卡牌稀有度”本身能提高长期记忆，因此稀有度仍需做产品实验，不能从文献外推为已验证效果。

Scholar Gateway · adult learners 的即时 confidence / difficulty judgments 与复习调度 · 4 passages · 4 articles · 2009-09-15–2013-10-09

这组检索支持“主观判断不应单独主导调度”，但没有直接比较 Recallo 的三段控件与特定间隔算法；权重必须通过真实使用数据校准。
