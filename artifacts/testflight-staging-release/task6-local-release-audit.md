# Task 6 本地发布与隐私流程验证

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- Simulator：`Omo TestFlight iPhone 17 Pro`（iOS 26.5）
- 外部环境：未部署 backend，未触碰生产环境

## 自动化结果

- iOS XCTest：37/37 通过，确认测试方法真实执行。
- Backend：46 项，45 通过，1 项 PostgreSQL 集成测试在默认无数据库环境下跳过。
- Backend syntax check：通过。
- 文档检查：25 个 Markdown、185 个 wiki link，全部通过。
- 未签名 Release device build：通过，并执行 App Store shallow validation。
- Release 包检查：包含更新后的 `PrivacyInfo.xcprivacy`；不包含 localhost、旧生产域名或 Debug Fixture/通知注入字符串。
- Export compliance：App 仅使用系统 HTTPS，Info.plist 声明不使用非豁免加密。

## Simulator 实际交互

1. 清除 App 测试安装并从空用户首页启动。
2. 点击首页上传入口，进入系统照片选择器并选择一张照片。
3. 确认截图离开设备前显示“允许 AI 处理这张截图？”；取消后不授权、不生成。
4. 再次选图并点“同意并生成”，确认许可持久化；测试 backend 未部署时只显示连接失败，不伪造成功。
5. 打开 Settings，确认存在隐私说明、联系支持和撤回许可入口。
6. 点击撤回后，入口立即变为“下次上传截图时会询问 AI 处理许可”；再次选图会重新提示。
7. 在 `Omo Verify iPhone SE 3` 复核知识库：默认字号保持两列；最大辅助字号下自动切为单列宽卡，长文本不再逐字竖排或被截断。
8. 在 iPhone 17 Pro 使用 Debug 合成数据验证知识库文字搜索、语音权限拒绝提示及跳转 Settings 的恢复入口。
9. 使用运行时 Accessibility 快照核对回顾卡：刮开前既不包含承重语义，也不提供“查看完整知识上下文”；达到 80% 后才同时出现完整语义、自评条与上下文入口。

## 本轮发现并修复

- 初版许可提示只覆盖知识库次级上传页，首页主上传入口仍直接生成。通过真实系统照片选择器复现后，将相同许可门槛补到首页主入口。
- Debug localhost 判断仍残留在 Release 二进制。将整个本地 HTTP 分支收进 `#if DEBUG`，clean Release 重建后字符串门禁通过。
- 隐私文档包含尚未实现的配额、反馈入口和诊断字段。已按当前代码实际行为收敛，并补齐 App 内可访问隐私说明。
- 小屏最大辅助字号下，固定双列卡片会把正文压缩为逐字竖排。分页器新增显式列数，页面仅在辅助字号下切为单列；默认字号的两列 Figma 布局保持不变。
- 回顾卡在刮开前已显示“查看完整知识上下文”，可绕过遮挡直接看到答案。入口现由回顾状态控制，仅在 80% 揭示后出现；知识库中的完整卡片查看保持不变。

## 证据

- `ai-processing-consent.png`：首页真实选图后的首次 AI 处理许可。
- `privacy-settings-revoked.png`：Settings 中撤回后的状态与隐私入口。
- `small-screen-library.png`：小屏默认字号的两列知识库布局。
- `small-screen-library-axxxl.png`：小屏最大辅助字号的单列可读布局。
- `speech-permission-denied.jpg`：语音权限拒绝后的可恢复提示。
- `context-before-reveal.png`：刮开前无完整上下文入口。
- `context-after-reveal.png`：达到揭示阈值后显示上下文入口与自评条。

## 尚未验证

- 真实截图生成、持久化、搜索、assessment、删除和重启 readback：等待隔离 staging 的 Qwen/TikHub 专用密钥后执行。
- 小屏键盘、真实系统语音授权、Reduce Motion、VoiceOver 实机朗读与完整 TestFlight 安装：Task 6/7 后续。
- App Store Connect：已安装 `asc 3.5.1`，本机无 ASC API 凭据；仅有 Apple Development 证书、无 Distribution profile，未访问或修改远端记录。
