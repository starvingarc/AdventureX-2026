import { dirname } from "node:path";
import { availableParallelism } from "node:os";

import { splitAudioForParallelAsr } from "./asrAudioChunks.js";
import { cleanupMediaTempFiles, downloadMediaToTempFile } from "./mediaFiles.js";
import { extractAudioWithFfmpeg } from "./ffmpegAudio.js";
import { createMediaExtractionError } from "./mediaErrors.js";
import { createSpeechToTextProvider } from "./speechToTextProvider.js";
import { fetchTikHubVideoSource } from "./tikhubVideoProvider.js";
import { fetchBilibiliVideoSource } from "./bilibiliSubtitleProvider.js";
import { fetchYtDlpVideoSource } from "./ytDlpVideoProvider.js";
import { downloadYtDlpMediaToTempFile } from "./ytDlpMediaDownloader.js";
import {
  detectVideoPlatform,
  isTikHubPreferredPlatform,
  isYtDlpPreferredPlatform
} from "./videoPlatforms.js";
import { buildLearningSourceFromVideo } from "./learningSource.js";
import { summarizeMediaUsage } from "./mediaCost.js";
import { fetchPlatformSubtitleTranscript } from "./platformSubtitles.js";
import { registerTemporaryPublicMedia } from "./temporaryPublicMedia.js";
import {
  createVideoFramePack,
  createVideoFramePackProvider
} from "./videoFramePackProvider.js";
import {
  createVisualUnderstandingProvider,
  understandVideoVisuals
} from "./visualUnderstandingProvider.js";
import { VIDEO_DEFAULTS } from "./videoDefaults.js";
import {
  buildVideoExtractionSignature,
  buildVideoLearningSourceCacheKey,
  buildVideoSourceCacheKey,
  deleteCache,
  getSharedLearningSourceCache,
  getSharedVideoSourceCache,
  readCache,
  VIDEO_LEARNING_SOURCE_CACHE_VERSION,
  writeCache
} from "./videoExtractionCache.js";

