# Task 7 TestFlight 离线发布审计

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- 本地版本：`1.0 (3)`；远端安全 build number 尚待 ASC 查询
- Bundle ID：`com.maxhan.shibei`

## 已验证

1. Release Simulator 构建成功；实际包中 `OmoAPIBaseURL` 仅为隔离 staging HTTPS 域名。
2. `PrivacyInfo.xcprivacy` 在 App 包内且 plist 校验通过；`NSPrivacyTracking=false`。
3. Manifest 声明匿名设备 ID、截图/视频、其他用户内容和产品交互，目的均为 App 功能；UserDefaults 使用 `CA92.1`。
4. `ITSAppUsesNonExemptEncryption=false`；当前仅使用系统 HTTPS/TLS，没有自定义或非豁免加密。
5. App Icon 为 1024×1024 PNG、无 Alpha；Assets.car 包含普通、深色和 tinted 三个 AppIcon rendition。
6. Release 包只链接 Apple 系统框架；未发现第三方 SDK、广告、ATT、StoreKit/IAP、APNs entitlement、后台模式或动态代码执行组件。
7. 麦克风和语音识别用途文案已进入实际 App Info.plist，分别说明语音知识搜索和语音转文字用途。
8. Bundle 中没有 localhost、旧生产域名、Debug Fixture 启动参数或 Mock 成功路径。
9. 支持页与隐私政策 HTML 已存在，内容与当前匿名设备、第三方 AI、截图不落库、搜索词不落库、本机通知和删除支持流程一致。
10. App 内 Settings 提供隐私说明和支持邮箱入口；完整公开页面仍需托管 URL。

## 签名与 ASC 证据

- `asc 3.5.1` 已安装，但没有 keychain profile、repo-local config 或 `ASC_*` 环境凭据。
- Keychain 只有两条 Apple Development 身份，没有有效 Apple Distribution 私钥身份。
- 本机 Store provisioning profile 名为 `iOS Team Store Provisioning Profile: com.maxhan.shibei`，但其内嵌 Apple Distribution 证书已于 `2026-07-09T03:13:35Z` 过期。
- 因此不能安全 Archive/export/upload；必须先用 ASC/Xcode 账号签发新的 Distribution 证书，并先查询远端最大 build number。

## 最小外部输入

1. 在本机完成 `asc auth login`，API key 角色建议 App Manager。
2. 确认草案邮箱 `mingyuhan0814@gmail.com` 可以公开使用，随后托管 `support.html` 与 `privacy-policy.html`。

完成 ASC 登录后，下一步依次执行：解析 App ID → 查询 next build number → 新签 Distribution / profile → Archive → export IPA → 本地包审计 → 上传并等待 `VALID` → 关联内部测试组。
