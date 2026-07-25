import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  RECALLO_E2E_FIXTURE_MODE: process.env.RECALLO_E2E_FIXTURE_MODE,
  DATABASE_URL: process.env.DATABASE_URL,
  QWEN_API_KEY: process.env.QWEN_API_KEY,
  TIKHUB_API_KEY: process.env.TIKHUB_API_KEY
};

process.env.NODE_ENV = "test";
process.env.RECALLO_E2E_FIXTURE_MODE = "1";
process.env.DATABASE_URL = "";
process.env.QWEN_API_KEY = "";
process.env.TIKHUB_API_KEY = "";

const { captureMemoryStore } = await import("./captureMemoryStore.js");
const { server } = await import("../server.js");

const BILIBILI_SCREENSHOT = await readFile(
  new URL("../../test-fixtures/capture-gallery/bilibili-recall.png", import.meta.url)
);
const DOUYIN_SCREENSHOT = await readFile(
  new URL("../../test-fixtures/capture-gallery/douyin-spacing.png", import.meta.url)
);

test("HTTP screenshot fixture covers async recall lifecycle and deletion race", async (t) => {
  captureMemoryStore.reset();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    captureMemoryStore.reset();
    restoreEnv();
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const deviceId = "http-e2e-device";
  const headers = requestHeaders(deviceId);

  const upload = await requestJson(`${baseUrl}/api/sources/image-flow`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      async: true,
      imageBase64: BILIBILI_SCREENSHOT.toString("base64"),
      mimeType: "image/png"
    })
  }, 202);
  assert.equal(upload.status, "running");
  assert.match(upload.jobId, /^[0-9a-f-]{36}$/i);

  const completed = await pollJob(baseUrl, upload.jobId, headers);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.result.status, "completed");
  assert.equal(completed.result.captureAnalysis.disposition, "create_card");
  assert.equal(completed.result.capture.identity.platform, "bilibili");
  assert.equal(completed.result.source.platform, "bilibili");
  assert.equal(completed.result.schedule.intervalDays, 0);
  assert.ok(Date.parse(completed.result.schedule.nextReviewAt) <= Date.now());

  const firstList = await requestJson(`${baseUrl}/api/memory-cards`, { headers });
  assert.equal(firstList.durable, false);
  assert.equal(firstList.cards.length, 1);
  const card = firstList.cards[0];
  assert.equal(card.disposition, "create_card");
  assert.equal(card.schedule.intervalDays, 0);
  assert.equal(card.masteryStage, "sealed");
  const initialDue = await requestJson(`${baseUrl}/api/memory-cards?pool=due`, { headers });
  assert.deepEqual(initialDue.cards.map((item) => item.id), [card.id]);

  const firstAssessment = await requestJson(
    `${baseUrl}/api/memory-cards/${encodeURIComponent(card.id)}/assessments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptId: "http-e2e-attempt",
        assessment: "remembered"
      })
    }
  );
  assert.equal(firstAssessment.assessment.repeated, false);
  assert.equal(firstAssessment.assessment.assessment, "remembered");
  assert.equal(firstAssessment.schedule.intervalDays, 1);
  assert.equal(firstAssessment.schedule.state, "scheduled");
  assert.equal(firstAssessment.mastery.before, "sealed");
  assert.equal(firstAssessment.mastery.after, "awakened");

  const repeatedAssessment = await requestJson(
    `${baseUrl}/api/memory-cards/${encodeURIComponent(card.id)}/assessments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptId: "http-e2e-attempt",
        assessment: "forgot"
      })
    }
  );
  assert.equal(repeatedAssessment.assessment.repeated, true);
  assert.equal(repeatedAssessment.assessment.assessment, "remembered");
  assert.deepEqual(repeatedAssessment.schedule, firstAssessment.schedule);
  assert.deepEqual(repeatedAssessment.mastery, firstAssessment.mastery);

  const assessedList = await requestJson(`${baseUrl}/api/memory-cards`, { headers });
  assert.equal(assessedList.cards[0].schedule.intervalDays, 1);
  assert.equal(assessedList.cards[0].masteryStage, "awakened");
  assert.equal(assessedList.cards[0].lastAssessment, "remembered");
  const dueAfterAssessment = await requestJson(
    `${baseUrl}/api/memory-cards?pool=due`,
    { headers }
  );
  assert.deepEqual(dueAfterAssessment.cards, []);
  assert.ok(Date.parse(firstAssessment.schedule.nextReviewAt) > Date.now());

  const deleted = await requestJson(
    `${baseUrl}/api/memory-cards/${encodeURIComponent(card.id)}`,
    { method: "DELETE", headers }
  );
  assert.equal(deleted.schemaVersion, "capture_memory_card_deletion_1");
  assert.equal(deleted.deleted, true);
  const empty = await requestJson(`${baseUrl}/api/memory-cards`, { headers });
  assert.deepEqual(empty.cards, []);

  const douyinUpload = await requestJson(`${baseUrl}/api/sources/image-flow`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      async: true,
      imageBase64: `data:image/png;base64,${DOUYIN_SCREENSHOT.toString("base64")}`,
      mimeType: ""
    })
  }, 202);
  const douyinCompleted = await pollJob(baseUrl, douyinUpload.jobId, headers);
  assert.equal(douyinCompleted.status, "succeeded");
  assert.equal(douyinCompleted.result.status, "completed");
  assert.equal(douyinCompleted.result.capture.identity.platform, "douyin");
  assert.equal(douyinCompleted.result.source.platform, "douyin");
  assert.deepEqual(
    douyinCompleted.result.captureAnalysis.memoryCard.sourceEvidenceIds,
    ["fixture-douyin-evidence-1"]
  );
  const douyinCards = await requestJson(`${baseUrl}/api/memory-cards`, { headers });
  assert.equal(douyinCards.cards.length, 1);
  await requestJson(
    `${baseUrl}/api/memory-cards/${encodeURIComponent(douyinCards.cards[0].id)}`,
    { method: "DELETE", headers }
  );
  const emptyAfterDouyin = await requestJson(`${baseUrl}/api/memory-cards`, { headers });
  assert.deepEqual(emptyAfterDouyin.cards, []);

  const raceDeviceId = "http-e2e-delete-race";
  const raceHeaders = requestHeaders(raceDeviceId);
  const raceUpload = await requestJson(`${baseUrl}/api/sources/image-flow`, {
    method: "POST",
    headers: raceHeaders,
    body: JSON.stringify({
      async: true,
      imageBase64: BILIBILI_SCREENSHOT.toString("base64"),
      mimeType: "image/png"
    })
  }, 202);
  const deviceDeletion = await requestJson(`${baseUrl}/api/device-data`, {
    method: "DELETE",
    headers: raceHeaders
  });
  assert.equal(deviceDeletion.ok, true);

  const cancelled = await pollJob(baseUrl, raceUpload.jobId, raceHeaders);
  assert.equal(cancelled.status, "failed");
  assert.equal(cancelled.result.status, "cancelled");
  assert.equal(cancelled.result.errorCode, "capture_persistence_stale");
  assert.equal(cancelled.result.captureAnalysis, null);
  const raceCards = await requestJson(`${baseUrl}/api/memory-cards`, {
    headers: raceHeaders
  });
  assert.deepEqual(raceCards.cards, []);
});

function requestHeaders(deviceId) {
  return {
    "content-type": "application/json",
    "x-device-id": deviceId
  };
}

async function pollJob(baseUrl, jobId, headers) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await requestJson(
      `${baseUrl}/api/sources/image-flow/jobs/${encodeURIComponent(jobId)}`,
      { headers }
    );
    if (job.status !== "running") return job;
    await delay(10);
  }
  throw new Error(`Timed out waiting for image-flow job ${jobId}`);
}

async function requestJson(url, options = {}, expectedStatus = 200) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method || "GET"} ${url} returned ${response.status}: ${text}`
  );
  return payload;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
