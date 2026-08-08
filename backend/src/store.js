import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

const intervals = [0, 1, 3, 7, 14, 30];
const mastery = ["sealed", "awakened", "solidified", "engraved"];
const assessments = new Set(["remembered", "fuzzy", "forgot"]);
const screenshotLeaseMilliseconds = 5 * 60 * 1000;

export class CardStore {
  constructor(filePath = process.env.CARD_STORE_PATH || resolve(".runtime/cards.json")) {
    this.filePath = filePath;
    const stored = load(filePath);
    this.cards = stored.cards;
    this.screenshotJobs = stored.screenshotJobs;
  }

  list(owner) {
    return [...this.cards.values()]
      .filter((entry) => entry.owner === owner)
      .sort((a, b) => b.card.createdAt.localeCompare(a.card.createdAt))
      .map((entry) => toPublicCard(entry.card));
  }

  get(owner, cardId) {
    const entry = this.cards.get(key(owner, cardId));
    return entry ? toPublicCard(entry.card) : null;
  }

  save(owner, card) {
    const cardKey = key(owner, card.id);
    const previous = this.cards.get(cardKey);
    this.cards.set(cardKey, { owner, card: structuredClone(card) });
    try {
      this.persist();
    } catch (error) {
      if (previous) this.cards.set(cardKey, previous);
      else this.cards.delete(cardKey);
      throw error;
    }
    return toPublicCard(card);
  }

  assess(owner, cardId, assessment, attemptId) {
    validateAssessmentInput(assessment, attemptId);
    const entry = this.cards.get(key(owner, cardId));
    if (!entry) return null;
    const card = entry.card;
    const previous = structuredClone(card);
    const applied = applyAssessment(card, assessment, attemptId);
    if (!applied) return toPublicCard(card);
    try {
      this.persist();
    } catch (error) {
      entry.card = previous;
      throw error;
    }
    return toPublicCard(card);
  }

  delete(owner, cardId) {
    const cardKey = key(owner, cardId);
    const previous = this.cards.get(cardKey);
    if (!previous) return false;
    this.cards.delete(cardKey);
    try {
      this.persist();
    } catch (error) {
      this.cards.set(cardKey, previous);
      throw error;
    }
    return true;
  }

  enqueueScreenshotJob(owner, { imageBase64, mimeType = "image/jpeg" } = {}) {
    validateScreenshotInput(imageBase64);
    const fingerprint = screenshotFingerprint(imageBase64);
    const id = `job-${fingerprint.slice(0, 20)}`;
    const jobKey = key(owner, id);
    const existing = this.screenshotJobs.get(jobKey);
    if (existing) return toPublicScreenshotJob(existing.job);

    const now = new Date().toISOString();
    const entry = {
      owner,
      imageBase64,
      mimeType,
      job: {
        id,
        fingerprint,
        state: "accepted",
        createdAt: now,
        updatedAt: now,
        attemptCount: 0,
        cardId: "",
        errorCode: "",
        errorMessage: "",
        retryable: false,
        attemptToken: "",
        leaseExpiresAt: ""
      }
    };
    this.screenshotJobs.set(jobKey, entry);
    try {
      this.persist();
    } catch (error) {
      this.screenshotJobs.delete(jobKey);
      throw error;
    }
    return toPublicScreenshotJob(entry.job);
  }

  listScreenshotJobs(owner) {
    return [...this.screenshotJobs.values()]
      .filter((entry) => entry.owner === owner)
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .map((entry) => toPublicScreenshotJob(entry.job));
  }

  getScreenshotJob(owner, jobId) {
    const entry = this.screenshotJobs.get(key(owner, jobId));
    return entry ? toPublicScreenshotJob(entry.job) : null;
  }

  claimScreenshotJob(owner, jobId) {
    const entry = this.screenshotJobs.get(key(owner, jobId));
    if (!entry || entry.job.state !== "accepted" || !entry.imageBase64) return null;
    entry.job.state = "processing";
    entry.job.attemptCount += 1;
    entry.job.updatedAt = new Date().toISOString();
    entry.job.attemptToken = randomUUID();
    entry.job.leaseExpiresAt = new Date(
      Date.now() + screenshotLeaseMilliseconds
    ).toISOString();
    this.persist();
    return structuredClone({
      ...entry.job,
      imageBase64: entry.imageBase64,
      mimeType: entry.mimeType
    });
  }

  renewScreenshotJobLease(owner, jobId, attemptToken, now = new Date()) {
    const entry = this.screenshotJobs.get(key(owner, jobId));
    if (!entry
      || entry.job.state !== "processing"
      || entry.job.attemptToken !== attemptToken) return false;
    entry.job.leaseExpiresAt = new Date(
      now.getTime() + screenshotLeaseMilliseconds
    ).toISOString();
    entry.job.updatedAt = now.toISOString();
    this.persist();
    return true;
  }

  succeedScreenshotJob(owner, jobId, attemptToken, cardId) {
    const entry = this.screenshotJobs.get(key(owner, jobId));
    if (!entry
      || entry.job.state !== "processing"
      || entry.job.attemptToken !== attemptToken) return null;
    entry.job.state = "succeeded";
    entry.job.cardId = String(cardId || "");
    entry.job.errorCode = "";
    entry.job.errorMessage = "";
    entry.job.retryable = false;
    entry.job.attemptToken = "";
    entry.job.leaseExpiresAt = "";
    entry.job.updatedAt = new Date().toISOString();
    entry.imageBase64 = "";
    this.persist();
    return toPublicScreenshotJob(entry.job);
  }

