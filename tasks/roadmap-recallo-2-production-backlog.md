# Recallo 2.0 生产化 Backlog

> 原 Roadmap 版本：v0.1
>
> 日期：2026-07-25
>
> 对应 PRD：[`prd-recallo-2-screenshot-awakening-v0.6.md`](./prd-recallo-2-screenshot-awakening-v0.6.md)
>
> 状态：已从当前交付计划移出，仅保留为 10 小时 MVP 之后的生产化参考
>
> 当前执行路线：[`roadmap-recallo-2-10h-mvp-v0.2.md`](./roadmap-recallo-2-10h-mvp-v0.2.md)
>
> 2026-07-25 集成注记：实现验证基线 `9436bbb9552f06c07d4e0c71c5790cee7054d209` 上，Backend 167 / 167、Security 17 / 17、UI guard 30 / 30、iOS guard 8 / 8 通过。M0 的代码侧 secret gates 与加密备份已完成，但外部 key 轮换、旧 key 失效验证和 history cleanup 仍阻断；M1 已完成版本化迁移、首个持久实体纵切片与 migration 002 epoch 删除竞态围栏，iOS 也完成 canonical assessment、review-cycle 隔离和账号删除后的截图召回状态清理，但 durable job、完整 V3 API、live Postgres、Xcode/Simulator、真实 API 验证和 Gate B 仍未完成。M0、M1 均不得标记为完成。

## 1. Roadmap 目标

本 Roadmap 只服务于一个纵向闭环：

```text
用户在外部平台截图
→ Share Extension 可靠保存
→ 后端理解截图并恢复来源
→ 生成一张证据绑定的 R / SR / SSR 知识卡或记忆碎片
→ 用户选择抽 1 张或连续抽取
→ 完成语义刮开、揭示、自评
→ 卡片进入下一次复习调度
```

Alpha 的判断标准不是页面数量，而是这条链路可恢复、可验证、可删除，并且任何失败都不会伪造来源或丢失截图。

## 2. 已锁定范围

### 2.1 Alpha 必须包含

- iOS Share Extension；
- App Group 与本地持久化 capture outbox；
- 后台上传与服务端持久任务；
- `qwen3.7-plus-2026-05-26` 截图理解；
- Bilibili、抖音、小红书、网页/公众号来源恢复；
- 大视频字节、时长和分段预算；
- 正式卡与记忆碎片；
- R / SR / SSR、理由、置信度与高估/低估反馈；
- 抽 1 张与连续抽取；
- 语义刮开、直接揭示、三段自评；
- 简单复习调度；
- 单卡、截图和账号删除。

### 2.2 Alpha 不包含

- 社交、分享挑战和排行榜；
- 付费抽卡、概率、保底、货币；
- 创作者关卡生态；
- 用户可见知识图谱和星图；
- 全量历史截图自动导入；
- FSRS 或复杂个性化调度；
- 对任意长视频做完整下载；
- 正式推送通知运营体系；
- Android、Web 正式客户端。

任何新增想法先进入 backlog，不改变当前关键路径。

## 3. 时间与里程碑总览

日期按 2026-07-27 开始完整开发周计算。

| 阶段 | 日期 | 估算 | 核心交付 | 退出门槛 |
| --- | --- | ---: | --- | --- |
| M0 安全与基线 | 07-24～07-27 | 1–2 人日 | 密钥轮换、PR 处置、基线清单 | 旧 key 失效；工作分支无密钥 |
| M1 合同与持久任务 | 07-27～07-31 | 6–8 人日 | V3 Schema、迁移、durable queue | 后端重启不丢任务 |
| M2 iOS 可靠捕获 | 08-03～08-07 | 7–9 人日 | Share Extension、GRDB outbox、后台上传 | 扩展确认后零丢失 |
| M3 AI 与来源上下文 | 08-10～08-14 | 8–10 人日 | 视觉分析、统一 adapter、媒体预算 | 错误自动绑定 ≤1% |
| M4 知识卡与抽卡闭环 | 08-17～08-21 | 8–10 人日 | Card、rarity、两种抽取、刮开、调度 | 一截图一卡闭环通过 |
| M5 集成与 Alpha | 08-24～08-28 | 7–9 人日 | 恢复、删除、可访问性、端到端验证 | Alpha Go/No-Go 全通过 |
| M6 封闭 Beta | 08-31～09-11 | 8–12 人日 | 20–30 人两周验证、问题修复 | 决定继续、调整或停止 |