export async function extractVideoLearningSource({
  sourceUrl,
  rawText = "",
  sourceTitle = "",
  preferredTimestampSeconds = null,
  preferredLanguage = "auto",
  provider = null,
  downloadMedia = downloadMediaToTempFile,
  downloadYtDlpMedia = downloadYtDlpMediaToTempFile,
  maxDurationSeconds = readPositiveInt(process.env.VIDEO_MAX_DURATION_SECONDS, VIDEO_DEFAULTS.maxDurationSeconds),
  mediaMaxBytes = readPositiveInt(process.env.VIDEO_MEDIA_MAX_BYTES, VIDEO_DEFAULTS.mediaMaxBytes),
  extractAudio = extractAudioWithFfmpeg,
  splitAudioForAsr = splitAudioForParallelAsr,
  speechToTextProvider = createSpeechToTextProvider(),
  transcribeAudio = null,
  fetchPlatformTranscript = fetchPlatformSubtitleTranscript,
  framePackProvider = createVideoFramePackProvider(),
  createFramePack = createVideoFramePack,
  visualUnderstandingProvider = createVisualUnderstandingProvider(),
  understandVisuals = understandVideoVisuals,
  cleanup = cleanupMediaTempFiles,
  mediaUsageRecorder = null,
  now = new Date().toISOString(),
  videoSourceCache = undefined,
  learningSourceCache = undefined,
  extractionCacheVersion = VIDEO_LEARNING_SOURCE_CACHE_VERSION,
  publicMediaBaseUrl = process.env.SHIBEI_PUBLIC_BASE_URL || ""
} = {}) {
  const sourceInput = sourceUrl || rawText;
  const asrPrompt = [sourceTitle, rawText].map((value) => String(value || "").trim()).filter(Boolean).join("；").slice(0, 300);
  const visualEnabled = readBooleanFlag(process.env.VIDEO_VISUAL_ENABLED, false)
    || createFramePack !== createVideoFramePack
    || understandVisuals !== understandVideoVisuals
    || (framePackProvider?.name && framePackProvider.name !== "none")
    || (visualUnderstandingProvider?.name && visualUnderstandingProvider.name !== "none");
  const activeProvider = provider || createVideoSourceProvider(sourceInput);
  const resolvedVideoSourceCache = resolveDefaultCache({
    providedCache: videoSourceCache,
    defaultCache: getSharedVideoSourceCache,
    enabled: activeProvider?.fetchVideoSource === fetchTikHubVideoSource
  });
  const resolvedLearningSourceCache = resolveDefaultCache({
    providedCache: learningSourceCache,
    defaultCache: getSharedLearningSourceCache,
    enabled: isDefaultExtractionChain({
      provider: activeProvider,
      downloadMedia,
      downloadYtDlpMedia,
      extractAudio,
      transcribeAudio,
      fetchPlatformTranscript,
      createFramePack,
      understandVisuals,
      cleanup
    })
  });
  const extractionSignature = buildVideoExtractionSignature({
    asrProvider: transcribeAudio ? "custom" : speechToTextProvider?.name || "custom",
    frameProvider: framePackProvider?.name || "custom",
    visualProvider: visualUnderstandingProvider?.name || "custom",
    sourceProvider: activeProvider?.name || "custom",
    visualModel: visualUnderstandingProvider?.model || "",
    version: extractionCacheVersion
  });
  const learningSourceCacheKey = buildVideoLearningSourceCacheKey({
    sourceUrl: sourceInput,
    extractionVersion: extractionCacheVersion,
    extractionSignature
  });
  const cachedLearningSource = await readCache(resolvedLearningSourceCache, learningSourceCacheKey);
  if (cachedLearningSource) {
    recordMediaUsage(mediaUsageRecorder, {
      stage: "video_learning_source_cache",
      provider: "memory",
      cost: 0,
      metadata: { cacheHit: true, cacheKey: learningSourceCacheKey }
    });
    const cachedResult = withCacheMeta(cachedLearningSource, {
      hit: true,
      key: learningSourceCacheKey,
      version: extractionCacheVersion,
      signature: extractionSignature
    });
    if (mediaUsageRecorder?.calls) {
      cachedResult.extractionMeta.mediaUsage = summarizeMediaUsage(mediaUsageRecorder.calls);
    }
    return cachedResult;
  }

  const videoSourceCacheKey = buildVideoSourceCacheKey({ sourceUrl: sourceInput });
  let video = await readCache(resolvedVideoSourceCache, videoSourceCacheKey);
  let videoSourceCacheHit = Boolean(video);
  if (!video) {
    video = await activeProvider.fetchVideoSource({ sourceUrl: sourceInput });
    enforceVideoDurationLimit(video, { maxDurationSeconds });
    await writeCache(resolvedVideoSourceCache, videoSourceCacheKey, video);
  } else {
    enforceVideoDurationLimit(video, { maxDurationSeconds });
  }
  recordVideoSourceUsage(mediaUsageRecorder, { video, videoSourceCacheHit, videoSourceCacheKey });
  const platformTranscript = await fetchPlatformTranscript({ subtitles: video.subtitles });
  if (platformTranscript && !visualEnabled) {
    const transcriptProvider = platformTranscript.provider || "platform_subtitle";
    recordMediaUsage(mediaUsageRecorder, {
      stage: "audio_transcription",
      provider: transcriptProvider,
      cost: 0,
      metadata: {
        segmentCount: Array.isArray(platformTranscript.segments) ? platformTranscript.segments.length : 0,
        source: "platform_subtitle",
        fastPath: true
      }
    });
    const visualUnderstanding = {
      provider: "none",
      model: "",
      status: "skipped",
      skipped: true,
      reason: "platform_subtitle_fast_path",
      segments: [],
      usage: {},
      diagnostics: {}
    };
    const learningSource = buildLearningSourceFromVideo({
      platform: video.platform,
      title: sourceTitle || video.title,
      url: video.sourceUrl || sourceUrl || rawText,
      account: video.account,
      author: video.account,
      durationSeconds: video.durationSeconds,
      description: video.description,
      transcriptSegments: platformTranscript.segments,
      visualSegments: [],
      media: {
        provider: video.provider,
        providerContentId: video.providerContentId,
        coverUrl: video.coverUrl
      },
      now
    });
    learningSource.extractionMeta.visualUnderstanding = buildVisualUnderstandingMeta(visualUnderstanding);
    learningSource.extractionMeta.userVisibleContentBasis = buildUserVisibleContentBasis(visualUnderstanding);
    learningSource.extractionMeta.asr = {
      provider: transcriptProvider,
      sampled: transcriptProvider.includes(":quorum-"),
      segmentCount: Array.isArray(platformTranscript.segments) ? platformTranscript.segments.length : 0
    };
    learningSource.extractionMeta.fastPath = "platform_subtitle";
    if (mediaUsageRecorder?.calls) {
      learningSource.extractionMeta.mediaUsage = summarizeMediaUsage(mediaUsageRecorder.calls);
    }
    if (shouldCacheLearningSource(learningSource)) {
      await writeCache(resolvedLearningSourceCache, learningSourceCacheKey, learningSource);
    }
    return withCacheMeta(learningSource, {
      hit: false,
      key: learningSourceCacheKey,
      version: extractionCacheVersion,
      signature: extractionSignature
    });
  }
  const tempFiles = [];
  try {
    let staleVideoSourceCache = false;
    let transcript = platformTranscript;
    let mediaFile = null;
    const activeTranscribeAudio = transcribeAudio || speechToTextProvider.transcribeAudio;

    // Qwen can transcribe a platform-provided audio URL directly. Avoid a full
    // download when the URL is public; this is the normal fast path for videos
    // without captions.
    if (!transcript) {
      if (
        !transcribeAudio
        && typeof speechToTextProvider.transcribeMedia === "function"
        && video.audioUrl
        && Object.keys(video.mediaRequestHeaders || {}).length === 0
      ) {
        try {
          transcript = await speechToTextProvider.transcribeMedia({ mediaUrl: video.audioUrl, language: preferredLanguage });
          recordMediaUsage(mediaUsageRecorder, {
            stage: "audio_extraction",
            provider: "provider_audio_url",
            cost: 0,
            metadata: { fastPath: true }
          });
        } catch {
          // CDN URLs can block Qwen. Download only after this direct path fails.
        }
      }
    }

    if (!transcript || visualEnabled) {
      try {
        mediaFile = await downloadVideoMedia({ video, downloadMedia, downloadYtDlpMedia, mediaMaxBytes });
      } catch (error) {
        if (!shouldRefreshCachedVideoSource({ error, videoSourceCacheHit })) throw error;
        staleVideoSourceCache = true;
        await deleteCache(resolvedVideoSourceCache, videoSourceCacheKey);
        video = await activeProvider.fetchVideoSource({ sourceUrl: sourceInput });
        enforceVideoDurationLimit(video, { maxDurationSeconds });
        videoSourceCacheHit = false;
        await writeCache(resolvedVideoSourceCache, videoSourceCacheKey, video);
        recordVideoSourceUsage(mediaUsageRecorder, {
          video,
          videoSourceCacheHit,
          videoSourceCacheKey,
          metadata: { staleVideoSourceCache: true, refetchedProviderSource: true }
        });
        mediaFile = await downloadVideoMedia({ video, downloadMedia, downloadYtDlpMedia, mediaMaxBytes });
      }
      recordMediaUsage(mediaUsageRecorder, {
        stage: "video_media_fetch",
        provider: video.mediaDownload?.provider || video.provider || "unknown",
        cost: 0,
        metadata: {
          bytes: mediaFile.bytes || 0,
          contentType: mediaFile.contentType || "",
          ...(staleVideoSourceCache ? { staleVideoSourceCache: true, refetchedProviderSource: true } : {})
        }
      });
      tempFiles.push(mediaFile);
    }

    if (!transcript) {
      if (!mediaFile || typeof activeTranscribeAudio !== "function") {
        throw createMediaExtractionError("asr_unavailable", "视频音频暂时无法转写。", { retryable: true, provider: speechToTextProvider.name || "asr" });
      }
      transcript = await transcribeWithTemporaryPublicMedia({
        speechToTextProvider,
        mediaFile,
        publicMediaBaseUrl,
        durationSeconds: video.durationSeconds,
        preferredTimestampSeconds,
        preferredLanguage,
        splitAudio: splitAudioForAsr,
        tempFiles,
        transcribeChunk: (chunk) => activeTranscribeAudio({ audioPath: chunk.path, language: preferredLanguage, initialPrompt: asrPrompt }),
        fallback: () => transcribeLocalAudio({ mediaFile, extractAudio, activeTranscribeAudio, tempFiles, mediaUsageRecorder, preferredLanguage, initialPrompt: asrPrompt })
      });
    }
    const transcriptProvider = transcript.provider || speechToTextProvider.name || "custom";
    recordMediaUsage(mediaUsageRecorder, {
      stage: "audio_transcription",
      provider: transcriptProvider,
      cost: 0,
      metadata: {
        segmentCount: Array.isArray(transcript.segments) ? transcript.segments.length : 0,
        source: transcriptProvider.startsWith("platform_subtitle:") ? "platform_subtitle" : "asr"
      }
    });
    const framePack = visualEnabled
      ? await createFramePack({
          provider: framePackProvider,
          video,
          mediaFile,
          transcriptSegments: transcript.segments
        })
      : {
          provider: "none",
          skipped: true,
          reason: "disabled_by_default",
          frames: [],
          grids: [],
          debug: {}
        };
    recordMediaUsage(mediaUsageRecorder, {
      stage: "video_frame_pack",
      provider: framePack.provider || framePackProvider.name || "unknown",
      cost: 0,
      metadata: {
        skipped: Boolean(framePack.skipped),
        reason: framePack.reason || "",
        frameCount: Array.isArray(framePack.frames) ? framePack.frames.length : 0,
        gridCount: Array.isArray(framePack.grids) ? framePack.grids.length : 0,
        timestampMode: framePack.debug?.timestampMode || "",
        ...(framePack.debug?.failureCode ? {
          failureCode: framePack.debug.failureCode,
          failureMessage: framePack.debug.failureMessage || "",
          retryable: framePack.debug.retryable
        } : {})
      }
    });
    const visualUnderstanding = visualEnabled
      ? await safelyUnderstandVideoVisuals({
          understandVisuals,
          provider: visualUnderstandingProvider,
          video,
          mediaFile,
          transcriptSegments: transcript.segments,
          framePack
        })
      : {
          provider: "none",
          model: "",
          status: "skipped",
          skipped: true,
          reason: "disabled_by_default",
          segments: [],
          usage: {},
          diagnostics: {}
        };
    recordMediaUsage(mediaUsageRecorder, {
      stage: "visual_understanding",
      provider: visualUnderstanding.provider || visualUnderstandingProvider.name || "unknown",
      cost: 0,
      metadata: {
        skipped: Boolean(visualUnderstanding.skipped),
        status: visualUnderstanding.status,
        reason: visualUnderstanding.reason || "",
        segmentCount: Array.isArray(visualUnderstanding.segments) ? visualUnderstanding.segments.length : 0,
        model: visualUnderstanding.model || "",
        usage: visualUnderstanding.usage || {},
        ...(visualUnderstanding.diagnostics?.failureCode ? {
          failureCode: visualUnderstanding.diagnostics.failureCode,
          retryable: visualUnderstanding.diagnostics.retryable
        } : {})
      }
    });
    const learningSource = buildLearningSourceFromVideo({
      platform: video.platform,
      title: sourceTitle || video.title,
      url: video.sourceUrl || sourceUrl || rawText,
      account: video.account,
      author: video.account,
      durationSeconds: video.durationSeconds,
      description: video.description,
      transcriptSegments: transcript.segments,
      visualSegments: visualUnderstanding.segments,
      media: {
        provider: video.provider,
        providerContentId: video.providerContentId,
        coverUrl: video.coverUrl
      },
      now
    });
    learningSource.extractionMeta.visualUnderstanding = buildVisualUnderstandingMeta(visualUnderstanding);
    learningSource.extractionMeta.userVisibleContentBasis = buildUserVisibleContentBasis(visualUnderstanding);
    learningSource.extractionMeta.asr = {
      provider: transcriptProvider,
      sampled: transcriptProvider.includes(":quorum-"),
      segmentCount: Array.isArray(transcript.segments) ? transcript.segments.length : 0
    };
    if (mediaUsageRecorder?.calls) {
      learningSource.extractionMeta.mediaUsage = summarizeMediaUsage(mediaUsageRecorder.calls);
    }
    if (shouldCacheLearningSource(learningSource)) {
      await writeCache(resolvedLearningSourceCache, learningSourceCacheKey, learningSource);
    }
    return withCacheMeta(learningSource, {
      hit: false,
      key: learningSourceCacheKey,
      version: extractionCacheVersion,
      signature: extractionSignature,
      stored: shouldCacheLearningSource(learningSource)
    });
  } finally {
    await cleanup(...tempFiles);
  }
}

