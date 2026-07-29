import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryCard, hasValidHiddenSemantic } from "../src/cardService.js";

const input = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };

function generated(overrides = {}) {
  return {
    coreKnowledge: "截图可能削弱记忆，因为它会触发认知卸载。",
    hiddenSemantic: "认知卸载",
    recallCue: "为什么保存截图有时反而更难记住？",
    explanation: "用户认为设备已经替自己保存，因此减少主动编码。",
    sourceTitle: "截图与记忆",
    sourceAccount: "学习研究所",
    platform: "wechat",
    rarity: "SR",
    ...overrides
  };
}

const verifiedSource = {
  status: "verified",
  provider: "tikhub",
  platform: "wechat",
  title: "截图与记忆",
  account: "学习研究所",
  url: "https://example.com/article",
  confidence: 0.9
};

test("accepts an exact hidden semantic and mirrors it as the compatibility answer", async () => {
  const card = await createMemoryCard(input, {
    modelCaller: async () => generated(),
    sourceVerifier: async () => verifiedSource
  });

  assert.equal(card.hiddenSemantic, "认知卸载");
  assert.equal(card.answer, card.hiddenSemantic);
  assert.ok(card.coreKnowledge.includes(card.hiddenSemantic));
  assert.equal(card.rarity, "SR");
});

test("repairs one invalid hidden semantic before creating a card", async () => {
  const calls = [];
  const card = await createMemoryCard(input, {
    modelCaller: async (request) => {
      calls.push(request);
      return calls.length === 1
        ? generated({ hiddenSemantic: "截图里不存在的词" })
        : generated();
    },
    sourceVerifier: async () => verifiedSource
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].mode, "generate");
  assert.equal(calls[1].mode, "repair");
  assert.match(calls[1].validationError, /连续子串/);
  assert.equal(card.hiddenSemantic, "认知卸载");
});

test("rejects a card after two invalid hidden semantic results", async () => {
  let calls = 0;

  await assert.rejects(
    () => createMemoryCard(input, {
      modelCaller: async () => {
        calls += 1;
        return generated({ hiddenSemantic: "截图里不存在的词" });
      },
      sourceVerifier: async () => verifiedSource
    }),
    (error) => error.statusCode === 502 && /承重语义/.test(error.message)
  );

  assert.equal(calls, 2);
});

test("keeps screenshot-only generation available but lowers rarity to R", async () => {
  const card = await createMemoryCard(input, {
    modelCaller: async () => generated({ rarity: "SSR" }),
    sourceVerifier: async () => ({
      status: "screenshot_only",
      provider: "tikhub",
      platform: "wechat"
    })
  });

  assert.equal(card.sourceStatus, "screenshot_only");
  assert.equal(card.rarity, "R");
  assert.equal(card.hiddenSemantic, "认知卸载");
});

test("validates hidden semantic as a non-empty exact substring", () => {
  assert.equal(hasValidHiddenSemantic(generated()), true);
  assert.equal(hasValidHiddenSemantic(generated({ hiddenSemantic: "" })), false);
  assert.equal(hasValidHiddenSemantic(generated({ hiddenSemantic: "认知  卸载" })), false);
});
