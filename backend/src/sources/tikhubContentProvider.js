import { normalizeSubtitleTracks } from "../media/platformSubtitles.js";

const DEFAULT_TIKHUB_BASE_URL = process.env.TIKHUB_BASE_URL || "https://api.tikhub.io";
const DEFAULT_TIKHUB_TIMEOUT_MS = readPositiveInt(process.env.TIKHUB_TIMEOUT_MS, 30_000);

const PLATFORM_HOSTS = Object.freeze({
  douyin: ["douyin.com"],
  xiaohongshu: ["xiaohongshu.com", "xhslink.com"],
  wechat: ["mp.weixin.qq.com"],
  zhihu: ["zhihu.com"]
});

export function detectTikHubContentPlatform(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return "unknown";
  }
  if (!["http:", "https:"].includes(url.protocol)) return "unknown";

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const [platform, domains] of Object.entries(PLATFORM_HOSTS)) {
    if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return platform;
    }
  }
  return "unknown";
}

export function isTikHubArticlePlatform(platform) {
  return ["xiaohongshu", "wechat", "zhihu"].includes(platform);
}

export async function fetchTikHubContentSource({
  sourceUrl,
  apiKey = process.env.TIKHUB_API_KEY || "",
  baseUrl = DEFAULT_TIKHUB_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIKHUB_TIMEOUT_MS,
  preferVideo = false
} = {}) {
  const url = normalizeSourceUrl(sourceUrl);
  const platform = detectTikHubContentPlatform(url.href);
  if (platform === "unknown") {
    throw providerError(
      "unsupported_content_platform",
      "TikHub 来源增强当前支持抖音、小红书、公众号和知乎公开链接。",
      { retryable: false }
    );
  }
  if (!apiKey) {
    throw providerError(
      "provider_config_missing",
      "内容取源服务暂未配置，请稍后再试。",
      { retryable: false }
    );
  }

  const request = createTikHubRequest({ platform, sourceUrl: url.href, baseUrl, preferVideo });
  let data = await requestTikHub({
    ...request,
    apiKey,
    fetchImpl,
    timeoutMs
  });
  let normalized = normalizeTikHubContent(platform, data, url.href);

  if (
    platform === "xiaohongshu"
    && !preferVideo
    && (
      (request.variant === "xiaohongshu_image" && !hasUsableContent(normalized))
      || (normalized.kind === "video" && !normalized.mediaUrl)
    )
  ) {
    const fallbackRequest = createTikHubRequest({
      platform,
      sourceUrl: url.href,
      baseUrl,
      preferVideo: true
    });
    data = await requestTikHub({
      ...fallbackRequest,
      apiKey,
      fetchImpl,
      timeoutMs
    });
    normalized = normalizeTikHubContent(platform, data, url.href);
  }

  return normalized;
}

function createTikHubRequest({ platform, sourceUrl, baseUrl, preferVideo }) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (platform === "douyin") {
    return getRequest(
      `${root}/api/v1/douyin/app/v3/fetch_one_video_by_share_url`,
      { share_url: sourceUrl },
      "douyin_video"
    );
  }
  if (platform === "xiaohongshu") {
    const note = readXiaohongshuWebParams(sourceUrl);
    if (!preferVideo && note.noteId && note.xsecToken) {
      return getRequest(
        `${root}/api/v1/xiaohongshu/web_v3/fetch_note_detail`,
        { note_id: note.noteId, xsec_token: note.xsecToken },
        "xiaohongshu_web"
      );
    }
    return getRequest(
      `${root}/api/v1/xiaohongshu/app_v2/${preferVideo ? "get_video_note_detail" : "get_image_note_detail"}`,
      { share_text: sourceUrl },
      preferVideo ? "xiaohongshu_video" : "xiaohongshu_image"
    );
  }
  if (platform === "wechat") {
    return {
      method: "POST",
      url: `${root}/api/v1/wechat_mp/v2/fetch_article_detail`,
      body: { url: sourceUrl, raw: false },
      variant: "wechat_article"
    };
  }
  if (platform === "zhihu") {
    const target = readZhihuTarget(sourceUrl);
    const endpoint = target.kind === "answer"
      ? "fetch_answer_detail"
      : target.kind === "pin"
        ? "fetch_pin_detail"
        : "fetch_column_article_detail";
    return getRequest(
      `${root}/api/v1/zhihu/web/${endpoint}`,
      { [`${target.kind}_id`]: target.id },
      `zhihu_${target.kind}`
    );
  }
  throw providerError("unsupported_content_platform", "暂不支持这个内容平台。", { retryable: false });
}