async function safelyUnderstandVideoVisuals({
  understandVisuals,
  provider,
  video,
  mediaFile,
  transcriptSegments,
  framePack
}) {
  try {
    const result = await understandVisuals({
      provider,
      video,
      mediaFile,
      transcriptSegments,
      framePack
    });
    return {
      ...result,
      status: result?.skipped ? "skipped" : "succeeded"
    };
  } catch (error) {
    const failureCode = classifyVisualUnderstandingFailure(error);
    return {
      provider: error?.provider || provider?.name || "unknown",
      model: "",
      skipped: true,
      status: "failed",
      reason: failureCode,
      segments: [],
      usage: {},
      diagnostics: {
        status: "failed",
        failureCode,
        failureMessage: String(error?.message || "visual understanding failed"),
        provider: error?.provider || provider?.name || "unknown",
        retryable: error?.retryable !== undefined ? Boolean(error.retryable) : isRetryableVisualFailure(failureCode)
      }
    };
  }
}

function buildVisualUnderstandingMeta(visualUnderstanding = {}) {
  const diagnostics = visualUnderstanding.diagnostics || {};
  return {
    status: visualUnderstanding.status || (visualUnderstanding.skipped ? "skipped" : "succeeded"),
    provider: visualUnderstanding.provider || "",
    model: visualUnderstanding.model || "",
    segmentCount: Array.isArray(visualUnderstanding.segments) ? visualUnderstanding.segments.length : 0,
    ...(diagnostics.failureCode ? { failureCode: diagnostics.failureCode } : {}),
    ...(diagnostics.failureMessage ? { failureMessage: diagnostics.failureMessage } : {}),
    ...(diagnostics.retryable !== undefined ? { retryable: Boolean(diagnostics.retryable) } : {})
  };
}

