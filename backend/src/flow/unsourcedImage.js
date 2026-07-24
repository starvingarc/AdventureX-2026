import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { parseModelJson } from "../generation/openaiClient.js";
import { generateQuickReviewPath } from "../v2/generation/quickReviewGenerator.js";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3-vl-plus";
const DEFAULT_TIMEOUT_MS = 45_000;

export const UNSOURCED_IMAGE_PROVENANCE = Object.freeze({
  status: "not_found",
  provider: "tikhub",
  sourceStatus: "unsourced_image",
  label: "未找到 TikHub 原始来源"
});

/**
 * TikHub 无可信候选时，让 Qwen Plus 直接依据截图生成概览和三道卡片题。
 * 这不是来源恢复：提示词禁止模型生成 URL、作品 ID 或声称找到了原文。
 */
export async function analyzeUnsourcedScreenshot({
  imagePath,
  ocrText = "",
  identity = {},
  env = process.env,
  fetchImpl = fetch,
  readFileImpl = readFile
} = {}) {
  if (!imagePath) throw codedError("image_fallback_missing_image", "Qwen 截图降级需要本地图片。");
  const apiKey = env.QWEN_API || env.QWEN_API_KEY || env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw codedError(
      "image_fallback_missing_api_key",
      "缺少 Qwen API Key，无法执行未溯源截图降级。"
    );
  }

  const model = String(env.SCREENSHOT_FALLBACK_MODEL || env.QWEN_VL_MODEL || DEFAULT_MODEL).trim();
  const baseUrl = normalizeBaseUrl(
    env.QWEN_API_BASE_URL
      || env.DASHSCOPE_API_BASE_URL
      || env.BASE_URL
      || env.AI_BASE_URL
      || DEFAULT_BASE_URL
  );
  const timeoutMs = positiveInt(env.SCREENSHOT_FALLBACK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const prompt = buildUnsourcedImagePrompt({ ocrText, identity });
  const imageUrl = await toDataUrl(imagePath, readFileImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "你是截图学习卡生成器。只依据截图可见信息，输出严格 JSON，绝不虚构原始链接或来源。"
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text", text: prompt }
            ]
          }
        ],
        response_format: { type: "json_object" },
        enable_thinking: false,
        stream: false,
        temperature: 0.1,
        max_tokens: 1800
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw codedError(
        response.status === 429 ? "image_fallback_rate_limited" : "image_fallback_unavailable",
        payload?.error?.message || `Qwen Plus 截图请求失败：${response.status}`
      );
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (!text) throw codedError("image_fallback_empty_response", "Qwen Plus 没有返回截图分析结果。");
    return normalizeAnalysis(parseModelJson(text), {
      model,
      usage: payload?.usage,
      identity
    });
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === "AbortError") {
      throw codedError("image_fallback_timeout", "Qwen Plus 截图分析超时，请稍后重试。");
    }
    throw codedError("image_fallback_unavailable", error?.message || "Qwen Plus 截图分析失败。");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 复用正式 ReviewPath 契约，但不再次请求模型：三道题来自上面的 Qwen Plus 视觉响应。
 */
export async function generateUnsourcedScreenshotReview({ analysis, reviewInput }) {
  return generateQuickReviewPath(reviewInput, {
    cacheEnabled: false,
    modelJsonCaller: async () => ({
      title: analysis.title,
      summary: analysis.summary,
      tags: analysis.tags,
      questions: analysis.questions
    })
  });
}

export function buildUnsourcedOverview(analysis) {
  return {
    summary: analysis.summary,
    highlights: analysis.keyPoints.slice(0, 5),
    provenance: { ...UNSOURCED_IMAGE_PROVENANCE }
  };
}

export function buildUnsourcedImagePrompt({ ocrText = "", identity = {} } = {}) {
  return [
    "TikHub 没有找到这张截图的可信原始来源。请直接理解截图，并为碎片化复习生成结果。",
    "重要：这一步不是搜索。不得输出或猜测 URL、作品 ID、发布时间，不得声称找到了原文。",
    "只使用画面可见文字、人物、物体、图表和明确关系；看不清或无法确认的事实不要写。",
    "忽略状态栏、按钮数量、广告、推荐列表等无关 UI；若截图主要是娱乐/生活画面，可围绕画面事实与辨识点出题。",
    "summary 用 2-4 句中文概括截图核心；keyPoints 给 2-5 条短要点；tags 给 1-5 个短标签。",
    "恰好生成 3 道题：1 道 true_false 判断题、2 道 multiple_choice 四选一。",
    "判断题 options 必须是 [\"正确\",\"错误\"]；选择题必须恰好 4 个选项；答案必须能由截图判断。",
    "每题 explanation 不超过 60 个汉字。",
    "输出 JSON：",
    JSON.stringify({
      title: "截图主题",
      account: "仅当画面明确可见时填写，否则为空字符串",
      platform: "仅当界面明确可辨时填写，否则为 image",
      summary: "截图核心概括",
      tags: ["标签"],
      keyPoints: ["要点"],
      questions: [{
        knowledgePoint: "具体知识点",
        type: "true_false",
        prompt: "题干",
        options: ["正确", "错误"],
        correctIndex: 0,
        explanation: "依据"
      }]
    }),
    "OCR 仅作辅助，可能有误：",
    String(ocrText || "（无 OCR 文本）").slice(0, 6_000),
    "OCR 初步身份（不可靠，只能在画面支持时采用）：",
    JSON.stringify({
      title: identity?.title || "",
      account: identity?.account || "",
      platform: identity?.platform || ""
    })
  ].join("\n");
}

function normalizeAnalysis(output, { model, usage, identity }) {
  const questions = Array.isArray(output?.questions) ? output.questions.slice(0, 3) : [];
  if (questions.length !== 3) {
    throw codedError("image_fallback_invalid_cards", "Qwen Plus 没有生成恰好 3 张有效卡片。");
  }
  const summary = clean(output?.summary);
  if (!summary) throw codedError("image_fallback_invalid_summary", "Qwen Plus 没有生成可用的截图概览。");
  const keyPoints = unique(output?.keyPoints, 5);
  return {
    title: clean(output?.title) || clean(identity?.title) || "未溯源截图",
    account: clean(output?.account),
    platform: clean(output?.platform) || clean(identity?.platform) || "image",
    summary,
    tags: unique(output?.tags, 5).length ? unique(output?.tags, 5) : ["截图收藏"],
    keyPoints: keyPoints.length ? keyPoints : [summary],
    questions,
    provider: "qwen-vl",
    model,
    usage: usage && typeof usage === "object" ? usage : {}
  };
}

async function toDataUrl(path, readFileImpl) {
  const buffer = await readFileImpl(path);
  const extension = extname(String(path || "")).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL)
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.provider = "qwen-vl";
  return error;
}

function unique(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))].slice(0, limit);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
