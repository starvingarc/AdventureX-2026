# Recallo v0.6 动画制作、工具与素材清单

> 版本：v0.1
>
> 日期：2026-07-25
>
> 对应 PRD：[`tasks/prd-recallo-2-screenshot-awakening-v0.6.md`](../tasks/prd-recallo-2-screenshot-awakening-v0.6.md)
>
> 动效合同：[`recallo-v06-motion-and-assets.md`](./recallo-v06-motion-and-assets.md)
>
> 素材登记：[`asset-provenance.md`](./asset-provenance.md)

本文把 Recallo 当前的毛球陪伴、召回抽卡、语义擦开、反馈和收卡动画整理为可执行制作清单。目标不是增加更多无意义动效，而是让“从自己的过去取回一张记忆”成为连续、可理解、可跳过的完整动作。

## 1. 当前判断

当前前端已经具备完整功能闭环：卡叠上拖、首张 1450ms / 后续 700ms 召回、语义擦开、三档反馈、检查点、收好与 Reduce Motion 均已有实现。

主要缺口不是卡片不会动，而是角色表演力不足：目前十个毛球语义状态主要由五张透明 PNG 通过缩放、镜像、倾斜和位移组合。`rummaging`、`carrying`、`sleeping` 和 `farewell` 可以表达状态，但还没有形成“跑向文件夹 -> 翻找 -> 抱卡回来 -> 放回文件夹”的连续故事。

状态标记：

- `DONE`：核心动画已实现，不重做素材；
- `POLISH`：逻辑已存在，需要增强表现；
- `TODO`：缺少关键动作或素材；
- `EVERY`：所有相关动画都必须满足。

## 2. 动画生产总表

