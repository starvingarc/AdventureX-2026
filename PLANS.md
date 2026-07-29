# Omo Active Plans

本文件只索引当前 checkout 中尚未退役的临时计划，不是跨分支的全局排期数据库。多人并行状态以各自主题分支、worktree 和 Pull Request 为准；完整生命周期见 [[plans/README]]。

## 当前 checkout

| 计划 | 分支 | 负责人 | 状态 | 模式 | 进度 | 下一步 |
|---|---|---|---|---|---:|---|
| [[plans/feat-postgres-persistence]] | `feat/postgres-persistence` | Codex | `in_progress` | `manual` | 0% | 建立 migration runner 与合成测试 |

## 使用规则

- 复杂任务在实现前创建 `plans/<branch-slug>.md`，并把计划与本索引作为分支第一笔提交。
- 计划路径是当前 checkout 内的唯一键；登记时更新原行，不追加重复行。
- 不分配全局编号；不同主题分支可以同时拥有 `in_progress` 计划。
- 一个分支原则上只有一个主计划和一个负责人。
- 完成或取消后先提交证据，再在 PR 前删除计划与本表条目。
- 主线通常保持空表；已退役计划通过 Git 历史和 PR 提交列表查询。

## Git 历史入口

```bash
git log main -- plans/<branch-slug>.md
git show <plan-commit>:plans/<branch-slug>.md
```

更多查询方法、模板和非 squash 合并要求见 [[plans/README#从-Git-历史取回计划]]。
