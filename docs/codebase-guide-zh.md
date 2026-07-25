# 当前代码说明

本文件只描述正式运行路径。已删除的截图评测、Python MVP、Web demo 和历史实验不再是工程组成部分。

## 顶层目录

| 路径 | 作用 |
|---|---|
| `拾贝/` | SwiftUI iOS App、网络层、收藏列表和复习界面 |
| `backend/src/` | API、任务队列、内容提取、模型生成和复习状态 |
| `backend/scripts/` | 冒烟测试、部署检查和本地 Whisper 脚本 |
| `docs/` | 架构、隐私、支持和 App Store 文档 |
| `tools/` | 本地 PostgreSQL、工作区和 iOS 检查脚本 |

## 后端核心文件与函数

### `backend/src/flow/`：截图收藏主链路

这是当前截图输入的唯一编排目录，入口是 `index.js`：

- `index.js` / `runImageFlow(options)`：原图 -> Qwen 视觉理解 -> B站/抖音/小红书候选搜索 -> 图文或视频取源 -> 快速摘要和 3 道练习；候选不可信或跨平台歧义时停止。
- `vision.js` / `analyzeScreenshotImage(options)`：把 JPEG、PNG 或 WebP 原图直接发送给 `qwen3.7-plus-2026-05-26`，只返回平台、内容类型、标题、作者、播放器时间和定位词。
- `index.js` / `buildSearchQuery(input)`：把视觉模型返回的标题和 UP主压缩成单个高信号查询。
- `search.js` / `searchLinks(query, options)`：通过 TikHub 搜索 B站、抖音或小红书并统一返回平台、内容类型、标题、URL、作者和摘要。
- `imageFlowJobs.js`：保存短期异步进度，任务必须绑定提交截图的 `deviceId`，其他设备即使得到 UUID 也不能读取结果。

本地验证：

```bash
CAPTURE_PLATFORMS=bilibili,douyin,xiaohongshu npm --prefix backend run image-flow -- image.jpg
```

HTTP 客户端使用 `POST /api/sources/image-flow`，传 `imageBase64` 和 `mimeType`。iOS 不执行 Apple Vision OCR；生产环境也不接受服务器本地图片路径。`ocrText`/`ocrLines` 只保留给单元测试和开发诊断。

### `backend/src/env.js`

- `loadEnvFile(filePath)`：解析 `.env`，只补充尚未存在的环境变量。
- `parseEnvValue(value)`：去除首尾空白与成对引号。

加载顺序为 `backend/.env` 再根 `.env`，系统环境变量始终优先。

### `backend/src/sources/extractSourceContent.js`

- `extractSourceContent(input)`：统一入口；文本直接返回，视频进入视频提取器，公众号/网页进入文章提取器。
- `isLikelyUrl(value)`：检查 HTTP/HTTPS URL。
- `isVideoUrl(value)`：识别 Bilibili、YouTube、抖音、小红书和常见视频文件。
- `normalizeUrl(value)`：规范并校验链接。
- `isWechatArticleUrl(value)`：识别公众号链接。
- `extractWebArticle(sourceUrl)`：抓取普通网页并提取正文。
- `extractWechatArticle(sourceUrl)`：静态抓取失败时用 Playwright 兜底。
- `extractWechatArticleFromStaticHtml(sourceUrl)`：公众号快速 HTTP 路径。
- `extractArticleFromHtml(html, sourceUrl)`：移除脚本/样式噪声，提取标题与正文。
- 其余小函数负责 HTML 解码、文字清洗、超时和统一错误码。

### `backend/src/media/extractVideoLearningSource.js`

- `extractVideoLearningSource(options)`：视频主入口；检查缓存、获取元数据、字幕快路径、ASR 兜底、可选视觉理解并组装学习来源。
- `createVideoSourceProvider(sourceUrl)`：按平台选择 TikHub 或 yt-dlp。
- `enforceVideoDurationLimit(video, options)`：在下载前拒绝超时长内容。
- `downloadVideoMedia(options)`：按供应商下载视频到临时目录。
- `safelyUnderstandVideoVisuals(options)`：视觉模型失败时降级为纯字幕，不让整条收藏失败。
- `recordMediaUsage(...)` / `recordVideoSourceUsage(...)`：记录阶段耗时、供应商与缓存信息。
- 缓存、清理和 feature flag 辅助函数保证重试不会重复下载并及时删除临时文件。

