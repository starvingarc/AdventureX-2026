import assert from "node:assert/strict";
import test from "node:test";

import { fetchTikHubVideoSource } from "./tikhubVideoProvider.js";

test("normalizes Douyin TikHub response", async () => {
  const calls = [];
  const result = await fetchTikHubVideoSource({
    sourceUrl: "https://v.douyin.com/abc/",
    apiKey: "test-tikhub-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        data: {
          aweme_id: "douyin-1",
          desc: "AI 产品调研流程",
          author: { nickname: "产品老张" },
          video: {
            duration: 61000,
            play_addr: {
              url_list: [
                "https://media.example.com/douyin.mp4",
                "https://v3-dy-o-abtest.zjcdn.com/aweme/v1/play/video_id"
              ]
            },
            cover: { url_list: ["https://media.example.com/cover.jpg"] }
          }
        }
      });
    }
  });

  assert.equal(result.platform, "douyin");
  assert.equal(result.providerContentId, "douyin-1");
  assert.equal(result.title, "AI 产品调研流程");
  assert.equal(result.account, "产品老张");
  assert.equal(result.mediaUrl, "https://v3-dy-o-abtest.zjcdn.com/aweme/v1/play/video_id");
  assert.deepEqual(result.mediaAlternativeUrls, ["https://media.example.com/douyin.mp4"]);
  assert.equal(result.mediaRequestHeaders.referer, "https://www.douyin.com/");
  assert.equal(result.coverUrl, "https://media.example.com/cover.jpg");
  assert.equal(result.durationSeconds, 61);
  assert.match(calls[0].url, /fetch_one_video_by_share_url/);
  assert.equal(calls[0].options.headers.authorization, "Bearer test-tikhub-key");
});

test("accepts TikHub Douyin redirect hosts", async () => {
  const result = await fetchTikHubVideoSource({
    sourceUrl: "https://www.iesdouyin.com/share/video/123",
    apiKey: "key",
    fetchImpl: async () => jsonResponse({
      data: {
        aweme_id: "123",
        desc: "可处理的重定向链接",
        video: { play_addr: { url_list: ["https://media.example.com/video.mp4"] } }
      }
    })
  });
  assert.equal(result.platform, "douyin");
});

test("normalizes Xiaohongshu TikHub response", async () => {
  const calls = [];
  const result = await fetchTikHubVideoSource({
    sourceUrl: "https://www.xiaohongshu.com/explore/1",
    apiKey: "key",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        data: {
          note_id: "xhs-1",
          title: "增长案例",
          desc: "小红书笔记文案",
          user: { nickname: "增长笔记" },
          video: { media: { stream: { h264: [{ master_url: "https://media.example.com/xhs.mp4" }] } } },
          image_list: [{ url: "https://media.example.com/xhs-cover.jpg" }]
        }
      });
    }
  });

  assert.equal(result.platform, "xiaohongshu");
  assert.equal(result.providerContentId, "xhs-1");
  assert.equal(result.title, "增长案例");
  assert.equal(result.description, "小红书笔记文案");
  assert.equal(result.mediaUrl, "https://media.example.com/xhs.mp4");
  assert.match(calls[0], /get_video_note_detail/);
  assert.match(calls[0], /share_text=/);
  assert.doesNotMatch(calls[0], /[?&]url=/);
});

test("normalizes Xiaohongshu App V2 video_info_v2 response", async () => {
  const result = await fetchTikHubVideoSource({
    sourceUrl: "https://www.xiaohongshu.com/discovery/item/6a27a685000000001c025262",
    apiKey: "key",
    fetchImpl: async () => jsonResponse({
      data: {
        data: [{
          id: "6a27a685000000001c025262",
          title: "苹果官方最新课程「出色设计的原则」",
          desc: "官方课程",
          user: { nickname: "Design_韬" },
          video_info_v2: {
            image: {
              first_frame: "https://media.example.com/first-frame.jpg",
              thumbnail: "https://media.example.com/thumb.webp"
            },
            media: {
              video: {
                duration: 1037,
                subtitles: {
                  "zh-CN": [{ url: "https://media.example.com/zh.srt" }]
                }
              },
              stream: {
                h264: [{
                  master_url: "https://media.example.com/app-v2.mp4",
                  duration: 1036400
                }]
              }
            }
          }
        }]
      }
    })
  });

  assert.equal(result.platform, "xiaohongshu");
  assert.equal(result.providerContentId, "6a27a685000000001c025262");
  assert.equal(result.title, "苹果官方最新课程「出色设计的原则」");
  assert.equal(result.description, "官方课程");
  assert.equal(result.account, "Design_韬");
  assert.equal(result.mediaUrl, "https://media.example.com/app-v2.mp4");
  assert.equal(result.coverUrl, "https://media.example.com/first-frame.jpg");
  assert.equal(result.durationSeconds, 1036);
  assert.deepEqual(result.subtitles, [{
    language: "zh-CN",
    url: "https://media.example.com/zh.srt",
    format: "",
    type: ""
  }]);
});

test("fails unsupported platforms before calling provider", async () => {
  await assert.rejects(
    () => fetchTikHubVideoSource({
      sourceUrl: "https://example.com/video/1",
      apiKey: "key",
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    }),
    /当前优先支持抖音和小红书公开视频/
  );
});

test("maps generic TikHub source failures back to the video error contract", async () => {
  await assert.rejects(
    () => fetchTikHubVideoSource({
      sourceUrl: "https://v.douyin.com/abc/",
      apiKey: ""
    }),
    (error) => (
      error.code === "failed_extract_video"
      && error.mediaErrorType === "provider_config_missing"
      && error.provider === "tikhub"
      && error.retryable === false
    )
  );
});

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}
