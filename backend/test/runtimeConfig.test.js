import assert from "node:assert/strict";
import test from "node:test";

import { buildReadiness, readRuntimeConfig } from "../src/runtimeConfig.js";

test("missing model configuration fails readiness by default", () => {
  const report = buildReadiness(readRuntimeConfig({ NODE_ENV: "development" }));

  assert.equal(report.ready, false);
  assert.equal(report.checks.model.provider, "none");
  assert.ok(report.blockers.includes("qwen_api_missing"));
});

test("explicit local fixture mode is ready without pretending to be Qwen", () => {
  const report = buildReadiness(readRuntimeConfig({
    NODE_ENV: "development",
    OMO_DEMO_MODE: "1"
  }));

  assert.equal(report.ready, true);
  assert.equal(report.checks.model.provider, "fixture");
  assert.equal(report.checks.source.required, false);
  assert.equal(report.checks.storage.durable, false);
});

test("production forbids fixture mode and requires TikHub and durable storage", () => {
  const report = buildReadiness(readRuntimeConfig({
    NODE_ENV: "production",
    OMO_DEMO_MODE: "true"
  }));

  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("demo_mode_forbidden"));
  assert.ok(report.blockers.includes("qwen_api_missing"));
  assert.ok(report.blockers.includes("tikhub_api_key_missing"));
  assert.ok(report.blockers.includes("durable_storage_unavailable"));
});

test("invalid provider URLs and timeouts are explicit readiness blockers", () => {
  const report = buildReadiness(readRuntimeConfig({
    NODE_ENV: "production",
    QWEN_API: "qwen-secret",
    QWEN_BASE_URL: "file:///tmp/qwen",
    QWEN_TIMEOUT_MS: "not-a-number",
    TIKHUB_API_KEY: "tikhub-secret",
    TIKHUB_BASE_URL: "not-a-url",
    TIKHUB_TIMEOUT_MS: "0"
  }));

  assert.deepEqual(report.blockers, [
    "qwen_base_url_invalid",
    "qwen_timeout_invalid",
    "tikhub_base_url_invalid",
    "tikhub_timeout_invalid",
    "durable_storage_unavailable"
  ]);
});

test("legacy aliases remain compatible but are reported by name only", () => {
  const config = readRuntimeConfig({
    BASE_URL: "https://legacy-qwen.example/v1",
    AI_MODEL: "legacy-model",
    MODEL_REQUEST_TIMEOUT_MS: "3210",
    TICKHUB_API_KEY: "legacy-secret"
  });

  assert.equal(config.qwen.baseURL, "https://legacy-qwen.example/v1");
  assert.equal(config.qwen.model, "legacy-model");
  assert.equal(config.qwen.timeoutMs, 3210);
  assert.equal(config.tikhub.configured, true);
  assert.deepEqual(config.deprecatedEnvironmentVariables, [
    "BASE_URL",
    "AI_MODEL",
    "MODEL_REQUEST_TIMEOUT_MS",
    "TICKHUB_API_KEY"
  ]);
  const report = buildReadiness(config);
  assert.deepEqual(report.warnings, [
    "deprecated_environment_variable:BASE_URL",
    "deprecated_environment_variable:AI_MODEL",
    "deprecated_environment_variable:MODEL_REQUEST_TIMEOUT_MS",
    "deprecated_environment_variable:TICKHUB_API_KEY"
  ]);
  assert.equal(JSON.stringify(report).includes("legacy-secret"), false);
});
