# Active Recall Interaction Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan task-by-task with TDD and checkpoint commits; no subagent dispatch is used because this task has a single integrator and shared contract files.

**Goal:** Restore the approved inline semantic scratch-card and four-layer sliding self-rating interaction on the current Omo frontend/backend architecture.

**Architecture:** The backend owns a validated `hiddenSemantic` that is an exact substring of `coreKnowledge`; the iOS client only filters and renders that contract. The recall UI splits knowledge into prefix/semantic/suffix, scratches only the semantic token, reveals at 80%, then submits one of three assessments from a four-position slider while retaining the existing store and scheduling state machine.

**Tech Stack:** Node.js ES modules and `node:test`; Swift 6, SwiftUI, XCTest; JSON HTTP API; Xcode Simulator.

---

- 状态：`completed`
- 优先级：P0
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`codex/fix-active-recall-interaction-impl`
- Worktree：`/Users/hanmingyu/Documents/Recallo2.0/Omo-interaction`
- 依赖：`codex/figma-active-recall-home@c8077af`；[[docs/superpowers/specs/2026-07-29-active-recall-interaction-correction-design]]
- 推进模式：`auto`
- 可写路径：`backend/src/`、`backend/test/`、`Omo/Omo/`、`Omo/OmoTests/`、`docs/`、`plans/`、`PLANS.md`
- 禁止路径：数据库迁移、生产配置、密钥、通知、IP 视觉素材
- 高冲突文件唯一写者：Codex（`docs/ios-api-data-contract-zh.md`、`PLANS.md`）

## 动机与证据

当前卡片使用 `recallCue + answer`，并把完整 `answer` 作为独立刮开区；已确认设计和仓库护栏要求显示完整 `coreKnowledge`，仅遮住连续子串 `hiddenSemantic`。旧原型 `/Users/hanmingyu/Documents/Recallo2.0/Omo-sync` 已提供可复用的句内布局、网格覆盖率、80% 门槛、四位置滑条和状态机证据，但不能直接覆盖团队当前架构。

## 范围

- 为简化后端恢复 `hiddenSemantic` 生成、验证、单次修复和 API 输出。
- 保留 `answer` 为兼容镜像，不再用于主动回忆 UI。
- 让 iOS 只把合法、到期卡片加入最多十张的冻结牌组。
- 恢复句内承重语义刮开、80% 揭示、视觉权重、四层滑动自评和原地换卡。
- 保持知识库完整直显、assessment 幂等与 mastery 状态机。
- 更新合同、前端文档、自动测试和 Simulator 证据。

## 非目标

- 不回迁旧版完整 V2 来源恢复、多卡生成或数据库架构。
- 不增加旧卡批量重生成、用户纠错、通知卡、单抽切换或分类抽取。
- 不改变稀有度定义、调度间隔、IP 形象或知识库信息架构。

## 合同冻结

- 输入：Base64 截图；模型候选 `coreKnowledge`、`hiddenSemantic`、解释与来源元数据。
- 输出：新卡包含非空 `hiddenSemantic`，且 `coreKnowledge.includes(hiddenSemantic) === true`。
- Schema / API：`MemoryCard.hiddenSemantic: String?` 对旧客户端解码兼容；新生成卡必须有合法值；`answer` 镜像 `hiddenSemantic`。
- 兼容要求：旧卡保持可读取和知识库可见；缺失或非法 `hiddenSemantic` 的卡不进入 recall deck。
- 失败语义：模型首次违反连续子串约束时修复一次；第二次失败返回 502，服务端不保存；来源恢复失败仍生成 screenshot-only 的 R 卡。

## 文件结构

- `backend/src/cardService.js`：生成、规范化、连续子串验证与一次修复。
- `backend/test/cardService.test.js`：模型合法、修复成功、修复失败和 screenshot-only 合同测试。
- `backend/test/store.test.js`：持久化与旧卡不改写回归测试。
- `Omo/Omo/Models/OmoModels.swift`：可选字段、合法性和知识分段纯逻辑。
- `Omo/Omo/OmoStore.swift`：合法到期卡筛选。
- `Omo/Omo/RecallRoundView.swift`：卡堆容器与提交/换卡编排。
- `Omo/Omo/RecallKnowledgeCardView.swift`：句内布局、承重语义遮罩和详情入口。
- `Omo/Omo/RecallRatingSlider.swift`：四位置拖动、自评节点、震动与可访问性。
- `Omo/Omo/RecallInteractionState.swift`：80% 门槛、提交失败和评分位置纯状态。
- `Omo/OmoTests/APIClientDecodingTests.swift`：新旧合同解码。
- `Omo/OmoTests/RecallInteractionStateTests.swift`：分段、阈值、取消、提交与换卡。
- `docs/ios-api-data-contract-zh.md`：当前字段与兼容行为。
- `docs/frontend/v2-active-recall-home.md`：当前可见交互事实。

## Task 1：用失败测试冻结后端合同

