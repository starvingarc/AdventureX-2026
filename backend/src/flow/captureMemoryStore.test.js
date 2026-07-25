import assert from "node:assert/strict";
import test from "node:test";

import { CaptureMemoryStore } from "./captureMemoryStore.js";
import { createInitialReviewSchedule } from "./reviewSchedule.js";

const NOW = new Date("2026-07-24T08:00:00.000Z");

function analysis(id = "capture-1", disposition = "create_card") {
  return {
    schemaVersion: "capture_memory_card_2",
    disposition,
    sourceStatus: disposition === "create_card" ? "partial" : "unconfirmed",
    decisionReason: disposition === "archive_only" ? "不适合复习。" : "需要更多上下文。",
    memoryCard: disposition === "create_card" ? {
      id,
      coreKnowledge: "主动回忆能够暴露记忆缺口。",
      recallCue: "主动回忆的直接作用是什么？",
      hiddenSemantic: "暴露记忆缺口",
      explanation: "主动回忆要求先尝试提取信息。",
      sourceEvidenceIds: ["e-1"],
      rarity: "R",
      rarityReason: "具体学习策略。",
      rarityConfidence: 0.8,
      rarityRuleVersion: "capture_rarity_2",
      recallVariants: []
    } : null,
    schedule: disposition === "create_card" ? createInitialReviewSchedule({ now: NOW }) : null
  };
}

test("stores formal, archive, and confirmation outcomes while isolating devices", () => {
  const store = new CaptureMemoryStore();
  const pending = store.upsertCaptureAnalysis("a", analysis("pending", "needs_confirmation"), { now: NOW });
  const archived = store.upsertCaptureAnalysis("a", analysis("archived", "archive_only"), { now: NOW });
  store.upsertCaptureAnalysis("a", analysis("card-a"), { now: NOW });
  store.upsertCaptureAnalysis("b", analysis("card-b"), { now: NOW });

  assert.equal(store.list("a", { now: NOW }).durable, false);
  assert.equal(pending.disposition, "needs_confirmation");
  assert.equal(archived.disposition, "archive_only");
  assert.equal(pending.schedule, null);
  assert.equal(archived.schedule, null);
  assert.deepEqual(
    new Set(store.list("a", { now: NOW }).cards.map((card) => card.disposition)),
    new Set(["create_card", "archive_only", "needs_confirmation"])
  );
  assert.deepEqual(store.list("b", { now: NOW }).cards.map((card) => card.id), ["card-b"]);
  assert.equal(store.get("b", "card-a"), null);
  assert.deepEqual(store.list("a", { pool: "due", now: NOW }).cards.map((card) => card.id), ["card-a"]);
});

test("records assessments idempotently and mastery only rises", () => {
  const store = new CaptureMemoryStore();
  store.upsertCaptureAnalysis("device-a", analysis(), { now: NOW });

  const first = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-1",
    assessment: "remembered"
  }, { now: NOW });
  const repeated = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-1",
    assessment: "forgot"
  }, { now: new Date("2026-07-25T08:00:00.000Z") });
  const fuzzy = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-2",
    assessment: "fuzzy"
  }, { now: new Date("2026-07-25T08:00:00.000Z") });
  const solidified = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-3",
    assessment: "remembered"
  }, { now: new Date("2026-07-26T08:00:00.000Z") });
  const engraved = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-4",
    assessment: "remembered"
  }, { now: new Date("2026-07-27T08:00:00.000Z") });
  const forgot = store.recordAssessment("device-a", "capture-1", {
    attemptId: "stable-attempt-5",
    assessment: "forgot"
  }, { now: new Date("2026-07-28T08:00:00.000Z") });

  assert.deepEqual(first.mastery, {
    before: "sealed",
    after: "awakened",
    successfulRecallCount: 1,
    reviewCount: 1
  });
  assert.equal(repeated.assessment.repeated, true);
  assert.equal(repeated.assessment.assessment, "remembered");
  assert.deepEqual(repeated.schedule, first.schedule);
  assert.deepEqual(repeated.mastery, first.mastery);
  assert.equal(fuzzy.mastery.after, "awakened");
  assert.equal(solidified.mastery.after, "solidified");
  assert.equal(engraved.mastery.after, "engraved");
  assert.equal(forgot.mastery.after, "engraved");
  assert.equal(forgot.mastery.successfulRecallCount, 3);
  assert.equal(forgot.mastery.reviewCount, 5);
});

test("filters due, fading, and time capsule pools from real state", () => {
  const store = new CaptureMemoryStore();
  const old = new Date("2026-06-01T08:00:00.000Z");
  store.upsertCaptureAnalysis("device-a", analysis("old-card"), { now: old });
  store.upsertCaptureAnalysis("device-a", analysis("new-card"), { now: NOW });
  store.recordAssessment("device-a", "new-card", {
    attemptId: "fuzzy-1",
    assessment: "fuzzy"
  }, { now: NOW });

  assert.deepEqual(store.list("device-a", { pool: "fading", now: NOW }).cards.map((card) => card.id), ["new-card"]);
  assert.deepEqual(store.list("device-a", { pool: "time_capsule", now: NOW }).cards.map((card) => card.id), ["old-card"]);
  assert.deepEqual(store.list("device-a", { pool: "due", now: NOW }).cards.map((card) => card.id), ["old-card"]);
});

test("deletes the card and its capture idempotency key", () => {
  const store = new CaptureMemoryStore();
  store.upsertCaptureAnalysis("device-a", analysis(), { now: NOW });
  const deleted = store.deleteCard("device-a", "capture-1", { now: NOW });
  assert.equal(deleted.schemaVersion, "capture_memory_card_deletion_1");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.cardId, "capture-1");
  assert.equal(store.get("device-a", "capture-1"), null);
  assert.equal(store.deleteCard("device-a", "capture-1"), null);
});

test("rejects malformed assessment requests", () => {
  const store = new CaptureMemoryStore();
  store.upsertCaptureAnalysis("device-a", analysis(), { now: NOW });
  assert.throws(() => store.recordAssessment("device-a", "capture-1", {
    attemptId: "",
    assessment: "remembered"
  }), /attemptId 不能为空/);
  assert.throws(() => store.recordAssessment("device-a", "capture-1", {
    attemptId: "attempt",
    assessment: "easy"
  }), /remembered、fuzzy 或 forgot/);
});
