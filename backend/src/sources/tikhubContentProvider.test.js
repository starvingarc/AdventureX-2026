import assert from "node:assert/strict";
import test from "node:test";

import {
  detectTikHubContentPlatform,
  fetchTikHubContentSource,
  normalizeTikHubContent
} from "./tikhubContentProvider.js";

test("detects supported TikHub content platforms without treating arbitrary sites as supported", () => {
  assert.equal(detectTikHubContentPlatform("https://v.douyin.com/demo/"), "douyin");
  assert.equal(detectTikHubContentPlatform("https://www.xiaohongshu.com/explore/abc"), "xiaohongshu");
  assert.equal(detectTikHubContentPlatform("https://mp.weixin.qq.com/s/demo"), "wechat");
  assert.equal(detectTikHubContentPlatform("https://www.zhihu.com/question/1/answer/2"), "zhihu");
  assert.equal(detectTikHubContentPlatform("https://example.com/article"), "unknown");
});

test("prefers responsive Douyin play hosts over experimental CDN URLs", () => {
  const result = normalizeTikHubContent("douyin", {
    aweme_id: "douyin-fast-cdn",
    video: {
      play_addr: {
        url_list: [
          "https://v5-dy-ov-experiment.zjcdn.com/video.mp4",
          "https://api-play-hl.amemv.com/aweme/v1/play/?video_id=demo"
        ]
      }
    }
  }, "https://www.douyin.com/video/douyin-fast-cdn");

  assert.match(result.mediaUrl, /amemv\.com/);
  assert.match(result.mediaUrls[1], /zjcdn\.com/);
});

test("prefers the smallest Douyin audio carrier before higher bitrate video", () => {
  const result = normalizeTikHubContent("douyin", {
    aweme_id: "smallest-stream",
    video: {
      bit_rate: [
        { bit_rate: 1_200_000, play_addr: { data_size: 5_000_000, url_list: ["https://api-play.amemv.com/high.mp4"] } },
        { bit_rate: 400_000, play_addr: { data_size: 1_500_000, url_list: ["https://api-play.amemv.com/low.mp4"] } }
      ]
    }
  }, "https://www.douyin.com/video/smallest-stream");
  assert.equal(result.mediaUrl, "https://api-play.amemv.com/low.mp4");
  assert.equal(result.mediaUrls[1], "https://api-play.amemv.com/high.mp4");
});

test("uses Xiaohongshu web v3 when evidence token is present and normalizes image notes", async () => {
  const calls = [];
  const result = await fetchTikHubContentSource({
    sourceUrl: "https://www.xiaohongshu.com/explore/abc123?xsec_token=token123",
    apiKey: "key",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        code: 200,
        data: {
          note_id: "abc123",
          title: "如何建立复习习惯",
          desc: "先缩短启动时间，再用主动回忆检查自己是否真正记住。",
          user: { nickname: "学习笔记" },
          image_list: [
            { url_default: "https://media.example.com/one.jpg" },
            { info_list: [{ url: "https://media.example.com/two.jpg" }] }
          ]
        }
      });
    }
  });

  assert.equal(result.kind, "image_text");
  assert.equal(result.platform, "xiaohongshu");
  assert.equal(result.providerContentId, "abc123");
  assert.equal(result.account, "学习笔记");
  assert.equal(result.images.length, 2);
  assert.match(calls[0].url, /xiaohongshu\/web_v3\/fetch_note_detail/);
  assert.match(calls[0].url, /note_id=abc123/);
  assert.match(calls[0].url, /xsec_token=token123/);
  assert.equal(calls[0].options.headers.authorization, "Bearer key");
});

test("normalizes WeChat article text and sends the required POST payload", async () => {
  const calls = [];
  const result = await fetchTikHubContentSource({
    sourceUrl: "https://mp.weixin.qq.com/s/demo",
    apiKey: "key",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        code: 200,
        data: {
          title: "主动回忆",
          author: "记忆研究所",
          content: {
            article: {
              full_text: "主动回忆要求学习者在不看答案时尝试提取信息。",
              images: [{ src: "https://mmbiz.qpic.cn/example.jpg" }]
            }
          }
        }
      });
    }
  });

  assert.equal(result.kind, "article");
  assert.equal(result.title, "主动回忆");
  assert.equal(result.text, "主动回忆要求学习者在不看答案时尝试提取信息。");
  assert.deepEqual(result.images, ["https://mmbiz.qpic.cn/example.jpg"]);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: "https://mp.weixin.qq.com/s/demo",
    raw: false
  });
});

