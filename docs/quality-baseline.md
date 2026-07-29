# Omo 工程质量与验证基线

本页定义每类改动需要什么证据。它是验证政策，不是“当前所有能力已经通过”的声明；实际结果必须记录在对应计划、PR 或交付说明中。

## 证据分级

| 证据 | 能证明什么 | 不能替代什么 |
|---|---|---|
| 静态检查 / 语法检查 | 文件可解析、链接或基础规则成立 | 运行时行为、真实服务、UI |
| 单元 / 合同测试 | 指定输入输出、错误和幂等规则 | 跨进程、真实数据库、真机 |
| Fixture / Mock E2E | 确定性闭环和客户端状态映射 | Qwen/TikHub、真实来源质量、生产延迟 |
| 本地 Postgres / worker | 迁移、并发、重试和持久化 | Railway 生产配置与数据 |
| Simulator / 浏览器 | 受测设备和路径上的交互与布局 | 真机权限、所有尺寸、生产数据 |
| 真实提供方 smoke | 凭据、网络和 Adapter 当前可用 | 长期质量、全量回归、成本上限 |
| 部署与健康检查 | 产物可部署、入口可响应 | 业务闭环、内容正确、数据恢复 |
| 真实生产闭环 | 指定版本和环境的端到端结果 | 未覆盖平台、设备和边界条件 |

报告必须写清环境、版本、设备/视口、命令、结果和未覆盖范围。

## 通用门禁

所有改动：

```bash
git status --short --branch
git diff --check
```

文档或计划：

```bash
npm --prefix backend run docs:check
```

不得修改或清理与当前任务无关的用户/其他 Agent 改动。

## 后端门禁

首次准备环境：

```bash
npm ci --prefix backend --ignore-scripts
```

后端正式本地门禁：

```bash
npm --prefix backend run check
npm --prefix backend run test:all
```

按范围追加：

```bash
npm --prefix backend run check:v2
npm --prefix backend run check:video-source
npm --prefix backend run smoke:v2:queue
```

要求：

- 新行为有成功、失败、超时/取消、重试和幂等测试。
- 生产配置默认 fail closed：`/api/health` 仅作 liveness，部署探针和业务可用性使用 `/api/readiness`。
- Fixture 必须通过非生产环境的 `OMO_DEMO_MODE` 显式开启；缺失 `QWEN_API` 不得自动返回演示成功。
- canonical 提供方变量统一为 `QWEN_BASE_URL` / `QWEN_MODEL` / `QWEN_TIMEOUT_MS` 与 `TIKHUB_API_KEY` / `TIKHUB_BASE_URL` / `TIKHUB_TIMEOUT_MS`；兼容别名不得进入新部署配置。
- readiness、错误响应与日志只包含安全状态和稳定码，不包含密钥、截图 Base64、上游正文或完整模型载荷。
- 改变 `capture_memory_card_2` 时覆盖 1–3 卡、数组/单数镜像、证据引用、语义去重和无卡 disposition。
- 改变持久化时覆盖重复 capture、canonical group 顺序、单卡 assessment、删除、任务恢复和 stale write fencing。
- 修改平台 Adapter 时覆盖严格平台匹配、歧义拒绝、资源上限、取消和敏感日志。
- Fixture provider 必须保持 `NODE_ENV=test` 等显式隔离，未知输入不能被映射为虚构成功。
- JSON / 内存 Store 不得标记为生产就绪；写入失败必须让请求失败并回滚进程内状态。

## 数据库与后台任务

数据库或 worker 变化必须：

- 新增顺序 migration，不改写已发布 migration。
- 在空数据库和从上一版本升级两条路径运行。
- 验证重复投递、进程重启、锁竞争、删除竞争和回滚/停止策略。
- 把本地内存 fallback 与 Postgres 结果分开报告。
- 没有真实 Postgres 证据时不得声称持久任务已生产可用。

## iOS 门禁

先确认可用目标：

```bash
xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations
```

然后用实际 Simulator UDID 构建并运行测试：

```bash
xcodebuild \
  -project Omo/Omo.xcodeproj \
  -scheme Omo \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_UDID>' \
  test
```

按改动追加：

