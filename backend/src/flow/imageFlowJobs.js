import { randomUUID } from "node:crypto";

const jobs = new Map();
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function createImageFlowJob(operation, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  purgeImageFlowJobs(now);
  const id = randomUUID();
  const job = {
    id,
    status: "running",
    progress: { stage: "queued", message: "任务已创建", percent: 0 },
    logs: [],
    result: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlMs
  };
  jobs.set(id, job);
  queueMicrotask(async () => {
    const update = (progress) => {
      const updatedAt = Date.now();
      job.progress = { ...job.progress, ...progress };
      job.updatedAt = updatedAt;
      const log = {
        at: new Date(updatedAt).toISOString(),
        elapsedMs: updatedAt - job.createdAt,
        stage: String(progress?.stage || job.progress.stage || "unknown"),
        event: String(progress?.event || "progress"),
        message: String(progress?.message || job.progress.message || ""),
        ...(Number.isFinite(Number(progress?.durationMs)) ? { durationMs: Number(progress.durationMs) } : {}),
        ...(progress?.details && typeof progress.details === "object" ? { details: progress.details } : {})
      };
      const previousLog = job.logs.at(-1);
      if (previousLog?.stage === log.stage && previousLog?.event === log.event && previousLog?.message === log.message) return;
      job.logs.push(log);
      if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
      const duration = log.durationMs === undefined ? "" : ` duration=${log.durationMs}ms`;
      console.info(`[image-flow:${id}] ${log.stage}/${log.event} elapsed=${log.elapsedMs}ms${duration} ${log.message}`);
    };
    try {
      const result = await operation(update);
      job.result = result;
      job.status = result?.status === "completed" ? "succeeded" : "failed";
      update(job.status === "succeeded"
        ? { stage: "completed", message: "复习卡已生成", percent: 100 }
        : { stage: "failed", message: result?.error?.message || result?.message || "内容处理失败", percent: 100 });
    } catch (error) {
      job.status = "failed";
      job.result = {
        status: "failed",
        error: { code: error?.code || "image_flow_failed", message: error?.message || "截图处理失败。" }
      };
      update({ stage: "failed", message: job.result.error.message, percent: 100 });
    }
  });
  return serializeImageFlowJob(job);
}

export function getImageFlowJob(id, { now = Date.now() } = {}) {
  purgeImageFlowJobs(now);
  const job = jobs.get(String(id || ""));
  return job ? serializeImageFlowJob(job) : null;
}

export function purgeImageFlowJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.expiresAt <= now) jobs.delete(id);
  }
}

function serializeImageFlowJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    progress: { ...job.progress },
    logs: job.logs.map((log) => ({ ...log, ...(log.details ? { details: { ...log.details } } : {}) })),
    ...(job.result ? { result: job.result } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
