import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMediaExtractionError } from "./mediaErrors.js";
import { normalizeTranscriptionPayload } from "./transcriptionResult.js";
import { VIDEO_DEFAULTS } from "./videoDefaults.js";

const DEFAULT_TIMEOUT_MS = readPositiveInt(process.env.VIDEO_ASR_TIMEOUT_MS, 600_000);
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT_PATH = resolve(CURRENT_DIR, "../../scripts/transcribe-local-whisper.py");
let activeLocalWhisperProcesses = 0;
const localWhisperWaiters = [];

export async function transcribeAudioWithLocalWhisper({
  audioPath,
  pythonPath = process.env.LOCAL_WHISPER_PYTHON || process.env.PYTHON_PATH || "python3",
  scriptPath = process.env.LOCAL_WHISPER_SCRIPT || DEFAULT_SCRIPT_PATH,
  model = process.env.LOCAL_WHISPER_MODEL || VIDEO_DEFAULTS.localWhisperModel,
  device = process.env.LOCAL_WHISPER_DEVICE || VIDEO_DEFAULTS.localWhisperDevice,
  computeType = process.env.LOCAL_WHISPER_COMPUTE_TYPE || VIDEO_DEFAULTS.localWhisperComputeType,
  language = process.env.LOCAL_WHISPER_LANGUAGE || VIDEO_DEFAULTS.localWhisperLanguage,
  beamSize = readPositiveInt(process.env.LOCAL_WHISPER_BEAM_SIZE, 1),
  cpuThreads = readPositiveInt(process.env.LOCAL_WHISPER_CPU_THREADS, 2),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn
} = {}) {
  if (!audioPath) {
    throw createMediaExtractionError("asr_config_missing", "语音转写缺少音频文件路径。", {
      retryable: false,
      provider: "local_whisper"
    });
  }

  const args = [
    scriptPath,
    "--audio", pathForCli(audioPath),
    "--model", model,
    "--device", device,
    "--compute-type", computeType,
    "--language", language,
    "--beam-size", String(beamSize),
    "--cpu-threads", String(cpuThreads)
  ];

  // Bound both process count and per-process threads. This permits useful
  // parallelism without CTranslate2 workers oversubscribing every CPU core.
  const result = await runLocalWhisperLimited(() => runTranscriptionCommand({
    pythonPath,
    args,
    timeoutMs,
    spawnImpl
  }));

  return normalizeTranscriptionPayload(result, { provider: "local_whisper" });
}

async function runLocalWhisperLimited(operation) {
  const limit = readPositiveInt(process.env.LOCAL_WHISPER_MAX_PROCESSES, 2);
  if (activeLocalWhisperProcesses >= limit) {
    await new Promise((resolve) => localWhisperWaiters.push(resolve));
  } else {
    activeLocalWhisperProcesses += 1;
  }
  try {
    return await operation();
  } finally {
    const next = localWhisperWaiters.shift();
    if (next) next();
    else activeLocalWhisperProcesses -= 1;
  }
}

function runTranscriptionCommand({
  pythonPath,
  args,
  timeoutMs,
  spawnImpl
}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawnImpl(pythonPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        OMP_NUM_THREADS: String(process.env.LOCAL_WHISPER_CPU_THREADS || 2),
        MKL_NUM_THREADS: String(process.env.LOCAL_WHISPER_CPU_THREADS || 2),
        OPENBLAS_NUM_THREADS: String(process.env.LOCAL_WHISPER_CPU_THREADS || 2),
        VECLIB_MAXIMUM_THREADS: String(process.env.LOCAL_WHISPER_CPU_THREADS || 2)
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill?.("SIGKILL");
      rejectCommand(createMediaExtractionError("asr_timeout", "视频语音转写超时，请稍后重试。", {
        retryable: true,
        provider: "local_whisper"
      }));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectCommand(classifyLocalWhisperFailure(error, stderr));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        rejectCommand(classifyLocalWhisperFailure(null, stderr, code));
        return;
      }
      try {
        resolveCommand(JSON.parse(stdout));
      } catch (error) {
        rejectCommand(createMediaExtractionError("asr_unavailable", "视频语音转写暂时失败，请稍后重试。", {
          retryable: true,
          provider: "local_whisper",
          cause: error
        }));
      }
    });
  });
}

function classifyLocalWhisperFailure(error, stderr = "", code = null) {
  const message = String(stderr || error?.message || "");
  const missingRuntime = error?.code === "ENOENT"
    || /ModuleNotFoundError|No module named ['"]?faster_whisper|faster-whisper/i.test(message);
  if (missingRuntime) {
    return createMediaExtractionError("asr_config_missing", "本地语音转写环境暂未配置，请安装 faster-whisper 后重试。", {
      retryable: false,
      provider: "local_whisper",
      cause: error || null,
      status: code
    });
  }
  return createMediaExtractionError("asr_unavailable", "视频语音转写暂时失败，请稍后重试。", {
    retryable: true,
    provider: "local_whisper",
    cause: error || null,
    status: code
  });
}

function pathForCli(audioPath) {
  return audioPath instanceof URL ? fileURLToPath(audioPath) : String(audioPath || "");
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