function buildUserVisibleContentBasis(visualUnderstanding = {}) {
  const hasVisualEvidence = visualUnderstanding.status === "succeeded"
    && Array.isArray(visualUnderstanding.segments)
    && visualUnderstanding.segments.length > 0;

  return hasVisualEvidence
    ? {
      basis: "audio_visual",
      message: "已结合视频字幕和画面信息生成"
    }
    : {
      basis: "audio_transcript",
      message: "本次主要基于视频字幕生成"
    };
}

function classifyVisualUnderstandingFailure(error) {
  const code = String(error?.code || error?.mediaErrorType || "");
  const message = String(error?.message || "");
  if (
    code === "no_json_object"
    || message === "no_json_object"
    || /JSON|parse|Unexpected token|no_json_object/i.test(message)
  ) {
    return "visual_output_parse_failed";
  }
  return code || "visual_understanding_failed";
}

function isRetryableVisualFailure(failureCode) {
  return failureCode !== "visual_provider_missing_api_key"
    && failureCode !== "unsupported_visual_understanding_provider"
    && failureCode !== "invalid_visual_understanding_provider";
}

function recordMediaUsage(mediaUsageRecorder, call) {
  if (!mediaUsageRecorder || typeof mediaUsageRecorder.record !== "function") return null;
  return mediaUsageRecorder.record(call);
}

