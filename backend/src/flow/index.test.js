import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchQueries,
  buildSearchQuery,
  extractScreenshotIdentity,
  imageFlowInternalEvidence,
  runImageFlow
} from "./index.js";
import { focusSourceContent } from "./source.js";
import { searchLinks } from "./search.js";

function captureAnalysisFixture({
  sourceStatus = "verified",
  evidenceId = "subtitle-1"
} = {}) {
  return {
    schemaVersion: "capture_memory_card_2",
    disposition: "create_card",
    sourceStatus,
    decisionReason: "内容包含一个清晰的学习方法。",
    memoryCard: {
      id: "capture-memory-test",
      coreKnowledge: "主动回忆要求先尝试提取信息，以暴露记忆缺口。",
      recallCue: "主动回忆要求先做什么？",
      hiddenSemantic: "尝试提取信息",
      explanation: "先尝试提取信息，才能暴露记忆缺口。",
      sourceEvidenceIds: [evidenceId],
      rarity: "R",
      rarityReason: "具体学习方法。",
      rarityConfidence: 0.8,
      rarityRuleVersion: "capture_rarity_2",
      sourceTitle: "主动回忆为什么有效",
      sourceUrl: "https://example.com/source",
      recallVariants: [
        {
          id: "cloze",
          type: "semantic_cloze",
          prompt: "主动回忆要求先 ____。",
          answer: "尝试提取信息",
          options: [],
          correctOptionId: null,
          correctBoolean: null,
          explanation: "先尝试提取信息。",
          sourceEvidenceIds: [evidenceId]
        },
        {
          id: "tf",
          type: "true_false",
          prompt: "主动回忆能够暴露记忆缺口。",
          answer: "true",
          options: [],
          correctOptionId: null,
          correctBoolean: true,
          explanation: "原内容明确支持这一点。",
          sourceEvidenceIds: [evidenceId]
        },
        {
          id: "mcq",
          type: "multiple_choice",
          prompt: "主动回忆会暴露什么？",
          answer: "记忆缺口",
          options: [
            { id: "a", text: "记忆缺口" },
            { id: "b", text: "阅读速度" },
            { id: "c", text: "页面颜色" },
            { id: "d", text: "笔记长度" }
          ],
          correctOptionId: "a",
          correctBoolean: null,
          explanation: "主动回忆会暴露记忆缺口。",
          sourceEvidenceIds: [evidenceId]
        }
      ]
    },
    schedule: {
      nextReviewAt: "2026-07-24T08:00:00.000Z",
      intervalDays: 0,
      state: "due",
      status: "due",
      stepIndex: 0
    }
  };
}

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
  assert.equal(result.memoryCard.state, "fragment");
  assert.deepEqual(queries, ["巫师财经 财经跨年"]);
  assert.ok(result.search.attempts.some((attempt) => attempt.matched));
});

test("builds bounded title search variants for a platform screenshot", () => {
  assert.deepEqual(buildSearchQueries({ title: "【巫师】财经跨年：中国财经年度盘点Top10", account: "巫师财经" }), [
    "巫师财经 财经跨年"
  ]);
});

test("returns visual/search result without a search provider", async () => {
  const result = await runImageFlow({
    imagePath: "/tmp/test.jpg",
    analyzeImage: async () => ({
      provider: "test-vision",
      identity: {
        platform: "bilibili",
        title: "中国财经年度盘点Top10",
        account: "巫师财经",
        timestampSeconds: null,
        locatorTerms: [],
        confidence: 0.9
      },
      lines: ["巫师财经", "中国财经年度盘点Top10"]
    }),
    searcher: async (query) => ({ provider: "none", query, results: [], errorCode: "search_provider_missing" })
  });
  assert.equal(result.status, "search_provider_missing");
  assert.equal(result.memoryCard.state, "fragment");
  assert.equal(result.memoryCard.sourceStatus, "unconfirmed");
  assert.match(result.query, /巫师财经/);
});

