# Omo 文档索引

本页是 Omo 稳定文档的统一入口。临时施工状态位于 [[PLANS]] 和 `plans/`，不进入本索引。

## 产品与合同

- [[docs/product-principles]]：产品北极星、证据、召回、隐私与体验护栏。
- [[docs/ios-api-data-contract-zh]]：当前截图主链、iOS 模型、API、兼容与失败语义。
- [[docs/privacy-policy-zh]]：面向用户的隐私政策。
- [[docs/support-zh]]：面向用户的支持说明。

## iOS 与前端

- [[docs/frontend/v2-frontend-architecture]]：当前精简 SwiftUI 视图、状态与 API 边界。
- [[docs/frontend/v2-layout-system]]：当前布局 Token、召回动效和 UI 验证要求。
- [[docs/asset-provenance]]：App 素材来源、授权、处理方式与哈希。

## 工程与协作

- [[docs/quality-baseline]]：验证矩阵、UI 原则门禁与证据分级。
- [[docs/postgres-persistence]]：PostgreSQL Store、顺序 migration、readiness、导入与恢复边界。
- [[docs/issue-management-workflow]]：Issue、Project、临时 Plan 与 PR 的统一流转、标签和完成门槛。
- [[docs/documentation-guide]]：稳定文档、临时计划和决定记录的分层方式。
- [[docs/decision-log]]：重大且难以逆转的决定。
- [[AGENTS]]：所有 Coding Agent 的第一入口。
- [[PLANS]]：当前 checkout 的活跃计划。
- [[plans/README]]：计划模板、幂等生命周期和多人协作协议。

## 事实优先级

可执行代码、迁移、测试和真实运行证据优先于文档；明确的当前合同优先于普通说明；稳定文档优先于临时计划、README、Fixture 和历史描述。

如果高优先级来源互相矛盾，按 [[AGENTS#事实优先级]] 暂停扩大改动并修复漂移，不得静默选择对当前实现最方便的版本。

## 相关文档

- [[AGENTS]]
- [[docs/documentation-guide]]
- [[docs/decision-log]]
- [[PLANS]]
