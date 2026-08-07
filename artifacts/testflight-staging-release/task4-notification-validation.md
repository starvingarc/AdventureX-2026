# Task 4 本机问题通知验收

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- 设备：Omo TestFlight iPhone 17 Pro，iOS 26.5 Simulator
- 数据：Debug 显式启动参数注入的合成卡片，不含真实用户内容
- 远端状态：未连接 Railway，未部署，未读取生产数据

## 已验证

1. 通知计划的可见文案仅包含提问，payload 仅包含 `cardID`，不包含答案、解释或截图。
2. 生成卡片、完成自评和删除卡片时，本机通知会分别新建、更新和取消。
3. 模拟通知点击后，App 回到“今日”并在当前首页层级叠加对应卡片；不打开独立做题页。
4. 底层首页、收藏夹和上传入口保留。
5. 卡片未加载时暂存 ID，加载后再解析；无效 ID 安全丢弃。
6. 实际拖擦遮罩时，局部刮开仅显示对应区域；连续拖擦达到 80% 阈值后完整显示语义并出现自评条。
7. 实际拖动自评条到“记住了”可提交；本地未启动 backend 时保持当前卡片并显示“保存失败，点此重试”，没有误切下一张。
8. XCTest：35 passed / 0 failed / 0 skipped。
9. Release Simulator build 通过；无 APNs entitlement，无 Debug Fixture/通知注入参数、本地地址或旧生产域名字符串。

## 截图

- `notification-overlay-late.png`：通知对应的未揭示卡片叠加在首页，底层入口仍可见。
- `notification-revealed-rating.png`：达到揭示阈值后完整显示承重语义和三档自评条。
- `notification-rating-retry.png`：自评提交遇到本地网络失败时保留当前卡并提供重试。

## 后续验收

- 任务 6 在隔离 staging 就绪后复验自评成功进入下一张，并检查系统通知权限弹窗与真机通知点击。
