import test from "node:test";
import assert from "node:assert/strict";

import { buildMemoryCard, buildMemoryFragment, classifyRarity } from "./memoryCard.js";

function reviewFixture(overrides = {}) {
  const question = {
    knowledgePoint: "适用条件",
    stem: "什么情况下应该使用间隔复习？",
    options: [
      { id: "option-1", text: "需要长期记住时" },
      { id: "option-2", text: "只想立刻看完时" }
    ],
    correctOptionId: "option-1",
    explanation: "间隔复习适用于需要跨越较长时间保持的信息。",
    ...overrides
  };
  return {
    title: "间隔复习",
    units: [{ questions: [question] }]
  };
}

test("builds a stable verified memory card from the first generated question", () => {
  const input = {
    review: reviewFixture(),
    source: { title: "间隔复习", url: "https://www.bilibili.com/video/BVtest" }
  };
  const first = buildMemoryCard(input);
  const second = buildMemoryCard(input);
  assert.equal(first.id, second.id);
  assert.equal(first.state, "formal");
  assert.equal(first.hiddenSemantic, "需要长期记住时");
  assert.equal(first.sourceStatus, "verified");
  assert.equal(first.rarity, "SR");
});

test("classifies rarity deterministically", () => {
  assert.equal(classifyRarity({ stem: "一个具体事实", explanation: "用于当前场景。" }), "R");
  assert.equal(classifyRarity({ knowledgePoint: "方法", explanation: "这是一种可以复用的做法。" }), "SR");
  assert.equal(classifyRarity({
    knowledgePoint: "底层机制",
    explanation: "这个机制解释了信息在不同复习间隔下为何会形成不同强度的长期记忆。"
  }), "SSR");
});

test("falls back to a fragment when the generated question is incomplete", () => {
  const card = buildMemoryCard({
    review: reviewFixture({ correctOptionId: "missing" }),
    capture: { identity: { title: "截图标题", account: "作者", platform: "douyin" } }
  });
  assert.equal(card.state, "fragment");
  assert.equal(card.sourceStatus, "unconfirmed");
  assert.equal(card.rarity, undefined);
  assert.equal(card.hiddenSemantic, undefined);
});

test("builds stable fragments without inventing an answer or rarity", () => {
  const input = {
    capture: { identity: { title: "待核对标题", account: "测试作者", platform: "bilibili" } },
    message: "没有找到可信来源。",
    code: "search_match_low_confidence"
  };
  const first = buildMemoryFragment(input);
  const second = buildMemoryFragment(input);
  assert.equal(first.id, second.id);
  assert.equal(first.coreKnowledge, "待核对标题");
  assert.equal(first.sourceStatus, "unconfirmed");
  assert.equal(first.hiddenSemantic, undefined);
  assert.equal(first.rarity, undefined);
});
