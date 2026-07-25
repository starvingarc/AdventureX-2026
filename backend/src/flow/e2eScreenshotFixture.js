import { createHash } from "node:crypto";

import { generateCaptureMemoryCard } from "./captureMemoryCard.js";

export const SCREENSHOT_E2E_FIXTURE_FLAG = "RECALLO_E2E_FIXTURE_MODE";
export const SCREENSHOT_E2E_FIXTURE_DELAY_MS = 60;

const FIXTURE_NOW = new Date("2020-01-01T00:00:00.000Z");
const FIXTURES_BY_SHA256 = new Map([
  [
    "05180f37fad9b184d54838304236bac57fbb032448cebc556542a87431dc4ede",
    {
      platform: "bilibili",
      contentKind: "video",
      title: "主动回忆为什么比直接重读更有效？",
      account: "Recallo 测试研究所",
      url: "https://www.bilibili.com/video/BVfixtureRecall",
      timestampSeconds: 42,
      locatorTerms: ["主动回忆", "记忆缺口"],
      evidenceId: "fixture-bilibili-evidence-1",
      evidenceText: "主动回忆要求学习者先尝试提取信息，从而暴露记忆缺口，并据此安排下一次练习。",
      evidenceStartSeconds: 40,
      evidenceEndSeconds: 48,
      coreKnowledge: "主动回忆通过先尝试提取信息来暴露记忆缺口。",
      hiddenSemantic: "暴露记忆缺口",
      recallCue: "主动回忆为什么比直接重读更能发现问题？",
      choicePrompt: "主动回忆最直接暴露什么？",
      distractors: ["收藏数量", "阅读速度", "界面偏好"],
      summary: "主动回忆通过先提取再反馈来暴露记忆缺口。",
      highlights: ["先尝试提取", "根据缺口安排练习"]
    }
  ],
  [
    "cfb511594c0cf813e221e8d75ff426b6ba0dd188e6f4658467e3bd65a3805449",
    {
      platform: "douyin",
      contentKind: "video",
      title: "间隔练习如何安排？",
      account: "@Recallo测试号",
      url: "https://www.douyin.com/video/7500000000000000000",
      timestampSeconds: null,
      locatorTerms: ["间隔练习", "回忆反馈"],
      evidenceId: "fixture-douyin-evidence-1",
      evidenceText: "间隔练习如何安排？根据回忆反馈逐步安排 1、3、7 天复习。",
      evidenceStartSeconds: 0,
      evidenceEndSeconds: 8,
      coreKnowledge: "间隔练习可以根据回忆反馈逐步安排下一次复习。",
      hiddenSemantic: "根据回忆反馈",
      recallCue: "间隔练习应根据什么来调整下一次复习？",
      choicePrompt: "间隔练习应依据什么安排下一次复习？",
      distractors: ["收藏数量", "视频时长", "界面颜色"],
      summary: "间隔练习根据回忆反馈调整下一次复习。",
      highlights: ["观察回忆反馈", "调整复习间隔"]
    }
  ]
]);

export function isScreenshotE2EFixtureEnabled(env = process.env) {
  return env?.NODE_ENV === "test" && env?.[SCREENSHOT_E2E_FIXTURE_FLAG] === "1";
}

