# Recallo v0.6 iOS 前端交互验收

> 日期：2026-07-24
>
> 实施与测试环境：`bridge-amax:/data1/yuxiao/recallo-v062-integration`
>
> 范围：SwiftUI 今日页、毛球状态、召回仪式、语义刮开、检查点与恢复；不改后端、Adapter 或知识图谱。

## DECISIONS

- 今日页只暴露一个“召回一张”意图：卡叠手势与明确按钮是同一入口，不再展示卡池或单双模式选择。
- 为了在反馈后展示真实的下一张卡边缘，首页可以在数据层预取多张；表现层始终一次呈现一张，并在检查点由用户选择“继续下一张 / 先收好”。
- 召回状态统一为 `home / summoning / recall / scratching / revealed / assessing / checkpoint / stowing / paused`。
- 五张现有透明 PNG 通过位移、镜像、缩放、代码卡片/文件夹和 SF Symbols 组合成十种语义状态；未新增图片资产。
- 首张过场为 1450ms，后续为 700ms；Reduce Motion 为 180ms。过场可跳过，状态变化会取消旧任务。
- 语义刮层使用 SwiftUI `Canvas` 与 `destinationOut`，笔刷 26pt，12×7 覆盖网格达到 45% 后完整揭示。
- `AppStorage` 保存卡片、稳定阶段、路径、覆盖网格、揭示状态、反馈/掌握变化和服务端调度；反馈 attempt ID 由“卡 ID + 本轮 nextReviewAt”稳定派生，使同一轮重试幂等、下一轮仍可提交。
- 场景色由阶段自动选择 `creamReady / mistProcessing / coralRecall / lavenderPaused / sageLibrary / navyNight`，不新增主题设置入口。

## RISKS

- `bridge-amax` 是 Linux 服务器，没有 Apple SDK、`swiftc` 或 `xcodebuild`；本轮只能做生产守卫、合同静态检查与源码结构检查，不能声称 Xcode 编译、XCTest、模拟器、VoiceOver 或动态字体已经通过。
- 刮痕路径目前以坐标字符串保存；如果未来卡面尺寸跨设备大幅变化，应迁移为 0–1 归一化坐标。
- 数据层仍复用现有批量拉取接口以提供“下一张”预览，接口命名中的历史 `continuous` 不再进入界面文案或交互心智。

## OPEN QUESTIONS

- 安装完整 Xcode 后，需要在真实 iPhone 尺寸补验后台恢复、VoiceOver 可调动作、动态字体最大档和 Reduce Motion 的 180ms 落点。
- 深色模式下 `navyNight` 是否作为独立夜间场景保留，仍需结合真实设备亮度确认；MVP 不提供手动主题切换。
- 反馈 API 若未来返回服务端 session continuation token，可移除当前数据层预取策略，直接在检查点请求下一张。

## TEST EVIDENCE

全部命令在 `bridge-amax:/data1/yuxiao/recallo-v062-integration` 执行。

### 生产守卫

```bash
export PATH=/data1/yuxiao/recallo/.envs/runtime/bin:$PATH
npm run check:ios
```

结果：8 项全部 `PASS`，包括生产 API、Release mock gate、bundle id 与 APNS 环境。

### V2 交互回归守卫

```bash
node tools/v2-ui-regression-guard.mjs
```

结果：22 项全部 `PASS`。新增覆盖：

- 首页单入口且无卡池/模式选择；
- 九阶段合同；
- 毛球十态；
- Canvas `destinationOut`、26pt 笔刷与 45% 网格阈值；
- 检查点双选择、路径恢复与按复习周期幂等；
- 恢复后的反馈、掌握变化和服务端调度；
- VoiceOver 与手势共享覆盖网格，半径按 13pt 计算，避免少量点击提前揭示；
- 模糊反馈使用侧头，短暂 `inactive` 不打断卡面；
- 1450ms / 700ms / 180ms 时间合同。

### Swift 源码结构检查

```bash
python3 /tmp/recallo-swift-static-check.py
```

结果：两个改动 Swift 文件的括号/方括号/花括号平衡；九阶段、十态、刮开、检查点、恢复和红线文案检查全部 `PASS`。

### 差异检查

```bash
git diff --check
```

结果：`PASS`，无空白错误。


### Qoder 只读复审与修复

Qoder 智能体模式·极致对 `f508aa5` 做了只读审查，发现原实现把幂等键永久绑定到卡 ID，导致同一卡片下一轮复习也被当作重复提交。集成分支已改为按 `cardID + nextReviewAt` 形成复习周期键，并增加对应静态守卫；同时修复检查点恢复、刮层面积估算、VoiceOver 覆盖同步和模糊反馈姿态。

### Apple 工具链

```text
BLOCKED swiftc not found
BLOCKED xcodebuild not found
```

因此本报告不把静态检查描述成 iOS 编译或模拟器通过。
