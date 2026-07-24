import { callModelJson } from "../generation/openaiClient.js";

const IDENTITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["platform", "titleLineIndexes", "accountLineIndexes", "contentKind", "confidence"],
  properties: {
    platform: {
      type: "string",
      enum: ["bilibili", "douyin", "xiaohongshu", "wechat", "zhihu", "youtube", "unknown"]
    },
    titleLineIndexes: { type: "array", maxItems: 5, items: { type: "integer" } },
    accountLineIndexes: { type: "array", maxItems: 2, items: { type: "integer" } },
    contentKind: { type: "string", enum: ["video", "article", "answer", "image_note", "unknown"] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

const identityCache = new Map();

export async function refineScreenshotIdentity(input, heuristicIdentity = {}, {
  modelJsonCaller = callModelJson,
  enabled = process.env.SCREENSHOT_IDENTITY_MODEL_ENABLED !== "0",
  timeoutMs = Number(process.env.SCREENSHOT_IDENTITY_MODEL_TIMEOUT_MS) || 3_500
} = {}) {
  const lines = normalizeLines(input);
  if (!enabled || !hasModelApiKey() || lines.length < 3) return heuristicIdentity;
  if (!shouldUseSemanticSelection(lines, heuristicIdentity)) return heuristicIdentity;

  const cacheKey = lines.join("\n");
  if (identityCache.has(cacheKey)) return identityCache.get(cacheKey);
  const pending = selectIdentity(lines, heuristicIdentity, { modelJsonCaller, timeoutMs })
    .catch(() => heuristicIdentity);
  identityCache.set(cacheKey, pending);
  const result = await pending;
  identityCache.set(cacheKey, result);
  return result;
}

async function selectIdentity(lines, heuristicIdentity, { modelJsonCaller, timeoutMs }) {
  const numberedLines = lines.map((line, index) => `[${index}] ${line}`).join("\n");
  const request = modelJsonCaller({
    system: [
      "你从手机平台内容页的全屏 OCR 行中定位当前主内容的身份。",
      "只返回 OCR 行号，不得改写、补全或猜测任何文字。",
      "先根据全屏 UI 语义识别平台，再找主内容标题和发布者/UP主。",
      "忽略状态栏、视频画面字幕、广告卡、热搜标签、统计数字、合集名称、推荐内容和播放器章节名。",
      "B站主内容通常同时存在简介/评论、UP主关注区、粉丝与视频数、标题和互动统计，但元素位置会变化；不要把热搜、日期统计行或画面水印当成标题/UP主。",
      "抖音主内容通常有 @作者、相对日期、标题/文案、话题和右侧互动数；作者行末尾的日期不是作者名，搜索框文字和视频画面大字不是标题。",
      "若标题跨多行，按阅读顺序返回多个连续行号。若无法可靠识别，返回空数组并降低 confidence。"
    ].join("\n"),
    user: [
      `启发式结果（可能错误，仅供对照）：${JSON.stringify({
        platform: heuristicIdentity?.platform || "unknown",
        title: heuristicIdentity?.title || "",
        account: heuristicIdentity?.account || ""
      })}`,
      `OCR 全部行：\n${numberedLines}`
    ].join("\n\n"),
    schemaName: "shibei_screenshot_identity_v1",
    schema: IDENTITY_SCHEMA,
    stage: "screenshot_identity",
    estimatedOutputTokens: 180
  });
  const output = await withTimeout(request, timeoutMs);
  return validatedIdentityFromIndexes(output, lines, heuristicIdentity);
}

export function validatedIdentityFromIndexes(output, lines, fallback = {}) {
  const titleIndexes = normalizedIndexes(output?.titleLineIndexes, lines);
  const accountIndexes = normalizedIndexes(output?.accountLineIndexes, lines);
  const title = normalizeSelectedTitle(joinSelectedLines(titleIndexes, lines));
  const account = joinSelectedLines(accountIndexes, lines);
  const platform = normalizePlatform(output?.platform);
  const confidence = Number(output?.confidence);
  if (!title || !account || !platform || !Number.isFinite(confidence) || confidence < 0.62) return fallback;
  if (isInvalidTitle(title) || isInvalidAccount(account)) return fallback;
  if (platform === "bilibili" && !isGroundedBilibiliCreatorBlock({ lines, titleIndexes, accountIndexes })) return fallback;
  if (platform === "xiaohongshu" && !isGroundedXiaohongshuCreatorBlock({ lines, titleIndexes, accountIndexes })) return fallback;
  return {
    ...fallback,
    title,
    account: account.replace(/^@\s*/, "").replace(/[·•。\s]*\d{1,2}月\d{1,2}日.*$/, "").trim(),
    platform,
    contentKind: fallback?.contentKind === "video"
      ? "video"
      : normalizeContentKind(output?.contentKind) || fallback?.contentKind,
    locatorTerms: Array.isArray(fallback?.locatorTerms)
      ? fallback.locatorTerms
      : lines.filter((line) => line !== title && line !== account).slice(0, 16),
    confidence,
    identityProvider: "qwen-ocr-line-selector"
  };
}

function normalizeLines(input) {
  const values = Array.isArray(input) ? input : String(input || "").split(/\r?\n/);
  return values.map((line) => String(line || "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function joinSelectedLines(indexes, lines) {
  if (!Array.isArray(indexes) || indexes.length === 0) return "";
  return indexes.map((index) => lines[index]).join("").trim();
}

function normalizedIndexes(indexes, lines) {
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  const unique = [...new Set(indexes.map(Number))];
  if (unique.some((index) => !Number.isInteger(index) || index < 0 || index >= lines.length)) return [];
  if (unique.some((index, offset) => offset > 0 && index !== unique[offset - 1] + 1)) return [];
  return unique;
}

function isGroundedBilibiliCreatorBlock({ lines, titleIndexes, accountIndexes }) {
  const accountIndex = accountIndexes[0];
  const titleIndex = titleIndexes[0];
  if (!Number.isInteger(accountIndex) || !Number.isInteger(titleIndex)) return false;
  const immediateControls = lines.slice(accountIndex + 1, accountIndex + 3).join(" ");
  const followingCreatorContext = lines.slice(accountIndex + 1, accountIndex + 5).join(" ");
  const hasFollowContext = /关注|已关注|充电/.test(immediateControls);
  const hasCreatorStats = /粉丝|\d+视频/.test(followingCreatorContext);
  const titleFollowsCreator = titleIndex > accountIndex && titleIndex <= accountIndex + 18;
  return hasFollowContext && hasCreatorStats && titleFollowsCreator;
}

function isGroundedXiaohongshuCreatorBlock({ lines, titleIndexes, accountIndexes }) {
  const accountIndex = accountIndexes[0];
  const titleIndex = titleIndexes[0];
  if (!Number.isInteger(accountIndex) || !Number.isInteger(titleIndex)) return false;
  const creatorControls = lines.slice(accountIndex + 1, accountIndex + 3).join(" ");
  const footerAfterTitle = lines.slice(titleIndex + 1, titleIndex + 6).join(" ");
  return /关注|已关注/.test(creatorControls)
    && /说点什么|评论|收藏|抢首评/.test(footerAfterTitle)
    && titleIndex > accountIndex;
}

function normalizeSelectedTitle(value) {
  return String(value || "")
    .replace(/[.。…\s]*展开\s*[~～>〉]?$/, "")
    .replace(/[0-9O.,]{2,}°$/, "")
    .trim();
}

function shouldUseSemanticSelection(lines, identity) {
  const text = lines.join(" ");
  if (["bilibili", "douyin", "xiaohongshu"].includes(identity?.platform)) return true;
  return /bilibili|哔哩|B站|云视听小电视|简介.*评论|抖音|小红书|说点什么/i.test(text);
}

function hasModelApiKey() {
  return Boolean(
    process.env.QWEN_API
      || process.env.QWEN_API_KEY
      || process.env.DASHSCOPE_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.DEEPSEEK_API_KEY
  );
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return ["bilibili", "douyin", "xiaohongshu", "wechat", "zhihu", "youtube"].includes(platform) ? platform : "";
}

function normalizeContentKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return ["video", "article", "answer", "image_note"].includes(kind) ? kind : "";
}

function isInvalidTitle(value) {
  return value.length < 4
    || /20\d{2}年\d{1,2}月\d{1,2}日|\d+人正在/.test(value)
    || /^(?:热搜|简介|评论|合集|投票|关注)/.test(value);
}

function isInvalidAccount(value) {
  return value.length < 2
    || value.length > 30
    || /^(?:热搜|简介|评论|合集|关注|广告)$/.test(value)
    || /粉丝|视频|播放|20\d{2}年/.test(value);
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("identity_model_timeout")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}
