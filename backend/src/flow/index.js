import { analyzeScreenshotImage, analyzeUnsourcedScreenshotImage } from "./vision.js";
import { enabledCapturePlatforms, searchLinks } from "./search.js";
import { extractFocusedSourceContent, isVideoUrl } from "./source.js";
import { generateVideoOverview } from "./review.js";
import { buildMemoryCard, buildMemoryFragment } from "./memoryCard.js";
import {
  buildCaptureDisposition,
  generateCaptureMemoryCard,
  serializeLegacyMemoryCard,
  serializeLegacyReview
} from "./captureMemoryCard.js";

const IMAGE_FLOW_INTERNAL_EVIDENCE = Symbol("recallo.imageFlow.internalEvidence");

export function imageFlowInternalEvidence(result) {
  const evidence = result?.[IMAGE_FLOW_INTERNAL_EVIDENCE];
  return Array.isArray(evidence) ? structuredClone(evidence) : [];
}

export async function runImageFlow({
  imagePath = "",
  imageBase64 = "",
  mimeType = "",
  ocrText = "",
  ocrLines = [],
  sourceUrl = "",
  publicMediaBaseUrl = "",
  includeDetails = false,
  onProgress = null,
  searcher = searchLinks,
  analyzeImage = analyzeScreenshotImage,
  analyzeUnsourcedImage = analyzeUnsourcedScreenshotImage,
  extract = extractFocusedSourceContent,
  generate = null,
  generateMemory = generateCaptureMemoryCard,
  generateOverview = generateVideoOverview,
  enabledPlatforms = enabledCapturePlatforms(process.env.CAPTURE_PLATFORMS)
} = {}) {
  const flowStartedAt = Date.now();
  reportProgress(onProgress, { stage: "vision", message: "正在理解截图中的平台、标题与作者", percent: 5 });
  const timings = {};
  if (!imagePath && !imageBase64 && !ocrText) throw flowError("screenshot_image_missing", "缺少截图内容。");
  const analysisStartedAt = Date.now();
  const captureAnalysis = ocrText
    ? buildProvidedTextAnalysis(ocrText, ocrLines)
    : await analyzeImage({ imagePath, imageBase64, mimeType });
  timings.visionMs = Date.now() - analysisStartedAt;
  const identity = captureAnalysis.identity || extractScreenshotIdentity(captureAnalysis.lines || captureAnalysis.text);
  const sourcePlatform = platformFromUrl(sourceUrl);
  const allowedPlatforms = new Set(normalizeEnabledPlatforms(enabledPlatforms));
  if (sourceUrl && !sourcePlatform) {
    timings.totalMs = Date.now() - flowStartedAt;
    const response = {
      status: "platform_not_supported",
      message: "当前截图流程只接受 B站、抖音或小红书来源链接。",
      capture: serializeCaptureAnalysis(captureAnalysis, identity),
      timings
    };
    return attachFragmentContracts(response);
  }
  if (sourcePlatform && !allowedPlatforms.has(sourcePlatform)) {
    timings.totalMs = Date.now() - flowStartedAt;
    const response = {
      status: "platform_not_supported",
      message: `${platformLabel(sourcePlatform)}截图 adapter 当前未启用。`,
      capture: serializeCaptureAnalysis(captureAnalysis, identity),
      timings
    };
    return attachFragmentContracts(response);
  }
  if (identity.platform && identity.platform !== "unknown" && !allowedPlatforms.has(identity.platform)) {
    timings.totalMs = Date.now() - flowStartedAt;
    const response = {
      status: "platform_not_supported",
      message: `${platformLabel(identity.platform)}截图 adapter 当前未启用。`,
      capture: serializeCaptureAnalysis(captureAnalysis, identity),
      timings
    };
    return attachFragmentContracts(response);
  }
  if (sourcePlatform && isKnownPlatform(identity.platform) && sourcePlatform !== identity.platform) {
    timings.totalMs = Date.now() - flowStartedAt;
    const response = {
      status: "source_platform_mismatch",
      message: `截图识别为${platformLabel(identity.platform)}，但指定链接来自${platformLabel(sourcePlatform)}，已停止处理。`,
      capture: serializeCaptureAnalysis(captureAnalysis, identity),
      timings
    };
    return attachFragmentContracts(response);
  }
  reportProgress(onProgress, { stage: "search", message: "截图理解完成，正在用 TikHub 核对内容来源", percent: 20 });
  const queries = buildSearchQueries(identity);
  const query = queries[0] || "";
  const searchStartedAt = Date.now();
  const resolvedSearch = sourceUrl
    ? {
        search: {
          provider: "input",
          query,
          platforms: [sourcePlatform],
          results: [{
            title: identity.title || "用户指定链接",
            url: sourceUrl,
            account: identity.account || "",
            snippet: "",
            platform: sourcePlatform,
            contentKind: identity.contentKind || "unknown"
          }]
        },
        candidate: {
          title: identity.title || "用户指定链接",
          url: sourceUrl,
          account: identity.account || "",
          snippet: "",
          platform: sourcePlatform,
          contentKind: identity.contentKind || "unknown"
        }
      }
    : await searchScreenshotSource({ identity, queries, searcher, enabledPlatforms: [...allowedPlatforms] });
  timings.searchMs = Date.now() - searchStartedAt;
  const search = resolvedSearch.search;
  const candidate = resolvedSearch.candidate;
  const result = {
    status: "vision_completed",
    capture: serializeCaptureAnalysis(captureAnalysis, identity),
    query,
    search,
    timings
  };
  if (includeDetails) {
    result.details = {
      capture: {
        text: captureAnalysis.text || "",
        lines: Array.isArray(captureAnalysis.lines) ? captureAnalysis.lines : []
      },
      searchQueries: queries
    };
  }
  if (!candidate) {
    try {
      reportProgress(onProgress, {
        stage: "generate",
        message: "未找到可信 TikHub 来源，正在由 Qwen Plus 根据截图生成 3 张卡片",
        percent: 68
      });
      const unsourcedAnalysis = await measureAsync(
        timings,
        "unsourcedVisionMs",
        () => analyzeUnsourcedImage({
          imagePath,
          imageBase64,
          mimeType,
          ocrText: captureAnalysis.text || captureAnalysis.lines?.join("\n") || ""
        })
      );
      const evidence = buildUnsourcedScreenshotEvidence(unsourcedAnalysis);
      setImageFlowInternalEvidence(result, evidence);
      const provenance = {
        status: "not_found",
        provider: "tikhub",
        sourceStatus: "unsourced_image",
        label: "未找到 TikHub 原始来源",
        fallbackProvider: unsourcedAnalysis.provider,
        fallbackModel: unsourcedAnalysis.model
      };
      result.sourceStatus = "unsourced_image";
      result.provenance = provenance;
      result.source = {
        sourceType: "screenshot",
        sourceStatus: "unsourced_image",
        title: unsourcedAnalysis.title || identity.title || "未溯源截图",
        url: "",
        account: unsourcedAnalysis.account || identity.account || "",
        textLength: evidence.map((item) => item.text).join("\n").length,
        platform: unsourcedAnalysis.platform !== "unknown" ? unsourcedAnalysis.platform : identity.platform,
        focus: { status: "qwen_plus_visual_fallback" },
        provenance
      };
      const memoryGeneration = {
        captureAnalysis: await measureAsync(timings, "reviewGenerationMs", () => generateMemory({
          evidence,
          // The screenshot evidence is grounded, while the external source remains unresolved.
          sourceStatus: "partial",
          sourceTitle: result.source.title,
          sourceAccount: result.source.account,
          sourceUrl: "",
          source: result.source
        })),
        evidence
      };
      if (memoryGeneration.captureAnalysis?.disposition !== "create_card"
        || memoryGeneration.captureAnalysis?.memoryCard?.recallVariants?.length !== 3) {
        throw flowError(
          "unsourced_card_generation_failed",
          memoryGeneration.captureAnalysis?.decisionReason || "Qwen Plus 没有生成 3 张可验证卡片。"
        );
      }
      memoryGeneration.captureAnalysis.provenance = provenance;
      memoryGeneration.captureAnalysis.memoryCard.provenance = provenance;
      applyMemoryGenerationResult(result, memoryGeneration);
      if (result.review?.source) result.review.source.provenance = provenance;
      result.contentOverview = {
        summary: unsourcedAnalysis.summary,
        highlights: unsourcedAnalysis.keyPoints,
        provenance
      };
      result.imageOverview = result.contentOverview;
      result.status = "completed";
      result.message = "未找到 TikHub 原始来源；已由 Qwen Plus 仅根据截图生成 3 张卡片。";
      if (includeDetails) {
        result.details.unsourcedImage = {
          provider: unsourcedAnalysis.provider,
          model: unsourcedAnalysis.model,
          summary: unsourcedAnalysis.summary,
          keyPoints: unsourcedAnalysis.keyPoints,
          cardCount: 3
        };
      }
      reportProgress(onProgress, {
        stage: "completed",
        message: "未溯源截图的 3 张复习卡已生成",
        percent: 100
      });
      timings.totalMs = Date.now() - flowStartedAt;
      return result;
    } catch (fallbackError) {
      timings.totalMs = Date.now() - flowStartedAt;
      const response = {
        ...result,
        status: search.errorCode || "search_match_low_confidence",
        sourceStatus: "unsourced_image_fallback_failed",
        provenance: {
          status: "not_found",
          provider: "tikhub",
          sourceStatus: "unsourced_image",
          label: "未找到 TikHub 原始来源",
          fallbackStatus: "failed"
        },
        fallbackError: {
          code: fallbackError?.code || "unsourced_image_fallback_failed",
          message: fallbackError?.message || "Qwen Plus 截图降级失败。"
        },
        message: "未找到可信 TikHub 来源，Qwen Plus 截图降级也未完成。"
      };
      return attachFragmentContracts(response);
    }
  }

  result.link = candidate;
  reportProgress(onProgress, { stage: "extract", message: "已找到来源，正在并发转写代表片段；少量片段成功后立即继续", percent: 40 });
  const sourceType = sourceTypeForCandidate(candidate, identity);
  try {
    const extractionStartedAt = Date.now();
    const source = await extract({
      sourceType,
      sourceUrl: candidate.url,
      sourceTitle: candidate.title,
      rawText: candidate.snippet,
      timestampSeconds: identity.timestampSeconds,
      locatorTerms: identity.locatorTerms,
      publicMediaBaseUrl,
      screenshotText: String(
        captureAnalysis.text
        || captureAnalysis.lines?.join("\n")
        || identity.visibleTextLines?.join("\n")
        || ""
      ).trim(),
      forceTikHubContent: sourceType === "article_link"
        && (candidate.platform || identity.platform) === "xiaohongshu"
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
    const evidence = evidenceForSource(source);
    setImageFlowInternalEvidence(result, evidence);
    const reviewInput = {
      id: `image-${Date.now()}`,
      title: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      sourceAccount: source.sourceAccount,
      rawText: source.rawText,
      blocks: source.blocks
    };
    reportProgress(onProgress, { stage: "generate", message: "内容已提取，正在生成截图知识卡和全片总结", percent: 82 });
    const memoryRequest = measureAsync(timings, "reviewGenerationMs", async () => (
      generate
        ? { legacyReview: await generate(reviewInput), evidence }
        : {
            captureAnalysis: await generateMemory({
              evidence,
              sourceStatus: "verified",
              sourceTitle: source.sourceTitle,
              sourceAccount: source.sourceAccount,
              sourceUrl: source.sourceUrl,
              source: result.source,
              link: result.link
            }),
            evidence
          }
    ));
    const overviewRequest = sourceType === "video_link"
      ? measureAsync(timings, "overviewGenerationMs", () => generateOverview({ title: source.sourceTitle, account: source.sourceAccount, rawText: source.overviewText }))
      : null;
    const generationStartedAt = Date.now();
    const [memoryGeneration, videoOverview] = await Promise.all([memoryRequest, overviewRequest]);
    timings.generationWallMs = Date.now() - generationStartedAt;
    if (videoOverview) result.videoOverview = videoOverview;
    result.status = "completed";
    applyMemoryGenerationResult(result, memoryGeneration);
    reportProgress(onProgress, { stage: "completed", message: "复习卡已生成", percent: 100 });
  } catch (error) {
    if (timings.sourceExtractionMs === undefined) {
      timings.sourceExtractionMs = Date.now() - (
        flowStartedAt
        + timings.visionMs
        + timings.searchMs
      );
    }
    result.error = { code: error?.code || "source_extract_failed", message: error?.message || "来源内容提取失败。", provider: error?.provider || null };
    result.status = result.error.code;
    const screenshotEvidence = buildScreenshotEvidence(captureAnalysis, identity);
    if (result.error.code === "failed_extract_video" && screenshotEvidence.length >= 24) {
      try {
        reportProgress(onProgress, { stage: "generate", message: "视频转写不可用，正在只依据截图可见内容生成记忆卡", percent: 82 });
        const fallbackEvidence = [{
          id: "screenshot-visible",
          type: "screenshot",
          text: screenshotEvidence
        }];
        setImageFlowInternalEvidence(result, fallbackEvidence);
        result.source = {
          sourceType: "screenshot",
          title: candidate.title || identity.title || "截图记忆",
          url: candidate.url,
          account: candidate.account || identity.account || "",
          textLength: screenshotEvidence.length,
          platform: candidate.platform || identity.platform,
          focus: { status: "screenshot_only" }
        };
        result.sourceFallback = true;
        result.sourceWarning = result.error;
        delete result.error;
        result.status = "completed";
        const fallbackInput = {
          id: `image-fallback-${Date.now()}`,
          title: candidate.title || identity.title || "截图记忆",
          sourceUrl: candidate.url,
          sourceAccount: candidate.account || identity.account,
          rawText: screenshotEvidence,
          blocks: fallbackEvidence
        };
        const fallbackGeneration = await measureAsync(
          timings,
          "reviewGenerationMs",
          async () => (
            generate
              ? { legacyReview: await generate(fallbackInput), evidence: fallbackEvidence }
              : {
                  captureAnalysis: await generateMemory({
                    evidence: fallbackEvidence,
                    sourceStatus: "partial",
                    sourceTitle: result.source.title,
                    sourceAccount: result.source.account,
                    sourceUrl: result.source.url,
                    source: result.source,
                    link: result.link
                  }),
                  evidence: fallbackEvidence
                }
          )
        );
        applyMemoryGenerationResult(result, fallbackGeneration);
        reportProgress(onProgress, { stage: "completed", message: "已根据截图可见内容生成记忆卡", percent: 100 });
      } catch (fallbackError) {
        result.sourceFallbackError = {
          code: fallbackError?.code || "screenshot_fallback_failed",
          message: fallbackError?.message || "截图可见内容生成失败。"
        };
        result.error = result.sourceWarning || result.sourceFallbackError;
        result.status = result.error.code;
        Object.assign(result, attachFragmentContracts({
          ...result,
          message: result.error.message
        }));
        reportProgress(onProgress, { stage: "failed", message: result.error.message, percent: 100 });
      }
    } else {
      Object.assign(result, attachFragmentContracts({
        ...result,
        message: result.error.message
      }));
      reportProgress(onProgress, { stage: "failed", message: result.error.message, percent: 100 });
    }
  }
  timings.totalMs = Date.now() - flowStartedAt;
  return result;
}

function buildScreenshotEvidence(captureAnalysis, identity) {
  const lines = Array.isArray(identity?.visibleTextLines) && identity.visibleTextLines.length > 0
    ? identity.visibleTextLines
    : Array.isArray(captureAnalysis?.lines) ? captureAnalysis.lines : [];
  const visibleText = lines.map((line) => String(line || "").trim()).filter(Boolean).join("\n");
  if (!visibleText) return "";
  return [
    "以下文字只来自用户截图，用于记忆截图中看过的内容，不代表 Recallo 已完成外部事实核验。",
    visibleText
  ].join("\n");
}

function buildUnsourcedScreenshotEvidence(analysis) {
  return [analysis.summary, ...(analysis.keyPoints || [])]
    .map((text, index) => ({
      id: `screenshot-visual-${index + 1}`,
      type: "screenshot",
      text: String(text || "").trim(),
      modelVersion: analysis.model || "qwen3-vl-plus"
    }))
    .filter((item) => item.text);
}

function fragmentForResult(result) {
  return buildMemoryFragment({
    capture: result.capture,
    link: result.link,
    message: result.message || result.error?.message,
    code: result.status || result.error?.code
  });
}

function attachFragmentContracts(result, {
  disposition = "needs_confirmation",
  sourceStatus = "unconfirmed"
} = {}) {
  const response = { ...result };
  response.captureAnalysis = buildCaptureDisposition({
    disposition,
    sourceStatus,
    decisionReason: result.message || result.error?.message
  });
  response.memoryCard = fragmentForResult(response);
  return response;
}

function applyMemoryGenerationResult(result, generation) {
  if (generation?.legacyReview) {
    result.review = generation.legacyReview;
    result.memoryCard = buildMemoryCard({
      review: generation.legacyReview,
      source: result.source,
      link: result.link,
      capture: result.capture
    });
    return;
  }

  const captureAnalysis = generation?.captureAnalysis || buildCaptureDisposition({
    disposition: "needs_confirmation",
    sourceStatus: "unconfirmed",
    decisionReason: "没有生成可用的记忆卡。"
  });
  result.captureAnalysis = captureAnalysis;
  result.schedule = captureAnalysis.schedule || null;
  const fallback = buildMemoryFragment({
    capture: result.capture,
    link: result.link,
    message: captureAnalysis.decisionReason,
    code: captureAnalysis.disposition
  });
  result.memoryCard = serializeLegacyMemoryCard(captureAnalysis, { fallback });
  const legacyReview = serializeLegacyReview(captureAnalysis, {
    evidence: generation?.evidence || [],
    source: result.source
  });
  if (legacyReview) result.review = legacyReview;
}

function evidenceForSource(source) {
  const blocks = Array.isArray(source?.blocks) ? source.blocks : [];
  if (blocks.length > 0) return blocks;
  const rawText = String(source?.rawText || "").trim();
  return rawText
    ? [{ id: "source-content", type: "paragraph", text: rawText }]
    : [];
}

function setImageFlowInternalEvidence(result, evidence) {
  Object.defineProperty(result, IMAGE_FLOW_INTERNAL_EVIDENCE, {
    value: structuredClone(Array.isArray(evidence) ? evidence : []),
    enumerable: false,
    configurable: false,
    writable: false
  });
}

function reportProgress(handler, progress) {
  try { handler?.(progress); } catch { /* progress reporting must not break the flow */ }
}

function buildProvidedTextAnalysis(ocrText, ocrLines) {
  const lines = Array.isArray(ocrLines) && ocrLines.length > 0
    ? ocrLines
    : String(ocrText || "").split(/\r?\n/);
  return {
    provider: "provided-text",
    model: null,
    text: String(ocrText || "").trim(),
    lines,
    identity: extractScreenshotIdentity(lines),
    latencyMs: 0
  };
}

function serializeCaptureAnalysis(analysis, identity) {
  return {
    provider: analysis.provider,
    model: analysis.model || null,
    latencyMs: analysis.latencyMs || null,
    identity
  };
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

async function searchScreenshotSource({ identity, queries, searcher, enabledPlatforms }) {
  const [primaryQuery] = queries;
  const preferredPlatform = isKnownPlatform(identity?.platform) ? identity.platform : "";
  const primarySearch = await searcher(primaryQuery, {
    platform: preferredPlatform,
    searchAllPlatforms: !preferredPlatform,
    enabledPlatforms
  });
  const primaryCandidate = pickCandidate(primarySearch.results, identity);
  const attempts = [{ query: primaryQuery, resultCount: Array.isArray(primarySearch.results) ? primarySearch.results.length : 0, matched: Boolean(primaryCandidate) }];
  if (primaryCandidate) {
    return { search: { ...primarySearch, query: primaryQuery, attempts }, candidate: primaryCandidate };
  }
  if (preferredPlatform === "bilibili" && identity?.account) {
    try {
      const creatorSearch = await searcher(primaryQuery, {
        platform: "bilibili",
        enabledPlatforms,
        account: identity.account,
        creatorFallback: true
      });
      const creatorResults = (creatorSearch.results || []).filter((item) => item.discovery === "creator_posts");
      const creatorCandidate = pickCandidate(creatorResults, identity);
      attempts.push({
        query: `${identity.account}（UP主投稿兜底）`,
        resultCount: creatorResults.length,
        matched: Boolean(creatorCandidate)
      });
      if (creatorCandidate) {
        return {
          search: {
            ...creatorSearch,
            query: primaryQuery,
            results: dedupeSearchResults([...(primarySearch.results || []), ...creatorResults]),
            attempts
          },
          candidate: creatorCandidate
        };
      }
    } catch {
      attempts.push({ query: `${identity.account}（UP主投稿兜底）`, resultCount: 0, matched: false });
    }
  }
  return { search: { ...primarySearch, query: primaryQuery, attempts }, candidate: null };
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
  const title = [...usable]
    .map((line, index) => ({ line, index, score: titleScore(line) }))
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length)[0];
  const titleIndex = title ? cleaned.indexOf(title.line) : -1;
  const account = findAccount(cleaned, titleIndex);
  return {
    title: title?.line || "",
    account,
    timestampSeconds: findPlayerTimestamp(cleaned),
    platform: inferPlatform(cleaned) || "unknown",
    contentKind: inferContentKind(cleaned),
    locatorTerms: usable.filter((line) => line !== title?.line && line !== account).slice(0, 8),
    confidence: title?.line ? Math.min(1, title.score / 20) : 0
  };
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
  if (/小红书|xiaohongshu|xhs|发现\s*关注\s*消息/i.test(text)) return "xiaohongshu";
  if (/抖音|douyin/i.test(text)) return "douyin";
  if (/首页[:：]?\s*朋友.*消息.*我|发同款|的原声|\b热点\b/i.test(text)) return "douyin";
  if (/youtube/i.test(text)) return "youtube";
  return "";
}

function inferContentKind(lines) {
  const text = lines.join(" ");
  if (findPlayerTimestamp(lines) !== null || /弹幕|发同款|的原声|播放中/i.test(text)) return "video";
  if (/图文|笔记|第\s*\d+\s*张|共\s*\d+\s*张/i.test(text)) return "image_text";
  return "unknown";
}

function platformFromUrl(value) {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    if (hostname === "b23.tv" || hostname.endsWith(".b23.tv") || hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) return "bilibili";
    if (hostname === "douyin.com" || hostname.endsWith(".douyin.com") || hostname === "iesdouyin.com" || hostname.endsWith(".iesdouyin.com")) return "douyin";
    if (hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com") || hostname === "xhslink.com" || hostname.endsWith(".xhslink.com")) return "xiaohongshu";
    return "";
  } catch {
    return "";
  }
}

export function pickCandidate(results, identity) {
  const items = (Array.isArray(results) ? results : [])
    .filter((item) => candidateMatchesPlatform(item, identity))
    .filter((item) => candidateMatchesAccount(item, identity));
  const ranked = items.map((item) => ({ ...item, matchScore: scoreCandidate(item, identity) }))
    .sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0];
  if (!best || best.matchScore < 0.68) return null;
  if (!isKnownPlatform(identity?.platform)) {
    const bestPlatform = best.platform || platformFromUrl(best.url);
    const competing = ranked.find((item, index) => (
      index > 0
      && (item.platform || platformFromUrl(item.url)) !== bestPlatform
      && item.matchScore >= 0.68
      && best.matchScore - item.matchScore < 0.08
    ));
    if (!bestPlatform || competing) return null;
  }
  return best;
}

function candidateMatchesPlatform(item, identity) {
  if (!isKnownPlatform(identity?.platform)) return true;
  return (item?.platform || platformFromUrl(item?.url)) === identity.platform;
}

function candidateMatchesAccount(item, identity) {
  const account = String(identity?.account || "").trim();
  if (!account) return true;
  const candidateText = [item?.account, item?.snippet].filter(Boolean).join(" ");
  return textSimilarity(candidateText, account) >= 0.45;
}

function scoreCandidate(item, identity) {
  const titleScore = textSimilarity(item?.title, identity?.title);
  const accountScore = identity?.account
    ? textSimilarity([item?.account, item?.snippet].filter(Boolean).join(" "), identity.account)
    : 0;
  const candidatePlatform = item?.platform || platformFromUrl(item?.url);
  const platformScore = isKnownPlatform(identity?.platform) && candidatePlatform === identity.platform ? 1 : 0;
  return titleScore * 0.82 + accountScore * 0.13 + platformScore * 0.05;
}

function sourceTypeForCandidate(candidate, identity) {
  const contentKind = ["video", "image_text"].includes(candidate?.contentKind)
    ? candidate.contentKind
    : identity?.contentKind;
  if (contentKind === "image_text") return "article_link";
  if (contentKind === "video") return "video_link";
  return isVideoUrl(candidate?.url) ? "video_link" : "article_link";
}

function isKnownPlatform(value) {
  return ["bilibili", "douyin", "xiaohongshu"].includes(String(value || ""));
}

function normalizeEnabledPlatforms(platforms) {
  const values = Array.isArray(platforms) ? platforms : [];
  return [...new Set(values.map((item) => String(item || "").trim().toLowerCase()).filter(isKnownPlatform))];
}

function platformLabel(platform) {
  return {
    bilibili: "B站",
    douyin: "抖音",
    xiaohongshu: "小红书"
  }[platform] || "未知平台";
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

function flowError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
