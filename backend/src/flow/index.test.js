import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries, buildSearchQuery, extractScreenshotIdentity, pickCandidate, runImageFlow } from "./index.js";
import { focusSourceContent } from "./source.js";
import { searchLinks } from "./search.js";

test("builds a compact query from account and title OCR lines", () => {
  const query = buildSearchQuery([
    "18:35",
    "巫师财经",
    "简介",
    "【巫师】财经跨年：中国财经年度盘点Top10",
    "评论1815"
  ]);
  assert.match(query, /巫师财经/);
  assert.match(query, /中国财经年度盘点Top10/);
  assert.doesNotMatch(query, /18:35/);
});

test("uses one concise high-signal query and keeps strict candidate matching", async () => {
  const queries = [];
  const result = await runImageFlow({
    ocrText: "巫师财经\n【巫师】财经跨年：中国财经年度盘点Top10",
    searcher: async (query) => {
      queries.push(query);
      return { provider: "tikhub", query, results: [{ title: "【巫师】财经跨年：中国财经年度盘点Top10", url: "https://www.bilibili.com/video/BVright", account: "巫师财经" }] };
    },
    extract: async () => ({ sourceTitle: "目标视频", sourceUrl: "https://www.bilibili.com/video/BVright", sourceAccount: "巫师财经", platform: "bilibili", rawText: "当前片段", overviewText: "全片内容", blocks: [{ id: "p-1", text: "当前片段" }], focus: {} }),
    generate: async () => ({ summaryCard: { text: "核心内容" }, units: [] }),
    generateOverview: async () => ({ summary: "全片概览", highlights: ["要点一"] })
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(queries, ["巫师财经 财经跨年"]);
  assert.ok(result.search.attempts.some((attempt) => attempt.matched));
});

test("builds bounded title search variants for a platform screenshot", () => {
  assert.deepEqual(buildSearchQueries({ title: "【巫师】财经跨年：中国财经年度盘点Top10", account: "巫师财经" }), [
    "巫师财经 财经跨年"
  ]);
});

test("keeps search to account plus the first short title segment", () => {
  assert.deepEqual(buildSearchQueries({
    title: "【巫师】全球股市年度排名，谁是神，谁是史，2025年策略前瞻",
    account: "巫师财经"
  }), ["巫师财经 全球股市年度排名"]);
});

test("keeps a season marker in the short title query", () => {
  assert.deepEqual(buildSearchQueries({
    title: "【巫师】春晚背后资本博弈，第二季",
    account: "巫师财经"
  }), ["巫师财经 春晚背后资本博弈 第二季"]);
});

test("accepts the best same-account result when OCR and indexed titles differ slightly", () => {
  const candidate = pickCandidate([
    { title: "【巫师】保健品行业的资本博弈", account: "巫师财经", url: "https://www.bilibili.com/video/BVother" },
    { title: "【巫师】Lisa资本博弈，但是第二季", account: "巫师财经", url: "https://www.bilibili.com/video/BVright" }
  ], {
    title: "【巫师】春晚背后资本博弈，第二季",
    account: "巫师财经",
    locatorTerms: []
  });
  assert.equal(candidate.url, "https://www.bilibili.com/video/BVright");
  assert.ok(candidate.accountSimilarity >= 0.78);
});

test("returns OCR/search result without a search provider", async () => {
  const result = await runImageFlow({
    imagePath: "/tmp/test.jpg",
    ocr: async () => ({ provider: "test", lines: ["巫师财经", "中国财经年度盘点Top10"] }),
    searcher: async (query) => ({ provider: "none", query, results: [], errorCode: "search_provider_missing" })
  });
  assert.equal(result.status, "search_provider_missing");
  assert.match(result.query, /巫师财经/);
});

test("keeps only title, account, and explicit player timestamp from screenshot OCR", () => {
  const identity = extractScreenshotIdentity([
    "18:35",
    "巫师财经",
    "简介",
    "【巫师】财经跨年：中国财经年度盘点Top10",
    "00:42 / 25:29",
    "评论 1815"
  ]);
  assert.equal(identity.title, "【巫师】财经跨年：中国财经年度盘点Top10");
  assert.equal(identity.account, "巫师财经");
  assert.equal(identity.timestampSeconds, 42);
});

test("ignores OCR-mangled follow controls when finding a Bilibili account", () => {
  const identity = extractScreenshotIdentity([
    "简介",
    "评论1815",
    "巫师财经",
    "充电",
    "三已关注",
    "430.6万粉丝",
    "121视频",
    "【巫师】财经跨年：中国财经年度盘点Top10"
  ]);
  assert.equal(identity.account, "巫师财经");
  assert.equal(identity.title, "【巫师】财经跨年：中国财经年度盘点Top10");
});

test("keeps the account above a truncated screenshot title", () => {
  const identity = extractScreenshotIdentity([
    "巫师财经",
    "三已关注",
    "430.6万粉丝",
    "121视频",
    "【巫师】全球股市年度排名，谁是神，谁.."
  ]);
  assert.equal(identity.account, "巫师财经");
  assert.equal(identity.title, "【巫师】全球股市年度排名，谁是神，谁..");
});

test("extracts a WeChat article title and account from its metadata row", () => {
  const identity = extractScreenshotIdentity([
    "腾讯合并大语言模型和多模态团队",
    "界面新闻 2026年7月24日 14:34 上海",
    "7月23日，腾讯宣布混元多模态模型部门与大语言模型部门合并。",
    "阅读原文 阅读 8311",
    "写留言"
  ]);
  assert.equal(identity.platform, "wechat");
  assert.equal(identity.title, "腾讯合并大语言模型和多模态团队");
  assert.equal(identity.account, "界面新闻");
});

test("extracts a Zhihu pin title and skips the follow button before the author badge", () => {
  const identity = extractScreenshotIdentity([
    "章彦博",
    "＋关注",
    "物理学话题下的优秀答主",
    "49人赞同了该想法〉",
    "从「可学习的新奇」到「智能」！",
    "年初的时候，epiplexity 曾引发过热议。"
  ]);
  assert.equal(identity.platform, "zhihu");
  assert.equal(identity.title, "从「可学习的新奇」到「智能」！");
  assert.equal(identity.account, "章彦博");
});

test("rejects a search result whose title does not match the screenshot", async () => {
  const result = await runImageFlow({
    ocrText: "巫师财经\n【巫师】财经跨年：中国财经年度盘点Top10",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{ title: "老挝举全国之力要逆天改命", url: "https://www.bilibili.com/video/BVwrong" }]
    })
  });
  assert.equal(result.status, "search_match_low_confidence");
  assert.equal(result.link, undefined);
  assert.equal(result.review, undefined);
});