test("normalizes the live WeChat V2 data.content response shape", () => {
  const result = normalizeTikHubContent("wechat", {
    url: "https://mp.weixin.qq.com/s/demo",
    content: {
      title: "一次练习只选择一个记忆点",
      desc: "文章摘要",
      author: "作者",
      nick_name: "公众号",
      mid: 12345,
      create_time: "2026-07-23 08:00",
      cdn_url: "https://mmbiz.qpic.cn/cover.jpg",
      content_text: "主动回忆比重复阅读更能暴露知识缺口。",
      picture_page_info_list: [
        { cdn_url: "https://mmbiz.qpic.cn/one.jpg" },
        { cdn_url: "https://mmbiz.qpic.cn/two.jpg" }
      ]
    }
  }, "https://mp.weixin.qq.com/s/demo");

  assert.equal(result.title, "一次练习只选择一个记忆点");
  assert.equal(result.description, "文章摘要");
  assert.equal(result.author, "作者");
  assert.equal(result.providerContentId, "12345");
  assert.equal(result.publishedAt, "2026-07-23 08:00");
  assert.equal(result.text, "主动回忆比重复阅读更能暴露知识缺口。");
  assert.equal(result.coverUrl, "https://mmbiz.qpic.cn/cover.jpg");
  assert.deepEqual(result.images, [
    "https://mmbiz.qpic.cn/one.jpg",
    "https://mmbiz.qpic.cn/two.jpg"
  ]);
});

test("normalizes Zhihu answers without leaking HTML into the learning source", async () => {
  const result = await fetchTikHubContentSource({
    sourceUrl: "https://www.zhihu.com/question/1/answer/2",
    apiKey: "key",
    fetchImpl: async (url) => {
      assert.match(String(url), /fetch_answer_detail/);
      assert.match(String(url), /answer_id=2/);
      return jsonResponse({
        code: 200,
        data: {
          answer_id: 2,
          question: { title: "怎样提高长期记忆？" },
          author: { name: "记忆研究员" },
          content: "<p>间隔练习可以降低短期熟悉感带来的错觉。</p>"
        }
      });
    }
  });

  assert.equal(result.kind, "answer");
  assert.equal(result.title, "怎样提高长期记忆？");
  assert.equal(result.account, "记忆研究员");
  assert.equal(result.text, "间隔练习可以降低短期熟悉感带来的错觉。");
  assert.doesNotMatch(result.text, /<p>/);
});

test("preserves explicit Xiaohongshu video fields for the existing media pipeline", () => {
  const result = normalizeTikHubContent("xiaohongshu", {
    data: [{
      id: "video-1",
      title: "视频标题",
      desc: "视频说明",
      video_info_v2: {
        image: { first_frame: "https://media.example.com/frame.jpg" },
        media: {
          video: {
            duration: 35,
            subtitles: { "zh-CN": [{ url: "https://media.example.com/subtitle.srt" }] }
          },
          stream: {
            h264: [{ master_url: "https://media.example.com/video.mp4", duration: 35000 }]
          }
        }
      }
    }]
  }, "https://www.xiaohongshu.com/explore/video-1");

  assert.equal(result.kind, "video");
  assert.equal(result.mediaUrl, "https://media.example.com/video.mp4");
  assert.equal(result.durationSeconds, 35);
  assert.equal(result.coverUrl, "https://media.example.com/frame.jpg");
  assert.equal(result.subtitles[0].language, "zh-CN");
});

test("falls back from Xiaohongshu image detail when the note is actually a video", async () => {
  const calls = [];
  const result = await fetchTikHubContentSource({
    sourceUrl: "https://www.xiaohongshu.com/explore/video-note",
    apiKey: "key",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return jsonResponse({
          code: 200,
          data: {
            note_id: "video-note",
            note_type: "video",
            desc: "这是一条视频笔记"
          }
        });
      }
      return jsonResponse({
        code: 200,
        data: {
          note_id: "video-note",
          note_type: "video",
          desc: "这是一条视频笔记",
          video: {
            media: {
              stream: {
                h264: [{ master_url: "https://media.example.com/video-note.mp4" }]
              }
            }
          }
        }
      });
    }
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0], /get_image_note_detail/);
  assert.match(calls[1], /get_video_note_detail/);
  assert.equal(result.kind, "video");
  assert.equal(result.mediaUrl, "https://media.example.com/video-note.mp4");
});

test("maps provider rate limits to a retryable typed error", async () => {
  await assert.rejects(
    () => fetchTikHubContentSource({
      sourceUrl: "https://mp.weixin.qq.com/s/demo",
      apiKey: "key",
      fetchImpl: async () => jsonResponse(
        { message_zh: "请求过于频繁" },
        { ok: false, status: 429 }
      )
    }),
    (error) => (
      error.code === "failed_extract_source"
      && error.sourceErrorType === "provider_rate_limited"
      && error.retryable === true
    )
  );
});

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload
  };
}