### `backend/src/v2/generation/quickReviewGenerator.js`

- `generateQuickReviewPath(article, options)`：一次调用完成摘要与练习，负责缓存、并发合并、契约校验和进度上报。
- `callQuickReviewModel(context)`：构造最短可控 prompt，调用模型输出 JSON。
- `normalizeGeneratedReview(output, article, source)`：清理标题、摘要、标签和题目。
- `normalizeQuestion(question)`：校验判断题为 2 个选项、选择题为 4 个选项且答案下标有效。
- `assembleReviewPath(...)`：把简洁模型输出转换为现有 V2 chapter/review contract。
- `buildSource(article)`：复用文章或视频块，并保留时间戳等来源元数据。
- `selectTextWindow(text, limit)`：确定性保留长内容的头、中、尾。
- `fingerprint(...)`：生成与 prompt 版本绑定的 SHA-256 缓存键。
- `readResultCache(...)` / `writeResultCache(...)`：TTL + LRU 进程缓存。
- `uniqueStrings(...)` / `cleanText(...)` / `readPositiveInt(...)`：输入规范化辅助函数。

### `backend/src/generation/openaiClient.js`

- `callModelJson(request)`：按配置分发到 Qwen/OpenAI-compatible、DeepSeek 或 OpenAI。
- `resolveModelJsonProvider(env)`：显式配置优先，再按存在的 API key 推断供应商。
- `callOpenAICompatibleJson(...)`：Qwen 与兼容接口；支持纯文本或 Base64 截图输入，关闭 thinking、低温度、JSON object。
- `callDeepSeekJson(...)`：DeepSeek chat completions JSON 路径。
- `callOpenAIResponsesJson(...)`：OpenAI Responses 严格 JSON schema 路径。
- `parseModelJson(text)`：解析并修复常见 JSON 格式问题。
- `fetchWithTimeout(...)`：统一模型超时和取消。
- 其余函数处理 usage、最大 token、JSON fence 和轻量格式修复。

### `backend/src/v2/state/reviewSessionV2.js`

- `createReviewSessionV2(...)` / `normalizeReviewSessionV2(...)`：创建和恢复复习状态。
- `advanceReviewCardV2(...)` / `focusReviewUnitV2(...)`：推进卡片和进入指定单元。
- `answerQuestionV2(...)`：记录答案；错题进入本轮再次复习队列。
- `setQuestionFeedbackVisibleV2(...)`：同步反馈面板状态。
- `startReplayFromUnitV2(...)`：从任意单元开启临时复习，不覆盖主线进度。
- `openSourceFromReviewV2(...)` / `returnFromSourceToReviewV2(...)`：打开原文并返回原卡片。
- 其余私有函数负责卡片定位、step id、进度排序、错题队列和状态合并。

### `backend/src/server.js`、`worker.js`、`v2GenerationJobRunner.js`

- `server.js`：HTTP 路由、鉴权/设备、章节 CRUD、预检、收藏和复习 API。
- `worker.js`：领取数据库生成任务并调用 job runner。
- `runV2GenerationQueuedJob(...)`：文章/视频先提取来源，再调用一次快速生成并持久化结果。
- `resolveV2QueuedGenerationInput(...)`：把链接来源转换成统一文本/块结构。
- `persistV2GenerationProgress(...)`：向 iOS 暴露 accepted/extracting/generating/completed/failed 状态。

## iOS 核心文件

- `Models/ChapterInput.swift`：解析粘贴文本或 URL，识别公众号和视频平台。
- `Services/APIClient.swift`：创建章节、预检来源、轮询生成、复习与收藏请求。
- `V2/Models/V2BackendModels.swift`：后端 JSON 模型，转换为 SwiftUI 展示模型。
- `V2/Models/V2ReviewFlowModels.swift`：判断题、选择题、连线题与交互状态。
- `V2/V2RootView.swift`：App 导航、生成状态和复习会话编排；判断题复用选择题组件。
- `V2/Screens/Review/V2ReviewFlowScreens.swift`：题卡、答案反馈和继续复习界面。
- `V2/Screens/Tabs/V2TabScreens.swift`：链接/文字收藏入口和各主 Tab。

完整 API 数据契约另见 `docs/ios-api-data-contract-zh.md`。
