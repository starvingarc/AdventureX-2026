# Task 6 Release Simulator × Real Staging 验收

> 历史说明：本次 Simulator 验证发生在产品身份纠正之前，App bundle 当时仍为旧 `com.maxhan.shibei`。它只证明 UI/API/staging 闭环，不构成 Omo 独立 App 的发布证据。后续发布必须使用 `com.maxhan.omo`。

- 日期：2026-08-08
- 分支：`codex/testflight-staging-release`
- Simulator：`Omo TestFlight iPhone 17 Pro`（iOS 26.5）
- App：Release，`com.maxhan.shibei`
- API：`https://omo-api-staging-staging.up.railway.app`
- 数据：仅使用仓库内合成界面截图；未使用真实用户截图或生产数据

## 实际通过路径

1. 清空 Omo App 数据后首次启动显示空库，只提供菜单和“上传第一张知识截屏”。
2. 系统 PhotosPicker 能看到导入的合成截图；选择截图后、发送给 AI 前出现独立许可说明。
3. 点击“同意并生成”后显示整理状态，真实 staging 生成成功，并弹出系统通知权限请求。
4. 允许通知后回到有卡首页；IP、知识库和上传入口同时存在。
5. 点击 IP 进入一张卡回顾；揭示前承重语义被遮挡，知识库完整上下文入口不可绕过遮挡。
6. 实际刮擦达到阈值后显示差异化文字权重和三档自评条。
7. 先拖到自评节点再拖回最左端松手，卡片不切换；随后提交“记住了”，一张卡轮次结束并回到首页。
8. staging PostgreSQL 读取确认 `reviewCount=1`、`lastAssessment=remembered`，证明 iOS 提交真实落库。
9. 知识库直接展示完整卡片；英文语义查询 `memory screenshot` 经真实 staging 搜索后保留相关卡片。
10. 卡片详情显示完整知识、解释与来源；完成后回到原搜索状态。
11. 通过 owner 隔离的删除 API 清除合成卡；App 重启后重新显示空库，staging 中该测试用户卡片数为 0。

## 证据

- `real-staging-library-search.png`：真实 staging 搜索结果与完整卡片。
- `real-staging-card-context.png`：真实生成卡的完整知识详情。
- backend 公网闭环与 deployment 记录见 `task5-staging-bootstrap.md`。
- 全量 iOS XCTest：37 passed / 0 failed / 0 skipped。

## 边界与未宣称事项

- 中文输入自动化工具只支持美式键盘字符，因此本轮真实搜索使用英文；中文请求编码由 XCTest 合同覆盖。
- 当前 Figma/MVP 没有用户可见删除入口；只验证既有后端删除合同，不在本轮临时新增未设计的交互。
- 通知权限和本机调度已验证；通知点击叠卡证据沿用 `task4-notification-validation.md`，未等待真实复习间隔。
- 未访问、修改或部署 Railway 生产项目“拾贝”，未触碰 `main`。
