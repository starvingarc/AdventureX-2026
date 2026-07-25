import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_MEMORY_CARD_SCHEMA_VERSION,
  generateCaptureMemoryCard,
  serializeLegacyMemoryCard,
  validateCaptureMemoryOutput
} from "./captureMemoryCard.js";

const EVIDENCE = [
  {
    id: "e-1",
    type: "paragraph",
    text: "主动回忆通过在不查看答案时尝试提取信息，能够暴露记忆缺口。"
  },
  {
    id: "e-2",
    type: "paragraph",
    text: "这一机制可以用于概念学习、语言学习和考试复习，帮助学习者判断需要再次练习的内容。"
  }
];
const NOW = new Date("2026-07-24T08:00:00.000Z");

function validOutput(overrides = {}) {
  const memoryCard = {
    coreKnowledge: "主动回忆通过尝试提取信息来暴露记忆缺口。",
    recallCue: "主动回忆怎样帮助学习者发现薄弱内容？",
    hiddenSemantic: "尝试提取信息",
    explanation: "学习者先在不查看答案时尝试提取信息，由此暴露记忆缺口，并判断需要再次练习的内容。",
    sourceEvidenceIds: ["e-1", "e-2"],
    rarity: "SR",
    rarityReason: "这是一种可以迁移到不同学习场景的方法。",
    rarityConfidence: 0.82,
    recallVariants: [
      {
        id: "cloze-1",
        type: "semantic_cloze",
        prompt: "主动回忆要求学习者先 ____。",
        answer: "尝试提取信息",
        options: [],
        correctOptionId: null,
        correctBoolean: null,
        explanation: "主动回忆的关键动作是先尝试提取信息。",
        sourceEvidenceIds: ["e-1"]
      },
      {
        id: "tf-1",
        type: "true_false",
        prompt: "主动回忆可以帮助学习者暴露记忆缺口。",
        answer: "true",
        options: [],
        correctOptionId: null,
        correctBoolean: true,
        explanation: "原内容明确说明主动回忆能够暴露记忆缺口。",
        sourceEvidenceIds: ["e-1"]
      },
      {
        id: "mcq-1",
        type: "multiple_choice",
        prompt: "主动回忆最直接帮助学习者发现什么？",
        answer: "记忆缺口",
        options: [
          { id: "a", text: "记忆缺口" },
          { id: "b", text: "阅读速度" },
          { id: "c", text: "笔记长度" },
          { id: "d", text: "页面颜色" }
        ],
        correctOptionId: "a",
        correctBoolean: null,
        explanation: "尝试提取信息会暴露记忆缺口。",
        sourceEvidenceIds: ["e-1"]
      }
    ],
    ...(overrides.memoryCard || {})
  };
  return {
    disposition: "create_card",
    decisionReason: "内容包含一个清晰且可复习的方法。",
    memoryCard,
    ...overrides,
    ...(overrides.memoryCard ? { memoryCard } : {})
  };
}

function input(sourceStatus = "verified") {
  return {
    evidence: EVIDENCE,
    sourceStatus,
    sourceTitle: "主动回忆的方法",
    sourceAccount: "学习研究所",
    sourceUrl: "https://www.bilibili.com/video/BVtest"
  };
}

test("generates one evidence-bound card with explicit Qwen model and initial schedule", async () => {
  let request;
  const result = await generateCaptureMemoryCard(input(), {
    now: NOW,
    modelJsonCaller: async (value) => {
      request = value;
      return validOutput();
    }
  });
  assert.equal(request.provider, "qwen");
  assert.equal(request.model, "qwen3.7-plus-2026-05-26");
  assert.equal(request.schemaName, CAPTURE_MEMORY_CARD_SCHEMA_VERSION);
  assert.equal(result.disposition, "create_card");
  assert.equal(result.sourceStatus, "verified");
  assert.equal(result.memoryCard.sourceStatus, "verified");
  assert.equal(result.memoryCard.hiddenSemantic, "尝试提取信息");
  assert.equal(result.memoryCard.recallVariants.length, 3);
  assert.equal(result.schedule.intervalDays, 0);
  assert.equal(result.schedule.nextReviewAt, NOW.toISOString());
});

