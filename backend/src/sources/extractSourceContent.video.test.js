import assert from "node:assert/strict";
import test from "node:test";

import { extractSourceContent, isVideoUrl } from "./extractSourceContent.js";

test("classifies universal video URLs before article extraction", () => {
  assert.equal(isVideoUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isVideoUrl("https://youtu.be/abc"), true);
  assert.equal(isVideoUrl("https://www.bilibili.com/video/BV1demo"), true);
  assert.equal(isVideoUrl("https://b23.tv/abc"), true);
  assert.equal(isVideoUrl("https://cdn.example.com/lesson.mp4"), true);
  assert.equal(isVideoUrl("https://example.com/article/1"), false);
});

test("extracts video links into V2-compatible source content", async () => {
  const source = await extractSourceContent({
    sourceType: "video_link",
    sourceUrl: "https://v.douyin.com/abc/",
    sourceTitle: "抖音视频"
  }, {
    extractVideoLearningSource: async () => ({
      sourceType: "video_link",
      platform: "douyin",
      title: "AI 产品调研",
      url: "https://v.douyin.com/abc/",
      account: "产品老张",
      author: "产品老张",
      durationSeconds: 60,
      normalizedText: "平台文案：AI 产品调研流程，先明确用户问题，再整理主题。\n\n先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。",
      sourceSections: [
        {
          id: "video-platform-description",
          sourceRole: "platform_description",
          text: "平台文案：AI 产品调研流程，先明确用户问题，再整理主题。"
        },
        {
          id: "transcript-001",
          sourceRole: "audio_transcript",
          startSeconds: 0,
          endSeconds: 4,
          text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。"
        }
      ],
      media: { provider: "tikhub", providerContentId: "douyin-1" }
    })
  });

  assert.equal(source.sourceType, "video_link");
  assert.equal(source.sourceTitle, "AI 产品调研");
  assert.equal(source.sourceAccount, "产品老张");
  assert.equal(source.platform, "douyin");
  assert.match(source.rawText, /先明确用户问题/);
  assert.equal(source.blocks.length, 2);
  assert.equal(source.blocks[1].startSeconds, 0);
  assert.equal(source.source.type, "video_link");
});