function getRequest(url, params, variant) {
  const endpoint = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    endpoint.searchParams.set(key, String(value));
  }
  return { method: "GET", url: endpoint.href, body: null, variant };
}

async function requestTikHub({
  method,
  url,
  body,
  apiKey,
  fetchImpl,
  timeoutMs
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw providerError(
        "provider_invalid_response",
        "内容取源服务返回了无法识别的数据。",
        { retryable: true, status: response.status }
      );
    }
    if (!response.ok) {
      const type = response.status === 429 ? "provider_rate_limited" : "provider_unavailable";
      throw providerError(type, providerMessage(payload, "内容取源服务暂时不可用，请稍后重试。"), {
        retryable: response.status === 429 || response.status >= 500,
        status: response.status
      });
    }
    if (![undefined, null, 0, 200].includes(payload.code)) {
      throw providerError(
        "provider_api_error",
        providerMessage(payload, "内容平台未返回可处理的公开内容。"),
        { retryable: false }
      );
    }
    return payload.data ?? payload;
  } catch (error) {
    if (error?.code === "failed_extract_source") throw error;
    if (error?.name === "AbortError") {
      throw providerError("provider_timeout", "内容取源服务响应超时，请稍后重试。", {
        retryable: true
      });
    }
    throw providerError("provider_unavailable", "内容取源服务暂时不可用，请稍后重试。", {
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeTikHubContent(platform, payload, sourceUrl) {
  if (platform === "douyin") return normalizeDouyin(payload, sourceUrl);
  if (platform === "xiaohongshu") return normalizeXiaohongshu(payload, sourceUrl);
  if (platform === "wechat") return normalizeWechat(payload, sourceUrl);
  if (platform === "zhihu") return normalizeZhihu(payload, sourceUrl);
  throw providerError("unsupported_content_platform", "暂不支持这个内容平台。", { retryable: false });
}

function normalizeDouyin(payload, sourceUrl) {
  const root = firstObject(
    payload?.aweme_detail,
    payload?.data?.aweme_detail,
    payload?.item,
    payload
  );
  const bitRateStreams = Array.isArray(root?.video?.bit_rate) ? root.video.bit_rate : [];
  const audioCarrierStreams = bitRateStreams
    .filter((stream) => Array.isArray(stream?.play_addr?.url_list) && stream.play_addr.url_list.length > 0)
    .sort((left, right) => streamSize(left) - streamSize(right));
  const mediaUrls = uniqueUrls(
    audioCarrierStreams.flatMap((stream) => rankDouyinMediaUrls(stream.play_addr.url_list)),
    rankDouyinMediaUrls(root?.video?.play_addr?.url_list || []),
    rankDouyinMediaUrls(root?.video?.download_addr?.url_list || [])
  );
  const contentId = stringValue(root?.aweme_id || root?.id);
  const description = cleanText(root?.desc || root?.caption);
  return {
    provider: "tikhub",
    platform: "douyin",
    providerContentId: contentId,
    kind: "video",
    title: description || "抖音视频",
    description,
    text: description,
    account: cleanText(root?.author?.nickname || root?.author?.unique_id),
    author: cleanText(root?.author?.nickname || root?.author?.unique_id),
    sourceUrl: contentId ? `https://www.douyin.com/video/${contentId}` : sourceUrl,
    publishedAt: stringValue(root?.create_time),
    images: uniqueUrls(root?.images, root?.image_post_info?.images),
    mediaUrl: mediaUrls[0] || "",
    mediaUrls,
    coverUrl: firstUrl(root?.video?.cover?.url_list, root?.video?.origin_cover?.url_list),
    durationSeconds: millisecondsToSeconds(root?.video?.duration || root?.duration),
    subtitles: [],
    metadata: { stats: root?.statistics || {} }
  };
}

function streamSize(stream) {
  const bytes = Number(stream?.play_addr?.data_size);
  if (Number.isFinite(bytes) && bytes > 0) return bytes;
  const bitRate = Number(stream?.bit_rate);
  return Number.isFinite(bitRate) && bitRate > 0 ? bitRate : Number.MAX_SAFE_INTEGER;
}

function rankDouyinMediaUrls(urls) {
  // TikHub usually returns equivalent ByteDance CDN URLs. In mainland China,
  // the API play endpoints respond much faster and more consistently than the
  // experimental zjcdn hosts, which can otherwise consume the full media
  // timeout before ASR starts.
  const hostPriority = (value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host.includes("amemv.com")) return 0;
      if (host.includes("douyinvod.com")) return 1;
      if (host.includes("zjcdn.com")) return 3;
      return 2;
    } catch {
      return 4;
    }
  };
  return [...urls].sort((left, right) => hostPriority(left) - hostPriority(right));
}

function normalizeXiaohongshu(payload, sourceUrl) {
  const root = findXiaohongshuRoot(payload);
  const videoInfo = root?.video_info_v2 || root?.video || {};
  const h264 = videoInfo?.media?.stream?.h264 || videoInfo?.media?.stream?.avc || [];
  const h265 = videoInfo?.media?.stream?.h265 || videoInfo?.media?.stream?.hevc || [];
  const mediaUrls = uniqueUrls(
    h264.map((item) => item?.master_url || item?.backup_urls?.[0]),
    h265.map((item) => item?.master_url || item?.backup_urls?.[0]),
    videoInfo?.media?.stream?.h264?.map((item) => item?.master_url),
    root?.video?.url,
    root?.video_url
  );
  const images = extractXiaohongshuImages(root);
  const contentId = stringValue(root?.note_id || root?.id);
  const title = cleanText(root?.title || root?.display_title);
  const text = cleanText(root?.desc || root?.description || root?.content);
  const noteType = cleanText(root?.note_type || root?.type).toLowerCase();
  const isVideo = mediaUrls.length > 0 || noteType.includes("video");
  const account = cleanText(
    root?.user?.nickname
      || root?.user_info?.nickname
      || root?.author?.nickname
      || root?.nickname
  );
  const subtitles = normalizeSubtitleTracks(
    videoInfo?.media?.video?.subtitles
      || root?.video?.subtitles
      || root?.subtitles
  );
  return {
    provider: "tikhub",
    platform: "xiaohongshu",
    providerContentId: contentId,
    kind: isVideo ? "video" : (images.length ? "image_text" : "unknown"),
    title: title || text.slice(0, 80) || "小红书内容",
    description: text,
    text,
    account,
    author: account,
    sourceUrl: contentId ? `https://www.xiaohongshu.com/explore/${contentId}` : sourceUrl,
    publishedAt: stringValue(root?.time || root?.create_time || root?.publish_time),
    images,
    mediaUrl: mediaUrls[0] || "",
    mediaUrls,
    coverUrl: firstUrl(
      videoInfo?.image?.first_frame,
      videoInfo?.image?.thumbnail,
      images
    ),
    durationSeconds: firstDurationSeconds(
      { value: h264.map((item) => item?.duration), unit: "milliseconds" },
      { value: h265.map((item) => item?.duration), unit: "milliseconds" },
      { value: videoInfo?.media?.video?.duration, unit: "seconds" },
      { value: root?.duration, unit: "auto" }
    ),
    subtitles,
    metadata: { stats: root?.interact_info || root?.statistics || {} }
  };
}

function normalizeWechat(payload, sourceUrl) {
  const root = firstObject(payload?.data, payload);
  const article = firstObject(
    root?.content?.article,
    root?.content,
    root?.article,
    root
  );
  const images = uniqueUrls(
    Array.isArray(article?.images) ? article.images.map((image) => image?.src || image?.url) : [],
    article?.image_urls,
    Array.isArray(article?.picture_page_info_list)
      ? article.picture_page_info_list.map((image) => image?.cdn_url || image?.url)
      : []
  );
  const text = cleanText(
    article?.full_text
      || article?.text
      || article?.content_text
      || root?.full_text
      || root?.content_text
      || root?.digest
  );
  const account = cleanText(
    article?.author
      || article?.nick_name
      || article?.nickname
      || root?.author
      || root?.account_name
      || root?.nickname
  );
  return {
    provider: "tikhub",
    platform: "wechat",
    providerContentId: stringValue(
      root?.article_id
        || root?.id
        || article?.mid
        || article?.comment_id
    ),
    kind: "article",
    title: cleanText(article?.title || root?.title) || "公众号文章",
    description: cleanText(article?.desc || article?.digest || root?.digest || root?.description),
    text,
    account,
    author: account,
    sourceUrl,
    publishedAt: stringValue(
      article?.create_time
        || article?.create_timestamp
        || root?.datetime
        || root?.publish_time
    ),
    images,
    mediaUrl: "",
    mediaUrls: [],
    coverUrl: firstUrl(article?.cdn_url, root?.cover, root?.cover_url, images),
    durationSeconds: null,
    subtitles: [],
    metadata: { stats: root?.statistics || {} }
  };
}

function normalizeZhihu(payload, sourceUrl) {
  const root = firstObject(payload?.data, payload?.pin, payload?.answer, payload?.article, payload);
  const isAnswer = /\/answer\/\d+/.test(sourceUrl) || Boolean(root?.answer_id);
  const isPin = /\/pin\/\d+/.test(sourceUrl) || root?.type === "pin" || Boolean(root?.pin_id);
  const contentId = stringValue(
    root?.pin_id
      || root?.answer_id
      || root?.article_id
      || root?.id
  );
  const account = cleanText(
    root?.author?.name
      || root?.author?.nickname
      || root?.author_name
      || root?.nickname
  );
  const pinParts = Array.isArray(root?.content)
    ? root.content.map((item) => item?.own_text || item?.content || item?.text || "").filter(Boolean).join("\n\n")
    : "";
  const rawContent = root?.content_html || pinParts || root?.content || root?.text || root?.excerpt || root?.description;
  const text = cleanText(stripHtml(rawContent));
  const questionTitle = cleanText(root?.question?.title);
  const pinTitle = isPin ? firstContentLine(root?.excerpt_title || rawContent) : "";
  return {
    provider: "tikhub",
    platform: "zhihu",
    providerContentId: contentId,
    kind: isPin ? "pin" : isAnswer ? "answer" : "article",
    title: cleanText(root?.title) || pinTitle || questionTitle || text.slice(0, 80) || "知乎内容",
    description: cleanText(root?.excerpt || root?.description),
    text,
    account,
    author: account,
    sourceUrl,
    publishedAt: stringValue(root?.created_time || root?.created || root?.updated_time),
    images: isPin && Array.isArray(root?.content)
      ? uniqueUrls(root.content.map((item) => item?.url || item?.image_url || item?.original_url))
      : [],
    mediaUrl: "",
    mediaUrls: [],
    coverUrl: "",
    durationSeconds: null,
    subtitles: [],
    metadata: {
      stats: {
        ...(root?.voteup_count ? { voteup_count: root.voteup_count } : {}),
        ...(root?.like_count ? { like_count: root.like_count } : {})
      }
    }
  };
}

function normalizeSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw providerError("invalid_content_url", "这不是有效的内容链接。", { retryable: false });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw providerError("invalid_content_url", "内容链接必须以 http 或 https 开头。", {
      retryable: false
    });
  }
  return url;
}

