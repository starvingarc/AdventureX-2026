# Omo Agent Handbook

本文件是 Omo 仓库内所有 Coding Agent 的第一入口。开始工作前先阅读本文件，再读取 [[PLANS]] 与 [[docs/index]]。

Omo 采用“代码、稳定文档、临时计划同步演进”的协作方式：

- 代码与测试说明系统现在真实做什么。
- `docs/` 保存已经成立、未来仍可复用的事实。
- `plans/` 只在复杂任务施工期间说明当前分支准备怎样改变系统。
- 任何 Agent 都不得用计划、Fixture、Mock、截图或口头结论冒充已经上线或通过真实环境验证的能力。

## 快速索引

- 产品原则与边界：[[docs/product-principles]]
- iOS / API / 数据契约：[[docs/ios-api-data-contract-zh]]
- V2 前端架构：[[docs/frontend/v2-frontend-architecture]]
- V2 布局系统：[[docs/frontend/v2-layout-system]]
- 素材来源与授权：[[docs/asset-provenance]]
- 隐私政策：[[docs/privacy-policy-zh]]
- 工程质量与验证：[[docs/quality-baseline]]
- Issue 管理与全局排期：[[docs/issue-management-workflow]]
- 文档维护规范：[[docs/documentation-guide]]
- 重大决定：[[docs/decision-log]]
- 当前 checkout 的活跃计划：[[PLANS]]
- 计划生命周期与模板：[[plans/README]]

## 事实优先级

发生冲突时，不要凭印象选一个版本继续开发。先定位并记录冲突，再按以下顺序判断：

1. 可执行代码、数据库迁移、自动测试和真实运行证据。
2. [[docs/ios-api-data-contract-zh]] 等明确标注为当前合同的稳定文档。
3. [[docs/product-principles]] 中的产品、证据、隐私和可访问性护栏。
4. 其他架构、布局、素材和运维文档。
5. 当前分支的临时计划。
6. README、历史 PR、旧 Demo、Fixture、Mock 和兼容字段。

如果高优先级来源彼此不一致：

- 停止扩大改动范围；
- 在计划的“决定记录”中写清冲突和当前证据；
- 由代码负责人、合同负责人或用户确认正确方向；
- 在同一 PR 中修复代码、测试和稳定文档之间的漂移。

计划不能推翻稳定合同。需要改变合同或产品原则时，使用 `manual` 计划，并在 [[docs/decision-log]] 追加决定。

## 仓库地图与边界

| 路径 | 职责 | 改动时必须同时检查 |
|---|---|---|
| `Omo/` | SwiftUI iOS App、Xcode 工程、Fixture、客户端状态与交互 | API 解码、恢复路径、Dynamic Type、Reduce Motion、VoiceOver、Simulator |
| `backend/` | Node.js API、截图证据流、平台 Adapter、生成、持久化、调度 | 合同、幂等、迁移、失败语义、完整测试 |
| `api/` | Serverless 入口与部署适配 | `backend/` 行为、Vercel 包含文件、健康检查 |
| `docs/` | 稳定产品/工程事实、公开页面和经授权素材 | 索引、反链、公开信息边界 |
| `plans/` | 主题分支内的临时施工状态 | [[PLANS]]、负责人、验收与退役 |
| `tools/` | 仓库级静态检查与协作工具 | 可移植性、失败退出码、最小依赖 |

以下文件冲突概率高，默认采用单写者：

- `Omo/Omo.xcodeproj/project.pbxproj`
- `backend/package-lock.json`
- `backend/migrations/`
- `docs/ios-api-data-contract-zh.md`
- `Omo/Omo/V2/DesignSystem/V2DesignSystem.swift`
- `PLANS.md`

并行任务确实需要修改同一高冲突文件时，主 Agent 必须先冻结接口和合并顺序，明确唯一整合者；其他 Agent 只提交可独立挑选的改动，不并发重写同一区域。

## 多 Agent 协作协议

### 开工前冻结合同

主 Agent 在派发任何并行工作前必须写清：

