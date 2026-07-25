import assert from "node:assert/strict";
import test from "node:test";

import { captureMemoryStore } from "./captureMemoryStore.js";
import { createInitialReviewSchedule } from "./reviewSchedule.js";
import {
  captureMemoryCardPayload,
  persistCaptureMemoryResult,
  server
} from "../server.js";
import { runImageFlow } from "./index.js";

test("keeps persistence metadata outside capture_memory_card_2 payloads", () => {
  const payload = captureMemoryCardPayload({
    id: "card-1",
    disposition: "create_card",
    coreKnowledge: "主动回忆能够暴露记忆缺口。",
    recallCue: "主动回忆有什么作用？",
    hiddenSemantic: "暴露记忆缺口",
    explanation: "先提取，再反馈。",
    sourceEvidenceIds: ["e-1"],
    rarity: "R",
    rarityReason: "局部事实。",
    rarityConfidence: 0.8,
    rarityRuleVersion: "capture_rarity_2",
    recallVariants: [],
    sourceStatus: "verified",
    captureId: "capture-1",
    schedule: { intervalDays: 1 },
    masteryStage: "sealed",
    successfulRecallCount: 0,
    reviewCount: 0,
    durable: true
  });
  assert.equal(payload.id, "card-1");
  assert.equal(payload.rarityReason, "局部事实。");
  assert.equal("schedule" in payload, false);
  assert.equal("masteryStage" in payload, false);
  assert.equal("durable" in payload, false);
  assert.equal("captureId" in payload, false);
});

test("persists a synchronous image-flow result without flattening repository metadata", async () => {
  captureMemoryStore.reset();
  const result = await runImageFlow({
    ocrText: "记忆研究所\n主动回忆为什么有效",
    searcher: async () => ({
      provider: "tikhub",
      results: [{
        title: "主动回忆为什么有效",
        url: "https://www.bilibili.com/video/BVmemory",
        account: "记忆研究所",
        platform: "bilibili",
        contentKind: "video"
      }]
    }),
    extract: async () => ({
      sourceTitle: "主动回忆为什么有效",
      sourceUrl: "https://www.bilibili.com/video/BVmemory",
      sourceAccount: "记忆研究所",
      platform: "bilibili",
      rawText: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。",
      overviewText: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。",
      blocks: [{
        id: "e-1",
        type: "paragraph",
        text: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口。"
      }]
    }),
    generateMemory: async () => ({
      schemaVersion: "capture_memory_card_2",
      disposition: "create_card",
      sourceStatus: "verified",
      decisionReason: "证据充分。",
      memoryCard: {
        id: "generated-route-card",
        coreKnowledge: "主动回忆能够暴露记忆缺口。",
        recallCue: "主动回忆有什么作用？",
        hiddenSemantic: "暴露记忆缺口",
        explanation: "先提取信息。",
        sourceEvidenceIds: ["e-1"],
        rarity: "R",
        rarityReason: "局部学习方法。",
        rarityConfidence: 0.8,
        rarityRuleVersion: "capture_rarity_2",
        recallVariants: []
      },
      schedule: createInitialReviewSchedule({ now: new Date("2026-07-24T08:00:00.000Z") })
    }),
    generateOverview: async () => ({ summary: "全片概览", highlights: [] })
  });

  const persistenceEpoch = await captureMemoryStore.beginPersistence("image-flow-device");
  const stored = await persistCaptureMemoryResult("image-flow-device", result, {
    imageSha256: "b".repeat(64),
    persistenceEpoch
  });
  assert.equal(stored.disposition, "create_card");
  assert.equal((await captureMemoryStore.list("image-flow-device")).cards.length, 1);
  assert.equal(result.captureAnalysis.memoryCard.id, stored.id);
  assert.equal("schedule" in result.captureAnalysis.memoryCard, false);
  assert.equal("durable" in result.captureAnalysis.memoryCard, false);
  assert.equal(result.memoryCard.state, "formal");
  assert.equal(result.memoryCard.rarityReason, "局部学习方法。");
  captureMemoryStore.reset();
});

