import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOmoServer } from "../src/server.js";
import { CardStore } from "../src/store.js";

test("screenshot job is accepted before slow card generation completes", async () => {
  const generation = deferred();
  const store = new CardStore("");

  await withServer(async (baseURL) => {
    const responsePromise = createJob(baseURL, "slow-owner", "c2xvdy1pbWFnZQ==");
    const response = await Promise.race([
      responsePromise,
      delay(150).then(() => null)
    ]);

    assert.notEqual(response, null, "job acceptance must not wait for model generation");
    assert.equal(response.status, 202);
    const accepted = (await response.json()).job;
    assert.equal(accepted.id, "job-fd6112941b78fcd21110");
    assert.ok(["accepted", "processing"].includes(accepted.state));
    assert.equal(JSON.stringify(accepted).includes("c2xvdy1pbWFnZQ=="), false);

    generation.resolve(memoryCard("card-slow"));
    const completed = await waitForJob(baseURL, "slow-owner", accepted.id, "succeeded");
    assert.equal(completed.cardId, "card-slow");

    const cards = await fetch(`${baseURL}/api/memory-cards`, {
      headers: { "x-device-id": "slow-owner" }
    });
    assert.equal((await cards.json()).cards[0].id, "card-slow");
  }, { store, createCard: () => generation.promise });
});

test("failed screenshot job is visible, sanitized and retryable with the same id", async () => {
  let attempts = 0;
  const store = new CardStore("");
  const createCard = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("private upstream detail"), {
        statusCode: 504,
        code: "model_timeout",
        expose: true
      });
    }
    return memoryCard("card-retried");
  };

  await withServer(async (baseURL) => {
    const acceptedResponse = await createJob(baseURL, "retry-owner", "cmV0cnktaW1hZ2U=");
    assert.equal(acceptedResponse.status, 202);
    const accepted = (await acceptedResponse.json()).job;
    const failed = await waitForJob(baseURL, "retry-owner", accepted.id, "failed");

    assert.equal(failed.errorCode, "model_timeout");
    assert.equal(failed.errorMessage, "截图处理超时，请重试。");
    assert.equal(failed.retryable, true);
    assert.equal(JSON.stringify(failed).includes("private upstream detail"), false);

    const retryResponse = await fetch(
      `${baseURL}/api/screenshot-jobs/${accepted.id}/retry`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-id": "retry-owner"
        },
        body: JSON.stringify({
          imageBase64: "cmV0cnktaW1hZ2U=",
          mimeType: "image/jpeg"
        })
      }
    );
    assert.equal(retryResponse.status, 202);
    assert.equal((await retryResponse.json()).job.id, accepted.id);

    const succeeded = await waitForJob(baseURL, "retry-owner", accepted.id, "succeeded");
    assert.equal(succeeded.cardId, "card-retried");
    assert.equal(succeeded.attemptCount, 2);
  }, { store, createCard });
});

test("duplicate screenshot submissions converge on one canonical job", async () => {
  const generation = deferred();
  let calls = 0;

  await withServer(async (baseURL) => {
    const responses = await Promise.all([
      createJob(baseURL, "duplicate-owner", "c2FtZS1pbWFnZQ=="),
      createJob(baseURL, "duplicate-owner", "c2FtZS1pbWFnZQ==")
    ]);
    const jobs = await Promise.all(responses.map(async (response) => {
      assert.equal(response.status, 202);
      return (await response.json()).job;
    }));

    assert.equal(jobs[0].id, jobs[1].id);
    await waitUntil(() => calls === 1);
    assert.equal(calls, 1);

    generation.resolve(memoryCard("card-canonical-job"));
    await waitForJob(baseURL, "duplicate-owner", jobs[0].id, "succeeded");
    assert.equal(calls, 1);
  }, {
    store: new CardStore(""),
    createCard: async () => {
      calls += 1;
      return generation.promise;
    }
  });
});

