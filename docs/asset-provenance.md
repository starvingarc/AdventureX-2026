# Recallo 素材授权登记（Asset Provenance）

> 版本：v0.6
>
> 日期：2026-07-24
>
> 对应规格：[`recallo-v06-motion-and-assets.md`](./recallo-v06-motion-and-assets.md) §7
>
> 维护规则：本文件与仓库实际文件一一对应。**只登记仓库实际使用（bundled）或明确评估中（considered）的素材；不得宣称使用了未实际导入的素材。** 新增素材必须先补登记再入库。

## 1. 状态定义

| 状态 | 含义 |
| --- | --- |
| bundled | 文件已在仓库内，并被产品或文档实际引用 |
| considered | 白名单允许、正在评估，但仓库内尚未导入任何文件 |
| excluded | 明确不引入 |

进入实现前还必须给每项素材标记处理方式：

| 处理方式 | 使用条件 |
| --- | --- |
| `reuse_as_is` | 尺寸、背景、状态表达和许可证均满足组件需要 |
| `reuse_with_crop_or_recolor` | 只需裁切、去背景、调色或压缩即可投入使用 |
| `rebuild_in_code` | 复用已有姿态，以 SwiftUI / CSS 的位移、旋转、缩放、镜像、代码卡片或粒子组合出新情境 |
| `generate_only_if_missing` | 关键状态没有可用素材，且代码重组仍无法清楚表达时才生成 |

处理顺序固定为：仓库已有素材 → 用户提供并授权素材 → 已登记开源素材 → 关键缺口生成。禁止因为“看起来更统一”而重复生成已具备的动作。

## 2. bundled：仓库实际使用

### 2.1 项目原创素材（无第三方授权问题）

| 位置 | 内容 | 用途 | 授权 |
| --- | --- | --- | --- |
| `拾贝/拾贝/Assets.xcassets/` | iOS 全部图标、吉祥物、装饰图、头像预设（V2*、Tab*、AppIcon 等） | iOS App 界面 | 项目原创，仓库自有 |
| `docs/app-demo-assets/*.svg`（16 个文件） | v0.5 Web 演示的导航图标、吉祥物、背景装饰 | v0.5 `ios-app-demo.html` 历史资产；v0.6 导航改用已登记的 Phosphor 文件 | 项目原创，仓库自有 |
| `docs/product-exploration/assets/*.png`（5 个文件） | v0.5 概念图，以及 v0.6 今日、召回、知识库三张验收截图 | PRD 历史视觉参考与 v0.6 验收记录 | 项目原创，仓库自有 |
| `docs/app-demo-assets/mascot-v06/*.png` | v0.6 毛球角色透明姿态表及站立、思考、侧头、起跳、成功 5 个切片 | Web 预览、设计核对 | 依据用户提供的情绪与比例参考重新生成的项目原创资产 |
| `拾贝/拾贝/Assets.xcassets/RecalloMascot*.imageset/` | 与 Web 同源的 5 个毛球姿态 | iOS App | 项目原创，仓库自有 |
| `docs/ios-app-demo.html` 内联 CSS | 卡面、铅笔涂鸦遮盖层、触控与 Reduce Motion 降级 | v0.6 Web 交互预览 | 项目原创，仓库自有 |

本轮十个情境状态默认采用 `rebuild_in_code`：复用上述 5 个透明姿态，通过位移、旋转、镜像、缩放、代码原生文件夹 / 卡片和已登记粒子组合为 `idle`、`reacting`、`turning`、`rummaging`、`carrying`、`watching`、`acknowledging`、`thinking`、`sleeping`、`farewell`。没有新增角色位图时，不重复登记同一素材。

### 2.2 第三方素材

| 素材 | 版本 / 文件 | 许可证与来源 | 引入位置 | 用途 |
| --- | --- | --- | --- | --- |
| Pow | `1.0.6` | MIT · <https://github.com/EmergeTools/Pow> | `拾贝/拾贝.xcodeproj/project.pbxproj` | iOS 跳跃、升起、闪光及粒子 `changeEffect` |
| Kenney Particle Pack | `1.1`：`star_04.png`、`circle_05.png`、`smoke_06.png` | CC0 · <https://kenney.nl/assets/particle-pack> | `docs/app-demo-assets/kenney-particles/`、`RecalloParticle*.imageset/` | 暖色火花、圆环、烟雾粒子，运行时统一着色 |
| Phosphor Icons Core | Git commit `2b75f3ad12b420c9504ef05df8d2564a28f8500e`：`sun.svg`、`cards-three.svg`、`user-circle.svg`、`plus.svg`、`arrow-up.svg` | MIT · <https://github.com/phosphor-icons/core> | `docs/app-demo-assets/phosphor/` | Web 三栏导航和导入/上拖提示图标 |

## 3. considered：白名单内、评估中（未导入）

