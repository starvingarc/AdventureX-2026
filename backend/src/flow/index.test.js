import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries, buildSearchQuery, extractScreenshotIdentity, pickCandidate, runImageFlow } from "./index.js";
import { focusSourceContent } from "./source.js";
import { searchLinks } from "./search.js";
import { validatedIdentityFromIndexes } from "./identity.js";

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
  assert.deepEqual(queries, ["巫师财经 财经跨年 中国财经年度盘点Top10"]);
  assert.ok(result.search.attempts.some((attempt) => attempt.matched));
});

test("builds bounded title search variants for a platform screenshot", () => {
  assert.deepEqual(buildSearchQueries({ title: "【巫师】财经跨年：中国财经年度盘点Top10", account: "巫师财经" }), [
    "巫师财经 财经跨年 中国财经年度盘点Top10"
  ]);
});

test("keeps search to account plus the first short title segment", () => {
  assert.deepEqual(buildSearchQueries({
    title: "【巫师】全球股市年度排名，谁是神，谁是史，2025年策略前瞻",
    account: "巫师财经"
  }), ["巫师财经 全球股市年度排名 谁是神 谁是史 2025年策略前瞻"]);
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

test("uses Qwen Plus visual fallback and marks the knowledge map when TikHub has no source", async () => {
  const questions = [
    { id: "q-001", stem: "判断题", options: [], type: "true_false" },
    { id: "q-002", stem: "选择题一", options: [], type: "multiple_choice" },
    { id: "q-003", stem: "选择题二", options: [], type: "multiple_choice" }
  ];
  const result = await runImageFlow({
    imagePath: "/tmp/unsourced.jpg",
    ocr: async () => ({ provider: "test", text: "画面中的核心文字", lines: ["画面中的核心文字"] }),
    refineIdentity: async () => ({ title: "画面中的核心文字", account: "", platform: "douyin", locatorTerms: [] }),
    searcher: async (query) => ({ provider: "tikhub", query, results: [] }),
    analyzeUnsourced: async () => ({
      title: "截图主题",
      account: "",
      platform: "douyin",
      summary: "这是仅依据截图生成的概括。",
      tags: ["截图"],
      keyPoints: ["要点一", "要点二"],
      questions: [{}, {}, {}],
      provider: "qwen-vl",
      model: "qwen3-vl-plus",
      usage: {}
    }),
    generateUnsourcedReview: async () => ({
      title: "截图主题",
      source: {},
      summaryCard: { text: "这是仅依据截图生成的概括。" },
      units: [{ id: "unit-quick-review", questions }],
      generationMeta: {}
    })
  });

  assert.equal(result.status, "completed");
  assert.equal(result.sourceStatus, "unsourced_image");
  assert.equal(result.provenance.status, "not_found");
  assert.equal(result.provenance.provider, "tikhub");
  assert.equal(result.provenance.fallbackModel, "qwen3-vl-plus");
  assert.equal(result.source.url, "");
  assert.equal(result.source.sourceType, "image_only");
  assert.equal(result.review.units[0].questions.length, 3);
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

test("extracts Bilibili title and UP from the creator block instead of a video watermark", () => {
  const identity = extractScreenshotIdentity([
    "空山猎人",
    "在这颗星球上",
    "引言",
    "简介",
    "评论1001",
    "空山猎人",
    "十关注",
    "91.1万粉丝 178视频",
    "热搜",
    "白粉、杠杆与镰刀：韩国黄金时•〈",
    "1098 2026年7月23日19:23 2000+人正在",
    "合集•电力帝国",
    "13/13"
  ]);
  assert.equal(identity.platform, "bilibili");
  assert.equal(identity.account, "空山猎人");
  assert.equal(identity.title, "白粉、杠杆与镰刀：韩国黄金时•〈");
});

test("does not mistake a Bilibili collection counter for Xiaohongshu", () => {
  const identity = extractScreenshotIdentity([
    "简介 评论1001",
    "空山猎人",
    "十关注",
    "91.1万粉丝 178视频",
    "白粉、杠杆与镰刀：韩国黄金时.",
    "不喜欢",
    "合集•电力帝国",
    "13/13"
  ]);
  assert.equal(identity.platform, "bilibili");
});

test("ignores dense Bilibili danmaku accounts and extracts the creator block", () => {
  const identity = extractScreenshotIdentity([
    "哑巴流：我用眼睛给你看看",
    "我是穿越者，2031的机器人",
    "@yivo.com",
    "好好好，就得这样子，多调试",
    "简介",
    "评论5090",
    "点我发弹幕",
    "Unitree宇树科技",
    "充电",
    "三 已关注",
    "89.6万粉丝 97视频",
    "全模态实时交互驱动全身移动操作",
    "1427 2026年7月20日15:13 296人正在看"
  ]);
  assert.equal(identity.platform, "bilibili");
  assert.equal(identity.account, "Unitree宇树科技");
  assert.equal(identity.title, "全模态实时交互驱动全身移动操作");
});

test("Qwen identity selection can only use grounded consecutive OCR lines", () => {
  const lines = ["简介", "空山猎人", "十关注", "91.1万粉丝 178视频", "白粉、杠杆与镰刀：韩国黄金时."];
  const fallback = { title: "fallback", account: "fallback", platform: "bilibili", locatorTerms: ["在这颗星球上"] };
  const identity = validatedIdentityFromIndexes({
    platform: "bilibili",
    titleLineIndexes: [4],
    accountLineIndexes: [1],
    contentKind: "video",
    confidence: 0.95
  }, lines, fallback);
  assert.equal(identity.title, lines[4]);
  assert.equal(identity.account, lines[1]);
  assert.equal(identity.identityProvider, "qwen-ocr-line-selector");
  assert.deepEqual(identity.locatorTerms, fallback.locatorTerms);
  assert.equal(validatedIdentityFromIndexes({
    platform: "bilibili",
    titleLineIndexes: [99],
    accountLineIndexes: [1],
    contentKind: "video",
    confidence: 0.99
  }, lines, fallback), fallback);
});

test("rejects Qwen Bilibili identity lines selected from danmaku", () => {
  const lines = [
    "@yivo.com",
    "好好好，就得这样子",
    "简介",
    "Unitree宇树科技",
    "充电",
    "已关注",
    "89.6万粉丝 97视频",
    "全模态实时交互驱动全身移动操作"
  ];
  const fallback = { title: lines[7], account: lines[3], platform: "bilibili" };
  assert.equal(validatedIdentityFromIndexes({
    platform: "bilibili",
    titleLineIndexes: [1],
    accountLineIndexes: [0],
    contentKind: "video",
    confidence: 0.99
  }, lines, fallback), fallback);
});

test("requires both title and UP match before accepting a Bilibili source", () => {
  const candidate = pickCandidate([
    { platform: "bilibili", title: "白粉、杠杆与镰刀：韩国黄金时代的47天", account: "另一个UP", url: "https://www.bilibili.com/video/BVwrong" },
    { platform: "bilibili", title: "白粉、杠杆与镰刀：韩国黄金时代的47天", account: "空山猎人", url: "https://www.bilibili.com/video/BVright" }
  ], {
    platform: "bilibili",
    title: "白粉、杠杆与镰刀：韩国黄金时",
    account: "空山猎人"
  });
  assert.equal(candidate.url, "https://www.bilibili.com/video/BVright");
  assert.ok(candidate.accountSimilarity >= 0.62);
  assert.ok(candidate.titleSimilarity >= 0.4);
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

test("extracts a multiline WeChat title and repeated account above a standalone date row", () => {
  const identity = extractScreenshotIdentity([
    "NeurIPS’26出分，分享一个135篇",
    "的超大样本",
    "具身智能之心 具身智能之心",
    "2026年7月24日 18:00 上海 听全文",
    "编辑丨具身智能之心",
    "NeurIPS 2026出分了。昨天开始陆续有人收到邮件",
    "朋友圈和群从凌晨就开始炸。",
    "写留言"
  ]);
  assert.equal(identity.platform, "wechat");
  assert.equal(identity.account, "具身智能之心");
  assert.equal(identity.title, "NeurIPS’26出分，分享一个135篇的超大样本");
  assert.match(identity.searchText, /昨天开始陆续有人收到邮件/);
});

test("extracts a WeChat publisher from a composite original-author row and ignores status OCR", () => {
  const identity = extractScreenshotIdentity([
    "18:426uc回",
    "北京说Agent已经能造世界，杭州却",
    "说它是刚发明的电灯泡",
    "原创 关注前沿科技 量子位",
    "2026年7月24日 18:26 北京 4人",
    "金磊 发自 凹非寺",
    "量子位 | 公众号 QbitAI",
    "你敢相信么，现在的AI，已经把横店给直接搞到了线上了！",
    "写留言"
  ]);
  assert.equal(identity.platform, "wechat");
  assert.equal(identity.account, "量子位");
  assert.equal(identity.title, "北京说Agent已经能造世界，杭州却说它是刚发明的电灯泡");
  assert.doesNotMatch(identity.title, /^18:42/);
  assert.match(identity.searchText, /已经把横店给直接搞到了线上/);
});

test("prefers a composite WeChat publisher row over the article editor", () => {
  const identity = extractScreenshotIdentity([
    "智元创新已启动赴港上市流程",
    "一财快讯 第一财经 2026年7月24日 18:24 上海",
    "7月24日，第一财经记者获悉，通用AI机器人企业已启动赴港上市流程。",
    "记者丨胡淑娟",
    "编辑丨钉钉",
    "第一财经官方公众号",
    "写留言"
  ]);
  assert.equal(identity.account, "第一财经");
  assert.equal(identity.title, "智元创新已启动赴港上市流程");
});

test("accepts the explicitly named original WeChat source as an account alias", () => {
  const identity = extractScreenshotIdentity([
    "历史新高！14位北大人受邀国际数学家大会作报告",
    "北大人 2026年7月24日 09:25 北京",
    "以下文章来源于北京大学，作者北京大学",
    "昨天，国际数学界迎来历史性的一刻。",
    "写留言"
  ]);
  assert.deepEqual(identity.accountAliases, ["北大人", "北京大学"]);
  const candidate = pickCandidate([{
    platform: "wechat",
    title: "历史新高！14位北大人受邀国际数学家大会作报告",
    account: "北京大学",
    snippet: "昨天，国际数学界迎来历史性的一刻。",
    url: "https://mp.weixin.qq.com/s/source"
  }], identity);
  assert.equal(candidate?.url, "https://mp.weixin.qq.com/s/source");
  assert.equal(candidate.accountSimilarity, 1);
});

test("keeps a single-character final line in a wrapped WeChat title", () => {
  const identity = extractScreenshotIdentity([
    "德明利：董事长承诺12个月内不减",
    "持",
    "财联社 2026年7月24日 18:53 上海",
    "德明利今日公告称，董事长承诺十二个月内不减持。",
    "写留言"
  ]);
  assert.equal(identity.account, "财联社");
  assert.equal(identity.title, "德明利：董事长承诺12个月内不减持");
});

test("extracts a Zhihu idea author, title, and visible body text", () => {
  const identity = extractScreenshotIdentity([
    "一花依世界",
    "量化金融爱好者",
    "已关注",
    "9人赞同了该想法",
    "小市值策略遭受暴击",
    "用垃圾因子库，使用树模型造了一个小市值策略。",
    "最近真是惨不忍睹呀",
    "评论17",
    "欢迎参与讨论"
  ]);
  assert.equal(identity.platform, "zhihu");
  assert.equal(identity.account, "一花依世界");
  assert.equal(identity.title, "小市值策略遭受暴击");
  assert.equal(identity.contentKind, "pin");
  assert.match(identity.searchText, /垃圾因子库/);
});

test("extracts a Zhihu answer author before its profile bio and ignores status OCR", () => {
  const identity = extractScreenshotIdentity([
    "21:43",
    "状态栏乱码",
    "邀请回答 写回答",
    "搞什么副业能赚钱？",
    "知乎 · 822个回答 · 2931个关注",
    "漂流少年 ◎",
    "不看私信、不接咨询、有问…",
    "+关注",
    "2.2万人赞同了该回答",
    "第一步：花10秒钟搞个正规授权",
    "第二步：去素材库白嫖3000G视频",
    "我在国企打工，下班发小说视频，一天能赚100多。"
  ]);
  assert.equal(identity.platform, "zhihu");
  assert.equal(identity.title, "搞什么副业能赚钱？");
  assert.equal(identity.account, "漂流少年");
  assert.equal(identity.contentKind, "answer");
  assert.match(identity.searchText, /花10秒钟搞个正规授权/);
  assert.doesNotMatch(identity.searchText, /不看私信/);
});

test("uses full visible article evidence to accept a matching source", () => {
  const candidate = pickCandidate([{
    platform: "wechat",
    title: "标题有少量OCR差异",
    account: "具身智能之心",
    snippet: "昨天开始陆续有人收到邮件，朋友圈和群从凌晨就开始炸。",
    url: "https://mp.weixin.qq.com/s/example"
  }], {
    platform: "wechat",
    title: "完全不同的标题识别结果",
    account: "具身智能之心",
    searchText: "NeurIPS 2026出分了。昨天开始陆续有人收到邮件，朋友圈和群从凌晨就开始炸。"
  });
  assert.equal(candidate?.url, "https://mp.weixin.qq.com/s/example");
  assert.ok(candidate.evidenceSimilarity >= 0.52);
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

test("returns an article overview instead of a video-only empty state", async () => {
  let overviewInput = null;
  const result = await runImageFlow({
    ocrText: "腾讯合并大语言模型和多模态团队\n界面新闻 2026年7月24日 14:34 上海\n阅读原文",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        platform: "wechat",
        title: "腾讯合并大语言模型和多模态团队",
        account: "界面新闻",
        url: "https://mp.weixin.qq.com/s/example"
      }]
    }),
    extract: async () => ({
      sourceTitle: "腾讯合并大语言模型和多模态团队",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      sourceAccount: "界面新闻",
      platform: "wechat",
      rawText: "腾讯将两个模型团队合并为基础模型部。",
      overviewText: "腾讯将混元多模态模型部门与大语言模型部门合并为基础模型部。",
      blocks: [{ id: "article-1", text: "腾讯将两个模型团队合并为基础模型部。" }],
      focus: { status: "timestamp_missing" }
    }),
    generate: async () => ({ summaryCard: { text: "团队合并" }, units: [] }),
    generateOverview: async (input) => {
      overviewInput = input;
      return { summary: "文章概览", highlights: ["组织合并", "协同研发"] };
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(overviewInput.contentType, "article");
  assert.equal(result.articleOverview.summary, "文章概览");
  assert.equal(result.contentOverview.summary, "文章概览");
  assert.equal(result.videoOverview, undefined);
});

test("falls back to verified caption and screenshot text when a video has no transcript", async () => {
  let generatedInput = null;
  const extractionError = new Error("这条视频没有识别到足够清晰的语音内容。");
  extractionError.code = "failed_extract_video";
  const result = await runImageFlow({
    includeDetails: true,
    ocrText: "智东西快讯\n丘成桐公开澄清：\n我菲尔兹奖时没入美国籍\n当时就是一个中国人",
    searcher: async (query) => ({
      provider: "tikhub",
      query,
      results: [{
        platform: "douyin",
        title: "丘成桐公开澄清：我菲尔兹奖时没入美国籍，当时就是一个中国人",
        url: "https://www.douyin.com/video/123",
        account: "智东西"
      }]
    }),
    extract: async () => { throw extractionError; },
    generate: async (input) => {
      generatedInput = input;
      return { summaryCard: { text: "丘成桐澄清获奖时的国籍情况。" }, units: [] };
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.sourceFallback, true);
  assert.equal(result.source.focus.status, "screenshot_text_fallback");
  assert.match(result.message, /没有可用字幕/);
  assert.match(generatedInput.rawText, /当时就是一个中国人/);
  assert.equal(result.details.source.extractionMeta.fastPath, "screenshot_text_fallback");
  assert.equal(result.videoOverview, undefined);
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
      assert.equal(JSON.parse(options.body).content_type, "0");
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
  assert.match(requestedUrl, /fetch_general_search_v1/);
  assert.equal(result.results[0].platform, "douyin");
  assert.equal(result.results[0].account, "云潮新闻");
  assert.equal(result.results[0].url, "https://www.douyin.com/video/76570001");
});

test("falls back to the hedged Douyin video search when general search is empty", async () => {
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
        if (String(url).includes("fetch_general_search_v1")) {
          return { ok: true, json: async () => ({ data: { data: [] } }) };
        }
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
    assert.equal(calls.some((url) => url.includes("fetch_general_search_v1")), true);
    assert.equal(calls.some((url) => url.includes("fetch_video_search_v1")), true);
  } finally {
    if (previous === undefined) delete process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS;
    else process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS = previous;
  }
});

test("cleans a Douyin date suffix from the OCR author and detects its comment UI", () => {
  const identity = extractScreenshotIdentity([
    "18:17",
    "咕咕嘎嘎",
    "搜索",
    "@虎纹章鱼。07月10日",
    "凑猫和凑鱼教你鉴定凑企鹅#凑企鹅",
    "期待你的评论"
  ]);
  assert.equal(identity.platform, "douyin");
  assert.equal(identity.account, "虎纹章鱼");
  assert.equal(identity.title, "凑猫和凑鱼教你鉴定凑企鹅#凑企鹅");
});

test("extracts a Xiaohongshu video author from the plain follow control", () => {
  const identity = extractScreenshotIdentity([
    "刘思哲2026高考690分（物理类）",
    "小飞侠彼湯",
    "第11题（压轴题）没有做出来",
    "佛山学而思",
    "关注",
    "7:44",
    "弹",
    "【高考690分，预估北大！】 刘思哲同学..展开",
    "说点什么....",
    "收藏",
    "抢首评"
  ]);
  assert.equal(identity.platform, "xiaohongshu");
  assert.equal(identity.account, "佛山学而思");
  assert.equal(identity.title, "【高考690分，预估北大！】 刘思哲同学");
  assert.equal(identity.contentKind, "video");
});

test("rejects a Xiaohongshu model account selected from video-frame text", () => {
  const lines = [
    "小飞侠彼湯",
    "优秀作品",
    "佛山学而思",
    "关注",
    "【高考690分，预估北大！】 刘思哲同学..展开",
    "说点什么....",
    "收藏"
  ];
  const fallback = { platform: "xiaohongshu", title: "正确标题", account: "佛山学而思" };
  const identity = validatedIdentityFromIndexes({
    platform: "xiaohongshu",
    titleLineIndexes: [4],
    accountLineIndexes: [0],
    contentKind: "video",
    confidence: 0.95
  }, lines, fallback);
  assert.deepEqual(identity, fallback);
});

test("extracts an English Xiaohongshu author and cleans emoji OCR noise from its caption", () => {
  const identity = extractScreenshotIdentity([
    "18:38",
    "Anmo Li",
    "关注",
    "弹",
    "cornell university 太厉害了0.9090°",
    "说点什么…",
    "109",
    "收藏"
  ]);
  assert.equal(identity.platform, "xiaohongshu");
  assert.equal(identity.account, "Anmo Li");
  assert.equal(identity.title, "cornell university 太厉害了");
  assert.equal(identity.contentKind, "video");
});

test("retries Xiaohongshu with title only while retaining strict author matching", async () => {
  const queries = [];
  const result = await runImageFlow({
    ocrText: "Anmo Li\n关注\n弹\ncornell university 太厉害了\n说点什么…",
    refineIdentity: async (_lines, fallback) => fallback,
    searcher: async (query) => {
      queries.push(query);
      return {
        provider: "tikhub",
        query,
        results: query === "cornell university 太厉害了"
          ? [{
              platform: "xiaohongshu",
              kind: "video",
              title: "cornell university 太厉害了",
              account: "Anmo Li",
              url: "https://www.xiaohongshu.com/explore/xhs-right"
            }]
          : []
      };
    },
    extract: async ({ sourceUrl, sourceTitle }) => ({
      sourceTitle,
      sourceUrl,
      sourceAccount: "Anmo Li",
      platform: "xiaohongshu",
      rawText: sourceTitle,
      overviewText: sourceTitle,
      blocks: [{ id: "b1", text: sourceTitle }],
      overviewBlocks: [],
      focus: { status: "caption" }
    }),
    generate: async () => ({ summaryCard: { text: "ok" }, units: [] }),
    generateOverview: async () => ({ summary: "ok", keyPoints: [] })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.link.url, "https://www.xiaohongshu.com/explore/xhs-right");
  assert.deepEqual(new Set(queries), new Set(["Anmo Li cornell university 太厉害了", "cornell university 太厉害了"]));
});

test("uses Douyin user search and creator posts for duplicate-name author fallback", async () => {
  const calls = [];
  const result = await searchLinks("虎纹章鱼 凑猫和凑鱼教你鉴定凑企鹅", {
    platform: "douyin",
    account: "虎纹章鱼",
    creatorFallback: true,
    tikhubApiKey: "test-key",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("fetch_general_search_v1")) {
        return { ok: true, json: async () => ({ data: { data: [] } }) };
      }
      if (String(url).includes("fetch_video_search_")) {
        return { ok: true, json: async () => ({ data: { data: [] } }) };
      }
      if (String(url).includes("fetch_user_search")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              user_list: [{
                dynamic_patch: {
                  raw_data: JSON.stringify({ user_info: { nickname: "虎纹章鱼", sec_uid: "sec-target", follower_count: 100 } })
                }
              }]
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            aweme_list: [{
              aweme_id: "creator-hit",
              desc: "凑猫和凑鱼教你鉴定凑企鹅#凑企鹅",
              author: { nickname: "虎纹章鱼" }
            }]
          }
        })
      };
    }
  });
  assert.equal(result.results.find((item) => item.discovery === "creator_posts")?.url, "https://www.douyin.com/video/creator-hit");
  assert.equal(calls.some((url) => url.includes("fetch_user_post_videos")), true);
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
