import assert from "node:assert/strict";
import test from "node:test";

import { validateReviewPathV2 } from "../contracts/reviewPathContract.js";
import { generateReviewPathV2 } from "./generateReviewPathV2.js";
import { selectTextWindow } from "./quickReviewGenerator.js";

const ARTICLE = {
  id: "chapter-fast-001",
  title: "检索练习",
  author: "拾贝",
  rawText: "反复阅读会制造熟悉感。主动回想与间隔复习更有助于长期保持。"
};

test("generates a contract-valid review path with one model call", async () => {
  const calls = [];
  const result = await generateReviewPathV2(ARTICLE, {
    cacheEnabled: false,
    modelJsonCaller: async (request) => {
      calls.push(request);
      return fixture();
    },
    now: "2026-07-23T00:00:00.000Z"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].stage, "quick_review");
  assert.equal(result.units.length, 1);
  assert.deepEqual(result.units[0].questions.map((question) => question.type), [
    "true_false",
    "multiple_choice",
    "multiple_choice"
  ]);
  assert.deepEqual(validateReviewPathV2(result), { ok: true, errors: [] });
  assert.equal(result.generationMeta.modelCallCount, 1);
});

test("bounds long content deterministically while retaining head, middle and tail", () => {
  const text = `${"A".repeat(8000)}${"B".repeat(8000)}${"C".repeat(8000)}`;
  const first = selectTextWindow(text, 1200);
  const second = selectTextWindow(text, 1200);

  assert.equal(first, second);
  assert.ok(first.length <= 1250);
  assert.match(first, /^A+/);
  assert.match(first, /B+/);
  assert.match(first, /C+$/);
});

test("repairs an incomplete structured response at most once", async () => {
  const calls = [];
  const result = await generateReviewPathV2(ARTICLE, {
    cacheEnabled: false,
    modelJsonCaller: async (request) => {
      calls.push(request);
      if (calls.length === 1) throw new Error("模型返回内容不是可解析 JSON，请重试。");
      return fixture();
    },
    now: "2026-07-23T00:00:00.000Z"
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].user, /上一次响应不是完整 JSON/);
  assert.equal(result.status, "completed");
});

function fixture() {
  return {
    title: "主动回想比反复阅读更有效",
    summary: "熟悉感不等于掌握。通过主动回想并拉开复习间隔，更容易形成长期记忆。",
    tags: ["学习方法", "记忆"],
    questions: [
      {
        knowledgePoint: "熟悉感与掌握",
        type: "true_false",
        prompt: "反复阅读带来的熟悉感等同于掌握。",
        options: ["正确", "错误"],
        correctIndex: 1,
        explanation: "熟悉感可能掩盖无法主动提取的问题。"
      },
      {
        knowledgePoint: "主动回想",
        type: "multiple_choice",
        prompt: "哪种方式更利于长期保持？",
        options: ["集中抄写", "主动回想", "连续重读", "只做标记"],
        correctIndex: 1,
        explanation: "主动提取本身会强化记忆。"
      },
      {
        knowledgePoint: "间隔复习",
        type: "multiple_choice",
        prompt: "间隔复习的关键是什么？",
        options: ["拉开复习时间", "一次学完", "只看答案", "跳过错误"],
        correctIndex: 0,
        explanation: "拉开间隔能让每次提取更费力也更有效。"
      }
    ]
  };
}
