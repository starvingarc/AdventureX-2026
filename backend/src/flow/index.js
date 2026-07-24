import { recognizeImage } from "./ocr.js";
import { searchLinks } from "./search.js";
import { extractFocusedSourceContent, isVideoUrl } from "./source.js";
import { generateQuickReviewPath, generateVideoOverview } from "./review.js";
import { refineScreenshotIdentity } from "./identity.js";
import {
  analyzeUnsourcedScreenshot,
  buildUnsourcedOverview,
  generateUnsourcedScreenshotReview,
  UNSOURCED_IMAGE_PROVENANCE
} from "./unsourcedImage.js";

export async function runImageFlow({
  imagePath = "",
  imageBase64 = "",
  ocrText = "",
  ocrLines = [],
  sourceUrl = "",
  asrMode = "",
  publicMediaBaseUrl = "",
  includeDetails = false,
  onProgress = null,
  searcher = searchLinks,
  ocr = recognizeImage,
  extract = extractFocusedSourceContent,
  refineIdentity = refineScreenshotIdentity,
  generate = generateQuickReviewPath,
  generateOverview = generateVideoOverview,
  analyzeUnsourced = analyzeUnsourcedScreenshot,
  generateUnsourcedReview = generateUnsourcedScreenshotReview
} = {}) {
  const flowStartedAt = Date.now();
  const extractionTimings = {};
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
  const heuristicIdentity = extractScreenshotIdentity(ocrResult.lines || ocrResult.text);
  const identityStartedAt = Date.now();
  const identity = await refineIdentity(ocrResult.lines || ocrResult.text, heuristicIdentity);
  timings.identityMs = Date.now() - identityStartedAt;
  reportProgress(onProgress, {
    stage: "ocr",
    message: "截图标题、账号和平台校正完成",
    percent: 15,
    event: "identity_refinement_completed",
    durationMs: timings.identityMs,
    details: { platform: identity.platform || "unknown" },
    partial: { identity }
  });
  reportProgress(onProgress, {
    stage: "search",
    message: "截图识别完成，正在用 TikHub 核对来源",
    percent: 20,
    event: "ocr_completed",
    durationMs: timings.ocrMs,
    details: { provider: ocrResult.provider || "unknown" },
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
    try {
      reportProgress(onProgress, {
        stage: "generate",
        message: "未找到可信 TikHub 来源，正在由 Qwen Plus 根据截图生成 3 张卡片",
        percent: 68,
        event: "unsourced_image_fallback_started",
        partial: { identity, sourceStatus: "unsourced_image", provenance: UNSOURCED_IMAGE_PROVENANCE }
      });
      const analysis = await measureAsync(timings, "imageFallbackAnalysisMs", () => analyzeUnsourced({
        imagePath: path,
        ocrText: ocrResult.text || (ocrResult.lines || []).join("\n"),
        identity
      }));
      const fallbackBlocks = [analysis.summary, ...analysis.keyPoints]
        .filter(Boolean)
        .map((text, index) => ({
          id: `image-visual-${String(index + 1).padStart(3, "0")}`,
          type: index === 0 ? "heading" : "paragraph",
          text
        }));
      const reviewInput = {
        id: `image-${Date.now()}`,
        title: analysis.title || identity.title || "未溯源截图",
        sourceAccount: analysis.account || identity.account || "",
        rawText: fallbackBlocks.map((block) => block.text).join("\n"),
        blocks: fallbackBlocks,
        source: {
          type: "image_only",
          title: analysis.title || identity.title || "未溯源截图",
          account: analysis.account || identity.account || "",
          platform: analysis.platform || identity.platform || "image",
          contentBasis: "qwen_plus_visual_fallback"
        }
      };
      const review = await measureAsync(timings, "reviewGenerationMs", () => generateUnsourcedReview({ analysis, reviewInput }));
      const provenance = {
        ...UNSOURCED_IMAGE_PROVENANCE,
        fallbackProvider: analysis.provider || "qwen-vl",
        fallbackModel: analysis.model || "qwen3-vl-plus"
      };
      review.source ||= {};
      review.source.sourceStatus = "unsourced_image";
      review.source.provenance = provenance;
      review.generationMeta ||= {};
      review.generationMeta.provenanceStatus = "not_found";
      const overview = buildUnsourcedOverview(analysis);
      const source = {
        sourceType: "image_only",
        sourceStatus: "unsourced_image",
        title: reviewInput.title,
        url: "",
        account: reviewInput.sourceAccount,
        textLength: reviewInput.rawText.length,
        platform: reviewInput.source.platform,
        focus: { status: "qwen_plus_visual_fallback", timestampSeconds: identity.timestampSeconds ?? null },
        provenance
      };
      Object.assign(result, {
        status: "completed",
        sourceStatus: "unsourced_image",
        provenance,
        source,
        review,
        contentOverview: overview,
        imageOverview: overview,
        // iOS 旧客户端只读取 videoOverview；保留同一份数据可立即显示未溯源知识地图。
        videoOverview: overview,
        message: "未找到 TikHub 原始来源；已由 Qwen Plus 仅根据截图生成 3 张卡片。"
      });
      if (includeDetails) {
        result.details.unsourcedImage = {
          provider: analysis.provider,
          model: analysis.model,
          title: analysis.title,
          account: analysis.account,
          platform: analysis.platform,
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          cardCount: review.units?.flatMap((unit) => unit.questions || []).length || 0,
          usage: analysis.usage
        };
        result.details.source = {
          rawText: reviewInput.rawText,
          overviewText: analysis.summary,
          blocks: fallbackBlocks,
          overviewBlocks: fallbackBlocks,
          transcriptSegments: [],
          extractionMeta: { fastPath: "qwen_plus_visual_fallback", provenance }
        };
      }
      reportProgress(onProgress, {
        stage: "completed",
        message: "未溯源截图的 3 张复习卡已生成",
        percent: 100,
        event: "unsourced_image_fallback_completed",
        details: { model: provenance.fallbackModel, cardCount: 3 },
        partial: { source, provenance }
      });
      timings.totalMs = Date.now() - flowStartedAt;
      return result;
    } catch (fallbackError) {
      timings.totalMs = Date.now() - flowStartedAt;
      return {
        ...result,
        status: search.errorCode || "search_match_low_confidence",
        sourceStatus: "unsourced_image_fallback_failed",
        provenance: { ...UNSOURCED_IMAGE_PROVENANCE, fallbackStatus: "failed" },
        error: {
          code: fallbackError?.code || "image_fallback_failed",
          message: fallbackError?.message || "Qwen Plus 截图降级失败。",
          provider: fallbackError?.provider || "qwen-vl"
        },
        message: search.errorCode && fallbackError?.code === "image_fallback_missing_api_key"
          ? "TikHub 搜索不可用，且未配置 Qwen Plus 截图降级 API。"
          : "未找到可信 TikHub 来源，Qwen Plus 截图降级也未完成。"
      };
    }
  }

  result.link = candidate;
  const effectiveAsrMode = String(asrMode || process.env.VIDEO_ASR_MODE || "full").trim().toLowerCase() === "sampled"
    ? "sampled"
    : "full";
  const fullVideoAsr = effectiveAsrMode === "full";
  reportProgress(onProgress, {
    stage: "extract",
    message: candidateSourceType(candidate) === "video_link"
      ? fullVideoAsr
        ? "已找到来源，正在获取字幕或并发转写全片音频"
        : "已找到来源，正在并发转写至少 30% 的代表片段并覆盖前中后"
      : "已找到来源，正在提取文章正文",
    percent: 40,
    event: "search_completed",
    durationMs: timings.searchMs,
    details: { provider: search?.provider || "unknown", candidateCount: search?.results?.length || 0 },
    partial: { identity, link: publicCandidate(candidate) }
  });
  const sourceType = candidateSourceType(candidate);
  try {
    const extractionStartedAt = Date.now();
    const source = await extract({
      sourceType,
      sourceUrl: candidate.url,
      sourceTitle: candidate.title,
      rawText: candidate.snippet,
      timestampSeconds: identity.timestampSeconds,
      locatorTerms: identity.locatorTerms,
      screenshotText: identity.screenshotText || "",
      asrMode: effectiveAsrMode,
      preferredLanguage: inferAsrLanguageHint(identity, candidate),
      publicMediaBaseUrl,
      onProgress: (progress = {}) => {
        if (progress.event && Number.isFinite(Number(progress.durationMs))) {
          const key = String(progress.event).replace(/_completed$/, "");
          if (key === "asr_chunk") {
            extractionTimings.asrChunks ||= [];
            extractionTimings.asrChunks.push({ durationMs: Number(progress.durationMs), ...(progress.details || {}) });
          } else {
            extractionTimings[key] = Number(progress.durationMs);
          }
        }
        reportProgress(onProgress, { stage: "extract", percent: progress.percent || 55, ...progress });
      }
    });
    timings.sourceExtractionMs = Date.now() - extractionStartedAt;
    timings.extraction = extractionTimings;
    result.source = {
      sourceType,
      title: source.sourceTitle,
      url: source.sourceUrl,
      account: source.sourceAccount,
      textLength: String(source.rawText || "").length,
      platform: source.platform,
      focus: source.focus || null,
      asr: buildPublicAsrEvidence(source.learningSource?.extractionMeta?.asr, source.focus)
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
      message: sourceType === "video_link"
        ? "内容已提取，正在生成截图知识卡和全片总结"
        : "正文已提取，正在生成文章知识卡和内容总结",
      percent: 82,
      partial: {
        identity,
        link: publicCandidate(candidate),
        source: {
          sourceType,
          title: source.sourceTitle,
          account: source.sourceAccount,
          url: source.sourceUrl,
          platform: source.platform,
          focus: source.focus || null
        }
      }
    });
    const reviewRequest = measureAsync(timings, "reviewGenerationMs", () => generate(reviewInput));
    const overviewRequest = measureAsync(timings, "overviewGenerationMs", () => generateOverview({
      title: source.sourceTitle,
      account: source.sourceAccount,
      rawText: source.overviewText,
      contentType: sourceType === "video_link" ? "video" : "article"
    }));
    const generationStartedAt = Date.now();
    const [review, contentOverview] = await Promise.all([reviewRequest, overviewRequest]);
    timings.generationWallMs = Date.now() - generationStartedAt;
    reportProgress(onProgress, {
      stage: "generate",
      event: "generation_completed",
      message: "知识卡和内容总结生成完成",
      percent: 98,
      durationMs: timings.generationWallMs,
      details: {
        reviewGenerationMs: timings.reviewGenerationMs,
        overviewGenerationMs: timings.overviewGenerationMs
      }
    });
    result.review = review;
    if (contentOverview) {
      result.contentOverview = contentOverview;
      if (sourceType === "video_link") result.videoOverview = contentOverview;
      else result.articleOverview = contentOverview;
    }
    result.status = "completed";
    reportProgress(onProgress, { stage: "completed", message: "复习卡已生成", percent: 100 });
  } catch (error) {
    if (timings.sourceExtractionMs === undefined) timings.sourceExtractionMs = Date.now() - (flowStartedAt + timings.inputPreparationMs + timings.ocrMs + timings.searchMs);
    const fallbackText = sourceType === "video_link"
      ? buildScreenshotFallbackText({ candidate, identity })
      : "";
    if (fallbackText.length >= 24) {
      try {
        reportProgress(onProgress, {
          stage: "generate",
          message: "视频没有可用字幕，正在根据已核验的发布文案和截图文字生成卡片",
          percent: 82,
          partial: { identity, link: publicCandidate(candidate) }
        });
        const fallbackBlocks = fallbackText.split(/\n+/).filter(Boolean).map((text, index) => ({
          id: `screenshot-${String(index + 1).padStart(3, "0")}`,
          type: "paragraph",
          text
        }));
        const reviewInput = {
          id: `image-${Date.now()}`,
          title: candidate.title || identity.title || "截图内容",
          sourceUrl: candidate.url,
          sourceAccount: candidate.account || identity.account,
          rawText: fallbackText,
          blocks: fallbackBlocks
        };
        const generationStartedAt = Date.now();
        result.review = await measureAsync(timings, "reviewGenerationMs", () => generate(reviewInput));
        timings.generationWallMs = Date.now() - generationStartedAt;
        result.source = {
          sourceType,
          title: reviewInput.title,
          url: candidate.url,
          account: reviewInput.sourceAccount,
          textLength: fallbackText.length,
          platform: candidate.platform || identity.platform || "",
          focus: { status: "screenshot_text_fallback", timestampSeconds: identity.timestampSeconds }
        };
        result.sourceFallback = true;
        result.message = "该视频没有可用字幕，复习卡基于已核验的发布文案和截图可见文字生成。";
        result.status = "completed";
        if (includeDetails) {
          result.details.source = {
            rawText: fallbackText,
            overviewText: "",
            blocks: fallbackBlocks,
            overviewBlocks: [],
            transcriptSegments: [],
            extractionMeta: {
              fastPath: "screenshot_text_fallback",
              fallbackReason: error?.code || "source_extract_failed"
            }
          };
        }
        reportProgress(onProgress, { stage: "completed", message: "截图文字复习卡已生成", percent: 100 });
      } catch (fallbackError) {
        result.error = {
          code: fallbackError?.code || error?.code || "source_extract_failed",
          message: fallbackError?.message || error?.message || "来源内容提取失败。",
          provider: fallbackError?.provider || error?.provider || null
        };
        result.status = result.error.code;
        reportProgress(onProgress, { stage: "failed", message: result.error.message, percent: 100 });
      }
    } else {
      result.error = { code: error?.code || "source_extract_failed", message: error?.message || "来源内容提取失败。", provider: error?.provider || null };
      result.status = result.error.code;
      reportProgress(onProgress, { stage: "failed", message: result.error.message, percent: 100 });
    }
  }
  timings.totalMs = Date.now() - flowStartedAt;
  return result;
}