export function configureScreenshotE2EFixture(input, {
  env = process.env,
  delayMs = SCREENSHOT_E2E_FIXTURE_DELAY_MS
} = {}) {
  if (!isScreenshotE2EFixtureEnabled(env)) return input;
  const fixture = fixtureForScreenshot(input?.imageBase64);
  const stableDelayMs = Math.max(0, Number(delayMs) || 0);
  return {
    ...input,
    analyzeImage: async () => {
      if (stableDelayMs > 0) await delay(stableDelayMs);
      return {
        provider: "recallo-e2e-fixture",
        model: "deterministic",
        text: [fixture.account, fixture.title].join("\n"),
        lines: [fixture.account, fixture.title],
        identity: {
          platform: fixture.platform,
          contentKind: fixture.contentKind,
          title: fixture.title,
          account: fixture.account,
          timestampSeconds: fixture.timestampSeconds,
          locatorTerms: fixture.locatorTerms,
          visibleTextLines: [fixture.account, fixture.title],
          confidence: 1
        }
      };
    },
    searcher: async (query) => ({
      provider: "recallo-e2e-fixture",
      query,
      results: [{
        platform: fixture.platform,
        contentKind: fixture.contentKind,
        title: fixture.title,
        account: fixture.account,
        url: fixture.url
      }]
    }),
    extract: async () => ({
      sourceTitle: fixture.title,
      sourceUrl: fixture.url,
      sourceAccount: fixture.account,
      platform: fixture.platform,
      rawText: fixture.evidenceText,
      overviewText: fixture.evidenceText,
      blocks: [{
        id: fixture.evidenceId,
        type: "subtitle",
        text: fixture.evidenceText,
        startSeconds: fixture.evidenceStartSeconds,
        endSeconds: fixture.evidenceEndSeconds
      }],
      focus: {
        status: "fixture",
        timestampSeconds: fixture.timestampSeconds,
        startSeconds: fixture.evidenceStartSeconds,
        endSeconds: fixture.evidenceEndSeconds
      }
    }),
    generateMemory: async (memoryInput) => generateCaptureMemoryCard(memoryInput, {
      now: FIXTURE_NOW,
      modelJsonCaller: async () => fixtureModelOutput(fixture)
    }),
    generateOverview: async () => ({
      summary: fixture.summary,
      highlights: fixture.highlights
    })
  };
}

function fixtureForScreenshot(imageBase64) {
  const bytes = decodeFixtureImage(imageBase64);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fixture = FIXTURES_BY_SHA256.get(sha256);
  if (!fixture) {
    throw fixtureError(
      "screenshot_e2e_fixture_unknown",
      "测试截图不在 capture gallery manifest 中，已拒绝生成 fixture 结果。"
    );
  }
  return fixture;
}

function decodeFixtureImage(value) {
  const input = String(value || "").trim();
  const dataUrl = input.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
  const payload = String(dataUrl?.[1] || input).replace(/\s+/g, "");
  if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw fixtureError(
      "screenshot_e2e_fixture_invalid",
      "测试截图必须是纯 base64 或图片 data URL。"
    );
  }
  const bytes = Buffer.from(payload, "base64");
  const normalizedInput = payload.replace(/=+$/, "");
  const normalizedDecoded = bytes.toString("base64").replace(/=+$/, "");
  if (!bytes.length || normalizedInput !== normalizedDecoded) {
    throw fixtureError(
      "screenshot_e2e_fixture_invalid",
      "测试截图 base64 无法被可靠解码。"
    );
  }
  return bytes;
}

function fixtureModelOutput(fixture) {
  return {
    disposition: "create_card",
    decisionReason: "测试证据支持一个明确且可复习的记忆点。",
    memoryCard: {
      coreKnowledge: fixture.coreKnowledge,
      recallCue: fixture.recallCue,
      hiddenSemantic: fixture.hiddenSemantic,
      explanation: fixture.evidenceText,
      sourceEvidenceIds: [fixture.evidenceId],
      rarity: "R",
      rarityReason: "证据支持一个具体的学习机制。",
      rarityConfidence: 0.95,
      recallVariants: [
        {
          id: `fixture-${fixture.platform}-cloze`,
          type: "semantic_cloze",
          prompt: fixture.coreKnowledge.replace(fixture.hiddenSemantic, "____"),
          answer: fixture.hiddenSemantic,
          options: [],
          correctOptionId: null,
          correctBoolean: null,
          explanation: fixture.evidenceText,
          sourceEvidenceIds: [fixture.evidenceId]
        },
        {
          id: `fixture-${fixture.platform}-true-false`,
          type: "true_false",
          prompt: fixture.coreKnowledge,
          answer: "true",
          options: [],
          correctOptionId: null,
          correctBoolean: true,
          explanation: fixture.evidenceText,
          sourceEvidenceIds: [fixture.evidenceId]
        },
        {
          id: `fixture-${fixture.platform}-choice`,
          type: "multiple_choice",
          prompt: fixture.choicePrompt,
          answer: fixture.hiddenSemantic,
          options: [
            { id: "a", text: fixture.hiddenSemantic },
            ...fixture.distractors.map((text, index) => ({
              id: String.fromCharCode("b".charCodeAt(0) + index),
              text
            }))
          ],
          correctOptionId: "a",
          correctBoolean: null,
          explanation: fixture.evidenceText,
          sourceEvidenceIds: [fixture.evidenceId]
        }
      ]
    }
  };
}

function fixtureError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
