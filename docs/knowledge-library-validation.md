# 知识库页面验证记录

日期：2026-08-03  
分支：`codex/knowledge-library-search`  
设备：Omo Verify iPhone 17 Pro，iOS 26.5 Simulator，402 × 874 pt 参考画布

## 已验证路径

| 场景 | 操作／数据 | 结果 | 证据 |
|---|---|---|---|
| 全部卡片 | `-OmoLibraryFixture many` | 完整知识卡两列显示，卡片不刮开，长文不截断，页点为 3 页 | `docs/assets/knowledge-library/all-cards.png` |
| 文字搜索结果 | 查询“认知卸载” | 显示相关完整卡片；首帧占位后由实测高度完成分页，不停留在排版转圈 | `docs/assets/knowledge-library/search-results.png` |
| 语音搜索 | Debug 转写“如何避免认知卸载”，点击麦克风 | 转写进入输入框并自动提交一次搜索 | `docs/assets/knowledge-library/voice-search.png` |
| 无结果 | 显式空结果 Adapter | 与服务失败区分，可一键回到全部卡片 | `docs/assets/knowledge-library/no-results.png` |
| 搜索失败 | 显式失败 Adapter | 保留查询，显示重试动作 | `docs/assets/knowledge-library/search-failure.png` |
| 空知识库 | `-OmoLibraryFixture empty` | 显示上传第一张截图动作 | `docs/assets/knowledge-library/empty-library.png` |
| 完整上下文 | 点击第一张知识卡 | 打开已有完整知识详情，显示稀有度、掌握状态、正文、解释与来源 | `docs/assets/knowledge-library/card-detail.png` |
| 上传入口 | 点击右下角加号 | 打开已有截图选择流程；未选择或上传任何私人照片 | `docs/assets/knowledge-library/upload-sheet.png` |
| 键盘焦点 | 点击文字搜索框 | 系统键盘出现，Search submit label 可见 | `docs/assets/knowledge-library/text-input-keyboard.png` |
| 小屏布局 | Omo Verify iPhone SE 3，iOS 26.5 | 同一画布等比缩放，无机型分支；搜索、完整卡片、页点和上传均在安全区内 | `docs/assets/knowledge-library/small-device.png` |
| Accessibility 字号 | iPhone SE 3，`accessibility-extra-large` | 正文随系统放大；超高卡片在页内纵向滚动，页点和上传入口不被测量层推出画布 | `docs/assets/knowledge-library/dynamic-type.png` |

## 代码与合同检查

- Debug mock、失败、空结果和合成卡片均由启动参数显式启用；Release 使用不可用搜索 Adapter。
- 文字和语音共用 `KnowledgeLibrarySearching`，后返回的旧请求不能覆盖新查询；未知和重复结果 ID 被过滤。
- 分页算法为纯 Swift 模型，卡片真实高度来自 SwiftUI Preference 测量；统一首帧占位不根据字数推断高度。
- 语音使用 Apple Speech／AVAudioSession；原始音频不落盘，最终转写才进入搜索。
- serve-sim 的 Reduce Motion 系统开关可正常启用，知识库结果、操作和布局不依赖动画。
- `xcodebuild build` 与 `build-for-testing` 已通过。iOS 26.5 XCTest runner 在本机持续停在 `waiting for workers to materialize`，因此单元测试只证明已编译，未声明实际执行通过。

## 未验证

- 生产向量检索尚未接入，未验证 embedding、索引一致性、线上延迟或搜索质量。
- 真机麦克风、真实语音识别质量和 App Store 权限文案仍需真机验证。
- serve-sim 能点击麦克风、卡片和上传入口；其鼠标拖动没有产生 iOS TabView 横向手势，分页算法和页点已在代码／编译层覆盖，但本轮不把该工具限制写成真实滑动通过。
- iOS 26.5 Simulator 首次开启 VoiceOver 会停在系统“旁白手势”教学弹窗；代码层已审查卡片、页点、搜索、返回和上传的 label／hint／阅读顺序，但本轮不声明完整 VoiceOver 手势走查通过。

## 相关文档

- [[docs/knowledge-library-prd]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
