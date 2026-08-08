# 主动回忆交互选择性恢复规格

- 日期：2026-08-02
- 状态：待产品书面复核
- 团队主线基线：`omo/main@cb23265`
- 旧版交互参考：`codex/fix-active-recall-interaction-impl@009e943`
- 实施分支：`codex/continue-from-latest-main`
- 目标：在团队最新代码之上恢复此前已验收的 Omo 首页与主动回忆体验，同时保留团队后来完成的运行时安全、Profile、存储保护、测试与协作体系

## 1. 问题与约束

团队最新主线已经增加 production fail-closed、显式 Demo 模式、readiness、错误脱敏、JSON 写入回滚、Profile 页面和新的协作文档；这些改动必须保留。当前主线的主动回忆体验却退回为独立页面、整块答案刮开、较低揭示门槛和三按钮自评，与此前确认的产品主线不一致。

本次不是回滚团队版本，也不是把旧分支整体覆盖到主线，而是在最新主线的架构和数据保护之上，选择性恢复已经验收的前端体验与其必要的数据合同。

## 2. 实施策略

采用“当前主线为骨架、旧版能力逐项移植”的方案：

1. 从 `cb23265` 创建并只在 `codex/continue-from-latest-main` 开发，不直接修改或合并 `main`。
2. 保留当前 `OmoStore`、`APIClient`、上传、删除、assessment、Profile 与后端运行配置。
3. 恢复旧版首页、牌堆、句内刮开、四位置滑动自评及对应测试。
4. 将 `hiddenSemantic` 合同接入当前 `cardService`、`runtimeConfig`、持久化和错误语义，而不是替换整个后端。
5. 完成双端自动测试与 Simulator 全状态人工验收后，再创建面向 `main` 的新 PR。

不采用整体 cherry-pick、revert the revert 或以旧分支为新基线；这些方式会覆盖团队新增能力并扩大回归范围。

## 3. 必须保留的团队改动

- `backend/src/runtimeConfig.js` 及 production fail-closed 行为。
- `/api/health` 与 `/api/readiness` 的职责区分。
- 仅在非生产环境显式设置 `OMO_DEMO_MODE=1` 时使用 Fixture；生产环境禁止 Demo 模式。
- 模型、来源和存储错误码及脱敏响应，不泄露密钥、截图、上游正文或完整载荷。
- 当前 JSON Store 写入失败回滚、设备隔离、assessment 幂等与调度状态机。
- 当前后端测试基线，以及 `.github` Issue、PR、工作流和稳定文档体系。
- 团队新增的独立 `ProfileView` 及其大数据、Dynamic Type 和无障碍处理。
- 当前上传、知识库、删除和完整卡片展示能力；知识库中的卡片无需刮开。

当前尚未合并的 PostgreSQL 与 Library Detail PR 不纳入本分支，也不复制其代码。

## 4. 恢复的首页和导航

应用打开后进入此前确认的暖色 Figma 首页：

- IP 是默认十连抽入口；有可复习卡时点击 IP 开始本轮。
- 收藏夹是知识库入口；上传是次级入口，点击后调起系统照片选择器。
- 收藏夹和上传按钮在空闲、抽卡动画、刮卡、自评和换卡期间持续存在，用户不会被锁在做题页。
- 侧边菜单提供 Profile 与 Settings；复用团队当前 `ProfileView`，不重新设计 Profile。
- 不保留当前底部 Today / Library / Profile Tab 作为主要导航，以免与已确认的首页入口形成两套竞争导航。
- 首次库为空时仅用箭头引导用户上传自己的截图，不预置非用户内容。
- 有卡时首页引导点击 IP；具体 IP 形象和动画创意仍沿用现有素材，不在本次重设计。

召回发生在首页同一场景内，不跳转为全屏做题页面，也不提供中途关闭按钮。

## 5. 卡片数据合同

`MemoryCard` 增加可兼容解码的 `hiddenSemantic`。新生成且可进入主动回忆牌组的卡片必须满足：

1. `coreKnowledge` 是一条完整、独立可理解、受截图或来源证据支持的知识表达。
2. `hiddenSemantic` 非空，并且是 `coreKnowledge` 中字符完全一致的连续子串。
3. `hiddenSemantic` 是句子的承重语义，移除后会形成真实的主动回忆缺口。
4. `answer` 暂时保留用于旧客户端兼容；新卡将其镜像为 `hiddenSemantic`，两者不得冲突。

