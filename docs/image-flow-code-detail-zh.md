# 三平台截图收藏链路

本文描述当前已进入代码的 B站、抖音和小红书截图 adapter。

## 1. 用户链路

```text
iOS 选择或分享截图
  -> POST /api/sources/image-flow
  -> Qwen 视觉模型读取平台、内容类型、标题、作者和可见文字
  -> TikHub 对应平台站内搜索
  -> 平台、标题与作者严格匹配
  -> 视频：平台字幕优先，无字幕时才进行音频 ASR
  -> 小红书图文：读取公开正文
  -> 定位截图对应的内容窗口
  -> 一次模型调用生成摘要、1 道判断题和 2 道选择题
```

截图不会先经过 Apple Vision、PaddleOCR 或 Tesseract。这样避免客户端和服务端
分别维护 OCR 规则，也能保留画面布局、播放器 UI 和字幕之间的关系。

## 2. HTTP 输入

接口：

```http
POST /api/sources/image-flow
Content-Type: application/json
X-Device-Id: <installation id>
```

请求字段：

| 字段 | 说明 |
|---|---|
| `imageBase64` | JPEG、PNG 或 WebP 的 Base64，亦可传完整 Data URL |
| `mimeType` | 原始 Base64 没有 Data URL 前缀时必填 |
| `sourceUrl` | 可选；接受 B站、抖音或小红书公开链接 |
| `async` | 为 `true` 时返回可轮询任务 |
| `includeDetails` | 仅用于受控诊断，不应在普通客户端开启 |

JSON 请求体上限默认 8 MiB；解码后的图片上限默认 6 MiB。图片内容不会写入固定
`/tmp` 路径。开发模式的命令行入口可以传本地路径，但生产 HTTP 路由会忽略
`imagePath`。

## 3. 视觉理解

`backend/src/flow/vision.js` 调用统一模型客户端，默认模型是
`qwen3.7-plus-2026-05-26`。输出合同只允许：

- `platform`: `bilibili`、`douyin`、`xiaohongshu` 或 `unknown`；
- `contentKind`: `video`、`image_text` 或 `unknown`；
- `title`: 截图中逐字可见的标题；
- `account`: 截图中逐字可见的作者或账号；
- `timestampSeconds`: 播放器当前进度；
- `locatorTerms`: 可在字幕中定位当前片段的短句；
- `visibleTextLines`: 有意义的可见文字；
- `confidence`: 0 到 1。

Prompt 明确把截图视为不可信材料，禁止执行画面中的指令，也禁止猜测不可见标题
或作者。平台已知时只调用对应 adapter；平台不明时允许在已启用平台间受控搜索，
但不同平台存在分数接近的同名候选时会阻断，不会自动选一个。

## 4. 来源搜索

`backend/src/flow/search.js` 默认读取：

```dotenv
CAPTURE_PLATFORMS=bilibili,douyin,xiaohongshu
TIKHUB_API_KEY=
TIKHUB_CONTENT_ENABLED=1
```

标题和作者会压缩为一个高信号查询。候选结果先按平台和账号做硬过滤，再按照
标题、账号和平台加权匹配，低于阈值时返回 `search_match_low_confidence`。模型
不能直接决定最终 URL。`CAPTURE_PLATFORMS` 仍可按部署需要关闭任一 adapter。

## 5. 视频取源

视频处理顺序：

1. 读取平台字幕元数据；
2. 优先 `zh-CN`，其次 `ai-zh`、`zh-Hans`、`zh`、`source`、`en-US`；
3. 没有字幕时尝试平台 adapter 提供的媒体流；
4. Qwen Filetrans 可访问时直接转写；
5. 平台 CDN 拒绝时才下载音频并提供一次性临时 URL；
6. 本地 Faster-Whisper 只作为离线兜底。

当视觉模型得到播放器时间时，`source.js` 默认保留前后 45 秒的字幕块；没有时间
时使用 `locatorTerms` 在带时间戳字幕中定位。生成截图复习卡只读取这个局部窗口，
全片概览读取有界的完整字幕。

## 6. 异步任务边界

`imageFlowJobs.js` 的任务具有一小时 TTL，并绑定创建任务的 `deviceId`。轮询同一
UUID 时设备不匹配会返回未找到。任务结果当前仍在进程内保存，适合单实例 MVP；
多实例部署前应迁移到现有 PostgreSQL 任务表。

小红书 `image_text` 不进入视频下载和 ASR，而是通过 TikHub 读取公开标题、正文
和作者。截图链路可强制使用这个已核验的平台 adapter，但仍要求服务端配置
`TIKHUB_API_KEY`。

## 7. 当前边界

- 当前承诺 B站、抖音和小红书公开内容截图；
- 截图入口尚未替代链接/文字收藏入口；
- TikHub 找不到可信来源时不会强行生成；
- 超长视频仍受 `VIDEO_MAX_DURATION_SECONDS` 限制；
- 图片原文、模型原始响应和 API Key 不应写入日志；
- `.env.example` 只能保存空占位符，真实密钥必须由部署环境注入。

Apple Vision/OCR 可在以后作为 iOS 端低置信度提示或无网降级实验，但不属于当前
主链，也不能替代平台、内容类型和界面关系的视觉判断。截图本身不写入临时目录；
只有无字幕视频的音频 ASR 兜底会使用现有的随机临时文件与一次性 URL，并在任务
结束后清理。