- [x] 在 `backend/test/cardService.test.js` 写合法字段、首次非法后修复、二次非法失败、来源失败仍为 R 的测试。测试通过依赖注入的 `modelCaller` 和 `sourceVerifier`，不访问真实 Qwen/TikHub。

```js
assert.equal(card.hiddenSemantic, "认知卸载");
assert.equal(card.answer, card.hiddenSemantic);
assert.ok(card.coreKnowledge.includes(card.hiddenSemantic));
await assert.rejects(() => createMemoryCard(input, depsWithTwoInvalidResults), { statusCode: 502 });
```

- [x] 运行 `node --test backend/test/cardService.test.js`，确认因缺少依赖注入与 `hiddenSemantic` 而失败。
- [x] 提交测试与最小测试夹具：`test: define hidden semantic generation contract`。

## Task 2：实现后端生成、校验与一次修复

- [x] 修改 `createMemoryCard(input, dependencies = {})`，让模型调用和来源验证可测试注入；Qwen 请求新增 `hiddenSemantic` 严格约束。
- [x] 增加纯函数并导出测试：

```js
export function hasValidHiddenSemantic(value) {
  const knowledge = text(value?.coreKnowledge);
  const semantic = text(value?.hiddenSemantic);
  return semantic.length > 0 && knowledge.includes(semantic);
}
```

- [x] 第一次非法时用同一截图发出一次 repair 请求；第二次非法抛出 `httpError(502, "记忆卡缺少可验证的承重语义。")`。
- [x] 对新卡输出 `hiddenSemantic`，并令兼容字段 `answer` 与其相同；来源状态不是 `verified` 时强制 `rarity: "R"`。
- [x] 运行 `node --test backend/test/cardService.test.js backend/test/store.test.js`，预期全部通过。
- [x] 提交：`fix(api): restore hidden semantic card contract`。

## Task 3：冻结 iOS 模型与牌组资格

- [x] 先扩展 `APIClientDecodingTests`：新 JSON 解码 `hiddenSemantic`，旧 JSON 仍能解码但 `isRecallEligible == false`；再扩展状态测试覆盖句首、句中、句尾、重复词首次匹配。

```swift
XCTAssertEqual(card.hiddenSemantic, "认知卸载")
XCTAssertTrue(card.isRecallEligible)
XCTAssertEqual(card.knowledgeSegments.semantic, "认知卸载")
```

- [x] 运行目标 XCTest，确认新属性缺失导致失败。
- [x] 在 `MemoryCard` 增加 `hiddenSemantic: String?`、`isRecallEligible` 和 `RecallKnowledgeSegments`；只接受非空连续子串并使用第一次匹配。
- [x] 把 `OmoStore.dueCards` 改为同时过滤 `isDue && isRecallEligible`；`cards` 原数组和知识库保持不变。
- [x] 运行相关 XCTest，预期全部通过。
- [x] 提交：`fix(ios): gate recall deck on semantic contract`。

## Task 4：恢复句内刮刮乐卡片

- [x] 新建 `RecallKnowledgeCardView.swift`，从旧版移植并用当前 Token 重命名以下小组件：`RecallKnowledgeCardView`、`RecallInlineKnowledgeLayout`、`ScratchSemanticToken`、`RecallContextView`。
- [x] 正文渲染结构必须是：

```swift
ForEach(units(segments.prefix)) { Text($0).font(.system(size: size)) }
ScratchSemanticToken(text: segments.semantic, coverage: $coverage)
ForEach(units(segments.suffix)) { Text($0).font(.system(size: size)) }
```

- [x] `ScratchSemanticToken` 使用 12×3 网格估算真实覆盖率；80% 后一次性设为 1；未揭示时 VoiceOver 只读“被遮住的承重语义”，揭示后才读出文本。
- [x] 刮开文字使用 semibold + coral，前后文使用 regular + ink；遮罩只占 token 几何范围。
- [x] `RecallRoundView` 删除 `recallCue + ScratchAnswerView` 结构，改用新组件；保留当前卡堆、下一张稀有度光效、详情入口和 submission 状态。
- [x] 构建 iOS，预期无编译错误；运行 79% / 80% 状态测试。
- [x] 提交：`fix(ui): restore inline semantic scratch card`。

## Task 5：恢复四层滑动自评和原地换卡

- [x] 将旧版 slider 独立为 `RecallRatingSlider.swift`，保留 cancel、forgot、fuzzy、remembered 四个语义位置与三个可提交节点。
- [x] 节点位置由 `RecallRatingScale` 单一来源提供；跨节点震动，最左松手调用 `onCancel`，其余节点松手调用一次 `onCommit`。
- [x] 提交中禁用触控；失败保留 revealed 与原 assessment；重试成功才执行卡片移除并把下一张重置为 covered。
- [x] 为 `RecallRoundState` 补充重复提交、失败重试不前进、最后一张结束、取消不改变状态测试。
- [x] 运行全部 `OmoTests`，预期通过。
- [x] 提交：`fix(ui): restore semantic self rating flow`。