test("generates three Qwen cards and marks provenance when TikHub cannot resolve the image", async () => {
  const analysis = captureAnalysisFixture({ sourceStatus: "partial", evidenceId: "screenshot-visual-1" });
  analysis.memoryCard.sourceUrl = "";
  const result = await runImageFlow({
    imagePath: "/tmp/unsourced.jpg",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      text: "截图主题",
      lines: ["截图主题"],
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "截图主题",
        account: "截图作者",
        timestampSeconds: null,
        locatorTerms: [],
        visibleTextLines: ["截图主题"],
        confidence: 0.9
      }
    }),
    searcher: async (query) => ({ provider: "tikhub", query, results: [] }),
    analyzeUnsourcedImage: async () => ({
      provider: "qwen-vision",
      model: "qwen3-vl-plus",
      title: "截图主题",
      account: "截图作者",
      platform: "douyin",
      summary: "截图展示了主动回忆要求先尝试提取信息，以暴露记忆缺口。",
      keyPoints: ["先尝试提取信息", "通过提取暴露记忆缺口"],
      tags: ["主动回忆"]
    }),
    generateMemory: async (input) => {
      assert.equal(input.sourceStatus, "partial");
      assert.equal(input.sourceUrl, "");
      assert.equal(input.evidence.length, 3);
      return analysis;
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.sourceStatus, "unsourced_image");
  assert.equal(result.provenance.status, "not_found");
  assert.equal(result.provenance.provider, "tikhub");
  assert.equal(result.provenance.fallbackModel, "qwen3-vl-plus");
  assert.equal(result.source.url, "");
  assert.equal(result.review.units[0].questions.length, 3);
  assert.equal(result.captureAnalysis.memoryCard.provenance.status, "not_found");
  assert.equal(result.contentOverview.provenance.status, "not_found");
  assert.match(result.message, /未找到 TikHub 原始来源/);
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
  assert.equal(result.memoryCard.state, "fragment");
});

test("rejects the same Bilibili title when the UP account does not match", async () => {
  const result = await runImageFlow({
    ocrText: "巫师财经\n【巫师】财经跨年：中国财经年度盘点Top10",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        title: "【巫师】财经跨年：中国财经年度盘点Top10",
        url: "https://www.bilibili.com/video/BVwrong",
        account: "另一个账号",
        snippet: "无关账号"
      }]
    })
  });
  assert.equal(result.status, "search_match_low_confidence");
  assert.equal(result.link, undefined);
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
    generate: async () => ({
      title: "财经跨年",
      summaryCard: { text: "核心内容总结" },
      units: [{
        questions: [{
          knowledgePoint: "市场关系",
          stem: "这段视频强调了什么？",
          options: [
            { id: "option-1", text: "市场与行业需要结合判断" },
            { id: "option-2", text: "只看单一指标" }
          ],
          correctOptionId: "option-1",
          explanation: "视频通过市场、行业和公司三个层次说明综合判断的方法。"
        }]
      }]
    }),
    generateOverview: async () => ({ summary: "全片概览", highlights: ["市场", "行业"] })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.review.summaryCard.text, "核心内容总结");
  assert.equal(result.videoOverview.summary, "全片概览");
  assert.equal(result.memoryCard.state, "formal");
  assert.equal(result.memoryCard.sourceStatus, "verified");
  assert.equal(result.memoryCard.hiddenSemantic, "市场与行业需要结合判断");
  assert.equal(result.details.capture.text.includes("财经跨年"), true);
  assert.equal(result.details.source.overviewText.includes("完整视频转写"), true);
  assert.equal(result.details.source.transcriptSegments.length, 1);
  assert.equal(result.details.source.extractionMeta.fastPath, "platform_subtitle");
  assert.equal(Number.isFinite(result.timings.visionMs), true);
  assert.equal(Number.isFinite(result.timings.searchMs), true);
  assert.equal(Number.isFinite(result.timings.sourceExtractionMs), true);
  assert.equal(Number.isFinite(result.timings.reviewGenerationMs), true);
  assert.equal(Number.isFinite(result.timings.overviewGenerationMs), true);
  assert.equal(Number.isFinite(result.timings.totalMs), true);
});

