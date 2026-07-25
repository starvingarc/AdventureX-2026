# Recallo 文档索引

本文件是仓库文档的入口。文档发生冲突时，按以下优先级判断：

1. 当前产品合同与当前运行代码；
2. 当前验收记录；
3. 架构和研究参考；
4. 延后发布的 App Store、账号与运营材料。

旧文件保留不代表仍是实现依据。不要为了“统一”删除历史文档；应在本索引标明状态。

## Current：当前 source of truth

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 当前产品闭环、运行入口与测试命令 |
| [`../tasks/prd-recallo-2-screenshot-awakening-v0.6.md`](../tasks/prd-recallo-2-screenshot-awakening-v0.6.md) | v0.6 产品合同；一份内容一张主卡、召回、刮开、反馈与 R/SR/SSR |
| [`../tasks/roadmap-recallo-2-10h-mvp-v0.2.md`](../tasks/roadmap-recallo-2-10h-mvp-v0.2.md) | 当前 10 小时 MVP 范围和完成定义 |
| [`recallo-v06-motion-and-assets.md`](recallo-v06-motion-and-assets.md) | 毛球状态机、召回时间轴、刮开与 Reduce Motion 合同 |
| [`recallo-v06-animation-production-checklist.md`](recallo-v06-animation-production-checklist.md) | 动画制作、复用与待补素材清单 |
| [`asset-provenance.md`](asset-provenance.md) | 所有进入应用素材的来源、许可和处理登记 |
| [`../backend/src/flow/README.md`](../backend/src/flow/README.md) | 截图到一张 Evidence 卡及调度的后端主链 |
| [`validation/2026-07-24-recallo-v06-mvp-validation.md`](validation/2026-07-24-recallo-v06-mvp-validation.md) | 后端/Web 合同验收及真实模型质量边界 |
| [`validation/2026-07-24-recallo-v06-ios-interaction.md`](validation/2026-07-24-recallo-v06-ios-interaction.md) | iOS 交互合同、静态验收与 Apple 工具链边界 |
| [`repository-audit-2026-07-25.md`](repository-audit-2026-07-25.md) | PR #1 关闭后的保留、迁移与不迁移清单 |

代码级数据真值位于：

- `backend/src/flow/captureMemoryCard.js`：`CaptureMemoryCardV2`、Evidence、稀有度和三种 recall variant；
- `backend/src/flow/reviewSchedule.js`：反馈后的真实调度；
- `backend/src/flow/captureMemoryRepository.js`：卡片、反馈、删除和调度持久化；
- `docs/ios-app-demo.html`，由 `/app-demo` 和兼容别名 `/demo` 提供：当前前端交互预览；
- `拾贝/`：正式 SwiftUI App。

## Reference：架构、研究与兼容资料

下列文档仍有背景价值，但部分章节描述链接、章节或三题式旧链。发生冲突时，以 Current 区和运行代码为准。

| 文档 | 仍可参考的内容 | 不应继续沿用的内容 |
| --- | --- | --- |
| [`codebase-guide-zh.md`](codebase-guide-zh.md) | 目录与旧模块定位 | 把 quick review 三题链描述为当前唯一主链 |
| [`fragment-memory-architecture-zh.md`](fragment-memory-architecture-zh.md) | 字幕优先、窗口化、缓存 | 截图不是主链、章节和三题式输出 |
| [`media-learning-source-architecture-zh.md`](media-learning-source-architecture-zh.md) | Source-first、字幕/ASR、视频边界 | 复用旧 V2 章节出题作为最终输出 |
| [`ios-api-data-contract-zh.md`](ios-api-data-contract-zh.md) | 设备隔离与旧 API 兼容 | Chapter 是当前主实体的表述 |
| [`image-flow-code-detail-zh.md`](image-flow-code-detail-zh.md) | 截图来源恢复历史实现 | 与当前 `CaptureMemoryCardV2` 冲突的输出口径 |
| [`content-modality-question-generation-research-zh.md`](content-modality-question-generation-research-zh.md) | 内容形态与题型研究 | 不作为 P0 功能承诺 |
| [`question-type-learning-research-zh.md`](question-type-learning-research-zh.md) | 主动回忆与题型证据 | 不替代当前单卡合同 |
| [`shibei-theoretical-foundation-zh.md`](shibei-theoretical-foundation-zh.md) | 理论背景 | 不作为工程验收结果 |
| `/demo` 历史入口 | 兼容旧书签 | 已替换为 `/app-demo` 别名；旧 `flow-demo.html` 已删除 |
| [`../tasks/prd-ai-knowledge-review-ios.md`](../tasks/prd-ai-knowledge-review-ios.md) | 历史需求 | 不覆盖 v0.6 PRD |
| [`../tasks/roadmap-recallo-2-production-backlog.md`](../tasks/roadmap-recallo-2-production-backlog.md) | MVP 后生产化候选 | 不作为当前 10 小时交付阻塞项 |

## Deferred App Store：保留但不驱动当前 MVP

以下文档不得删除。它们服务后续账号、隐私、发布和 App Store 操作，但不应改变当前截图到召回闭环：

- `app-store-*.md`、`app-store-*.json`；
- `account-*.md`；
- `privacy-policy-zh.md`、`privacy-policy.html`、`app-store-privacy-labels.*`；
- `support-zh.md`、`support.html`；
- `production-hardening-*.md`、`production-readiness-*.md`；
- `railway-cloud-prototype-zh.md`、`v2-production-deploy-runbook-zh.md`；
- `recommended-articles-*.md`。

这些文件只有在任务明确进入账号、上线或提审阶段时才升级为 Current。公开的 `/privacy` 和 `/support` 路由可以继续存在，这不表示本轮要执行 App Store 提审。

## 快速入口

- 看当前产品效果：启动后端后打开 `/app-demo`；
- 看产品边界：阅读 v0.6 PRD；
- 改召回交互：先读动效规格和动画制作清单；
- 改截图后端：先读 `backend/src/flow/README.md` 与 `captureMemoryCard.js`；
- 加素材：先更新 `asset-provenance.md`；
- 判断测试结论：先看 validation 文档中的环境与限制。

## 文档维护规则

1. 新的产品方向先更新 v0.6 PRD 或创建明确的新版本，不在旧架构文档中暗改。
2. 运行命令、路由或主合同变化时，同步更新根 README、flow README 和本索引。
3. 验收报告必须写明环境、Fixture/真实数据边界和未验证项。
4. App Store 文档保持可追溯，不因当前不实施而删除。
5. Reference 文档若重新成为实现依据，先修正过时描述，再移入 Current。
