# Omo Figma 主动召回验证（2026-07-29）

## 环境

- 分支：`codex/figma-active-recall-home`
- 基线：`Omo/main@177ec96`
- 工程：`Omo/Omo.xcodeproj`
- Scheme：`Omo`
- 常见尺寸：iPhone 17，iOS 26.5，402 × 874pt
- 后端：本地 `backend`，未配置 Qwen；使用服务端真实 fallback 卡片和真实 assessment API，仅用于 UI 交互验证。

## 截图

- `empty-home-iphone17.png`：无卡片首次首页。
- `idle-home-iphone17.png`：有卡片待抽取首页，箭头指向 IP。
- `covered-stack-iphone17.jpg`：六张到期卡中的可见四层卡堆，答案封住。
- `revealed-rating-iphone17.jpg`：答案完整揭示后的粗细/颜色权重与三节点自评。
- `next-card-resealed-iphone17.jpg`：在“记得”节点松开并成功提交后，下一张自动出现且重新封住。
- `empty-home-iphone-se.jpg`：较小高度/宽度边界检查，无横向溢出且上传入口保持可触达。

## 真实交互结论

- 点击运行时无障碍元素“哦莫 记忆伙伴”后进入本轮卡堆。
- 揭示前运行时无障碍快照只有菜单和“查看完整知识”等操作，没有答案文本。
- 通过显式 Debug 参数 `-OmoRecallRevealed` 进入揭示状态，仅用于截图与自评交互，不改变 Release 行为。
- 自评 Slider 初值为 `0`，不是 NaN。
- 向右拖到“记得”并松开：调用本地真实 assessment API，成功后顶卡离场并自动进入重新封住的下一张。
- 向左拖回取消区并松开：Slider 和当前卡仍保留，没有提交或换卡。

## 自动验证

- `xcodebuild ... build`：通过。
- `OmoTests/RecallInteractionStateTests`：5 项通过、0 失败、0 跳过。
- 测试覆盖 80% 阈值、三节点与取消映射、失败重试、确认换卡重新封住、最后一张结束本轮。

## 未验证与边界

- 既有 iPhone 13 mini Simulator 在安装阶段阻塞；随后改用干净的 iPhone SE Simulator 完成一次等价的小尺寸门禁，没有扩大成机型适配开发。
- 本次没有真实 Qwen、生产后端、Share Extension 或真机验证，因为代码未改变这些边界。

## 相关文档

- [[docs/frontend/v2-active-recall-home]]
- [[docs/frontend/v2-first-launch-empty-home]]
- [[docs/quality-baseline]]
