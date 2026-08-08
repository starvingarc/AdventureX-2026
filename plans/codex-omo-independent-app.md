# Omo 独立 App 身份修复计划

- 状态：`in_progress`
- 优先级：P0
- 创建：2026-08-08
- 更新：2026-08-08
- 负责人：Codex `/root`
- 整合者：Codex `/root`
- 分支：`codex/omo-independent-app`
- Worktree：`/Users/hanmingyu/Documents/Recallo2.0/Omo-next`
- 依赖：用户明确要求 Omo 必须是全新产品，不能覆盖旧 Recaro/Recallo
- 推进模式：`manual`（涉及 App Store Connect、签名和 TestFlight 外部状态；用户已明确授权纠正为全新产品）
- 可写路径：`Omo/`、`backend/test/`、`docs/`、`artifacts/`、`plans/`、`PLANS.md`、签名与 TestFlight staging 配置
- 禁止路径：旧 Recaro/Recallo 的历史构建、测试员、生产 Railway 项目“拾贝”、生产数据库、`main`
- 高冲突文件唯一写者：Codex `/root`（`Omo/Omo.xcodeproj/project.pbxproj`、`PLANS.md`）

## Goal

撤销错误发布到旧 Recaro/Recallo App 的 Omo build，并以独立 Bundle ID、独立 App Store Connect App、独立构建序列和独立 TestFlight 测试组重新发布 Omo，同时保留已经完成的 Omo 代码与隔离 staging 后端。

## Architecture

主 App target 从旧身份 `com.maxhan.shibei` 切换为新注册的 `com.maxhan.omo`，Test target 继续使用 `com.maxhan.omo.Tests`。新 App Store Connect App 不复用旧 App ID、build number 或测试组；签名 profile 绑定新 Bundle ID。Railway `Omo TestFlight Staging` 已是独立资源，可以继续使用，但所有发布文档必须明确旧 build 28 已失效。

## Global Constraints

- 旧 App 的 build 1–27、用户、测试员和生产数据不得修改；App 记录只允许精确恢复本次误改的 Recallo 元数据。
- 错误 build 28 只允许移组和过期，不得恢复。
- 新 Omo build 从独立 App 的 build 1 开始，除非新 App Store Connect 记录返回冲突。
- 新测试组不得自动继承旧 App 的测试员；邀请对象由用户后续确认。
- 精确商店名称若被占用，必须由用户选择名称，不得再次擅自复用旧 App 或自行决定正式品牌名。
- 所有代码仍只提交到 `codex/omo-independent-app`，不直接修改 `main`。

## 任务

### Task 1：停止错误的旧 App 分发

- [x] 对 build ID `029508e7-5041-47e0-a6ba-1bd4bb3e6ea5` 执行移组并永久过期；旧内部组为 `hasAccessToAllBuilds=true`，关系 API 仍会列出过期构建，但其 internal/external state 均为 `EXPIRED`，测试员不可安装。
- [x] 只将错误 build 28 设为 `EXPIRED`，复核 internal/external state 均为 `EXPIRED`。
- [x] 关闭错误 Draft PR #38，注明根因与后续独立 App 修复方向。
- [x] 注册全新 Bundle ID `com.maxhan.omo`，确认此前不存在 App Store Connect App 绑定。
- [x] 将旧 Recallo 的 App Privacy URL、Support URL 和 TestFlight 中文测试说明恢复为项目中保存的原始 Recallo 内容；复核名称 `Recallo`、副标题 `不记笔记` 和商店描述未被替换。
- [x] 删除本次误建在旧 Bundle ID 下的两个 App Store profile `XKVZHAZMZ5` 与 `4NPHQ877RA`，保留全部既有旧签名资源。
- [x] 复核旧 build 27 为 `VALID / IN_BETA_TESTING`、自动通知开启、原内部测试组仍有 10 位测试员；外部组及公开链接未删除。

### Task 2：把工程身份切换为 Omo

- [x] 新增失败门禁测试，要求主 target Bundle ID 为 `com.maxhan.omo`、Test target 为 `com.maxhan.omo.Tests`，并禁止 `com.maxhan.shibei` 出现在当前发布配置。
- [x] 将 Debug/Release 主 target Bundle ID 切换为 `com.maxhan.omo`，build number 重置为新 App 的 `1`。
- [x] 更新发布运行手册和审计证据，明确旧 build 28 已过期，不能再描述为可测试构建。
- [ ] 运行后端配置测试、iOS XCTest、Release build 与 forbidden-string 审计；Backend 50 pass / 1 skip、Simulator build-for-testing、签名 Archive/IPA 和 forbidden strings 已通过，但 CoreSimulator 在安装测试前阻塞，XCTest 尚未实际执行。
- [x] 提交工程身份修复（`3c9829a`）。

### Task 3：创建独立 App Store Connect App 与签名

