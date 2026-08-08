import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";

import { getMigrationStatus } from "./migrations.js";
import {
  applyAssessment,
  toPublicCard,
  validateAssessmentInput
} from "./store.js";

const screenshotLeaseMilliseconds = 5 * 60 * 1000;

export function createPostgresPool(databaseConfig) {
  const pool = new Pool({
    connectionString: databaseConfig.connectionString,
    max: databaseConfig.poolMax,
    connectionTimeoutMillis: databaseConfig.connectTimeoutMs,
    idleTimeoutMillis: databaseConfig.idleTimeoutMs,
    application_name: "omo-api"
  });
  pool.on("error", () => {
    // Readiness and the next operation surface a sanitized storage error.
  });
  return pool;
}

export class PostgresCardStore {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.migrationsDirectory = options.migrationsDirectory;
  }

  async list(owner) {
    validateIdentifier(owner, "owner");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `SELECT card
         FROM omo_memory_cards
         WHERE owner_id = $1
         ORDER BY created_at DESC, card_id`,
        [owner]
      );
      return result.rows.map((row) => toPublicCard(row.card));
    });
  }

  async get(owner, cardId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(cardId, "card");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `SELECT card
         FROM omo_memory_cards
         WHERE owner_id = $1 AND card_id = $2`,
        [owner, cardId]
      );
      return result.rows[0] ? toPublicCard(result.rows[0].card) : null;
    });
  }

  async save(owner, card) {
    validateIdentifier(owner, "owner");
    validateIdentifier(card?.id, "card");
    const createdAt = timestamp(card.createdAt, "card_created_at_invalid");
    const nextReviewAt = timestamp(card.nextReviewAt, "card_review_at_invalid");

    return storageOperation(() => withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO omo_owners (owner_id, owner_kind)
         VALUES ($1, 'device')
         ON CONFLICT (owner_id) DO NOTHING`,
        [owner]
      );
      const inserted = await client.query(
        `INSERT INTO omo_memory_cards (
           owner_id, card_id, card, created_at, next_review_at
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_id, card_id) DO NOTHING
         RETURNING card`,
        [owner, card.id, card, createdAt, nextReviewAt]
      );
      if (inserted.rows[0]) return toPublicCard(inserted.rows[0].card);

      const canonical = await client.query(
        `SELECT card
         FROM omo_memory_cards
         WHERE owner_id = $1 AND card_id = $2`,
        [owner, card.id]
      );
      if (!canonical.rows[0]) {
        throw storageError(503, "storage_write_conflict", "记忆卡写入发生冲突。");
      }
      return toPublicCard(canonical.rows[0].card);
    }));
  }

  async assess(owner, cardId, assessment, attemptId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(cardId, "card");
    validateIdentifier(attemptId, "attempt");
    validateAssessmentInput(assessment, attemptId);

    return storageOperation(() => withTransaction(this.pool, async (client) => {
      const selected = await client.query(
        `SELECT card, version
         FROM omo_memory_cards
         WHERE owner_id = $1 AND card_id = $2
         FOR UPDATE`,
        [owner, cardId]
      );
      if (!selected.rows[0]) return null;

      const attempt = await client.query(
        `INSERT INTO omo_assessment_attempts (
           owner_id, card_id, attempt_id, assessment
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, card_id, attempt_id) DO NOTHING
         RETURNING attempt_id`,
        [owner, cardId, attemptId, assessment]
      );
      if (!attempt.rows[0]) return toPublicCard(selected.rows[0].card);

      const card = structuredClone(selected.rows[0].card);
      applyAssessment(card, assessment, attemptId);
      const updated = await client.query(
        `UPDATE omo_memory_cards
         SET card = $1,
             next_review_at = $2,
             updated_at = NOW(),
             version = version + 1
         WHERE owner_id = $3
           AND card_id = $4
           AND version = $5
         RETURNING card`,
        [card, timestamp(card.nextReviewAt), owner, cardId, selected.rows[0].version]
      );
      if (!updated.rows[0]) {
        throw storageError(409, "storage_write_conflict", "记忆卡状态已被并发修改。");
      }
      return toPublicCard(updated.rows[0].card);
    }));
  }

  async delete(owner, cardId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(cardId, "card");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `DELETE FROM omo_memory_cards
         WHERE owner_id = $1 AND card_id = $2
         RETURNING card_id`,
        [owner, cardId]
      );
      return Boolean(result.rows[0]);
    });
  }

  async enqueueScreenshotJob(owner, { imageBase64, mimeType = "image/jpeg" } = {}) {
    validateIdentifier(owner, "owner");
    validateScreenshotInput(imageBase64);
    const fingerprint = screenshotFingerprint(imageBase64);
    const jobId = `job-${fingerprint.slice(0, 20)}`;

    return storageOperation(() => withTransaction(this.pool, async (client) => {
      await ensureOwner(client, owner);
      const result = await client.query(
        `INSERT INTO omo_screenshot_jobs (
           owner_id, job_id, fingerprint, state, image_base64, mime_type
         )
         VALUES ($1, $2, $3, 'accepted', $4, $5)
         ON CONFLICT (owner_id, fingerprint) DO UPDATE
         SET updated_at = omo_screenshot_jobs.updated_at
         RETURNING *`,
        [owner, jobId, fingerprint, imageBase64, mimeType]
      );
      return toPublicScreenshotJobRow(result.rows[0]);
    }));
  }

  async listScreenshotJobs(owner) {
    validateIdentifier(owner, "owner");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `SELECT *
         FROM omo_screenshot_jobs
         WHERE owner_id = $1
         ORDER BY created_at DESC, job_id`,
        [owner]
      );
      return result.rows.map(toPublicScreenshotJobRow);
    });
  }

  async getScreenshotJob(owner, jobId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `SELECT *
         FROM omo_screenshot_jobs
         WHERE owner_id = $1 AND job_id = $2`,
        [owner, jobId]
      );
      return result.rows[0] ? toPublicScreenshotJobRow(result.rows[0]) : null;
    });
  }

  async claimScreenshotJob(owner, jobId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    return storageOperation(async () => {
      const attemptToken = randomUUID();
      const leaseExpiresAt = new Date(Date.now() + screenshotLeaseMilliseconds).toISOString();
      const result = await this.pool.query(
        `UPDATE omo_screenshot_jobs
         SET state = 'processing',
             attempt_count = attempt_count + 1,
             attempt_token = $3,
             lease_expires_at = $4,
             updated_at = NOW()
         WHERE owner_id = $1
           AND job_id = $2
           AND state = 'accepted'
           AND image_base64 IS NOT NULL
         RETURNING *`,
        [owner, jobId, attemptToken, leaseExpiresAt]
      );
      return result.rows[0] ? toInternalScreenshotJobRow(result.rows[0]) : null;
    });
  }

  async renewScreenshotJobLease(owner, jobId, attemptToken) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    validateIdentifier(attemptToken, "attempt");
    const leaseExpiresAt = new Date(Date.now() + screenshotLeaseMilliseconds).toISOString();
    return storageOperation(async () => {
      const result = await this.pool.query(
        `UPDATE omo_screenshot_jobs
         SET lease_expires_at = $4, updated_at = NOW()
         WHERE owner_id = $1 AND job_id = $2
           AND state = 'processing' AND attempt_token = $3
         RETURNING job_id`,
        [owner, jobId, attemptToken, leaseExpiresAt]
      );
      return Boolean(result.rows[0]);
    });
  }

  async succeedScreenshotJob(owner, jobId, attemptToken, cardId) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    validateIdentifier(cardId, "card");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `UPDATE omo_screenshot_jobs
         SET state = 'succeeded',
             card_id = $4,
             image_base64 = NULL,
             attempt_token = NULL,
             lease_expires_at = NULL,
             error_code = '',
             error_message = '',
             retryable = FALSE,
             updated_at = NOW()
         WHERE owner_id = $1 AND job_id = $2
           AND state = 'processing' AND attempt_token = $3
         RETURNING *`,
        [owner, jobId, attemptToken, cardId]
      );
      return result.rows[0] ? toPublicScreenshotJobRow(result.rows[0]) : null;
    });
  }

  async failScreenshotJob(owner, jobId, attemptToken, { code, message, retryable = true }) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    return storageOperation(async () => {
      const result = await this.pool.query(
        `UPDATE omo_screenshot_jobs
         SET state = 'failed',
             image_base64 = NULL,
             attempt_token = NULL,
             lease_expires_at = NULL,
             error_code = $4,
             error_message = $5,
             retryable = $6,
             updated_at = NOW()
         WHERE owner_id = $1 AND job_id = $2
           AND state = 'processing' AND attempt_token = $3
         RETURNING *`,
        [
          owner,
          jobId,
          attemptToken,
          String(code || "processing_failed"),
          String(message),
          Boolean(retryable)
        ]
      );
      return result.rows[0] ? toPublicScreenshotJobRow(result.rows[0]) : null;
    });
  }

  async retryScreenshotJob(owner, jobId, { imageBase64, mimeType = "image/jpeg" } = {}) {
    validateIdentifier(owner, "owner");
    validateIdentifier(jobId, "job");
    validateScreenshotInput(imageBase64);
    const fingerprint = screenshotFingerprint(imageBase64);
    return storageOperation(() => withTransaction(this.pool, async (client) => {
      const selected = await client.query(
        `SELECT * FROM omo_screenshot_jobs
         WHERE owner_id = $1 AND job_id = $2
         FOR UPDATE`,
        [owner, jobId]
      );
      if (!selected.rows[0]) return null;
      if (selected.rows[0].fingerprint !== fingerprint) {
        throw storageError(409, "screenshot_job_image_mismatch", "重试截图与原任务不一致。");
      }
      if (selected.rows[0].state === "succeeded") {
        return toPublicScreenshotJobRow(selected.rows[0]);
      }
      if (selected.rows[0].state === "processing") {
        return toPublicScreenshotJobRow(selected.rows[0]);
      }
      const result = await client.query(
        `UPDATE omo_screenshot_jobs
         SET state = 'accepted',
             image_base64 = $3,
             mime_type = $4,
             error_code = '',
             error_message = '',
             retryable = FALSE,
             attempt_token = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
         WHERE owner_id = $1 AND job_id = $2
         RETURNING *`,
        [owner, jobId, imageBase64, mimeType]
      );
      return toPublicScreenshotJobRow(result.rows[0]);
    }));
  }

  async recoverScreenshotJobs() {
    return storageOperation(async () => {
      const result = await this.pool.query(
        `UPDATE omo_screenshot_jobs
         SET state = 'accepted',
             attempt_token = NULL,
             lease_expires_at = NULL,
             updated_at = NOW()
         WHERE state = 'processing'
           AND image_base64 IS NOT NULL
           AND lease_expires_at <= NOW()
         RETURNING *`
      );
      const accepted = await this.pool.query(
        `SELECT * FROM omo_screenshot_jobs
         WHERE state = 'accepted' AND image_base64 IS NOT NULL
         ORDER BY created_at, job_id`
      );
      const rows = new Map();
      for (const row of [...result.rows, ...accepted.rows]) {
        rows.set(`${row.owner_id}:${row.job_id}`, row);
      }
      return [...rows.values()].map((row) => ({
        owner: row.owner_id,
        ...toPublicScreenshotJobRow(row)
      }));
    });
  }

  async readiness() {
    return getMigrationStatus(this.pool, {
      ...(this.migrationsDirectory
        ? { migrationsDirectory: this.migrationsDirectory }
        : {})
    });
  }

  async close() {
    await this.pool.end();
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function ensureOwner(client, owner) {
  await client.query(
    `INSERT INTO omo_owners (owner_id, owner_kind)
     VALUES ($1, 'device')
     ON CONFLICT (owner_id) DO NOTHING`,
    [owner]
  );
}

async function storageOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.expose) throw error;
    throw storageError(503, "storage_unavailable", "记忆卡存储暂时不可用。");
  }
}

function validateIdentifier(value, kind) {
  const normalized = String(value || "");
  if (!normalized || normalized.length > 200) {
    throw storageError(422, `${kind}_id_invalid`, `${kind} 标识无效。`);
  }
}

function timestamp(value, code = "card_timestamp_invalid") {
  const milliseconds = Date.parse(String(value || ""));
  if (!Number.isFinite(milliseconds)) {
    throw storageError(422, code, "记忆卡时间字段无效。");
  }
  return new Date(milliseconds).toISOString();
}

function screenshotFingerprint(imageBase64) {
  return createHash("sha256").update(imageBase64).digest("hex");
}

function validateScreenshotInput(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw storageError(400, "image_required", "请先选择一张截图。");
  }
}

function toInternalScreenshotJobRow(row) {
  return {
    ...toPublicScreenshotJobRow(row),
    attemptToken: row.attempt_token,
    leaseExpiresAt: isoTimestamp(row.lease_expires_at),
    imageBase64: row.image_base64,
    mimeType: row.mime_type
  };
}

function toPublicScreenshotJobRow(row) {
  return {
    id: row.job_id,
    state: row.state,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    attemptCount: Number(row.attempt_count || 0),
    cardId: row.card_id || "",
    errorCode: row.error_code || "",
    errorMessage: row.error_message || "",
    retryable: Boolean(row.retryable)
  };
}

function isoTimestamp(value) {
  return value instanceof Date ? value.toISOString() : String(value || "");
}

function storageError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}