function candidateSourceType(candidate) {
  if (["image_text", "article", "answer", "pin"].includes(String(candidate?.kind || ""))) return "article_link";
  if (String(candidate?.kind || "") === "video") return "video_link";
  return isVideoUrl(candidate?.url) ? "video_link" : "article_link";
}

function buildPublicAsrEvidence(asr, focus) {
  if (!asr || typeof asr !== "object") return null;
  const coverage = asr.coverage && typeof asr.coverage === "object" ? asr.coverage : {};
  const usedChunks = Array.isArray(coverage.usedChunks) ? coverage.usedChunks : [];
  const cardChunkIndexes = [...new Set((focus?.blocks || [])
    .flatMap((block) => Array.isArray(block?.segmentIds) ? block.segmentIds : [])
    .map((id) => String(id || "").match(/^chunk-(\d+)-/)?.[1])
    .filter(Boolean)
    .map(Number))].sort((left, right) => left - right);
  return {
    provider: asr.provider || "",
    mode: asr.mode || (asr.sampled ? "sampled" : "full"),
    sampled: Boolean(asr.sampled),
    segmentCount: Number(asr.segmentCount) || 0,
    coverage: {
      completedChunks: numberOrNull(coverage.completedChunks),
      totalChunks: numberOrNull(coverage.totalChunks),
      sourceTotalChunks: numberOrNull(coverage.sourceTotalChunks),
      ratio: numberOrNull(coverage.ratio),
      sourceChunkRatio: numberOrNull(coverage.sourceChunkRatio),
      targetSourceCoverageRatio: numberOrNull(coverage.targetSourceCoverageRatio),
      temporalRegions: Array.isArray(coverage.temporalRegions) ? coverage.temporalRegions : [],
      frontMiddleEndCovered: Boolean(coverage.frontMiddleEndCovered),
      usedChunks: usedChunks.map((chunk) => ({
        index: Number(chunk?.index) || Number(chunk?.chunkIndex) + 1,
        startSeconds: Number(chunk?.startSeconds) || 0,
        region: String(chunk?.region || "")
      }))
    },
    fullSummaryChunkIndexes: usedChunks.map((chunk) => Number(chunk?.index) || Number(chunk?.chunkIndex) + 1),
    cardChunkIndexes,
    cardBasis: ["timestamp_window", "transcript_match"].includes(String(focus?.status || ""))
      ? "screenshot_nearby"
      : asr.mode === "full" || !asr.sampled
        ? "full_video"
        : "sampled_video"
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildScreenshotFallbackText({ candidate, identity }) {
  const values = [
    candidate?.title,
    ...(Array.isArray(identity?.locatorTerms) ? identity.locatorTerms : []),
    candidate?.snippet
  ].map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const unique = values.filter((value, index) => (
    values.findIndex((candidateValue) => normalizedText(candidateValue) === normalizedText(value)) === index
  ));
  return unique.join("\n").slice(0, 4_000);
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
  const accountAliases = dedupeStrings([account, ...(Array.isArray(identity?.accountAliases) ? identity.accountAliases : [])]);
  const rawTitle = title.replace(/【[^】]*】/g, "").trim();
  const titleSegments = rawTitle.split(/[：:，,。！？!?]+/).map((item) => item.trim()).filter(Boolean);
  const plainTitle = titleSegments.join(" ");
  const firstTitleSegment = plainTitle.slice(0, 36);
  const edition = rawTitle.match(/第[一二三四五六七八九十0-9]+季|第\d+[期集]|[上下]集/)?.[0] || "";
  const anchorTitle = [firstTitleSegment, firstTitleSegment.includes(edition) ? "" : edition].filter(Boolean).join(" ");
  const primary = [account, anchorTitle].filter(Boolean).join(" ") || rawTitle;
  const aliasQueries = accountAliases.slice(1).map((alias) => [alias, anchorTitle].filter(Boolean).join(" "));
  const platform = String(identity?.platform || "");
  const textRich = ["wechat", "zhihu"].includes(platform)
    || (platform === "xiaohongshu" && identity?.contentKind !== "video");
  if (!textRich) return dedupeStrings([primary, ...aliasQueries]);
  const normalizedTitle = normalizedText(title);
  const normalizedAccount = normalizedText(account);
  const evidenceLines = String(identity?.searchText || "").split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 6)
    .filter((line) => {
      const normalizedLine = normalizedText(line);
      return normalizedLine
        && !(normalizedTitle.includes(normalizedLine) || normalizedLine.includes(normalizedTitle))
        && !(normalizedAccount && normalizedLine.includes(normalizedAccount))
        && !/发自|公众号|原创内容|点击下方|编辑[丨|｜]/.test(line);
    })
    .slice(0, 3);
  const evidenceQuery = [title, ...evidenceLines].filter(Boolean).join(" ").slice(0, 180);
  return dedupeStrings([primary, ...aliasQueries, evidenceQuery, title]);
}

async function searchScreenshotSource({ identity, queries, searcher }) {
  const [primaryQuery] = queries;
  const preferredPlatform = identity?.platform || "";
  const textRichPlatform = ["wechat", "zhihu"].includes(preferredPlatform)
    || (preferredPlatform === "xiaohongshu" && identity?.contentKind !== "video");
  const initialQueries = preferredPlatform === "bilibili"
    ? dedupeStrings([primaryQuery, normalizeSearchTitle(identity?.title), buildGenericTitleAnchor(identity?.title)])
    : preferredPlatform === "xiaohongshu"
      ? identity?.contentKind === "video"
        ? dedupeStrings([primaryQuery, normalizeSearchTitle(identity?.title)])
        : dedupeStrings(queries)
      : textRichPlatform
        ? dedupeStrings(queries)
        : [primaryQuery];
  const initialSearches = await Promise.all(initialQueries.map(async (searchQuery) => {
    try {
      return await searcher(searchQuery, {
        platform: preferredPlatform,
        account: identity?.account || ""
      });
    } catch (error) {
      return { provider: "tikhub", query: searchQuery, results: [], errorCode: error?.code || "search_failed" };
    }
  }));
  const primarySearch = initialSearches[0];
  const initialResults = dedupeSearchResults(initialSearches.flatMap((search) => search.results || []));
  const primaryCandidate = pickCandidate(initialResults, identity);
  const attempts = initialSearches.map((search, index) => ({
    query: index === 0
      ? search.query || primaryQuery
      : `${search.query || initialQueries[index]}（${preferredPlatform === "bilibili"
          ? "B站高召回"
          : preferredPlatform === "xiaohongshu"
            ? "小红书标题回查"
            : "全文证据回查"}）`,
    resultCount: Array.isArray(search.results) ? search.results.length : 0,
    matched: Boolean(pickCandidate(search.results, identity))
  }));
  if (primaryCandidate && isStrongCandidate(primaryCandidate)) {
    return {
      search: { ...primarySearch, query: primaryQuery, results: initialResults, attempts },
      candidate: primaryCandidate
    };
  }
  const remainingQueries = queries.filter((query) => !initialQueries.some((initial) => normalizedText(initial) === normalizedText(query)));
  const fallbackSearches = await Promise.all(remainingQueries.map(async (query) => {
    try {
      return await searcher(query, { platform: preferredPlatform, account: identity?.account || "" });
    } catch (error) {
      return { provider: primarySearch.provider, query, results: [], errorCode: error?.code || "search_failed" };
    }
  }));
  const allResults = dedupeSearchResults([
    ...initialResults,
    ...fallbackSearches.flatMap((search) => search.results || [])
  ]);
  let candidate = pickCandidate(allResults, identity);
  attempts.push(...fallbackSearches.map((search) => ({
    query: search.query,
    resultCount: Array.isArray(search.results) ? search.results.length : 0,
    matched: Boolean(pickCandidate(search.results, identity))
  })));
  if ((!candidate || !isStrongCandidate(candidate)) && ["bilibili", "douyin"].includes(preferredPlatform)) {
    const creatorSearch = identity?.account
      ? await searcher(primaryQuery, {
          platform: preferredPlatform,
          account: identity.account,
          creatorFallback: true
        }).catch(() => ({ results: [] }))
      : { results: [] };
    const creatorResults = (creatorSearch.results || []).filter((item) => item.discovery === "creator_posts");
    allResults.push(...dedupeSearchResults(creatorResults)
      .filter((item) => !allResults.some((existing) => existing.url === item.url)));
    candidate = pickCandidate(allResults, identity);
    if (identity?.account) {
      attempts.push({
        query: `${identity.account}（${preferredPlatform === "bilibili" ? "UP主投稿" : "作者作品"}兜底）`,
        resultCount: creatorResults.length,
        matched: Boolean(pickCandidate(creatorResults, identity))
      });
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

function buildGenericTitleAnchor(value) {
  const segments = normalizeSearchTitle(value)
    .replace(/【[^】]*】/g, "")
    .split(/[：:，,。！？!?⋯…]+/)
    .map((item) => item.trim())
    .filter((item) => normalizedText(item).length >= 2);
  if (segments.length < 2) return "";
  return [segments.at(-1), segments.at(-2)].join(" ").slice(0, 48);
}

function dedupeStrings(values) {
  return values.map((value) => String(value || "").trim()).filter((value, index, items) => (
    value && items.findIndex((item) => normalizedText(item) === normalizedText(value)) === index
  ));
}

function isStrongCandidate(candidate) {
  if (candidate?.identityAccountRequired) {
    return Number(candidate?.accountSimilarity) >= 0.62
      && (Number(candidate?.titleSimilarity) >= 0.4 || Number(candidate?.evidenceSimilarity) >= 0.52);
  }
  return Number(candidate?.titleSimilarity) >= 0.58
    || Number(candidate?.evidenceSimilarity) >= 0.6
    || Number(candidate?.matchScore) >= 0.75;
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
  const platformIdentity = extractPlatformIdentity(cleaned, platform);
  if (platformIdentity) {
    return {
      ...platformIdentity,
      timestampSeconds: null,
      platform,
      locatorTerms: usable.filter((line) => line !== platformIdentity.title && line !== platformIdentity.account).slice(0, 16),
      confidence: 1
    };
  }
  const explicitAccount = platform === "bilibili"
    ? findBilibiliAccount(cleaned)
    : findShortVideoAccount(cleaned);
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

function extractPlatformIdentity(lines, platform) {
  if (platform === "wechat") {
    const metadataIndex = lines.findIndex((line) => /20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/.test(line));
    if (metadataIndex > 0) {
      const metadata = lines[metadataIndex];
      const metadataPrefix = metadata.split(/\s*20\d{2}年/)[0].trim();
      const accountLineIndex = metadataPrefix ? metadataIndex : metadataIndex - 1;
      const account = extractWechatAccount(lines, metadataPrefix || lines[accountLineIndex]);
      const accountAliases = dedupeStrings([account, ...extractWechatSourceAccounts(lines)]);
      const titleLines = collectWechatTitleLines(lines, accountLineIndex);
      const title = titleLines.join("").trim();
      const searchText = extractTextRichEvidence(lines, { title, account });
      if (title && account) return {
        title,
        account,
        accountAliases,
        contentKind: "article",
        screenshotText: searchText,
        searchText
      };
    }
  }
  if (platform === "zhihu") {
    const questionMetaIndex = lines.findIndex((line) => /知乎.*\d+个回答/.test(line));
    if (questionMetaIndex > 0) {
      const title = collectZhihuQuestionTitle(lines, questionMetaIndex);
      const approvalIndex = lines.findIndex((line, index) => index > questionMetaIndex && /赞同了该回答/.test(line));
      const followIndex = lines.findIndex((line, index) => index > questionMetaIndex && /^(?:＋|\+)?\s*关注$/.test(line));
      const account = followIndex > questionMetaIndex
        ? lines.slice(questionMetaIndex + 1, followIndex)
          .map(normalizeZhihuAccount)
          .find((line) => isLikelyAccount(line) && !/认证|机构号/.test(line)) || ""
        : lines.slice(questionMetaIndex + 1, approvalIndex > 0 ? approvalIndex : questionMetaIndex + 8)
          .map(normalizeZhihuAccount)
          .find((line) => isLikelyAccount(line) && !/认证|机构号/.test(line)) || "";
      const searchText = extractZhihuAnswerEvidence(lines, { title, account, approvalIndex });
      if (title && account) return {
        title,
        account,
        contentKind: "answer",
        screenshotText: searchText,
        searchText
      };
    }
    const ideaApprovalIndex = lines.findIndex((line) => /赞同了该想法/.test(line));
    if (ideaApprovalIndex > 0) {
      const followIndex = lines.findIndex((line, index) => index < ideaApprovalIndex && /^(?:已关注|关注|(?:\+|＋)\s*关注)$/.test(line));
      const creatorBlock = followIndex > 0
        ? lines.slice(Math.max(0, followIndex - 4), followIndex).filter((line) => isLikelyAccount(line))
        : [];
      const account = creatorBlock.length >= 2 ? creatorBlock.at(-2) : creatorBlock.at(-1) || "";
      const title = lines.slice(ideaApprovalIndex + 1).find((line) => (
        line.length >= 4 && /[\u4e00-\u9fffA-Za-z]{3}/.test(line) && !isUiChrome(line)
      )) || "";
      const searchText = extractTextRichEvidence(lines, { title, account });
      if (title && account) return { title, account, contentKind: "pin", screenshotText: searchText, searchText };
    }
    const authorBadgeIndex = lines.findIndex((line) => /优秀答主|话题下/.test(line));
    const account = authorBadgeIndex > 0
      ? [...lines.slice(0, authorBadgeIndex)].reverse().find((line) => (
          isLikelyAccount(line.replace(/^@/, "").trim()) && !/关注/.test(line)
        ))?.replace(/^@/, "").trim() || ""
      : "";
    const approvalIndex = lines.findIndex((line) => /赞同了该想法|赞同了该回答/.test(line));
    const title = approvalIndex >= 0
      ? lines.slice(approvalIndex + 1).find((line) => (
          line.length >= 4 && /[\u4e00-\u9fffA-Za-z]{3}/.test(line) && !isUiChrome(line)
        ))
      : "";
    if (title && account) {
      const searchText = extractTextRichEvidence(lines, { title, account });
      return { title, account, contentKind: "pin", screenshotText: searchText, searchText };
    }
  }
  if (platform === "xiaohongshu") {
    const account = findShortVideoAccount(lines);
    const title = findXiaohongshuTitle(lines, account);
    const screenshotText = extractXiaohongshuVisibleText(lines);
    const contentKind = lines.some((line) => /^弹$/.test(line))
      ? "video"
      : "image_note";
    if (title && account) return { title, account, contentKind, screenshotText };
  }
  return null;
}

function extractXiaohongshuVisibleText(lines) {
  const carouselIndex = lines.findIndex((line) => /^\d+\s*\/\s*\d+/.test(line));
  const footerIndex = lines.findIndex((line) => /说点什么|评论区/.test(line));
  const start = carouselIndex >= 0 ? carouselIndex + 1 : 0;
  const end = footerIndex > start ? footerIndex : lines.length;
  return lines.slice(start, end)
    .filter((line) => isContentLine(line) && !/^(?:关注|分享|收藏)$/.test(line))
    .join("\n")
    .slice(0, 6_000);
}

function extractTextRichEvidence(lines, { title = "", account = "" } = {}) {
  return dedupeStrings([title, account, ...lines.filter((line) => (
    isContentLine(line)
      && !/^\d{1,2}:\d{2}/.test(line)
      && !/^(?:关注|已关注|评论\d*|默认|最新|写留言|欢迎参与讨论)$/.test(line)
  ))]).join("\n").slice(0, 6_000);
}

function extractZhihuAnswerEvidence(lines, { title = "", account = "", approvalIndex = -1 } = {}) {
  const answerLines = lines.slice(Math.max(0, approvalIndex + 1)).filter((line) => (
    isContentLine(line)
      && !/^\d+(?:\.\d+)?[万人]?$/.test(line)
      && !/^(?:目录|查看明细|当前单量|当前成单量|当前收益|知乎|关注|写回答|邀请回答)$/.test(line)
      && !/赞同了该回答|关注|欢迎参与讨论/.test(line)
  ));
  return dedupeStrings([title, account, ...answerLines]).join("\n").slice(0, 6_000);
}

function normalizeRepeatedAccount(value) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    const left = parts.slice(0, half).join(" ");
    const right = parts.slice(half).join(" ");
    if (normalizedText(left) === normalizedText(right)) return left;
  }
  return clean;
}

function extractWechatAccount(lines, fallbackLine = "") {
  const fallback = normalizeWechatAccountCandidate(fallbackLine);
  if (fallback) return fallback;
  for (const line of lines) {
    const publisher = line.match(/^(.{2,32}?)\s*[|｜]\s*公众号(?:\s|$)/);
    if (publisher) return normalizeWechatAccountCandidate(publisher[1]);
  }
  for (const line of lines) {
    const editor = line.match(/编辑\s*[丨|｜]\s*(.{2,32})$/);
    if (editor) return normalizeWechatAccountCandidate(editor[1]);
  }
  return normalizeWechatAccountCandidate(fallbackLine);
}

function normalizeWechatAccountCandidate(value) {
  const repeated = normalizeRepeatedAccount(value)
    .replace(/[\u2713\u2714\u2705]+$/g, "")
    .trim();
  const parts = repeated.split(/\s+/).filter((part) => (
    part && part !== "原创" && !/^关注/.test(part)
  ));
  return parts.length > 1 && (
    /^原创|关注/.test(repeated)
      || parts.slice(0, -1).some((part) => /快讯|资讯|栏目|速递|新闻$/.test(part))
  )
    ? parts.at(-1)
    : parts.join(" ") || repeated;
}

function extractWechatSourceAccounts(lines) {
  const accounts = [];
  for (const line of lines) {
    const match = line.match(/(?:文章来源于|转载自|来源[于：:]?)\s*([^，,。；;\s]+)/);
    if (match) accounts.push(normalizeWechatAccountCandidate(match[1]));
  }
  return dedupeStrings(accounts);
}

function isArticleTitleLine(line) {
  return line.length >= 2
    && /[\u4e00-\u9fffA-Za-z]{2}/.test(line)
    && !/^\d{1,2}:\d{2}/.test(line)
    && !/^(?:阅读原文|写留言|听全文|公众号|关注|已关注|分享|收藏|评论\d*)$/.test(line)
    && !/20\d{2}年\d{1,2}月\d{1,2}日/.test(line);
}

function collectWechatTitleLines(lines, accountLineIndex) {
  const collected = [];
  for (let index = accountLineIndex - 1; index >= 0 && collected.length < 4; index -= 1) {
    const line = String(lines[index] || "").trim();
    const singleCharacterContinuation = collected.length === 0 && /^[\u4e00-\u9fffA-Za-z]$/.test(line);
    if (isArticleTitleLine(line) || singleCharacterContinuation) {
      collected.push(line);
      continue;
    }
    if (collected.length > 0) break;
  }
  return collected.reverse();
}

function collectZhihuQuestionTitle(lines, questionMetaIndex) {
  const collected = [];
  for (let index = questionMetaIndex - 1; index >= 0 && collected.length < 5; index -= 1) {
    const line = String(lines[index] || "").trim();
    if (/邀请回答|写回答|^\d{1,2}:\d{2}|^[<>=·•…]+$/.test(line)) {
      if (collected.length > 0) break;
      continue;
    }
    if (line.length >= 2 && /[\u4e00-\u9fffA-Za-z]{2}/.test(line) && !isUiChrome(line)) {
      collected.push(line);
      continue;
    }
    if (collected.length > 0) break;
  }
  return collected.reverse().join("").trim();
}

function normalizeZhihuAccount(value) {
  return String(value || "")
    .replace(/^@\s*/, "")
    .replace(/[\s◎◉●○]+$/g, "")
    .trim();
}

function findXiaohongshuTitle(lines, account = "") {
  const carouselIndex = lines.findIndex((line) => /^\d+\s*\/\s*\d+/.test(line));
  const footerIndex = lines.findIndex((line) => /说点什么|评论区/.test(line));
  const end = footerIndex > 0 ? footerIndex : lines.length;
  const start = Math.max(carouselIndex + 1, end - 10, 0);
  const candidates = lines.slice(start, end).map((rawLine, offset) => ({
    line: stripExpandSuffix(rawLine),
    index: start + offset,
    hasExpand: /展开\s*[~～>〉]?$/.test(rawLine)
  })).filter(({ line }) => (
    line.length >= 4
      && line.length <= 42
      && /[\u4e00-\u9fffA-Za-z]{3}/.test(line)
      && normalizeAccountLine(line) !== normalizeAccountLine(account)
      && !isUiChrome(line)
      && !/[。！？!?；;，,]$/.test(line)
      && !/#/.test(line)
  ));
  const score = ({ line, index, hasExpand }) => (
    index
      + (hasExpand ? 40 : 0)
      + (line.length >= 6 && line.length <= 26 ? 12 : 0)
      - ((line.match(/[，,。！？!?；;：“”"「」]/g) || []).length * 5)
  );
  return candidates.sort((left, right) => score(right) - score(left))[0]?.line || "";
}

function findBilibiliTitle(lines, account) {
  const normalizedAccount = normalizeAccountLine(account);
  const accountIndex = account
    ? lines.map((line, index) => ({ line, index }))
      .filter(({ line }) => normalizeAccountLine(line).includes(normalizedAccount))
      .sort((left, right) => bilibiliCreatorContextScore(lines, right.index) - bilibiliCreatorContextScore(lines, left.index))[0]?.index ?? -1
    : -1;
  if (accountIndex < 0) return "";
  for (const rawLine of lines.slice(accountIndex + 1, accountIndex + 18)) {
    const line = rawLine
      .replace(/\s+\d+(?:\.\d+)?\s*万?播放.*$/, "")
      .replace(/[.。…\s]*展开\s*[~～>〉]?$/, "")
      .trim();
    if (line.length < 4 || !/[\u4e00-\u9fff]{2}/.test(line)) continue;
    if (isUiChrome(line) || /(含虚构|演绎内容|请勿模仿|不良引导)/.test(line)) continue;
    if (/^(?:详情页|发弹幕|视频提及|合集|热搜)/.test(line)) continue;
    if (/20\d{2}年\d{1,2}月\d{1,2}日|\d+人正在/.test(line)) continue;
    return line;
  }
  return "";
}

function findBilibiliAccount(lines) {
  const candidates = lines.map((line, index) => ({
    line: normalizeAccountLine(line),
    index,
    score: bilibiliCreatorContextScore(lines, index),
    following: lines.slice(index + 1, index + 6).join(" ")
  })).filter(({ line, score }) => (
    score >= 10
      && isLikelyAccount(line)
      && !/@|https?|\.com\b/i.test(line)
  )).filter(({ following }) => (
    /关注|已关注|充电/.test(following)
      && /粉丝|\d+视频/.test(following)
  ));
  return candidates.sort((left, right) => right.score - left.score)[0]?.line || "";
}

function bilibiliCreatorContextScore(lines, index) {
  const nearby = lines.slice(Math.max(0, index - 2), index + 5).join(" ");
  let score = index / Math.max(lines.length, 1);
  if (/(?:\+|＋|十)\s*关注|已关注|充电/.test(nearby)) score += 8;
  if (/粉丝/.test(nearby)) score += 6;
  if (/\d+视频/.test(nearby)) score += 4;
  if (/简介|评论|弹幕/.test(lines.slice(Math.max(0, index - 5), index + 1).join(" "))) score += 3;
  return score;
}

function findShortVideoAccount(lines) {
  for (const line of lines) {
    const explicit = line.match(/^@\s*([^\s]+(?:\s+[^\s]+)?)/);
    if (explicit) return normalizeAccountLine(explicit[1]);
  }
  const followIndex = lines.findIndex((line) => /^(?:(?:\+|＋|十)\s*)?关注$/.test(line));
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
  return String(value || "")
    .replace(/^[@#•·J\s]+/, "")
    .replace(/[·•。\s]*\d{1,2}月\d{1,2}日.*$/, "")
    .replace(/\s+[vV]$/, "")
    .trim();
}

function stripExpandSuffix(value) {
  return String(value || "")
    .replace(/[.。…\s]*展开\s*[~～>〉]?$/, "")
    // Apple Vision sometimes converts a row of face emoji into decimal-like
    // text ending in a degree symbol (for example "0.9090°").
    .replace(/[0-9O.,]{2,}°$/, "")
    .trim();
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
  return /(简介|评论|充电|已关注|关注|分享|收藏|不喜欢|正在看|正在|播放|弹幕|分钟|点赞|立即打开|点我发弹幕|粉丝|\d+视频|热搜|合集|三连|投票|动图|去汽水听|发条评论|一起讨论)/.test(line)
    || /^[·•]?\s*\d+\s*(?:秒|分钟|小时|天|周|月|年)前$/.test(line)
    || /20\d{2}年\d{1,2}月\d{1,2}日/.test(line);
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
  const scores = {
    bilibili: scoreWeightedMarkers(text, [
      [/bilibili|bilbili|\bbili\b|哔哩|B站|云视听小电视|看B站TV版/i, 4],
      [/充电|弹幕|点我发弹幕|已三连/, 3],
      [/简介\s+评论|简介.*评论/, 2],
      [/\d+(?:\.\d+)?万?粉丝\s+\d+视频/, 2],
      [/不喜欢|合集[·•]|视频提及/, 1]
    ]),
    xiaohongshu: scoreWeightedMarkers(text, [
      [/小红书|xiaohongshu|xhs/i, 4],
      [/说点什么|评论区/, 3],
      [/\b\d+\s*\/\s*\d+\b/, 1],
      [/收藏/, 1]
    ]),
    douyin: scoreMarkers(text, [
      /抖音|douyin/i,
      /首页[:：]?\s*朋友.*消息.*我/,
      /发同款|的原声|\b热点\b|去汽水听|发条评论.*一起讨论|期待你的评论/i
    ]),
    youtube: scoreMarkers(text, [/youtube/i]),
    wechat: scoreMarkers(text, [/阅读原文|写留言|个朋友关注|mp\.weixin|公众号/, /本文字数.*阅读时长/, /20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/]),
    zhihu: scoreMarkers(text, [/知乎/, /赞同了该想法|赞同了该回答/, /优秀答主|邀请回答|写回答/, /\d+个回答.*\d+个关注/])
  };
  const [platform, score] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0] || ["", 0];
  return score > 0 ? platform : "";
}

function scoreMarkers(text, patterns) {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function scoreWeightedMarkers(text, markers) {
  return markers.reduce((score, [pattern, weight]) => score + (pattern.test(text) ? weight : 0), 0);
}

export function pickCandidate(results, identity) {
  const items = Array.isArray(results) ? results : [];
  const ranked = items.map((item) => ({ ...item, ...scoreCandidate(item, identity) }))
    .sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0];
  if (!best) return null;
  const requiresAccount = ["bilibili", "douyin", "xiaohongshu", "wechat", "zhihu"].includes(identity?.platform)
    && Boolean(identity?.account);
  const trustworthy = requiresAccount
    ? best.accountSimilarity >= 0.62 && (best.titleSimilarity >= 0.4 || best.evidenceSimilarity >= 0.52)
    : best.titleSimilarity >= 0.58
      || best.evidenceSimilarity >= 0.6
      || (best.accountSimilarity >= 0.78 && best.titleSimilarity >= 0.26)
      || (best.platformSimilarity === 1 && best.titleSimilarity >= 0.42)
      || best.matchScore >= 0.62;
  best.identityAccountRequired = requiresAccount;
  return trustworthy ? best : null;
}

function scoreCandidate(item, identity) {
  // Overlay subtitles and watermarks are useful later for timestamp location,
  // but must not influence source-title matching.
  const titleSimilarity = textSimilarity(item?.title, identity?.title);
  const accountTargets = dedupeStrings([
    identity?.account,
    ...(Array.isArray(identity?.accountAliases) ? identity.accountAliases : [])
  ]);
  const accountSimilarity = accountTargets.length
    ? Math.max(...accountTargets.map((target) => (
        textSimilarity([item?.account, item?.snippet].filter(Boolean).join(" "), target)
      )))
    : 0;
  const candidatePlatform = item?.platform || platformFromUrl(item?.url);
  const platformSimilarity = identity?.platform && candidatePlatform === identity.platform ? 1 : 0;
  const evidenceSimilarity = textCoverageSimilarity(
    [item?.title, item?.snippet].filter(Boolean).join(" "),
    identity?.searchText
  );
  return {
    matchScore: titleSimilarity * 0.55 + accountSimilarity * 0.2 + evidenceSimilarity * 0.2 + platformSimilarity * 0.05,
    titleSimilarity,
    accountSimilarity,
    evidenceSimilarity,
    platformSimilarity
  };
}

function platformFromUrl(value) {
  const url = String(value || "").toLowerCase();
  if (url.includes("bilibili.com")) return "bilibili";
  if (url.includes("douyin.com")) return "douyin";
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com")) return "xiaohongshu";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("mp.weixin.qq.com")) return "wechat";
  if (url.includes("zhihu.com")) return "zhihu";
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

function textCoverageSimilarity(left, right) {
  const a = ngrams(normalizedText(left));
  const b = ngrams(normalizedText(right));
  if (a.size < 3 || b.size < 3) return 0;
  const common = [...a].filter((item) => b.has(item)).length;
  return common / Math.min(a.size, b.size);
}

async function materializeImage(imageBase64) {
  if (!imageBase64) return "";
  const data = String(imageBase64).replace(/^data:image\/[^;]+;base64,/, "");
  const path = `/tmp/shibei-image-${Date.now()}.jpg`;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, Buffer.from(data, "base64")));
  return path;
}
