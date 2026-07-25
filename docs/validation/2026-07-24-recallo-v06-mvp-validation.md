# Recallo v0.6 MVP 验收记录

> 日期：2026-07-24
>
> 正式后端/Web 环境：`bridge-amax:/data1/yuxiao/recallo-validation-20260724-v06`
>
> Node.js：`v22.23.1`

## 1. 结论

- **代码纵切片：Go。** 新合同、证据门、调度、三栏 UI、召回动效和反馈闭环已接通。
- **真实视觉模型质量结论：No-go。** 仓库和服务器没有找到此前所称的 30 张真实、授权、脱敏截图，因此本轮没有把合同 Fixture 冒充真实图片或外部模型质量测试。
- **iOS 完整编译/模拟器结论：Blocked by environment。** 当前 macOS 只配置 Command Line Tools，XcodeBuildMCP 返回 `xcrun: error: unable to find utility "xcodebuild", not a developer tool or in PATH`。已完成 Swift frontend parse 和生产守卫，但不能据此宣称 Xcode 编译或模拟器通过。

## 2. bridge-amax 回归

### 后端

- `npm --prefix backend run check`
- 结果：154 / 154 通过，0 失败。
- 覆盖：生成最多一次修复、Evidence ID、精确连续遮挡、判断题布尔答案、选择题唯一答案、数字/日期/名称、风险表达、稀有度降级、调度、设备隔离、反馈幂等、新旧合同兼容、Bilibili/抖音 Adapter。

### 30 例平台合同 Fixture

运行：

```bash
npm --prefix backend run benchmark:capture-memory-fixtures
```

Fixture 类型明确标记为 `deterministic_contract_fixture_not_real_screenshot`。

| 指标 | 结果 |
| --- | ---: |
| 样本 | 30 |
| Bilibili / 抖音 | 15 / 15 |
| 合同生成率 | 100% |
| Evidence ID 一致率 | 100% |
| 三题型可用率 | 100% |
| 稀有度分布 | R 18 / SR 9 / SSR 3 |
| 合同执行延迟 P50 / P95 / Max | 0.34 / 2.55 / 9.81 ms |
| 失败 | 0 |

上述延迟只衡量确定性 Fixture 与服务端合同执行，不包含视觉模型、TikHub、字幕、下载或网络时间。

### Web

- 服务端 `GET /app-demo`：HTTP 200。
- 原创毛球资产：HTTP 200，174858 bytes。
- Phosphor `sun.svg`：HTTP 200，687 bytes。
- 内联 JavaScript 语法检查通过。
- 本地 375px Playwright 验收：无横向溢出、无页面错误；三栏导航、28pt 上拖、跳过过场、语义揭示、反馈、知识库真实日期、判断/选择变式和 Reduce Motion 均可完成。

## 3. iOS 静态验收

- `npm run check:ios`：通过全部生产守卫。
- 9 个相关 Swift 文件执行 `swiftc -frontend -parse`：通过。
- Pow 精确锁定 `1.0.6`，只在 Reduce Motion 关闭时用于短促 shine、jump 和 spray。
- 仍需在安装完整 Xcode 后运行 XCTest、模拟器、VoiceOver、动态字体和中途退出恢复验收。

## 4. 补测入口

拿到 30 张真实脱敏截图后，必须另建报告并记录：

- 视觉识别、标题/账号恢复和来源命中率；
- Qwen 实际生成率、证据一致率、问题可用率和稀有度分布；
- 模型调用 P50/P95、Token 与人民币成本；
- 下载/字幕/转写分支和大视频阈值失败原因；
- 每张截图的授权与脱敏状态。

在这份真实报告完成前，不能将本文件的 30 例 Fixture 指标用于模型质量或投资人材料。