test("uses the capture_memory_card_2 generator in the production path and keeps legacy mirrors", async () => {
  const result = await runImageFlow({
    ocrText: "记忆研究所\n主动回忆为什么有效\n00:12 / 02:00",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        title: "主动回忆为什么有效",
        url: "https://www.bilibili.com/video/BVmemory",
        account: "记忆研究所",
        platform: "bilibili",
        contentKind: "video"
      }]
    }),
    extract: async () => ({
      sourceTitle: "主动回忆为什么有效",
      sourceUrl: "https://www.bilibili.com/video/BVmemory",
      sourceAccount: "记忆研究所",
      platform: "bilibili",
      rawText: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。",
      overviewText: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。",
      blocks: [{
        id: "subtitle-1",
        type: "paragraph",
        text: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。"
      }],
      focus: { status: "timestamp_window", timestampSeconds: 12 }
    }),
    generateMemory: async (input) => {
      assert.equal(input.sourceStatus, "verified");
      assert.deepEqual(input.evidence.map((item) => item.id), ["subtitle-1"]);
      return captureAnalysisFixture({ sourceStatus: input.sourceStatus });
    },
    generateOverview: async () => ({ summary: "全片概览", highlights: [] })
  });

  assert.equal(result.status, "completed");
  assert.equal(result.captureAnalysis.schemaVersion, "capture_memory_card_2");
  assert.equal(result.captureAnalysis.memoryCard.recallVariants.length, 3);
  assert.equal(result.schedule.nextReviewAt, result.captureAnalysis.schedule.nextReviewAt);
  assert.equal(result.memoryCard.state, "formal");
  assert.equal(result.memoryCard.sourceStatus, "verified");
  assert.equal(result.review.units[0].questions.length, 3);
  assert.deepEqual(imageFlowInternalEvidence(result).map((item) => item.id), ["subtitle-1"]);
  assert.equal(Object.keys(result).some((key) => key.includes("Evidence")), false);
  assert.equal(Object.getOwnPropertySymbols(result).length, 1);
});

test("marks screenshot-only generation partial while mapping the legacy card to unconfirmed", async () => {
  const extractionError = new Error("视频内容不可用。");
  extractionError.code = "failed_extract_video";
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "主动回忆为什么有效",
        account: "记忆研究所",
        timestampSeconds: null,
        locatorTerms: ["主动回忆"],
        visibleTextLines: [
          "主动回忆为什么有效",
          "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。"
        ],
        confidence: 0.9
      },
      lines: [
        "主动回忆为什么有效",
        "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。"
      ]
    }),
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        title: "主动回忆为什么有效",
        url: "https://www.douyin.com/video/123",
        account: "记忆研究所",
        platform: "douyin",
        contentKind: "video"
      }]
    }),
    extract: async () => {
      throw extractionError;
    },
    generateMemory: async (input) => {
      assert.equal(input.sourceStatus, "partial");
      assert.equal(input.evidence[0].type, "screenshot");
      return captureAnalysisFixture({
        sourceStatus: input.sourceStatus,
        evidenceId: "screenshot-visible"
      });
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.sourceFallback, true);
  assert.equal(result.captureAnalysis.sourceStatus, "partial");
  assert.equal(result.memoryCard.sourceStatus, "unconfirmed");
});

test("treats archive_only as a completed business outcome", async () => {
  const result = await runImageFlow({
    ocrText: "小林的笔记\n今日心情记录",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        title: "今日心情记录",
        url: "https://www.xiaohongshu.com/explore/archive1",
        account: "小林的笔记",
        platform: "xiaohongshu",
        contentKind: "image_text"
      }]
    }),
    extract: async () => ({
      sourceTitle: "今日心情记录",
      sourceUrl: "https://www.xiaohongshu.com/explore/archive1",
      sourceAccount: "小林的笔记",
      platform: "xiaohongshu",
      rawText: "今天只是记录了一段没有复习价值的日常心情，没有可提炼的知识。",
      blocks: [{
        id: "note-1",
        type: "paragraph",
        text: "今天只是记录了一段没有复习价值的日常心情，没有可提炼的知识。"
      }],
      focus: {}
    }),
    generateMemory: async () => ({
      schemaVersion: "capture_memory_card_2",
      disposition: "archive_only",
      sourceStatus: "verified",
      decisionReason: "这是一段日常心情记录。",
      memoryCard: null,
      schedule: null
    })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.captureAnalysis.disposition, "archive_only");
  assert.equal(result.memoryCard.state, "fragment");
});