- Codable / API：成功响应、兼容字段、缺失字段、错误响应和未知 Schema。
- 状态恢复：刷新/重启、中断、重复提交、删除和后台完成。
- Fixture：Schema 版本、生产入口隔离和不泄露真实数据。
- 路由：深链、返回、恢复、失败重试和取消。
- APNs、相册/分享、Sign in with Apple 或其他系统能力：Simulator 之外再做真机/真实环境验证。

## UI 与美学原则门禁

所有受影响页面必须实际打开，不以代码审查替代视觉检查。

### SwiftUI

- 至少检查一个常见 iPhone Simulator，并补一个更大或更小尺寸。
- 走通正常、加载、空、失败、待确认、长文本和恢复状态中实际受影响的状态。
- 检查安全区、键盘、滚动、触控尺寸、文字截断、横向溢出和弹层焦点返回。
- 使用更大 Dynamic Type 验证关键信息和主操作仍可达。
- 启用 Reduce Motion，确认语义、结果和操作不依赖动画。
- 用 VoiceOver 或 Accessibility Inspector 检查顺序、标签、值、提示和揭示前答案泄漏。

### HTML Demo

- 使用 Playwright 或真实浏览器复现受影响路径。
- 至少检查窄屏和桌面视口。
- 保存关键状态截图，并记录视口、数据模式和操作步骤。
- Demo 结果必须标注为 Demo，不替代 iOS 或真实服务验证。

### 原则比较

逐项对照：

- [[docs/product-principles]]
- [[docs/frontend/v2-layout-system]]
- 改动前基线截图或已批准设计
- [[docs/asset-provenance]]

如果主操作不清楚、视觉层级混乱、角色/动效遮挡内容、证据揭示违规、布局依赖脆弱偏移或与现有语言不一致，退回修改后重新检查。

## 外部提供方与真实闭环

以下变化需要对应真实环境证据：

- Qwen 视觉/生成：真实授权样本、Schema、Evidence、失败回退、延迟与成本边界。
- TikHub / Bilibili / 抖音 / 小红书：真实 URL 或截图、严格平台归属、歧义和无结果行为。
- ASR / FFmpeg：实际媒体、字节/时长限制、字幕优先、转写回退和取消。
- Railway / Postgres worker：部署版本、migration、任务重启、持久化和健康检查。
- APNs：sandbox/production 环境、Bundle ID、token 隔离和真机回执。
- Vercel：Serverless 入口、包含文件、超时和与后端行为的一致性。

如果权限或凭据不可用，在计划/PR 中列出未验证项和执行条件；不要填造 `Passed`。

## 改动范围到验证的最小映射

| 改动 | 最低验证 |
|---|---|
| 仅文档/计划 | `docs:check` + `git diff --check` |
| 后端纯逻辑 | 目标测试 + `check` + `test:all` |
| V2 后端 | 上述 + `check:v2` |
| 视频/平台来源 | 上述 + `check:video-source` + 真实 Adapter smoke |
| Migration/worker | 完整后端 + Postgres 升级/重启/并发 |
| Swift 模型/Service | 相关 XCTest + Simulator build/test + 受影响路径 |
| SwiftUI 页面/动效 | XCTest（如适用）+ Simulator 原则检查 + 截图/录屏 |
| HTML Demo | 后端相关测试 + Playwright/浏览器窄屏和桌面 |
| 素材 | 资源引用/哈希/许可证 + App 构建 + 实际页面 |
| 部署配置 | 本地门禁 + 目标部署 + 健康检查 + 业务 smoke |

部署配置只完成本地门禁而没有目标环境 readback 时，报告必须明确为“配置变更已验证、真实部署未验证”，不得把本地 `/api/readiness` Fixture 结果写成生产验证。

## 交付证据模板

```markdown
## 验证

- 命令：`...`
  - 环境：
  - 结果：
- UI 路径：
  - 设备 / 视口：
  - 状态：
  - 截图 / 录屏：
- 真实服务：
  - 提供方 / 版本：
  - 结果：
- 未验证：
  - 原因：
  - 所需条件：
```

## 相关文档

- [[AGENTS]]
- [[docs/product-principles]]
- [[docs/ios-api-data-contract-zh]]
- [[docs/frontend/v2-layout-system]]
- [[docs/asset-provenance]]
- [[docs/documentation-guide]]
- [[PLANS]]
