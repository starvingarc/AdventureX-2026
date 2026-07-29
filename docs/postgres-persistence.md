# Omo PostgreSQL 持久化合同

本页描述 Omo 当前 PostgreSQL Store、顺序 migration、readiness、合成 JSON 导入与恢复边界。它不表示 Railway 或任何生产数据库已经部署、迁移或验证。

## 选择 Store

- 未设置 `DATABASE_URL`：使用 JSON Store，只允许本地开发；生产 readiness 必须失败。
- 设置且通过校验的 `DATABASE_URL`：使用 PostgreSQL Store；只有连接成功且所有 migration 版本与 checksum 一致时 storage readiness 才成功。
- 设置了错误的 `DATABASE_URL` 或连接池参数：不回退 JSON，readiness 与业务请求 fail closed。

canonical 环境变量：

| 名称 | 默认值 | 作用 |
|---|---:|---|
| `DATABASE_URL` | 空 | PostgreSQL 连接串；不得写入仓库或日志 |
| `DATABASE_POOL_MAX` | `10` | 单个进程的最大连接数 |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | 建立连接的超时 |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | 空闲连接释放时间 |

TLS、证书与目标网络参数应由 `DATABASE_URL` 和部署平台合同提供。本仓库不提交证书、密码或内部地址。多实例／Serverless 的总连接数需要在 #20 的真实部署中按实例数和数据库上限重新核算，本地默认值不是生产容量结论。

## Schema 与迁移

迁移位于 `backend/migrations/`，只允许新增 `NNN-description.sql`：

- `001`：建立 `omo_owners`、`omo_memory_cards` 与 owner/time 查询索引。
- `002`：为卡片增加单调 `version`，并建立有唯一约束的 `omo_assessment_attempts`。

`omo_schema_migrations` 记录版本、文件名、SHA-256 checksum 和应用时间。runner 在同一事务中获取 PostgreSQL advisory lock，检查已应用版本和 checksum，再顺序执行待应用文件。已发布 migration 不得改写；checksum 漂移、未知版本或目标版本落后都会停止。

服务启动不会自动执行 migration。显式命令：

```bash
npm --prefix backend run db:migrate
npm --prefix backend run db:check
```

`db:migrate` 只输出版本与结果码，不输出连接串或 SQL 参数。`db:check` 与 `/api/readiness` 都只检查连接和完整 migration 集，不修改业务数据。

## Owner 与身份边界

当前 API 仍把 `X-Device-Id` 当作不透明 owner key，并在首次写卡时建立 `owner_kind=device` 的 owner。它不是认证、授权或可信账号边界，调用方可以伪造；生产账号、会话、设备到账号迁移与受保护数据访问由 #19 定义。

因此 PostgreSQL 持久化通过不等于账号系统或生产 beta 已完成，也不能独立解除 #20 对账号闭环的阻塞。

## 写入、幂等与并发

- 卡片 canonical key 是 `(owner_id, card_id)`。重复 capture 使用 `ON CONFLICT DO NOTHING` 并返回第一次保存的卡，不覆盖 mastery、assessment 或 schedule。
- assessment 在事务内锁定卡片行；`(owner_id, card_id, attempt_id)` 唯一，重复 attempt 返回当前卡且不重复计数。
- assessment 更新同时检查卡片 `version`；不符合预期版本时返回 `storage_write_conflict`，不静默覆盖。
- 删除使用数据库级原子删除，并级联删除 assessment attempts。与 assessment 并发时，事务锁保证最终卡片不会复活。
- 驱动、网络、SQL 和约束原始错误不会进入 API；调用方只看到稳定的 `storage_unavailable`、`storage_write_conflict` 或 readiness blocker。

## JSON 导入

JSON Store 不会在服务启动时自动搬迁。先运行 migration，再用合成或已获授权的数据显式导入：

```bash
npm --prefix backend run db:import-json -- \
  --file=/absolute/path/to/cards.json \
  --dry-run

npm --prefix backend run db:import-json -- \
  --file=/absolute/path/to/cards.json \
  --confirm-authorized-data
```

非 dry-run 必须提供 `--confirm-authorized-data`。导入按 canonical key 幂等处理；已有卡不覆盖。命令只报告 scanned/imported/existing 数量，不打印 owner、卡片内容或文件中的数据。

## 本地验证与恢复

需要本机 PostgreSQL 工具链：

```bash
npm --prefix backend run test:postgres
```

该命令只在临时目录创建绑定 `127.0.0.1` 的 PostgreSQL 集群和合成数据库，验证：

- 空库 migration、从 `001` 升级到 `002`、并发 runner 与 checksum 漂移；
- 重复 capture、重启服务回读、assessment 幂等与并发；
- assessment/delete 竞争、合成 JSON dry-run/导入；
- `pg_dump` 到新数据库的 `pg_restore` 与合成卡片回读。

测试结束会停止临时集群并删除临时目录。本地演练不证明 Railway 网络、真实数据库权限、生产负载、备份保留或灾难恢复时限。

生产迁移／恢复必须使用 manual Plan 和人工授权。默认策略是先停止写流量、记录应用与 migration 版本、创建并验证备份，再执行迁移。仓库不提供破坏性 down migration；如必须恢复数据，应恢复到新的数据库、验证 migration 与业务回读，再经授权切换连接，不直接覆盖原库。

## Readiness

PostgreSQL storage readiness 的安全字段：

```json
{
  "required": true,
  "ready": true,
  "driver": "postgres",
  "durable": true,
  "reason": "",
  "appliedVersions": ["001", "002"],
  "pendingVersions": []
}
```

常见 blocker：

- `database_url_invalid`
- `database_pool_max_invalid`
- `database_connect_timeout_invalid`
- `database_idle_timeout_invalid`
- `storage_not_checked`
- `storage_migration_required`
- `storage_migration_drift`
- `storage_migration_unknown`
- `storage_unavailable`

这些字段不包含连接串、数据库主机、用户名、owner 或卡片内容。

## 相关文档

- [[AGENTS]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/quality-baseline]]
- [[docs/decision-log]]
- [[docs/issue-management-workflow]]