test("uses verified screenshot text when video extraction is unavailable", async () => {
  const extractionError = new Error("本地语音转写环境暂未配置。");
  extractionError.code = "failed_extract_video";
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "截图里可见的完整标题",
        account: "测试作者",
        timestampSeconds: null,
        locatorTerms: ["核心观点"],
        visibleTextLines: ["截图里可见的完整标题", "视频中称这是一个需要进一步核对的核心观点。"],
        confidence: 0.9
      },
      lines: ["截图里可见的完整标题", "视频中称这是一个需要进一步核对的核心观点。"]
    }),
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        title: "截图里可见的完整标题",
        url: "https://www.douyin.com/video/123",
        account: "测试作者",
        platform: "douyin",
        contentKind: "video"
      }]
    }),
    extract: async () => {
      throw extractionError;
    },
    generate: async (input) => {
      assert.match(input.rawText, /不代表 Recallo 已完成外部事实核验/);
      return {
        title: "截图记忆",
        units: [{
          questions: [{
            knowledgePoint: "事实核对方法",
            stem: "截图中的内容应如何理解？",
            options: [
              { id: "option-1", text: "作为待核对的截图内容" },
              { id: "option-2", text: "直接当作已证实事实" }
            ],
            correctOptionId: "option-1",
            explanation: "截图能证明用户看过这段表述，但不能代替外部事实核验。"
          }]
        }]
      };
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.sourceFallback, true);
  assert.equal(result.source.focus.status, "screenshot_only");
  assert.equal(result.memoryCard.state, "formal");
  assert.equal(result.memoryCard.sourceStatus, "verified");
  assert.equal(result.error, undefined);
  assert.equal(result.sourceWarning.code, "failed_extract_video");
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
            result: [{
              title: "<em class=\"keyword\">巫师财经</em>年度盘点",
              bvid: "BV1example",
              description: "财经年度内容"
            }]
          }
        })
      };
    }
  });
  assert.equal(result.provider, "tikhub");
  assert.deepEqual(result.platforms, ["bilibili"]);
  assert.match(requestedUrl, /bilibili\/web\/fetch_general_search/);
  assert.equal(result.results[0].title, "巫师财经 年度盘点");
  assert.equal(result.results[0].url, "https://www.bilibili.com/video/BV1example");
});

test("hydrates a title-less TikHub Bilibili result before strict matching", async () => {
  let calls = 0;
  const result = await searchLinks("巫师财经 全球股市年度排名", {
    tikhubApiKey: "test-key",
    platform: "bilibili",
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).includes("fetch_general_search")) {
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

test("adds Bilibili creator posts when general search misses the exact title", async () => {
  const requestedUrls = [];
  const result = await searchLinks("记忆研究所 间隔重复", {
    tikhubApiKey: "test-key",
    platform: "bilibili",
    enabledPlatforms: ["bilibili"],
    account: "记忆研究所",
    creatorFallback: true,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("fetch_general_search")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              result: [{
                bvid: "BVolder",
                title: "另一条视频",
                author: "记忆研究所",
                mid: "42"
              }]
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            data: {
              item: [{
                bvid: "BVexact",
                title: "间隔重复的三个误区",
                author: "记忆研究所"
              }]
            }
          }
        })
      };
    }
  });
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[1], /bilibili\/app\/fetch_user_videos/);
  assert.equal(result.results.find((item) => item.discovery === "creator_posts")?.url, "https://www.bilibili.com/video/BVexact");
});

