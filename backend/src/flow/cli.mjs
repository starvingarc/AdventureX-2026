import "../env.js";
import { runImageFlow } from "./index.js";
import { recognizeImage } from "./ocr.js";
import { searchLinks } from "./search.js";
import { extractFocusedSourceContent } from "./source.js";
import { refineScreenshotIdentity } from "./identity.js";
import { generateQuickReviewPath, generateVideoOverview } from "./review.js";
import { callModelJson, resolveModelJsonProvider } from "../generation/openaiClient.js";
import { shutdownLocalWhisperPool } from "../media/localWhisperTranscriptionProvider.js";

const imagePath = process.argv[2] || "image.jpg";
const sourceUrl = process.argv.find((arg) => arg.startsWith("http")) || "";
const traceEnabled = process.argv.includes("--trace");
const fullAsrEnabled = process.argv.includes("--full-asr");
if (fullAsrEnabled) process.env.VIDEO_ASR_MODE = "full";
try {
  const output = traceEnabled
    ? await runTracedImageFlow({ imagePath, sourceUrl })
    : await runImageFlow({ imagePath, sourceUrl });
  console.log(JSON.stringify(output, null, 2));
} finally {
  await shutdownLocalWhisperPool();
}

async function runTracedImageFlow({ imagePath, sourceUrl }) {
  const traceStartedAt = Date.now();
  const timeline = [];
  const record = async (stage, input, operation) => {
    const startedAt = Date.now();
    const entry = {
      stage,
      startedAt: new Date(startedAt).toISOString(),
      elapsedStartMs: startedAt - traceStartedAt,
      input: serializable(input)
    };
    timeline.push(entry);
    try {
      const output = await operation();
      const endedAt = Date.now();
      Object.assign(entry, {
        endedAt: new Date(endedAt).toISOString(),
        elapsedEndMs: endedAt - traceStartedAt,
        durationMs: endedAt - startedAt,
        output: serializable(output)
      });
      return output;
    } catch (error) {
      const endedAt = Date.now();
      Object.assign(entry, {
        endedAt: new Date(endedAt).toISOString(),
        elapsedEndMs: endedAt - traceStartedAt,
        durationMs: endedAt - startedAt,
        error: { code: error?.code || "trace_step_failed", message: error?.message || String(error) }
      });
      throw error;
    }
  };
  const modelJsonCaller = (request) => record(`model:${request?.stage || "unknown"}`, {
    provider: resolveModelJsonProvider(),
    model: resolvedModelName(),
    system: request?.system || "",
    user: request?.user || "",
    schemaName: request?.schemaName || "",
    schema: request?.schema || {},
    estimatedOutputTokens: request?.estimatedOutputTokens || null
  }, () => callModelJson(request));
  const progress = [];
  const result = await runImageFlow({
    imagePath,
    sourceUrl,
    includeDetails: true,
    ocr: (path) => record("ocr", { imagePath: path }, () => recognizeImage(path)),
    refineIdentity: (lines, heuristicIdentity) => record("identity", {
      heuristicIdentity,
      ocrLines: lines
    }, () => refineScreenshotIdentity(lines, heuristicIdentity, { modelJsonCaller })),
    searcher: (query, options) => record("search", { query, options }, () => searchLinks(query, options)),
    extract: (input) => record("content_extraction", input, () => extractFocusedSourceContent(input)),
    generate: (input) => record("review_generation", input, () => generateQuickReviewPath(input, {
      modelJsonCaller,
      cacheEnabled: false
    })),
    generateOverview: (input) => record("overview_generation", input, () => generateVideoOverview(input, { modelJsonCaller })),
    onProgress: (event) => progress.push({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - traceStartedAt,
      ...serializable(event)
    })
  });
  return {
    traceVersion: "image-flow-trace-v1",
    imagePath,
    startedAt: new Date(traceStartedAt).toISOString(),
    endedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - traceStartedAt,
    configuration: {
      ocrProvider: process.env.OCR_PROVIDER || (process.platform === "darwin" ? "apple-vision" : "paddle"),
      asrMode: process.env.VIDEO_ASR_MODE || "full",
      modelProvider: resolveModelJsonProvider(),
      model: resolvedModelName(),
      tikhubConfigured: Boolean(process.env.TIKHUB_API_KEY),
      modelApiConfigured: Boolean(process.env.QWEN_API || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY),
      baseUrl: process.env.BASE_URL || process.env.AI_BASE_URL || "provider-default",
      apiKeysRedacted: true
    },
    progress,
    timeline,
    result
  };
}

function resolvedModelName() {
  const provider = resolveModelJsonProvider();
  if (provider === "deepseek") return process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  if (provider === "openai") return process.env.OPENAI_MODEL || "gpt-4.1-mini";
  return process.env.AI_MODEL || process.env.QWEN_MODEL || process.env.MODEL || "qwen-flash";
}

function serializable(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (typeof item === "function") return `[function ${item.name || "anonymous"}]`;
    if (/api[_-]?key|authorization/i.test(key)) return item ? "[REDACTED]" : item;
    return item;
  }));
}
