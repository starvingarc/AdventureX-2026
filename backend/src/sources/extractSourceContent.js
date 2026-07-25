import { extractVideoLearningSource as defaultExtractVideoLearningSource } from "../media/extractVideoLearningSource.js";
import { buildV2SourceFromLearningSource } from "../media/learningSource.js";
import {
  detectTikHubContentPlatform,
  fetchTikHubContentSource as defaultFetchTikHubContentSource,
  isTikHubArticlePlatform
} from "./tikhubContentProvider.js";

const MIN_ARTICLE_TEXT_LENGTH = 200;
const MIN_SOCIAL_TEXT_LENGTH = 24;
const ARTICLE_FETCH_TIMEOUT_MS = readPositiveInt(process.env.ARTICLE_FETCH_TIMEOUT_MS, 30_000);
const WECHAT_EXTRACT_TIMEOUT_MS = readPositiveInt(process.env.WECHAT_EXTRACT_TIMEOUT_MS, 60_000);

export async function extractSourceContent(input, {
  extractVideoLearningSource = defaultExtractVideoLearningSource,
  fetchTikHubContentSource = defaultFetchTikHubContentSource,
  env = process.env
} = {}) {
  const sourceType = input?.sourceType;
  if (sourceType === "text") {
    return {
      sourceType: "text",
      sourceTitle: input.sourceTitle || "",
      sourceUrl: input.sourceUrl || "",
      sourceAccount: input.sourceAccount || "",
      rawText: String(input.rawText || "").trim()
    };
  }

  if (sourceType === "video_link") {
    const learningSource = await extractVideoLearningSource({
      sourceUrl: input.sourceUrl,
      rawText: input.rawText,
      sourceTitle: input.sourceTitle,
      preferredTimestampSeconds: input.timestampSeconds,
      publicMediaBaseUrl: input.publicMediaBaseUrl
    });
    const v2Source = buildV2SourceFromLearningSource(learningSource);
    return {
      sourceType: "video_link",
      sourceTitle: v2Source.title,
      sourceUrl: v2Source.url,
      sourceAccount: v2Source.account,
      rawText: v2Source.cleanedText,
      platform: v2Source.platform,
      blocks: v2Source.blocks,
      learningSource,
      source: v2Source
    };
  }

  if (sourceType !== "article_link") {
    throw sourceFailure("failed_extract_article", "暂不支持这种内容来源。请粘贴文字或文章链接。");
  }

  const sourceUrl = normalizeUrl(input.sourceUrl || input.rawText);
  const platform = detectTikHubContentPlatform(sourceUrl);
  let tikhubError = null;
  if (shouldUseTikHubArticleSource(platform, {
    env,
    force: input?.forceTikHubContent === true
  })) {
    try {
      const content = await fetchTikHubContentSource({ sourceUrl });
      const screenshotText = input?.forceTikHubContent
        ? cleanExtractedText(input?.screenshotText)
        : "";
      const enrichedContent = screenshotText
        ? {
            ...content,
            text: [content?.text, screenshotText]
              .map((value) => cleanExtractedText(value))
              .filter((value, index, values) => value && values.indexOf(value) === index)
              .join("\n\n")
          }
        : content;
      return buildTikHubArticleSource(enrichedContent, sourceUrl);
    } catch (error) {
      tikhubError = error;
    }
  }
  if (isWechatArticleUrl(sourceUrl)) {
    return extractWechatArticle(sourceUrl);
  }
  try {
    return await extractWebArticle(sourceUrl);
  } catch (error) {
    if (tikhubError && platform === "xiaohongshu") {
      throw tikhubArticleFailure(tikhubError);
    }
    throw error;
  }
}

export function isLikelyUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isVideoUrl(value) {
  if (!isLikelyUrl(value)) return false;
  const hostname = new URL(String(value).trim()).hostname.toLowerCase();
  return [
    "bilibili.com",
    "www.bilibili.com",
    "m.bilibili.com",
    "b23.tv",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "v.douyin.com",
    "iesdouyin.com",
    "douyin.com",
    "www.douyin.com",
    "xiaohongshu.com",
    "www.xiaohongshu.com",
    "xhslink.com"
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    || [".mp4", ".mov", ".m4v", ".webm", ".m3u8"].some((extension) => new URL(String(value).trim()).pathname.toLowerCase().endsWith(extension));
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!isLikelyUrl(text)) {
    throw sourceFailure("failed_extract_article", "这不是有效的文章链接。请粘贴 http 或 https 开头的链接。");
  }
  return text;
}

function isWechatArticleUrl(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "mp.weixin.qq.com";
}

