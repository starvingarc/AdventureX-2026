# Task 7 TestFlight 发布审计

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- 版本：`1.0 (28)`
- Bundle ID：`com.maxhan.shibei`
- App Store Connect App ID：`6772533617`
- App Store Connect Build ID：`029508e7-5041-47e0-a6ba-1bd4bb3e6ea5`

## 构建与包审计

1. iOS 18.5 iPhone 16 Pro Simulator XCTest 实际执行 `37/37`，零失败。
2. `generic/platform=iOS` 的签名 Release archive 成功，最低系统已正式下调为 iOS 17.0。
3. 导出 IPA 为 `.release/export-1.0-28/Omo.ipa`，SHA-256 为 `7c92f246574d78c8ea26b565fa382542b05a5259d52be4dad91e3041b56fd64d`。
4. IPA 的 Bundle ID 为 `com.maxhan.shibei`，版本为 `1.0 (28)`，最低系统为 iOS 17.0。
5. `OmoAPIBaseURL` 仅为 `https://omo-api-staging-staging.up.railway.app`；未发现 localhost、旧生产域名、Debug Fixture 启动参数或 Mock 成功路径。
6. `PrivacyInfo.xcprivacy` 在 App 包内且 plist 校验通过；`NSPrivacyTracking=false`。
7. Manifest 声明匿名设备 ID、截图/视频、其他用户内容和产品交互，目的均为 App 功能；UserDefaults 使用 `CA92.1`。
8. `ITSAppUsesNonExemptEncryption=false`；当前仅使用系统 HTTPS/TLS，没有自定义或非豁免加密。
9. App Icon 为 1024×1024 PNG、无 Alpha；Assets.car 包含普通、深色和 tinted 三个 AppIcon rendition。
10. Release 包只链接 Apple 系统框架；未发现第三方 SDK、广告、ATT、StoreKit/IAP、APNs entitlement、后台模式或动态代码执行组件。
11. 麦克风和语音识别用途文案已进入实际 App Info.plist，分别说明语音知识搜索和语音转文字用途。
12. IPA 签名验证通过，Authority 为 Apple Distribution，Team ID 为 `44589Y6FA6`；内嵌 profile 的 `get-task-allow=false`，并包含 `beta-reports-active=true`。

## 签名与 App Store Connect 证据

- `asc 3.5.1` 已安装；API key 已保存在系统 Keychain profile `omo-testflight`，`asc auth status --validate` 返回可用。私钥内容和凭据未写入仓库或日志。
- 已签发有效 Apple Distribution 证书；ASC certificate ID 为 `VQLXRC8447`，到期日为 2027-08-08。
- 已签发 App Store profile `Omo TestFlight App Store 2026-08-08`；ASC profile ID 为 `XKVZHAZMZ5`，UUID 为 `c3ca964d-41b1-4dbe-9b34-038d482e4b3f`，到期日为 2027-08-08。
- Xcode 导出时使用有效 App Store profile，签名、entitlements 和 Team ID 均已从最终 IPA 复核。
- 上传前查询远端历史最大 build 为 27，因此安全选择 build 28；Xcode 导出产生的空上传 reservation 已精确定位并删除，再由 `asc` 显式上传审计过的 IPA。
- Build 28 已处理为 `VALID`，过期日为 2026-11-06，`usesNonExemptEncryption=false`。
- Build 28 已关联内部测试组 `尊贵的内测会员们`；该组为 internal、`hasAccessToAllBuilds=true`，当前有 10 位内部测试员。
- `buildBetaDetail.internalBuildState=IN_BETA_TESTING`、`externalBuildState=NOT_APPLICABLE`、`autoNotifyEnabled=true`，证明构建已可供内部测试员安装，不涉及外部测试或 App Store 正式审核。
- 已配置 zh-Hans “测试内容”，覆盖截图生成、首页回顾、刮开与三档自评、知识库搜索/上下文以及问题通知入口。

## 隔离 Staging 与公开页面

- 仅部署 Railway 项目 `Omo TestFlight Staging` 的 `staging` 环境；生产项目“拾贝”和 `main` 均未触碰。
- 最终 backend 部署 ID 为 `b00a4f66-f006-420f-8a7b-91cb1b21e590`，状态为 `SUCCESS`。
- `/api/readiness` 为 ready，Qwen、TikHub 与独立 PostgreSQL 均可用，migration `001` / `002` 已应用且无 pending。
- 隐私政策公开地址为 `https://omo-api-staging-staging.up.railway.app/privacy`。
- 支持页面公开地址为 `https://omo-api-staging-staging.up.railway.app/support`。
- 兼容地址 `/privacy-policy.html` 可用；公开页面均返回 UTF-8 HTML、CSP、`nosniff` 和短期缓存头。
- App Store Connect 的隐私政策、旧版本支持地址和 TestFlight beta app 隐私地址已更新到隔离 staging 页面。

## 剩余非阻塞事项

1. App Store Connect 中精确名称 `Omo` 被其他账号占用，因此 ASC App 记录暂时仍名为 `Recallo`；已安装二进制的显示名是 `Omo`。正式 App Store 发布前需由产品方选择一个唯一商店名称，内部 TestFlight 不受影响。
2. 内部 TestFlight 已处于 `IN_BETA_TESTING`，但本次没有未经授权操作用户真机。首位测试员仍应从 TestFlight 安装 build 28，并在真机复核相册、麦克风、语音识别和通知权限。
3. 当前 TestFlight feedback email 沿用现有配置。正式公开发布前，应再次确认公开支持邮箱；这不阻塞内部测试。
