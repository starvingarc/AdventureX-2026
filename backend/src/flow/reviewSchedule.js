const DAY_MS = 86_400_000;

export const REVIEW_INTERVAL_DAYS = Object.freeze([0, 1, 3, 7, 14, 30]);
export const REVIEW_ASSESSMENTS = Object.freeze(["remembered", "fuzzy", "forgot"]);

export function createInitialReviewSchedule({ now = new Date() } = {}) {
  const date = normalizeDate(now);
  return serializeSchedule({
    nextReviewAt: date.toISOString(),
    intervalDays: 0,
    stepIndex: 0,
    state: "due"
  });
}

export function advanceReviewSchedule(
  currentSchedule,
  assessment,
  { now = new Date() } = {}
) {
  if (!REVIEW_ASSESSMENTS.includes(assessment)) {
    throw scheduleError(
      "capture_memory_assessment_invalid",
      "assessment 必须是 remembered、fuzzy 或 forgot。"
    );
  }

  const date = normalizeDate(now);
  const currentStep = normalizeStepIndex(currentSchedule?.stepIndex);
  if (assessment === "forgot") {
    return serializeSchedule({
      nextReviewAt: date.toISOString(),
      intervalDays: 0,
      stepIndex: 0,
      state: "due"
    });
  }

  const nextStep = assessment === "remembered"
    ? Math.min(currentStep + 1, REVIEW_INTERVAL_DAYS.length - 1)
    : Math.max(1, currentStep - 1);
  const intervalDays = REVIEW_INTERVAL_DAYS[nextStep];
  return serializeSchedule({
    nextReviewAt: new Date(date.getTime() + intervalDays * DAY_MS).toISOString(),
    intervalDays,
    stepIndex: nextStep,
    state: "scheduled"
  });
}

export function normalizeReviewSchedule(value, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createInitialReviewSchedule({ now });
  }
  const nextReviewAtMs = Date.parse(String(value.nextReviewAt || ""));
  const intervalDays = REVIEW_INTERVAL_DAYS.includes(Number(value.intervalDays))
    ? Number(value.intervalDays)
    : 0;
  const stepIndex = REVIEW_INTERVAL_DAYS.indexOf(intervalDays);
  const fallbackNow = normalizeDate(now);
  const nextReviewAt = Number.isFinite(nextReviewAtMs)
    ? new Date(nextReviewAtMs).toISOString()
    : fallbackNow.toISOString();
  const state = nextReviewAtMs <= fallbackNow.getTime() || intervalDays === 0
    ? "due"
    : "scheduled";
  return serializeSchedule({ nextReviewAt, intervalDays, stepIndex, state });
}

function serializeSchedule({ nextReviewAt, intervalDays, stepIndex, state }) {
  return {
    nextReviewAt,
    intervalDays,
    state,
    status: state,
    stepIndex
  };
}

function normalizeStepIndex(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 0;
  return Math.max(0, Math.min(REVIEW_INTERVAL_DAYS.length - 1, number));
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw scheduleError("capture_memory_schedule_time_invalid", "复习调度时间无效。");
  }
  return date;
}

function scheduleError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  return error;
}
