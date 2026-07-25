import assert from "node:assert/strict";
import test from "node:test";

import {
  isCapturePersistenceStale,
  MemoryCaptureRepository,
  PostgresCaptureRepository
} from "./captureMemoryRepository.js";
import { createInitialReviewSchedule } from "./reviewSchedule.js";

const NOW = new Date("2026-07-24T08:00:00.000Z");
const IMAGE_SHA = "a".repeat(64);

function captureResult() {
  return {
    captureAnalysis: {
      schemaVersion: "capture_memory_card_2",
      disposition: "create_card",
      sourceStatus: "verified",
      memoryCard: {
        id: "generated-card",
        coreKnowledge: "主动回忆能够暴露记忆缺口。",
        recallCue: "主动回忆的直接作用是什么？",
        hiddenSemantic: "暴露记忆缺口",
        explanation: "先尝试提取信息。",
        sourceEvidenceIds: ["cited"],
        rarity: "R",
        rarityReason: "具体且局部的学习事实。",
        rarityConfidence: 0.9,
        rarityRuleVersion: "capture_rarity_2",
        recallVariants: []
      },
      schedule: createInitialReviewSchedule({ now: NOW })
    },
    source: {
      platform: "bilibili",
      url: "https://www.bilibili.com/video/BV1example",
      title: "主动回忆为什么有效"
    }
  };
}

function evidence() {
  return [
    { id: "cited", type: "subtitle", text: "主动回忆能够暴露记忆缺口。" },
    { id: "uncited", type: "subtitle", text: "不应被持久化的完整转写内容。" }
  ];
}

class FakeRepositoryClient {
  constructor() {
    this.calls = [];
    this.card = null;
    this.epoch = "0";
  }

  async query(sql, params = []) {
    const text = String(sql).trim();
    this.calls.push({ text, params });
    if (text.startsWith("SELECT capture_persistence_epoch")) {
      return { rows: [{ capture_persistence_epoch: this.epoch }] };
    }
    if (text.startsWith("UPDATE devices") && text.includes("capture_persistence_epoch")) {
      this.epoch = (BigInt(this.epoch) + 1n).toString();
      const accountWide = text.includes("account_device_links");
      return {
        rows: accountWide
          ? [
              { id: "device-a", capture_persistence_epoch: this.epoch },
              { id: "device-b", capture_persistence_epoch: this.epoch }
            ]
          : [{ id: params[0], capture_persistence_epoch: this.epoch }],
        rowCount: accountWide ? 2 : 1
      };
    }
    if (text.startsWith("SELECT account_id FROM account_device_links")) return { rows: [] };
    if (text.startsWith("INSERT INTO captures")) return { rows: [{ id: params[0] }] };
    if (text.startsWith("DELETE FROM captures") && text.includes("account_id = $1")) {
      return { rows: [{ id: "capture-a" }, { id: "capture-b" }], rowCount: 2 };
    }
    if (text.startsWith("SELECT * FROM memory_cards") && text.includes("capture_id = $1")) {
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO memory_cards")) {
      this.card = {
        id: params[0],
        capture_id: params[1],
        source_binding_id: params[2],
        device_id: params[3],
        account_id: params[4],
        disposition: params[5],
        state: params[6],
        card_json: JSON.parse(params[7]),
        source_evidence_ids_json: JSON.parse(params[8]),
        schedule_json: JSON.parse(params[9]),
        mastery_stage: "sealed",
        successful_recall_count: 0,
        review_count: 0,
        last_assessment: null,
        created_at: params[10],
        updated_at: params[11]
      };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT * FROM memory_cards") && text.includes("device_id = $1")) {
      return { rows: this.card ? [this.card] : [] };
    }
    return { rows: [], rowCount: 0 };
  }

  release() {}
}

