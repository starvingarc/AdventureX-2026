import { recognizeImage } from "./ocr.js";
import { searchLinks } from "./search.js";
import { extractFocusedSourceContent, isVideoUrl } from "./source.js";
import { generateQuickReviewPath, generateVideoOverview } from "./review.js";

export async function runImageFlow({
  imagePath = "",
  imageBase64 = "",
  ocrText = "",
  ocrLines = [],
  sourceUrl = "",
  publicMediaBaseUrl = "",
  includeDetails = false,
  onProgress = null,
  searcher = searchLinks,
  ocr = recognizeImage,
  extract = extractFocusedSourceContent,
  generate = generateQuickReviewPath,
  generateOverview = generateVideoOverview
} = {}) {
  const flowStartedAt = Date.now();
  reportProgress(onProgress, { stage: "ocr", message: "正在识别截图中的标题与博主", percent: 5 });
  const timings = {};
  const inputStartedAt = Date.now();
  const path = imagePath || (imageBase64 ? await materializeImage(imageBase64) : "");
  timings.inputPreparationMs = Date.now() - inputStartedAt;
  if (!path && !ocrText) throw new Error("缺少截图内容或 OCR 文本。");
  const ocrStartedAt = Date.now();
  const ocrResult = ocrText
    ? { provider: "apple-vision", text: String(ocrText).trim(), lines: Array.isArray(ocrLines) && ocrLines.length > 0 ? ocrLines : String(ocrText).split(/\r?\n/) }
    : await ocr(path);
  timings.ocrMs = Date.now() - ocrStartedAt;
  const identity = extractScreenshotIdentity(ocrResult.lines || ocrResult.text);
  reportProgress(onProgress, {
    stage: "search",
    message: "截图识别完成，正在用 TikHub 核对来源",
    percent: 20,
    partial: { identity }
  });
  const queries = buildSearchQueries(identity);
  const query = queries[0] || "";
  const searchStartedAt = Date.now();
  const resolvedSearch = sourceUrl
    ? { search: { provider: "input", query, results: [{ title: "用户指定链接", url: sourceUrl, snippet: "" }] }, candidate: { title: "用户指定链接", url: sourceUrl, snippet: "" } }
    : await searchScreenshotSource({ identity, queries, searcher });
  timings.searchMs = Date.now() - searchStartedAt;
  const search = resolvedSearch.search;
  const candidate = resolvedSearch.candidate;
  const result = {
    status: "ocr_completed",
    ocr: {
      provider: ocrResult.provider,
      latencyMs: ocrResult.latencyMs || null,
      fallback: ocrResult.fallback || null,
      identity
    },
    query,
    search,
    timings
  };
  if (includeDetails) {
    result.details = {
      ocr: {
        text: ocrResult.text || "",
        lines: Array.isArray(ocrResult.lines) ? ocrResult.lines : []
      },
      searchQueries: queries
    };
  }
  if (!candidate) {
    timings.totalMs = Date.now() - flowStartedAt;
    return {
      ...result,
      status: search.errorCode || "search_match_low_confidence",
      message: search.errorCode
        ? "已识别截图，但尚未配置可用的搜索 API。"
        : "没有找到标题和博主均可信的来源链接，已停止生成，避免保存错误内容。"
    };
  }

  result.link = candidate;
  reportProgress(onProgress, {
    stage: "extract",
    message: "已找到来源，正在并发转写代表片段；少量片段成功后立即继续",
    percent: 40,
    partial: { identity, link: publicCandidate(candidate) }
  });
  const sourceType = isVideoUrl(candidate.url) ? "video_link" : "article_link";
  try {
    const extractionStartedAt = Date.now();
    const source = await extract({
      sourceType,
      sourceUrl: candidate.url,
      sourceTitle: candidate.title,
      rawText: candidate.snippet,
      timestampSeconds: identity.timestampSeconds,
      locatorTerms: identity.locatorTerms,
      preferredLanguage: inferAsrLanguageHint(identity, candidate),
      publicMediaBaseUrl
    });
    timings.sourceExtractionMs = Date.now() - extractionStartedAt;
    result.source = {
      sourceType,
      title: source.sourceTitle,
      url: source.sourceUrl,
      account: source.sourceAccount,
      textLength: String(source.rawText || "").length,
      platform: source.platform,
      focus: source.focus || null
    };
    if (includeDetails) {
      result.details.source = {
        rawText: source.rawText || "",
        overviewText: source.overviewText || "",
        blocks: Array.isArray(source.blocks) ? source.blocks : [],
        overviewBlocks: Array.isArray(source.overviewBlocks) ? source.overviewBlocks : [],
        transcriptSegments: Array.isArray(source.learningSource?.transcriptSegments)
          ? source.learningSource.transcriptSegments
          : [],
        extractionMeta: source.learningSource?.extractionMeta || null
      };
    }
    const reviewInput = {
      id: `image-${Date.now()}`,
      title: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceAccount: source.sourceAccount,
      rawText: source.rawText,
      blocks: source.blocks
    };
    reportProgress(onProgress, {
      stage: "generate",
      message: "内容已提取，正在生成截图知识卡和全片总结",
      percent: 82,
      partial: {
        identity,
        link: publicCandidate(candidate),
        source: {
          title: source.sourceTitle,
          account: source.sourceAccount,
          url: source.sourceUrl,
          platform: source.platform,
          focus: source.focus || null
        }
      }
    });
    const reviewRequest = measureAsync(timings, "reviewGenerationMs", () => generate(reviewInput));
    const overviewRequest = sourceType === "video_link"
      ? measureAsync(timings, "overviewGenerationMs", () => generateOverview({ title: source.sourceTitle, account: source.sourceAccount, rawText: source.overviewText }))
      : null;
    const generationStartedAt = Date.now();
    const [review, videoOverview] = await Promise.all([reviewRequest, overviewRequest]);
    timings.generationWallMs = Date.now() - generationStartedAt;
    result.review = review;
    if (videoOverview) result.videoOverview = videoOverview;
    result.status = "completed";
    reportProgress(onProgress, { stage: "completed", message: "复习卡已生成", percent: 100 });
  } catch (error) {
    if (timings.sourceExtractionMs === undefined) timings.sourceExtractionMs = Date.now() - (flowStartedAt + timings.inputPreparationMs + timings.ocrMs + timings.searchMs);
    result.error = { code: error?.code || "source_extract_failed", message: error?.message || "来源内容提取失败。", provider: error?.provider || null };
    result.status = result.error.code;
    reportProgress(onProgress, { stage: "failed", message: result.error.message, percent: 100 });
  }
  timings.totalMs = Date.now() - flowStartedAt;
  return result;
}

