import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CardStore, nextMasteryStage } from "../src/store.js";

test("stores cards and applies idempotent review feedback", () => {
  const store = new CardStore("");
  const card = memoryCard();

  store.save("device-a", card);
  const first = store.assess("device-a", card.id, "remembered", "attempt-1");
  const repeated = store.assess("device-a", card.id, "forgot", "attempt-1");

  assert.equal(first.masteryStage, "awakened");
  assert.equal(first.reviewCount, 1);
  assert.equal(repeated.reviewCount, 1);
  assert.equal(repeated.lastAssessment, "remembered");
});

test("mastery state machine covers every stage and assessment", () => {
  const expected = {
    sealed: { remembered: "awakened", fuzzy: "awakened", forgot: "sealed" },
    awakened: { remembered: "solidified", fuzzy: "awakened", forgot: "awakened" },
    solidified: { remembered: "engraved", fuzzy: "solidified", forgot: "solidified" },
    engraved: { remembered: "engraved", fuzzy: "engraved", forgot: "engraved" }
  };

  for (const [stage, transitions] of Object.entries(expected)) {
    for (const [assessment, nextStage] of Object.entries(transitions)) {
      assert.equal(
        nextMasteryStage(stage, assessment),
        nextStage,
        `${stage} + ${assessment} should become ${nextStage}`
      );
    }
  }
});

test("a forgotten sealed card remains sealed in persisted store state", () => {
  const store = new CardStore("");
  const card = memoryCard();
  store.save("device-a", card);

  const updated = store.assess("device-a", card.id, "forgot", "attempt-forgot");

  assert.equal(updated.masteryStage, "sealed");
  assert.equal(updated.lastAssessment, "forgot");
  assert.equal(updated.reviewCount, 1);
  assert.equal(updated.successfulRecallCount, 0);
});

test("rolls back a card instead of reporting success when persistence fails", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "omo-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const unwritableFile = join(directory, "cards-as-directory");
  mkdirSync(unwritableFile);
  const store = new CardStore(unwritableFile);
  const card = memoryCard();

  assert.throws(
    () => store.save("device-a", card),
    (error) => error.statusCode === 503 && error.code === "storage_unavailable"
  );
  assert.equal(store.get("device-a", card.id), null);
});

test("rolls back assessment and deletion when persistence fails", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "omo-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const unwritableFile = join(directory, "cards-as-directory");
  mkdirSync(unwritableFile);
  const store = new CardStore("");
  const card = memoryCard();
  store.save("device-a", card);
  store.filePath = unwritableFile;

  assert.throws(
    () => store.assess("device-a", card.id, "remembered", "attempt-failing"),
    (error) => error.code === "storage_unavailable"
  );
  assert.equal(store.get("device-a", card.id).reviewCount, 0);
  assert.throws(
    () => store.delete("device-a", card.id),
    (error) => error.code === "storage_unavailable"
  );
  assert.equal(store.get("device-a", card.id).id, card.id);
});

function memoryCard() {
  return {
    id: "card-1",
    coreKnowledge: "知识点",
    recallCue: "提示",
    answer: "答案",
    explanation: "解释",
    sourceTitle: "截图",
    rarity: "SR",
    createdAt: new Date().toISOString(),
    masteryStage: "sealed",
    nextReviewAt: new Date().toISOString(),
    reviewCount: 0,
    successfulRecallCount: 0,
    lastAssessment: null,
    stepIndex: 0,
    attemptIds: []
  };
}