test("Postgres repository awaits one transaction and persists only cited evidence", async () => {
  const client = new FakeRepositoryClient();
  const repository = new PostgresCaptureRepository({ connect: async () => client });
  const persistenceEpoch = await repository.beginPersistence("device-a");
  client.calls = [];
  const stored = await repository.persistCaptureResult("device-a", captureResult(), {
    now: NOW,
    imageSha256: IMAGE_SHA,
    persistenceEpoch,
    evidence: evidence()
  });

  assert.equal(stored.durable, true);
  assert.equal(stored.disposition, "create_card");
  assert.equal(stored.masteryStage, "sealed");
  const evidenceInserts = client.calls.filter((call) => call.text.startsWith("INSERT INTO evidence_regions"));
  assert.equal(evidenceInserts.length, 1);
  assert.equal(evidenceInserts[0].params[2], "cited");
  assert.equal(evidenceInserts[0].params[4], "主动回忆能够暴露记忆缺口。");
  assert.equal(client.calls.at(-1).text, "COMMIT");
  assert.equal(client.calls.some((call) => call.params.includes("不应被持久化的完整转写内容。")), false);
});

test("Postgres repository rejects a stale epoch before inserting a capture", async () => {
  const client = new FakeRepositoryClient();
  const repository = new PostgresCaptureRepository({ connect: async () => client });
  const persistenceEpoch = await repository.beginPersistence("device-a");
  await repository.clearDevice("device-a");
  assert.equal(client.epoch, "1");
  client.calls = [];

  const stored = await repository.persistCaptureResult("device-a", captureResult(), {
    now: NOW,
    imageSha256: IMAGE_SHA,
    persistenceEpoch,
    evidence: evidence()
  });

  assert.equal(isCapturePersistenceStale(stored), true);
  assert.equal(stored.persisted, false);
  assert.equal(client.calls.some((call) => call.text.startsWith("INSERT INTO captures")), false);
  assert.equal(client.calls.at(-1).text, "ROLLBACK");
});

test("Postgres account deletion fence covers multiple devices before deleting captures", async () => {
  const client = new FakeRepositoryClient();
  const repository = new PostgresCaptureRepository({ connect: async () => client });
  const count = await repository.clearAccount("account-a", { requestedDeviceId: "device-a" });

  assert.equal(count, 2);
  const bumpIndex = client.calls.findIndex((call) =>
    call.text.startsWith("UPDATE devices") && call.text.includes("account_device_links")
  );
  const deleteIndex = client.calls.findIndex((call) =>
    call.text.startsWith("DELETE FROM captures") && call.text.includes("account_id = $1")
  );
  assert.equal(bumpIndex > -1, true);
  assert.equal(deleteIndex > bumpIndex, true);
  assert.deepEqual(client.calls[bumpIndex].params, ["account-a", "device-a"]);
  assert.equal(client.calls.at(-1).text, "COMMIT");
});

test("memory deletion keeps an epoch tombstone and blocks the old task", () => {
  const repository = new MemoryCaptureRepository();
  const persistenceEpoch = repository.beginPersistence("device-a");
  repository.clearDevice("device-a");
  const stored = repository.persistCaptureResult("device-a", captureResult(), {
    now: NOW,
    imageSha256: IMAGE_SHA,
    persistenceEpoch,
    evidence: evidence()
  });

  assert.equal(isCapturePersistenceStale(stored), true);
  assert.equal(repository.list("device-a").cards.length, 0);
  assert.equal(repository.beginPersistence("device-a").epoch, "1");
});

test("memory repository is idempotent by image hash and never downgrades a formal card", async () => {
  const repository = new MemoryCaptureRepository();
  const first = await repository.persistCaptureResult("device-a", captureResult(), {
    now: NOW,
    imageSha256: IMAGE_SHA,
    evidence: evidence()
  });
  const second = await repository.persistCaptureResult("device-a", captureResult(), {
    now: new Date("2026-07-25T08:00:00.000Z"),
    imageSha256: IMAGE_SHA,
    evidence: evidence()
  });
  const attemptedDowngrade = await repository.persistCaptureResult("device-a", {
    captureAnalysis: {
      schemaVersion: "capture_memory_card_2",
      disposition: "needs_confirmation",
      sourceStatus: "unconfirmed",
      decisionReason: "后续识别缺少上下文。",
      memoryCard: null,
      schedule: null
    }
  }, {
    now: new Date("2026-07-26T08:00:00.000Z"),
    imageSha256: IMAGE_SHA,
    evidence: []
  });

  assert.equal(second.captureId, first.captureId);
  assert.equal(second.id, first.id);
  assert.equal(attemptedDowngrade.disposition, "create_card");
  assert.equal(attemptedDowngrade.schedule.nextReviewAt, first.schedule.nextReviewAt);
  assert.equal((await repository.list("device-a")).cards.length, 1);
});
