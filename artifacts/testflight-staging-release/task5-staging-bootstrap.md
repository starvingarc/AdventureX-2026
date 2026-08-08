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
9. 用户在 Railway staging 中补充 `QWEN_API` / `TIKHUB_API_KEY`；检查仅确认键存在，没有读取或输出值。
10. Railpack 空服务的后续部署复用了不含 Node/npm 的初始化镜像；改为根目录显式 Node 20 Dockerfile，并以回归测试锁定 builder、启动命令和 `0.0.0.0` 监听。
11. 部署 `c35b57f1-90da-4d80-b78a-0eb9145f56d0` 成功，平台 `/api/readiness` 健康检查通过。
12. 公网域名为 `https://omo-api-staging-staging.up.railway.app`；health 与 readiness 均为 200，Qwen、TikHub、PostgreSQL ready，migration applied 为 `001/002`，pending 为空。
13. 使用合成截图和全新匿名设备 ID 验证：空库、真实生成、读取、语义搜索、assessment 幂等、容器重启后回读与删除。来源因无可验证原文按设计为 `screenshot_only`；最终测试库恢复为空。
14. Release 构建固定连接上述 staging HTTPS 域名；Simulator Release 包内配置、隐私清单、加密声明与 forbidden-string 扫描通过，完整 XCTest 37/37 通过。

## 安全结论

- 未 link、读取或修改现有项目“拾贝”。
- 未读取或导入生产数据。
- 未部署或修改生产；只部署了新项目的 `staging` backend。
- 未输出、记录或提交数据库凭据。
- 所有代码更改仅位于 `codex/testflight-staging-release`。
