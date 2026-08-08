import { readRuntimeConfig } from "./runtimeConfig.js";

export async function searchMemoryCards(
  { query, cards = [] } = {},
  { config = readRuntimeConfig(), fetchImpl = fetch } = {}
) {
  const normalizedQuery = text(query, 500);
  if (!normalizedQuery) {
    throw httpError(422, "search_query_required", "请输入要搜索的知识。");
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    return { orderedCardIDs: [] };
  }
  if (
    !config.qwen.configured
    || !config.qwen.baseURLValid
    || !config.qwen.timeoutValid
    || !config.qwen.model
  ) {
    throw httpError(503, "search_not_configured", "知识库搜索尚未配置。");
  }

  const candidates = cards.map(toSearchDocument);
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
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是 Omo 知识库的语义检索排序器。",
              "只依据给定候选卡，按用户查询的语义相关性排序。",
              "只输出 JSON：{\"orderedCardIDs\":[\"id\"]}。",
              "没有相关结果时返回空数组；不得生成候选集之外的 ID。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ query: normalizedQuery, candidates })
          }
        ]
      }),
      signal: AbortSignal.timeout(config.qwen.timeoutMs)
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw httpError(504, "search_timeout", "知识库搜索响应超时，请重试。");
    }
    throw httpError(502, "search_unavailable", "知识库搜索暂时不可用，请重试。");
  }

  if (!response.ok) {
    throw httpError(502, "search_upstream_error", "知识库搜索服务暂时不可用。");
  }

  const result = await decodeResult(response);
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set();
  const orderedCardIDs = result.orderedCardIDs.filter((id) => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { orderedCardIDs };
}

async function decodeResult(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw httpError(502, "search_invalid_response", "知识库搜索返回了无效结果。");
  }
  const content = payload?.choices?.[0]?.message?.content;
  const raw = Array.isArray(content)
    ? content.map((item) => item?.text || "").join("")
    : String(content || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw httpError(502, "search_invalid_response", "知识库搜索返回了无效结果。");
  }
  try {
    const result = JSON.parse(raw.slice(start, end + 1));
    if (
      !Array.isArray(result.orderedCardIDs)
      || result.orderedCardIDs.some((id) => typeof id !== "string")
    ) {
      throw new Error("invalid schema");
    }
    return result;
  } catch {
    throw httpError(502, "search_invalid_response", "知识库搜索返回了无效结果。");
  }
}

function toSearchDocument(card) {
  return {
    id: String(card?.id || ""),
    coreKnowledge: text(card?.coreKnowledge),
    recallCue: text(card?.recallCue),
    explanation: text(card?.explanation),
    sourceTitle: text(card?.sourceTitle)
  };
}

function text(value, limit = 600) {
  return String(value || "").trim().slice(0, limit);
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
