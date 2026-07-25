import { createHash } from "node:crypto";

import { callModelJson } from "../../generation/openaiClient.js";
import {
  V2_REVIEW_PATH_SCHEMA_VERSION,
  validateReviewPathV2
} from "../contracts/reviewPathContract.js";
import {
  emitV2GenerationProgress,
  V2_GENERATION_STAGE,
  V2_GENERATION_STATUS
} from "./generationProgress.js";

const DEFAULT_INPUT_CHARACTERS = 12_000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_ENTRIES = 128;
const PROMPT_VERSION = "quick-review-v1";
const resultCache = new Map();
const inFlight = new Map();

export const QUICK_REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "tags", "questions"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    tags: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string" }
    },
    questions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["knowledgePoint", "type", "prompt", "options", "correctIndex", "explanation"],
        properties: {
          knowledgePoint: { type: "string", minLength: 2, maxLength: 24 },
          type: { enum: ["multiple_choice", "true_false"] },
          prompt: { type: "string" },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string" }
          },
          correctIndex: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" }
        }
      }
    }
  }
};

export async function generateQuickReviewPath(article, {
  modelJsonCaller = callModelJson,
  modelUsageRecorder = null,
  onProgress = null,
  now = new Date().toISOString(),
  maxInputCharacters = readPositiveInt(process.env.QUICK_REVIEW_MAX_INPUT_CHARS, DEFAULT_INPUT_CHARACTERS),
  cacheTtlMs = readPositiveInt(process.env.QUICK_REVIEW_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS),
  cacheEntries = readPositiveInt(process.env.QUICK_REVIEW_CACHE_MAX_ENTRIES, DEFAULT_CACHE_ENTRIES),
  cacheEnabled = process.env.QUICK_REVIEW_CACHE_ENABLED !== "0"
} = {}) {
  const source = buildSource(article);
  const sourceText = source.blocks.map((block) => block.text).join("\n");
  const boundedText = selectTextWindow(sourceText, maxInputCharacters);
  const cacheKey = fingerprint({ source, boundedText });

  await emitV2GenerationProgress(onProgress, {
    chapterId: article.id || article.chapterId || "",
    status: V2_GENERATION_STATUS.RUNNING,
    stage: V2_GENERATION_STAGE.GENERATING_QUESTIONS,
    updatedAt: now
  });

  let generated = cacheEnabled ? readResultCache(cacheKey, cacheTtlMs) : null;
  let cacheHit = Boolean(generated);
  if (!generated) {
    const existing = cacheEnabled ? inFlight.get(cacheKey) : null;
    if (existing) {
      generated = await existing;
      cacheHit = true;
    } else {
      const request = callQuickReviewModel({
        article,
        source,
        boundedText,
        modelJsonCaller,
        modelUsageRecorder
      });
      if (cacheEnabled) inFlight.set(cacheKey, request);
      try {
        generated = await request;
        if (cacheEnabled) writeResultCache(cacheKey, generated, cacheEntries);
      } finally {
        if (cacheEnabled) inFlight.delete(cacheKey);
      }
    }
  }

  const reviewPath = assembleReviewPath(article, source, generated, {
    now,
    cacheHit,
    inputCharacters: boundedText.length,
    sourceCharacters: sourceText.length
  });
  const validation = validateReviewPathV2(reviewPath);
  if (!validation.ok) {
    const error = new Error(`quick review output failed validation:\n${validation.errors.join("\n")}`);
    error.stage = "quick_review";
    error.errors = validation.errors;
    throw error;
  }
  return reviewPath;
}