function inferAsrLanguageHint(identity, candidate) {
  const evidence = `${identity?.title || ""} ${identity?.account || ""} ${candidate?.title || ""}`;
  const chineseCharacters = (evidence.match(/[\u3400-\u9fff]/g) || []).length;
  const latinLetters = (evidence.match(/[a-z]/gi) || []).length;
  // This is a hint, not a platform-wide language lock. Non-Chinese screenshots
  // keep automatic detection, while clearly Chinese screenshots skip Whisper's
  // language-detection pass and improve recognition of Chinese proper nouns.
  return chineseCharacters >= 6 && chineseCharacters >= latinLetters ? "zh" : "auto";
}

function publicCandidate(candidate) {
  return {
    platform: candidate?.platform || "",
    title: candidate?.title || "",
    account: candidate?.account || "",
    url: candidate?.url || "",
    matchScore: Number(candidate?.matchScore) || 0
  };
}

function reportProgress(handler, progress) {
  try { handler?.(progress); } catch { /* progress reporting must not break the flow */ }
}

async function measureAsync(timings, key, operation) {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

export function buildSearchQuery(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return [input.title, input.account].filter(Boolean).join(" ").slice(0, 160);
  }
  return buildSearchQuery(extractScreenshotIdentity(input));
}

export function buildSearchQueries(identity) {
  const title = normalizeSearchTitle(identity?.title);
  const account = String(identity?.account || "").trim();
  const rawTitle = title.replace(/【[^】]*】/g, "").trim();
  const titleSegments = rawTitle.split(/[：:，,。！？!?]+/).map((item) => item.trim()).filter(Boolean);
  const plainTitle = titleSegments.join(" ");
  const firstTitleSegment = (titleSegments[0] || plainTitle).slice(0, 24);
  const edition = rawTitle.match(/第[一二三四五六七八九十0-9]+季|第\d+[期集]|[上下]集/)?.[0] || "";
  const anchorTitle = [firstTitleSegment, firstTitleSegment.includes(edition) ? "" : edition].filter(Boolean).join(" ");
  // One concise account + title-anchor query is faster and proved more stable
  // than firing several long variants at TikHub. Candidate ranking still uses
  // the complete OCR title and account below.
  return [[account, anchorTitle].filter(Boolean).join(" ") || title || plainTitle].filter(Boolean);
}