| 环节 | 动画与目标 | 制作工具 | 实现方法 | 所需素材 | 状态 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 素材整理 | 统一毛球动作画布、锚点和透明边缘 | Photoshop / Affinity / Photopea、ImageMagick | 裁切、去背景、统一 1024x1024 与脚底基线 | 用户提供的动作表 | TODO | P0 |
| 首页待机 | 伸懒腰、看书、喝水、发呆低频轮换 | SwiftUI `Task`、CSS keyframes | 每 8-14 秒最多一次；操作中、低电量和 Reduce Motion 下停止 | Stretch、Reading、Drinking；优先裁切现有图 | POLISH | P1 |
| 点击毛球 | 害羞、偷笑、点赞、疑惑 | SwiftUI、Pow | 280-420ms 姿态切换与挤压回弹；不发奖励 | 现有 Tilt / Success；可选 Shy / ThumbsUp | POLISH | P1 |
| 卡叠入口 | 轻压、上拖、倾斜、取消回弹 | SwiftUI Gesture、CSS | 长按缩至 0.97；上拖约 28pt；倾斜不超过正负 4 度 | 卡片代码绘制 | DONE | - |
| 抽卡蓄力 | 卡叠压缩、毛球转头 | SwiftUI `withAnimation`、触觉反馈 | 0-120ms；卡叠缩至 0.96；毛球看向文件夹 | 现有 Tilt | POLISH | P0 |
| 跑向文件夹 | 毛球小跑建立空间连续性 | SwiftUI 帧切换、CSS sprite animation | 120-300ms；沿贝塞尔路径移动；每 90-120ms 换帧 | Run01、Run02；Run03 可选 | TODO | P0 |
| 翻找卡片 | 毛球翻找、文件夹内卡片错位 | SwiftUI、CSS | 300-480ms；两帧翻找；文件夹内卡片产生 2-3pt 不同步位移 | Rummage01、Rummage02 | TODO | P0 |
| 抱卡返回 | 毛球和卡片作为同一容器移动，接近中央后分离 | SwiftUI `ZStack`、Path | 480-750ms；角色和卡片共用路径，落位前解除绑定 | CarryingCard | TODO | P0 |
| 毛线轨迹 | 用轨迹表达记忆被召回，不表达概率 | SwiftUI Canvas、`Path.trim`、Web Canvas | 480-950ms；R 石墨灰、SR 珊瑚、SSR 暖金 | 现有 Glow / Spark；路径代码生成 | POLISH | P0 |
| 卡面落定 | 卡片归正、轻回弹、材质出现 | SwiftUI Spring、CSS keyframes | 950-1250ms；旋转约 3 度回到 0；缩放 1.04 回到 1 | 卡面代码绘制；稀有度纹理可选 | POLISH | P0 |
| 稀有度亮标 | 稀有度与掌握状态依次淡入 | Pow Shine、SwiftUI transition | 1250-1450ms；只闪光一次；三档时长一致 | 现有粒子；可选材质 Alpha | POLISH | P0 |
| 跳过抽卡 | 立即进入主动回忆，取消旧时间轴 | SwiftUI 可取消 Task | 取消当前阶段任务，直接进入 `recall` | 无 | DONE | - |
| 后续抽卡 | 缩短为 700ms，避免重复完整仪式 | 同首张抽卡工具 | 保留取卡、短轨迹、落定和提示 | 复用首张素材 | POLISH | P0 |
| 主动回忆 | 毛球安静注视，停顿较久只侧头一次 | SwiftUI Task | 停顿约 6-8 秒后侧头一次；不循环催促 | 现有 Idle / Tilt | POLISH | P1 |
| 语义擦开 | 26pt 自由路径，覆盖 45% 后揭示 | SwiftUI Canvas、Web Canvas | `destinationOut`；12x7 覆盖网格 | 遮盖层代码绘制 | DONE | - |
| 记忆修复 | 铅笔碎屑从最后触点飞回卡框 | Canvas、Pow Spray | 6-10 个碎屑；300-450ms；只播放一次 | 复用 Spark / Puff | TODO | P0 |
| 反馈：记得 | 小跳和暖黄粒子 | Pow Jump / Spray | 单次播放；不循环、不连击 | 现有 Success / Spark | DONE | - |
| 反馈：模糊 | 侧头、卡框柔和呼吸一次 | SwiftUI | 一次倾斜和一次呼吸，不持续闪烁 | 现有 Tilt | POLISH | P1 |
| 反馈：忘记 | 思考或陪伴坐下 | SwiftUI | 切换 Thinking；不震屏、不使用惩罚色 | 现有 Thinking；坐姿可选 | POLISH | P1 |
| 检查点 | 下一张露边，用户决定继续或收好 | SwiftUI transition | 下一张卡露出约 12-18pt；不自动连播 | 卡片代码绘制、现有 Tilt | DONE | - |
| 收卡 | 卡片插入文件夹并完成遮挡 | SwiftUI `mask`、`zIndex` | 卡片缩至约 0.82，进入文件夹前后层之间 | 文件夹使用代码分层 | TODO | P0 |
| 告别 | 文件夹闭合、毛球挥手 | SwiftUI Spring | 文件夹回弹一次；毛球挥手；总时长约 650-700ms | Farewell / Wave | TODO | P0 |
| 暂停/夜间 | 真正睡姿与极慢呼吸 | SwiftUI | 暂停时睡姿；Reduce Motion 下完全静态 | Sleeping；优先裁切用户素材 | TODO | P0 |
| Reduce Motion | 保留状态与结果，移除非必要位移、粒子和旋转 | `accessibilityReduceMotion`、CSS media query | 召回统一为约 180ms 淡入；轨迹和粒子关闭 | 无 | EVERY | P0 |
| 素材压缩 | 控制透明 PNG 体积 | ImageMagick、pngquant、optipng | 检查 Alpha、统一尺寸、无损或视觉无损压缩 | 所有新增 PNG | TODO | P0 |
| 素材登记 | 保留授权、处理与校验记录 | `sha256sum`、Markdown | 登记来源、授权、原文件、派生方式、使用位置和 SHA-256 | 所有进入 App 的文件 | EVERY | P0 |
| Web 验收 | 375px、鼠标、触摸、键盘与 Reduce Motion | Playwright、ffmpeg | 完成全流程并保存截图或视频证据 | 无 | EVERY | P0 |
| iOS 验收 | 编译、模拟器、VoiceOver、动态字体和掉帧检查 | Xcode、Accessibility Inspector、Instruments | 测试中断恢复、低电量和 Reduce Motion | 无 | EVERY | 发布前 |

## 3. 抽卡时间轴合同

### 3.1 首张完整召回：1450ms

| 时间窗 | 阶段 | 卡片 | 毛球 | 效果 |
| --- | --- | --- | --- | --- |
| 0-120ms | `compress` | 卡叠压缩，顶部卡下沉 4-6pt | 转头看向文件夹 | 轻触觉；背景只轻微降亮度 |
| 120-300ms | `rise-a` | 封存卡保持不可见 | 两帧小跑到文件夹 | 无粒子 |
| 300-480ms | `rise-b` | 文件夹内卡片轻微错位 | 两帧翻找 | 卡片不是随机抽中，调度结果已确定 |
| 480-750ms | `orbit-a` | 卡片跟随毛球返回 | 抱卡移动到中央 | 毛线轨迹开始出现 |
| 750-950ms | `orbit-b` | 卡片与毛球分离并升起 | 退到卡片右下方 | R / SR / SSR 轨迹完成一圈 |
| 950-1250ms | `settle` | 卡片归正、回弹、材质落定 | 切换等待姿态 | 不显示答案或完整截图 |
| 1250-1450ms | `cue` | 稀有度与掌握状态淡入 | 放下卡片并注视 | Shine 只播放一次，出现“试着想起它” |

