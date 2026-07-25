import { createMediaExtractionError } from "./mediaErrors.js";
import { normalizeSubtitleTracks } from "./platformSubtitles.js";
import { normalizeVideoSourceUrl } from "./videoPlatforms.js";
import { fetchYtDlpVideoSource } from "./ytDlpVideoProvider.js";

const BILIBILI_API = "https://api.bilibili.com";
const DEFAULT_TIMEOUT_MS = readPositiveInt(process.env.BILIBILI_API_TIMEOUT_MS, 12_000);
const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.dev";

// Mirrors BibiGPT's fast path: fetch Bilibili's own metadata and subtitle tracks
// before falling back to a media download and ASR.
export async function fetchBilibiliVideoSource({
  sourceUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tikhubApiKey = process.env.TIKHUB_API_KEY || "",
  tikhubBaseUrl = process.env.TIKHUB_BASE_URL || DEFAULT_TIKHUB_BASE_URL
} = {}) {
  const url = normalizeVideoSourceUrl(sourceUrl);
  const videoId = parseBilibiliVideoId(url);
  if (!videoId) {
    throw createMediaExtractionError("invalid_video_url", "无法识别 B 站视频编号。", {
      retryable: false,
      provider: "bilibili"
    });
  }

  const view = await fetchJson(`${BILIBILI_API}/x/web-interface/view?${videoId.key}=${videoId.value}`, {
    fetchImpl,
    timeoutMs
  });
  const data = view?.data;
  if (!data?.aid) {
    throw createMediaExtractionError("provider_unavailable", "B站没有返回可用的视频信息。", {
      retryable: true,
      provider: "bilibili"
    });
  }

  const pageNumber = Number(url.searchParams.get("p")) || 1;
  const page = Array.isArray(data.pages)
    ? data.pages.find((item) => Number(item?.page) === pageNumber) || data.pages[0]
    : null;
  const cid = page?.cid || data.cid;
  const player = cid
    ? await fetchJson(`${BILIBILI_API}/x/player/v2?aid=${data.aid}&cid=${cid}`, { fetchImpl, timeoutMs }).catch(() => null)
    : null;
  const subtitles = normalizeBilibiliSubtitles(player?.data?.subtitle?.subtitles);
  const mediaFallback = subtitles.length
    ? null
    : await fetchBilibiliAudioFromTikHub({
        bvid: data.bvid,
        cid,
        apiKey: tikhubApiKey,
        baseUrl: tikhubBaseUrl,
        fetchImpl,
        timeoutMs
      }).catch(() => fetchYtDlpVideoSource({
        sourceUrl: url.href,
        formatSelector: process.env.YT_DLP_AUDIO_FORMAT_SELECTOR || "bestaudio/best"
      }));

  return {
    provider: "bilibili_api",
    platform: "bilibili",
    providerContentId: String(data.bvid || data.aid),
    title: text(data.title) || "哔哩哔哩视频",
    description: text(data.desc) || text(data.dynamic),
    account: text(data.owner?.name),
    sourceUrl: canonicalUrl(data.bvid || videoId.value),
    mediaUrl: mediaFallback?.audioUrl || url.href,
    audioUrl: mediaFallback?.audioUrl || "",
    mediaAlternativeUrls: mediaFallback?.audioUrls?.slice(1) || [],
    // TikHub returns a Bilibili CDN URL. The CDN rejects bare server-side
    // requests, while these standard playback headers are accepted.
    mediaRequestHeaders: mediaFallback?.audioUrl ? {
      referer: "https://www.bilibili.com/",
      "user-agent": "Mozilla/5.0"
    } : {},
    coverUrl: text(data.pic),
    durationSeconds: positiveNumber(page?.duration || data.duration),
    subtitles,
    // This is used only when the fast subtitle path is unavailable.
    mediaDownload: subtitles.length ? null : mediaFallback?.mediaDownload
  };
}

async function fetchBilibiliAudioFromTikHub({ bvid, cid, apiKey, baseUrl, fetchImpl, timeoutMs }) {
  if (!bvid || !cid || !apiKey) throw new Error("TikHub Bilibili audio source is unavailable");
  const params = new URLSearchParams({ bv_id: String(bvid), cid: String(cid) });
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const response = await fetchWithTimeout(`${root}/api/v1/bilibili/web/fetch_video_playurl?${params}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  }, { fetchImpl, timeoutMs });
  const payload = await response.json().catch(() => null);
  if (!response.ok || Number(payload?.code) !== 200) throw new Error(payload?.message || "TikHub Bilibili audio source failed");
  const audioUrls = selectSpeechAudioUrls(payload?.data?.data?.dash?.audio || payload?.data?.dash?.audio);
  if (!audioUrls.length) throw new Error("TikHub Bilibili audio stream is missing");
  return {
    audioUrl: audioUrls[0],
    audioUrls,
    mediaDownload: null
  };
}

function selectSpeechAudioUrls(items) {
  const tracks = Array.isArray(items) ? items : [];
  const ranked = tracks
    .filter((item) => text(item?.base_url || item?.baseUrl || item?.url))
    .sort((left, right) => Number(left?.bandwidth || Number.MAX_SAFE_INTEGER) - Number(right?.bandwidth || Number.MAX_SAFE_INTEGER));
  // Very low CDN renditions are sometimes cut off during long sequential
  // downloads. Prefer ~72 kbps or above, then retry every other rendition.
  const preferred = ranked.find((item) => Number(item?.bandwidth || 0) >= 72_000) || ranked[0];
  return [preferred, ...ranked.filter((item) => item !== preferred)]
    .map((item) => text(item?.base_url || item?.baseUrl || item?.url))
    .filter(Boolean);
}

export function parseBilibiliVideoId(url) {
  const path = String(url?.pathname || "");
  const match = path.match(/\/(BV[0-9A-Za-z]+|av\d+)/i);
  if (!match) return null;
  const value = match[1];
  return /^av/i.test(value)
    ? { key: "aid", value: value.slice(2) }
    : { key: "bvid", value };
}

function normalizeBilibiliSubtitles(items) {
  return normalizeSubtitleTracks((Array.isArray(items) ? items : []).map((item) => ({
    language: text(item?.lan) || "source",
    url: normalizeUrl(item?.subtitle_url),
    format: "bilibili-json"
  })));
}

async function fetchJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0"
      },
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code) throw new Error(body?.message || `Bilibili HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createMediaExtractionError("provider_timeout", "B站字幕服务响应超时。", { retryable: true, provider: "bilibili" });
    }
    throw createMediaExtractionError("provider_unavailable", "B站字幕服务暂时不可用。", {
      retryable: true,
      provider: "bilibili",
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url, options, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(value) {
  const url = text(value);
  return url.startsWith("//") ? `https:${url}` : url;
}

function canonicalUrl(bvid) {
  return /^BV/i.test(String(bvid || ""))
    ? `https://www.bilibili.com/video/${bvid}`
    : "";
}

function text(value) {
  return String(value || "").trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
