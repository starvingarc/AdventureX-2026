# Omo 首次首页空状态

## 目标

当 `OmoStore.cards` 为空时，首页唯一主任务是让用户上传第一张自己认为有价值的截图，从而体验“自己的截图变成可召回知识”的 Magic Moment。页面依据 Figma `825:434` 实现，不预置不属于用户的示例截图。

## 页面结构

- 珊瑚橙全屏背景、左上菜单、右上 IP、奶油色知识主体。
- 主体中央提示“上传第一张知识截屏”。
- 左下收藏夹插画、右下上传按钮，并以箭头建立视觉指向。
- Figma 的 402 × 874 坐标集中在 `RecallHomeMetrics`，页面按可用区域等比缩放。
- 标题使用系统圆角字体 Bold 24pt；不引入外部字体。

## 上传流程

点击右下按钮直接打开 iOS 系统单选照片选择器。取消选择时留在原页；选择成功后复用 `OmoStore.createCard`、现有图片压缩与 API，不增加裁剪、分类、标题、确认或 AI 同意步骤。上传中禁用重复选择；失败时在原页面显示轻量错误并允许重试。

## 次级入口

左上菜单只提供 Profile 与 Settings。菜单从左侧滑入并覆盖遮罩，点击遮罩可关闭；它不与上传主动作竞争。首次空态的收藏夹只作视觉主体，不在没有知识卡时引导用户进入空库。

## 可访问性

- 上传入口不少于 44pt，并说明会打开系统照片选择器且只选择一张截图。
- IP、收藏夹和箭头在空态为装饰，不重复朗读。
- 菜单打开时底层控件从无障碍树隐藏。
- Reduce Motion 下使用简化菜单过渡。

## 非目标

- 不改造 Share Extension、批量上传、知识库或 Profile/Settings 视觉。
- 不在空态预置示例内容。
- 不在本页决定 IP 的最终形象与动画。

## 验证证据

2026-07-29 的 Simulator 截图见 [[docs/validation/omo-figma-active-recall-2026-07-29/README]]。

## 相关文档

- [[docs/product-principles]]
- [[docs/frontend/v2-active-recall-home]]
- [[docs/frontend/v2-frontend-architecture]]
- [[docs/frontend/v2-layout-system]]
- [[docs/quality-baseline]]