async function searchScreenshotSource({ identity, queries, searcher }) {
  const [primaryQuery] = queries;
  const preferredPlatform = identity?.platform || "";
  const primarySearch = await searcher(primaryQuery, { platform: preferredPlatform });
  const primaryCandidate = pickCandidate(primarySearch.results, identity);
  const attempts = [{ query: primaryQuery, resultCount: Array.isArray(primarySearch.results) ? primarySearch.results.length : 0, matched: Boolean(primaryCandidate) }];
  if (primaryCandidate && isStrongCandidate(primaryCandidate)) {
    return { search: { ...primarySearch, query: primaryQuery, attempts }, candidate: primaryCandidate };
  }
  const fallbackSearches = await Promise.all(queries.slice(1).map(async (query) => {
    try {
      return await searcher(query, { platform: preferredPlatform });
    } catch (error) {
      return { provider: primarySearch.provider, query, results: [], errorCode: error?.code || "search_failed" };
    }
  }));
  const allResults = dedupeSearchResults([
    ...(primarySearch.results || []),
    ...fallbackSearches.flatMap((search) => search.results || [])
  ]);
  let candidate = pickCandidate(allResults, identity);
  attempts.push(...fallbackSearches.map((search) => ({
    query: search.query,
    resultCount: Array.isArray(search.results) ? search.results.length : 0,
    matched: Boolean(pickCandidate(search.results, identity))
  })));
  if ((!candidate || !isStrongCandidate(candidate)) && preferredPlatform === "bilibili" && identity?.account) {
    try {
      const creatorSearch = await searcher(primaryQuery, {
        platform: "bilibili",
        account: identity.account,
        creatorFallback: true
      });
      const creatorResults = (creatorSearch.results || []).filter((item) => item.discovery === "creator_posts");
      allResults.push(...creatorResults.filter((item) => !allResults.some((existing) => existing.url === item.url)));
      candidate = pickCandidate(allResults, identity);
      attempts.push({
        query: `${identity.account}（UP主投稿兜底）`,
        resultCount: creatorResults.length,
        matched: Boolean(candidate)
      });
    } catch {
      attempts.push({ query: `${identity.account}（UP主投稿兜底）`, resultCount: 0, matched: false });
    }
  }
  if (!candidate && preferredPlatform) {
    try {
      const crossPlatformSearch = await searcher(primaryQuery, { platform: "" });
      allResults.push(...dedupeSearchResults([
        ...allResults,
        ...(crossPlatformSearch.results || [])
      ]).filter((item) => !allResults.some((existing) => existing.url === item.url)));
      candidate = pickCandidate(allResults, identity);
      attempts.push({
        query: `${primaryQuery}（跨平台兜底）`,
        resultCount: Array.isArray(crossPlatformSearch.results) ? crossPlatformSearch.results.length : 0,
        matched: Boolean(candidate)
      });
    } catch {
      attempts.push({ query: `${primaryQuery}（跨平台兜底）`, resultCount: 0, matched: false });
    }
  }
  return { search: { ...primarySearch, query: primaryQuery, results: allResults, attempts }, candidate };
}

function isStrongCandidate(candidate) {
  return Number(candidate?.titleSimilarity) >= 0.58 || Number(candidate?.matchScore) >= 0.75;
}

function dedupeSearchResults(items) {
  return items.filter((item, index) => item?.url && items.findIndex((candidate) => candidate?.url === item.url) === index);
}

function normalizeSearchTitle(value) {
  return String(value || "").replace(/[.。…]+$/g, "").trim();
}

