import { createHash, randomUUID } from "node:crypto";

import {
  databasePool,
  hasDatabase,
  incrementCapturePersistenceEpochForDevice,
  incrementCapturePersistenceEpochsForAccount
} from "../db.js";
import {
  advanceReviewSchedule,
  createInitialReviewSchedule,
  normalizeReviewSchedule,
  REVIEW_ASSESSMENTS
} from "./reviewSchedule.js";

export const CAPTURE_MEMORY_CARDS_SCHEMA_VERSION = "capture_memory_cards_1";
export const CAPTURE_MEMORY_ASSESSMENT_SCHEMA_VERSION = "capture_memory_assessment_1";
export const CAPTURE_MEMORY_DELETION_SCHEMA_VERSION = "capture_memory_card_deletion_1";
export const CAPTURE_PERSISTENCE_EPOCH_SCHEMA_VERSION = "capture_persistence_epoch_1";
export const CAPTURE_PERSISTENCE_STALE_SCHEMA_VERSION = "capture_persistence_stale_1";
export const MASTERY_STAGES = Object.freeze(["sealed", "awakened", "solidified", "engraved"]);

export class MemoryCaptureRepository {
  durable = false;
  #cardsByDeviceId = new Map();
  #captureIdsByDeviceHash = new Map();
  #persistenceEpochByDeviceId = new Map();

  beginPersistence(deviceId) {
    const ownerId = requiredText(deviceId, "deviceId");
    return serializePersistenceEpoch(
      ownerId,
      this.#currentPersistenceEpoch(ownerId),
      this.durable
    );
  }

  persistCaptureResult(deviceId, result, options = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const expectedEpoch = expectedPersistenceEpoch(options.persistenceEpoch, ownerId);
    const currentEpoch = this.#currentPersistenceEpoch(ownerId);
    if (expectedEpoch !== null && expectedEpoch !== currentEpoch) {
      return serializeStalePersistence(this.durable);
    }
    const normalized = normalizeCapturePersistence(result, options);
    if (!normalized) return null;
    const cards = this.#deviceCards(ownerId);
    const hashKey = `${ownerId}:${normalized.imageSha256}`;
    const previousCaptureId = this.#captureIdsByDeviceHash.get(hashKey);
    const existing = previousCaptureId
      ? [...cards.values()].find((entry) => entry.captureId === previousCaptureId)
      : null;
    if (existing?.state === "formal" && normalized.state !== "formal") {
      return serializeEntry(existing, { durable: this.durable });
    }

    const captureId = existing?.captureId || `capture-${randomUUID()}`;
    const cardId = existing?.memoryCard?.id || (options.preserveCardId
      ? normalized.memoryCard.id
      : stableCardId(captureId, normalized.memoryCard.id));
    const date = normalized.now;
    const memoryCard = {
      ...structuredClone(normalized.memoryCard),
      id: cardId,
      captureId,
      state: normalized.state === "formal" ? "formal" : "fragment",
      sourceStatus: normalized.sourceStatus,
      createdAt: existing?.createdAt || date.toISOString(),
      updatedAt: date.toISOString()
    };
    const entry = {
      captureId,
      imageSha256: normalized.imageSha256,
      disposition: normalized.disposition,
      state: normalized.state,
      sourceStatus: normalized.sourceStatus,
      memoryCard,
      evidence: structuredClone(normalized.evidence),
      sourceBinding: structuredClone(normalized.sourceBinding),
      schedule: normalized.state === "formal"
        ? existing?.schedule || normalized.schedule
        : null,
      masteryStage: existing?.masteryStage || "sealed",
      successfulRecallCount: existing?.successfulRecallCount || 0,
      reviewCount: existing?.reviewCount || 0,
      lastAssessment: existing?.lastAssessment || null,
      attemptsById: existing?.attemptsById || new Map(),
      createdAt: existing?.createdAt || date.toISOString(),
      updatedAt: date.toISOString()
    };
    if (existing && existing.memoryCard.id !== cardId) cards.delete(existing.memoryCard.id);
    cards.set(cardId, entry);
    this.#captureIdsByDeviceHash.set(hashKey, captureId);
    return serializeEntry(entry, { durable: this.durable });
  }