## Task 6：同步稳定合同与验证

- [x] 更新 `docs/ios-api-data-contract-zh.md` 的 JSON 示例、连续子串约束、旧卡兼容和生成失败语义。
- [x] 更新 `docs/frontend/v2-active-recall-home.md`，删除整块 `answer` 描述，写明句内遮罩、80% 门槛、四层滑条、取消与原地换卡。
- [x] 运行后端正式门禁：

```bash
npm --prefix backend run check
npm --prefix backend run test:all
npm --prefix backend run docs:check
git diff --check
```

- [x] 运行 iOS 全量 build/test；在常见 iPhone 与小尺寸 Simulator 检查 covered、partial、revealed、cancel、三节点、submission failure、advance 和 round complete。
- [x] 保存不含用户数据的截图/录屏至 `docs/validation/omo-active-recall-interaction-2026-07-29/`，并记录设备与人工结论。
- [x] 提交：`docs: align active recall interaction contract`。

## Task 7：完成、退役并交付

- [x] 把本计划状态改为 `completed`，记录每条命令结果、Simulator 设备、未验证的真实外部能力；提交 `plan: complete codex-fix-active-recall-interaction-impl`。
- [ ] 删除本计划并从 `PLANS.md` 移除；运行 docs check 与 diff check；提交 `plan: retire codex-fix-active-recall-interaction-impl`。
- [ ] Push 当前分支并创建面向 `main` 的非 squash replacement PR；原 draft PR #16 标记为被新 PR 取代，不合并。

## 验收标准

- 卡片只遮住 `coreKnowledge` 内的 `hiddenSemantic`，不显示独立 `answer` 刮层。
- 79% 不显示滑条，80% 完整揭示并显示四层滑条。
- 最左取消不换卡；三个节点提交正确 assessment；失败不换卡，重试成功只换一次。
- 牌组最多 10 张，只包含合法到期卡；旧卡仍在知识库完整可见。
- 新生成卡满足连续子串合同；来源失败仍能生成 R 卡；二次生成合同失败不持久化。
- 测试、构建、文档检查和 Simulator 人工检查有可复现证据。

## 原则检验

- 证据边界：前端不猜词；新字段由后端验证；揭示前视觉与无障碍均不泄露。
- UI / 美学：保留已确认 Figma 首页，仅恢复旧版正确交互；数值归入现有 Token 或组件 metrics。
- 可访问性：44pt 触控、VoiceOver 揭示门槛、Reduce Motion 和错误重试语义不退化。
- 隐私与素材：只使用合成测试文本，不提交真实截图、模型响应或密钥。

## 决定记录

- 2026-07-29：用户选择方案 2，并明确要求完全按旧版刮刮乐与滑动自评交互修复；涉及后端时同步修复。
- 2026-07-29：`answer` 仅保留兼容；主动回忆唯一事实来源为合法 `hiddenSemantic`。
- 2026-07-29：旧卡不猜词、不改写，保留在知识库但排除出 recall deck。
- 2026-07-29：实现分支叠加在未合并的 Figma 首页分支上，最终用 replacement PR 面向 `main` 交付。

## 最终验证证据

- `npm --prefix backend run check`：通过。
- `npm --prefix backend run test:all`：11 passed，0 failed。
- `npm --prefix backend run docs:check`：21 份 Markdown、163 条双链通过。
- `git diff --check`：通过。
- XcodeBuildMCP `test_sim`：9 passed，0 failed，0 skipped；iPhone SE 3 iOS 26.5，130.4 秒。
- XcodeBuildMCP `build_run_sim`：iPhone 17 与 iPhone SE 3 均构建、安装、启动成功。
- iPhone 17：确认 covered 状态不泄露 `hiddenSemantic`；revealed 状态字重/颜色正确；滑条初始值为 `0`；右拖 remembered 后后端记录一次 assessment，下一张重新 covered；完整左拖取消后 assessment 数量不变。
- iPhone SE 3：揭示与滑条无横向溢出；断开后端提交后保持 revealed 并出现原地重试；恢复后端点击重试只前进一次。
- 截图与边界说明：[[docs/validation/omo-active-recall-interaction-2026-07-29/README]]。
- 未验证：真实 Qwen/TickHub、生产持久化、APNs、真机触觉强度与生产部署。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：若真实 Qwen API 不支持同请求修复或 Simulator 不可用，完成本地合同测试并明确记录未验证条件，不伪造通过。
- 下一位 Agent：实现与验证已完成；先退役本计划，再 push 当前分支并创建 replacement PR。严禁从 `answer` 推断客户端关键词。

## 相关文档

- [[docs/superpowers/specs/2026-07-29-active-recall-interaction-correction-design]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-active-recall-home]]
- [[docs/quality-baseline]]
- [[AGENTS]]