test("returns a timestamp-focused review and a whole-video overview", async () => {
  const result = await runImageFlow({
    includeDetails: true,
    ocrText: "巫师财经\n【巫师】财经跨年：中国财经年度盘点Top10\n00:42 / 25:29",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{ title: "【巫师】财经跨年：中国财经年度盘点Top10", url: "https://www.bilibili.com/video/BVright", account: "巫师财经" }]
    }),
    extract: async () => ({
      sourceTitle: "【巫师】财经跨年：中国财经年度盘点Top10",
      sourceUrl: "https://www.bilibili.com/video/BVright",
      sourceAccount: "巫师财经",
      platform: "bilibili",
      rawText: "42 秒附近的核心观点。",
      overviewText: "完整视频转写，包含市场、行业和公司三个部分。",
      overviewBlocks: [{ id: "transcript-all", text: "完整视频转写", startSeconds: 0, endSeconds: 100 }],
      blocks: [{ id: "transcript-1", text: "42 秒附近的核心观点。", startSeconds: 40, endSeconds: 50 }],
      learningSource: {
        transcriptSegments: [{ id: "segment-1", text: "核心观点", startSeconds: 40, endSeconds: 50 }],
        extractionMeta: { fastPath: "platform_subtitle" }
      },
      focus: { status: "timestamp_window", timestampSeconds: 42 }
    }),
    generate: async () => ({ summaryCard: { text: "核心内容总结" }, units: [] }),
    generateOverview: async () => ({ summary: "全片概览", highlights: ["市场", "行业"] })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.review.summaryCard.text, "核心内容总结");
  assert.equal(result.videoOverview.summary, "全片概览");
  assert.equal(result.details.ocr.text.includes("财经跨年"), true);
  assert.equal(result.details.source.overviewText.includes("完整视频转写"), true);
  assert.equal(result.details.source.transcriptSegments.length, 1);
  assert.equal(result.details.source.extractionMeta.fastPath, "platform_subtitle");
  assert.equal(Number.isFinite(result.timings.ocrMs), true);
  assert.equal(Number.isFinite(result.timings.searchMs), true);
  assert.equal(Number.isFinite(result.timings.sourceExtractionMs), true);
  assert.equal(Number.isFinite(result.timings.reviewGenerationMs), true);
  assert.equal(Number.isFinite(result.timings.overviewGenerationMs), true);
  assert.equal(Number.isFinite(result.timings.totalMs), true);
});