- 目标和 Definition of Done；
- 每个 Agent 的负责人、分支/工作树和可写路径；
- 禁止修改的路径；
- 输入/输出合同、Schema、接口与兼容要求；
- 每个 Agent 必须运行的验证；
- 何时停止并回报，而不是继续扩展范围；
- 最终唯一整合者。

没有被冻结的合同，不要靠多个 Agent “边写边对齐”。

### 多人协作与 PR 规范

- `main` 是受保护的集成分支。任何代码、文档、计划、资产或配置变更都必须从最新 `origin/main` 创建主题分支，通过面向 `main` 的 Pull Request 合入；禁止任何人或代理直接向 `main` push，包括 force push。
- 开工前先确认工作区干净并 `git fetch origin`，再从最新主线创建职责单一、名称清晰的分支，例如 `feat/...`、`fix/...`、`docs/...` 或 `codex/...`。不得为了省事直接在 `main` 上累计待发布提交。
- 多人并行期间定期同步 `origin/main`；发现主线变化时在主题分支内 rebase 或合并并解决冲突，不覆盖、丢弃或静默改写队友成果。共享分支禁止未经协商的历史重写。
- 准备交付时只 push 当前主题分支并创建 PR。PR 必须说明范围、计划／文档影响和验证证据；测试与必要评审未通过前不得合入。即使是文档、小修或紧急修复也遵循同一流程。
- 使用临时计划的 PR 禁止 squash merge；默认使用 merge commit，确保计划的创建、推进、完成和删除提交在 `main` 历史中可追溯。
- 完成范围内实现并通过验证后，默认授权代理 push 当前主题分支并创建面向 `main` 的 PR，不必再次询问；只有用户明确要求仅保留本地、凭据或冲突阻塞、验证失败等异常情况才停下。合并 PR 始终是后续独立动作，不因默认开 PR 而自动执行。

### 工作树补充

- 优先让每个并行 Agent 使用独立 Git worktree 和独立主题分支。不得让多个 Agent 在同一工作树同时改写文件。
- 开工前检查 `git status --short --branch`。现有未提交改动属于用户或其他 Agent；不要覆盖、回退、暂存或顺手整理。
- 每个分支原则上只有一个主计划和一个明确负责人。可独立评审、独立验证或独立回滚的范围应拆成不同分支。

### Issue、Project 与 Plan 边界

- GitHub Issue 保存长期问题、范围、验收与依赖；Omo Roadmap Project 保存跨分支状态、优先级与迭代。
- 复杂任务开工后仍必须使用当前主题分支的临时 Plan；Issue 或 Project 不替代 `plans/<branch-slug>.md`。
- Issue 完整验收时 PR 使用 `Closes #N`；只覆盖部分范围时使用 `Refs #N`，合入后缩小原 Issue 或创建剩余子 Issue。
- 分诊、标签、Milestone、Ready / Done 门槛和父子任务规则见 [[docs/issue-management-workflow]]。

### 交付与集成

- Agent 交付必须包含：改动范围、关键决定、变更文件、验证命令与结果、未验证项、风险和后续动作。
- “我实现了”不是验证证据；必须给出可复现的命令、测试结果、截图/录屏或真实服务回执。
- Fixture、Mock、静态合同测试和短 smoke 只证明它们实际覆盖的层级，不证明真实 Qwen/TikHub、Postgres worker、APNs、Simulator、真机或生产部署成功。
- 整合者在合并前重新运行跨边界验证，不直接相信子 Agent 的自报结论。
- 发现超出当前验收的新问题时，记录为新 `proposed` 计划；不要偷偷塞进当前分支。

## 复杂任务与临时计划循环

简单修复、单点文案和范围明确且一次验证即可完成的小改动不强制创建计划。满足任一条件时视为复杂任务：跨多个功能域或稳定文档、需要分阶段验收、预计包含多笔实现提交、存在迁移／隐私／发布风险，或用户明确要求计划。