用户可以在任意阶段点击“跳过过场”。跳过必须取消当前动画 Task，并直接落在主动回忆界面。

### 3.2 后续召回：700ms

| 时间窗 | 内容 |
| --- | --- |
| 0-80ms | 卡叠轻压 |
| 80-260ms | 毛球取出下一张 |
| 260-440ms | 短毛线轨迹 |
| 440-580ms | 卡面落定 |
| 580-700ms | 稀有度和主动回忆提示出现 |

后续召回不重复完整光迹仪式。每张卡结束后先进入检查点，由用户选择继续或收好。

## 4. 稀有度材质

稀有度在进入动画前已经由内容规则确定。动画只呈现价值层级，不模拟随机概率。

| 稀有度 | 卡框与纸张 | 轨迹 | 落定反馈 | 新素材需求 |
| --- | --- | --- | --- | --- |
| R | 奶油纸张、石墨线 | 灰白单线 | 一次轻回弹 | 无强制素材 |
| SR | 双层卡纸、珊瑚描边 | 珊瑚双线 | 一次短流光 | 可选珊瑚纸边 Alpha |
| SSR | 暖金纤维、克制珠光 | 暖金毛线和少量星点 | 柔和纤维聚拢 | 可选暖金纤维 Alpha |

三档持续时间必须一致。禁止概率数字、保底、卡包、转盘、近失误和“差一点 SSR”。

## 5. 最小角色素材包

仓库现有五个姿态继续复用：

- `RecalloMascotIdle`；
- `RecalloMascotTilt`；
- `RecalloMascotThinking`；
- `RecalloMascotHop`；
- `RecalloMascotSuccess`。

P0 至少补齐以下七个透明 PNG：

```text
RecalloMascotRun01.png
RecalloMascotRun02.png
RecalloMascotRummage01.png
RecalloMascotRummage02.png
RecalloMascotCarryingCard.png
RecalloMascotSleeping.png
RecalloMascotFarewell.png
```

P1 可选素材：

```text
RecalloMascotStretch.png
RecalloMascotReading.png
RecalloMascotDrinking.png
RecalloMascotShy.png
RecalloMascotThumbsUp.png
```

跑步、睡觉、挥手、伸懒腰、看书、喝水和部分情绪优先从用户已授权动作表裁切。只有翻找、抱卡等关键状态无法通过裁切表达时，才补画或调用图像生成模型。

## 6. 素材技术规格

| 项目 | 规格 |
| --- | --- |
| 格式 | 透明 PNG；不使用 GIF 运行时 |
| 原始画布 | 1024x1024 |
| 角色占比 | 高度约为画布 70%-76% |
| 脚底基线 | 统一放在画布高度约 88% |
| 默认朝向 | 面向右；面向左由代码镜像 |
| 阴影 | 不烘焙固定投影；运行时统一生成 |
| 背景与文字 | 不包含 |
| 分层 | 卡片、文件夹、问号、爱心和提示符尽量独立 |
| Web / iOS | 共用同一原始 PNG，不分别生成两套角色 |
| 压缩 | 导入前经过 pngquant / optipng；视觉边缘必须复检 |

文件夹不制作成单张位图。运行时拆成背板、卡片插槽和前盖三个 SwiftUI / CSS 层，才能完成插入与遮挡。

## 7. 工具选择

| 工具 | 用途 | 使用位置 | 是否新增依赖 |
| --- | --- | --- | --- |
| Photoshop / Affinity / Photopea | 裁切、去背景和修毛发边缘 | 素材准备 | 否 |
| Procreate / Krita | 补画关键姿态 | 素材准备 | 否 |
| ImageMagick | 批量检查尺寸、Alpha 和画布 | `bridge-amax` | 否 |
| pngquant / optipng | PNG 压缩 | `bridge-amax` | 否 |
| Figma / Smart Animate | 关键帧和遮挡关系预演 | 设计阶段 | 否 |
| SwiftUI | 卡片、文件夹、角色和转场 | iOS | 已有 |
| SwiftUI Canvas / `Path.trim` | 毛线轨迹、刮开和碎屑路径 | iOS | 已有 |
| Pow 1.0.6 | 单次 shine、jump、spray | iOS | 已锁定 |
| CSS keyframes / Web Animations API | Web 过场和角色帧切换 | Web 演示 | 已有能力 |
| Web Canvas | Web 毛线轨迹、刮开和粒子 | Web 演示 | 已有能力 |
| Playwright | 375px、触摸、键盘和 Reduce Motion 验收 | `bridge-amax` | 已有测试路线 |
| ffmpeg | 录屏转 MP4 / GIF 供对比 | `bridge-amax` | 工具层，不进入产品 |
| Xcode Simulator / Instruments | 编译、真机尺寸和性能检查 | macOS runner | 发布前需要 |

