const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const MODEL_REQUEST_TIMEOUT_MS = readPositiveInt(process.env.MODEL_REQUEST_TIMEOUT_MS, 90_000);

export async function callModelJson(request) {
  const provider = String(request?.provider || resolveModelJsonProvider()).trim().toLowerCase();
  if (request?.imageDataUrl && provider === "deepseek") {
    throw new Error("当前 DeepSeek 配置不支持截图视觉输入，请使用 Qwen 视觉模型。");
  }
  if (provider === "deepseek") return callDeepSeekJson(request);
  if (provider === "openai") return callOpenAIResponsesJson(request);
  if (["qwen", "openai_compatible", "compatible"].includes(provider)) {
    return callOpenAICompatibleJson(request, { provider });
  }
  throw new Error(`不支持的模型供应商：${provider}`);
}

// Compatibility export for legacy generation modules. New code should import callModelJson.
export const callOpenAIJson = callModelJson;

export function resolveModelJsonProvider(env = process.env) {
  const explicitProvider = String(env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicitProvider) return explicitProvider;
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  if (env.QWEN_API || env.QWEN_API_KEY || env.DASHSCOPE_API_KEY) return "qwen";
  return "openai";
}

async function callOpenAICompatibleJson(request, { provider }) {
  const {
    system,
    user,
    schemaName,
    schema,
    stage,
    modelUsageRecorder,
    estimatedOutputTokens,
    imageDataUrl
  } = request;
  const apiKey = provider === "qwen"
    ? process.env.QWEN_API || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY
    : process.env.QWEN_API
      || process.env.QWEN_API_KEY
      || process.env.DASHSCOPE_API_KEY
      || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OpenAI-compatible 模型 API Key。");
  }

  const model = request.model
    || process.env.AI_MODEL
    || process.env.QWEN_MODEL
    || process.env.MODEL
    || "qwen3.7-plus-2026-05-26";
  const url = resolveCompatibleChatUrl(process.env.BASE_URL || process.env.AI_BASE_URL);
  const systemMessage = buildCompatibleSystemMessage({ system, schemaName, schema });
  const requestText = [systemMessage, user, imageDataUrl ? "[screenshot image omitted]" : ""]
    .filter(Boolean)
    .join("\n\n");
  const userContent = buildCompatibleUserContent(user, imageDataUrl);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userContent }
      ],
      response_format: { type: "json_object" },
      stream: false,
      enable_thinking: false,
      temperature: 0.1,
      max_tokens: normalizeMaxTokens(estimatedOutputTokens)
    })
  }, "OpenAI-compatible");

  const payload = await response.json().catch(() => null);
  const usageRecord = recordModelUsage(modelUsageRecorder, {
    provider,
    model,
    stage,
    requestText,
    estimatedOutputTokens,
    usage: payload?.usage,
    error: response.ok ? null : payload?.error?.message || `模型请求失败：${response.status}`
  });
  if (!response.ok) {
    throw new Error(payload?.error?.message || `模型请求失败：${response.status}`);
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("模型没有返回结构化文本。");
  try {
    return parseModelJson(text);
  } catch (error) {
    annotateModelParseFailure(usageRecord, text, error);
    throw new Error("模型返回内容不是可解析 JSON，请重试。");
  }
}