test("selects only subtitle blocks around the player timestamp", () => {
  const focus = focusSourceContent({
    rawText: "全片转写",
    blocks: [
      { id: "a", text: "开场", startSeconds: 0, endSeconds: 10 },
      { id: "b", text: "核心观点", startSeconds: 90, endSeconds: 110 },
      { id: "c", text: "结尾", startSeconds: 250, endSeconds: 260 }
    ]
  }, 100, { radiusSeconds: 20 });
  assert.equal(focus.status, "timestamp_window");
  assert.deepEqual(focus.blocks.map((block) => block.id), ["b"]);
});

test("locates a missing player timestamp from OCR keywords in timed transcript", () => {
  const focus = focusSourceContent({
    rawText: "全片转写",
    blocks: [
      { id: "a", text: "开场介绍", startSeconds: 0, endSeconds: 10 },
      { id: "b", text: "垂死病中惊坐起，市场出现剧烈变化", startSeconds: 90, endSeconds: 110 },
      { id: "c", text: "结尾总结", startSeconds: 250, endSeconds: 260 }
    ]
  }, null, { locatorTerms: ["垂死病中惊坐起"] });
  assert.equal(focus.status, "transcript_match");
  assert.equal(focus.timestampSeconds, 90);
  assert.deepEqual(focus.blocks.map((block) => block.id), ["b"]);
});

test("uses TikHub Bilibili search when its key is configured", async () => {
  let requestedUrl = "";
  const result = await searchLinks("巫师财经 中国财经年度盘点 B站", {
    tikhubApiKey: "test-key",
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers.authorization, "Bearer test-key");
      return {
        ok: true,
        json: async () => ({
          data: {
            data: {
              items: [{
                param: "123456",
                av: {
                  title: "<em class=\"keyword\">巫师财经</em>年度盘点",
                  author: "巫师财经",
                  mid: "100"
                }
              }]
            }
          }
        })
      };
    }
  });
  assert.equal(result.provider, "tikhub");
  assert.deepEqual(result.platforms, ["bilibili"]);
  assert.match(requestedUrl, /bilibili\/app\/fetch_search_by_type/);
  assert.match(requestedUrl, /search_type=video/);
  assert.equal(result.results[0].title, "巫师财经 年度盘点");
  assert.equal(result.results[0].url, "https://www.bilibili.com/video/av123456");
});

test("hydrates a title-less TikHub Bilibili result before strict matching", async () => {
  let calls = 0;
  const result = await searchLinks("巫师财经 全球股市年度排名", {
    tikhubApiKey: "test-key",
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).includes("fetch_search_by_type")) {
        return { ok: true, json: async () => ({ data: { result: [{ bvid: "BV1exact", author: "巫师财经" }] } }) };
      }
      assert.match(String(url), /x\/web-interface\/view\?bvid=BV1exact/);
      return { ok: true, json: async () => ({ data: { title: "【巫师】全球股市年度排名，谁是神", desc: "年度复盘", owner: { name: "巫师财经" } } }) };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.results[0].title, "【巫师】全球股市年度排名，谁是神");
  assert.equal(result.results[0].account, "巫师财经");
});

test("normalizes TikHub WeChat article search results", async () => {
  const result = await searchLinks("界面新闻 腾讯合并大语言模型和多模态团队", {
    platform: "wechat",
    tikhubApiKey: "test-key",
    fetchImpl: async (url, options) => {
      assert.match(String(url), /wechat_search\/v2\/fetch_search/);
      assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).business_type, "article");
      return {
        ok: true,
        json: async () => ({
          data: {
            items: [{
              title: "<em>腾讯合并大语言模型和多模态团队</em>",
              doc_url: "https://mp.weixin.qq.com/s/example",
              desc: "腾讯宣布模型团队合并",
              source: { title: "界面新闻" }
            }]
          }
        })
      };
    }
  });
  assert.equal(result.results[0].title, "腾讯合并大语言模型和多模态团队");
  assert.equal(result.results[0].account, "界面新闻");
  assert.equal(result.results[0].url, "https://mp.weixin.qq.com/s/example");
});

