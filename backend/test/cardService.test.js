import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryCard } from "../src/cardService.js";
import { readRuntimeConfig } from "../src/runtimeConfig.js";

test("missing Qwen configuration fails instead of returning a demo success", async () => {
  const config = readRuntimeConfig({ NODE_ENV: "development" });

  await assert.rejects(
    createMemoryCard({ imageBase64: "aGVsbG8=" }, { config }),
    (error) => error.statusCode === 503 && error.code === "model_not_configured"
  );
});

test("fixture cards require an explicit non-production flag", async () => {
  const config = readRuntimeConfig({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1"
  });
  const card = await createMemoryCard({ imageBase64: "aGVsbG8=" }, { config });

  assert.equal(card.rarity, "R");
  assert.equal(card.generationMode, "fixture");
  assert.equal(card.sourceTitle, "本地 Fixture 卡");
  assert.equal(card.sourceReason, "provider_missing");
  assert.match(card.explanation, /Fixture/);
});

test("production cannot use fixture mode", async () => {
  const config = readRuntimeConfig({
    NODE_ENV: "production",
    OMO_DEMO_MODE: "1"
  });

  await assert.rejects(
    createMemoryCard({ imageBase64: "aGVsbG8=" }, { config }),
    (error) => error.statusCode === 503 && error.code === "demo_mode_forbidden"
  );
});

test("invalid Qwen timeout fails before an upstream request is attempted", async () => {
  const config = readRuntimeConfig({
    NODE_ENV: "development",
    QWEN_API: "test-qwen-key",
    QWEN_TIMEOUT_MS: "invalid"
  });
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return qwenResponse({});
  };

  await assert.rejects(
    createMemoryCard(
      { imageBase64: "aGVsbG8=" },
      { config, fetchImpl }
    ),
    (error) => error.statusCode === 503 && error.code === "model_config_invalid"
  );
  assert.equal(called, false);
});

test("creates a card from a valid Qwen response without fabricating source verification", async () => {
  const config = qwenConfig();
  const fetchImpl = async () => qwenResponse({
    coreKnowledge: "可见知识",
    recallCue: "你看到了什么？",
    answer: "可见答案",
    explanation: "仅依据截图。",
    sourceTitle: "截图标题",
    sourceAccount: "截图作者",
    platform: "bilibili",
    rarity: "SR"
  });
  const verifySourceImpl = async () => ({
    status: "screenshot_only",
    provider: "tikhub",
    platform: "bilibili",
    reason: "provider_unavailable"
  });

  const card = await createMemoryCard(
    { imageBase64: "aGVsbG8=" },
    { config, fetchImpl, verifySourceImpl }
  );

  assert.equal(card.coreKnowledge, "可见知识");
  assert.equal(card.generationMode, "qwen");
  assert.equal(card.sourceStatus, "screenshot_only");
  assert.equal(card.sourceReason, "provider_unavailable");
  assert.equal(card.rarity, "SR");
});

test("Qwen timeout maps to a stable 504 without exposing request data", async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error("aGVsbG8= should stay private"), { name: "TimeoutError" });
  };

  await assert.rejects(
    createMemoryCard(
      { imageBase64: "aGVsbG8=" },
      { config: qwenConfig(), fetchImpl }
    ),
    (error) => error.statusCode === 504
      && error.code === "model_timeout"
      && !error.message.includes("aGVsbG8=")
  );
});

test("Qwen upstream errors do not expose response bodies", async () => {
  const fetchImpl = async () => new Response(
    "upstream-secret-payload",
    { status: 401 }
  );

  await assert.rejects(
    createMemoryCard(
      { imageBase64: "aGVsbG8=" },
      { config: qwenConfig(), fetchImpl }
    ),
    (error) => error.statusCode === 502
      && error.code === "model_upstream_error"
      && !error.message.includes("upstream-secret-payload")
  );
});

test("malformed or incomplete Qwen output fails instead of using generic card fields", async () => {
  const incomplete = async () => qwenResponse({ coreKnowledge: "只有一个字段" });

  await assert.rejects(
    createMemoryCard(
      { imageBase64: "aGVsbG8=" },
      { config: qwenConfig(), fetchImpl: incomplete }
    ),
    (error) => error.statusCode === 502 && error.code === "model_invalid_response"
  );
});

function qwenConfig() {
  return readRuntimeConfig({
    NODE_ENV: "development",
    QWEN_API: "test-qwen-key",
    QWEN_BASE_URL: "https://qwen.example/v1",
    QWEN_MODEL: "qwen-test",
    QWEN_TIMEOUT_MS: "1000"
  });
}

function qwenResponse(card) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(card) } }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
