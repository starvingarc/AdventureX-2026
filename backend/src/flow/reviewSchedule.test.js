import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceReviewSchedule,
  createInitialReviewSchedule,
  REVIEW_INTERVAL_DAYS
} from "./reviewSchedule.js";

const NOW = new Date("2026-07-24T08:00:00.000Z");

test("creates an immediately due schedule", () => {
  assert.deepEqual(createInitialReviewSchedule({ now: NOW }), {
    nextReviewAt: NOW.toISOString(),
    intervalDays: 0,
    state: "due",
    status: "due",
    stepIndex: 0
  });
});

test("advances remembered reviews through 1, 3, 7, 14, and 30 days", () => {
  let schedule = createInitialReviewSchedule({ now: NOW });
  const intervals = [];
  for (let index = 0; index < 6; index += 1) {
    schedule = advanceReviewSchedule(schedule, "remembered", { now: NOW });
    intervals.push(schedule.intervalDays);
  }
  assert.deepEqual(intervals, [1, 3, 7, 14, 30, 30]);
  assert.equal(schedule.stepIndex, REVIEW_INTERVAL_DAYS.length - 1);
  assert.equal(schedule.nextReviewAt, "2026-08-23T08:00:00.000Z");
});

test("moves fuzzy reviews back one step and forgot reviews to immediate", () => {
  const sevenDays = {
    nextReviewAt: "2026-07-31T08:00:00.000Z",
    intervalDays: 7,
    state: "scheduled",
    status: "scheduled",
    stepIndex: 3
  };
  const fuzzy = advanceReviewSchedule(sevenDays, "fuzzy", { now: NOW });
  assert.equal(fuzzy.intervalDays, 3);
  assert.equal(fuzzy.stepIndex, 2);
  assert.equal(fuzzy.nextReviewAt, "2026-07-27T08:00:00.000Z");

  const forgot = advanceReviewSchedule(fuzzy, "forgot", { now: NOW });
  assert.equal(forgot.intervalDays, 0);
  assert.equal(forgot.stepIndex, 0);
  assert.equal(forgot.state, "due");
  assert.equal(forgot.nextReviewAt, NOW.toISOString());
});

test("rejects invalid assessments and invalid clocks", () => {
  assert.throws(
    () => advanceReviewSchedule({}, "easy", { now: NOW }),
    /remembered、fuzzy 或 forgot/
  );
  assert.throws(
    () => createInitialReviewSchedule({ now: "not-a-date" }),
    /时间无效/
  );
});