function resolveCompatibleChatUrl(baseUrl) {
  const value = String(baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  if (/\/chat\/completions$/i.test(value)) return value;
  return `${value}/chat/completions`;
}

async function callOpenAIResponsesJson({
  system,
  user,
  schemaName,
  schema,
  stage,
  modelUsageRecorder,
  estimatedOutputTokens,
  imageDataUrl
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少模型 API Key。请先设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY。");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const requestText = [
    system,
    user,
    schemaName,
    JSON.stringify(schema),
    imageDataUrl ? "[screenshot image omitted]" : ""
  ].join("\n\n");
  const userContent = [
    { type: "input_text", text: user },
    ...(imageDataUrl ? [{ type: "input_image", image_url: normalizeImageDataUrl(imageDataUrl) }] : [])
  ];
  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: userContent }
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  }, "OpenAI");

  const payload = await response.json().catch(() => null);
  const usageRecord = recordModelUsage(modelUsageRecorder, {
    provider: "openai",
    model,
    stage,
    requestText,
    estimatedOutputTokens,
    usage: payload?.usage,
    error: response.ok ? null : payload?.error?.message || `OpenAI 请求失败：${response.status}`
  });

  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI 请求失败：${response.status}`;
    throw new Error(message);
  }

  const text = extractResponseText(payload);
  try {
    return parseModelJson(text);
  } catch (error) {
    annotateModelParseFailure(usageRecord, text, error);
    throw new Error("模型返回内容不是可解析 JSON，请重试。");
  }
}

async function callDeepSeekJson({
  system,
  user,
  schemaName,
  schema,
  stage,
  modelUsageRecorder,
  estimatedOutputTokens
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 DEEPSEEK_API_KEY。请先在启动后端前设置环境变量。");
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const thinkingType = normalizeDeepSeekThinking(process.env.DEEPSEEK_THINKING);
  const systemMessage = `${system}\n\n你必须只输出一个 JSON 对象，不要输出 Markdown、代码块或解释文字。JSON 必须符合这个 schema 名称：${schemaName}。\n\nJSON Schema:\n${JSON.stringify(schema)}`;
  const requestText = [systemMessage, user].join("\n\n");
  const response = await fetchWithTimeout(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemMessage
        },
        { role: "user", content: user }
      ],
      response_format: { type: "json_object" },
      stream: false,
      thinking: { type: thinkingType },
      temperature: 0.2,
      max_tokens: normalizeMaxTokens(estimatedOutputTokens)
    })
  }, "DeepSeek");

  const payload = await response.json().catch(() => null);
  const usageRecord = recordModelUsage(modelUsageRecorder, {
    provider: "deepseek",
    model,
    stage,
    requestText,
    estimatedOutputTokens,
    usage: payload?.usage,
    error: response.ok ? null : payload?.error?.message || `DeepSeek 请求失败：${response.status}`
  });

  if (!response.ok) {
    const message = payload?.error?.message || `DeepSeek 请求失败：${response.status}`;
    throw new Error(message);
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek 没有返回结构化文本。");

  try {
    return parseModelJson(text);
  } catch (error) {
    annotateModelParseFailure(usageRecord, text, error);
    throw new Error("模型返回内容不是可解析 JSON，请重试。");
  }
}

function recordModelUsage(modelUsageRecorder, record) {
  if (!modelUsageRecorder || typeof modelUsageRecorder.record !== "function") return null;
  return modelUsageRecorder.record(record);
}

function annotateModelParseFailure(record, text, error) {
  if (!record || typeof record !== "object") return;
  record.error = "模型返回内容不是可解析 JSON";
  record.parseError = error instanceof Error ? error.message : String(error || "parse_failed");
  record.rawResponsePreview = String(text || "").slice(0, 4000);
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = payload?.output || [];
  for (const item of output) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("模型没有返回结构化文本。");
}

async function fetchWithTimeout(url, options, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} 请求超时，请稍后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeMaxTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 4096;
  return Math.max(256, Math.min(16_000, Math.ceil(parsed)));
}

function normalizeDeepSeekThinking(value) {
  const normalized = String(value || "disabled").trim().toLowerCase();
  return normalized === "enabled" ? "enabled" : "disabled";
}

export function buildCompatibleUserContent(user, imageDataUrl = "") {
  if (!imageDataUrl) return user;
  return [
    { type: "text", text: String(user || "") },
    {
      type: "image_url",
      image_url: { url: normalizeImageDataUrl(imageDataUrl) }
    }
  ];
}

export function buildCompatibleSystemMessage({ system = "", schemaName = "output", schema = {} } = {}) {
  return [
    system,
    "只输出最终数据的 JSON 对象，不要输出 Markdown。",
    `以下 ${schemaName} JSON Schema 仅用于约束输出字段，不是需要复述的数据。`,
    "严禁在结果中输出 type、properties、required、additionalProperties 等 Schema 元数据；直接从业务字段开始。",
    JSON.stringify(schema)
  ].filter(Boolean).join("\n\n");
}

function normalizeImageDataUrl(value) {
  const dataUrl = String(value || "").trim();
  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(dataUrl)) {
    throw new Error("截图必须是 JPEG、PNG 或 WebP 的 Base64 Data URL。");
  }
  return dataUrl.replace(/\s+/g, "");
}

function stripCodeFence(text) {
  return String(text)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseModelJson(text) {
  const normalized = stripCodeFence(text);
  const extracted = extractFirstJsonObject(normalized);
  const candidates = [
    normalized,
    extracted,
    repairJsonLikeText(normalized),
    repairJsonLikeText(extracted)
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  if (!extracted) throw new Error("no_json_object");
  throw lastError || new Error("invalid_json");
}

function extractFirstJsonObject(text) {
  const value = String(text || "");
  const start = value.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }

  return "";
}

function repairJsonLikeText(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return escapeControlCharsInStrings(value)
    .replace(/,\s*([}\]])/g, "$1");
}

function escapeControlCharsInStrings(text) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of String(text || "")) {
    if (!inString) {
      result += char;
      if (char === "\"") inString = true;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = false;
      continue;
    }

    if (char === "\n") result += "\\n";
    else if (char === "\r") result += "\\r";
    else if (char === "\t") result += "\\t";
    else result += char;
  }

  return result;
}
