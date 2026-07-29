# 按 Figma 复现主动召回首页

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-07-29
- 更新：2026-07-29
- 负责人：Codex
- 整合者：Codex
- 分支：`codex/figma-active-recall-home`
- Worktree：`/Users/hanmingyu/Documents/Recallo2.0/Omo-figma`
- 依赖：Omo `main@177ec96`、既有 Figma 页面与已确认交互、未推送迁移原型 `codex/active-recall-home-sync`
- 推进模式：`auto`
- 可写路径：`Omo/Omo/V2/`、`Omo/Omo/Assets.xcassets/`、`Omo/OmoTests/`、`Omo/Omo.xcodeproj/project.pbxproj`、`docs/`、`plans/`、`PLANS.md`
- 禁止路径：`backend/`、`api/`、数据库迁移、生产配置
- 高冲突文件唯一写者：Codex（`Omo/Omo.xcodeproj/project.pbxproj`、`PLANS.md`）

## 动机与证据

团队已经在 Omo 主线继续修改前后端与召回状态机，旧 AdventureX 工作区则包含根据 Figma 完成但尚未向团队交付的首页 UI。直接推送旧分支会覆盖团队变化；正确做法是以最新 Omo 主线为唯一技术基线，在独立主题分支中选择性复现 UI，并通过 PR 让团队审查。

已有证据包括 Figma 页面、用户逐项确认的首页与召回交互，以及本地原型分支中已经跑通过的 iOS 构建、单元测试和 Simulator 交互。原型只作为实现参考，不作为当前分支的验证结论。

## 范围

- 复现首次使用无卡片首页：文件夹主体、侧边菜单入口、上传按钮和首次上传箭头引导。
- 复现有卡片首页：IP 作为默认十连抽入口，不足十张时抽取全部可用卡片。
- 复现卡堆、稀有度光效、逐区域刮开、80% 揭示阈值和揭示后的视觉权重。
- 复现三节点滑动自评：忘了、没记清、记住了；左端取消不换卡，确认后进入下一张。
- 保留并适配团队主线现有状态机、数据模型、后端/API 合同与品牌行为。
- 更新受影响的稳定前端文档、素材来源记录和自动测试。
- 在 Simulator 检查核心状态与交互，并提供团队可审查的 PR。

## 非目标

- 不修改后端、API、Schema、持久化、来源恢复、调度或通知系统。
- 不增加单抽/十连抽切换、分类抽取、关键词筛选或新手运营教程。
- 不重新设计 IP 形象、复杂动画、知识家次级页面或卡片完整上下文页面。
- 不把全机型适配扩展成独立开发任务；只在 PR 前做一个常见尺寸与一个边界尺寸的轻量门禁。
- 不直接推送或合并 `main`，不覆盖旧工作区与迁移原型中的未提交改动。

## 合同冻结

- 输入：Omo `main@177ec96` 的现有卡片、批次、评估与忘记状态；用户从相册选择的截图。
- 输出：首次上传首页与主动召回首页的 SwiftUI 表现和本地交互状态。
- Schema / API：保持 Omo 主线现状，不新增或改写字段、路由、持久化键和后端行为。
- 兼容要求：沿用 Omo 主线的 `V2MemoryCard`、批次生成、assessment 提交、忘记后重新封卡与恢复语义；保留 Omo 品牌及已有 Bundle ID 兼容层。
- 失败语义：数据不可用时沿用主线空态和失败处理；UI 不伪造卡片、来源、答案或 assessment 成功。

## 分工

| 子任务 | 负责人 | 分支 / Worktree | 可写路径 | 验证 | 停止条件 |
|---|---|---|---|---|---|
| UI 选择性复现与主线适配 | Codex | 当前分支 / Worktree | 计划列出的 iOS、测试与文档路径 | diff、编译、测试、Simulator | 需要改变 API/Schema 或覆盖主线状态机 |
| PR 整理与交付 | Codex | 当前分支 / Worktree | 计划、文档、Git 元数据 | docs:check、diff --check、PR 差异 | 凭据或远端权限阻塞 |

## 任务

