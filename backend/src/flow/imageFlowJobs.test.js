import assert from "node:assert/strict";
import test from "node:test";

import { createImageFlowJob, getImageFlowJob } from "./imageFlowJobs.js";

test("runs image flow asynchronously and exposes progress", async () => {
  const created = createImageFlowJob(async (update) => {
    update({ stage: "vision", message: "正在理解截图", percent: 10 });
    return { status: "completed", review: { summaryCard: { text: "完成" } } };
  }, { ownerId: "device-a" });
  assert.equal(created.status, "running");
  await new Promise((resolve) => setImmediate(resolve));
  const completed = getImageFlowJob(created.jobId, { ownerId: "device-a" });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.progress.percent, 100);
  assert.equal(completed.result.review.summaryCard.text, "完成");
});

test("does not expose a screenshot job to another device", async () => {
  const created = createImageFlowJob(
    async () => ({ status: "completed" }),
    { ownerId: "device-a" }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getImageFlowJob(created.jobId, { ownerId: "device-b" }), null);
  assert.equal(getImageFlowJob(created.jobId, { ownerId: "device-a" })?.status, "succeeded");
});
