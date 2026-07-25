import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  configureScreenshotE2EFixture,
  isScreenshotE2EFixtureEnabled
} from "./e2eScreenshotFixture.js";
import { runImageFlow } from "./index.js";

const BILIBILI_SCREENSHOT = await readFile(
  new URL("../../test-fixtures/capture-gallery/bilibili-recall.png", import.meta.url)
);
const DOUYIN_SCREENSHOT = await readFile(
  new URL("../../test-fixtures/capture-gallery/douyin-spacing.png", import.meta.url)
);
const TEST_ENV = { NODE_ENV: "test", RECALLO_E2E_FIXTURE_MODE: "1" };

test("enables the screenshot fixture only for an explicit test process", () => {
  assert.equal(isScreenshotE2EFixtureEnabled(TEST_ENV), true);
  assert.equal(isScreenshotE2EFixtureEnabled({
    NODE_ENV: "production",
    RECALLO_E2E_FIXTURE_MODE: "1"
  }), false);
  assert.equal(isScreenshotE2EFixtureEnabled({
    NODE_ENV: "test",
    RECALLO_E2E_FIXTURE_MODE: "0"
  }), false);

  const productionInput = { imageBase64: "aGVsbG8=", mimeType: "image/png" };
  assert.strictEqual(
    configureScreenshotE2EFixture(productionInput, {
      env: { NODE_ENV: "production", RECALLO_E2E_FIXTURE_MODE: "1" }
    }),
    productionInput
  );
});

test("maps manifest screenshots from plain base64 and data URLs to their platform", async () => {
  const bilibili = await runImageFlow(configureScreenshotE2EFixture({
    imageBase64: BILIBILI_SCREENSHOT.toString("base64"),
    mimeType: "image/png"
  }, { env: TEST_ENV, delayMs: 0 }));
  assert.equal(bilibili.status, "completed");
  assert.equal(bilibili.capture.identity.platform, "bilibili");
  assert.equal(bilibili.source.platform, "bilibili");
  assert.deepEqual(
    bilibili.captureAnalysis.memoryCard.sourceEvidenceIds,
    ["fixture-bilibili-evidence-1"]
  );
  assert.ok(Date.parse(bilibili.schedule.nextReviewAt) <= Date.now());

  const douyin = await runImageFlow(configureScreenshotE2EFixture({
    imageBase64: `data:image/png;base64,${DOUYIN_SCREENSHOT.toString("base64")}`,
    mimeType: ""
  }, { env: TEST_ENV, delayMs: 0 }));
  assert.equal(douyin.status, "completed");
  assert.equal(douyin.capture.identity.platform, "douyin");
  assert.equal(douyin.source.platform, "douyin");
  assert.deepEqual(
    douyin.captureAnalysis.memoryCard.sourceEvidenceIds,
    ["fixture-douyin-evidence-1"]
  );
  assert.ok(Date.parse(douyin.schedule.nextReviewAt) <= Date.now());
});

test("rejects unknown or malformed images instead of impersonating a gallery fixture", () => {
  assert.throws(
    () => configureScreenshotE2EFixture({
      imageBase64: Buffer.from("not-a-gallery-image").toString("base64"),
      mimeType: "image/png"
    }, { env: TEST_ENV, delayMs: 0 }),
    (error) => error?.code === "screenshot_e2e_fixture_unknown"
  );
  assert.throws(
    () => configureScreenshotE2EFixture({ imageBase64: "%%%" }, {
      env: TEST_ENV,
      delayMs: 0
    }),
    (error) => error?.code === "screenshot_e2e_fixture_invalid"
  );
});