- [ ] 使用可修改的独立商店名称 `Omo · 知识回顾`；SKU 使用 `omo-ios-001`，主语言为简体中文。安装后的显示名仍为 `Omo`。
- [ ] 通过可见 App Store Connect UI 创建新 iOS App，选择 Bundle ID `com.maxhan.omo`；创建前再次确认没有现存绑定。
- [ ] 通过 API 复核新 App ID、Bundle ID 和版本序列均与旧 App 完全独立。
- [x] 为 `com.maxhan.omo` 创建新的 App Store provisioning profile；只复用团队级有效 Distribution 证书，不复用旧 Bundle profile。ASC profile ID 为 `RJCF68G8U5`。
- [x] 生成并审计本地 `1.0 (1)` Archive 与 IPA，确认签名 Bundle ID、staging URL、PrivacyInfo、加密声明和 Fixture 隔离；IPA 尚未上传。

### Task 4：独立 TestFlight 分发与交付

- [ ] 上传 IPA 到新 Omo App，等待 processing 为 `VALID`。
- [ ] 创建 Omo 专用内部测试组，不添加旧 App 测试员；配置 Omo 测试说明。
- [ ] 在用户确认测试员范围后再添加测试员或开放构建访问。
- [ ] 复核旧 build 28 仍为 `EXPIRED`，新 Omo build 属于新 App ID 且测试入口独立。
- [ ] 更新稳定文档、完成并退役计划；推送修复分支并创建新的 Draft PR。

## 验收标准

- 旧 Recaro/Recallo App 不再向用户提供 Omo build 28。
- Omo 主 App 的 Bundle ID 为 `com.maxhan.omo`，不再是 `com.maxhan.shibei`。
- Omo 拥有独立 App Store Connect App ID、build 1 和 TestFlight 测试组。
- 新 IPA 只连接隔离 Railway staging，Release 无 Fixture、Mock 或旧生产 URL。
- 未经用户确认，不把任何旧测试员加入新 Omo 测试组。
- `main`、旧 App 历史构建和生产环境均未改变。

## 验证

- `npm --prefix backend run check && npm --prefix backend run test:all && npm --prefix backend run docs:check`
- `xcodebuild` 实际执行全部 XCTest，并生成 `generic/platform=iOS` Release archive。
- 最终 IPA 解包复核 Bundle ID、版本、签名 profile、Team ID、最低系统、API URL、PrivacyInfo 与 forbidden strings。
- `asc apps list --bundle-id com.maxhan.omo` 只返回新 App；新 build 为 `VALID`，旧 build 28 为 `EXPIRED`。
- 新 TestFlight group 为 Omo 专用，初始测试员为空，除非用户明确授权添加。

## 原则检验

- 产品身份：新产品必须有独立 Bundle/App/build/group，不把视觉改版误当成旧 App 更新。
- 用户安全：旧测试员不会被自动迁移或突然收到新产品。
- 数据隔离：继续只使用 Omo staging，不接触生产。
- 凭据：API key、证书私钥、profile 文件和 IPA 不进入 Git。

## 决定记录

- 2026-08-08：发现错误复用旧 App ID `6772533617` 与 Bundle ID `com.maxhan.shibei`；用户明确指出 Omo 是全新产品。
- 2026-08-08：紧急从旧组移除 build 28 并设为 `EXPIRED`，关闭 Draft PR #38；旧历史构建未改动。
- 2026-08-08：确认 `com.maxhan.omo` 此前未注册、未绑定 App，随后注册新 Bundle ID，资源 ID 为 `B696RZHHNR`。
- 2026-08-08：工程主 target 切换到 `com.maxhan.omo`、build 1；独立身份门禁先失败后通过。创建独立 profile，并成功 Archive/export 本地 IPA；未创建新 App、未上传。
- 2026-08-08：Simulator build-for-testing 成功，但 iOS 18.5 设备在安装前自行 Shutdown，已启动 iOS 26.5 设备的 testmanagerd 仍停在安装前。连续三次环境恢复后停止扩大操作，明确记录新 Bundle 下 XCTest 未实际执行。
- 2026-08-08：恢复旧 Recallo 的 production 隐私/支持 URL 与 Recallo TestFlight 说明；确认 build 27 仍在内测，删除两份仅由误发布产生的旧 Bundle profile。
- 2026-08-08：尝试创建独立 App `Omo · 知识回顾`，Apple 要求网页 Apple Account 会话；API Key 与 Issuer ID 本身不能创建 App 记录。

## 阻塞与恢复

- 当前阻塞：创建新 App Store Connect App 必须有已登录的 Apple Account 网页会话；当前 in-app browser 被重定向到登录页。
- 解除条件：用户在保留的 App Store Connect 登录页完成登录并回复“登录好了”。密码和双重认证码由用户本人输入，Codex 不读取或保存。
- 登录后立即执行：创建 `Omo · 知识回顾` → API 复核独立 App ID → 上传独立 `1.0 (1)` IPA → 创建无旧测试员的 Omo 内部组 → 完成双产品隔离审计。

## 相关文档

- [[AGENTS]]
- [[docs/staging-testflight-runbook]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/quality-baseline]]
