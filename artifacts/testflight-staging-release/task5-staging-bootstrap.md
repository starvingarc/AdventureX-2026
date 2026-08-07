# Task 5 Railway staging 建立证据

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- 目标项目：`Omo TestFlight Staging`
- 目标环境：`staging`
- 服务：`omo-api-staging`、独立 `Postgres`

## 完成

1. 通过 `railway init --name "Omo TestFlight Staging"` 新建空项目。
2. 新建并链接 `staging` 环境；Railway 自动生成的空 `production` 环境未放置任何服务。
3. 在 `staging` 中新建独立 Postgres 和空的 `omo-api-staging`。
4. 配置非秘密变量与同项目 Postgres 引用，设置时使用 `--skip-deploys`。
5. 首次只读 migration status：`storage_migration_required`，applied 为空，pending 为 `001/002`。
6. 本机不能解析 Railway 私网域名；改用临时密码保护 TCP proxy 执行 migration。
7. Migration 结果：target `002`，newly applied `001/002`；复查 ready 为 true，pending 为空。
8. 临时 TCP proxy 已删除，删除后 proxy 列表为空。
9. 本机与 staging 服务均缺少 `QWEN_API` / `TIKHUB_API_KEY`，因此 backend 未部署、未建公网 domain。

## 安全结论

- 未 link、读取或修改现有项目“拾贝”。
- 未读取或导入生产数据。
- 未部署生产或 staging backend。
- 未输出、记录或提交数据库凭据。
- 所有代码更改仅位于 `codex/testflight-staging-release`。