| 素材 | 状态与授权 | 当前决策 |
| --- | --- | --- |
| 用户在 2026-07-24 对话中提供的毛球动作表、三视图、六场景配色图和刮卡示意图 | 用户明确授权本项目直接裁切、去背景、调色、组合和复用 | `considered`；本轮先用仓库透明姿态做 `rebuild_in_code`，只有关键状态表达不足时才导入派生文件 |
| [Agent UI Atlas](https://github.com/starvingarc/agent-ui-atlas) | Atlas 汇编内容为 CC BY 4.0；其中链接项目、截图、品牌与素材仍按各自许可证 | 仅作设计检索索引，提炼留白、材质、线条与可打断动效原则；不导入 Atlas 或其链接项目素材 |

当前没有处于 `considered` 状态的第三方运行时素材；新增候选必须先登记后导入。

## 4. excluded：明确不引入

| 素材 / 类别 | 原因 |
| --- | --- |
| Lottie / Rive 及其动效文件 | MVP 不引入动效运行时；毛球与卡面动效用 SwiftUI / CSS 自研 |
| 原神、炉石传说等第三方游戏的任何资产（图、音效、字体、卡面） | 仅借鉴揭晓节奏与卡面层级；不复刻、不描摹、不导出 |
| 无明确许可证的网络图片、图标包、表情包 | 授权不清，一律不进仓库 |

## 5. 新增素材流程

1. 确认许可证在 §3 白名单内，或为项目原创；
2. 标记 `reuse_as_is`、`reuse_with_crop_or_recolor`、`rebuild_in_code` 或 `generate_only_if_missing`；
3. 在本文件按状态登记：来源、版本、许可证或用户授权、原文件、处理方式、引入位置、用途；
4. 第三方素材保留许可证文本或注释；
5. 对新增或改动文件生成 SHA-256；
6. 审查时核对：`git ls-files` 中的素材文件与本表一一对应，多退少补。

## 6. 当前核对基线（v0.6）

- Web 端：只引用仓库内的原创毛球 PNG 与 5 个 Phosphor 原始 SVG，无外链字体、图片或脚本；
- iOS 端：Pow 精确锁定 `1.0.6`；只使用已登记的原创毛球与 3 个 Kenney 粒子；
- 十个毛球情境状态通过 5 个现有透明姿态与代码原生组件组合，不新增重复角色位图；
- 用户参考图与 Agent UI Atlas 均未被整包导入；如后续产生实际派生文件，必须在本表补原文件、处理方式与校验值；
- 全仓库无 Lottie（`.json` 动效）、无 Rive（`.riv`）文件。

## 7. 文件校验值（SHA-256）

| 文件 | SHA-256 |
| --- | --- |
| `mascot-v06/recallo-mascot-poses-v06-chroma.png` | `99de6a92e67bba6827d259e2ed542cbf113258f355a5558d55f44acb5685ae4f` |
| `mascot-v06/recallo-mascot-poses-v06.png` | `401a45f794927bebc271afae1b39669476c3c51ffa79166a5aa2cac1bef01afe` |
| `mascot-v06/recallo-mascot-idle.png` | `d62db1c37841d1d229b4c16b61965b482aae3e72daeb63add04e2a477da594c4` |
| `mascot-v06/recallo-mascot-thinking.png` | `d868f2fb3b750638b24107c7f137e83cf28c29cc67996da919c8c758e5fc24be` |
| `mascot-v06/recallo-mascot-tilt.png` | `0151f61ba6d48d2b436ef6f832101b0115df5df1252cb3a14bee3d05e1b444b2` |
| `mascot-v06/recallo-mascot-hop.png` | `1b469d65d90055c17f0d163e95b57a4435e49e47689b6fa3ac3430a6689f0252` |
| `mascot-v06/recallo-mascot-success.png` | `bc09d6438649b8a920a94d1b5195bbe1a46b27dda5b2e66db1ef94d412470a9c` |
| `kenney-particles/star_04.png` | `6485ac16c773663bd39346f3bedae04465ac14c661eb47cc5cfa935cdbf6c2ec` |
| `kenney-particles/circle_05.png` | `925b8ac284436f74f9cadf0ecd058da1c08fba65c098e4e34fd220603022f02e` |
| `kenney-particles/smoke_06.png` | `d988b03bb46797be913333f06b26ff2aad55ec082cfb7d3d18ce86ccb71559b5` |
| `phosphor/sun.svg` | `e031ec2d8c1b33f243e698a935c0252b75ab612966d111177d5ab1c680293606` |
| `phosphor/cards-three.svg` | `b9b28b5fd8badf13603aae3cbff72f1080adbfebc45734384b8286c26970e8f3` |
| `phosphor/user-circle.svg` | `96cc02045d8e1db183681f90ee21883b2cc45ce941a8ac5af5a6fa47bdd01f4b` |
| `phosphor/plus.svg` | `96b24cf8fd7305767791d43231271c47d24f2be856eb2a474df0e67a80840f2f` |
| `phosphor/arrow-up.svg` | `203081bc75bac0f1296da11e1225cd2315d8ae996b63a31f6ce133f3cd170bc5` |
