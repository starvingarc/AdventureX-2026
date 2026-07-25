import assert from "node:assert/strict";
import test from "node:test";

import {
  createNoopVisualUnderstandingProvider,
  createVisualUnderstandingProvider,
  resolveVisualUnderstandingProviderName,
  understandVideoVisuals
} from "./visualUnderstandingProvider.js";

test("defaults video visual understanding to disabled", () => {
  assert.equal(resolveVisualUnderstandingProviderName({}), "none");
  assert.equal(resolveVisualUnderstandingProviderName({ VIDEO_VISUAL_PROVIDER: "none" }), "none");
  assert.equal(resolveVisualUnderstandingProviderName({ VIDEO_VISUAL_PROVIDER: "off" }), "none");
  assert.equal(resolveVisualUnderstandingProviderName({ VIDEO_VISUAL_PROVIDER: "disabled" }), "none");
  assert.equal(resolveVisualUnderstandingProviderName({ VIDEO_VISUAL_PROVIDER: "qwen-vl" }), "qwen-vl");
});

test("creates Qwen VL visual understanding provider", () => {
  const provider = createVisualUnderstandingProvider({
    env: {
      VIDEO_VISUAL_PROVIDER: "qwen-vl",
      QWEN_API_KEY: "test-key",
      VIDEO_VISUAL_MODEL: "qwen3-vl-flash"
    }
  });

  assert.equal(provider.name, "qwen-vl");
  assert.equal(provider.model, "qwen3-vl-flash");
});

test("explicit no-op provider returns no visual segments", async () => {
  const result = await understandVideoVisuals({
    provider: createNoopVisualUnderstandingProvider(),
    video: { platform: "douyin" },
    mediaFile: { path: "/tmp/video.mp4" },
    transcriptSegments: [{ text: "音频转写" }]
  });

  assert.equal(result.provider, "none");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "visual_understanding_disabled");
  assert.deepEqual(result.segments, []);
});

test("normalizes visual provider segments into LearningSource-compatible shape", async () => {
  const result = await understandVideoVisuals({
    provider: {
      name: "mock-vision",
      understandVideo: async () => ({
        provider: "mock-vision",
        model: "mock-vl",
        usage: { prompt_tokens: "120", completion_tokens: 30, total_tokens: 150 },
        segments: [
          {
            startSeconds: "1.5",
            endSeconds: 4,
            summary: "  白板上展示了用户问题到实验假设的映射流程。  ",
            confidence: "0.8"
          },
          { text: " " }
        ]
      })
    }
  });

  assert.equal(result.provider, "mock-vision");
  assert.equal(result.model, "mock-vl");
  assert.deepEqual(result.usage, { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
  assert.equal(result.skipped, false);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].id, "visual-001");
  assert.equal(result.segments[0].text, "白板上展示了用户问题到实验假设的映射流程。");
  assert.equal(result.segments[0].confidence, 0.8);
});

test("normalizes Qwen-style visual usage while preserving provider fields", async () => {
  const result = await understandVideoVisuals({
    provider: {
      name: "mock-vision",
      understandVideo: async () => ({
        provider: "mock-vision",
        model: "mock-vl",
        usage: { input_tokens: "100", output_tokens: 20, total_tokens: 120 },
        segments: []
      })
    }
  });

  assert.deepEqual(result.usage, {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    input_tokens: 100,
    output_tokens: 20
  });
});

test("forwards frame pack to concrete visual provider", async () => {
  let received = null;
  const result = await understandVideoVisuals({
    provider: {
      name: "fake-vision",
      async understandVideo(input) {
        received = input;
        return { provider: "fake-vision", segments: [] };
      }
    },
    framePack: { provider: "crv_style_ffmpeg", frames: [{ id: "frame-0001" }], grids: [] }
  });

  assert.equal(received.framePack.provider, "crv_style_ffmpeg");
  assert.equal(received.framePack.frames.length, 1);
  assert.equal(result.provider, "fake-vision");
});

test("rejects unsupported configured visual understanding providers", () => {
  assert.throws(
    () => createVisualUnderstandingProvider({ env: { VIDEO_VISUAL_PROVIDER: "gemini-video" } }),
    /暂不支持的视频画面理解供应商：gemini-video/
  );
});
