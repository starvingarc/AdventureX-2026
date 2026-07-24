import { createMediaExtractionError } from "./mediaErrors.js";
import { normalizeTranscriptionPayload } from "./transcriptionResult.js";

const DEFAULT_TIMEOUT_MS = positiveInt(process.env.QWEN_ASR_TIMEOUT_MS, 600_000);
const DEFAULT_POLL_MS = positiveInt(process.env.QWEN_ASR_POLL_MS, 2_000);

// Qwen Filetrans returns sentence timestamps, which are required to map a
// screenshot back to its surrounding spoken content.
export async function transcribeMediaWithQwen({
  mediaUrl,
  apiKey = process.env.QWEN_ASR_API_KEY || process.env.QWEN_API || process.env.DASHSCOPE_API_KEY || "",
  baseUrl = process.env.QWEN_ASR_BASE_URL || process.env.BASE_URL || "https://dashscope.aliyuncs.com",
  model = process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-filetrans",
  language = process.env.QWEN_ASR_LANGUAGE || process.env.LOCAL_WHISPER_LANGUAGE || "auto",
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS
} = {}) {
  if (!mediaUrl || !apiKey) {
    throw createMediaExtractionError("asr_config_missing", "Qwen 语音转写缺少音频地址或 API 配置。", { retryable: false, provider: "qwen_filetrans" });
  }
  const root = apiRoot(baseUrl);
  const parameters = { channel_id: [0], enable_itn: false };
  if (!isAutomaticLanguage(language)) parameters.language = language;
  const task = await requestJson(`${root}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify({
      model,
      input: { file_url: mediaUrl },
      parameters
    })
  }, { fetchImpl, timeoutMs, provider: "qwen_filetrans" });
  const taskId = task?.output?.task_id || task?.task_id;
  if (!taskId) throw unavailable("Qwen 没有返回转写任务 ID。");

  const deadline = Date.now() + timeoutMs;
  let status = null;
  while (Date.now() < deadline) {
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    status = await requestJson(`${root}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${apiKey}` }
    }, { fetchImpl, timeoutMs: Math.min(30_000, Math.max(1, deadline - Date.now())), provider: "qwen_filetrans" });
    const state = String(status?.output?.task_status || status?.task_status || "").toUpperCase();
    if (["SUCCEEDED", "SUCCESS"].includes(state)) break;
    if (["FAILED", "CANCELED", "CANCELLED"].includes(state)) throw unavailable(status?.output?.message || "Qwen 文件转写失败。");
  }
  const transcriptUrl = findTranscriptUrl(status);
  if (!transcriptUrl) throw unavailable("Qwen 文件转写未返回结果地址。");
  const result = await requestJson(transcriptUrl, {}, { fetchImpl, timeoutMs: 30_000, provider: "qwen_filetrans" });
  const sentences = findSentences(result);
  return normalizeTranscriptionPayload({
    segments: sentences.map((item, index) => ({
      id: `transcript-${String(index + 1).padStart(3, "0")}`,
      startSeconds: Number(item?.begin_time ?? item?.start_time ?? item?.start) / 1000,
      endSeconds: Number(item?.end_time ?? item?.end) / 1000,
      text: item?.text || item?.sentence_text || ""
    }))
  }, { provider: "qwen_filetrans" });
}

function isAutomaticLanguage(value) {
  return ["", "auto", "automatic", "detect"].includes(String(value || "").trim().toLowerCase());
}

function apiRoot(value) {
  const url = new URL(String(value));
  return `${url.origin}/api/v1`;
}

async function requestJson(url, options, { fetchImpl, timeoutMs, provider }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw unavailable(body?.message || `Qwen ASR HTTP ${response.status}`);
    return body || {};
  } catch (error) {
    if (error?.mediaErrorType) throw error;
    if (error?.name === "AbortError") throw createMediaExtractionError("asr_timeout", "Qwen 文件转写超时。", { retryable: true, provider });
    throw createMediaExtractionError("asr_unavailable", "Qwen 文件转写暂时不可用。", { retryable: true, provider, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function findTranscriptUrl(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.transcription_url === "string") return value.transcription_url;
  for (const item of Object.values(value)) {
    const found = Array.isArray(item)
      ? item.map(findTranscriptUrl).find(Boolean)
      : findTranscriptUrl(item);
    if (found) return found;
  }
  return "";
}

function findSentences(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.sentences)) return value.sentences;
  if (Array.isArray(value.transcripts)) return value.transcripts.flatMap((item) => findSentences(item));
  for (const item of Object.values(value)) {
    const found = findSentences(item);
    if (found.length) return found;
  }
  return [];
}

function unavailable(message) {
  return createMediaExtractionError("asr_unavailable", message, { retryable: true, provider: "qwen_filetrans" });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