  failScreenshotJob(owner, jobId, attemptToken, { code, message, retryable = true }) {
    const entry = this.screenshotJobs.get(key(owner, jobId));
    if (!entry
      || entry.job.state !== "processing"
      || entry.job.attemptToken !== attemptToken) return null;
    entry.job.state = "failed";
    entry.job.errorCode = String(code || "processing_failed");
    entry.job.errorMessage = String(message || "截图处理失败，请重试。");
    entry.job.retryable = Boolean(retryable);
    entry.job.attemptToken = "";
    entry.job.leaseExpiresAt = "";
    entry.job.updatedAt = new Date().toISOString();
    entry.imageBase64 = "";
    this.persist();
    return toPublicScreenshotJob(entry.job);
  }

  retryScreenshotJob(owner, jobId, { imageBase64, mimeType = "image/jpeg" } = {}) {
    validateScreenshotInput(imageBase64);
    const entry = this.screenshotJobs.get(key(owner, jobId));
    if (!entry) return null;
    if (entry.job.fingerprint !== screenshotFingerprint(imageBase64)) {
      throw httpError(409, "screenshot_job_image_mismatch", "重试截图与原任务不一致。");
    }
    if (entry.job.state === "succeeded") return toPublicScreenshotJob(entry.job);
    if (entry.job.state === "processing") return toPublicScreenshotJob(entry.job);
    entry.job.state = "accepted";
    entry.job.errorCode = "";
    entry.job.errorMessage = "";
    entry.job.retryable = false;
    entry.job.attemptToken = "";
    entry.job.leaseExpiresAt = "";
    entry.job.updatedAt = new Date().toISOString();
    entry.imageBase64 = imageBase64;
    entry.mimeType = mimeType;
    this.persist();
    return toPublicScreenshotJob(entry.job);
  }

  recoverScreenshotJobs(now = new Date()) {
    let changed = false;
    const recovered = [];
    for (const entry of this.screenshotJobs.values()) {
      if (entry.job.state === "processing"
        && entry.imageBase64
        && (!entry.job.leaseExpiresAt
          || Date.parse(entry.job.leaseExpiresAt) <= now.getTime())) {
        entry.job.state = "accepted";
        entry.job.updatedAt = now.toISOString();
        entry.job.attemptToken = "";
        entry.job.leaseExpiresAt = "";
        changed = true;
      }
      if (entry.job.state === "accepted" && entry.imageBase64) {
        recovered.push({ owner: entry.owner, ...toPublicScreenshotJob(entry.job) });
      }
    }
    if (changed) this.persist();
    return recovered;
  }

  persist() {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify({
        version: 2,
        cards: [...this.cards.values()],
        screenshotJobs: [...this.screenshotJobs.values()]
      }, null, 2));
    } catch {
      throw httpError(503, "storage_unavailable", "记忆卡存储暂时不可用。");
    }
  }

  async readiness({ production = false } = {}) {
    return {
      ready: !production,
      driver: "json",
      durable: false,
      reason: production ? "durable_storage_unavailable" : "",
      appliedVersions: [],
      pendingVersions: []
    };
  }

  async close() {}
}

export function nextMasteryStage(currentStage, assessment) {
  const stage = mastery.includes(currentStage) ? currentStage : "sealed";
  if (assessment === "forgot") return stage;
  if (stage === "sealed") return "awakened";
  if (assessment !== "remembered") return stage;
  return mastery[Math.min(mastery.length - 1, mastery.indexOf(stage) + 1)];
}

export function applyAssessment(card, assessment, attemptId, now = Date.now()) {
  validateAssessmentInput(assessment, attemptId);
  card.attemptIds ||= [];
  if (card.attemptIds.includes(attemptId)) return false;

  card.attemptIds.push(attemptId);
  card.reviewCount = Number(card.reviewCount || 0) + 1;
  if (assessment === "remembered") {
    card.successfulRecallCount = Number(card.successfulRecallCount || 0) + 1;
  }
  card.lastAssessment = assessment;
  card.masteryStage = nextMasteryStage(card.masteryStage, assessment);

  const currentStep = Number(card.stepIndex || 0);
  card.stepIndex = assessment === "forgot"
    ? 0
    : assessment === "fuzzy"
      ? Math.max(1, currentStep - 1)
      : Math.min(intervals.length - 1, currentStep + 1);
  card.nextReviewAt = new Date(now + intervals[card.stepIndex] * 86_400_000).toISOString();
  return true;
}

export function validateAssessmentInput(assessment, attemptId) {
  if (!assessments.has(assessment)) {
    throw httpError(422, "assessment_invalid", "反馈只能是记得、模糊或忘记。");
  }
  if (!attemptId) throw httpError(422, "attempt_id_required", "缺少反馈幂等标识。");
}

function load(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { cards: new Map(), screenshotJobs: new Map() };
  }
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8"));
    const cardEntries = Array.isArray(payload) ? payload : payload.cards || [];
    const screenshotJobEntries = Array.isArray(payload) ? [] : payload.screenshotJobs || [];
    return {
      cards: new Map(cardEntries.map((entry) => [key(entry.owner, entry.card.id), entry])),
      screenshotJobs: new Map(screenshotJobEntries.map((entry) => [
        key(entry.owner, entry.job.id),
        entry
      ]))
    };
  } catch {
    return { cards: new Map(), screenshotJobs: new Map() };
  }
}

export function toPublicCard(card) {
  const { attemptIds, stepIndex, ...value } = card;
  return structuredClone(value);
}

export function toPublicScreenshotJob(job) {
  const { fingerprint, attemptToken, leaseExpiresAt, ...value } = job;
  return structuredClone(value);
}

function screenshotFingerprint(imageBase64) {
  return createHash("sha256").update(imageBase64).digest("hex");
}

function validateScreenshotInput(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw httpError(400, "image_required", "请先选择一张截图。");
  }
}

function key(owner, cardId) {
  return `${owner}:${cardId}`;
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}