function recordVideoSourceUsage(mediaUsageRecorder, {
  video,
  videoSourceCacheHit,
  videoSourceCacheKey,
  metadata = {}
}) {
  return recordMediaUsage(mediaUsageRecorder, {
    stage: video.provider === "tikhub" ? "tikhub_fetch" : "video_source_fetch",
    provider: videoSourceCacheHit ? `cache:${video.provider || "video-source"}` : video.provider || "video-source",
    cost: 0,
    metadata: {
      platform: video.platform,
      providerContentId: video.providerContentId || "",
      cacheHit: videoSourceCacheHit,
      cacheKey: videoSourceCacheKey,
      ...metadata
    }
  });
}

function shouldCacheLearningSource(learningSource) {
  return learningSource?.extractionMeta?.visualUnderstanding?.status !== "failed";
}

function shouldRefreshCachedVideoSource({ error, videoSourceCacheHit }) {
  if (!videoSourceCacheHit) return false;
  return error?.retryable === true && [
    "video_media_unavailable",
    "video_media_timeout"
  ].includes(error?.mediaErrorType);
}

function enforceVideoDurationLimit(video, { maxDurationSeconds }) {
  const durationSeconds = Number(video?.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) return;
  if (durationSeconds <= maxDurationSeconds) return;
  throw createMediaExtractionError(
    "video_duration_too_long",
    `视频时长超过 ${Math.round(maxDurationSeconds / 60)} 分钟，暂时无法生成复习内容。`,
    {
      retryable: false,
      provider: video?.provider || ""
    }
  );
}

function resolveDefaultCache({ providedCache, defaultCache, enabled }) {
  if (providedCache !== undefined) return providedCache;
  return enabled ? defaultCache() : null;
}

function isDefaultExtractionChain({
  provider,
  downloadMedia,
  downloadYtDlpMedia,
  extractAudio,
  transcribeAudio,
  fetchPlatformTranscript,
  createFramePack,
  understandVisuals,
  cleanup
}) {
  return (
    [fetchTikHubVideoSource, fetchBilibiliVideoSource, fetchYtDlpVideoSource].includes(provider?.fetchVideoSource)
    && downloadMedia === downloadMediaToTempFile
    && downloadYtDlpMedia === downloadYtDlpMediaToTempFile
    && extractAudio === extractAudioWithFfmpeg
    && transcribeAudio === null
    && fetchPlatformTranscript === fetchPlatformSubtitleTranscript
    && createFramePack === createVideoFramePack
    && understandVisuals === understandVideoVisuals
    && cleanup === cleanupMediaTempFiles
  );
}