function shouldUseTikHubArticleSource(platform, { env = process.env, force = false } = {}) {
  return isTikHubArticlePlatform(platform)
    && (force || readBooleanFlag(env.TIKHUB_CONTENT_ENABLED, false))
    && Boolean(String(env.TIKHUB_API_KEY || "").trim());
}

export function buildTikHubArticleSource(content, sourceUrl = "") {
  if (!content || typeof content !== "object") {
    throw sourceFailure("failed_extract_article", "内容平台未返回可处理的正文。");
  }
  if (content.kind === "video") {
    throw sourceFailure("failed_extract_article", "这是一条视频内容，请使用视频链接入口。");
  }

  const rawText = cleanExtractedText(
    [content.text, content.description]
      .map((value) => String(value || "").trim())
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join("\n\n")
  );
  ensureSocialText(rawText, { hasImages: Array.isArray(content.images) && content.images.length > 0 });
  const platform = String(content.platform || detectTikHubContentPlatform(sourceUrl) || "");
  const blocks = buildSocialSourceBlocks(rawText, platform);
  const title = cleanExtractedText(content.title) || platformLabel(platform);
  const account = cleanExtractedText(content.account || content.author);
  const canonicalUrl = String(content.sourceUrl || sourceUrl || "");
  const source = {
    type: "article_link",
    platform,
    title,
    url: canonicalUrl,
    author: account,
    account,
    accountOrDomain: account || platform,
    rawInput: sourceUrl || canonicalUrl,
    rawText,
    extractedText: rawText,
    cleanedText: rawText,
    media: {
      provider: "tikhub",
      providerContentId: String(content.providerContentId || ""),
      coverUrl: String(content.coverUrl || content.images?.[0] || ""),
      playUrlExpiresAt: ""
    },
    blocks
  };
  return {
    sourceType: "article_link",
    sourceTitle: title,
    sourceUrl: canonicalUrl,
    sourceAccount: account,
    rawText,
    platform,
    blocks,
    source
  };
}

function buildSocialSourceBlocks(rawText, platform) {
  const chunks = splitTextForEvidence(rawText, 1200);
  return chunks.map((text, index) => ({
    id: `${platform || "social"}-platform-text-${String(index + 1).padStart(3, "0")}`,
    type: "paragraph",
    sourceRole: "platform_description",
    text
  }));
}

function splitTextForEvidence(rawText, maxLength) {
  const paragraphs = String(rawText || "")
    .split(/\n{2,}/)
    .map((part) => cleanExtractedText(part))
    .filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > maxLength) {
        chunks.push(current);
        current = "";
      }
      if (sentence.length > maxLength) {
        if (current) chunks.push(current);
        for (let offset = 0; offset < sentence.length; offset += maxLength) {
          chunks.push(sentence.slice(offset, offset + maxLength));
        }
        current = "";
      } else {
        current += sentence;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

function ensureSocialText(rawText, { hasImages = false } = {}) {
  if (String(rawText || "").replace(/\s/g, "").length >= MIN_SOCIAL_TEXT_LENGTH) return;
  const suffix = hasImages ? "当前图文正文太短，请改用截图导入，让视觉模型读取图片。" : "可用正文太短，暂时无法生成复习题。";
  throw sourceFailure("failed_extract_article", `社交平台内容提取失败：${suffix}`);
}

function tikhubArticleFailure(error) {
  const type = String(error?.sourceErrorType || error?.mediaErrorType || "");
  if (type === "provider_config_missing") {
    return sourceFailure("failed_extract_article", "小红书内容取源暂未配置，请改用截图导入。");
  }
  if (["provider_timeout", "provider_rate_limited", "provider_unavailable"].includes(type)) {
    return sourceFailure("failed_extract_article", "小红书内容暂时无法读取，请稍后重试或改用截图导入。");
  }
  return sourceFailure("failed_extract_article", error?.message || "小红书内容读取失败，请改用截图导入。");
}

function platformLabel(platform) {
  return {
    xiaohongshu: "小红书内容",
    wechat: "公众号文章",
    zhihu: "知乎内容"
  }[platform] || "社交平台内容";
}

async function extractWebArticle(sourceUrl) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARTICLE_FETCH_TIMEOUT_MS);
  try {
    response = await fetch(sourceUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"
      },
      redirect: "follow",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw sourceFailure("failed_extract_article", "文章链接访问超时，请稍后重试或直接粘贴正文。");
    }
    throw sourceFailure("failed_extract_article", `文章链接无法访问：${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw sourceFailure("failed_extract_article", `文章链接无法访问：HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw sourceFailure("failed_extract_article", "这个链接不像可提取正文的网页文章。");
  }

  const html = await response.text();
  const extracted = extractArticleFromHtml(html, sourceUrl);
  ensureArticleText(extracted.rawText);
  return extracted;
}

