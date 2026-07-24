import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMediaExtractionError } from "./mediaErrors.js";
import { normalizeTranscriptionPayload } from "./transcriptionResult.js";
import { VIDEO_DEFAULTS } from "./videoDefaults.js";

const DEFAULT_TIMEOUT_MS = readPositiveInt(process.env.VIDEO_ASR_TIMEOUT_MS, 600_000);
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT_PATH = resolve(CURRENT_DIR, "../../scripts/transcribe-local-whisper.py");
const DEFAULT_WORKER_SCRIPT_PATH = resolve(CURRENT_DIR, "../../scripts/transcribe-local-whisper-worker.py");
let activeLocalWhisperProcesses = 0;
const localWhisperWaiters = [];
const persistentWorkers = [];
const persistentWaiters = [];

export async function transcribeAudioWithLocalWhisper({
  audioPath,
  pythonPath = process.env.LOCAL_WHISPER_PYTHON || process.env.PYTHON_PATH || "python3",
  scriptPath = process.env.LOCAL_WHISPER_SCRIPT || DEFAULT_SCRIPT_PATH,
  model = process.env.LOCAL_WHISPER_MODEL || VIDEO_DEFAULTS.localWhisperModel,
  device = process.env.LOCAL_WHISPER_DEVICE || VIDEO_DEFAULTS.localWhisperDevice,
  computeType = process.env.LOCAL_WHISPER_COMPUTE_TYPE || VIDEO_DEFAULTS.localWhisperComputeType,
  language = process.env.LOCAL_WHISPER_LANGUAGE || VIDEO_DEFAULTS.localWhisperLanguage,
  initialPrompt = "",
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

  const config = {
    audio: pathForCli(audioPath),
    model,
    device,
    compute_type: computeType,
    language,
    initial_prompt: String(initialPrompt || "").slice(0, 500),
    beam_size: beamSize,
    cpu_threads: cpuThreads
  };
  if (spawnImpl === spawn && readBooleanFlag(process.env.LOCAL_WHISPER_PERSISTENT_ENABLED, true)) {
    const result = await runPersistentTranscription({ pythonPath, config, timeoutMs });
    return normalizeTranscriptionPayload(result, { provider: "local_whisper:persistent" });
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
  if (initialPrompt) args.push("--initial-prompt", String(initialPrompt).slice(0, 500));

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

export async function warmLocalWhisperPool({
  pythonPath = process.env.LOCAL_WHISPER_PYTHON || process.env.PYTHON_PATH || "python3",
  model = process.env.LOCAL_WHISPER_MODEL || VIDEO_DEFAULTS.localWhisperModel,
  device = process.env.LOCAL_WHISPER_DEVICE || VIDEO_DEFAULTS.localWhisperDevice,
  computeType = process.env.LOCAL_WHISPER_COMPUTE_TYPE || VIDEO_DEFAULTS.localWhisperComputeType,
  cpuThreads = readPositiveInt(process.env.LOCAL_WHISPER_CPU_THREADS, 2)
} = {}) {
  if (!readBooleanFlag(process.env.LOCAL_WHISPER_PERSISTENT_ENABLED, true)) return false;
  const workerCount = Math.min(
    persistentWorkerLimit(cpuThreads),
    readPositiveInt(process.env.LOCAL_WHISPER_PREWARM_WORKERS, persistentWorkerLimit(cpuThreads))
  );
  await Promise.all(Array.from({ length: workerCount }, () => runPersistentTranscription({
      pythonPath,
      timeoutMs: readPositiveInt(process.env.LOCAL_WHISPER_WARM_TIMEOUT_MS, 120_000),
      config: { action: "warm", model, device, compute_type: computeType, cpu_threads: cpuThreads }
    })));
  return true;
}

export async function shutdownLocalWhisperPool() {
  const workers = persistentWorkers.splice(0);
  persistentWaiters.splice(0).forEach((resolveWorker) => resolveWorker(null));
  await Promise.all(workers.map((worker) => new Promise((resolveClose) => {
    if (worker.dead) return resolveClose();
    worker.dead = true;
    worker.child.once("close", resolveClose);
    worker.child.kill("SIGTERM");
    setTimeout(() => {
      worker.child.kill("SIGKILL");
      resolveClose();
    }, 1_000).unref();
  })));
}

async function runPersistentTranscription({ pythonPath, config, timeoutMs }) {
  const worker = await acquirePersistentWorker({ pythonPath, cpuThreads: config.cpu_threads });
  try {
    return await requestWorker(worker, config, timeoutMs);
  } finally {
    releasePersistentWorker(worker);
  }
}

async function acquirePersistentWorker({ pythonPath, cpuThreads }) {
  const idle = persistentWorkers.find((worker) => !worker.busy && !worker.dead);
  if (idle) {
    idle.busy = true;
    return idle;
  }
  const limit = persistentWorkerLimit(cpuThreads);
  if (persistentWorkers.filter((worker) => !worker.dead).length < limit) {
    const worker = createPersistentWorker({ pythonPath, cpuThreads });
    worker.busy = true;
    persistentWorkers.push(worker);
    return worker;
  }
  return new Promise((resolveWorker) => persistentWaiters.push(resolveWorker));
}

function persistentWorkerLimit(cpuThreads) {
  const explicit = Number(process.env.LOCAL_WHISPER_MAX_PROCESSES);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return Math.max(1, Math.min(8, Math.floor(availableParallelism() / Math.max(1, Number(cpuThreads) || 2))));
}

function releasePersistentWorker(worker) {
  if (worker.dead) {
    const index = persistentWorkers.indexOf(worker);
    if (index >= 0) persistentWorkers.splice(index, 1);
  } else {
    worker.busy = false;
  }
  const next = persistentWaiters.shift();
  if (!next) return;
  acquirePersistentWorker({
    pythonPath: worker.pythonPath,
    cpuThreads: worker.cpuThreads
  }).then(next);
}

function createPersistentWorker({ pythonPath, cpuThreads }) {
  const child = spawn(pythonPath, [process.env.LOCAL_WHISPER_WORKER_SCRIPT || DEFAULT_WORKER_SCRIPT_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: boundedThreadEnv(cpuThreads)
  });
  const worker = {
    child,
    pythonPath,
    cpuThreads,
    busy: false,
    dead: false,
    buffer: "",
    stderr: "",
    pending: new Map()
  };
  child.stdout.on("data", (chunk) => {
    worker.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = worker.buffer.indexOf("\n")) >= 0) {
      const line = worker.buffer.slice(0, newline).trim();
      worker.buffer = worker.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = worker.pending.get(message.id);
      if (!pending) continue;
      worker.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(classifyLocalWhisperFailure(new Error(message.error), message.error));
      else pending.resolve(message.result || {});
    }
  });
  child.stderr.on("data", (chunk) => { worker.stderr = `${worker.stderr}${chunk}`.slice(-8000); });
  const failWorker = (error) => {
    worker.dead = true;
    for (const pending of worker.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(classifyLocalWhisperFailure(error, worker.stderr));
    }
    worker.pending.clear();
  };
  child.on("error", failWorker);
  child.on("close", (code) => failWorker(new Error(`persistent whisper worker exited with ${code}`)));
  return worker;
}

function requestWorker(worker, config, timeoutMs) {
  return new Promise((resolveRequest, rejectRequest) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      worker.pending.delete(id);
      worker.dead = true;
      worker.child.kill("SIGKILL");
      rejectRequest(createMediaExtractionError("asr_timeout", "视频语音转写超时，请稍后重试。", {
        retryable: true,
        provider: "local_whisper"
      }));
    }, timeoutMs);
    worker.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });
    worker.child.stdin.write(`${JSON.stringify({ id, ...config })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timeout);
      worker.pending.delete(id);
      rejectRequest(classifyLocalWhisperFailure(error, worker.stderr));
    });
  });
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
      env: boundedThreadEnv(process.env.LOCAL_WHISPER_CPU_THREADS || 2)
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

function boundedThreadEnv(cpuThreads) {
  const threads = String(cpuThreads || 2);
  return {
    ...process.env,
    OMP_NUM_THREADS: threads,
    MKL_NUM_THREADS: threads,
    OPENBLAS_NUM_THREADS: threads,
    VECLIB_MAXIMUM_THREADS: threads
  };
}

function readBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
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