function createVideoSourceProvider(sourceInput) {
  const platform = detectVideoPlatform(sourceInput);
  enforceVideoPlatformGate(platform);
  if (isTikHubPreferredPlatform(platform)) {
    return {
      name: "tikhub",
      fetchVideoSource: fetchTikHubVideoSource
    };
  }
  if (platform === "bilibili") {
    return {
      name: "bilibili_api",
      fetchVideoSource: fetchBilibiliVideoSource
    };
  }
  if (isYtDlpPreferredPlatform(platform)) {
    return {
      name: "yt-dlp",
      fetchVideoSource: fetchYtDlpVideoSource
    };
  }
  return {
    name: "yt-dlp",
    fetchVideoSource: fetchYtDlpVideoSource
  };
}

function enforceVideoPlatformGate(platform) {
  if (!readBooleanFlag(process.env.VIDEO_LINK_ENABLED, true)) {
    throw createMediaExtractionError(
      "video_link_disabled",
      "视频链接生成功能暂未开放。",
      { retryable: false }
    );
  }

  const allowlist = readPlatformAllowlist(process.env.VIDEO_PLATFORM_ALLOWLIST, VIDEO_DEFAULTS.platformAllowlist);
  if (allowlist.size > 0 && !allowlist.has(platform)) {
    throw createMediaExtractionError(
      "unsupported_video_platform",
      "这个视频平台暂未开放。可以换一个已支持的视频链接。",
      { retryable: false, provider: platform || "unknown" }
    );
  }

  if (platform !== "bilibili" && isYtDlpPreferredPlatform(platform) && !readBooleanFlag(process.env.VIDEO_YTDLP_ENABLED, true)) {
    throw createMediaExtractionError(
      "video_ytdlp_disabled",
      "YouTube、B站和网页视频链接暂未开放。",
      { retryable: false, provider: "yt-dlp" }
    );
  }
}

