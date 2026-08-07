# Omo iOS API 合同

所有请求使用 JSON，并通过 `X-Device-Id` 隔离本机卡片。该请求头当前只是不透明的过渡 owner key，不是认证或可信账号边界；生产登录与授权由 #19 定义。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | Liveness；只证明服务进程可响应 |
| GET | `/api/readiness` | 模型、来源服务与存储依赖状态 |
| GET | `/api/memory-cards` | 获取当前设备的全部卡片 |
| POST | `/api/memory-cards/search` | 在当前设备卡片内进行语义排序，返回卡片 ID |
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

iOS 通过 `KnowledgeLibrarySearching` 向 `POST /api/memory-cards/search` 只提交 `{ "query": "..." }` 和既有 `X-Device-Id`。候选卡片不能由客户端提交；服务端必须先按 owner 从 Store 读取候选，再交给 Qwen 做语义相关性排序。接口只返回 `{ "orderedCardIDs": [...] }`，不得向客户端返回卡片正文、embedding、内部相似度或其他 owner 的 ID。

当前 MVP 是请求时语义重排，不维护持久化向量索引，因此文案和埋点不得把它误称为本地向量数据库。服务端会过滤未知与重复 ID并保持模型给出的稳定顺序；空查询返回 `422 search_query_required`，模型未配置返回 `503 search_not_configured`，上游失败／超时／无效结果分别使用 `search_upstream_error`、`search_timeout`、`search_invalid_response` 等脱敏稳定码。界面只映射仍存在的卡片；空结果与请求失败是不同状态，新请求必须使旧响应失效，失败时不得残留旧结果。

Debug/test 只有显式启动参数才使用确定性合成匹配器；普通 Debug 与所有 Archive/Release 均使用真实 API Adapter。

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
    "storage": {
      "required": true,
      "ready": false,
      "driver": "postgres",
      "durable": true,
      "reason": "storage_migration_required",
      "appliedVersions": ["001"],
      "pendingVersions": ["002"]
    }
  },
  "blockers": ["storage_migration_required"],
  "warnings": []
}
```

生产环境中 Qwen、TikHub 或耐久存储任一未就绪时，所有业务路由返回：

```json
{
  "code": "service_not_ready",
  "message": "服务依赖尚未就绪。",
  "blockers": ["storage_migration_required"]
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
| PostgreSQL | `DATABASE_URL`、`DATABASE_POOL_MAX`、`DATABASE_CONNECT_TIMEOUT_MS`、`DATABASE_IDLE_TIMEOUT_MS` |

`BASE_URL`、`AI_MODEL`、`MODEL_REQUEST_TIMEOUT_MS` 和误拼的 `TICKHUB_API_KEY` 只作为迁移期兼容别名，新的部署与文档不得继续使用。当前 `CARD_STORE_PATH` 指向的 JSON Store 不属于耐久生产存储；提供 `DATABASE_URL` 时不会回退 JSON，连接和顺序 migration 必须通过才能满足 storage readiness。完整迁移、导入和恢复合同见 [[docs/postgres-persistence]]。

如果运行时仍检测到兼容别名，readiness 的 `warnings` 会返回 `deprecated_environment_variable:<NAME>`；它只包含变量名，不包含变量值。

PostgreSQL 持久化使用 `(owner_id, card_id)` 作为 canonical key；重复截图不会覆盖已存在卡片的 mastery、assessment 或 schedule。assessment 的 `attemptId` 在数据库内唯一，重复提交只返回当前状态；并发更新使用行锁与版本 fencing。数据库或 migration 未就绪时业务请求返回 `service_not_ready`，驱动原始错误、连接串和 SQL 参数不会进入响应。

## iOS 运行环境合同

iOS 从生成的 Info.plist 键 `OmoAPIBaseURL` 读取真实服务地址。Debug 可使用进程环境变量 `OMO_API_BASE_URL` 覆盖，并在两者均缺失时只回退到 `http://127.0.0.1:5174`；非 Debug 构建忽略进程环境变量，只接受构建时注入的 HTTPS URL。缺失或无效配置必须显示可恢复错误，不能回退到任何历史生产域名。

知识库合成卡与 Mock 搜索仍由 `#if DEBUG` 包围，并且只有启动参数 `-OmoLibraryFixture`、`-OmoLibraryMockSearch` 或具体搜索验收参数显式出现时才启用。普通 Debug 启动与所有 Archive/Release 构建均走真实 Adapter 或明确的不可用状态，不得自动展示 Fixture 成功。

## 掌握阶段状态机

- `remembered` 推进一个掌握阶段，最高停在 `engraved`。
- `fuzzy` 可将首次复习的 `sealed` 卡片唤醒为 `awakened`，之后不再推进。
- `forgot` 不提升掌握阶段；`sealed` 卡片必须继续保持 `sealed`，并回到最短复习间隔。
