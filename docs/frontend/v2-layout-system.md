# Omo iOS 布局与动效系统

当前界面以“抽取、主动回忆、揭示、反馈、收好”作为一条连续视觉叙事。动效服务于状态因果，不承担业务判断。

## 视觉来源

- `OmoTheme` 保存颜色、页面边距和圆角等语义 token。
- 同族卡片共享表面、圆角、阴影和内容节奏。
- 主要操作使用统一按钮样式，触控区域不小于 44pt。
- 页面通过 safe area 组织顶部和底部导航，不使用散落的设备坐标补丁。

## “我的”页面层级

- 页面按“标题 → Omo 身份展示区 → 记忆足迹 → 今日召回状态”的顺序组织为单一阅读流；普通字号优先在首屏完整呈现核心内容，`ScrollView` 只作为小屏、Accessibility 字号和极端大数字的兜底，不把滚动本身当作设计。
- 身份展示区使用有机形状舞台、编辑式留白与发丝分隔线表达当前 Omo 角色与产品关系，不再套用账号卡片；账号、头像编辑、通知等能力没有真实合同前不展示为可操作入口。
- “记忆卡”“已召回”和待召回数量分别直接来自当前客户端 Store 的卡片数量、累计 `reviewCount` 与 `dueCards`，不使用 Fixture 或历史模型推断统计。
- 普通字号下身份区与双统计卡使用可回退的横向／纵向布局；Accessibility 字号下强制纵向或通栏，不依赖固定设备宽度和坐标偏移。
- Debug 构建可用显式启动参数 `-OmoProfileLargeFixture` 检查大数字布局；该 Fixture 不改变生产 Store、API 或展示值。
- 页面只使用当前已登记的 Omo 素材；历史 Profile 素材没有来源记录时不恢复。

## 动效层

- 首页卡堆：低频呼吸和分层漂浮。
- 召回过场：奔跑、翻找、叼回、卡片落定的逐帧图集。
- 主动回忆：Canvas 刮除涂层，揭示前不向可见界面泄露答案。
- 反馈与完成：姿态切换、触觉、粒子和轨道光效。
- `Reduce Motion` 开启时使用静态首帧和短淡入淡出，跳过长过场。

## 验证

UI 改动至少检查常见 iPhone Simulator、Dynamic Type 风险、VoiceOver 文案、浅色模式、触控尺寸、滚动和 Reduce Motion。编译成功不替代实际页面检查。

## 相关文档

- [[docs/frontend/v2-frontend-architecture]]
- [[docs/product-principles]]
- [[docs/asset-provenance]]
- [[docs/quality-baseline]]