以上是目标窗口，不允许通过跳过安全、证据或恢复测试来维持日期。

## 4. M0：安全与开发基线

### 4.1 目标

消除 PR #1 的凭据风险，冻结干净开发起点。

### 4.2 工作项

> 状态（2026-07-25）：**代码侧安全门已完成，M0 仍阻断。** 当前树 secret scan、自动测试门、允许工作树策略和加密备份已建立；外部 key 轮换、旧 key 失效验证与 PR 历史清理尚未完成。

- [ ] 在 TikHub 控制台轮换 PR #1 中出现过的 key；
- [ ] 用只读 capability 请求验证旧 key 已失效；
- [ ] 扫描 `main`、PR 分支、GitHub Actions 日志和服务器部署环境；
- [ ] 清理 PR #1 分支历史中的真实凭据；
- [ ] 不直接合并 PR #1；
- [ ] 为可复用思想建立独立、干净的小 PR；
- [ ] 记录当前 `main` commit、数据库版本、Node 版本和服务器部署路径；
- [ ] 确认 `bridge-amax:/yuxiao` 下新的测试工作目录；
- [ ] 建立 macOS/Xcode CI 或明确真机测试责任人。

### 4.3 交付物

- 密钥轮换记录，不包含密钥本身；
- Secret scan 报告；
- PR #1 关闭或清洁重写方案；
- 环境基线文档；
- Alpha 分支与 PR 命名规则。

### 4.4 Gate A

只有全部满足才进入 M1：

- 旧 TikHub key 已失效；
- 当前开发分支、示例环境文件和 CI 日志无真实凭据；
- `main` 与 `origin/main` 状态明确；
- 后端服务器目录和 iOS 测试环境均已确定。

## 5. M1：V3 合同、数据库迁移与持久任务

### 5.1 目标

先建立不会因进程重启而丢失的业务骨架，再接入模型和 UI。

### 5.2 冻结的核心合同

- `Capture`
- `CaptureAsset`
- `EvidenceRegion`
- `SourceCandidate`
- `SourceBinding`
- `MemoryCard`
- `MemoryCardVersion`
- `DrawSession`
- `DrawSessionItem`
- `RecallAttempt`
- `ReviewSchedule`
- `RarityFeedback`

每个合同都必须定义：

- ID 与幂等键；
- 可变与不可变字段；
- 状态迁移；
- 删除语义；
- 服务端错误码；
- 客户端可恢复动作；
- Schema 与模型版本。

### 5.3 后端工作项

> 状态（2026-07-25）：**Step 1A 代码纵切片与确定性删除竞态围栏已集成，M1 未完成。** migration 002 在设备行保留单调 epoch；模型前领取 token，持久化事务锁定并核对 epoch，设备删除和账号多设备删除在同一事务内先递增 epoch 再删除 capture，旧任务明确取消且不得回写。以上由 Fixture/Repository/API 测试覆盖，不代表已经做过 live Postgres 迁移或真实数据库并发验证。进程内 job 尚未 durable 化，完整 `/v3` API、任务恢复和 Gate B 仍待完成。

- [x] 引入版本化数据库迁移机制；
- [x] 建立首个持久实体纵切片：`Capture`、`EvidenceRegion`、`SourceBinding`、`MemoryCard`、`RecallAttempt` 及必要索引；
- [x] 建立设备 epoch 持久化围栏，并以确定性测试覆盖任务领取 token、设备/账号删除、旧 token 取消且零卡片回写；
- [ ] 补齐完整 V3 表、版本实体、抽取会话、反馈实体与索引；
- [ ] 用 Postgres 持久任务替换 `imageFlowJobs.js` 的进程内 `Map`；
- [ ] 完成 `pg-boss` spike；
- [ ] 明确 Node 版本：升级最低要求或锁定兼容队列版本；
- [ ] 建立任务幂等、租约、重试、退避和 dead-letter 状态；
- [ ] `Capture` 与首个 job 在同一事务边界创建；
- [ ] 任务日志只记录 ID、状态、耗时、模型和错误分类；
- [ ] 禁止日志保存完整截图、完整模型响应和凭据；
- [ ] 建立 fixture 驱动的 worker 测试。

### 5.4 API 最小集合

