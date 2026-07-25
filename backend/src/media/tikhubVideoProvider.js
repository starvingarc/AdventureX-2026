import { createMediaExtractionError } from "./mediaErrors.js";
import {
  detectVideoPlatform,
  isTikHubPreferredPlatform,
  normalizeVideoSourceUrl
} from "./videoPlatforms.js";
import { fetchTikHubContentSource } from "../sources/tikhubContentProvider.js";

export async function fetchTikHubVideoSource({
  sourceUrl,
  apiKey = process.env.TIKHUB_API_KEY || "",
  baseUrl = process.env.TIKHUB_BASE_URL || "https://api.tikhub.dev",
  fetchImpl = fetch,
  timeoutMs = readPositiveInt(process.env.TIKHUB_TIMEOUT_MS, 30_000)
} = {}) {
  const url = normalizeVideoSourceUrl(sourceUrl);
  const platform = detectVideoPlatform(url.href);
  if (!isTikHubPreferredPlatform(platform)) {
    throw createMediaExtractionError(
      "unsupported_video_platform",
      "当前优先支持抖音和小红书公开视频链接。",
      { retryable: false, provider: "tikhub" }
    );
  }
  let content;
  try {
    content = await fetchTikHubContentSource({
      sourceUrl: url.href,
      apiKey,
      baseUrl,
      fetchImpl,
      timeoutMs,
      preferVideo: true
    });
  } catch (error) {
    if (error?.code !== "failed_extract_source") throw error;
    throw createMediaExtractionError(
      error.sourceErrorType || "provider_unavailable",
      error.message,
      {
        retryable: error.retryable,
        provider: "tikhub",
        status: error.status,
        cause: error
      }
    );
  }
  if (!content.mediaUrl) throw mediaUnavailable();
  return {
    provider: "tikhub",
    platform,
    providerContentId: content.providerContentId,
    title: content.title,
    description: content.description,
    account: content.account,
    sourceUrl: content.sourceUrl || url.href,
    mediaUrl: content.mediaUrl,
    mediaAlternativeUrls: (content.mediaUrls || []).filter((item) => item && item !== content.mediaUrl),
    mediaRequestHeaders: platform === "douyin"
      ? { "user-agent": "Mozilla/5.0", referer: "https://www.douyin.com/" }
      : {},
    coverUrl: content.coverUrl,
    durationSeconds: content.durationSeconds,
    subtitles: content.subtitles
  };
}

function mediaUnavailable() {
  return createMediaExtractionError(
    "video_media_url_missing",
    "无法获取可处理的视频地址。请确认视频为公开视频。",
    { retryable: false, provider: "tikhub" }
  );
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
