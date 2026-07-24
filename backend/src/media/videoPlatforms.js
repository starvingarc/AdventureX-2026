import { createMediaExtractionError } from "./mediaErrors.js";

const DOUYIN_HOSTS = ["douyin.com", "v.douyin.com", "iesdouyin.com"];
const XIAOHONGSHU_HOSTS = ["xiaohongshu.com", "xhslink.com"];
const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
const BILIBILI_HOSTS = ["bilibili.com", "b23.tv"];
const DIRECT_VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".m3u8"];

export function normalizeVideoSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw createMediaExtractionError(
      "invalid_video_url",
      "这不是有效的视频链接。请粘贴 http 或 https 开头的公开视频链接。",
      { retryable: false }
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw createMediaExtractionError(
      "invalid_video_url",
      "视频链接必须是 http 或 https 开头。",
      { retryable: false }
    );
  }

  return url;
}

export function detectVideoPlatform(value) {
  let url;
  try {
    url = normalizeVideoSourceUrl(value);
  } catch {
    return "unknown";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (DOUYIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "douyin";
  }
  if (XIAOHONGSHU_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "xiaohongshu";
  }
  if (YOUTUBE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "youtube";
  }
  if (BILIBILI_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "bilibili";
  }
  if (DIRECT_VIDEO_EXTENSIONS.some((extension) => url.pathname.toLowerCase().endsWith(extension))) {
    return "direct_video_file";
  }
  return "generic_web";
}

export function isTikHubPreferredPlatform(platform) {
  return platform === "douyin" || platform === "xiaohongshu";
}

export function isYtDlpPreferredPlatform(platform) {
  return ["youtube", "bilibili", "direct_video_file", "generic_web"].includes(platform);
}
