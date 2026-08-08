# Task 7 旧 App 错误发布处置记录

- 日期：2026-08-08
- 错误构建：旧 App Store Connect App ID `6772533617` 下的 `1.0 (28)`
- 错误 Build ID：`029508e7-5041-47e0-a6ba-1bd4bb3e6ea5`
- 根因：错误把全新产品 Omo 当成旧 Recaro/Recallo 的更新，复用了旧 Bundle ID `com.maxhan.shibei`、旧 App 记录和旧内部测试组。

## 已完成止损

1. Build 28 已从旧内部测试组解除。
2. Build 28 已永久设为 `EXPIRED`；`internalBuildState` 与 `externalBuildState` 均为 `EXPIRED`。
3. 错误 Draft PR #38 已关闭并注明原因，不能合并。
4. 旧 App 的 build 1–27、历史用户、测试员、生产数据和生产环境均未修改。
5. 新产品 Bundle ID `com.maxhan.omo` 已注册，资源 ID 为 `B696RZHHNR`；注册前确认团队中不存在该 Bundle ID，也不存在对应 App Store Connect App。

## 新 Omo 发布边界

- 主 App target 必须使用 `com.maxhan.omo`；Tests 使用 `com.maxhan.omo.Tests`。
- Omo 必须创建独立 App Store Connect App ID、独立 build number 序列和独立 TestFlight 测试组。
- 新测试组不得自动继承旧 App 测试员；添加测试员前需用户确认范围。
- 安装后的显示名保持 `Omo`。精确商店名称 `Omo` 已被占用，新 App 记录名称必须由用户确认，不能再次借用旧 App。
- Railway `Omo TestFlight Staging` 本身为全新隔离项目，可继续作为 Omo 内测后端；禁止触碰生产项目“拾贝”。

## 不再成立的结论

此前关于 build 28 “可供内部测试员安装”的结论已经撤销。该 IPA 的包审计只能作为代码、签名和 staging 配置的历史技术证据，不能作为 Omo 独立 TestFlight 发布证据。

新的发布审计必须以 `com.maxhan.omo`、新 App ID 和新 Build ID 为准。

## 独立 Omo 本地发布准备

- 工程主 target 已切换为 `com.maxhan.omo`，版本为 `1.0 (1)`，最低系统为 iOS 17.0。
- 独立 provisioning profile 已创建；ASC profile ID 为 `RJCF68G8U5`，绑定 `44589Y6FA6.com.maxhan.omo`，`get-task-allow=false`。
- 签名 Archive `.release/Omo-Independent-1.0-1.xcarchive` 已成功，Store validation 通过。
- 本地 IPA `.release/export-independent-1.0-1/Omo.ipa` 已成功导出，但没有上传到任何 App。
- IPA SHA-256 为 `6f010cfb9ee1c5f27fad60eb89050307256b44882d9f2b614aa83f0d85ea7b10`；Bundle ID、版本、iOS 17.0、staging URL、PrivacyInfo、签名 entitlement 与 forbidden-string 审计通过。
- Backend 51 项中 50 pass、1 项默认 PostgreSQL skip；独立身份门禁通过。
- 本轮 Simulator `build-for-testing` 成功，但 CoreSimulator 在测试安装前反复退出／阻塞，XCTest 没有实际执行；不能用上一轮旧 Bundle 下的 37/37 冒充新身份测试证据。
