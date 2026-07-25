import { randomUUID } from "node:crypto";

const jobs = new Map();
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function createImageFlowJob(operation, {
  ownerId,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  purgeImageFlowJobs(now);
  const id = randomUUID();
  const job = {
    id,
    ownerId: normalizedOwnerId,
    status: "running",
    progress: { stage: "queued", message: "任务已创建", percent: 0 },
    result: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlMs
  };
  jobs.set(id, job);
  queueMicrotask(async () => {
    const update = (progress) => {
      job.progress = { ...job.progress, ...progress };
      job.updatedAt = Date.now();
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

export function getImageFlowJob(id, { ownerId, now = Date.now() } = {}) {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  purgeImageFlowJobs(now);
  const job = jobs.get(String(id || ""));
  return job?.ownerId === normalizedOwnerId ? serializeImageFlowJob(job) : null;
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
    ...(job.result ? { result: job.result } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function normalizeOwnerId(value) {
  const ownerId = String(value || "").trim();
  if (!ownerId) throw new Error("image flow job requires an owner id");
  return ownerId;
}
