# Omo iOS 布局与动效系统

当前界面以“抽取、主动回忆、揭示、反馈、收好”作为一条连续视觉叙事。动效服务于状态因果，不承担业务判断。

## 视觉来源

- `OmoTheme` 保存颜色、页面边距和圆角等语义 token。
- 同族卡片共享表面、圆角、阴影和内容节奏。
- 主要操作使用统一按钮样式，触控区域不小于 44pt。
- 页面通过 safe area 组织顶部和底部导航，不使用散落的设备坐标补丁。

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