async function callQuickReviewModel({ article, source, boundedText, modelJsonCaller, modelUsageRecorder }) {
  const metadata = [
    source.title ? `标题：${source.title}` : "",
    source.author ? `作者/账号：${source.author}` : "",
    source.url ? `链接：${source.url}` : ""
  ].filter(Boolean).join("\n");
  const user = `${metadata}\n\n内容：\n${boundedText}`;
  const request = {
    system: [
      "你把碎片化内容压缩成可以在手机上快速复习的记忆卡。",
      "只依据输入，不补充未经原文支持的事实。",
      "summary 用 2-4 句中文概括核心结论；tags 输出 1-5 个短标签。",
      "恰好生成 3 道题：1 道判断题和 2 道四选一。",
      "每题 knowledgePoint 是 2-24 个汉字的具体知识点标题，不要写“知识点一”之类的序号。",
      "判断题 options 必须为 [\"正确\",\"错误\"]；选择题必须恰好 4 个选项。",
      "题干短、答案唯一、解释不超过 60 个汉字。"
    ].join("\n"),
    user,
    schemaName: "shibei_quick_review_v1",
    schema: QUICK_REVIEW_OUTPUT_SCHEMA,
    stage: "quick_review",
    modelUsageRecorder,
    estimatedOutputTokens: 1_400
  };
  let output;
  try {
    output = await modelJsonCaller(request);
  } catch (error) {
    if (!isRetryableStructuredOutputError(error)) throw error;
    output = await modelJsonCaller({
      ...request,
      user: `${user}\n\n上一次响应不是完整 JSON；这次只返回一个完整 JSON 对象，不要解释。`
    });
  }
  return normalizeGeneratedReview(output, article, source);
}

function isRetryableStructuredOutputError(error) {
  const message = String(error?.message || "");
  return message.includes("不是可解析 JSON") || message.includes("结构化文本");
}

function normalizeGeneratedReview(output, article, source) {
  const summary = cleanText(output?.summary) || "这条内容已保存，稍后可以通过练习快速回顾。";
  const questions = (Array.isArray(output?.questions) ? output.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean)
    .slice(0, 3);
  if (questions.length < 3) {
    throw new Error("模型生成的有效练习不足 3 道，请重试。");
  }
  return {
    title: cleanText(output?.title) || source.title || article.title || "新收藏",
    summary,
    tags: uniqueStrings(output?.tags, 5),
    questions
  };
}