test("searches a Zhihu author and normalizes the matching pin", async () => {
  const calls = [];
  const result = await searchLinks("章彦博 从可学习的新奇到智能", {
    platform: "zhihu",
    account: "章彦博",
    tikhubApiKey: "test-key",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("fetch_user_search_v3")) {
        return { ok: true, json: async () => ({ data: { data: [{ name: "<em>章彦博</em>", url_token: "excited-zyb" }] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            data: [{
              id: "2063198404256257508",
              type: "pin",
              author: { name: "章彦博" },
              content_html: "从「可学习的新奇」到「智能」！<br>正文"
            }]
          }
        })
      };
    }
  });
  assert.equal(calls.some((url) => url.includes("fetch_user_pins")), true);
  assert.equal(result.results[0].title, "从「可学习的新奇」到「智能」！");
  assert.equal(result.results[0].account, "章彦博");
  assert.equal(result.results[0].url, "https://www.zhihu.com/pin/2063198404256257508");
});

test("normalizes TikHub Douyin video search results", async () => {
  const result = await searchLinks("抖音 AI 学习", {
    tikhubApiKey: "test-key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      return {
        ok: true,
        json: async () => ({
          data: {
            data: [{ aweme_info: { aweme_id: "123456", desc: "AI 学习方法", author: { nickname: "测试博主" } } }]
          }
        })
      };
    }
  });
  assert.equal(result.provider, "tikhub");
  assert.equal(result.results[0].url, "https://www.douyin.com/video/123456");
  assert.equal(result.results[0].title, "AI 学习方法");
});

test("normalizes current TikHub Douyin business_data search results", async () => {
  let requestedUrl = "";
  const result = await searchLinks("云潮新闻 高考726分", {
    platform: "douyin",
    tikhubApiKey: "test-key",
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(JSON.parse(options.body).content_type, "1");
      return {
        ok: true,
        json: async () => ({
          data: {
            business_data: [{
              data: {
                aweme_info: {
                  aweme_id: "76570001",
                  desc: "高考726分的瑞安学霸没毕业就创业",
                  author: { nickname: "云潮新闻" }
                }
              }
            }]
          }
        })
      };
    }
  });
  assert.match(requestedUrl, /fetch_video_search_v2/);
  assert.equal(result.results[0].platform, "douyin");
  assert.equal(result.results[0].account, "云潮新闻");
  assert.equal(result.results[0].url, "https://www.douyin.com/video/76570001");
});

test("hedges a slow Douyin V2 search with V1 instead of waiting for a serial retry", async () => {
  const previous = process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS;
  process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS = "1";
  const calls = [];
  try {
    const result = await searchLinks("云潮新闻 备用检索", {
      platform: "douyin",
      tikhubApiKey: "test-key",
      timeoutMs: 1_000,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).includes("_v2")) return new Promise(() => {});
        return {
          ok: true,
          json: async () => ({
            data: {
              data: [{ aweme_info: { aweme_id: "v1-fast", desc: "备用检索命中", author: { nickname: "云潮新闻" } } }]
            }
          })
        };
      }
    });
    assert.equal(result.results[0].url, "https://www.douyin.com/video/v1-fast");
    assert.equal(calls.some((url) => url.includes("fetch_video_search_v1")), true);
  } finally {
    if (previous === undefined) delete process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS;
    else process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS = previous;
  }
});

test("keeps candidates from every TikHub platform for an unknown screenshot", async () => {
  const result = await searchLinks("学习方法", {
    maxResults: 2,
    tikhubApiKey: "test-key",
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("bilibili")) return { ok: true, json: async () => ({ data: { result: [{ bvid: "BV1", title: "B站学习" }] } }) };
      if (value.includes("xiaohongshu")) return { ok: true, json: async () => ({ data: { data: { items: [{ id: "x1", note_card: { display_title: "小红书学习" } }] } } }) };
      return { ok: true, json: async () => ({ data: { data: [{ aweme_info: { aweme_id: "d1", desc: "抖音学习" } }] } }) };
    }
  });
  assert.deepEqual(new Set(result.results.map((item) => item.platform)), new Set(["bilibili", "douyin", "xiaohongshu"]));
});
