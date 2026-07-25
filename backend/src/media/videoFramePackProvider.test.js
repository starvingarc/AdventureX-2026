import test from "node:test";
import assert from "node:assert/strict";

import {
  createNoopVideoFramePackProvider,
  createVideoFramePack,
  createVideoFramePackProvider,
  resolveVideoFramePackProviderName
} from "./videoFramePackProvider.js";

test("defaults frame pack generation to disabled", () => {
  assert.equal(resolveVideoFramePackProviderName({}), "none");
  assert.equal(resolveVideoFramePackProviderName({ VIDEO_FRAME_PROVIDER: "none" }), "none");
  assert.equal(resolveVideoFramePackProviderName({ VIDEO_FRAME_PROVIDER: "off" }), "none");
  assert.equal(resolveVideoFramePackProviderName({ VIDEO_FRAME_PROVIDER: "disabled" }), "none");
});

test("resolves crv style provider name", () => {
  assert.equal(resolveVideoFramePackProviderName({ VIDEO_FRAME_PROVIDER: "crv_style_ffmpeg" }), "crv_style_ffmpeg");
});

test("noop frame provider returns skipped frame pack", async () => {
  const provider = createVideoFramePackProvider({ env: { VIDEO_FRAME_PROVIDER: "none" } });
  const result = await provider.createFramePack({ mediaFile: { path: "/tmp/video.mp4" } });

  assert.equal(result.provider, "none");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "video_frame_pack_disabled");
  assert.deepEqual(result.frames, []);
  assert.deepEqual(result.grids, []);
});

test("normalizes custom frame provider output", async () => {
  const result = await createVideoFramePack({
    provider: {
      name: "custom",
      async createFramePack() {
        return {
          provider: "custom",
          video: { durationSeconds: 5 },
          frames: [{ id: "frame-0001", startSeconds: 0, endSeconds: 5 }],
          grids: [{ id: "grid-0001", frameIds: ["frame-0001"] }],
          debug: { keptFrameCount: 1 }
        };
      }
    }
  });

  assert.equal(result.provider, "custom");
  assert.equal(result.video.durationSeconds, 5);
  assert.equal(result.frames.length, 1);
  assert.equal(result.grids.length, 1);
  assert.equal(result.debug.keptFrameCount, 1);
});

test("rejects unsupported frame provider", () => {
  assert.throws(
    () => createVideoFramePackProvider({ env: { VIDEO_FRAME_PROVIDER: "unknown" } }),
    /暂不支持的视频抽帧供应商/
  );
});

test("rejects invalid frame provider objects", async () => {
  await assert.rejects(
    () => createVideoFramePack({ provider: {} }),
    /视频抽帧供应商未实现 createFramePack/
  );
});