function normalizeQuestion(question) {
  const type = question?.type === "true_false" ? "true_false" : "multiple_choice";
  const knowledgePoint = cleanText(question?.knowledgePoint);
  const prompt = cleanText(question?.prompt);
  const explanation = cleanText(question?.explanation);
  let options = uniqueStrings(question?.options, type === "true_false" ? 2 : 4);
  if (type === "true_false") options = ["正确", "错误"];
  if (!knowledgePoint || !prompt || !explanation || options.length !== (type === "true_false" ? 2 : 4)) return null;
  const correctIndex = Number(question?.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;
  return { knowledgePoint, type, prompt, explanation, options, correctIndex };
}

function assembleReviewPath(article, source, generated, meta) {
  const chapterId = String(article.id || article.chapterId || `chapter-${Date.now()}`);
  const anchorBlockIds = source.blocks.slice(0, 8).map((block) => block.id);
  const anchorId = "anchor-quick-review";
  const questions = generated.questions.map((question, index) => ({
    id: `q-${String(index + 1).padStart(3, "0")}`,
    knowledgePoint: question.knowledgePoint,
    type: question.type,
    stem: question.prompt,
    options: question.options.map((text, optionIndex) => ({
      id: `option-${optionIndex + 1}`,
      text
    })),
    correctOptionId: `option-${question.correctIndex + 1}`,
    explanation: question.explanation,
    sourceAnchorId: anchorId,
    displayLabel: question.type === "true_false" ? "快速判断" : "核心理解"
  }));

  return {
    schemaVersion: V2_REVIEW_PATH_SCHEMA_VERSION,
    id: chapterId,
    status: "completed",
    title: generated.title,
    tags: generated.tags,
    source: {
      ...source.metadata,
      blocks: source.blocks
    },
    summaryCard: { text: generated.summary },
    units: [{
      id: "unit-quick-review",
      order: 1,
      title: "快速复习",
      nodeLabel: `${questions.length} 张记忆卡`,
      shortSummary: generated.summary,
      detailSummary: generated.summary,
      sourceAnchor: {
        id: anchorId,
        label: "原内容",
        quote: source.blocks[0]?.text || "",
        blockIds: anchorBlockIds
      },
      overview: { text: generated.summary },
      questions,
      summary: {
        title: "本次复习完成",
        text: "忘记并不可怕；答错的内容会更早再次出现。"
      }
    }],
    chapterSummary: {
      title: "已存入记忆",
      statsText: `完成 ${questions.length} 张记忆卡`,
      encouragementText: "保持短而频繁的回想，比一次看很久更有效。"
    },
    generationMeta: {
      currentStage: "completed",
      mode: PROMPT_VERSION,
      modelCallCount: meta.cacheHit ? 0 : 1,
      cacheHit: meta.cacheHit,
      inputCharacters: meta.inputCharacters,
      sourceCharacters: meta.sourceCharacters,
      generatedAt: meta.now
    }
  };
}

function buildSource(article) {
  const supplied = Array.isArray(article?.source?.blocks)
    ? article.source.blocks
    : Array.isArray(article?.blocks) ? article.blocks : [];
  const rawBlocks = supplied.length > 0
    ? supplied
    : String(article?.cleanedText || article?.rawText || article?.source?.rawText || "")
      .split(/\n+/)
      .map((text) => ({ text }));
  const blocks = rawBlocks
    .map((block, index) => ({
      id: String(block?.id || `p-${String(index + 1).padStart(3, "0")}`),
      type: ["heading", "paragraph", "quote"].includes(block?.type) ? block.type : "paragraph",
      text: cleanText(block?.text),
      ...(block?.sourceRole ? { sourceRole: block.sourceRole } : {}),
      ...(Number.isFinite(Number(block?.startSeconds)) ? { startSeconds: Number(block.startSeconds) } : {}),
      ...(Number.isFinite(Number(block?.endSeconds)) ? { endSeconds: Number(block.endSeconds) } : {})
    }))
    .filter((block) => block.text);
  if (blocks.length === 0) throw new Error("没有可用于生成复习卡的正文。");

  const existing = article.source && typeof article.source === "object" ? article.source : {};
  const title = cleanText(existing.title || article.title || article.sourceTitle);
  const author = cleanText(existing.author || existing.account || article.author || article.sourceAccount);
  const url = cleanText(existing.url || article.url || article.sourceUrl);
  return {
    title,
    author,
    url,
    blocks,
    metadata: {
      type: existing.type || article.originalSourceType || article.sourceType || "text",
      title,
      author,
      account: cleanText(existing.account || article.sourceAccount || author),
      accountOrDomain: cleanText(existing.accountOrDomain || article.sourceAccount || author),
      url,
      ...(existing.platform ? { platform: existing.platform } : {}),
      ...(existing.contentBasis ? { contentBasis: existing.contentBasis } : {})
    }
  };
}

export function selectTextWindow(text, limit = DEFAULT_INPUT_CHARACTERS) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  const separator = "\n\n[中间内容已压缩]\n\n";
  const available = Math.max(300, limit - separator.length);
  const headLength = Math.floor(available * 0.45);
  const middleLength = Math.floor(available * 0.2);
  const tailLength = available - headLength - middleLength;
  const middleStart = Math.max(headLength, Math.floor((value.length - middleLength) / 2));
  return [
    value.slice(0, headLength),
    value.slice(middleStart, middleStart + middleLength),
    value.slice(-tailLength)
  ].join(separator);
}

function fingerprint({ source, boundedText }) {
  return createHash("sha256")
    .update([PROMPT_VERSION, source.url, source.title, boundedText].join("\n"))
    .digest("hex");
}

function readResultCache(key, ttlMs) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > ttlMs) {
    resultCache.delete(key);
    return null;
  }
  resultCache.delete(key);
  resultCache.set(key, entry);
  return structuredClone(entry.value);
}

function writeResultCache(key, value, maxEntries) {
  resultCache.set(key, { createdAt: Date.now(), value: structuredClone(value) });
  while (resultCache.size > maxEntries) {
    resultCache.delete(resultCache.keys().next().value);
  }
}

function uniqueStrings(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))].slice(0, limit);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
