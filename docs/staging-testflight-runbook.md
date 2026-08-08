# Omo TestFlight Staging 运行手册

## 安全边界

- 仅使用 Railway 项目 `Omo TestFlight Staging` 的 `staging` 环境。
- 禁止 link、读取、改变量、迁移或部署现有项目“拾贝”。
- 禁止向 `main` push；本轮 TestFlight 迭代只来自 `codex/omo-independent-app`。
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

导出配置使用 `destination=export`，因此不会在导出时意外上传；上传必须是后续显式动作。`testFlightInternalTestingOnly=false` 保证构建可送交 Beta App Review 并加入外部测试组；它不会因此自动发布到 App Store。`manageAppVersionAndBuildNumber=false` 保证 Xcode 不静默改写已审计的 build number。

导出后必须再次检查：

- Bundle ID 为独立 Omo 身份 `com.maxhan.omo`，不得使用旧 Recaro/Recallo 的 `com.maxhan.shibei`；版本号与新 Omo App 的远端 build number 不冲突。
- App 包含 `PrivacyInfo.xcprivacy`，`ITSAppUsesNonExemptEncryption=false`。
- 二进制不包含 localhost、Debug Fixture 启动参数、旧生产域名或 Mock 成功路径。
- `OmoAPIBaseURL` 是已验证的 staging HTTPS URL，且 `/api/readiness` 为 200。
- 只有上述门禁全部通过，才使用已认证的 `asc` 显式上传 IPA，并关联内部测试组。

## TestFlight“测试内容”草案

> 请只使用你自己的非敏感截图。首次上传会询问是否允许 AI 处理截图。
>
> 本轮请重点测试：从相册上传截图并生成知识卡；点击首页 Omo 开始最多十张回顾；刮开关键词后完成三档自评；从知识库浏览、搜索和查看完整上下文；允许通知后，从具体问题通知进入对应回顾卡。
>
> 如遇生成、搜索或自评失败，请保留截图与大致发生时间，并联系测试支持邮箱。测试数据仅写入隔离 staging，不与生产数据互通。

## 当前剩余人工确认

1. Omo 已使用商店名称 `Omo（哦莫）` 创建为独立 App；安装后的 `CFBundleDisplayName` 仍为 `Omo`。
2. 新 Omo 内部测试组没有继承旧 App 测试员；产品方需确认首批测试员范围后再邀请。
3. 首位测试员在自己的真机上复核相册、麦克风、语音识别、通知权限和 VoiceOver；未经明确授权，不由自动化代操作用户设备。
4. 正式公开发布前再次确认公开支持邮箱。

API 私钥不得提交到 Git；只保存在本机安全凭据存储。

## 当前状态（2026-08-08）

- 新项目、`staging` 环境、`omo-api-staging` 和独立 Postgres 已创建。
- Migration `001` / `002` / `003` 已应用并验证 ready；`003` 建立可恢复的截图任务表。
- 临时 Postgres TCP proxy 已删除，当前 proxy 列表为空。
- staging 变量已配置；供应商密钥只存在 Railway staging，未写入仓库或日志。
- backend 核心交互修复部署 `f8c51bc7-0d69-42d6-b8b6-15909c604822` 为 `SUCCESS`，公网域名为 `https://omo-api-staging-staging.up.railway.app`；pre-deploy 会先执行 migration，再进行 readiness 检查。
- health/readiness、空库、真实生成、读取、搜索、assessment 幂等、重启回读和删除均已通过；合成测试数据已删除。
- Release 默认连接上述 staging HTTPS 域名；当前独立 Bundle `com.maxhan.omo` 的 Simulator XCTest（含 UI Tests）49/49 通过。
- `asc 3.5.1` 已使用系统 Keychain profile 完成认证并通过在线验证；私钥和凭据未进入仓库。
- 新 Apple Distribution 证书和 App Store provisioning profile 均有效至 2027-08-08。
- 工程最低系统已正式设为 iOS 17.0；签名 Archive 与导出 IPA 均通过。
- 旧 App 下错误上传的 `1.0 (28)` 已从旧测试组移除并永久设为 `EXPIRED`；它不能作为 Omo 发布构建。
- 错误 Draft PR #38 已关闭。旧 App build 1–27、测试员和生产数据均未修改。
- 全新 Bundle ID `com.maxhan.omo` 已注册且此前没有绑定 App；主工程已切换到该身份并将新 App 构建号重置为 1。
- `com.maxhan.omo` 的独立 App Store profile、签名 `1.0 (1)` Archive 和 IPA 已生成并通过包审计；同一 IPA 已上传至新的 Omo App。
- 当前独立 Bundle `com.maxhan.omo` 已实际执行全部 Simulator XCTest：49 通过、0 失败、0 跳过；其中包含 5 条核心交互 UI Test。
- 新 Omo App Store Connect App ID 为 `6799407458`；独立 build 1（Build ID `7bb306b6-dc29-43ca-9547-782ae6fa2009`）状态为 `VALID`。
- 核心交互修复使用独立 build 2（Build ID `a387a603-dc77-4dda-b0a3-862e1d490936`）：Archive、App Store 导出、包内 Bundle / 版本 / staging 地址、正式签名均已校验，App Store Connect 状态为 `VALID` / `IN_BETA_TESTING`。
- 独立内部组 ID 为 `109f9f4f-75b9-4419-be1f-46edd4bc016a`；build 2 已加入该组并开启自动通知，组内当前一名 Omo 测试员状态为 `INSTALLED`。不得复用旧 App 记录、旧测试组或旧测试员。
- 隐私政策与支持页已分别托管在 `/privacy` 和 `/support`；兼容地址 `/privacy-policy.html` 亦可用。
