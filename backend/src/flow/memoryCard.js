import { createHash } from "node:crypto";

const SSR_TERMS = ["底层", "本质", "因果", "机制", "原则", "框架", "反直觉"];
const SR_TERMS = ["方法", "策略", "步骤", "模型", "规律", "关系", "条件", "适用", "因此", "因为"];

const RARITY_REASONS = {
  SSR: "这是一条可跨场景解释或改变判断的高杠杆知识。",
  SR: "这是一条可在相似场景复用的方法或机制。",
  R: "这是一条在具体场景中有用、值得保留的知识。"
};

export function buildMemoryCard({ review, source = {}, link = {}, capture = {} } = {}) {
  const question = review?.units?.[0]?.questions?.[0];
  const options = Array.isArray(question?.options) ? question.options : [];
  const correctOption = options.find((option) => option?.id === question?.correctOptionId);
  const stem = cleanText(question?.stem);
  const answer = cleanText(correctOption?.text);
  const explanation = cleanText(question?.explanation);
  if (!stem || !answer || !explanation) {
    return buildMemoryFragment({
      capture,
      link,
      message: "内容已经找到，但还没有生成可验证的记忆问题。",
      code: "memory_question_unusable"
    });
  }

  const knowledgePoint = cleanText(question?.knowledgePoint);
  const rarity = classifyRarity({ knowledgePoint, stem, explanation });
  const sourceTitle = cleanText(source?.title || link?.title || review?.title);
  const sourceUrl = cleanText(source?.url || link?.url);
  return {
    id: stableId("card", sourceUrl, sourceTitle, stem, answer),
    state: "formal",
    coreKnowledge: `${stem} → ${answer}`,
    recallCue: stem,
    hiddenSemantic: answer,
    explanation,
    rarity,
    rarityReason: RARITY_REASONS[rarity],
    sourceTitle: sourceTitle || undefined,
    sourceUrl: sourceUrl || undefined,
    sourceStatus: "verified"
  };
}

export function buildMemoryFragment({
  capture = {},
  link = {},
  message = "",
  code = "source_unconfirmed"
} = {}) {
  const identity = capture?.identity || capture || {};
  const sourceTitle = cleanText(link?.title || identity?.title);
  const account = cleanText(link?.account || identity?.account);
  const platform = cleanText(link?.platform || identity?.platform);
  const explanation = cleanText(message) || "暂时无法核对这张截图的来源，先作为记忆碎片保留。";
  return {
    id: stableId("fragment", platform, sourceTitle, account, code, explanation),
    state: "fragment",
    coreKnowledge: sourceTitle || "这张截图还需要更多上下文",
    recallCue: sourceTitle
      ? `你当时为什么想记住「${sourceTitle}」？`
      : "你当时想记住这张截图里的什么？",
    explanation,
    sourceTitle: sourceTitle || undefined,
    sourceStatus: "unconfirmed"
  };
}

export function classifyRarity({ knowledgePoint = "", stem = "", explanation = "" } = {}) {
  const text = `${cleanText(knowledgePoint)} ${cleanText(stem)} ${cleanText(explanation)}`;
  if (cleanText(explanation).length >= 28 && SSR_TERMS.some((term) => text.includes(term))) return "SSR";
  if (SR_TERMS.some((term) => text.includes(term))) return "SR";
  return "R";
}

function stableId(prefix, ...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => cleanText(part)).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
