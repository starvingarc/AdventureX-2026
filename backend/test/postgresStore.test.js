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
