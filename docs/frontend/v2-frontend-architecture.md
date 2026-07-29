# Omo iOS 前端架构

当前 iOS 客户端采用精简的 SwiftUI 单向状态结构；旧 V2 多层页面和兼容服务已经退役。

## 运行时边界

- `OmoApp.swift`：应用入口并注入唯一的 `OmoStore`。
- `ContentView.swift`：今日、知识库、我的、上传和召回流程。
- `MotionKit.swift`：逐帧图集、粒子、轨道、刮除和按钮反馈，不承载业务状态。
- `OmoStore.swift`：卡片集合、加载、上传、反馈和删除状态。
- `APIClient.swift`：设备隔离的 HTTP 合同。
- `OmoModels.swift`：客户端可解码模型和展示派生值。

视图只触发 `OmoStore` 动作；Store 通过 `APIClient` 调用后端并发布新状态。后端是卡片、掌握阶段和下次复习时间的事实来源。

## 状态与兼容

- 加载、生成、空状态和错误均显式展示。
- `MemoryCard` 的来源核验字段为可选，以兼容旧卡片。
- Debug 启动参数仅用于 Simulator 路径验证，不改变 Release 行为。
- 新增页面或状态前优先扩展现有 Store 和共享组件，避免恢复平行架构。

## 相关文档

- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-layout-system]]
- [[docs/product-principles]]
- [[docs/quality-baseline]]