旧卡缺少合法 `hiddenSemantic` 时仍在知识库完整显示，不删除、不改写，但不进入主动回忆牌组。iOS 不得从 `answer` 或 `coreKnowledge` 自行猜测遮挡词。

## 6. 生成、验证与失败语义

当前模型 Adapter 增加 `hiddenSemantic` 输出要求，服务端在保存前验证连续子串合同：

- 首次合法：正常保存。
- 首次不合法：基于同一截图输入与具体校验错误执行一次模型结构修复。
- 第二次仍不合法：返回稳定的 502 无效模型响应，不保存卡片，不由客户端补猜。
- 显式 Demo Fixture 必须生成合同合法的 `hiddenSemantic`，并继续标记 `generationMode: fixture`。

自动溯源是截图上传后默认触发的 workflow，不向用户询问是否溯源。溯源失败不阻止生成：只根据截图生成最低稀有度 R 卡；溯源失败与语义合同失败是两类独立错误。production fail-closed、readiness 和脱敏规则在修复请求中同样生效。

## 7. 默认十连抽与牌堆

- 点击 IP 后，从当前到期且合同合法的卡中按现有顺序最多取 10 张；不足 10 张时抽出剩余全部卡片。
- MVP 只有默认十连抽，不提供单抽切换、分类抽取、关键词选择或保底文字提示。
- 本轮顺序开始时冻结，不在中途重新抽卡，也不保存“退出后恢复半轮”的状态。
- 牌堆使用四层视觉深度；当前卡之下的下一张卡可通过微弱光芒暗示稀有度。
- 稀有度只是视觉装饰，不是点击、确认或单独揭示的交互步骤，也不影响自评和复习调度。
- 最后一张自评成功后结束本轮，首页恢复空闲状态。

## 8. 句内刮刮乐

卡片正文连续呈现：

```text
prefix + [被遮住的 hiddenSemantic] + suffix
```

- 只遮住 `hiddenSemantic` 的实际文字区域，不遮整段 `answer`、整张卡或原截图。
- 刮开一点只显示实际刮到区域的文字。
- 覆盖率低于 80% 时不显示自评滑条。
- 达到 80% 时归一为完全揭示，触发一次轻震动并显示自评滑条。
- 不提供“直接揭示”按钮；用户通过刮动完成当前交互。
- 揭示后 `hiddenSemantic` 使用更高字重与强调色，前后文使用较轻字重和正文色，形成明确的视觉权重。
- 稀有度原因和来源属于卡片上的次级信息，不是必须经过的步骤。
- 卡片可展开详情 Sheet，展示完整知识、简短解释、来源标题、账号、平台、链接与真实来源状态；打开或关闭详情不改变刮开进度。

揭示前，答案不得出现在可见文字、VoiceOver label/value/hint、无障碍树、调试叠层或可被用户直接读取的状态文案中。

## 9. 四位置滑动自评

滑条从左到右有四个位置：

| 位置 | 语义 | 松手结果 |
| --- | --- | --- |
| `0.00` | 取消 | 不提交，复位，当前卡不切换 |
| `0.42` | 忘了 | 提交 `forgot` |
| `0.70` | 没记清 | 提交 `fuzzy` |
| `0.97` | 记住了 | 提交 `remembered` |

- 滑块初始在最左端；进入三个 assessment 节点时各触发一次轻震动。
- 轨道底层始终是一条从左到右完整、固定的多色渐变；拖动只改变已填满区域的遮罩宽度，因此滑块所在处显示该绝对位置对应的渐变色。
- 不能把“起点到当前位置”重新计算成一条局部双色渐变。
- 滑块描边或投影可跟随当前位置，滑块内部箭头始终保持固定青绿色，不参与渐变。
- 在 assessment 节点松手即确认；提交成功后自动换下一张。
- 提交期间阻止重复提交。失败时保留已揭示卡和当前选择，原地提供重试，不换卡。

自评只影响团队现有 mastery 与下次复习时间，不改变稀有度。

## 10. 状态与数据流

首页本轮状态：

```text
idle
→ summon
→ covered
→ scratching
→ revealed
→ submitting
→ next card / submission failed
→ complete
→ idle
```

端到端数据流：

```text
截图上传
→ 后台自动溯源
→ 生成 coreKnowledge + hiddenSemantic
→ 验证连续子串并按需修复一次
→ 保存 MemoryCard
→ iOS 只将合法且到期卡加入最多十张的牌组
→ 句内刮开达到 80%
→ 四位置滑动自评
→ POST assessment
→ 成功后首页原位换下一张
```