MVP 不引入 After Effects 运行时、Lottie、Rive、Spine、Unity、Unreal、Blender 或新的粒子库。After Effects 可以制作概念预览，但不能成为产品运行依赖。

## 8. 制作与实现流程

1. 冻结角色基准画布、脚底锚点、文件命名和抽卡时间轴；
2. 盘点用户授权素材，标记 `reuse_as_is`、`reuse_with_crop_or_recolor`、`rebuild_in_code`、`generate_only_if_missing`；
3. 裁切跑步、睡觉、挥手等已有动作；
4. 只为缺失的翻找、抱卡等关键状态补画或生成；
5. 在 Web Demo 中先验证路径、遮挡、速度和 375px 布局；
6. 将同一素材接入 SwiftUI 状态机；
7. 增加跳过、取消、后台恢复、低电量和 Reduce Motion 路径；
8. 运行 Web、静态 guard 和素材登记检查；
9. 在 macOS runner 完成 Xcode、Simulator、VoiceOver、动态字体和 Instruments 验收；
10. 形成录屏证据、更新验证文档后再合并。

## 9. 并行分工

| 负责人 | 所有权 | 交付物 |
| --- | --- | --- |
| Kimi Code | 素材盘点与裁切脚本、Web CSS / Canvas 动画、Playwright 证据 | Web 抽卡、毛线轨迹、素材清单、375px 验收 |
| Qoder 智能体模式 | SwiftUI 毛球播放器、抽卡时间轴、文件夹遮挡、Reduce Motion 与可访问性 | iOS 动画代码、静态守卫、合同测试 |
| Codex | 状态合同、素材授权、交叉审查、服务器集成和最终验收 | 单一集成提交、测试报告、文档与 GitHub 同步 |

所有代码、素材处理脚本和 Web 测试在 `bridge-amax` 隔离 worktree 中执行。`bridge-amax` 是 Linux，不能运行 Xcode Simulator；正式 iOS 编译必须使用 macOS CI runner，或者由用户明确授权的 Mac 构建环境完成。

## 10. 验收清单

### 动画行为

- [ ] 首张完整过场总时长约 1450ms；
- [ ] 后续过场总时长约 700ms；
- [ ] Reduce Motion 约 180ms 淡入，不播放轨迹和粒子；
- [ ] 任意阶段可跳过，旧 Task 被取消；
- [ ] 跑步、翻找、抱卡和收卡形成连续空间关系；
- [ ] R / SR / SSR 只改变材质和轨迹，不改变概率或时长；
- [ ] 记得 / 模糊 / 忘记反馈只播放一次；
- [ ] 用户停止复习时没有自动连抽；
- [ ] 后台退出和恢复不会重复抽卡或重复提交反馈。

### 素材

- [ ] 所有角色 PNG 使用相同画布与基线；
- [ ] 毛发边缘无白边、橙色残留或透明锯齿；
- [ ] 没有重复生成已有姿态；
- [ ] 没有整包导入第三方素材；
- [ ] 每个素材已登记来源、授权、派生方式和 SHA-256；
- [ ] Web 与 iOS 共用原始角色文件；
- [ ] 不包含授权不清的音效、字体、卡面或第三方游戏资产。

### 可访问性与性能

- [ ] VoiceOver 可以跳过抽卡、完整揭示和提交反馈；
- [ ] 动态字体不会遮挡主要按钮；
- [ ] 低电量模式停止空闲动作和非必要粒子；
- [ ] Reduce Motion 不移除状态、结果或操作能力；
- [ ] 375px 宽度无横向溢出；
- [ ] iOS 真机尺寸无明显掉帧和离屏渲染问题。

## 11. 禁止项

- 不使用概率数字、保底、卡包、转盘、十连和近失误；
- 不用全屏爆炸、循环闪光和不断升级的刺激；
- 不把原始截图或答案放在抽卡过场中提前泄露；
- 不用假进度条或不能真实结束的“AI 正在努力”动画；
- 不因忘记而降级、摧毁或让卡片枯萎；
- 不为已有动作重复生成一套不同风格角色；
- 不在 MVP 引入 Lottie、Rive 或新的动画运行时。
