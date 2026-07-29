import assert from "node:assert/strict";
import test from "node:test";

import { pickStrictCandidate, verifyScreenshotSource } from "../src/sourceVerifier.js";

test("requires both Bilibili title and creator to verify a source", () => {
  const match = pickStrictCandidate([
    { title: "告别信息差，AI+投行分析框架，1天摸透", account: "另一个UP", url: "https://bilibili.com/video/av1" },
    { title: "告别信息差，AI+投行分析框架，1天摸透", account: "Xuan_酱", url: "https://bilibili.com/video/av2" }
  ], { sourceTitle: "告别信息差 AI投行分析框架 1天摸透", sourceAccount: "Xuan_酱" });

  assert.equal(match.url, "https://bilibili.com/video/av2");
  assert.ok(match.accountSimilarity >= 0.62);
});

test("normalizes TikHub Bilibili APP search results", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 200,
    data: { data: { items: [{ param: "123", av: { title: "<em>财经跨年</em>：中国财经年度盘点Top10", author: "巫师财经" } }] } }
  }), { status: 200, headers: { "content-type": "application/json" } });

  const source = await verifyScreenshotSource({
    platform: "bilibili",
    sourceTitle: "财经跨年 中国财经年度盘点Top10",
    sourceAccount: "巫师财经"
  }, { apiKey: "test-key", fetchImpl });

  assert.equal(source.status, "verified");
  assert.equal(source.url, "https://www.bilibili.com/video/av123");
});

test("missing TikHub configuration remains screenshot-only with an explicit reason", async () => {
  const source = await verifyScreenshotSource({
    platform: "bilibili",
    sourceTitle: "标题",
    sourceAccount: "作者"
  }, { apiKey: "" });

  assert.equal(source.status, "screenshot_only");
  assert.equal(source.reason, "provider_missing");
});

test("TikHub timeout never becomes a verified source", async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error("provider secret"), { name: "TimeoutError" });
  };
  const source = await verifyScreenshotSource({
    platform: "bilibili",
    sourceTitle: "标题",
    sourceAccount: "作者"
  }, {
    apiKey: "test-key",
    baseURL: "https://tikhub.example",
    timeoutMs: 10,
    fetchImpl
  });

  assert.equal(source.status, "screenshot_only");
  assert.equal(source.reason, "provider_timeout");
});

test("TikHub upstream rejection remains screenshot-only and does not expose its body", async () => {
  const fetchImpl = async () => new Response("upstream-secret", { status: 503 });
  const source = await verifyScreenshotSource({
    platform: "bilibili",
    sourceTitle: "标题",
    sourceAccount: "作者"
  }, {
    apiKey: "test-key",
    baseURL: "https://tikhub.example",
    timeoutMs: 10,
    fetchImpl
  });

  assert.equal(source.status, "screenshot_only");
  assert.equal(source.reason, "provider_unavailable");
  assert.equal(JSON.stringify(source).includes("upstream-secret"), false);
});