test("repairs a deterministic validation failure once", async () => {
  let calls = 0;
  const invalid = validOutput({
    memoryCard: { sourceEvidenceIds: ["missing"] }
  });
  const result = await generateCaptureMemoryCard(input(), {
    now: NOW,
    modelJsonCaller: async () => {
      calls += 1;
      return calls === 1 ? invalid : validOutput();
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.disposition, "create_card");
});

test("never calls the model more than twice and degrades to confirmation", async () => {
  let calls = 0;
  const invalid = validOutput({
    memoryCard: { hiddenSemantic: "不存在的连续语义" }
  });
  const result = await generateCaptureMemoryCard(input(), {
    modelJsonCaller: async () => {
      calls += 1;
      return invalid;
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.disposition, "needs_confirmation");
  assert.equal(result.memoryCard, null);
});

test("blocks invalid evidence, unsupported numbers and names, and unsafe certainty", () => {
  const invalidEvidence = validateCaptureMemoryOutput(validOutput({
    memoryCard: { sourceEvidenceIds: ["missing"] }
  }), { evidence: EVIDENCE, sourceStatus: "verified" });
  assert.equal(invalidEvidence.ok, false);
  assert.match(invalidEvidence.errors.join("\n"), /Evidence ID/);

  const unsupportedFacts = validateCaptureMemoryOutput(validOutput({
    memoryCard: {
      coreKnowledge: "李明提出主动回忆能提高 50% 的表现，其中尝试提取信息是关键。",
      hiddenSemantic: "尝试提取信息"
    }
  }), { evidence: EVIDENCE, sourceStatus: "verified" });
  assert.equal(unsupportedFacts.ok, false);
  assert.match(unsupportedFacts.errors.join("\n"), /50%|李明/);

  const unsafe = validateCaptureMemoryOutput(validOutput({
    memoryCard: {
      coreKnowledge: "这种投资方法一定会保证收益，而尝试提取信息是记忆步骤。",
      hiddenSemantic: "尝试提取信息"
    }
  }), { evidence: EVIDENCE, sourceStatus: "verified" });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.errors.join("\n"), /高风险/);
});

test("requires exact cloze, boolean true-false, and one unique MCQ answer", () => {
  const bad = validOutput();
  bad.memoryCard.recallVariants[0].answer = "另一个答案";
  bad.memoryCard.recallVariants[1].correctBoolean = null;
  bad.memoryCard.recallVariants[2].options[1].id = "a";
  const validation = validateCaptureMemoryOutput(bad, {
    evidence: EVIDENCE,
    sourceStatus: "verified"
  });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /hiddenSemantic/);
  assert.match(validation.errors.join("\n"), /布尔值/);
  assert.match(validation.errors.join("\n"), /ID 必须非空且互不重复/);
});

test("returns validation errors instead of throwing on malformed variants", () => {
  const malformed = validOutput();
  malformed.memoryCard.recallVariants = [{
    id: "broken",
    type: "multiple_choice",
    prompt: "缺少选项",
    explanation: "格式不完整。",
    sourceEvidenceIds: ["e-1"]
  }];
  assert.doesNotThrow(() => validateCaptureMemoryOutput(malformed, {
    evidence: EVIDENCE,
    sourceStatus: "verified"
  }));
  const result = validateCaptureMemoryOutput(malformed, {
    evidence: EVIDENCE,
    sourceStatus: "verified"
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /options 必须是数组/);
});

test("downgrades low-confidence rarity and evidence-poor SSR", async () => {
  const lowConfidence = validOutput({
    memoryCard: { rarity: "SSR", rarityConfidence: 0.4 }
  });
  const lowResult = await generateCaptureMemoryCard(input(), {
    modelJsonCaller: async () => lowConfidence
  });
  assert.equal(lowResult.memoryCard.rarity, "R");

  const weakSsr = validOutput({
    memoryCard: {
      rarity: "SSR",
      rarityConfidence: 0.92,
      sourceEvidenceIds: ["e-1"],
      rarityReason: "这是一条重要知识。",
      recallVariants: validOutput().memoryCard.recallVariants.map((variant) => ({
        ...variant,
        sourceEvidenceIds: ["e-1"]
      }))
    }
  });
  const weakResult = await generateCaptureMemoryCard(input(), {
    modelJsonCaller: async () => weakSsr
  });
  assert.equal(weakResult.memoryCard.rarity, "R");

  const supportedSsr = validOutput({
    memoryCard: {
      rarity: "SSR",
      rarityConfidence: 0.92,
      rarityReason: "证据描述了机制，并说明它可以用于多个学习场景。"
    }
  });
  const supportedResult = await generateCaptureMemoryCard(input(), {
    modelJsonCaller: async () => supportedSsr
  });
  assert.equal(supportedResult.memoryCard.rarity, "SSR");
});

test("accepts archive and confirmation dispositions without fabricating a card", async () => {
  for (const disposition of ["archive_only", "needs_confirmation"]) {
    const result = await generateCaptureMemoryCard(input(), {
      modelJsonCaller: async () => ({
        disposition,
        decisionReason: "当前内容不适合生成正式卡。",
        memoryCard: null
      })
    });
    assert.equal(result.disposition, disposition);
    assert.equal(result.memoryCard, null);
    assert.equal(result.schedule, null);
  }
});

test("prevents formal cards from unconfirmed sources", async () => {
  const result = await generateCaptureMemoryCard(input("unconfirmed"), {
    modelJsonCaller: async () => validOutput()
  });
  assert.equal(result.disposition, "needs_confirmation");
  assert.equal(result.memoryCard, null);
});

test("legacy serializer maps partial to unconfirmed and keeps singular rarityReason", async () => {
  const analysis = await generateCaptureMemoryCard(input("partial"), {
    modelJsonCaller: async () => validOutput(),
    now: NOW
  });
  const legacy = serializeLegacyMemoryCard(analysis);
  assert.equal(legacy.sourceStatus, "unconfirmed");
  assert.equal(typeof legacy.rarityReason, "string");
  assert.equal(legacy.nextReviewAt, NOW.toISOString());
});
