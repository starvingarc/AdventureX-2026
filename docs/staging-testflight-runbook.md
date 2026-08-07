# Omo TestFlight Staging 运行手册

## 安全边界

- 仅使用 Railway 项目 `Omo TestFlight Staging` 的 `staging` 环境。
- 禁止 link、读取、改变量、迁移或部署现有项目“拾贝”。
- 禁止向 `main` push；TestFlight 迭代只来自 `codex/testflight-staging-release`。
- staging 使用独立 Postgres，不导入、复制或查询生产数据。
- 密钥只保存在 Railway 变量或 App Store Connect，不写入仓库、命令输出、日志或验收截图。

## 部署前目标校验

每次 Railway 操作前都运行：

```sh
railway status --json
railway environment list --json
```

只有同时满足以下条件才能继续：

- 项目名为 `Omo TestFlight Staging`。
- `staging` 的 `isLinked` 为 `true`。
- 目标服务只能是 `omo-api-staging` 或同项目的 `Postgres`。

自动化命令还应显式传入 `--project` / `--environment staging` / `--service`，不依赖交互式选择。

## staging 变量合同

`omo-api-staging` 必须配置：

| 变量 | 要求 |
| --- | --- |
| `NODE_ENV` | `production`，用于启用 fail-closed 门禁 |
| `HOST` | `0.0.0.0` |
| `OMO_DEMO_MODE` | `0` |
| `STORE_DRIVER` | 必须显式为 `postgres` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`，仅引用同项目独立数据库 |
| `QWEN_API` | staging 专用密钥，不得从生产项目读取或复制 |
| `QWEN_BASE_URL` | DashScope compatible-mode HTTPS URL |
| `QWEN_MODEL` | 当前合同为 `qwen3-vl-plus` |
| `TIKHUB_API_KEY` | staging 专用密钥 |
| `TIKHUB_BASE_URL` | `https://api.tikhub.io` |

`NODE_ENV=production` 表示服务启用发布门禁，不表示连接 Omo 生产项目。项目和数据边界仍由上述独立 staging 资源确定。

## Migration

Migration 不在进程启动时自动执行。部署前必须先运行只读状态检查，再显式执行，最后复查版本与 checksum。

当本机不能解析 Railway 私网域名时，可仅对 staging Postgres 临时创建密码保护的 TCP proxy，运行检查和 migration 后立即删除，并确认 `tcp-proxy list` 为空。不得对生产数据库使用此流程。

## 部署与验证顺序

1. 运行后端 `check`、`test:all` 和 `docs:check`。
2. 确认 migration status 为 ready，pending 为空。
3. 确认 `QWEN_API` 与 `TIKHUB_API_KEY` 在 staging 中存在，只输出键名不输出值。
4. 从当前分支部署 `omo-api-staging`，再创建公网 HTTPS domain。
5. 验证 `/api/health` 为 200，`/api/readiness` 为 200，且 storage 显示 PostgreSQL 001/002 已应用。
6. 用全新匿名设备 ID 走空库、授权截图生成、读取、搜索、assessment 幂等、重启回读和删除。
7. 将验证过的 staging HTTPS URL 注入 Release/TestFlight 构建，不提供生产 URL 回退。

## 当前状态（2026-08-08）

- 新项目、`staging` 环境、`omo-api-staging` 和独立 Postgres 已创建。
- Migration `001` / `002` 已应用并验证 ready。
- 临时 Postgres TCP proxy 已删除，当前 proxy 列表为空。
- 非秘密变量已配置；`QWEN_API` 和 `TIKHUB_API_KEY` 尚缺失。
- 因真实供应商密钥缺失，后端尚未部署，也未生成公网 domain。