export function extractScreenshotIdentity(input) {
  const lines = Array.isArray(input) ? input : String(input || "").split(/\r?\n/);
  const cleaned = lines.map((line) => String(line || "").replace(/\s+/g, " ").trim());
  const usable = cleaned.filter((line) => isContentLine(line));
  const platform = inferPlatform(cleaned);
  const explicitAccount = findShortVideoAccount(cleaned);
  const shortVideoTitle = platform === "bilibili"
    ? findBilibiliTitle(cleaned, explicitAccount)
    : findShortVideoTitle(cleaned, explicitAccount);
  const title = shortVideoTitle ? { line: shortVideoTitle, score: 24 } : [...usable]
    .map((line, index) => ({ line, index, score: titleScore(line) }))
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length)[0];
  const titleIndex = title ? cleaned.indexOf(title.line) : -1;
  const account = explicitAccount || findAccount(cleaned, titleIndex);
  return {
    title: title?.line || "",
    account,
    timestampSeconds: findPlayerTimestamp(cleaned),
    platform,
    locatorTerms: usable.filter((line) => line !== title?.line && line !== account).slice(0, 8),
    confidence: title?.line ? Math.min(1, title.score / 20) : 0
  };
}

function findBilibiliTitle(lines, account) {
  const accountIndex = account
    ? lines.findIndex((line) => normalizeAccountLine(line).includes(normalizeAccountLine(account)))
    : -1;
  if (accountIndex < 0) return "";
  for (const rawLine of lines.slice(accountIndex + 1, accountIndex + 14)) {
    const line = rawLine
      .replace(/\s+\d+(?:\.\d+)?\s*万?播放.*$/, "")
      .replace(/[.。…\s]*展开\s*[~～>〉]?$/, "")
      .trim();
    if (line.length < 4 || !/[\u4e00-\u9fff]{2}/.test(line)) continue;
    if (isUiChrome(line) || /(含虚构|演绎内容|请勿模仿|不良引导)/.test(line)) continue;
    if (/^(?:详情页|发弹幕|视频提及|合集)/.test(line)) continue;
    return line;
  }
  return "";
}

