## 变更摘要

<!-- 说明改变了什么，以及为什么。 -->

## Issue

<!-- 完整满足验收时使用 Closes；部分覆盖时使用 Refs。 -->

- Closes / Refs：

## 范围与非目标

- 范围：
- 非目标：

## Plan 生命周期

<!-- 简单改动可写“不适用”。复杂任务必须保留以下历史，并使用 merge commit。 -->

- 计划路径：
- `plan:` 开工提交：
- `plan: complete` / `plan: cancel` 提交：
- `plan: retire` 提交：

## 合同与稳定文档

- API / Schema / 持久化 / 兼容影响：
- 更新的稳定文档：
- 决定记录：

## 验证证据

- 命令与结果：
- UI 设备 / 视口 / 路径：
- 真实外部服务：
- 未验证项及所需条件：

## 风险、迁移与回滚

- 最高风险：
- 迁移：
- 停止或回滚条件：

## 检查清单

- [ ] 分支来自最新 `origin/main`，且 PR 面向 `main`
- [ ] 没有覆盖或静默改写其他协作者成果
- [ ] `git diff --check` 通过
- [ ] 文档变更已运行 `npm --prefix backend run docs:check`
- [ ] 代码、测试、稳定文档和 PR 描述一致
- [ ] UI 改动已实际打开并按受影响范围检查
- [ ] Fixture / Mock / 本地结果没有被表述为真实生产验证
- [ ] 未提交密钥、真实用户数据、内部地址或未授权素材
- [ ] 使用临时 Plan 时选择 merge commit，不使用 squash merge
