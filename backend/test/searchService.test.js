import assert from "node:assert/strict";
import test from "node:test";

import { readRuntimeConfig } from "../src/runtimeConfig.js";
import { searchMemoryCards } from "../src/searchService.js";

test("semantic search returns only stable unique candidate IDs", async () => {
  const response = await searchMemoryCards({
    query: "如何避免认知卸载",
    cards: [
      searchCard("owner-card-a", "截图可能触发认知卸载"),
      searchCard("owner-card-b", "主动提取可以强化记忆")
    ]
  }, {
    config: qwenConfig(),
    fetchImpl: async () => qwenResponse({
      orderedCardIDs: [
        "owner-card-b",
        "other-owner-card",
        "owner-card-b",
        "owner-card-a"
      ]
    })
  });

  assert.deepEqual(response, {
    orderedCardIDs: ["owner-card-b", "owner-card-a"]
  });
});

test("semantic search maps upstream failure and timeout to safe recoverable errors", async () => {
  await assert.rejects(
    searchMemoryCards({
      query: "认知卸载",
      cards: [searchCard("card-a", "认知卸载")]
    }, {
      config: qwenConfig(),
      fetchImpl: async () => new Response("private upstream payload", { status: 500 })
    }),
    (error) => error.statusCode === 502
      && error.code === "search_upstream_error"
      && !error.message.includes("private upstream payload")
  );

  await assert.rejects(
    searchMemoryCards({
      query: "认知卸载",
      cards: [searchCard("card-a", "认知卸载")]
    }, {
      config: qwenConfig(),
      fetchImpl: async () => {
        throw Object.assign(new Error("private query"), { name: "TimeoutError" });
      }
    }),
    (error) => error.statusCode === 504
      && error.code === "search_timeout"
      && !error.message.includes("private query")
  );
});

test("semantic search rejects malformed model output without returning card content", async () => {
  await assert.rejects(
    searchMemoryCards({
      query: "认知卸载",
      cards: [searchCard("card-a", "private card body")]
    }, {
      config: qwenConfig(),
      fetchImpl: async () => qwenResponse({ answer: "private card body" })
    }),
    (error) => error.statusCode === 502
      && error.code === "search_invalid_response"
      && !error.message.includes("private card body")
  );
});

function qwenConfig() {
  return readRuntimeConfig({
    NODE_ENV: "development",
    QWEN_API: "test-qwen-key",
    QWEN_BASE_URL: "https://qwen.example/v1",
    QWEN_MODEL: "qwen-test",
    QWEN_TIMEOUT_MS: "5000"
  });
}

function qwenResponse(result) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function searchCard(id, coreKnowledge) {
  return {
    id,
    coreKnowledge,
    hiddenSemantic: "认知卸载",
    recallCue: "为什么截图会影响记忆？",
    answer: "认知卸载",
    explanation: "设备替代了主动编码。",
    sourceTitle: "合成测试来源",
    sourceAccount: "",
    sourcePlatform: "unknown",
    sourceUrl: "",
    sourceStatus: "screenshot_only",
    sourceProvider: "",
    sourceConfidence: 0,
    rarity: "R",
    createdAt: "2026-08-08T00:00:00.000Z",
    masteryStage: "sealed",
    nextReviewAt: "2026-08-08T00:00:00.000Z",
    reviewCount: 0,
    successfulRecallCount: 0,
    lastAssessment: null
  };
}
