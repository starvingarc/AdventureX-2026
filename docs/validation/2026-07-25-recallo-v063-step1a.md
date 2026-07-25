# Recallo v0.6.3 Step 1A 集成验证记录

> 日期：2026-07-25
>
> 实现验证 SHA：`9436bbb9552f06c07d4e0c71c5790cee7054d209`
>
> 验证环境：`bridge-amax` 远程集成工作树

## 1. 结论边界

本轮完成的是 Step 0 代码侧安全门、Step 1A 持久化纵切片、删除竞态围栏与 iOS 合同收口在同一实现 SHA 上的最终集成验证。确定性测试和静态守卫通过，但这不等于生产迁移、真实平台链路或 iOS 运行时已经验收。

M0 仍未完成：外部 key 轮换、旧 key 失效验证和 Git 历史清理仍是阻断项。M1 也仍未完成：持久任务、V3 API、恢复测试和 Gate B 尚未通过。

## 2. 本轮集成范围

### 2.1 Step 0：安全基线代码侧

- 当前工作树和暂存内容接入 secret scan，输出只允许脱敏指纹；
- secret scan、security workflow 与允许工作树策略均有自动测试门；
- pre-commit 包含当前 secret scan、工作树守卫、产品工作区守卫和 UI 回归守卫；
- 集成前已建立加密备份；本记录不保存备份位置、密码、凭据或可恢复密钥；
- 上述内容只证明代码侧安全门存在且本次通过，不证明外部凭据已经轮换，也不证明历史提交已经清理。

### 2.2 Step 1A：持久化业务纵切片

- 引入带 `schema_migrations`、checksum、事务与 advisory lock 的版本化迁移机制；
- 建立首个最小持久实体链：`Capture → EvidenceRegion → SourceBinding → MemoryCard → RecallAttempt`；
- Postgres Repository 作为 durable 生产实现，内存 Repository 保留相同业务语义并显式返回 `durable: false`；
- 同步 image-flow 成功结果可持久化正式卡；`archive_only` 与 `needs_confirmation` 只保存碎片/待确认记录，不创建复习调度，也不进入抽取池；
- 仅持久化卡片引用的证据和受限的最小来源证据，不保存原始截图、Base64 或完整模型响应；
- 服务端拥有复习调度、assessment 幂等和 mastery 状态：`sealed → awakened → solidified → engraved`，状态只升不降；
- 新增单卡删除合同，并将卡片数据纳入设备删除与账号删除事务级联；migration 002 以保留在 `devices` 行上的单调 epoch 建立持久化围栏，模型任务先领取 token，最终写入在同一事务内锁定并核对 epoch，删除获胜时旧任务返回 `capture_persistence_stale / cancelled` 且不得重建卡片；
- iOS 已对齐列表、assessment 和删除合同，识别 `create_card / archive_only / needs_confirmation`，并在客户端抽取池排除碎片和待确认项；assessment 采用服务端返回的 canonical 值，揭示状态按 review cycle 隔离，账号删除成功后先清空内存与持久化截图召回状态再刷新；
- 稀有度与 mastery 保持独立，不把 R/SR/SSR 当作掌握程度。

## 3. 同一 SHA 验证结果

以下四组结果均针对实现验证 SHA `9436bbb9552f06c07d4e0c71c5790cee7054d209`，没有混用其他代码版本：

| 验证面 | 入口 | 结果 | 能证明什么 |
| --- | --- | ---: | --- |
| Security | current secret scan 与 security contract tests | 17 / 17 PASS | 当前树、工作流合同、fail-closed 输入与允许工作树策略通过代码侧检查 |
| Backend | `npm --prefix backend run check` | 167 / 167 PASS | 迁移 runner、Repository、幂等、epoch 删除竞态和现有后端回归通过 |
| iOS guard | `npm run check:ios` | 8 / 8 PASS | iOS 生产静态守卫和合同引用通过 |
| UI guard | `node tools/v2-ui-regression-guard.mjs` | 30 / 30 PASS | 当前 V2 UI 关键结构、canonical assessment、review-cycle 隔离、账号删除清理与片段排除规则通过静态回归 |

这些计数是确定性测试与静态守卫结果，不是线上成功率、真实模型质量或用户测试数据。

## 4. 明确未运行或未完成

- **Live Postgres：未运行。** 服务器没有已确认的非生产本地测试库；没有连接未知 `DATABASE_URL`，也没有执行真实空库、生产快照或升级迁移 smoke test。
- **Xcode / Simulator：未运行。** 本轮没有完整 Xcode build、XCTest、模拟器、VoiceOver、动态字体或中途退出恢复验证。
- **真实 API 与平台链路：未运行。** 没有调用真实视觉模型、TikHub 或 Bilibili/抖音端到端链路；Fixture 和守卫结果不能替代真实平台验收。
- **Durable worker：未完成。** `imageFlowJobs.js` 的进程内任务仍未替换为持久队列，也没有 SIGTERM 恢复、租约、重试、退避或 dead-letter 验证。
- **完整 V3 API：未完成。** 当前提供的是兼容现有 image-flow 和 memory-card 路由的 Step 1A 纵切片，不是 Roadmap 中完整的 `/v3` API 集合。
- **Gate B：未通过。** 确定性删除竞态已经由 migration 002 epoch fence 覆盖，但仍缺 live Postgres migration、持久任务恢复、数据库断连、并发提交和 live Postgres 删除竞争测试。

## 5. 下一步门槛

1. 完成外部 key 轮换、旧 key 失效验证和 Git 历史清理，关闭 M0 阻断；
2. 在明确授权的非生产 Postgres 上执行空库与升级迁移、CRUD、级联和并发幂等 smoke；
3. 建设 durable worker 后执行重启、重试与 dead-letter 测试，并在授权的非生产 Postgres 上补充真实并发删除竞争验证；
4. 在 macOS/Xcode 环境完成编译、模拟器、可访问性和恢复测试；
5. 使用经授权、脱敏的真实 Bilibili/抖音样本运行视觉模型和来源恢复 E2E。
