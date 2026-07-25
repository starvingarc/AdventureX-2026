# Recallo（拾贝）

Recallo 把用户在 B站、抖音等平台保存的碎片内容，变成以后真正会被再次想起的一张证据卡。

当前 v0.6 主链只有一条：

```text
平台截图
  -> Qwen 视觉模型识别平台、标题、作者与内容位置
  -> 平台 Adapter 恢复正文、字幕或可引用证据
  -> CaptureMemoryCardV2 判断生成一张主记忆卡、仅存档或要求确认
  -> 用户在“今日”召回一张卡并主动回忆
  -> 刮开承重语义，选择“记得 / 模糊 / 忘记”
  -> 后端写入真实 nextReviewAt，等待下一次召回
```

一份内容只生成一张主卡。`semantic_cloze`、`true_false` 和 `multiple_choice` 是同一张卡、同一证据的复习变式，不是三张独立知识卡。R / SR / SSR 表示知识节点的核心潜力，不表示随机抽取概率或掌握程度。

`captureAnalysis.memoryCard` 与 `schedule` 是当前输出主合同。旧 `review`、`videoOverview` 和章节式字段只作为兼容镜像保留，不能作为新功能的产品或数据源头。

当前生产链路没有 Claude。截图流支持 B站、抖音和小红书：Qwen 视觉模型直接读取原图；TikHub 只在对应平台核对来源。视频优先使用字幕、ASR 兜底，小红书图文读取公开正文。来源或证据不足时，系统不会伪造可信卡片。

## 目录

- `拾贝/`：正式 SwiftUI iOS App。
- `backend/`：Node.js API、链接提取、视频字幕/ASR、模型生成和复习状态。
- `docs/`：产品、架构、隐私和发布文档。
- `tools/`：本地环境、iOS 和发布检查脚本。

当前文档入口见 [docs/README.md](docs/README.md)。产品合同以 [tasks/prd-recallo-2-screenshot-awakening-v0.6.md](tasks/prd-recallo-2-screenshot-awakening-v0.6.md) 为准；旧章节链和 App Store 文档的状态也在索引中明确标注。

## 运行与演示

要求 Node.js 20+。视频 ASR 兜底还需要 `ffmpeg`、`yt-dlp` 和 Whisper 环境。本项目的实现、后端/Web 回归与文档验证统一在 `bridge-amax` 的任务 worktree 中执行；不要在个人本地副本形成另一套结果。

根目录 `.env` 或 `backend/.env`：

```dotenv
AI_PROVIDER=qwen
QWEN_API=replace_me
BASE_URL=https://example.com/v1
AI_MODEL=qwen3.7-plus-2026-05-26

# 三平台截图来源恢复
TIKHUB_API_KEY=
TIKHUB_BASE_URL=https://api.tikhub.dev
CAPTURE_PLATFORMS=bilibili,douyin,xiaohongshu
TIKHUB_CONTENT_ENABLED=1
VIDEO_LINK_ENABLED=1

# 默认关闭。只有字幕无法表达关键画面时再显式开启。
VIDEO_VISUAL_ENABLED=0
```

环境变量优先级为系统环境变量、`backend/.env`、根目录 `.env`。真实密钥不得提交 Git。

```bash
# 在 bridge-amax 对应任务 worktree 内
npm --prefix backend install
npm run dev

# 另一个终端确认服务和当前前端
curl -fsS http://127.0.0.1:5173/api/health
curl -fsS http://127.0.0.1:5173/app-demo >/dev/null
```

后端默认地址为 `http://127.0.0.1:5173`。正式 iOS 工程是 `拾贝/拾贝.xcodeproj`。

- `http://127.0.0.1:5173/app-demo`：**当前前端交互预览**，展示三栏首页、毛球召回、单卡主动回忆、刮开、反馈与继续/收好。用户选择的文件会上传到同源 `POST /api/sources/image-flow`；自动化测试可以显式使用确定性合成 Fixture。默认空库保持空态，不伪造卡片。它不是独立生产 Web 客户端。
- `http://127.0.0.1:5173/demo`：`/app-demo` 的兼容别名；旧章节式 `flow-demo.html` 已由集成主线删除和替换。
- `POST /api/sources/image-flow`：正式截图分析入口。原图直接发送给配置的 Qwen 视觉模型，不经过 Apple Vision 或 Paddle OCR。

平台已知时只搜索该平台；平台不明时才在已启用 Adapter 间受控搜索。没有找到标题和作者均可信且无歧义的结果时，系统进入阻断、仅存档或确认路径，不生成伪造来源的正式卡。

部署后请设置 `SHIBEI_PUBLIC_BASE_URL=https://你的后端域名`。无字幕长视频时，后端会下载音频，生成一个仅供 Qwen ASR 读取的短期 HTTPS 地址；转写结束立即失效。本地 `localhost` 不会公开临时媒体，仍使用本地 Whisper 兜底。

## 测试

所有命令都在 `bridge-amax` 的对应 worktree 运行：

```bash
# 后端合同、平台 Adapter、持久化与工作区守卫
npm run check

# iOS 生产配置静态守卫；不等于 Xcode 编译或模拟器测试
npm run check:ios

# 30 例合成 B站/抖音合同 Fixture
npm --prefix backend run benchmark:capture-memory-fixtures
```

`benchmark:capture-memory-fixtures` 使用脚本构造的确定性文本证据和注入式 provider，标记为 `deterministic_contract_fixture_not_real_screenshot`。它只验证 Schema、Evidence、题型、稀有度和调度合同，不调用真实 Qwen、TikHub、视频下载或 ASR，也不能用于宣称真实截图识别率、模型质量、网络延迟或成本。

完整 Xcode 编译、Simulator、VoiceOver 与动态字体验收必须在具备完整 Apple 工具链的环境单独执行；Linux 上的 Swift 静态守卫不能替代这些结果。

## 性能目标

- 有平台字幕：不下载完整视频，不抽帧，直接进入模型生成。
- 无字幕：平台 adapter 优先提供媒体流，Qwen 可直接读取时不下载；被平台 CDN 拒绝时才下载一次并 ASR。视觉理解默认关闭。
- 长文/长字幕：确定性保留头、中、尾，模型输入默认最多 12,000 字符。
- 一张证据卡及其语义遮挡、判断题、选择题变式：一次模型请求完成，默认关闭 thinking。
- 相同内容：进程内 TTL/LRU 缓存，并合并同时到达的重复请求。

生产环境仍建议把结果缓存升级为 Redis/PostgreSQL 持久缓存，以便多 worker 共享。