test("normalizes TikHub Douyin video search results", async () => {
  const result = await searchLinks("抖音 AI 学习", {
    tikhubApiKey: "test-key",
    enabledPlatforms: ["douyin"],
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
  assert.equal(result.results[0].platform, "douyin");
  assert.equal(result.results[0].contentKind, "video");
});

test("honors an explicit adapter allowlist", async () => {
  let called = false;
  const result = await searchLinks("抖音 AI 学习", {
    tikhubApiKey: "test-key",
    enabledPlatforms: ["bilibili"],
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    }
  });
  assert.equal(called, false);
  assert.equal(result.errorCode, "platform_not_enabled");
  assert.deepEqual(result.platforms, []);
});

test("rejects a visual platform whose adapter is disabled before search", async () => {
  let searched = false;
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      model: "qwen3.7-plus-2026-05-26",
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "抖音平台标题",
        account: "其他作者",
        timestampSeconds: null,
        locatorTerms: [],
        confidence: 0.8
      },
      lines: ["抖音平台标题"]
    }),
    searcher: async () => {
      searched = true;
      return { provider: "tikhub", results: [] };
    },
    enabledPlatforms: ["bilibili"]
  });
  assert.equal(searched, false);
  assert.equal(result.status, "platform_not_supported");
  assert.equal(result.capture.provider, "qwen-vision");
});

test("uses only the Douyin adapter for a Douyin screenshot", async () => {
  let searchOptions = null;
  let extractionInput = null;
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "三个主动回忆的方法",
        account: "记忆研究所",
        timestampSeconds: 12,
        locatorTerms: ["主动回忆"],
        confidence: 0.92
      },
      lines: ["记忆研究所", "三个主动回忆的方法"]
    }),
    searcher: async (query, options) => {
      searchOptions = options;
      return {
        provider: "tikhub",
        query,
        platforms: ["douyin"],
        results: [{
          platform: "douyin",
          contentKind: "video",
          title: "三个主动回忆的方法",
          account: "记忆研究所",
          url: "https://www.douyin.com/video/123"
        }]
      };
    },
    extract: async (input) => {
      extractionInput = input;
      return {
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl,
        sourceAccount: "记忆研究所",
        platform: "douyin",
        rawText: "主动回忆比重复阅读更有效。",
        overviewText: "完整视频内容。",
        blocks: [{ id: "dy-1", text: "主动回忆比重复阅读更有效。" }],
        focus: {}
      };
    },
    generate: async () => ({ summaryCard: { text: "主动回忆" }, units: [] }),
    generateOverview: async () => ({ summary: "完整概览", highlights: [] })
  });
  assert.equal(result.status, "completed");
  assert.equal(searchOptions.platform, "douyin");
  assert.deepEqual(searchOptions.enabledPlatforms, ["bilibili", "douyin", "xiaohongshu"]);
  assert.equal(extractionInput.sourceType, "video_link");
});

test("routes a Xiaohongshu image note through the article adapter", async () => {
  let extractionInput = null;
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "xiaohongshu",
        contentKind: "image_text",
        title: "如何建立个人知识系统",
        account: "小林的笔记",
        timestampSeconds: null,
        locatorTerms: ["知识系统"],
        confidence: 0.9
      },
      lines: ["小林的笔记", "如何建立个人知识系统"]
    }),
    searcher: async (query, options) => ({
      provider: "tikhub",
      query,
      platforms: [options.platform],
      results: [{
        platform: "xiaohongshu",
        contentKind: "image_text",
        title: "如何建立个人知识系统",
        account: "小林的笔记",
        url: "https://www.xiaohongshu.com/explore/xhs1"
      }]
    }),
    extract: async (input) => {
      extractionInput = input;
      return {
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl,
        sourceAccount: "小林的笔记",
        platform: "xiaohongshu",
        rawText: "先从稳定的收集入口开始。",
        blocks: [{ id: "xhs-1", text: "先从稳定的收集入口开始。" }],
        focus: {}
      };
    },
    generate: async () => ({ summaryCard: { text: "知识系统" }, units: [] })
  });
  assert.equal(result.status, "completed");
  assert.equal(extractionInput.sourceType, "article_link");
  assert.equal(extractionInput.forceTikHubContent, true);
  assert.match(extractionInput.screenshotText, /如何建立个人知识系统/);
  assert.equal(result.videoOverview, undefined);
});

