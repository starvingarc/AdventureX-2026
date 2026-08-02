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
    store: new CardStore(""),
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
