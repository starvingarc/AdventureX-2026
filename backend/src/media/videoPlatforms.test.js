import assert from "node:assert/strict";
import test from "node:test";

import {
  detectVideoPlatform,
  isTikHubPreferredPlatform,
  isYtDlpPreferredPlatform,
  normalizeVideoSourceUrl
} from "./videoPlatforms.js";

test("detects Douyin hosts", () => {
  assert.equal(detectVideoPlatform("https://v.douyin.com/abc/"), "douyin");
  assert.equal(detectVideoPlatform("https://www.douyin.com/video/123"), "douyin");
  assert.equal(detectVideoPlatform("https://www.iesdouyin.com/share/video/123"), "douyin");
});

test("detects Xiaohongshu hosts", () => {
  assert.equal(detectVideoPlatform("https://www.xiaohongshu.com/explore/123"), "xiaohongshu");
  assert.equal(detectVideoPlatform("https://xhslink.com/a/abc"), "xiaohongshu");
});

test("detects universal video platforms", () => {
  assert.equal(detectVideoPlatform("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectVideoPlatform("https://youtu.be/abc"), "youtube");
  assert.equal(detectVideoPlatform("https://www.bilibili.com/video/BV1demo"), "bilibili");
  assert.equal(detectVideoPlatform("https://b23.tv/abc"), "bilibili");
  assert.equal(detectVideoPlatform("https://cdn.example.com/lesson.mp4"), "direct_video_file");
  assert.equal(detectVideoPlatform("https://example.com/video/1"), "generic_web");
});

test("classifies provider preference", () => {
  assert.equal(isTikHubPreferredPlatform("douyin"), true);
  assert.equal(isTikHubPreferredPlatform("xiaohongshu"), true);
  assert.equal(isTikHubPreferredPlatform("youtube"), false);
  assert.equal(isYtDlpPreferredPlatform("youtube"), true);
  assert.equal(isYtDlpPreferredPlatform("bilibili"), true);
  assert.equal(isYtDlpPreferredPlatform("generic_web"), true);
  assert.equal(isYtDlpPreferredPlatform("douyin"), false);
});

test("normalizes only http and https video URLs", () => {
  assert.equal(normalizeVideoSourceUrl(" https://v.douyin.com/abc/ ").href, "https://v.douyin.com/abc/");
  assert.throws(() => normalizeVideoSourceUrl("ftp://v.douyin.com/abc"), /视频链接必须是 http 或 https/);
  assert.throws(() => normalizeVideoSourceUrl("not a url"), /这不是有效的视频链接/);
});