1. 从最新 `origin/main` 创建主题分支，读取 [[PLANS]]；它只索引当前 checkout 的活跃计划，不承担跨分支全局排期。
2. 在任何实现前创建 `plans/<branch-slug>.md`，在 [[PLANS]] 登记。计划名使用分支名把 `/` 换成 `-`，不使用全局递增编号。
3. 计划必须写清动机、范围、非目标、任务、验收、验证、负责人、分支和推进模式。第一笔提交只能包含计划与活动索引，提交信息为 `plan: <slug>`。
4. `auto` 计划满足自治边界后可直接进入 `in_progress`；`manual` 计划必须有用户批准。多人可在各自主题分支同时拥有 `in_progress`，不再要求全仓库唯一。
5. 按计划施工；每个可验证阶段同步勾选任务、记录范围变化与决定，并把计划更新纳入对应阶段提交。稳定事实仍同步到 `docs/`。
6. 所有验收满足后，把最终验证证据写入计划并提交 `plan: complete <slug>`。未完成项必须进入新的临时计划或明确取消原因。
7. 创建 PR 前删除该计划并从 [[PLANS]] 移除，提交 `plan: retire <slug>`，运行 `npm --prefix backend run docs:check`。PR 正常 diff 不应新增已完成计划文件。
8. PR 正文记录计划路径以及创建、完成、退役提交；使用 merge commit 合入。历史查询见 [[plans/README#从-Git-历史取回计划]]。

Omo 的幂等补充：

- 计划身份只由分支 slug 决定。创建前检查同名文件；已存在则恢复或移交，不得覆盖重建。
- [[PLANS]] 以计划路径为唯一键；重复登记必须更新原行，不得新增重复行。
- 需要多个 Agent 并行、改变 API／Schema／持久化／调度／来源证据或兼容行为，也一律视为复杂任务。

状态、推进模式、冲突处理、恢复和完整模板见 [[plans/README]]。

## 文档沉淀

- `docs/` 只写已实现、已决定且未来仍有复用价值的事实。
- `plans/` 写当前分支的动机、任务、范围、风险和验收，不充当长期文档。
- 代码、Schema、产品行为、素材来源或验证边界变化时，同一个 PR 更新对应稳定文档。
- 文档不得把未来功能写成现在能力；未来范围链接到活动计划。
- 新稳定文档必须被 [[docs/index]] 或另一篇已索引文档引用，并包含“相关文档”段落。
- 重大且难以逆转的产品、合同、迁移、隐私或依赖决定追加到 [[docs/decision-log]]，保留旧决定及替代关系。
- 内部导航使用仓库根目录相对的双链并省略 `.md`，例如 `[[docs/product-principles]]`。
- 完整分层、更新触发条件和完成定义见 [[docs/documentation-guide]]。

## Omo 产品与工程护栏

### 证据优先

- 截图主链是“截图 → 来源识别 → 受限来源恢复 → Evidence → 记忆卡 → 调度”，不是无来源内容生成器。
- 题目、答案、解释、`hiddenSemantic` 和 `sourceEvidenceIds` 必须能回到真实证据。
- 来源弱、跨平台歧义或证据不足时，返回 `archive_only` 或 `needs_confirmation`；不得为了完成流程伪造来源、标题、原文、时间戳或置信度。
- 当前正式 `capture_memory_card_2` 合同优先读取 `memoryCards` / `schedules` 数组。默认一张；只有语义独立且各自证据充分时才允许 2–3 张。
- 单数 `memoryCard` / `schedule` 是首卡兼容镜像。不得把数组与单数镜像拼接、重复持久化或复制兄弟卡的 assessment、mastery 和 schedule。

### 召回与交互

- Omo 的目标是让用户先尝试回忆，再揭示证据支持的答案；不要把流程退化成被动摘要浏览。
- 揭示前不得在可见 UI、缓存预览、日志、VoiceOver label/value/hint 或无障碍树中泄露 `hiddenSemantic` 或足以直接推出答案的原文。
- `R / SR / SSR` 表示知识节点的核心潜力，不表示抽取概率、付费等级、掌握程度或用户价值。
- 一次交互只突出一个主要动作。动画和角色反馈服务于理解、因果和情绪，不得遮挡内容、拖延关键操作或破坏 Reduce Motion 回退。

### 幂等、持久化与兼容

- 重复截图、任务重试、assessment `attemptId`、任务恢复和卡片删除必须保持 canonical、可重试且不会复活旧数据。
- 数据库变化只能通过新的顺序 migration 前进；不修改已经发布的 migration。
- 品牌已经统一为 Omo / 哦莫，但旧 Bundle ID、持久化键、环境变量和服务回退可能是有意兼容层。禁止无审计的全局替换。
- 客户端兼容字段不能反向成为新行为的事实来源。改变兼容语义前先更新合同、迁移和恢复测试。

### 隐私、素材与公开仓库

- 不提交密钥、token、真实用户截图、个人信息、完整模型请求/响应、生产数据库导出、内部服务地址或未授权素材。
- `.env.example` 只包含空占位和说明，绝不包含可用凭据。
- Fixture 必须是合成、脱敏或明确授权的最小数据，并记录来源、用途和哈希；测试模式必须显式隔离，不能在生产请求中启用。
- 新素材或替换素材必须同步 [[docs/asset-provenance]]；没有明确来源和授权状态的素材不得进入 App target。
- 任何会删除用户数据、改变权限、运行生产迁移、产生费用或向外部发送消息的操作都必须使用 `manual` 计划并获得明确授权。

## 验证与原则检验

验证应与改动范围匹配；只运行最小测试不代表可以跳过受影响的关键路径。

### 文档与协作规则

```bash
npm --prefix backend run docs:check
git diff --check
```

### 后端

```bash
npm ci --prefix backend --ignore-scripts
npm --prefix backend run check
npm --prefix backend run test:all
```

按范围补充：

```bash
npm --prefix backend run check:v2
npm --prefix backend run check:video-source
npm --prefix backend run smoke:v2:queue
```

修改单个模块时可先运行对应 `node --test <test-file>`，但准备集成前仍运行覆盖该边界的正式门禁。

### iOS

- 优先用 Xcode 或可用的 Xcode 构建工具确认项目 `Omo/Omo.xcodeproj`、Scheme `Omo` 和目标 Simulator，再执行 build/test。
- CLI 回退先运行 `xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations`，再用实际可用的 Simulator UDID 运行测试。
- 改动 Codable、API、恢复状态、Fixture 或路由时，运行相关 `OmoTests`，并在真实 App 入口走通受影响路径。

### UI、视觉与原则门禁

所有 UI 改动都必须实际打开并检查受影响页面：

- SwiftUI 页面使用 Simulator；HTML Demo 使用 Playwright 或真实浏览器。
- 至少覆盖一个常见 iPhone 尺寸和一个能暴露布局问题的更大/更小尺寸。
- 检查浅色/深色适用性、Dynamic Type、Reduce Motion、VoiceOver 语义、键盘/焦点、触控尺寸、滚动、安全区和无横向溢出。
- 对照 [[docs/product-principles]]、[[docs/frontend/v2-layout-system]] 和改动前基线截图逐项比较。
- 如果发现美学、层级、证据揭示、可访问性或产品原则不符，先重改再交付；“能编译”不等于 UI 验收通过。
- PR 或交付说明附上受影响状态的截图/录屏、视口/设备、操作路径和人工结论。

### 外部与生产能力

- 平台 Adapter、Qwen/TikHub、ASR、Postgres 持久任务、APNs、Railway/Vercel 或真机行为变化时，Fixture 与本地测试之后还要执行对应真实环境验证。
- 没有凭据、设备、网络或权限时，明确写“未验证”与所需条件，不得改写为通过。
- 部署成功、HTTP 200 或构建成功只证明该层；不能替代业务闭环、数据持久化、内容质量或 UI 原则验收。

完整质量矩阵见 [[docs/quality-baseline]]。

## 完成定义

任务只有同时满足以下条件才算完成：

- 范围内代码、测试、合同、稳定文档和计划状态一致；
- 验收标准逐项有证据；
- 受影响 UI 已实际查看并通过原则检验；
- 未验证项、风险、外部依赖和后续计划已明确；
- 没有覆盖用户或其他 Agent 的未提交成果；
- 复杂任务已经先提交完成证据，再按规范退役计划；
- 交付信息足以让整合者复现验证并安全合并。
