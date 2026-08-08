import assert from "node:assert/strict";
import test from "node:test";

import { PostgresCardStore } from "../src/postgresStore.js";

test("stale Postgres updates fail with a stable conflict error", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("SELECT card, version")) {
        return { rows: [{ card: memoryCard(), version: "1" }] };
      }
      if (sql.includes("INSERT INTO omo_assessment_attempts")) {
        return { rows: [{ attempt_id: "attempt-1" }] };
      }
      if (sql.includes("UPDATE omo_memory_cards")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const store = new PostgresCardStore(pool);

  await assert.rejects(
    store.assess("device-a", "card-1", "remembered", "attempt-1"),
    (error) => error.statusCode === 409 && error.code === "storage_write_conflict"
  );
  assert.ok(queries.includes("ROLLBACK"));
});

test("driver errors are sanitized before reaching the API boundary", async () => {
  const pool = {
    async query() {
      throw new Error("postgres://user:secret@private-host/database");
    }
  };
  const store = new PostgresCardStore(pool);

  await assert.rejects(
    store.list("device-a"),
    (error) => error.statusCode === 503
      && error.code === "storage_unavailable"
      && !error.message.includes("private-host")
  );
});

test("failed Postgres writes roll back and return a stable storage error", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("INSERT INTO omo_memory_cards")) {
        throw new Error("postgresql://user:secret@private-host/database");
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const store = new PostgresCardStore(pool);

  await assert.rejects(
    store.save("device-a", memoryCard()),
    (error) => error.statusCode === 503
      && error.code === "storage_unavailable"
      && !error.message.includes("private-host")
  );
  assert.ok(queries.includes("ROLLBACK"));
});

test("Postgres screenshot jobs preserve private image data while exposing only public state", async () => {
  const queries = [];
  const now = "2026-08-08T00:00:00.000Z";
  const row = {
    owner_id: "device-a",
    job_id: "job-90ddc7d246434f636213",
    fingerprint: "90ddc7d246434f636213c69cd39c1604962ccbcca84b7bd9ebd4563fbba6834b",
    state: "accepted",
    image_base64: "cG9zdGdyZXMtaW1hZ2U=",
    mime_type: "image/jpeg",
    attempt_count: 0,
    card_id: "",
    error_code: "",
    error_message: "",
    retryable: false,
    created_at: now,
    updated_at: now
  };
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("INSERT INTO omo_screenshot_jobs")) return { rows: [row] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const store = new PostgresCardStore(pool);

  const job = await store.enqueueScreenshotJob("device-a", {
    imageBase64: "cG9zdGdyZXMtaW1hZ2U=",
    mimeType: "image/jpeg"
  });

  assert.deepEqual(job, {
    id: "job-90ddc7d246434f636213",
    state: "accepted",
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    cardId: "",
    errorCode: "",
    errorMessage: "",
    retryable: false
  });
  assert.equal(JSON.stringify(job).includes("cG9zdGdyZXMtaW1hZ2U="), false);
  assert.ok(queries.some((sql) => sql.includes("ON CONFLICT (owner_id, fingerprint)")));
});

test("Postgres screenshot completion is fenced by the active attempt token", async () => {
  const queries = [];
  const now = "2026-08-08T00:00:00.000Z";
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("SET state = 'processing'")) {
        return { rows: [{
          owner_id: "device-a",
          job_id: "job-a",
          fingerprint: "a".repeat(64),
          state: "processing",
          image_base64: "aW1hZ2U=",
          mime_type: "image/jpeg",
          attempt_count: 1,
          attempt_token: values[2],
          lease_expires_at: values[3],
          card_id: "",
          error_code: "",
          error_message: "",
          retryable: false,
          created_at: now,
          updated_at: now
        }] };
      }
      if (sql.includes("SET state = 'succeeded'")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; }, query: client.query };
  const store = new PostgresCardStore(pool);

  const claimed = await store.claimScreenshotJob("device-a", "job-a");
  assert.ok(claimed.attemptToken);
  assert.equal(
    await store.succeedScreenshotJob("device-a", "job-a", "stale-token", "card-a"),
    null
  );
  const completion = queries.find(({ sql }) => sql.includes("SET state = 'succeeded'"));
  assert.match(completion.sql, /state = 'processing' AND attempt_token = \$3/);
  assert.equal(completion.values[2], "stale-token");
});

function memoryCard(id = "card-1") {
  const now = new Date().toISOString();
  return {
    id,
    generationMode: "fixture",
    coreKnowledge: "合成知识",
    recallCue: "合成提示",
    answer: "合成答案",
    explanation: "合成解释",
    sourceTitle: "合成来源",
    sourceAccount: "",
    sourcePlatform: "unknown",
    sourceUrl: "",
    sourceStatus: "screenshot_only",
    sourceProvider: "tikhub",
    sourceReason: "provider_missing",
    sourceConfidence: 0,
    rarity: "R",
    createdAt: now,
    masteryStage: "sealed",
    nextReviewAt: now,
    reviewCount: 0,
    successfulRecallCount: 0,
    lastAssessment: null,
    stepIndex: 0,
    attemptIds: []
  };
}
