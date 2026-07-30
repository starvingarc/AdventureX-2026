import { Pool } from "pg";

import { getMigrationStatus } from "./migrations.js";
import {
  applyAssessment,
  toPublicCard,
  validateAssessmentInput
} from "./store.js";

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

function storageError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}
