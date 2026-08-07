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

## Archive 与内部 TestFlight 导出

只有 staging backend 完整闭环通过后才能执行本节。`STAGING_API_URL` 必须来自上述新项目，禁止填写现有生产 URL；`BUILD_NUMBER` 必须先通过 App Store Connect 查询，取该 App 已有最大 build number 加一。

```sh
mkdir -p .release

xcodebuild archive \
  -project Omo/Omo.xcodeproj \
  -scheme Omo \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath .release/Omo.xcarchive \
  -allowProvisioningUpdates \
  OMO_API_BASE_URL="$STAGING_API_URL" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

xcodebuild -exportArchive \
  -archivePath .release/Omo.xcarchive \
  -exportPath .release/export \
  -exportOptionsPlist config/ExportOptions-TestFlight.plist \
  -allowProvisioningUpdates
```

导出配置使用 `destination=export`，因此不会在导出时意外上传；上传必须是后续显式动作。`testFlightInternalTestingOnly=true` 会把该构建限制为内部 TestFlight，不用于外部测试或 App Store 正式发布。`manageAppVersionAndBuildNumber=false` 保证 Xcode 不静默改写已审计的 build number。

导出后必须再次检查：

- Bundle ID 为 `com.maxhan.shibei`，版本号与远端 build number 不冲突。
- App 包含 `PrivacyInfo.xcprivacy`，`ITSAppUsesNonExemptEncryption=false`。
- 二进制不包含 localhost、Debug Fixture 启动参数、旧生产域名或 Mock 成功路径。
- `OmoAPIBaseURL` 是已验证的 staging HTTPS URL，且 `/api/readiness` 为 200。
- 只有上述门禁全部通过，才使用已认证的 `asc` 显式上传 IPA，并关联内部测试组。

## TestFlight“测试内容”草案

> 请只使用你自己的非敏感截图。首次上传会询问是否允许 AI 处理截图。
>
> 本轮请重点测试：从相册上传截图并生成知识卡；点击首页 Omo 开始最多十张回顾；刮开关键词后完成三档自评；从知识库浏览、搜索、查看上下文和删除卡片；允许通知后，从具体问题通知进入对应回顾卡。
>
> 如遇生成、搜索或自评失败，请保留截图与大致发生时间，并联系测试支持邮箱。测试数据仅写入隔离 staging，不与生产数据互通。

## 当前最小外部输入

继续到真实 TestFlight 前只缺以下用户侧输入／权限：

1. 两个专用于 staging 的供应商密钥：`QWEN_API`、`TIKHUB_API_KEY`。不得复用或读取生产密钥。
2. App Store Connect API key（建议 App Manager 权限）或一次有效的 Xcode/App Store Connect 登录，用于查询 App 记录和安全 build number、签名、上传及关联内部测试组。
3. 确认可公开使用的支持邮箱，以及隐私政策和支持页面的公开 HTTPS 地址；当前仓库只有静态页面，尚未托管。

上述信息不得提交到 Git；密钥只进入 Railway staging 或本机安全凭据存储。

## 当前状态（2026-08-08）

- 新项目、`staging` 环境、`omo-api-staging` 和独立 Postgres 已创建。
- Migration `001` / `002` 已应用并验证 ready。
- 临时 Postgres TCP proxy 已删除，当前 proxy 列表为空。
- 非秘密变量已配置；`QWEN_API` 和 `TIKHUB_API_KEY` 尚缺失。
- 因真实供应商密钥缺失，后端尚未部署，也未生成公网 domain。
- 本机有 `com.maxhan.shibei` 的 App Store provisioning profile，但 Keychain 仅有 Apple Development 身份、没有 Apple Distribution 身份。
- `asc 3.5.1` 已安装，但当前没有 App Store Connect 凭据；尚未访问或修改远端 App 记录。
