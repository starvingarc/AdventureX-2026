# Omo iOS API 合同

所有请求使用 JSON，并通过 `X-Device-Id` 隔离本机卡片。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | Liveness；只证明服务进程可响应 |
| GET | `/api/readiness` | 模型、来源服务与存储依赖状态 |
| GET | `/api/memory-cards` | 获取当前设备的全部卡片 |
| POST | `/api/sources/image-flow` | 上传 Base64 截图并生成一张卡 |
| POST | `/api/memory-cards/:id/assessments` | 提交 remembered / fuzzy / forgot |
| DELETE | `/api/memory-cards/:id` | 删除卡片 |

所有 JSON 响应均返回 `Cache-Control: no-store`；iOS 客户端也使用忽略本地缓存的请求策略，避免上传或自评后继续读取旧卡片列表。

## MemoryCard

```json
{
  "id": "card-...",
  "generationMode": "qwen",
  "coreKnowledge": "截图可能削弱记忆，因为它会触发认知卸载。",
  "hiddenSemantic": "认知卸载",
  "recallCue": "主动回忆提示",
  "answer": "认知卸载",
  "explanation": "简短解释",
  "sourceTitle": "【巫师】财经跨年：中国财经年度盘点Top10",
  "sourceAccount": "巫师财经",
  "sourcePlatform": "bilibili",
  "sourceUrl": "https://www.bilibili.com/video/av115774081537379",
  "sourceStatus": "verified",
  "sourceProvider": "tikhub",
  "sourceReason": "",
  "sourceConfidence": 1,
  "rarity": "R",
  "createdAt": "2026-07-29T00:00:00.000Z",
  "masteryStage": "sealed",
  "nextReviewAt": "2026-07-29T00:00:00.000Z",
  "reviewCount": 0,
  "successfulRecallCount": 0,
  "lastAssessment": null
}
```

新生成卡片的 `hiddenSemantic` 必须非空，并且是 `coreKnowledge` 中字符完全一致的连续子串；它是主动回忆时唯一被遮住的承重语义。`answer` 暂时为旧客户端保留，新卡固定镜像 `hiddenSemantic`，不得成为另一份答案。旧记录缺少合法 `hiddenSemantic` 时仍可被 iOS 解码并在知识库完整展示，但不进入主动回忆牌组。

## 知识库搜索客户端合同

iOS 通过 `KnowledgeLibrarySearching` 提交查询和当前用户已加载卡片构成的候选文档，接收按相关性排序的卡片 ID。界面只映射仍存在、属于候选集合且未重复的 ID；空结果与请求失败是不同状态，新请求必须使旧响应失效。

当前没有生产搜索 Endpoint。Debug/test 可显式注入确定性合成匹配器用于页面验收；Release 使用不可用 Adapter 并显示可恢复错误，不得把本地匹配称为向量或语义搜索。未来后端接入时必须保证用户隔离、增删索引一致性、取消／超时、稳定排序，并且不向客户端返回 embedding、内部相似度或其他用户的卡片。

语音入口只把 Apple Speech 的最终转写文本交给同一搜索合同，不保存原始音频。原始查询、转写文本和卡片全文不得直接进入分析事件。

`generationMode` 为 `qwen` 时表示来自模型 Adapter，为 `fixture` 时表示非生产环境显式开启的固定测试结果。`sourceStatus` 为 `verified` 时表示 TikHub 候选的标题与作者均通过严格匹配；`screenshot_only` 表示没有可靠来源，只使用截图证据，且稀有度固定为 R。`sourceReason` 使用 `provider_missing`、`provider_timeout`、`provider_unavailable`、`provider_invalid_response`、`provider_rejected`、`identity_incomplete` 或 `strict_match_not_found` 区分原因；任何失败都不能返回 `verified`。服务端内部保存调度步数和反馈幂等标识，但不暴露给 iOS。R / SR / SSR 不参与调度。

模型首次返回字段缺失或 `hiddenSemantic` 不满足连续子串合同时，服务端使用同一截图和校验原因修复一次；第二次仍不合法则返回脱敏的 `502 model_invalid_response`，不验证来源、不保存卡片，也不允许客户端自行猜词。

## Liveness、readiness 与运行模式

`GET /api/health` 固定返回进程级 liveness，不包含密钥或“生产已就绪”结论：

```json
{
  "ok": true,
  "service": "omo-api",
  "status": "live"
}
```

`GET /api/readiness` 使用 HTTP 200 / 503 表达整体状态，并只返回安全的依赖名称与阻塞码：

```json
{
  "ready": false,
  "service": "omo-api",
  "mode": "production",
  "checks": {
    "model": { "required": true, "ready": true, "provider": "qwen" },
    "source": { "required": true, "ready": true, "provider": "tikhub" },
    "storage": { "required": true, "ready": false, "driver": "json", "durable": false }
  },
  "blockers": ["durable_storage_unavailable"],
  "warnings": []
}
```

生产环境中 Qwen、TikHub 或耐久存储任一未就绪时，所有业务路由返回：

```json
{
  "code": "service_not_ready",
  "message": "生产依赖尚未就绪。",
  "blockers": ["durable_storage_unavailable"]
}
```

非生产环境也不会因缺少 `QWEN_API` 自动生成演示卡；默认返回 `503 model_not_configured`。只有显式设置 `OMO_DEMO_MODE=1` 或 `true` 才使用本地 Fixture，且其结果必须标记为 Fixture。生产环境设置该开关会返回 `demo_mode_forbidden`。

模型错误使用稳定码：配置缺失/无效为 `model_not_configured` / `model_config_invalid`，网络失败为 `model_unavailable`，上游非成功响应为 `model_upstream_error`，超时为 `model_timeout`，无效 Schema 为 `model_invalid_response`。服务端不向客户端返回上游正文、截图 Base64、密钥或完整模型载荷。

## 环境变量合同

| 能力 | Canonical 环境变量 |
|---|---|
| 运行模式 | `NODE_ENV`、`OMO_DEMO_MODE` |
| Qwen | `QWEN_API`、`QWEN_BASE_URL`、`QWEN_MODEL`、`QWEN_TIMEOUT_MS` |
| TikHub | `TIKHUB_API_KEY`、`TIKHUB_BASE_URL`、`TIKHUB_TIMEOUT_MS` |
| 本地 JSON Store | `CARD_STORE_PATH` |

`BASE_URL`、`AI_MODEL`、`MODEL_REQUEST_TIMEOUT_MS` 和误拼的 `TICKHUB_API_KEY` 只作为迁移期兼容别名，新的部署与文档不得继续使用。当前 `CARD_STORE_PATH` 指向的 JSON Store 不属于耐久生产存储；不得把 `DATABASE_URL` 等尚未接入的变量写成已支持。

如果运行时仍检测到兼容别名，readiness 的 `warnings` 会返回 `deprecated_environment_variable:<NAME>`；它只包含变量名，不包含变量值。

## 掌握阶段状态机

- `remembered` 推进一个掌握阶段，最高停在 `engraved`。
- `fuzzy` 可将首次复习的 `sealed` 卡片唤醒为 `awakened`，之后不再推进。
- `forgot` 不提升掌握阶段；`sealed` 卡片必须继续保持 `sealed`，并回到最短复习间隔。