```text
POST   /v3/captures
GET    /v3/captures/:id
POST   /v3/captures/:id/source-confirmation
POST   /v3/captures/:id/archive
DELETE /v3/captures/:id

GET    /v3/cards
GET    /v3/cards/:id
POST   /v3/cards/:id/rarity-feedback
DELETE /v3/cards/:id

POST   /v3/draw-sessions
GET    /v3/draw-sessions/:id
POST   /v3/draw-sessions/:id/attempts
POST   /v3/draw-sessions/:id/close
```

`POST /v3/draw-sessions` 接受：

```json
{
  "mode": "single"
}
```

或：

```json
{
  "mode": "continuous",
  "limit": 10
}
```

### 5.5 验证

在 `bridge-amax:/yuxiao` 执行：

- 空数据库迁移；
- 从当前生产快照结构迁移；
- worker 在任务不同阶段被 SIGTERM 后恢复；
- 同一幂等键并发提交；
- 数据库短暂断连后恢复；
- 重复投递不生成重复卡；
- dead-letter 人工重试；
- 删除与进行中任务竞争。

### 5.6 Gate B

- 后端重启后已确认 capture 数量不减少；
- 同一截图并发提交只产生一个 capture；
- 同一 capture 最多产生一个活动正式卡版本；
- job 可重试但业务副作用不重复；
- 当前 V2 的既有测试保持通过；
- V3 合同、迁移、幂等和恢复测试全部通过。

## 6. M2：iOS Share Extension 与可靠捕获

### 6.1 目标

用户看到“已安全保存”后，截图不能因为扩展退出、断网或主 App 未打开而消失。

### 6.2 工作项

- [ ] 新建 Share Extension target；
- [ ] 配置 App Group 与 Keychain sharing 边界；
- [ ] 引入 GRDB spike；
- [ ] 在 App Group 中建立 capture outbox；
- [ ] 图片写文件，SQLite 只存文件 URL、哈希和状态；
- [ ] 计算 SHA-256 并做本地幂等；
- [ ] 使用 background `URLSession` 上传；
- [ ] 主 App 启动时对账本地与服务器状态；
- [ ] 支持等待网络、上传中、服务器已接收、处理失败和可重试；
- [ ] 扩展只在本地事务成功后显示“已安全保存”；
- [ ] 加入截图发送给 Recallo 与模型处理的隐私说明。

### 6.3 iOS 状态机

```text
received_by_extension
→ local_file_saved
→ locally_queued
→ upload_scheduled
→ server_received
→ reconciled
```

任何一步失败都必须保留可重试信息。`server_received` 之前不能删除本地文件；服务器确认且主 App 完成对账后，按缓存策略清理本地副本。

### 6.4 测试矩阵

iOS 测试需要 macOS/Xcode CI 或真机：

- 扩展接收一张、长截图和高分辨率截图；
- 扩展写入后立即被系统终止；
- 离线分享后恢复网络；
- 主 App 从未启动、已退出和正在运行；
- 同一截图连续分享；
- App 与 extension 同时访问数据库；
- 后台上传完成时 App 不在前台；
- 用户在上传前删除；
- 磁盘不足、App Group 配置错误和数据库迁移失败；
- VoiceOver 下完成分享确认。

### 6.5 Gate C

- 本地持久化 P95 ≤2 秒；
- 100 次控制测试中，显示成功后的截图丢失数为 0；
- 20 次扩展强制终止后均可恢复；
- 离线 capture 恢复网络后自动继续；
- 重复分享不产生重复服务器 capture；
- App 与 extension 并发测试无数据库损坏。

## 7. M3：视觉理解、来源恢复与媒体预算

### 7.1 目标

把截图变成证据结构，并在不错误绑定、不无界下载的前提下恢复来源上下文。

### 7.2 Golden Set

先整理现有 30 张测试图片，再扩展为 60 张授权、脱敏、版本化样本：

- Bilibili 12 张；
- 抖音 12 张；
- 小红书 12 张；
- 公众号/网页/信息流 12 张；
- 模糊、长图、表格、高风险、错误平台和 Prompt Injection 12 张。

每张标注：

- 可见文字和证据区域；
- 平台、作者和标题；
- 正确来源或“无法确认”；
- 一个最高价值记忆点；
- 正式卡 / 记忆碎片；
- 可接受的来源候选与错误候选；
- 是否需要视频上下文；
- 风险和时效性。

### 7.3 工作项

