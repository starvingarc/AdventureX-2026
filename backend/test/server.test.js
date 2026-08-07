import assert from "node:assert/strict";
import test from "node:test";

import { createOmoServer } from "../src/server.js";
import { CardStore } from "../src/store.js";

test("health is liveness while explicit local fixture mode can become ready", async () => {
  await withServer({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1"
  }, async (baseURL) => {
    const health = await fetch(`${baseURL}/api/health`);
    const healthBody = await health.json();
    const readiness = await fetch(`${baseURL}/api/readiness`);
    const readinessBody = await readiness.json();
    const imageFlow = await fetch(`${baseURL}/api/sources/image-flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=" })
    });
    const imageFlowBody = await imageFlow.json();
    const cards = await fetch(`${baseURL}/api/memory-cards`);

    assert.equal(health.status, 200);
    assert.deepEqual(healthBody, {
      ok: true,
      service: "omo-api",
      status: "live"
    });
    assert.equal(readiness.status, 200);
    assert.equal(readinessBody.ready, true);
    assert.equal(readinessBody.checks.model.provider, "fixture");
    assert.equal(imageFlow.status, 200);
    assert.equal(imageFlowBody.card.hiddenSemantic, "再次想起");
    assert.equal(imageFlowBody.card.answer, imageFlowBody.card.hiddenSemantic);
    assert.equal(cards.headers.get("cache-control"), "no-store");
  });
});

test("production readiness and business routes fail closed on non-durable storage", async () => {
  const env = {
    NODE_ENV: "production",
    QWEN_API: "qwen-secret",
    TIKHUB_API_KEY: "tikhub-secret"
  };

  await withServer(env, async (baseURL) => {
    const readiness = await fetch(`${baseURL}/api/readiness`);
    const readinessText = await readiness.text();
    const readinessBody = JSON.parse(readinessText);
    const cards = await fetch(`${baseURL}/api/memory-cards`);
    const cardsBody = await cards.json();

    assert.equal(readiness.status, 503);
    assert.ok(readinessBody.blockers.includes("durable_storage_unavailable"));
    assert.equal(readinessText.includes("qwen-secret"), false);
    assert.equal(readinessText.includes("tikhub-secret"), false);
    assert.equal(cards.status, 503);
    assert.equal(cardsBody.code, "service_not_ready");
    assert.ok(cardsBody.blockers.includes("durable_storage_unavailable"));
  });
});

test("development image flow without Qwen returns a stable configuration error", async () => {
  await withServer({ NODE_ENV: "development" }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/sources/image-flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=" })
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.deepEqual(body, {
      code: "model_not_configured",
      message: "视觉模型尚未配置。"
    });
  });
});

test("memory-card search rejects an empty query before calling the model", async () => {
  await withServer({ NODE_ENV: "development" }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/memory-cards/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "search-owner"
      },
      body: JSON.stringify({ query: "   " })
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      code: "search_query_required",
      message: "请输入要搜索的知识。"
    });
  });
});

test("memory-card search is isolated to the request owner and returns IDs only", async () => {
  const store = new CardStore("");
  await store.save("owner-a", searchCard("owner-a-card", "认知卸载"));
  await store.save("owner-b", searchCard("owner-b-card", "private other owner content"));

  await withServer({
    NODE_ENV: "development",
    QWEN_API: "test-qwen-key",
    QWEN_BASE_URL: "https://qwen.example/v1",
    QWEN_MODEL: "qwen-test"
  }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/memory-cards/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-id": "owner-a"
      },
      body: JSON.stringify({ query: "怎么避免忘记" })
    });
    const responseText = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(responseText), {
      orderedCardIDs: ["owner-a-card"]
    });
    assert.equal(responseText.includes("认知卸载"), false);
    assert.equal(responseText.includes("private other owner content"), false);
  }, {
    store,
    searchFetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            orderedCardIDs: ["owner-b-card", "owner-a-card"]
          })
        }
      }]
    }), { status: 200 })
  });
});

test("configured PostgreSQL blocks development business routes until migrations are ready", async () => {
  const store = {
    async readiness() {
      return {
        ready: false,
        driver: "postgres",
        durable: true,
        reason: "storage_migration_required",
        appliedVersions: ["001"],
        pendingVersions: ["002"]
      };
    },
    async close() {}
  };

  await withServer({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1",
    DATABASE_URL: "postgresql://omo:secret@db.example/omo"
  }, async (baseURL) => {
    const readiness = await fetch(`${baseURL}/api/readiness`);
    const readinessText = await readiness.text();
    const cards = await fetch(`${baseURL}/api/memory-cards`);
    const cardsBody = await cards.json();

    assert.equal(readiness.status, 503);
    assert.equal(readinessText.includes("secret"), false);
    assert.equal(cards.status, 503);
    assert.equal(cardsBody.code, "service_not_ready");
    assert.ok(cardsBody.blockers.includes("storage_migration_required"));
  }, { store });
});

test("storage readiness failures are sanitized", async () => {
  const store = {
    async readiness() {
      throw new Error("postgresql://user:secret@private-host/omo");
    },
    async close() {}
  };

  await withServer({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1",
    DATABASE_URL: "postgresql://omo:secret@db.example/omo"
  }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/readiness`);
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 503);
    assert.ok(body.blockers.includes("storage_unavailable"));
    assert.equal(text.includes("private-host"), false);
    assert.equal(text.includes("secret"), false);
  }, { store });
});

test("unknown server errors are sanitized", async () => {
  const createCard = async () => {
    throw new Error("secret model payload");
  };

  await withServer({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1"
  }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/sources/image-flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=" })
    });
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(text), {
      code: "internal_error",
      message: "服务器暂时无法处理请求。"
    });
    assert.equal(text.includes("secret model payload"), false);
  }, { createCard });
});

test("invalid model-card errors expose only the stable sanitized response", async () => {
  const createCard = async () => {
    throw Object.assign(new Error("视觉模型返回的承重语义无法验证。"), {
      statusCode: 502,
      code: "model_invalid_response",
      expose: true,
      invalidCandidate: "private generated payload"
    });
  };

  await withServer({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1"
  }, async (baseURL) => {
    const response = await fetch(`${baseURL}/api/sources/image-flow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=" })
    });
    const text = await response.text();

    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(text), {
      code: "model_invalid_response",
      message: "视觉模型返回的承重语义无法验证。"
    });
    assert.equal(text.includes("private generated payload"), false);
  }, { createCard });
});

async function withServer(env, run, options = {}) {
  const server = createOmoServer({
    env,
    store: options.store || new CardStore(""),
    ...options
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseURL);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function searchCard(id, coreKnowledge) {
  return {
    id,
    coreKnowledge,
    recallCue: "你还记得什么？",
    explanation: "合成测试解释",
    sourceTitle: "合成测试来源",
    createdAt: "2026-08-08T00:00:00.000Z"
  };
}
