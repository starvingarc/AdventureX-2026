import { createHash } from "node:crypto";
import { verifyScreenshotSource } from "./sourceVerifier.js";

const validRarities = new Set(["R", "SR", "SSR"]);

export async function createMemoryCard(
  { imageBase64, mimeType = "image/jpeg" } = {},
  dependencies = {}
) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw httpError(400, "请先选择一张截图。 ");
  }

  const now = new Date().toISOString();
  const id = `card-${createHash("sha256").update(imageBase64).digest("hex").slice(0, 20)}`;
  const usesDemoCard = !dependencies.modelCaller && !process.env.QWEN_API;
  const modelCaller = dependencies.modelCaller
    || (process.env.QWEN_API ? callQwen : async () => demoCard());
  const sourceVerifier = dependencies.sourceVerifier || verifyScreenshotSource;
  let generated = await modelCaller({
    mode: "generate",
    imageBase64,
    mimeType
  });

  if (!hasValidHiddenSemantic(generated)) {
    const validationError = hiddenSemanticError(generated);
    generated = await modelCaller({
      mode: "repair",
      imageBase64,
      mimeType,
      invalidCandidate: generated,
      validationError
    });
  }

  if (!hasValidHiddenSemantic(generated)) {
    throw httpError(502, "记忆卡缺少可验证的承重语义。 ");
  }

  const coreKnowledge = text(generated.coreKnowledge);
  const hiddenSemantic = text(generated.hiddenSemantic);
  const source = await sourceVerifier(generated).catch(() => ({
    status: "screenshot_only",
    provider: "tikhub",
    platform: generated.platform || "unknown"
  }));
  const sourceStatus = text(source.status, "screenshot_only");

  return {
    id,
    coreKnowledge,
    hiddenSemantic,
    recallCue: text(generated.recallCue, "你保存这张截图时，最想记住什么？"),
    answer: hiddenSemantic,
    explanation: text(generated.explanation, "根据截图中的可见内容生成。"),
    sourceTitle: text(source.title || generated.sourceTitle, usesDemoCard ? "本地演示卡" : "截图内容"),
    sourceAccount: text(source.account || generated.sourceAccount),
    sourcePlatform: text(source.platform || generated.platform || "unknown"),
    sourceUrl: text(source.url),
    sourceStatus,
    sourceProvider: source.provider,
    sourceConfidence: Number(source.confidence || 0),
    rarity: sourceStatus === "verified" && validRarities.has(generated.rarity)
      ? generated.rarity
      : "R",
    createdAt: now,
    masteryStage: "sealed",
    nextReviewAt: now,
    reviewCount: 0,
    successfulRecallCount: 0,
    lastAssessment: null,
    stepIndex: 0,
    attemptIds: []
  };
}

async function callQwen({
  mode,
  imageBase64,
  mimeType,
  invalidCandidate,
  validationError
}) {
  const baseURL = String(process.env.BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1")
    .replace(/\/$/, "");
  const isRepair = mode === "repair";
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.QWEN_API}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || process.env.QWEN_MODEL || "qwen3-vl-plus",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 Omo 的记忆卡编辑器。只依据截图可见内容，提炼一个最值得长期记住的知识点。",
            "输出 JSON：coreKnowledge、hiddenSemantic、recallCue、explanation、sourceTitle、sourceAccount、platform、rarity。",
            "hiddenSemantic 必须非空，并且必须是 coreKnowledge 中字符完全一致的连续子串；它应是删去后能形成真实回忆缺口的承重语义。",
            "sourceTitle 必须是当前主内容标题，sourceAccount 必须是当前发布者或 UP 主；忽略推荐列表、广告、画面字幕、合集名和状态栏。",
            "platform 只能是 bilibili、douyin、xiaohongshu、wechat、zhihu、youtube、unknown。",
            "rarity 只能是 R、SR、SSR；信息不足时保持谨慎，不补充截图外事实。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: isRepair
                ? [
                    "上一次结果违反记忆卡合同，请只依据同一张截图重新生成完整 JSON。",
                    `校验错误：${validationError}`,
                    `上一次结果：${JSON.stringify(invalidCandidate || {})}`,
                    "必须确保 hiddenSemantic 是 coreKnowledge 中逐字一致的连续子串。"
                  ].join("\n")
                : "请把这张截图制作成一张简洁的中文记忆卡。"
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(Number(process.env.MODEL_REQUEST_TIMEOUT_MS || 60000))
  });

  if (!response.ok) {
    const detail = await response.text();
    throw httpError(502, `视觉模型调用失败（${response.status}）：${detail.slice(0, 180)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const raw = Array.isArray(content)
    ? content.map((item) => item.text || "").join("")
    : String(content || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw httpError(502, "视觉模型没有返回有效记忆卡。 ");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw httpError(502, "视觉模型返回的记忆卡格式无效。 ");
  }
}

function demoCard() {
  return {
    coreKnowledge: "截图只有在被再次想起时，才真正从收藏变成记忆。",
    hiddenSemantic: "再次想起",
    recallCue: "保存一张截图之后，怎样才能让它不再积灰？",
    explanation: "当前没有配置 QWEN_API，因此返回一张明确标记的本地演示卡。",
    sourceTitle: "本地演示卡",
    sourceAccount: "",
    platform: "unknown",
    rarity: "R"
  };
}

export function hasValidHiddenSemantic(value) {
  const coreKnowledge = text(value?.coreKnowledge);
  const hiddenSemantic = text(value?.hiddenSemantic);
  return hiddenSemantic.length > 0 && coreKnowledge.includes(hiddenSemantic);
}

function hiddenSemanticError(value) {
  const coreKnowledge = text(value?.coreKnowledge);
  const hiddenSemantic = text(value?.hiddenSemantic);
  if (!coreKnowledge) return "coreKnowledge 不能为空。";
  if (!hiddenSemantic) return "hiddenSemantic 不能为空。";
  return "hiddenSemantic 必须是 coreKnowledge 中逐字一致的连续子串。";
}

function text(value, fallback = "") {
  const result = String(value || fallback).trim();
  return result.slice(0, 600);
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