- [ ] 冻结 Qwen 视觉输入输出 Schema；
- [ ] Evidence ID 服务端校验；
- [ ] 统一 Bilibili、抖音、小红书 adapter 到 `SourceCandidate`；
- [ ] 实现 `exact_context / verified_match / probable_match / unresolved / conflicting`；
- [ ] 只允许前两类自动绑定；
- [ ] 字幕优先、音频优先；
- [ ] 单次媒体默认预算 30 MB；
- [ ] 无字幕完整音频仅限 ≤15 分钟；
- [ ] 长视频只处理时间窗口或最多 3 段、总计 ≤180 秒音频；
- [ ] 下载和搜索支持取消、超时和延迟 hedge；
- [ ] hedge 结果仍需证据校验，不以“先返回”为正确；
- [ ] 把模型、搜索、下载、字幕和 ASR 失败分类；
- [ ] 在服务器生成质量、成本和延迟报告。

### 7.4 Gate D

- Evidence ID 合法率 100%；
- 自动绑定来源错误率 ≤1%，目标 0；
- `probable_match` 不作为确定来源展示；
- 无证据数字、日期和人名错误率 ≤1%；
- 无界完整视频下载次数为 0；
- 超预算内容稳定降级为局部上下文或记忆碎片；
- 60 张 Golden Set 的所有结果可重复生成报告；
- 模型、TikHub、字幕或 ASR 单点失败不会让 capture 消失。

## 8. M4：知识卡、稀有度与抽卡闭环

### 8.1 目标

完成用户真正能体验到的核心：一张截图成为一张可以主动重建的个人知识卡。

### 8.2 Card Pipeline

```text
Capture + Evidence + SourceBinding
→ formal / fragment disposition
→ coreKnowledge
→ recallCue
→ hiddenSemantic
→ explanation
→ rarity + reasons + confidence
→ deterministic validation
→ CardVersion
```

### 8.3 工作项

- [ ] 正式卡与记忆碎片；
- [ ] 一截图最多一张正式卡；
- [ ] 卡片版本与来源证据绑定；
- [ ] R / SR / SSR 规则、理由、置信度和版本；
- [ ] “系统低估 / 系统高估”反馈；
- [ ] 单张 DrawSession；
- [ ] 连续 DrawSession，最多 10 张；
- [ ] 同一回合不重复卡版本；
- [ ] 任意一张后无惩罚退出；
- [ ] 回合继续、丢弃和卡片失效处理；
- [ ] 语义刮开与直接揭示；
- [ ] “想起来了 / 有点印象 / 没想起来”；
- [ ] 立即、1、3、7、14、30 天简单调度；
- [ ] 稀有度只做同到期桶 tie-breaker；
- [ ] VoiceOver、Reduce Motion 和触控容错。

### 8.4 设计验证

至少验证：

- 用户能否在 30 秒内理解如何抽卡和刮开；
- 用户是否理解 R / SR / SSR 是知识价值，不是中奖概率；
- 用户是否能找到单张/连续模式切换；
- 用户是否知道连续模式可以随时退出；
- 用户自评是否被卡面流畅感误导；
- R 卡是否被感知为“失败”；
- 记忆碎片是否清楚说明缺少什么。

### 8.5 Gate E

- 一张截图最多生成一张正式卡；
- 正式卡人工直接接受率 ≥85%；
- 所有事实和答案均有证据引用；
- 同一回合重复卡版本数为 0；
- 连续模式可在 1–10 任意位置退出；
- R / SR / SSR 不改变硬性到期顺序；
- R 卡不会使用失败、普通垃圾或惩罚性文案；
- VoiceOver 和 Reduce Motion 能完成完整回合；
- 抽卡动效关闭后，业务流程仍完全可用。

## 9. M5：端到端集成与 Alpha

### 9.1 目标

把捕获、AI、来源、卡片和复习串成一个能交给真实用户的可靠系统。

### 9.2 工作项

- [ ] 从 Share Extension 到首次抽卡的端到端测试；
- [ ] App 冷启动、升级、数据库迁移和登录恢复；
- [ ] 删除卡片、截图和账号；
- [ ] 任务处理中删除；
- [ ] 模型超时、TikHub 限流、字幕失败和 ASR 失败；
- [ ] 原截图访问授权和缓存清理；
- [ ] 服务端指标、错误分类和告警；
- [ ] 隐私说明、数据删除说明和模型处理同意；
- [ ] Alpha 构建与安装文档；
- [ ] 后端部署和回滚 runbook；
- [ ] 10 名内部 Alpha 用户完成至少 50 次真实捕获。