test("rejects a supplied URL from a different platform than the screenshot", async () => {
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    sourceUrl: "https://www.bilibili.com/video/BVwrong",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "douyin",
        contentKind: "video",
        title: "同名内容",
        account: "同名作者",
        timestampSeconds: null,
        locatorTerms: [],
        confidence: 0.9
      },
      lines: ["同名内容"]
    })
  });
  assert.equal(result.status, "source_platform_mismatch");
});

test("rejects an ambiguous cross-platform match when the platform is unknown", async () => {
  const result = await runImageFlow({
    imageBase64: "aGVsbG8=",
    mimeType: "image/png",
    analyzeImage: async () => ({
      provider: "qwen-vision",
      identity: {
        platform: "unknown",
        contentKind: "unknown",
        title: "间隔重复的三个误区",
        account: "学习实验室",
        timestampSeconds: null,
        locatorTerms: [],
        confidence: 0.65
      },
      lines: ["学习实验室", "间隔重复的三个误区"]
    }),
    searcher: async (query, options) => ({
      provider: "tikhub",
      query,
      platforms: options.enabledPlatforms,
      results: [
        {
          platform: "bilibili",
          contentKind: "video",
          title: "间隔重复的三个误区",
          account: "学习实验室",
          url: "https://www.bilibili.com/video/BVsame"
        },
        {
          platform: "douyin",
          contentKind: "video",
          title: "间隔重复的三个误区",
          account: "学习实验室",
          url: "https://www.douyin.com/video/456"
        }
      ]
    })
  });
  assert.equal(result.status, "search_match_low_confidence");
  assert.equal(result.link, undefined);
});

test("normalizes current Douyin business_data search responses", async () => {
  const result = await searchLinks("主动回忆", {
    tikhubApiKey: "test-key",
    platform: "douyin",
    enabledPlatforms: ["bilibili", "douyin", "xiaohongshu"],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: {
          business_data: [{
            data: {
              aweme_info: {
                aweme_id: "789",
                desc: "主动回忆入门",
                author: { nickname: "记忆研究所" }
              }
            }
          }]
        }
      })
    })
  });
  assert.deepEqual(result.platforms, ["douyin"]);
  assert.equal(result.results[0].url, "https://www.douyin.com/video/789");
  assert.equal(result.results[0].account, "记忆研究所");
});

test("normalizes Xiaohongshu image-note search results", async () => {
  const result = await searchLinks("知识系统", {
    tikhubApiKey: "test-key",
    platform: "xiaohongshu",
    enabledPlatforms: ["bilibili", "douyin", "xiaohongshu"],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: {
          data: {
            items: [{
              note_card: {
                note_id: "xhs-2",
                type: "normal",
                display_title: "知识系统搭建",
                user: { nickname: "小林的笔记" },
                cover: { url: "https://example.com/cover.jpg" }
              }
            }]
          }
        }
      })
    })
  });
  assert.deepEqual(result.platforms, ["xiaohongshu"]);
  assert.equal(result.results[0].platform, "xiaohongshu");
  assert.equal(result.results[0].contentKind, "image_text");
  assert.equal(result.results[0].url, "https://www.xiaohongshu.com/explore/xhs-2");
});

test("searches every enabled adapter only when cross-platform search is explicit", async () => {
  const requestedUrls = [];
  const result = await searchLinks("间隔重复", {
    tikhubApiKey: "test-key",
    searchAllPlatforms: true,
    enabledPlatforms: ["bilibili", "douyin", "xiaohongshu"],
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return { ok: true, json: async () => ({ data: {} }) };
    }
  });
  assert.deepEqual(result.platforms, ["bilibili", "douyin", "xiaohongshu"]);
  assert.equal(requestedUrls.length, 3);
});