test("persisted processing job is recovered after store restart", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "omo-screenshot-jobs-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "store.json");

  const firstStore = new CardStore(filePath);
  const accepted = await firstStore.enqueueScreenshotJob("restart-owner", {
    imageBase64: "cmVzdGFydC1pbWFnZQ==",
    mimeType: "image/jpeg"
  });
  const claimed = await firstStore.claimScreenshotJob("restart-owner", accepted.id);
  assert.equal(claimed.state, "processing");

  const restartedStore = new CardStore(filePath);
  const unexpired = await restartedStore.recoverScreenshotJobs();
  assert.deepEqual(unexpired, []);
  assert.equal(
    (await restartedStore.getScreenshotJob("restart-owner", accepted.id)).state,
    "processing"
  );

  const recovered = await restartedStore.recoverScreenshotJobs(
    new Date(Date.now() + 10 * 60 * 1000)
  );
  assert.deepEqual(recovered.map((job) => job.id), [accepted.id]);
  assert.equal(
    (await restartedStore.getScreenshotJob("restart-owner", accepted.id)).state,
    "accepted"
  );
});

test("only the active claim token can complete a screenshot attempt", async () => {
  const store = new CardStore("");
  const accepted = store.enqueueScreenshotJob("lease-owner", {
    imageBase64: "bGVhc2UtaW1hZ2U=",
    mimeType: "image/jpeg"
  });
  const claimed = store.claimScreenshotJob("lease-owner", accepted.id);

  assert.ok(claimed.attemptToken);
  assert.equal(
    store.failScreenshotJob("lease-owner", accepted.id, "stale-token", {
      code: "model_timeout",
      message: "截图处理超时，请重试。"
    }),
    null
  );
  assert.equal(store.getScreenshotJob("lease-owner", accepted.id).state, "processing");

  const succeeded = store.succeedScreenshotJob(
    "lease-owner",
    accepted.id,
    claimed.attemptToken,
    "card-lease"
  );
  assert.equal(succeeded.state, "succeeded");
});

test("an active worker renews its lease so long processing is not reclaimed", () => {
  const store = new CardStore("");
  const accepted = store.enqueueScreenshotJob("heartbeat-owner", {
    imageBase64: "aGVhcnRiZWF0LWltYWdl",
    mimeType: "image/jpeg"
  });
  const claimed = store.claimScreenshotJob("heartbeat-owner", accepted.id);
  const initialExpiry = Date.parse(claimed.leaseExpiresAt);
  const heartbeatAt = new Date(initialExpiry - 60_000);

  assert.equal(
    store.renewScreenshotJobLease(
      "heartbeat-owner",
      accepted.id,
      "stale-token",
      heartbeatAt
    ),
    false
  );
  assert.equal(
    store.renewScreenshotJobLease(
      "heartbeat-owner",
      accepted.id,
      claimed.attemptToken,
      heartbeatAt
    ),
    true
  );
  assert.deepEqual(
    store.recoverScreenshotJobs(new Date(initialExpiry + 60_000)),
    []
  );
});

async function createJob(baseURL, owner, imageBase64) {
  return fetch(`${baseURL}/api/screenshot-jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": owner
    },
    body: JSON.stringify({ imageBase64, mimeType: "image/jpeg" })
  });
}

async function waitForJob(baseURL, owner, jobID, expectedState) {
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseURL}/api/screenshot-jobs/${jobID}`, {
      headers: { "x-device-id": owner }
    });
    assert.equal(response.status, 200);
    last = (await response.json()).job;
    if (last.state === expectedState) return last;
    await delay(10);
  }
  assert.fail(`job did not reach ${expectedState}; last state was ${last?.state}`);
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("condition was not reached");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

async function withServer(run, options) {
  const server = createOmoServer({
    env: { NODE_ENV: "development", OMO_DEMO_MODE: "1" },
    ...options
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseURL);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function memoryCard(id) {
  const now = new Date().toISOString();
  return {
    id,
    generationMode: "fixture",
    coreKnowledge: "合成知识",
    hiddenSemantic: "知识",
    recallCue: "你还记得吗？",
    answer: "知识",
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