test("does not restore a card when deletion wins while the model is running", async () => {
  captureMemoryStore.reset();
  const persistenceEpoch = await captureMemoryStore.beginPersistence("stale-device");
  const modelResult = {
    status: "completed",
    captureAnalysis: {
      schemaVersion: "capture_memory_card_2",
      disposition: "create_card",
      sourceStatus: "verified",
      decisionReason: "证据充分。",
      memoryCard: {
        id: "stale-card",
        coreKnowledge: "主动回忆能够暴露记忆缺口。",
        recallCue: "主动回忆有什么作用？",
        hiddenSemantic: "暴露记忆缺口",
        explanation: "先提取信息。",
        sourceEvidenceIds: ["e-1"],
        rarity: "R",
        rarityReason: "局部学习方法。",
        rarityConfidence: 0.8,
        rarityRuleVersion: "capture_rarity_2",
        recallVariants: []
      },
      schedule: createInitialReviewSchedule({ now: new Date("2026-07-24T08:00:00.000Z") })
    },
    memoryCard: { id: "stale-card", state: "formal" },
    review: { units: [{ questions: [{ id: "stale-question" }] }] }
  };

  captureMemoryStore.clearDevice("stale-device");
  const stored = await persistCaptureMemoryResult("stale-device", modelResult, {
    imageSha256: "d".repeat(64),
    persistenceEpoch
  });

  assert.equal(stored.schemaVersion, "capture_persistence_stale_1");
  assert.equal(stored.persisted, false);
  assert.equal(modelResult.status, "cancelled");
  assert.equal(modelResult.errorCode, "capture_persistence_stale");
  assert.equal(modelResult.captureAnalysis, null);
  assert.equal(modelResult.memoryCard, null);
  assert.equal(modelResult.review, null);
  assert.equal(captureMemoryStore.list("stale-device").cards.length, 0);
  assert.equal(captureMemoryStore.beginPersistence("stale-device").epoch, "1");
  captureMemoryStore.reset();
});

test("downgrades a generated card when its cited evidence is unavailable", async () => {
  captureMemoryStore.reset();
  const result = {
    captureAnalysis: {
      schemaVersion: "capture_memory_card_2",
      disposition: "create_card",
      sourceStatus: "partial",
      decisionReason: "模型生成完成。",
      memoryCard: {
        id: "uncited-card",
        coreKnowledge: "主动回忆能够暴露记忆缺口。",
        recallCue: "主动回忆有什么作用？",
        hiddenSemantic: "暴露记忆缺口",
        explanation: "先提取信息。",
        sourceEvidenceIds: ["missing-evidence"],
        rarity: "R",
        rarityReason: "局部事实。",
        rarityConfidence: 0.8,
        rarityRuleVersion: "capture_rarity_2",
        recallVariants: []
      },
      schedule: createInitialReviewSchedule({ now: new Date("2026-07-24T08:00:00.000Z") })
    },
    memoryCard: { id: "uncited-card", state: "formal" },
    review: { units: [{ questions: [{ id: "unsafe-question" }] }] }
  };

  const stored = await persistCaptureMemoryResult("uncited-device", result, {
    imageSha256: "c".repeat(64)
  });
  assert.equal(stored.disposition, "needs_confirmation");
  assert.equal(stored.schedule, null);
  assert.equal(result.captureAnalysis.memoryCard, null);
  assert.equal(result.captureAnalysis.schedule, null);
  assert.equal(result.review, null);
  assert.equal(result.memoryCard.state, "fragment");
  captureMemoryStore.reset();
});

