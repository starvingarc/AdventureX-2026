# 主动回忆交互修复验证

## 范围

2026-07-29 在本地 Node 后端与 iOS Simulator 验证以下修复：

- 主卡显示完整 `coreKnowledge`，只遮住句内 `hiddenSemantic`。
- 揭示前的运行时无障碍快照没有出现 `hiddenSemantic` 文本。
- 80% 揭示后的承重语义使用更高字重与珊瑚色。
- 自评滑块初始停在最左取消区，无障碍值为有限数值 `0`，不是 NaN。
- 向右拖到记住了后，服务端收到 `remembered`，卡片只前进一次，下一张重新封住。
- 向左完整拖回取消区后，滑块保持值 `0`、当前卡不切换，服务端 `reviewCount` 不增加。
- 卡片右上入口展开完整上下文，关闭后不改变当前揭示状态。

## 环境

- Xcode Scheme：`Omo`，Debug。
- 常见尺寸：`Recallo Audit iPhone 17 Fresh`，iOS 26.5，截图 368 × 800。
- 边界尺寸：`Recallo Audit iPhone SE 3 iOS26`，iOS 26.5，截图 449 × 800。
- 后端：`http://127.0.0.1:5194`，临时 JSON Store。
- 卡片：未配置 Qwen 时生成的明确本地演示卡；不包含真实用户截图。
- `-OmoRecallRevealed` 只把首卡设为已达到 80% 的确定性验证状态，不替代覆盖率状态测试。

## 截图

- `iphone17-idle.jpg`：有可复习卡、尚未抽取。
- `iphone17-covered.jpg`：抽取后，句内承重语义保持封住。
- `iphone17-revealed-cancel.jpg`：完整揭示，滑块仍在最左取消区。
- `iphone17-next-card-covered.jpg`：提交 remembered 后下一张重新封住。
- `iphone-se-revealed-cancel.jpg`：边界尺寸下的揭示与滑条布局。

## 自动验证

- XcodeBuildMCP：9 tests passed，0 failed，0 skipped。
- 后端：11 tests passed，0 failed。
- iOS build：成功。
- 79% / 80% 门槛、句首/句中/句尾分段、重复子串、提交失败重试和最后一张结束由 XCTest 覆盖。

## 边界

- 本次未调用真实 Qwen、TickHub、生产 Store、APNs 或真机触觉反馈。
- Simulator 无法证明真实设备的震动强度；只验证触发路径与状态变化。
- 局部刮痕的视觉连续性由实现审查与 79% 状态测试覆盖，现有自动化工具没有为 Canvas 暴露可稳定定位的刮层元素。

## 相关文档

- [[docs/frontend/v2-active-recall-home]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/quality-baseline]]