function readXiaohongshuWebParams(sourceUrl) {
  const url = new URL(sourceUrl);
  const noteId = url.pathname.match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/)?.[1] || "";
  return {
    noteId,
    xsecToken: url.searchParams.get("xsec_token") || ""
  };
}

function readZhihuTarget(sourceUrl) {
  const pinId = sourceUrl.match(/\/pin\/(\d+)/)?.[1];
  if (pinId) return { kind: "pin", id: pinId };
  const answerId = sourceUrl.match(/\/answer\/(\d+)/)?.[1];
  if (answerId) return { kind: "answer", id: answerId };
  const articleId = sourceUrl.match(/(?:zhuanlan\.zhihu\.com\/p\/|\/p\/)(\d+)/)?.[1];
  if (articleId) return { kind: "article", id: articleId };
  throw providerError(
    "invalid_content_url",
    "知乎链接需要是想法、回答或专栏文章。",
    { retryable: false }
  );
}

function firstContentLine(value) {
  const line = String(value || "")
    .split(/<br\s*\/?\s*>|\r?\n|\s+\|\s+/i)
    .map((item) => cleanText(stripHtml(item)))
    .find(Boolean);
  return String(line || "").slice(0, 160);
}

function findXiaohongshuRoot(payload) {
  const candidates = [
    payload?.note_card,
    payload?.data?.note_card,
    payload?.data?.[0],
    payload?.data?.items?.[0]?.note_card,
    payload?.data?.items?.[0],
    payload?.note_list?.[0],
    payload?.items?.[0],
    payload?.note,
    payload
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    if (candidate.note_card && typeof candidate.note_card === "object") return candidate.note_card;
    if (hasAnyOwn(candidate, ["note_id", "id", "title", "desc", "video_info_v2", "image_list"])) {
      return candidate;
    }
  }
  return {};
}