- [x] 对比最新 Omo 主线、Figma 原型与迁移原型，列出只属于 UI 的可复用差异。
- [x] 复现首次上传首页、首页公共脚手架与资源，并补齐空态测试。
- [x] 复现有卡首页、十连抽卡堆、刮层、揭示阈值和三节点自评，并适配最新状态机。
- [x] 检查揭示前不泄露答案，补齐取消、确认、换卡和忘记重封测试。
- [x] 更新稳定文档和素材来源，运行文档与静态门禁。
- [x] 构建并在 Simulator 检查核心页面、交互、VoiceOver 与轻量尺寸边界。
- [ ] 记录最终证据，完成并退役本计划，推送主题分支并创建 PR。

## 验收标准

- 分支基于交付时最新 Omo `main`，团队主线的后端/API/状态机修改没有被旧实现覆盖。
- 新用户可从首页上传第一张截图；有可复习卡时可从 IP 启动默认十连抽，不足十张抽取全部。
- 卡片可逐步刮开；达到阈值后显示三节点自评；取消保留当前卡，确认切换下一张。
- 稀有度只作为视觉装饰，不成为额外交互步骤；下一张卡可通过卡堆光效暗示稀有度。
- 揭示前的可见 UI、日志与无障碍树不包含答案语义；揭示后答案与上下文文字有明确视觉权重。
- 相关测试、构建、文档门禁和 Simulator 人工检查均有可复现证据。
- 团队可通过面向 `main` 的非 squash PR 审查并合并。

## 验证

- `npm --prefix backend run docs:check`
- `git diff --check`
- `node tools/asset-catalog-guard.mjs`
- `node tools/cached-ui-fixture-guard.mjs`
- 使用实际可用 Simulator 运行 `OmoTests/FirstLaunchEmptyHomeTests` 与 `OmoTests/ActiveRecallHomeTests`。
- 使用 Omo Scheme 执行 iOS build，并在常见 iPhone 尺寸检查首次空态、抽卡前、刮开中、揭示后、自评确认和下一张。
- 在一个较小或较大 iPhone 尺寸做安全区、触控和横向溢出的轻量检查；不因该门禁扩大产品范围。
- 在 Simulator 的无障碍树确认揭示前不包含 `hiddenSemantic`，并检查自评控件有离散、非 NaN 的语义值。

## 原则检验

- 证据边界：UI 只展示主线数据，揭示前不泄露答案，不改变证据合同。
- UI / 美学：遵循 Figma 的层级、间距、卡堆、刮层、稀有度光效和揭示后文字权重；一次只突出一个主动作。
- 可访问性：保留 Reduce Motion 回退、VoiceOver 语义、触控尺寸和安全区。
- 隐私与素材：不提交真实用户截图；新增素材必须有来源、用途和授权记录。

## 决定记录

- 2026-07-29：用户批准以团队最新主线建新分支，并重新复现既有 UI 后提交给团队。
- 2026-07-29：以 `Omo/main@177ec96` 为初始基线；旧 AdventureX 与 `Omo-sync` 仅作参考，不直接合并。
- 2026-07-29：机型检查仅作为 UI PR 的轻量质量门禁，不作为新增适配功能。
- 2026-07-29：本次不实现尚无 Figma 与技术范围支持的通知、上下文详情和次级知识库功能。
- 2026-07-29：最新主线已把旧 V2 体系简化为 `ContentView + OmoStore + MemoryCard`；本分支只把 Figma UI 适配到新体系，不恢复旧模型和路由。
- 2026-07-29：主卡使用真实 `recallCue` 与 `answer`，保持现有 API 合同；答案由 Canvas 绘制，揭示前不进入无障碍树。
- 2026-07-29：常见尺寸 iPhone 17 完成真实抽取、取消、确认与换卡；边界尺寸使用干净的 iPhone SE Simulator，仅作无溢出门禁。

## 阻塞与恢复

- 当前阻塞：无。
- 解除条件：若复现需要改变 API、Schema 或主线状态机，停止施工并请求产品/合同负责人确认。
- 下一位 Agent 从哪里继续：运行最终门禁，记录提交 SHA，完成并退役本计划，然后推送 PR。

## 相关文档

- [[docs/index]]
- [[docs/product-principles]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
- [[docs/asset-provenance]]
