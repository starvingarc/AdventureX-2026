import { createHash } from "node:crypto";
import { verifyScreenshotSource } from "./sourceVerifier.js";

const validRarities = new Set(["R", "SR", "SSR"]);

export async function createMemoryCard({ imageBase64, mimeType = "image/jpeg" } = {}) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw httpError(400, "请先选择一张截图。 ");
  }

  const now = new Date().toISOString();
  const id = `card-${createHash("sha256").update(imageBase64).digest("hex").slice(0, 20)}`;
  const generated = process.env.QWEN_API
    ? await callQwen(imageBase64, mimeType)
    : demoCard();
  const source = await verifyScreenshotSource(generated).catch(() => ({
    status: "screenshot_only",
    provider: "tikhub",
    platform: generated.platform || "unknown"
  }));

  return {
    id,
    coreKnowledge: text(generated.coreKnowledge, "这张截图包含一个值得再次想起的知识点。"),
    recallCue: text(generated.recallCue, "你保存这张截图时，最想记住什么？"),
    answer: text(generated.answer, generated.coreKnowledge),
    explanation: text(generated.explanation, "根据截图中的可见内容生成。"),
    sourceTitle: text(source.title || generated.sourceTitle, process.env.QWEN_API ? "截图内容" : "本地演示卡"),
    sourceAccount: text(source.account || generated.sourceAccount),
    sourcePlatform: text(source.platform || generated.platform || "unknown"),
    sourceUrl: text(source.url),
    sourceStatus: source.status,
    sourceProvider: source.provider,
    sourceConfidence: Number(source.confidence || 0),
    rarity: validRarities.has(generated.rarity) ? generated.rarity : "R",
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

async function callQwen(imageBase64, mimeType) {
  const baseURL = String(process.env.BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1")
    .replace(/\/$/, "");
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
            "输出 JSON：coreKnowledge、recallCue、answer、explanation、sourceTitle、sourceAccount、platform、rarity。",
            "sourceTitle 必须是当前主内容标题，sourceAccount 必须是当前发布者或 UP 主；忽略推荐列表、广告、画面字幕、合集名和状态栏。",
            "platform 只能是 bilibili、douyin、xiaohongshu、wechat、zhihu、youtube、unknown。",
            "rarity 只能是 R、SR、SSR；信息不足时保持谨慎，不补充截图外事实。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请把这张截图制作成一张简洁的中文记忆卡。" },
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
    recallCue: "保存一张截图之后，怎样才能让它不再积灰？",
    answer: "把截图转成可召回的卡片，并在合适的时间主动回忆。",
    explanation: "当前没有配置 QWEN_API，因此返回一张明确标记的本地演示卡。",
    sourceTitle: "本地演示卡",
    sourceAccount: "",
    platform: "unknown",
    rarity: "R"
  };
}

function text(value, fallback = "") {
  const result = String(value || fallback).trim();
  return result.slice(0, 600);
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
