import { performance } from "node:perf_hooks";

import { generateCaptureMemoryCard } from "../src/flow/captureMemoryCard.js";
import { runImageFlow } from "../src/flow/index.js";

const CASE_COUNT = 30;
const cases = Array.from({ length: CASE_COUNT }, (_, index) => {
  const number = index + 1;
  const platform = index % 2 === 0 ? "bilibili" : "douyin";
  const rarity = number % 10 === 0 ? "SSR" : number % 3 === 0 ? "SR" : "R";
  const title = `${platform === "bilibili" ? "B站" : "抖音"}主动回忆案例 ${number}`;
  const account = `${platform === "bilibili" ? "记忆研究所" : "学习实验室"}${number}`;
  const evidence = rarity === "SSR"
    ? [
        {
          id: `${platform}-${number}-a`,
          type: "subtitle",
          text: `案例 ${number} 说明主动回忆的机制是先尝试提取信息，因为这个过程会暴露记忆缺口。`
        },
        {
          id: `${platform}-${number}-b`,
          type: "subtitle",
          text: `这一机制可以用于概念学习、语言学习和考试复习，并帮助学习者判断下一步练习。`
        }
      ]
    : [
        {
          id: `${platform}-${number}-a`,
          type: "subtitle",
          text: rarity === "SR"
            ? `案例 ${number} 说明主动回忆可以用于不同场景，帮助学习者判断需要再次练习的内容。`
            : `案例 ${number} 的操作提示是先尝试说出答案，再查看原始证据。`
        }
      ];
  return { number, platform, rarity, title, account, evidence };
});

const records = [];
for (const fixture of cases) {
  const startedAt = performance.now();
  try {
    const result = await runImageFlow({
      imageBase64: "aGVsbG8=",
      mimeType: "image/png",
      analyzeImage: async () => ({
        provider: "fixture-vision",
        model: "fixture",
        identity: {
          platform: fixture.platform,
          contentKind: "video",
          title: fixture.title,
          account: fixture.account,
          timestampSeconds: fixture.number,
          locatorTerms: ["主动回忆"],
          visibleTextLines: [fixture.title, fixture.account],
          confidence: 0.99
        },
        lines: [fixture.account, fixture.title]
      }),
      searcher: async (query) => ({
        provider: "fixture-search",
        query,
        results: [{
          platform: fixture.platform,
          contentKind: "video",
          title: fixture.title,
          account: fixture.account,
          url: fixture.platform === "bilibili"
            ? `https://www.bilibili.com/video/BVfixture${fixture.number}`
            : `https://www.douyin.com/video/${100_000 + fixture.number}`
        }]
      }),
      extract: async (input) => ({
        sourceTitle: fixture.title,
        sourceUrl: input.sourceUrl,
        sourceAccount: fixture.account,
        platform: fixture.platform,
        rawText: fixture.evidence.map((item) => item.text).join("\n"),
        overviewText: fixture.evidence.map((item) => item.text).join("\n"),
        blocks: fixture.evidence,
        focus: { status: "fixture", timestampSeconds: fixture.number }
      }),
      generateMemory: async (input) => generateCaptureMemoryCard(input, {
        modelJsonCaller: async () => modelOutput(fixture)
      }),
      generateOverview: async () => ({
        summary: "确定性合同回归不评估全片总结。",
        highlights: []
      })
    });
    const analysis = result.captureAnalysis;
    const evidenceIds = new Set(fixture.evidence.map((item) => item.id));
    const cardEvidenceIds = analysis?.memoryCard?.sourceEvidenceIds || [];
    const variants = analysis?.memoryCard?.recallVariants || [];
    records.push({
      id: `${fixture.platform}-${fixture.number}`,
      platform: fixture.platform,
      status: result.status,
      generated: analysis?.disposition === "create_card",
      evidenceConsistent: cardEvidenceIds.length > 0
        && cardEvidenceIds.every((id) => evidenceIds.has(id))
        && variants.every((variant) => (
          variant.sourceEvidenceIds.length > 0
          && variant.sourceEvidenceIds.every((id) => evidenceIds.has(id))
        )),
      questionsUsable: variants.length === 3
        && new Set(variants.map((variant) => variant.type)).size === 3,
      requestedRarity: fixture.rarity,
      rarity: analysis?.memoryCard?.rarity || null,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      failure: result.error?.code || (
        analysis?.disposition !== "create_card" ? analysis?.decisionReason : null
      )
    });
  } catch (error) {
    records.push({
      id: `${fixture.platform}-${fixture.number}`,
      platform: fixture.platform,
      status: "threw",
      generated: false,
      evidenceConsistent: false,
      questionsUsable: false,
      requestedRarity: fixture.rarity,
      rarity: null,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      failure: error?.message || String(error)
    });
  }
}

