import { createHash } from "node:crypto";
import { readRuntimeConfig } from "./runtimeConfig.js";
import { verifyScreenshotSource } from "./sourceVerifier.js";

const validRarities = new Set(["R", "SR", "SSR"]);

export async function createMemoryCard(
  { imageBase64, mimeType = "image/jpeg" } = {},
  {
    config = readRuntimeConfig(),
    fetchImpl = fetch,
    sourceFetchImpl = fetch,
    verifySourceImpl = verifyScreenshotSource
  } = {}
) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw httpError(400, "image_required", "请先选择一张截图。");
  }
  if (!config.demo.valid) {
    throw httpError(503, "demo_mode_invalid", "OMO_DEMO_MODE 配置无效。");
  }
  if (config.production && config.demo.requested) {
    throw httpError(503, "demo_mode_forbidden", "生产环境禁止使用 Fixture 模式。");
  }

  const now = new Date().toISOString();
  const id = `card-${createHash("sha256").update(imageBase64).digest("hex").slice(0, 20)}`;
  const generationMode = config.qwen.configured ? "qwen" : "fixture";
  let generated;
  if (config.qwen.configured) {
    generated = await callQwen(imageBase64, mimeType, {
      config,
      fetchImpl,
      mode: "generate"
    });
    const validationError = generatedCardError(generated);
    if (validationError) {
      generated = await callQwen(imageBase64, mimeType, {
        config,
        fetchImpl,
        mode: "repair",
        invalidCandidate: generated,
        validationError
      });
    }
  } else {
    generated = config.demo.enabled ? demoCard() : failModelConfiguration();
  }
  validateGeneratedCard(generated);

  const coreKnowledge = text(generated.coreKnowledge);
  const hiddenSemantic = text(generated.hiddenSemantic);

  const source = await verifySourceImpl(generated, {
    apiKey: config.tikhub.apiKey,
    baseURL: config.tikhub.baseURL,
    timeoutMs: config.tikhub.timeoutMs,
    fetchImpl: sourceFetchImpl
  }).catch(() => ({
    status: "screenshot_only",
    provider: "tikhub",
    platform: generated.platform || "unknown",
    reason: "provider_unavailable"
  }));

  return {
    id,
    generationMode,
    coreKnowledge,
    hiddenSemantic,
    recallCue: text(generated.recallCue),
    answer: hiddenSemantic,
    explanation: text(generated.explanation),
    sourceTitle: text(
      source.title || generated.sourceTitle,
      generationMode === "fixture" ? "本地 Fixture 卡" : "截图内容"
    ),
    sourceAccount: text(source.account || generated.sourceAccount),
    sourcePlatform: text(source.platform || generated.platform || "unknown"),
    sourceUrl: text(source.url),
    sourceStatus: source.status,
    sourceProvider: source.provider,
    sourceReason: text(source.reason),
    sourceConfidence: Number(source.confidence || 0),
    rarity: source.status === "verified" && validRarities.has(generated.rarity)
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

async function callQwen(
  imageBase64,
  mimeType,
  {
    config,
    fetchImpl,
    mode,
    invalidCandidate,
    validationError
  }
) {
  if (!config.qwen.baseURLValid || !config.qwen.timeoutValid || !config.qwen.model) {
    throw httpError(503, "model_config_invalid", "视觉模型配置无效。");
  }

  const isRepair = mode === "repair";
  let response;
  try {
    response = await fetchImpl(`${config.qwen.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.qwen.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.qwen.model,
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
                      `上一次结果：${JSON.stringify(repairContext(invalidCandidate))}`,
                      "必须确保 hiddenSemantic 是 coreKnowledge 中逐字一致的连续子串。"
                    ].join("\n")
                  : "请把这张截图制作成一张简洁的中文记忆卡。"
              },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(config.qwen.timeoutMs)
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw httpError(504, "model_timeout", "视觉模型响应超时。");
    }
    throw httpError(502, "model_unavailable", "视觉模型暂时不可用。");
  }
  if (!response.ok) {
    throw httpError(
      502,
      "model_upstream_error",
      `视觉模型调用失败（HTTP ${response.status}）。`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw httpError(502, "model_invalid_response", "视觉模型返回了无效响应。");
  }
  const content = payload.choices?.[0]?.message?.content;
  const raw = Array.isArray(content)
    ? content.map((item) => item.text || "").join("")
    : String(content || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw httpError(502, "model_invalid_response", "视觉模型没有返回有效记忆卡。");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw httpError(502, "model_invalid_response", "视觉模型返回的记忆卡格式无效。");
  }
}

function demoCard() {
  return {
    coreKnowledge: "截图只有在被再次想起时，才真正从收藏变成记忆。",
    hiddenSemantic: "再次想起",
    recallCue: "保存一张截图之后，怎样才能让它不再积灰？",
    explanation: "这是通过 OMO_DEMO_MODE 显式开启的本地 Fixture，不代表真实模型结果。",
    sourceTitle: "本地 Fixture 卡",
    sourceAccount: "",
    platform: "unknown",
    rarity: "R"
  };
}

function failModelConfiguration() {
  throw httpError(503, "model_not_configured", "视觉模型尚未配置。");
}

function validateGeneratedCard(generated) {
  const error = generatedCardError(generated);
  if (error) {
    throw httpError(502, "model_invalid_response", "视觉模型返回的承重语义无法验证。");
  }
}

export function hasValidHiddenSemantic(value) {
  const coreKnowledge = text(value?.coreKnowledge);
  const hiddenSemantic = text(value?.hiddenSemantic);
  return hiddenSemantic.length > 0 && coreKnowledge.includes(hiddenSemantic);
}

function generatedCardError(generated) {
  const required = ["coreKnowledge", "hiddenSemantic", "recallCue", "explanation"];
  if (!generated || required.some((field) => !text(generated[field]))) {
    return "coreKnowledge、hiddenSemantic、recallCue 和 explanation 均不能为空。";
  }
  if (!hasValidHiddenSemantic(generated)) {
    return "hiddenSemantic 必须是 coreKnowledge 中逐字一致的连续子串。";
  }
  return "";
}

function repairContext(candidate) {
  const fields = [
    "coreKnowledge",
    "hiddenSemantic",
    "recallCue",
    "explanation",
    "sourceTitle",
    "sourceAccount",
    "platform",
    "rarity"
  ];
  return Object.fromEntries(fields.map((field) => [field, text(candidate?.[field])]));
}

function text(value, fallback = "") {
  const result = String(value || fallback).trim();
  return result.slice(0, 600);
}

function isTimeout(error) {
  return ["AbortError", "TimeoutError"].includes(error?.name);
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}