function extractXiaohongshuImages(root) {
  const lists = [
    root?.image_list,
    root?.images_list,
    root?.images,
    root?.image_urls
  ];
  const urls = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const image of list) {
      if (typeof image === "string") {
        urls.push(image);
        continue;
      }
      if (!image || typeof image !== "object") continue;
      urls.push(
        image.url_default,
        image.url_pre,
        image.url,
        image.src,
        ...(Array.isArray(image.info_list) ? image.info_list.map((item) => item?.url) : [])
      );
    }
  }
  return uniqueUrls(urls);
}

function hasUsableContent(content) {
  return Boolean(
    cleanText(content?.text).length >= 2
      || content?.images?.length
      || content?.mediaUrl
  );
}

function hasAnyOwn(value, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function uniqueUrls(...values) {
  const result = [];
  for (const value of values.flat(Infinity)) {
    const url = typeof value === "string"
      ? value
      : (value && typeof value === "object" ? value.url || value.src : "");
    if (typeof url === "string" && /^https?:\/\//.test(url) && !result.includes(url)) {
      result.push(url);
    }
  }
  return result;
}

function firstUrl(...values) {
  return uniqueUrls(...values)[0] || "";
}

function firstDurationSeconds(...candidates) {
  for (const candidate of candidates) {
    for (const value of [candidate?.value].flat(Infinity)) {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) continue;
      if (candidate.unit === "milliseconds") return Math.round(number / 1000);
      if (candidate.unit === "seconds") return Math.round(number);
      return millisecondsToSeconds(number);
    }
  }
  return null;
}

function millisecondsToSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number > 1000 ? Math.round(number / 1000) : Math.round(number);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function providerMessage(payload, fallback) {
  return cleanText(payload?.message_zh || payload?.message || payload?.detail || fallback);
}

function providerError(type, message, {
  retryable = false,
  cause = null,
  status = null
} = {}) {
  const error = new Error(message || "社交平台内容取源失败");
  error.code = "failed_extract_source";
  error.sourceErrorType = type || "unknown_source_error";
  error.retryable = Boolean(retryable);
  error.provider = "tikhub";
  if (status !== null && status !== undefined) error.status = status;
  if (cause) error.cause = cause;
  return error;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