test("lists device-isolated cards and records idempotent assessments over HTTP", async (t) => {
  captureMemoryStore.reset();
  captureMemoryStore.upsertCaptureAnalysis("route-device", {
    schemaVersion: "capture_memory_card_2",
    disposition: "create_card",
    sourceStatus: "verified",
    memoryCard: {
      id: "route-card",
      coreKnowledge: "主动回忆能够暴露记忆缺口。",
      recallCue: "主动回忆有什么作用？",
      hiddenSemantic: "暴露记忆缺口",
      explanation: "先尝试提取信息。",
      sourceEvidenceIds: ["e-1"],
      rarity: "R",
      rarityReason: "局部学习方法。",
      rarityConfidence: 0.8,
      rarityRuleVersion: "capture_rarity_2",
      recallVariants: []
    },
    schedule: createInitialReviewSchedule({
      now: new Date("2026-07-24T08:00:00.000Z")
    })
  }, {
    now: new Date("2026-07-24T08:00:00.000Z")
  });


  captureMemoryStore.upsertCaptureAnalysis("route-device", {
    schemaVersion: "capture_memory_card_2",
    disposition: "needs_confirmation",
    sourceStatus: "unconfirmed",
    decisionReason: "缺少完整上下文。",
    memoryCard: null,
    schedule: null
  }, {
    now: new Date("2026-07-24T08:00:00.000Z")
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    captureMemoryStore.reset();
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    "content-type": "application/json",
    "x-device-id": "route-device"
  };

  const listResponse = await fetch(`${baseUrl}/api/memory-cards`, { headers });
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.schemaVersion, "capture_memory_cards_1");
  assert.equal(list.durable, false);
  assert.equal(list.cards.length, 2);
  const formal = list.cards.find((card) => card.id === "route-card");
  const pending = list.cards.find((card) => card.disposition === "needs_confirmation");
  assert.equal(formal.disposition, "create_card");
  assert.equal(formal.masteryStage, "sealed");
  assert.equal(pending.schedule, null);

  const firstResponse = await fetch(
    `${baseUrl}/api/memory-cards/route-card/assessments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptId: "route-attempt",
        assessment: "remembered"
      })
    }
  );
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.schedule.intervalDays, 1);
  assert.equal(first.assessment.repeated, false);
  assert.equal(first.mastery.before, "sealed");
  assert.equal(first.mastery.after, "awakened");
  assert.equal(first.mastery.reviewCount, 1);

  const repeatedResponse = await fetch(
    `${baseUrl}/api/memory-cards/route-card/assessments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptId: "route-attempt",
        assessment: "forgot"
      })
    }
  );
  const repeated = await repeatedResponse.json();
  assert.equal(repeated.assessment.repeated, true);
  assert.equal(repeated.assessment.assessment, "remembered");
  assert.equal(repeated.schedule.intervalDays, 1);
  assert.deepEqual(repeated.mastery, first.mastery);

  const otherDeviceResponse = await fetch(`${baseUrl}/api/memory-cards`, {
    headers: { ...headers, "x-device-id": "other-device" }
  });
  const otherDevice = await otherDeviceResponse.json();
  assert.deepEqual(otherDevice.cards, []);

  const deleteResponse = await fetch(`${baseUrl}/api/memory-cards/route-card`, {
    method: "DELETE",
    headers
  });
  assert.equal(deleteResponse.status, 200);
  const deleted = await deleteResponse.json();
  assert.equal(deleted.schemaVersion, "capture_memory_card_deletion_1");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.cardId, "route-card");

  const repeatedDelete = await fetch(`${baseUrl}/api/memory-cards/route-card`, {
    method: "DELETE",
    headers
  });
  assert.equal(repeatedDelete.status, 404);
  assert.equal((await repeatedDelete.json()).errorCode, "capture_memory_card_not_found");

  const raceDeviceId = "route-delete-race";
  const raceEpoch = captureMemoryStore.beginPersistence(raceDeviceId);
  const deviceDeleteResponse = await fetch(`${baseUrl}/api/device-data`, {
    method: "DELETE",
    headers: { ...headers, "x-device-id": raceDeviceId }
  });
  assert.equal(deviceDeleteResponse.status, 200);
  const raceResult = {
    status: "completed",
    captureAnalysis: {
      schemaVersion: "capture_memory_card_2",
      disposition: "archive_only",
      sourceStatus: "unconfirmed",
      decisionReason: "模型稍后完成。",
      memoryCard: null,
      schedule: null
    }
  };
  const stale = await persistCaptureMemoryResult(raceDeviceId, raceResult, {
    imageSha256: "e".repeat(64),
    persistenceEpoch: raceEpoch
  });
  assert.equal(stale.schemaVersion, "capture_persistence_stale_1");
  assert.equal(raceResult.status, "cancelled");
  assert.equal(captureMemoryStore.list(raceDeviceId).cards.length, 0);
});