上传失败保留首页及已有数据并给出可重试反馈；加载失败不得用 Fixture 伪装成功。真实外部服务在没有凭据时只能报告未验证。

## 11. 代码边界

iOS：

- `ContentView` 负责启动、侧边菜单、知识库、Profile、Settings 与上传 Sheet 的路由。
- `RecallHomeView` 负责首页视觉、入口持续可见与本轮编排。
- `RecallRoundView`、`RecallKnowledgeCardView`、`RecallRatingSlider` 和 `RecallInteractionState` 分别承载牌堆、句内刮开、自评与纯状态转换。
- `MotionKit` 继续只承载动效原语，不成为业务状态事实来源。
- `OmoStore` 与 `APIClient` 继续是加载、上传、删除、assessment 的唯一动作边界。

后端：

- 在当前 `cardService` 中扩展生成、验证和一次修复，不恢复平行服务。
- 所有配置继续经 `runtimeConfig` 解析；禁止新代码直接绕过它读取互相矛盾的环境变量。
- 当前 Store 与路由合同只做向后兼容扩展，不删除已有字段或端点。

## 12. 无障碍、动效与隐私

- 所有主要点击目标不小于 44pt，并适配安全区和 Dynamic Type。
- Reduce Motion 下取消非必要位移和粒子动画，但保留抽卡、揭示、自评和换卡的完整因果与静态反馈。
- VoiceOver 在揭示前不读取答案；揭示后才提供完整知识语义。
- Fixture、测试、文档和公开仓库不得包含真实用户截图、Base64、密钥或完整模型载荷。
- Simulator 截图使用合成或授权素材，并明确它只能证明客户端状态，不代表真实生产链路。

## 13. 验收与测试

后端自动测试：

- 当前主线全部测试继续通过，包括 production fail-closed、readiness、Demo 模式、错误脱敏、Store 回滚与 assessment。
- 新卡返回合法 `hiddenSemantic`；非法结果只修复一次，二次失败返回 502 且不持久化。
- screenshot-only 卡仍生成且固定为 R。
- Fixture 仅在显式非生产 Demo 模式生效并满足新合同。
- 旧卡读取不丢失，兼容字段不被错误改写。

iOS 自动测试：

- 新旧 `MemoryCard` 均可解码，只有合同合法且到期的卡进入牌组。
- 句首、句中、句尾及重复语义均有确定分段行为，重复时遮挡第一次精确匹配。
- 79% 不展示自评，80% 完整揭示。
- 四个位置分别执行取消、forgot、fuzzy、remembered。
- 提交失败不换卡，重试成功只换一次。
- 默认牌组最多 10 张，收藏夹与上传入口在整轮持续存在。

Simulator 人工验收：

- 在主验证设备和一个较小屏幕设备检查首次空库、有卡首页、抽卡动画、四层牌堆、covered、局部刮开、80% 揭示、自评取消、三个结果、提交失败、换卡、最后一张和详情 Sheet。
- 审查触控范围、安全区、键盘或系统照片选择器返回、Dynamic Type、Reduce Motion、VoiceOver 与答案泄露。
- 为每个关键页面和状态保留截图，交由产品逐页审查视觉与交互。

## 14. 非目标

- 不直接修改、推送或合并 `main`。
- 不合入当前开放的 PostgreSQL 或 Library Detail PR。
- 不重新设计 IP、Profile、Settings 或知识库次级视觉。
- 不增加单抽、分类抽、关键词选择、保底规则、半轮恢复、用户纠错或主动推荐。
- 不在本次恢复通知卡；通知提问仍是产品核心方向，但另行实现和验收。
- 不宣称真实 Qwen、TikHub、APNs、持久数据库或生产部署已验证，除非具备真实凭据和独立证据。

## 15. 自检结论

- 团队新增能力与要恢复的产品体验已分开列明。
- 导航、牌组、刮开、自评、详情、失败和旧卡兼容没有平行事实来源。
- `hiddenSemantic`、80% 门槛、四位置坐标、固定全轨渐变、固定箭头颜色和持续入口均有可测试定义。
- 实施不依赖覆盖团队代码，可拆成小提交并在新 PR 中逐项审查。

## 相关文档

- [[docs/superpowers/plans/2026-08-02-active-recall-selective-reintegration]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
- [[AGENTS]]
