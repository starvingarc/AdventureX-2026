import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const intervals = [0, 1, 3, 7, 14, 30];
const mastery = ["sealed", "awakened", "solidified", "engraved"];
const assessments = new Set(["remembered", "fuzzy", "forgot"]);

export class CardStore {
  constructor(filePath = process.env.CARD_STORE_PATH || resolve(".runtime/cards.json")) {
    this.filePath = filePath;
    this.cards = load(filePath);
  }

  list(owner) {
    return [...this.cards.values()]
      .filter((entry) => entry.owner === owner)
      .sort((a, b) => b.card.createdAt.localeCompare(a.card.createdAt))
      .map((entry) => publicCard(entry.card));
  }

  get(owner, cardId) {
    const entry = this.cards.get(key(owner, cardId));
    return entry ? publicCard(entry.card) : null;
  }

  save(owner, card) {
    const cardKey = key(owner, card.id);
    const previous = this.cards.get(cardKey);
    this.cards.set(cardKey, { owner, card: structuredClone(card) });
    try {
      this.persist();
    } catch (error) {
      if (previous) this.cards.set(cardKey, previous);
      else this.cards.delete(cardKey);
      throw error;
    }
    return publicCard(card);
  }

  assess(owner, cardId, assessment, attemptId) {
    if (!assessments.has(assessment)) {
      throw httpError(422, "assessment_invalid", "反馈只能是记得、模糊或忘记。");
    }
    if (!attemptId) throw httpError(422, "attempt_id_required", "缺少反馈幂等标识。");
    const entry = this.cards.get(key(owner, cardId));
    if (!entry) return null;
    const card = entry.card;
    const previous = structuredClone(card);
    card.attemptIds ||= [];
    if (card.attemptIds.includes(attemptId)) return publicCard(card);

    card.attemptIds.push(attemptId);
    card.reviewCount += 1;
    if (assessment === "remembered") card.successfulRecallCount += 1;
    card.lastAssessment = assessment;

    card.masteryStage = nextMasteryStage(card.masteryStage, assessment);

    const currentStep = Number(card.stepIndex || 0);
    card.stepIndex = assessment === "forgot"
      ? 0
      : assessment === "fuzzy"
        ? Math.max(1, currentStep - 1)
        : Math.min(intervals.length - 1, currentStep + 1);
    card.nextReviewAt = new Date(Date.now() + intervals[card.stepIndex] * 86_400_000).toISOString();
    try {
      this.persist();
    } catch (error) {
      entry.card = previous;
      throw error;
    }
    return publicCard(card);
  }

  delete(owner, cardId) {
    const cardKey = key(owner, cardId);
    const previous = this.cards.get(cardKey);
    if (!previous) return false;
    this.cards.delete(cardKey);
    try {
      this.persist();
    } catch (error) {
      this.cards.set(cardKey, previous);
      throw error;
    }
    return true;
  }

  persist() {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.cards.values()], null, 2));
    } catch {
      throw httpError(503, "storage_unavailable", "记忆卡存储暂时不可用。");
    }
  }
}

export function nextMasteryStage(currentStage, assessment) {
  const stage = mastery.includes(currentStage) ? currentStage : "sealed";
  if (assessment === "forgot") return stage;
  if (stage === "sealed") return "awakened";
  if (assessment !== "remembered") return stage;
  return mastery[Math.min(mastery.length - 1, mastery.indexOf(stage) + 1)];
}

function load(filePath) {
  if (!filePath || !existsSync(filePath)) return new Map();
  try {
    return new Map(JSON.parse(readFileSync(filePath, "utf8")).map((entry) => [
      key(entry.owner, entry.card.id),
      entry
    ]));
  } catch {
    return new Map();
  }
}

function publicCard(card) {
  const { attemptIds, stepIndex, ...value } = card;
  return structuredClone(value);
}

function key(owner, cardId) {
  return `${owner}:${cardId}`;
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}
