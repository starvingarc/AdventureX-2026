import assert from "node:assert/strict";
import test from "node:test";

import { buildServiceCapabilities } from "../serviceCapabilities.js";

test("service health exposes production-critical V2 capabilities", () => {
  const capabilities = buildServiceCapabilities({ CAPTURE_PLATFORMS: "bilibili" });

  assert.equal(capabilities.legacyChapterGeneration, true);
  assert.equal(capabilities.v2ChapterGeneration, true);
  assert.equal(capabilities.v2ReviewSessions, true);
  assert.equal(capabilities.favoriteQuestions, true);
  assert.equal(capabilities.notifications, true);
  assert.equal(capabilities.sourceAnchors, true);
  assert.equal(capabilities.screenshotCapture.inputMode, "direct_image");
  assert.equal(capabilities.screenshotCapture.platforms.bilibili.enabled, true);
  assert.equal(capabilities.screenshotCapture.platforms.douyin.enabled, false);
  assert.equal(capabilities.screenshotCapture.platforms.xiaohongshu.enabled, false);
  assert.equal(capabilities.sources.sourceTypes.text.enabled, true);
  assert.equal(capabilities.sources.sourceTypes.video_link.enabled, true);
  assert.equal(capabilities.sources.sourceTypes.video_link.maxDurationSeconds, 900);
  assert.equal(capabilities.sources.sourceTypes.video_link.platforms.douyin.provider, "tikhub");
  assert.equal(capabilities.sources.sourceTypes.video_link.platforms.bilibili.provider, "bilibili-api");
  assert.equal(capabilities.sources.sourceEnrichment.enabled, false);
  assert.equal(capabilities.sources.sourceEnrichment.provider, "tikhub");
  assert.equal(capabilities.sources.sourceEnrichment.blocking, false);
  assert.equal(capabilities.sources.sourceEnrichment.platforms.xiaohongshu.enabled, true);
});

test("enables all completed screenshot adapters by default", () => {
  const capabilities = buildServiceCapabilities({});
  assert.equal(capabilities.screenshotCapture.platforms.bilibili.enabled, true);
  assert.equal(capabilities.screenshotCapture.platforms.douyin.enabled, true);
  assert.equal(capabilities.screenshotCapture.platforms.xiaohongshu.enabled, true);
});

test("allows deployments to disable every screenshot adapter explicitly", () => {
  const capabilities = buildServiceCapabilities({ CAPTURE_PLATFORMS: "" });
  assert.equal(capabilities.screenshotCapture.platforms.bilibili.enabled, false);
  assert.equal(capabilities.screenshotCapture.platforms.douyin.enabled, false);
  assert.equal(capabilities.screenshotCapture.platforms.xiaohongshu.enabled, false);
});