const latencies = records.map((record) => record.latencyMs).sort((a, b) => a - b);
const generated = records.filter((record) => record.generated);
const report = {
  schemaVersion: "capture_memory_fixture_benchmark_1",
  fixtureKind: "deterministic_contract_fixture_not_real_screenshot",
  generatedAt: new Date().toISOString(),
  sampleCount: records.length,
  platforms: countBy(records, (record) => record.platform),
  generationRate: ratio(generated.length, records.length),
  evidenceConsistencyRate: ratio(
    records.filter((record) => record.evidenceConsistent).length,
    records.length
  ),
  questionUsabilityRate: ratio(
    records.filter((record) => record.questionsUsable).length,
    records.length
  ),
  rarityDistribution: countBy(generated, (record) => record.rarity),
  latencyMs: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.at(-1) || 0
  },
  failures: records
    .filter((record) => record.failure)
    .map((record) => ({ id: record.id, reason: record.failure })),
  records
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function modelOutput(fixture) {
  const evidenceIds = fixture.evidence.map((item) => item.id);
  const hiddenSemantic = fixture.rarity === "R"
    ? "先尝试说出答案"
    : fixture.rarity === "SR"
      ? "可以用于不同场景"
      : "先尝试提取信息";
  const coreKnowledge = fixture.rarity === "R"
    ? `案例 ${fixture.number} 的操作提示是先尝试说出答案，再查看原始证据。`
    : fixture.rarity === "SR"
      ? `案例 ${fixture.number} 说明主动回忆可以用于不同场景，帮助判断需要再次练习的内容。`
      : `案例 ${fixture.number} 说明主动回忆的机制是先尝试提取信息，从而暴露记忆缺口。`;
  const correctText = fixture.rarity === "R"
    ? "先尝试说出答案"
    : fixture.rarity === "SR"
      ? "用于不同场景"
      : "暴露记忆缺口";
  return {
    disposition: "create_card",
    decisionReason: "内容包含一个清晰且可由证据支持的主动回忆点。",
    memoryCard: {
      coreKnowledge,
      recallCue: `案例 ${fixture.number} 最值得记住的动作或原理是什么？`,
      hiddenSemantic,
      explanation: fixture.evidence.map((item) => item.text).join(" "),
      sourceEvidenceIds: evidenceIds,
      rarity: fixture.rarity,
      rarityReason: fixture.rarity === "R"
        ? "证据支持一个局部操作提示。"
        : fixture.rarity === "SR"
          ? "证据说明这一方法可以用于不同场景。"
          : "证据同时说明机制和多个下游用途。",
      rarityConfidence: 0.92,
      recallVariants: [
        {
          id: `cloze-${fixture.number}`,
          type: "semantic_cloze",
          prompt: coreKnowledge.replace(hiddenSemantic, "____"),
          answer: hiddenSemantic,
          options: [],
          correctOptionId: null,
          correctBoolean: null,
          explanation: `承重语义是${hiddenSemantic}。`,
          sourceEvidenceIds: [evidenceIds[0]]
        },
        {
          id: `tf-${fixture.number}`,
          type: "true_false",
          prompt: coreKnowledge,
          answer: "true",
          options: [],
          correctOptionId: null,
          correctBoolean: true,
          explanation: fixture.evidence[0].text,
          sourceEvidenceIds: [evidenceIds[0]]
        },
        {
          id: `choice-${fixture.number}`,
          type: "multiple_choice",
          prompt: "哪一项最符合证据？",
          answer: correctText,
          options: [
            { id: "a", text: correctText },
            { id: "b", text: "继续被动浏览" },
            { id: "c", text: "扩大收藏数量" },
            { id: "d", text: "忽略原始证据" }
          ],
          correctOptionId: "a",
          correctBoolean: null,
          explanation: fixture.evidence[0].text,
          sourceEvidenceIds: [evidenceIds[0]]
        }
      ]
    }
  };
}

function countBy(values, selector) {
  return values.reduce((result, value) => {
    const key = selector(value) || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function ratio(value, total) {
  return total > 0 ? Math.round((value / total) * 10_000) / 10_000 : 0;
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}