  upsertCaptureAnalysis(deviceId, captureAnalysis, { now = new Date() } = {}) {
    const ids = captureAnalysis?.memoryCard?.sourceEvidenceIds || [];
    return this.persistCaptureResult(deviceId, {
      captureAnalysis,
      memoryCard: captureAnalysis?.memoryCard
    }, {
      now,
      imageSha256: fallbackImageHash(
        deviceId,
        captureAnalysis?.memoryCard?.id,
        captureAnalysis?.disposition,
        captureAnalysis?.decisionReason
      ),
      evidence: ids.map((id) => ({
        id,
        type: "paragraph",
        text: captureAnalysis?.memoryCard?.coreKnowledge || "兼容记忆卡证据"
      })),
      preserveCardId: true
    });
  }

  list(deviceId, options = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const date = normalizeDate(options.now || new Date());
    const entries = [...(this.#cardsByDeviceId.get(ownerId)?.values() || [])]
      .filter((entry) => matchesPool(entry, options.pool, date, options.timeCapsuleDays))
      .sort(compareEntries);
    return {
      schemaVersion: CAPTURE_MEMORY_CARDS_SCHEMA_VERSION,
      durable: this.durable,
      cards: entries.map((entry) => serializeEntry(entry, { durable: this.durable }))
    };
  }

  get(deviceId, cardId) {
    const ownerId = requiredText(deviceId, "deviceId");
    const stableCardId = requiredText(cardId, "cardId");
    const entry = this.#cardsByDeviceId.get(ownerId)?.get(stableCardId);
    return entry ? serializeEntry(entry, { durable: this.durable }) : null;
  }

  recordAssessment(deviceId, cardId, input = {}, { now = new Date() } = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const stableCardId = requiredText(cardId, "cardId");
    const request = normalizeAssessmentRequest(input);
    const entry = this.#cardsByDeviceId.get(ownerId)?.get(stableCardId);
    if (!entry || entry.state !== "formal") return null;
    const previous = entry.attemptsById.get(request.attemptId);
    if (previous) return serializeAssessmentResponse(stableCardId, previous, true);

    const date = normalizeDate(now);
    const masteryBefore = entry.masteryStage;
    const masteryAfter = advanceMastery(masteryBefore, request.assessment);
    const schedule = advanceReviewSchedule(entry.schedule, request.assessment, { now: date });
    const attempt = {
      attemptId: request.attemptId,
      assessment: request.assessment,
      assessedAt: date.toISOString(),
      masteryBefore,
      masteryAfter,
      successfulRecallCount: entry.successfulRecallCount + (request.assessment === "remembered" ? 1 : 0),
      reviewCount: entry.reviewCount + 1,
      schedule
    };
    entry.schedule = schedule;
    entry.masteryStage = masteryAfter;
    entry.successfulRecallCount = attempt.successfulRecallCount;
    entry.reviewCount = attempt.reviewCount;
    entry.lastAssessment = request.assessment;
    entry.updatedAt = date.toISOString();
    entry.attemptsById.set(request.attemptId, attempt);
    return serializeAssessmentResponse(stableCardId, attempt, false);
  }

  deleteCard(deviceId, cardId, { now = new Date() } = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const stableCardId = requiredText(cardId, "cardId");
    const cards = this.#cardsByDeviceId.get(ownerId);
    const entry = cards?.get(stableCardId);
    if (!entry) return null;
    cards.delete(stableCardId);
    this.#captureIdsByDeviceHash.delete(`${ownerId}:${entry.imageSha256}`);
    return serializeDeletion(stableCardId, entry.captureId, normalizeDate(now));
  }

  clearDevice(deviceId) {
    const ownerId = requiredText(deviceId, "deviceId");
    this.#incrementPersistenceEpoch(ownerId);
    const count = this.#cardsByDeviceId.get(ownerId)?.size || 0;
    this.#cardsByDeviceId.delete(ownerId);
    for (const key of this.#captureIdsByDeviceHash.keys()) {
      if (key.startsWith(`${ownerId}:`)) this.#captureIdsByDeviceHash.delete(key);
    }
    return count;
  }

  clear(deviceId) {
    return this.clearDevice(deviceId);
  }

  reset() {
    this.#cardsByDeviceId.clear();
    this.#captureIdsByDeviceHash.clear();
    this.#persistenceEpochByDeviceId.clear();
  }

  #currentPersistenceEpoch(deviceId) {
    if (!this.#persistenceEpochByDeviceId.has(deviceId)) {
      this.#persistenceEpochByDeviceId.set(deviceId, "0");
    }
    return this.#persistenceEpochByDeviceId.get(deviceId);
  }

  #incrementPersistenceEpoch(deviceId) {
    const next = (BigInt(this.#currentPersistenceEpoch(deviceId)) + 1n).toString();
    this.#persistenceEpochByDeviceId.set(deviceId, next);
    return next;
  }

  #deviceCards(deviceId) {
    if (!this.#cardsByDeviceId.has(deviceId)) this.#cardsByDeviceId.set(deviceId, new Map());
    return this.#cardsByDeviceId.get(deviceId);
  }
}

export class PostgresCaptureRepository {
  durable = true;

  constructor(pool = databasePool) {
    if (!pool) throw new Error("PostgresCaptureRepository requires a database pool");
    this.pool = pool;
  }

  async beginPersistence(deviceId) {
    const ownerId = requiredText(deviceId, "deviceId");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureDevice(client, ownerId);
      const epoch = await readPersistenceEpoch(client, ownerId);
      await client.query("COMMIT");
      return serializePersistenceEpoch(ownerId, epoch, this.durable);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async persistCaptureResult(deviceId, result, options = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const normalized = normalizeCapturePersistence(result, options);
    if (!normalized) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureDevice(client, ownerId);
      const currentEpoch = await readPersistenceEpoch(client, ownerId, { lock: true });
      const expectedEpoch = expectedPersistenceEpoch(options.persistenceEpoch, ownerId);
      if (expectedEpoch !== null && expectedEpoch !== currentEpoch) {
        await client.query("ROLLBACK");
        return serializeStalePersistence(this.durable);
      }
      const accountId = await linkedAccountId(client, ownerId);
      const captureId = `capture-${randomUUID()}`;
      const captureResult = await client.query(
        `INSERT INTO captures (
           id, device_id, account_id, image_sha256, disposition, source_status,
           status, shared_url, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (device_id, image_sha256) WHERE deleted_at IS NULL
         DO UPDATE SET
           account_id = COALESCE(captures.account_id, EXCLUDED.account_id),
           disposition = EXCLUDED.disposition,
           source_status = EXCLUDED.source_status,
           status = EXCLUDED.status,
           shared_url = EXCLUDED.shared_url,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          captureId,
          ownerId,
          accountId,
          normalized.imageSha256,
          normalized.disposition,
          normalized.sourceStatus,
          captureStatus(normalized.state),
          normalized.sourceBinding.sourceUrl,
          normalized.now.toISOString()
        ]
      );
      const capture = captureResult.rows[0];
      const existingResult = await client.query(
        `SELECT * FROM memory_cards
          WHERE capture_id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [capture.id]
      );
      const existing = existingResult.rows[0] || null;
      if (existing?.state === "formal" && normalized.state !== "formal") {
        await client.query(
          `UPDATE captures
              SET disposition = 'create_card', status = 'ready', updated_at = $2
            WHERE id = $1`,
          [capture.id, normalized.now.toISOString()]
        );
        await client.query("COMMIT");
        return serializeDatabaseEntry(existing, { durable: this.durable });
      }

      await persistEvidence(client, capture.id, normalized.evidence);
      const bindingId = `binding-${stableDigest(capture.id)}`;
      await client.query(
        `INSERT INTO source_bindings (
           id, capture_id, status, platform, source_url, source_title,
           source_account, confidence, evidence_keys_json, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
         ON CONFLICT (capture_id)
         DO UPDATE SET
           status = EXCLUDED.status,
           platform = EXCLUDED.platform,
           source_url = EXCLUDED.source_url,
           source_title = EXCLUDED.source_title,
           source_account = EXCLUDED.source_account,
           confidence = EXCLUDED.confidence,
           evidence_keys_json = EXCLUDED.evidence_keys_json,
           updated_at = EXCLUDED.updated_at`,
        [
          bindingId,
          capture.id,
          normalized.sourceBinding.status,
          normalized.sourceBinding.platform,
          normalized.sourceBinding.sourceUrl,
          normalized.sourceBinding.sourceTitle,
          normalized.sourceBinding.sourceAccount,
          normalized.sourceBinding.confidence,
          JSON.stringify(normalized.sourceBinding.evidenceKeys),
          normalized.now.toISOString()
        ]
      );

      const cardId = existing?.id || stableCardId(capture.id, normalized.memoryCard.id);
      const createdAt = existing?.created_at || normalized.now.toISOString();
      const cardJson = {
        ...normalized.memoryCard,
        id: cardId,
        captureId: capture.id,
        state: normalized.state === "formal" ? "formal" : "fragment",
        sourceStatus: normalized.sourceStatus,
        createdAt: toIsoString(createdAt),
        updatedAt: normalized.now.toISOString()
      };
      const schedule = normalized.state === "formal"
        ? parseJson(existing?.schedule_json) || normalized.schedule
        : null;
      await client.query(
        `INSERT INTO memory_cards (
           id, capture_id, source_binding_id, device_id, account_id, disposition,
           state, card_json, source_evidence_ids_json, schedule_json,
           mastery_stage, successful_recall_count, review_count, last_assessment,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
           'sealed', 0, 0, NULL, $11, $12
         )
         ON CONFLICT (capture_id)
         DO UPDATE SET
           source_binding_id = EXCLUDED.source_binding_id,
           account_id = COALESCE(memory_cards.account_id, EXCLUDED.account_id),
           disposition = EXCLUDED.disposition,
           state = EXCLUDED.state,
           card_json = EXCLUDED.card_json,
           source_evidence_ids_json = EXCLUDED.source_evidence_ids_json,
           schedule_json = CASE
             WHEN memory_cards.state = 'formal' THEN memory_cards.schedule_json
             ELSE EXCLUDED.schedule_json
           END,
           updated_at = EXCLUDED.updated_at`,
        [
          cardId,
          capture.id,
          bindingId,
          ownerId,
          accountId,
          normalized.disposition,
          normalized.state,
          JSON.stringify(cardJson),
          JSON.stringify(normalized.sourceEvidenceIds),
          schedule ? JSON.stringify(schedule) : null,
          toIsoString(createdAt),
          normalized.now.toISOString()
        ]
      );
      const stored = await selectCard(client, ownerId, cardId);
      await client.query("COMMIT");
      return serializeDatabaseEntry(stored, { durable: this.durable });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(deviceId, options = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const now = normalizeDate(options.now || new Date());
    const result = await this.pool.query(
      `SELECT * FROM memory_cards
        WHERE device_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [ownerId]
    );
    const entries = result.rows
      .map((row) => serializeDatabaseEntry(row, { durable: this.durable }))
      .filter((entry) => matchesPool(entryForPool(entry), options.pool, now, options.timeCapsuleDays))
      .sort(compareSerializedEntries);
    return {
      schemaVersion: CAPTURE_MEMORY_CARDS_SCHEMA_VERSION,
      durable: this.durable,
      cards: entries
    };
  }

  async get(deviceId, cardId) {
    const row = await selectCard(this.pool, requiredText(deviceId, "deviceId"), requiredText(cardId, "cardId"));
    return row ? serializeDatabaseEntry(row, { durable: this.durable }) : null;
  }

  async recordAssessment(deviceId, cardId, input = {}, { now = new Date() } = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const stableCardId = requiredText(cardId, "cardId");
    const request = normalizeAssessmentRequest(input);
    const date = normalizeDate(now);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const cardResult = await client.query(
        `SELECT * FROM memory_cards
          WHERE device_id = $1 AND id = $2 AND state = 'formal' AND deleted_at IS NULL
          FOR UPDATE`,
        [ownerId, stableCardId]
      );
      const card = cardResult.rows[0];
      if (!card) {
        await client.query("ROLLBACK");
        return null;
      }
      const previousResult = await client.query(
        `SELECT * FROM recall_attempts WHERE card_id = $1 AND attempt_id = $2`,
        [stableCardId, request.attemptId]
      );
      if (previousResult.rows[0]) {
        await client.query("COMMIT");
        return serializeDatabaseAttempt(stableCardId, previousResult.rows[0], true);
      }

      const currentSchedule = normalizeReviewSchedule(parseJson(card.schedule_json), { now: date });
      const schedule = advanceReviewSchedule(currentSchedule, request.assessment, { now: date });
      const masteryBefore = normalizeMastery(card.mastery_stage);
      const masteryAfter = advanceMastery(masteryBefore, request.assessment);
      const successfulRecallCount = Number(card.successful_recall_count || 0)
        + (request.assessment === "remembered" ? 1 : 0);
      const reviewCount = Number(card.review_count || 0) + 1;
      const attemptId = `attempt-${stableDigest(stableCardId, request.attemptId)}`;
      await client.query(
        `INSERT INTO recall_attempts (
           id, card_id, attempt_id, assessment, assessed_at, mastery_before,
           mastery_after, successful_recall_count, review_count, schedule_json
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [
          attemptId,
          stableCardId,
          request.attemptId,
          request.assessment,
          date.toISOString(),
          masteryBefore,
          masteryAfter,
          successfulRecallCount,
          reviewCount,
          JSON.stringify(schedule)
        ]
      );
      await client.query(
        `UPDATE memory_cards
            SET schedule_json = $3::jsonb,
                mastery_stage = $4,
                successful_recall_count = $5,
                review_count = $6,
                last_assessment = $7,
                updated_at = $8
          WHERE device_id = $1 AND id = $2`,
        [
          ownerId,
          stableCardId,
          JSON.stringify(schedule),
          masteryAfter,
          successfulRecallCount,
          reviewCount,
          request.assessment,
          date.toISOString()
        ]
      );
      await client.query("COMMIT");
      return serializeAssessmentResponse(stableCardId, {
        attemptId: request.attemptId,
        assessment: request.assessment,
        assessedAt: date.toISOString(),
        masteryBefore,
        masteryAfter,
        successfulRecallCount,
        reviewCount,
        schedule
      }, false);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteCard(deviceId, cardId, { now = new Date() } = {}) {
    const ownerId = requiredText(deviceId, "deviceId");
    const stableCardId = requiredText(cardId, "cardId");
    const result = await this.pool.query(
      `DELETE FROM captures
        WHERE id = (
          SELECT capture_id FROM memory_cards
           WHERE device_id = $1 AND id = $2 AND deleted_at IS NULL
        )
        RETURNING id`,
      [ownerId, stableCardId]
    );
    const captureId = result.rows[0]?.id;
    return captureId
      ? serializeDeletion(stableCardId, captureId, normalizeDate(now))
      : null;
  }

  async clearDevice(deviceId) {
    const ownerId = requiredText(deviceId, "deviceId");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureDevice(client, ownerId);
      await incrementCapturePersistenceEpochForDevice(client, ownerId);
      const result = await client.query(
        "DELETE FROM captures WHERE device_id = $1 RETURNING id",
        [ownerId]
      );
      await client.query("COMMIT");
      return result.rowCount || 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async clearAccount(accountId, { requestedDeviceId } = {}) {
    const stableAccountId = requiredText(accountId, "accountId");
    const stableDeviceId = requiredText(requestedDeviceId, "requestedDeviceId");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await ensureDevice(client, stableDeviceId);
      await incrementCapturePersistenceEpochsForAccount(client, {
        accountId: stableAccountId,
        requestedDeviceId: stableDeviceId
      });
      const result = await client.query(
        "DELETE FROM captures WHERE account_id = $1 RETURNING id",
        [stableAccountId]
      );
      await client.query("COMMIT");
      return result.rowCount || 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export const captureMemoryRepository = hasDatabase
  ? new PostgresCaptureRepository(databasePool)
  : new MemoryCaptureRepository();

export function isCapturePersistenceStale(value) {
  return value?.schemaVersion === CAPTURE_PERSISTENCE_STALE_SCHEMA_VERSION
    && value?.status === "cancelled";
}

async function readPersistenceEpoch(queryable, deviceId, { lock = false } = {}) {
  const result = await queryable.query(
    `SELECT capture_persistence_epoch
       FROM devices
      WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [deviceId]
  );
  if (!result.rows[0]) throw new Error("capture persistence device not found");
  return normalizePersistenceEpoch(result.rows[0].capture_persistence_epoch);
}

function serializePersistenceEpoch(deviceId, epoch, durable) {
  return {
    schemaVersion: CAPTURE_PERSISTENCE_EPOCH_SCHEMA_VERSION,
    deviceId,
    epoch: normalizePersistenceEpoch(epoch),
    durable
  };
}

function serializeStalePersistence(durable) {
  return {
    schemaVersion: CAPTURE_PERSISTENCE_STALE_SCHEMA_VERSION,
    status: "cancelled",
    stale: true,
    persisted: false,
    errorCode: "capture_persistence_stale",
    reason: "device_persistence_epoch_changed",
    durable
  };
}

function expectedPersistenceEpoch(value, deviceId) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const tokenDeviceId = cleanText(value.deviceId);
    if (tokenDeviceId && tokenDeviceId !== deviceId) {
      throw repositoryError(
        "capture_persistence_epoch_device_mismatch",
        "persistence epoch 与设备不匹配。"
      );
    }
    return normalizePersistenceEpoch(value.epoch);
  }
  return normalizePersistenceEpoch(value);
}

function normalizePersistenceEpoch(value) {
  const epoch = String(value ?? "").trim();
  if (!/^\d+$/.test(epoch)) {
    throw repositoryError("capture_persistence_epoch_invalid", "persistence epoch 无效。");
  }
  return BigInt(epoch).toString();
}

function normalizeCapturePersistence(result, options = {}) {
  const captureAnalysis = result?.captureAnalysis;
  if (!captureAnalysis || captureAnalysis.schemaVersion !== "capture_memory_card_2") return null;
  const now = normalizeDate(options.now || new Date());
  const imageSha256 = normalizeImageSha(options.imageSha256)
    || fallbackImageHash(options.deviceId, captureAnalysis.memoryCard?.id || result?.memoryCard?.id);
  const evidence = normalizeEvidence(options.evidence);
  const disposition = normalizeDisposition(captureAnalysis.disposition);
  const sourceStatus = normalizeSourceStatus(captureAnalysis.sourceStatus);
  const requestedCard = disposition === "create_card" ? captureAnalysis.memoryCard : null;
  const referencedIds = uniqueStrings(requestedCard?.sourceEvidenceIds);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const formalEvidenceValid = Boolean(requestedCard?.id)
    && referencedIds.length > 0
    && referencedIds.every((id) => evidenceIds.has(id));
  const effectiveDisposition = disposition === "create_card" && !formalEvidenceValid
    ? "needs_confirmation"
    : disposition;
  const state = effectiveDisposition === "create_card"
    ? "formal"
    : effectiveDisposition === "archive_only" ? "fragment" : "pending";
  const memoryCard = state === "formal"
    ? structuredClone(requestedCard)
    : normalizeFragmentCard(result?.memoryCard, captureAnalysis, now);
  const schedule = state === "formal"
    ? normalizeReviewSchedule(captureAnalysis.schedule, { now })
    : null;
  const sourceEvidenceIds = state === "formal" ? referencedIds : [];
  const persistedEvidence = state === "formal"
    ? evidence.filter((item) => sourceEvidenceIds.includes(item.id))
    : evidence.slice(0, 1).map((item) => ({ ...item, text: item.text.slice(0, 2_000) }));
  const sourceBinding = normalizeSourceBinding(
    result,
    sourceStatus,
    persistedEvidence,
    sourceEvidenceIds
  );
  return {
    now,
    imageSha256,
    disposition: effectiveDisposition,
    state,
    sourceStatus,
    memoryCard,
    schedule,
    evidence: persistedEvidence,
    sourceEvidenceIds,
    sourceBinding
  };
}

function normalizeFragmentCard(value, analysis, now) {
  const candidate = value && typeof value === "object" ? value : {};
  const decision = cleanText(analysis?.decisionReason) || "这张截图需要更多上下文。";
  const coreKnowledge = cleanText(candidate.coreKnowledge) || "这张截图还需要更多上下文";
  return {
    id: cleanText(candidate.id) || `fragment-${stableDigest(coreKnowledge, decision)}`,
    state: "fragment",
    coreKnowledge,
    recallCue: cleanText(candidate.recallCue) || "你当时想记住这张截图里的什么？",
    explanation: cleanText(candidate.explanation) || decision,
    sourceStatus: normalizeSourceStatus(analysis?.sourceStatus),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function normalizeSourceBinding(result, sourceStatus, evidence, sourceEvidenceIds) {
  const source = result?.source || {};
  const link = result?.link || {};
  const exactContext = result?.search?.provider === "input";
  const sourceNotFound = result?.sourceStatus === "unsourced_image"
    || result?.provenance?.status === "not_found";
  const status = sourceNotFound
    ? "unresolved"
    : exactContext
    ? "exact_context"
    : sourceStatus === "verified" ? "verified_match"
      : sourceStatus === "partial" ? "probable_match" : "unresolved";
  return {
    status,
    platform: cleanText(source.platform || link.platform).slice(0, 64),
    sourceUrl: cleanText(source.url || link.url).slice(0, 2_048),
    sourceTitle: cleanText(source.title || link.title).slice(0, 512),
    sourceAccount: cleanText(source.account || link.account).slice(0, 256),
    confidence: Number.isFinite(Number(link.confidence)) ? Number(link.confidence) : null,
    evidenceKeys: sourceEvidenceIds.length ? sourceEvidenceIds : evidence.map((item) => item.id)
  };
}

function normalizeEvidence(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map((item, index) => {
    const id = cleanText(item?.id).slice(0, 160) || `evidence-${index + 1}`;
    const text = cleanText(item?.text).slice(0, 12_000);
    if (!text || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      type: cleanText(item?.type).slice(0, 64) || "paragraph",
      text,
      bounds: normalizeEvidenceBounds(item?.bounds),
      confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : null,
      startSeconds: finiteOrNull(item?.startSeconds),
      endSeconds: finiteOrNull(item?.endSeconds),
      modelVersion: cleanText(item?.modelVersion).slice(0, 160)
    };
  }).filter(Boolean).slice(0, 64);
}

async function persistEvidence(client, captureId, evidence) {
  await client.query("DELETE FROM evidence_regions WHERE capture_id = $1", [captureId]);
  for (const item of evidence) {
    await client.query(
      `INSERT INTO evidence_regions (
         id, capture_id, evidence_key, evidence_type, evidence_text, bounds_json,
         confidence, start_seconds, end_seconds, model_version
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        `evidence-${stableDigest(captureId, item.id)}`,
        captureId,
        item.id,
        item.type,
        item.text,
        item.bounds ? JSON.stringify(item.bounds) : null,
        item.confidence,
        item.startSeconds,
        item.endSeconds,
        item.modelVersion
      ]
    );
  }
}

async function ensureDevice(client, deviceId) {
  await client.query(
    `INSERT INTO devices (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW()`,
    [deviceId]
  );
}

async function linkedAccountId(client, deviceId) {
  const result = await client.query(
    `SELECT account_id FROM account_device_links
      WHERE device_id = $1 ORDER BY last_seen_at DESC LIMIT 1`,
    [deviceId]
  );
  return result.rows[0]?.account_id || null;
}

async function selectCard(queryable, deviceId, cardId) {
  const result = await queryable.query(
    `SELECT * FROM memory_cards
      WHERE device_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [deviceId, cardId]
  );
  return result.rows[0] || null;
}

function serializeDatabaseEntry(row, { durable }) {
  const memoryCard = parseJson(row.card_json) || {};
  return {
    ...memoryCard,
    id: String(row.id),
    captureId: String(row.capture_id),
    disposition: normalizeDisposition(row.disposition),
    state: row.state === "formal" ? "formal" : "fragment",
    schedule: row.state === "formal" ? parseJson(row.schedule_json) : null,
    masteryStage: normalizeMastery(row.mastery_stage),
    successfulRecallCount: Number(row.successful_recall_count || 0),
    reviewCount: Number(row.review_count || 0),
    lastAssessment: row.last_assessment || undefined,
    capturedAt: toIsoString(row.created_at),
    createdAt: memoryCard.createdAt || toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    durable
  };
}

function serializeEntry(entry, { durable }) {
  return {
    ...structuredClone(entry.memoryCard),
    captureId: entry.captureId,
    disposition: normalizeDisposition(entry.disposition),
    state: entry.state === "formal" ? "formal" : "fragment",
    sourceStatus: entry.sourceStatus,
    schedule: entry.state === "formal" ? structuredClone(entry.schedule) : null,
    masteryStage: entry.masteryStage,
    successfulRecallCount: entry.successfulRecallCount,
    reviewCount: entry.reviewCount,
    ...(entry.lastAssessment ? { lastAssessment: entry.lastAssessment } : {}),
    capturedAt: entry.createdAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    durable
  };
}

function serializeDatabaseAttempt(cardId, row, repeated) {
  return serializeAssessmentResponse(cardId, {
    attemptId: row.attempt_id,
    assessment: row.assessment,
    assessedAt: toIsoString(row.assessed_at),
    masteryBefore: row.mastery_before,
    masteryAfter: row.mastery_after,
    successfulRecallCount: Number(row.successful_recall_count || 0),
    reviewCount: Number(row.review_count || 0),
    schedule: parseJson(row.schedule_json)
  }, repeated);
}

function serializeAssessmentResponse(cardId, attempt, repeated) {
  return {
    schemaVersion: CAPTURE_MEMORY_ASSESSMENT_SCHEMA_VERSION,
    cardId,
    assessment: {
      attemptId: attempt.attemptId,
      assessment: attempt.assessment,
      assessedAt: attempt.assessedAt,
      repeated
    },
    mastery: {
      before: attempt.masteryBefore,
      after: attempt.masteryAfter,
      successfulRecallCount: attempt.successfulRecallCount,
      reviewCount: attempt.reviewCount
    },
    schedule: structuredClone(attempt.schedule)
  };
}

function serializeDeletion(cardId, captureId, now) {
  return {
    schemaVersion: CAPTURE_MEMORY_DELETION_SCHEMA_VERSION,
    deleted: true,
    cardId,
    captureId,
    deletedAt: now.toISOString()
  };
}

function normalizeAssessmentRequest(input) {
  const attemptId = requiredText(input.attemptId, "attemptId");
  if (attemptId.length > 160) {
    throw repositoryError("capture_memory_attempt_id_invalid", "attemptId 不能超过 160 个字符。");
  }
  if (!REVIEW_ASSESSMENTS.includes(input.assessment)) {
    throw repositoryError(
      "capture_memory_assessment_invalid",
      "assessment 必须是 remembered、fuzzy 或 forgot。"
    );
  }
  return { attemptId, assessment: input.assessment };
}

export function advanceMastery(current, assessment) {
  const stage = normalizeMastery(current);
  if (stage === "sealed") return "awakened";
  if (assessment !== "remembered") return stage;
  if (stage === "awakened") return "solidified";
  return "engraved";
}

function matchesPool(entry, pool, now, timeCapsuleDays = 30) {
  const normalizedPool = cleanText(pool).toLowerCase();
  if (!normalizedPool) return true;
  if (entry.state !== "formal" || !entry.schedule) return false;
  if (normalizedPool === "due") return Date.parse(entry.schedule.nextReviewAt || "") <= now.getTime();
  if (normalizedPool === "fading") return ["fuzzy", "forgot"].includes(entry.lastAssessment);
  if (normalizedPool === "time_capsule") {
    const ageMs = now.getTime() - Date.parse(entry.createdAt || "");
    return Number.isFinite(ageMs) && ageMs >= Math.max(1, Number(timeCapsuleDays) || 30) * 86_400_000;
  }
  throw repositoryError("capture_memory_pool_invalid", "pool 必须是 due、fading 或 time_capsule。");
}

function entryForPool(value) {
  return {
    state: value.state,
    schedule: value.schedule,
    lastAssessment: value.lastAssessment,
    createdAt: value.capturedAt || value.createdAt
  };
}

function compareEntries(left, right) {
  const leftDue = Date.parse(left.schedule?.nextReviewAt || "") || Number.MAX_SAFE_INTEGER;
  const rightDue = Date.parse(right.schedule?.nextReviewAt || "") || Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
}

function compareSerializedEntries(left, right) {
  return compareEntries(entryForPool(left), entryForPool(right));
}

function captureStatus(state) {
  return state === "formal" ? "ready" : state === "fragment" ? "fragment" : "pending";
}

function normalizeDisposition(value) {
  return ["create_card", "archive_only", "needs_confirmation"].includes(value)
    ? value
    : "needs_confirmation";
}

function normalizeSourceStatus(value) {
  return ["verified", "partial", "unconfirmed"].includes(value) ? value : "unconfirmed";
}

function normalizeMastery(value) {
  return MASTERY_STAGES.includes(value) ? value : "sealed";
}

function normalizeImageSha(value) {
  const hash = cleanText(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function fallbackImageHash(...values) {
  return createHash("sha256").update(values.map(cleanText).join("\n") || randomUUID()).digest("hex");
}

function stableCardId(captureId, preferredId) {
  return `card-${stableDigest(captureId, preferredId)}`;
}

function stableDigest(...values) {
  return createHash("sha256").update(values.map(cleanText).join("\n")).digest("hex").slice(0, 24);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeEvidenceBounds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bounds = {};
  for (const key of ["x", "y", "width", "height", "page"]) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) bounds[key] = number;
  }
  return Object.keys(bounds).length ? bounds : null;
}


function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return structuredClone(value);
  try { return JSON.parse(String(value)); } catch { return null; }
}

function requiredText(value, field) {
  const text = cleanText(value);
  if (!text) throw repositoryError("capture_memory_request_invalid", `${field} 不能为空。`);
  return text;
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError("capture_memory_time_invalid", "时间无效。");
  }
  return date;
}

function toIsoString(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  return error;
}
