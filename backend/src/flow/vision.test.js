import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeUnsourcedScreenshotImage,
  analyzeScreenshotImage,
  normalizeScreenshotIdentity
} from "./vision.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("sends the screenshot directly to the configured vision model", async () => {
  let request = null;
  const result = await analyzeScreenshotImage({
    imageBase64: ONE_PIXEL_PNG,
    mimeType: "image/png",
    modelJsonCaller: async (input) => {
      request = input;
      return {
        platform: "bilibili",
        contentKind: "video",
        title: "如何建立长期记忆",
        account: "学习博主",
        timestampSeconds: 42,
        locatorTerms: ["主动回忆", "间隔重复"],
        visibleTextLines: ["学习博主", "如何建立长期记忆", "00:42 / 12:30"],
        confidence: 0.94
      };
    }
  });

  assert.equal(request.stage, "screenshot_identity");
  assert.equal(request.provider, "qwen");
  assert.equal(request.model, "qwen3.7-plus-2026-05-26");
  assert.match(request.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(result.provider, "qwen-vision");
  assert.equal(result.identity.platform, "bilibili");
  assert.equal(result.identity.contentKind, "video");
  assert.equal(result.identity.timestampSeconds, 42);
});

test("normalizes Douyin screenshots without inventing source details", () => {
  const identity = normalizeScreenshotIdentity({
    platform: "douyin",
    contentKind: "video",
    title: "可见标题",
    account: "",
    timestampSeconds: "invalid",
    locatorTerms: [],
    visibleTextLines: ["可见标题"],
    confidence: 2
  });
  assert.equal(identity.platform, "douyin");
  assert.equal(identity.contentKind, "video");
  assert.equal(identity.timestampSeconds, null);
  assert.equal(identity.confidence, 1);
});

test("does not treat a publication date as a player timestamp", () => {
  const identity = normalizeScreenshotIdentity({
    platform: "bilibili",
    contentKind: "video",
    title: "可见标题",
    account: "作者",
    timestampSeconds: 1_782_964_380,
    locatorTerms: [],
    visibleTextLines: ["2026年7月1日19:53", "可见标题"],
    confidence: 0.9
  });
  assert.equal(identity.timestampSeconds, null);
});

test("retries screenshot vision once when structured JSON is incomplete", async () => {
  let calls = 0;
  const result = await analyzeScreenshotImage({
    imageBase64: ONE_PIXEL_PNG,
    mimeType: "image/png",
    modelJsonCaller: async () => {
      calls += 1;
      if (calls === 1) throw new Error("模型返回内容不是可解析 JSON，请重试。");
      return {
        platform: "douyin",
        contentKind: "video",
        title: "第二次返回完整结果",
        account: "测试作者",
        timestampSeconds: null,
        locatorTerms: [],
        visibleTextLines: ["第二次返回完整结果"],
        confidence: 0.9
      };
    }
  });

  assert.equal(calls, 2);
  assert.equal(result.identity.platform, "douyin");
  assert.equal(result.identity.title, "第二次返回完整结果");
});

test("allows an unknown platform without inventing a title", () => {
  const identity = normalizeScreenshotIdentity({
    platform: "unknown",
    contentKind: "unknown",
    title: "",
    account: "",
    timestampSeconds: null,
    locatorTerms: [],
    visibleTextLines: [],
    confidence: 0
  });
  assert.equal(identity.platform, "unknown");
  assert.equal(identity.title, "");
});

test("rejects unsupported or oversized screenshot payloads", async () => {
  await assert.rejects(
    analyzeScreenshotImage({
      imageBase64: "not-base64",
      mimeType: "image/gif",
      modelJsonCaller: async () => ({})
    }),
    (error) => error.code === "screenshot_image_invalid"
  );

  await assert.rejects(
    analyzeScreenshotImage({
      imageBase64: Buffer.alloc(32).toString("base64"),
      mimeType: "image/png",
      maxImageBytes: 16,
      modelJsonCaller: async () => ({})
    }),
    (error) => error.code === "screenshot_image_too_large"
  );
});

test("uses qwen3-vl-plus to ground an unsourced screenshot without inventing a link", async () => {
  let request = null;
  const result = await analyzeUnsourcedScreenshotImage({
    imageBase64: ONE_PIXEL_PNG,
    mimeType: "image/png",
    ocrText: "截图中的辅助文字",
    modelJsonCaller: async (input) => {
      request = input;
      return {
        title: "截图主题",
        account: "截图作者",
        platform: "douyin",
        summary: "画面展示一个可以被复习的核心观点，并给出明确解释。",
        keyPoints: ["要点一来自画面", "要点二来自画面"],
        tags: ["截图", "复习"]
      };
    }
  });

  assert.equal(request.model, "qwen3-vl-plus");
  assert.equal(request.stage, "unsourced_screenshot");
  assert.match(request.system, /不得生成或猜测 URL/);
  assert.match(request.imageDataUrl, /^data:image\/png;base64,/);
  assert.equal(result.summary, "画面展示一个可以被复习的核心观点，并给出明确解释。");
  assert.deepEqual(result.keyPoints, ["要点一来自画面", "要点二来自画面"]);
});