### 9.3 测试环境边界

| 测试 | 环境 |
| --- | --- |
| 后端合同、数据库、任务恢复 | `bridge-amax:/yuxiao` |
| Qwen、TikHub、字幕、ASR、媒体预算 | `bridge-amax:/yuxiao` |
| 并发、性能、故障注入 | `bridge-amax:/yuxiao` |
| Swift 单元测试、Share Extension、App Group | macOS/Xcode CI |
| Simulator UI、VoiceOver、Reduce Motion | macOS/Xcode CI 或测试 Mac |
| 相册、系统分享面板、后台上传 | iPhone 真机 |

Linux 服务器结果不能替代 Share Extension 和真机后台行为测试；本地 Mac 结果也不能替代服务器媒体与并发测试。

### 9.4 Alpha Gate

必须全部通过：

- 扩展确认后的 capture 丢失数为 0；
- 后端重启后的任务丢失数为 0；
- 自动来源错误绑定 ≤1%；
- 无界完整视频下载为 0；
- 正式卡人工接受率 ≥85%；
- 单截图多卡错误数为 0；
- 删除后业务接口不可再访问资产；
- 关键流程无 P0/P1 崩溃；
- 服务器与 iOS 两类验证均有可审计报告；
- 真实凭据扫描无发现。

若任一项未过，不以“已知问题”形式进入 Beta。

## 10. M6：封闭 Beta

### 10.1 招募

20–30 名 18–35 岁的高频内容消费者，至少覆盖：

- 年轻知识工作者；
- 在校学生；
- 产品、设计、AI、商业或科研兴趣用户；
- 小红书、抖音、Bilibili、公众号的不同主平台用户。

不要求参与者是记忆术爱好者或重度笔记用户。

### 10.2 周期

- 第 1 周：自然截图捕获与首次唤醒；
- 第 2 周：跨时段再次唤醒与简短访谈。

### 10.3 核心研究问题

1. 用户是否愿意把真实截图发送给 Recallo？
2. AI 选出的唯一记忆点是否符合用户当时截图的原因？
3. 单张与连续模式分别在什么场景被选择？
4. R / SR / SSR 是否帮助用户判断价值，还是制造等级焦虑？
5. 语义刮开是否促使用户先回忆，还是只被当作动画？
6. 用户两周后是否能再次想起或实际调用内容？

### 10.4 观察指标

结果指标：

- 捕获后 7 天内首次有效唤醒率；
- 首次失败后的纠偏恢复率；
- 14 天内跨时段二次唤醒率；
- 用户主动标记的真实场景调用；
- 一截图一卡的用户认可率。

护栏指标：

- 错误来源绑定；
- 不安全或无证据确定性表述；
- 捕获丢失；
- 无法删除；
- R 卡被视为惩罚；
- 连续模式造成的压力或无法退出感；
- 因隐私说明不清而放弃。

诊断指标：

- 单张/连续选择比例；
- 连续模式退出位置；
- 各稀有度回忆表现；
- 高估/低估反馈；
- 记忆碎片比例；
- 来源确认与补链接比例；
- 单卡成本和延迟。

### 10.5 Beta 决策

Beta 结束后只允许三类结论：

#### Continue

可靠性与证据护栏通过，用户愿意持续捕获并完成跨时段唤醒。进入 P1。

#### Adjust

基础需求成立，但唯一记忆点、稀有度、刮开或连续模式中至少一个机制造成明显误解。先调整交互，不扩平台和功能。

#### Stop / Reframe

用户不愿发送截图，或卡片无法代表截图意图，或二次唤醒没有比相册回看产生更高价值。停止扩张，重新定义核心行为。

不得只凭截图量、抽卡次数、十连完成率或 SSR 数量给出 Continue。

## 11. 并行工作与关键路径

### 11.1 可以并行

M1 Schema 冻结后：

- iOS 可用 mock API 开发 outbox 和状态 UI；
- Backend 可实现持久任务和 fixture；
- 产品/设计可做单张/连续、稀有度和刮开可用性原型；
- AI 可整理 Golden Set 和评测器。

### 11.2 不可提前

