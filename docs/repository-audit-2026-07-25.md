# Recallo 仓库与 PR 审计（2026-07-25）

## 1. 范围与结论

本审计只回答一个问题：PR #1 中哪些内容适合进入当前 Recallo v0.6，哪些应当留在旧分支或重新实现。

- 审计基线：`b00ed9dd2a6d8889d925d3593b125cd71c2641b0`
- PR：`#1 Improve full-screen screenshot source discovery`
- PR head：`d1c1ec20a3b823c73f59dff32e7081404e8ed8af`
- 状态：closed、未合并；关闭前 `mergeable=false`
- 分叉：相对当前 main，ahead 8、behind 26
- 规模：50 个文件，`+4787/-220`

结论：**salvage-only，现已关闭且未合并**。不要重新打开或整体合并 PR #1。可复用思路多数已由当前 main 的平台 Adapter、候选校验、字幕语言和 ASR 路径覆盖；剩余差异只在明确需求出现时按当前合同窄幅实现。

本文件只是处置清单，不执行删除，也不把 PR 自述的测试结果视为当前 main 的回归证据。

当前回归集合使用脚本构造的合成 B站/抖音 Fixture，不使用 PR #1 的五张真实截图。Fixture 只验证确定性合同，不代表真实视觉模型质量。

## 2. 为什么不能整体合并

当前 v0.6 已冻结的产品合同是：

1. 直接使用视觉模型理解截图，不以 Apple Vision OCR 作为主流程。
2. 每份内容只生成一张主记忆卡，题型变式绑定同一证据。
3. 无充分证据时阻断、仅存档或要求确认，不把“未溯源”包装为已完成学习内容。
4. 当前前端主线是毛球召回、单卡主动回忆、刮开答案和反馈状态机。
5. 不伪造完整知识图谱或章节式知识地图。

PR #1 同时引入了 Apple Vision OCR、未溯源截图三道题、旧 V2 章节/知识地图界面和大量 ASR 改造。即使其中部分逻辑有效，整体合并也会把旧产品模型重新带回主线，并与已并行进行的 v0.6 前端及持久化工作产生高冲突。

## 3. 测试图片处置

PR #1 新增五张被描述为“真实截图 regression fixtures”的 JPEG：

- `backend/src/flow/image2.jpg`
- `backend/src/flow/image3.jpg`
- `backend/src/flow/image4.jpg`
- `backend/src/red.jpg`
- `backend/src/tiktok.jpg`

这五张图片当前均不得进入 Golden Set 或脱敏测试图库，原因是：

- 没有逐文件 provenance、授权或采集人确认；
- 没有完成头像、账号、评论、通知、状态栏等 PII 复核；
- 没有 EXIF/定位元数据检查与清理记录；
- 没有记录裁切、模糊、重编码等处理过程和处理后校验值。

后续若要保留，必须先在 `docs/asset-provenance.md` 登记来源、授权状态、处理方式、用途与 SHA，再由独立评审确认脱敏。未完成前保持隔离，不从 PR 分支复制到 main。

## 4. 选择性迁移候选

下列内容曾是迁移候选。多数已经由 main 覆盖；未覆盖部分也不直接 cherry-pick PR 大文件：

| 候选 | 当前 main 状态 | 后续处置 |
| --- | --- | --- |
| OCR 行号语义选择 | 不迁移 | 当前主路直接使用视觉模型结构化身份，不恢复 Apple/OCR 主链 |
| 标题、账号、平台双重约束 | 已覆盖 | 保留当前 `pickCandidate` 和跨平台歧义阻断 |
| Creator-post fallback | Bilibili 已覆盖 | 抖音仅在真实失败样本证明需要时补 Adapter |
| 多平台候选不被过早截断 | 已覆盖 | 平台未知时保留候选，并拒绝近分跨平台歧义 |
| 中文字幕优先与原语言回退 | 已覆盖 | 保留 `platformSubtitles.js` 的语言顺序和单测 |
| Qwen ASR 自动语言 | 已覆盖 | `auto` 时不发送强制 language |
| `iesdouyin.com` 识别 | 已覆盖 | 保留域名白名单测试 |
| FileTrans provider 配置判定 | 部分覆盖 | 如出现配置误判，再在当前 provider 模块窄改 |
| TikHub 搜索源缓存 | 未迁移 | 当前 MVP 无必要；若引入必须有 TTL、上限和失效规则 |

## 5. 不迁移候选

以下内容不进入当前主线；这里是处置建议，不表示已删除文件：

| 文件或模块 | 原因 |
| --- | --- |
| `backend/src/flow/ocr.swift` | Apple Vision 主 OCR 路径与当前视觉模型方案冲突 |
| `backend/src/flow/unsourcedImage.js` | 未溯源时生成三题，没有当前 Evidence ID 和单主卡合同 |
| `backend/src/flow/index.js` 中未溯源三卡分支 | 把无来源结果标记为 completed，与阻断/确认规则冲突 |
| `拾贝/拾贝/V2/Screens/Flow/V2ImageFlowResultView.swift` | 旧章节与知识地图体验，不是 v0.6 毛球单卡召回流程 |
| `拾贝/拾贝/V2/Screens/Tabs/V2TabScreens.swift` 中旧入口改造 | 会与当前三栏首页及召回状态机冲突 |
| `拾贝/拾贝/V2/V2RootView.swift` 中旧入口改造 | 同上 |
| `docs/flow-demo.html` 中旧知识地图演示 | 集成主线已删除；`/demo` 已替换为 `/app-demo` 兼容别名 |
| 五张新增 JPEG | provenance、PII、EXIF 审核未完成 |

## 6. 暂缓决定候选

下列改动不属于当前前端 MVP 的必要条件，不在本轮合并；需要单独性能或产品验收后再决定：

- `backend/scripts/transcribe-local-whisper-worker.py`
- `backend/scripts/transcribe-local-whisper.py`
- `backend/src/media/localWhisperTranscriptionProvider.js`
- `backend/src/media/extractVideoLearningSource.js`
- `backend/src/media/videoExtractionCache.js`
- `backend/src/sources/extractSourceContent.js`
- `backend/src/sources/tikhubContentProvider.js`
- `backend/src/server.js` 中 ASR 模式与 worker 预热改动
- `拾贝/拾贝/Services/APIClient.swift` 中旧 image-flow 轮询合同

这些文件涉及长视频成本、并发、缓存、文章支持或旧 API 模型，不能仅根据 PR 自述的 81 项测试判断是否适合当前 main。

## 7. 保留现行主线

整合时应优先保护当前 main 已有的：

- v0.6 毛球召回、单卡、刮开和反馈状态机；
- `CaptureMemoryCardV2`、Evidence 和真实调度合同；
- `docs/asset-provenance.md` 素材登记门槛；
- Bilibili 与 Douyin 的服务器 Fixture/E2E 验收路径；
- Reduce Motion、键盘/触摸与中途恢复要求。

若 PR #1 的代码与上述合同冲突，以当前主线为准。

## 8. 后续迁移门槛

PR #1 已关闭且未合并。若未来从其分支重新参考某段代码，必须满足：

1. 先确认当前 main 尚未覆盖该行为，避免重复迁移。
2. 迁移项拆成当前模块下的窄变更，并在 `bridge-amax` 运行对应测试。
3. 五张 JPEG 未经 provenance 与脱敏验收不得迁移。
4. 当前 v0.6 的前端、Evidence 和持久化合同保持不变。

最低底线：`backend/.env.example` 中的完整 TikHub 凭据在任何复用或合并前必须替换为占位符并完成轮换。