function findShortVideoAccount(lines) {
  for (const line of lines) {
    const explicit = line.match(/^@\s*([^\s]+(?:\s+[^\s]+)?)/);
    if (explicit) return explicit[1].replace(/\s+[vV]$/, "").trim();
  }
  const followIndex = lines.findIndex((line) => /^(?:\+\s*)?关注$/.test(line));
  if (followIndex > 0) {
    const before = lines[followIndex - 1].replace(/^[@#•·J\s]+/, "").trim();
    if (isLikelyAccount(before)) return before;
  }
  for (const line of lines) {
    const audio = line.match(/(?:^|\s)([^|｜]{2,18})的原声(?:\s|[|｜]|$)/);
    if (audio && isLikelyAccount(audio[1].trim())) return audio[1].trim();
  }
  return "";
}

function findShortVideoTitle(lines, account) {
  const accountIndex = account
    ? lines.findIndex((line) => normalizeAccountLine(line).includes(normalizeAccountLine(account)))
    : -1;
  if (accountIndex >= 0) {
    const caption = lines.slice(accountIndex + 1, accountIndex + 7)
      .map(stripExpandSuffix)
      .find((line) => isContentLine(line) && !/^\d+(?:\.\d+)?[万亿]?$/.test(line));
    if (caption) return caption;
  }
  const expanded = lines.map(stripExpandSuffix).find((line, index) => (
    /展开\s*[~～>〉]?$/.test(lines[index]) && isContentLine(line)
  ));
  return expanded || "";
}

function normalizeAccountLine(value) {
  return String(value || "").replace(/^[@#•·J\s]+/, "").replace(/\s+[vV]$/, "").trim();
}

function stripExpandSuffix(value) {
  return String(value || "").replace(/[.。…\s]*展开\s*[~～>〉]?$/, "").trim();
}

function isLikelyAccount(value) {
  return value.length >= 2 && value.length <= 18 && /[\u4e00-\u9fffA-Za-z]/.test(value) && !isUiChrome(value);
}

function isContentLine(line) {
  return line.length >= 2
    && /[\u4e00-\u9fffA-Za-z]{2,}/.test(line)
    && !isUiChrome(line)
    && !/^(\d{1,2}:\d{2}|\d+[万亿]?[播放粉丝赞]|\d+视频)$/.test(line);
}

function isUiChrome(line) {
  return /(简介|评论|充电|已关注|关注|分享|收藏|不喜欢|正在看|播放|弹幕|分钟|点赞|立即打开|点我发弹幕|粉丝|\d+视频)/.test(line);
}

function titleScore(line) {
  let score = Math.min(12, line.length / 2);
  if (/【[^】]+】/.test(line)) score += 12;
  if (/[：:]/.test(line)) score += 3;
  if (/Top\s*\d+|年度|盘点|全球|策略|财经|股市|投资|教程|分析/i.test(line)) score += 4;
  if (line.length > 64) score -= 6;
  return score;
}

function findAccount(lines, titleIndex) {
  const nearby = lines.slice(Math.max(0, titleIndex - 10), Math.max(0, titleIndex));
  return nearby.reverse().find((line) => isContentLine(line)
    && line.length <= 18
    && !/[：:【】]/.test(line)
    && !isUiChrome(line)
    && !/\d+(?:\.\d+)?\s*(?:万|亿)?(?:粉丝|播放|视频|点赞|评论)/.test(line)
    && !/财经跨年|年度盘点|中国财经年/.test(line)) || "";
}

function findPlayerTimestamp(lines) {
  for (const line of lines) {
    const match = line.match(/(?:进度|播放)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*\/\s*\d{1,2}:\d{2}/);
    if (!match) continue;
    const [, first, second, third] = match;
    return third ? Number(first) * 3600 + Number(second) * 60 + Number(third) : Number(first) * 60 + Number(second);
  }
  return null;
}

function inferPlatform(lines) {
  const text = lines.join(" ");
  if (/bilibili|bilbili|\bbili\b|哔哩|B站|充电|弹幕/i.test(text)) return "bilibili";
  if (/小红书|xhs/i.test(text)) return "xiaohongshu";
  if (/抖音|douyin/i.test(text)) return "douyin";
  if (/首页[:：]?\s*朋友.*消息.*我|发同款|的原声|\b热点\b/i.test(text)) return "douyin";
  if (/youtube/i.test(text)) return "youtube";
  return "";
}

export function pickCandidate(results, identity) {
  const items = Array.isArray(results) ? results : [];
  const ranked = items.map((item) => ({ ...item, ...scoreCandidate(item, identity) }))
    .sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0];
  if (!best) return null;
  const trustworthy = best.titleSimilarity >= 0.58
    || (best.accountSimilarity >= 0.78 && best.titleSimilarity >= 0.26)
    || (best.platformSimilarity === 1 && best.titleSimilarity >= 0.42)
    || best.matchScore >= 0.62;
  return trustworthy ? best : null;
}

function scoreCandidate(item, identity) {
  // Overlay subtitles and watermarks are useful later for timestamp location,
  // but must not influence source-title matching.
  const titleSimilarity = textSimilarity(item?.title, identity?.title);
  const accountSimilarity = identity?.account
    ? textSimilarity([item?.account, item?.snippet].filter(Boolean).join(" "), identity.account)
    : 0;
  const candidatePlatform = item?.platform || platformFromUrl(item?.url);
  const platformSimilarity = identity?.platform && candidatePlatform === identity.platform ? 1 : 0;
  return {
    matchScore: titleSimilarity * 0.7 + accountSimilarity * 0.25 + platformSimilarity * 0.05,
    titleSimilarity,
    accountSimilarity,
    platformSimilarity
  };
}

function platformFromUrl(value) {
  const url = String(value || "").toLowerCase();
  if (url.includes("bilibili.com")) return "bilibili";
  if (url.includes("douyin.com")) return "douyin";
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com")) return "xiaohongshu";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return "";
}

function textSimilarity(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  const gramsA = ngrams(a);
  const gramsB = ngrams(b);
  const common = [...gramsA].filter((item) => gramsB.has(item)).length;
  return (2 * common) / (gramsA.size + gramsB.size || 1);
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^\u4e00-\u9fff0-9a-z]/g, "");
}

function ngrams(value) {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

async function materializeImage(imageBase64) {
  if (!imageBase64) return "";
  const data = String(imageBase64).replace(/^data:image\/[^;]+;base64,/, "");
  const path = `/tmp/shibei-image-${Date.now()}.jpg`;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, Buffer.from(data, "base64")));
  return path;
}