- 未完成 Gate A，不开始使用 PR #1 的任何提交；
- 未冻结 Capture/Card 合同，不同时修改 iOS 与后端字段；
- 未完成持久任务，不接真实用户截图；
- 未完成来源证据门，不开放自动来源绑定；
- 未完成媒体预算，不启用长视频 fallback；
- 未完成 Card Pipeline，不打磨十连动效；
- 未完成 Alpha Gate，不开始公开招募。

### 11.3 关键路径

```text
密钥安全
→ V3 Schema
→ durable capture
→ Share Extension receipt
→ evidence/source pipeline
→ one-card generation
→ draw/reveal/schedule
→ end-to-end deletion and recovery
→ closed Beta
```

## 12. PR 与分支策略

建议每个 PR 控制在一个可独立验证的合同：

1. `security/provider-key-hygiene`
2. `backend/v3-capture-schema`
3. `backend/durable-capture-jobs`
4. `ios/share-extension-outbox`
5. `backend/source-candidate-contract`
6. `backend/bounded-video-context`
7. `backend/memory-card-pipeline`
8. `ios/draw-session-ui`
9. `ios/semantic-reveal`
10. `release/alpha-hardening`

合并规则：

- 从最新 `main` 建分支；
- 不整块 cherry-pick PR #1；
- 后端/AI PR 的正式测试在 `bridge-amax:/yuxiao`；
- iOS PR 必须通过 macOS/Xcode CI；
- 涉及真机后台行为的 PR 需要真机证据；
- PR 描述必须包含 Schema 变化、失败语义、验证命令和结果；
- 只在对应 Gate 通过后合并 `main`。

## 13. 每周节奏

### 周一

- 确认本周唯一里程碑；
- 冻结合同与禁止范围；
- 检查上周 Gate 是否真的关闭。

### 周中

- 合并小 PR；
- 更新服务器与 iOS 测试证据；
- 暴露失败类型，不以临时 fallback 隐藏。

### 周五

- 对照 Gate 做演示；
- 更新风险、指标和决策日志；
- 若 Gate 未过，下周优先修复，不把未完成工作包装成新阶段。

## 14. 风险登记

| 风险 | 早期信号 | 缓解 |
| --- | --- | --- |
| Share Extension 丢任务 | 扩展成功但主 App 无记录 | 本地事务先于成功提示；App Group outbox |
| 来源错误绑定 | 标题相似但作者/字幕不一致 | 多证据验证；`probable` 必须确认 |
| 平台接口变化 | TikHub/平台字段或返回码漂移 | adapter contract、fixture、capability check |
| 大视频成本失控 | 下载量、ASR 时间和失败率上升 | 字幕优先、30 MB/15 分钟/180 秒预算 |
| 模型输出漂移 | Schema 修复率和证据错误上升 | 模型版本锁定、fixture、质量门 |
| 稀有度变成中奖 | 用户只追 SSR 或贬低 R | 解释价值维度；无概率/排行/货币 |
| 自评过度乐观 | “想起来了”但后续持续失败 | 自评与客观表现共同调度 |
| 范围膨胀 | 开始讨论社交、星图、创作者 | Alpha out-of-scope 清单和 backlog |
| 删除不完整 | 卡删了但资产/任务仍存在 | 端到端删除状态机和审计测试 |
| 测试环境错配 | Linux 后端通过即宣称 iOS 可用 | 服务器、macOS CI、真机三类证据分开 |

## 15. 里程碑完成定义

一个里程碑只有在以下全部完成时才算 Done：

- 合同和迁移已版本化；
- 正常、失败、重试、删除路径均实现；
- 对应环境测试通过；
- 结果报告可复现；
- 监控和错误分类可用；
- 文档与代码一致；
- 不含真实凭据和未授权样本；
- 对应 Gate 已明确签字或记录结论。

“代码已写完”“demo 能跑”或“本地 smoke passed”都不等于里程碑完成。

## 16. 下一次立即执行的工作

按顺序：

1. 完成 M0 密钥轮换和 PR #1 处置；
2. 输出 V3 数据模型与 API Schema 草案；
3. 完成 `pg-boss` 与最小自建 Postgres 队列的两日 spike；
4. 冻结队列选型；
5. 建立第一批数据库迁移和 durable capture job；
6. 在 `bridge-amax:/yuxiao` 验证重启、重复提交和删除竞争；
7. Gate B 通过后开始 Share Extension。
