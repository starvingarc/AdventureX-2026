# Omo iOS API 合同

所有请求使用 JSON，并通过 `X-Device-Id` 隔离本机卡片。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务与模型配置状态 |
| GET | `/api/memory-cards` | 获取当前设备的全部卡片 |
| POST | `/api/sources/image-flow` | 上传 Base64 截图并生成一张卡 |
| POST | `/api/memory-cards/:id/assessments` | 提交 remembered / fuzzy / forgot |
| DELETE | `/api/memory-cards/:id` | 删除卡片 |

## MemoryCard

```json
{
  "id": "card-...",
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

`hiddenSemantic` 是 `coreKnowledge` 中非空、逐字一致的连续子串，也是主动回忆卡唯一被遮住的承重语义。`answer` 只作为旧客户端兼容镜像，与新卡的 `hiddenSemantic` 保持相同，不再驱动当前刮开交互。

服务端首次收到不满足连续子串约束的模型结果时，会使用同一截图和校验错误修复一次；第二次仍不合法则返回 502 且不持久化卡片。iOS 不从 `answer` 或正文猜测承重语义。旧记录缺少合法 `hiddenSemantic` 时仍能解码并留在知识库，但不会进入主动回忆牌组。

`sourceStatus` 为 `verified` 时表示 TickHub 候选的标题与作者均通过严格匹配；`screenshot_only` 表示没有可靠来源，只使用截图证据，并固定为 R。来源失败不等于语义合同失败：前者仍可生成截图证据卡，后者阻止错误卡片进入系统。服务端内部保存调度步数和反馈幂等标识，但不暴露给 iOS。R / SR / SSR 不参与调度。

## 掌握阶段状态机

- `remembered` 推进一个掌握阶段，最高停在 `engraved`。
- `fuzzy` 可将首次复习的 `sealed` 卡片唤醒为 `awakened`，之后不再推进。
- `forgot` 不提升掌握阶段；`sealed` 卡片必须继续保持 `sealed`，并回到最短复习间隔。