async function downloadVideoMedia({
  video,
  downloadMedia,
  downloadYtDlpMedia,
  mediaMaxBytes
}) {
  if (video?.mediaDownload?.provider === "yt-dlp") {
    return downloadYtDlpMedia({
      sourceUrl: video.mediaDownload.sourceUrl || video.sourceUrl,
      formatSelector: video.mediaDownload.formatSelector,
      maxBytes: mediaMaxBytes
    });
  }
  const urls = [video.mediaUrl, ...(video.mediaAlternativeUrls || [])].filter(Boolean);
  if (urls.length > 1 && downloadMedia === downloadMediaToTempFile) {
    return downloadHedgedMedia(urls.slice(0, 2), {
      downloadMedia,
      mediaMaxBytes,
      requestHeaders: video.mediaRequestHeaders || {}
    });
  }
  let lastError;
  for (const mediaUrl of urls) {
    try {
      return await downloadMedia({
        mediaUrl,
        maxBytes: mediaMaxBytes,
        requestHeaders: video.mediaRequestHeaders || {}
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function downloadHedgedMedia(urls, { downloadMedia, mediaMaxBytes, requestHeaders }) {
  return new Promise((resolveDownload, rejectDownload) => {
    const controllers = urls.map(() => new AbortController());
    const failures = [];
    let settled = false;
    urls.forEach((mediaUrl, index) => {
      downloadMedia({
        mediaUrl,
        maxBytes: mediaMaxBytes,
        requestHeaders,
        signal: controllers[index].signal
      }).then((file) => {
        if (settled) {
          cleanupMediaTempFiles(file).catch(() => {});
          return;
        }
        settled = true;
        controllers.forEach((controller, controllerIndex) => {
          if (controllerIndex !== index) controller.abort();
        });
        resolveDownload(file);
      }).catch((error) => {
        failures.push(error);
        if (!settled && failures.length >= urls.length) {
          settled = true;
          rejectDownload(failures.at(-1));
        }
      });
    });
  });
}

function isAudioMediaFile(mediaFile) {
  if (mediaFile?.isAudioOnly) return true;
  const contentType = String(mediaFile?.contentType || "").toLowerCase();
  if (contentType.startsWith("audio/")) return true;
  return /\.(m4a|mp3|opus|ogg|wav)(?:$|\?)/i.test(String(mediaFile?.path || ""));
}

async function transcribeLocalAudio({ mediaFile, extractAudio, activeTranscribeAudio, tempFiles, mediaUsageRecorder, preferredLanguage, initialPrompt }) {
  const sourceIsAudio = isAudioMediaFile(mediaFile);
  const audio = sourceIsAudio
    ? { ...mediaFile, format: "source_audio", sampleRate: null }
    : await extractAudio({ inputPath: mediaFile.path, outputDir: dirname(mediaFile.path) });
  recordMediaUsage(mediaUsageRecorder, {
    stage: "audio_extraction",
    provider: sourceIsAudio ? "source_audio" : "ffmpeg",
    cost: 0,
    metadata: { format: audio.format || "", sampleRate: audio.sampleRate || null, fastPath: sourceIsAudio }
  });
  if (!sourceIsAudio) tempFiles.push(audio);
  return activeTranscribeAudio({ audioPath: audio.path, language: preferredLanguage, initialPrompt });
}

async function transcribeWithTemporaryPublicMedia({
  speechToTextProvider,
  mediaFile,
  publicMediaBaseUrl,
  durationSeconds,
  preferredTimestampSeconds,
  preferredLanguage,
  splitAudio,
  tempFiles,
  transcribeChunk,
  fallback
}) {
  const localAsr = typeof speechToTextProvider?.transcribeMedia !== "function";
  const parallelThresholdSeconds = localAsr
    ? readPositiveInt(process.env.LOCAL_ASR_PARALLEL_THRESHOLD_SECONDS, 30)
    : readPositiveInt(process.env.QWEN_ASR_PARALLEL_THRESHOLD_SECONDS, 900);
  if (Number(durationSeconds) >= parallelThresholdSeconds) {
    try {
      const chunked = await splitAudio({
        inputPath: mediaFile.path,
        ...(localAsr ? { chunkSeconds: readPositiveInt(process.env.LOCAL_ASR_CHUNK_SECONDS, 10) } : {})
      });
      tempFiles.push({ dir: chunked.dir });
      const chunks = selectRepresentativeChunks(chunked.chunks, {
        maxChunks: localAsr
          ? readPositiveInt(process.env.LOCAL_ASR_MAX_CHUNKS, 12)
          : readPositiveInt(process.env.QWEN_ASR_MAX_CHUNKS, 8),
        preferredTimestampSeconds
      });
      if (typeof speechToTextProvider?.transcribeMedia === "function" && normalizePublicMediaBase(publicMediaBaseUrl)) {
        return await transcribeChunksWithQuorum({
          chunks,
          providerName: speechToTextProvider.name,
          concurrency: readPositiveInt(process.env.QWEN_ASR_CHUNK_CONCURRENCY, 6),
          quorum: readPositiveInt(process.env.QWEN_ASR_SUCCESS_QUORUM, 3),
          transcribe: async (chunk) => {
            const lease = registerTemporaryPublicMedia({
              path: chunk.path,
              contentType: chunk.contentType,
              publicBaseUrl: publicMediaBaseUrl
            });
            if (!lease) throw new Error("public media URL is unavailable");
            try {
              return await speechToTextProvider.transcribeMedia({ mediaUrl: lease.url, language: preferredLanguage });
            } finally {
              lease.release();
            }
          }
        });
      }
      if (typeof transcribeChunk === "function") {
        return await transcribeChunksWithQuorum({
          chunks,
          providerName: "local_whisper:sampled",
          concurrency: localAsrConcurrency(),
          quorum: readPositiveInt(process.env.LOCAL_ASR_SUCCESS_QUORUM, 3),
          transcribe: transcribeChunk
        });
      }
    } catch {
      // Preserve the full-file fallback when no representative chunk succeeds.
    }
  }
  if (typeof speechToTextProvider?.transcribeMedia !== "function") return fallback();
  const lease = registerTemporaryPublicMedia({
    path: mediaFile.path,
    contentType: mediaFile.contentType,
    publicBaseUrl: publicMediaBaseUrl
  });
  if (!lease) return fallback();
  try {
    return await speechToTextProvider.transcribeMedia({ mediaUrl: lease.url, language: preferredLanguage });
  } catch (error) {
    // A temporary URL can fail when the deployment is not publicly reachable.
    // Preserve local Whisper as the development fallback.
    return fallback();
  } finally {
    lease.release();
  }
}

function localAsrConcurrency() {
  const explicit = Number(process.env.LOCAL_ASR_CHUNK_CONCURRENCY);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const threadsPerWorker = readPositiveInt(process.env.LOCAL_WHISPER_CPU_THREADS, 2);
  // Bound total CTranslate2 threads to the available logical CPU budget. More
  // processes than this reduce throughput because every worker performs dense
  // matrix operations at the same time.
  return Math.max(1, Math.min(8, Math.floor(availableParallelism() / threadsPerWorker)));
}

async function transcribeChunksWithQuorum({ chunks, transcribe, providerName, concurrency, quorum }) {
  const required = Math.max(1, Math.min(Number(quorum) || 1, chunks.length));
  const results = await collectWithSuccessQuorum(chunks, {
    concurrency,
    quorum: required,
    operation: async (chunk) => {
      const transcript = await transcribe(chunk);
      const segments = (transcript?.segments || []).map((segment, index) => ({
        ...segment,
        id: `chunk-${String(chunk.chunkIndex + 1).padStart(3, "0")}-${segment.id || index + 1}`,
        startSeconds: Number(segment.startSeconds) + chunk.startSeconds,
        endSeconds: Number(segment.endSeconds) + chunk.startSeconds
      }));
      if (!segments.length) throw new Error("ASR chunk returned no segments");
      return segments;
    }
  });
  const segments = results.flat().sort((left, right) => Number(left.startSeconds) - Number(right.startSeconds));
  if (!segments.length) throw new Error("parallel ASR returned no segments");
  return {
    provider: `${providerName || "asr"}:quorum-${results.length}-of-${chunks.length}`,
    text: segments.map((segment) => segment.text).join(" "),
    segments
  };
}

function selectRepresentativeChunks(chunks, { maxChunks, preferredTimestampSeconds }) {
  const indexes = chunks.length <= maxChunks
    ? new Set(chunks.map((_, index) => index))
    : new Set([0, chunks.length - 1, Math.floor((chunks.length - 1) / 2)]);
  if (chunks.length > maxChunks) {
    for (let slot = 1; indexes.size < maxChunks && slot < maxChunks * 2; slot += 1) {
      indexes.add(Math.round((slot * (chunks.length - 1)) / (maxChunks - 1)));
    }
  }
  const timestamp = Number(preferredTimestampSeconds);
  if (Number.isFinite(timestamp)) {
    const nearest = chunks.reduce((best, chunk, index) => (
      Math.abs(Number(chunk.startSeconds) - timestamp) < Math.abs(Number(chunks[best].startSeconds) - timestamp) ? index : best
    ), 0);
    if (!indexes.has(nearest)) {
      indexes.delete([...indexes].at(-2));
      indexes.add(nearest);
    }
  }
  const selected = [...indexes].slice(0, maxChunks);
  const preferredIndex = Number.isFinite(timestamp)
    ? selected.reduce((best, index) => (
      Math.abs(Number(chunks[index].startSeconds) - timestamp) < Math.abs(Number(chunks[best].startSeconds) - timestamp) ? index : best
    ), selected[0])
    : null;
  const priority = [preferredIndex, 0, Math.floor((chunks.length - 1) / 2), chunks.length - 1]
    .filter((index, position, values) => index !== null && selected.includes(index) && values.indexOf(index) === position);
  return [...priority, ...selected.filter((index) => !priority.includes(index))].map((index) => chunks[index]);
}

function collectWithSuccessQuorum(items, { concurrency, quorum, operation }) {
  return new Promise((resolve, reject) => {
    const successes = [];
    const failures = [];
    let cursor = 0;
    let active = 0;
    let settled = false;
    const launch = () => {
      while (!settled && active < Math.min(concurrency, items.length) && cursor < items.length) {
        const item = items[cursor++];
        active += 1;
        Promise.resolve(operation(item)).then((value) => {
          active -= 1;
          if (settled) return;
          successes.push(value);
          if (successes.length >= quorum) {
            settled = true;
            resolve([...successes]);
            return;
          }
          launch();
        }).catch((error) => {
          active -= 1;
          if (settled) return;
          failures.push(error);
          if (cursor >= items.length && active === 0) {
            settled = true;
            if (successes.length) resolve([...successes]);
            else reject(failures.at(-1) || new Error("all ASR chunks failed"));
            return;
          }
          launch();
        });
      }
    };
    launch();
  });
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function retryAsync(operation, { attempts, baseDelayMs, jitterMs }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** (attempt - 1)) + jitterMs));
    }
  }
  throw lastError;
}

function normalizePublicMediaBase(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function withCacheMeta(learningSource, cache) {
  return {
    ...learningSource,
    extractionMeta: {
      ...(learningSource.extractionMeta || {}),
      cache
    }
  };
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function readBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "off", "disabled", "no"].includes(String(value).trim().toLowerCase());
}

function readPlatformAllowlist(value, fallback = []) {
  if (value === undefined || value === null || value === "") return new Set(fallback);
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}