async function extractWechatArticle(sourceUrl) {
  const staticArticle = await extractWechatArticleFromStaticHtml(sourceUrl).catch(() => null);
  if (staticArticle) return staticArticle;

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw sourceFailure("failed_extract_article", "当前环境没有可用的 Playwright，暂时无法抓取公众号正文。");
  }

  let browser;
  try {
    return await withTimeout((async () => {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
      });
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 1600 }
      });

      await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: Math.min(45_000, WECHAT_EXTRACT_TIMEOUT_MS) });
      await page.waitForTimeout(1500);

      const data = await page.evaluate(() => {
        const title =
          document.querySelector("#activity-name")?.textContent?.trim() ||
          document.querySelector("h1")?.textContent?.trim() ||
          document.title?.trim() ||
          "";
        const account =
          document.querySelector("#js_name")?.textContent?.trim() ||
          document.querySelector(".rich_media_meta_text")?.textContent?.trim() ||
          "";
        const contentNode =
          document.querySelector("#js_content") ||
          document.querySelector(".rich_media_content") ||
          document.body;
        return {
          title,
          account,
          rawText: contentNode?.innerText || ""
        };
      });

      const rawText = cleanExtractedText(data.rawText);
      ensureArticleText(rawText);
      return {
        sourceType: "article_link",
        sourceTitle: cleanExtractedText(data.title) || "公众号文章",
        sourceUrl,
        sourceAccount: cleanExtractedText(data.account) || "mp.weixin.qq.com",
        rawText
      };
    })(), WECHAT_EXTRACT_TIMEOUT_MS, "公众号文章正文提取超时，请稍后重试或直接粘贴正文。");
  } catch (error) {
    if (error?.code) throw error;
    throw sourceFailure("failed_extract_article", `公众号文章正文提取失败：${error.message}`);
  } finally {
    if (browser) await withTimeout(browser.close(), 5_000, "关闭浏览器超时。").catch(() => {});
  }
}

async function extractWechatArticleFromStaticHtml(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(ARTICLE_FETCH_TIMEOUT_MS, WECHAT_EXTRACT_TIMEOUT_MS));
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw sourceFailure("failed_extract_article", `公众号文章链接无法访问：HTTP ${response.status}`);
    }
    const html = await response.text();
    const extracted = extractArticleFromHtml(html, sourceUrl);
    ensureArticleText(extracted.rawText);
    return {
      ...extracted,
      sourceAccount: extracted.sourceAccount === "mp.weixin.qq.com"
        ? inferWechatAccount(extracted.rawText) || extracted.sourceAccount
        : extracted.sourceAccount
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw sourceFailure("failed_extract_article", "公众号文章链接访问超时，请稍后重试或直接粘贴正文。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractArticleFromHtml(html, sourceUrl) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const title = decodeHtml(
    firstMatch(withoutNoise, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      firstMatch(withoutNoise, /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      firstMatch(withoutNoise, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      ""
  );
  const account = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const articleHtml =
    firstMatch(withoutNoise, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
    firstMatch(withoutNoise, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
    firstMatch(withoutNoise, /<body[^>]*>([\s\S]*?)<\/body>/i) ||
    withoutNoise;
  const text = htmlToText(articleHtml);

  return {
    sourceType: "article_link",
    sourceTitle: cleanExtractedText(title) || account,
    sourceUrl,
    sourceAccount: account,
    rawText: text
  };
}

function htmlToText(html) {
  return cleanExtractedText(
    decodeHtml(
      String(html || "")
        .replace(/<(h[1-6]|p|div|section|article|li|br|blockquote)[^>]*>/gi, "\n")
        .replace(/<\/(h[1-6]|p|div|section|article|li|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function cleanExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function firstMatch(text, pattern) {
  return text.match(pattern)?.[1] || "";
}

function ensureArticleText(rawText) {
  if (String(rawText || "").trim().length < MIN_ARTICLE_TEXT_LENGTH) {
    throw sourceFailure("failed_extract_article", "文章正文提取失败：可用正文太短，暂时无法生成复习题。");
  }
}

function inferWechatAccount(rawText) {
  const lines = String(rawText || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const metaTownIndex = lines.findIndex((line) => /MetaTown|公众号|原创/.test(line));
  if (metaTownIndex >= 0) {
    const candidate = lines.slice(metaTownIndex, metaTownIndex + 4).find((line) => !/原创|公众号|在小说阅读器/.test(line));
    if (candidate) return candidate;
  }
  return "";
}

function sourceFailure(status, message) {
  const error = new Error(message);
  error.code = status;
  error.status = status;
  return error;
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(sourceFailure("failed_extract_article", message)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function readBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}
