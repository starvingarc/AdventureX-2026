import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildVideoExtractionSignature,
  buildVideoLearningSourceCacheKey,
  buildVideoSourceCacheKey,
  createFileTtlCache,
  createInMemoryTtlCache
} from "./videoExtractionCache.js";

test("builds stable video source cache keys for reordered query params", () => {
  const first = buildVideoSourceCacheKey({
    sourceUrl: "https://www.xiaohongshu.com/discovery/item/123?b=2&a=1#ignored"
  });
  const second = buildVideoSourceCacheKey({
    sourceUrl: "https://www.xiaohongshu.com/discovery/item/123?a=1&b=2"
  });

  assert.equal(first, second);
});

test("builds distinct learning source cache keys for different extraction signatures", () => {
  const firstSignature = buildVideoExtractionSignature({
    asrProvider: "local_whisper",
    frameProvider: "crv_style_ffmpeg",
    visualProvider: "qwen-vl",
    visualModel: "qwen3-vl-flash"
  });
  const secondSignature = buildVideoExtractionSignature({
    asrProvider: "local_whisper",
    frameProvider: "crv_style_ffmpeg",
    visualProvider: "qwen-vl",
    visualModel: "qwen3-vl-plus"
  });

  const first = buildVideoLearningSourceCacheKey({
    sourceUrl: "https://v.douyin.com/cache-signature/",
    extractionSignature: firstSignature
  });
  const second = buildVideoLearningSourceCacheKey({
    sourceUrl: "https://v.douyin.com/cache-signature/",
    extractionSignature: secondSignature
  });

  assert.notEqual(firstSignature, secondSignature);
  assert.notEqual(first, second);
});

test("expires in-memory cache entries after ttl", async () => {
  let currentTime = 1_000;
  const cache = createInMemoryTtlCache({
    ttlMs: 100,
    now: () => currentTime
  });

  await cache.set("key-1", { value: "cached" });
  assert.deepEqual(await cache.get("key-1"), { value: "cached" });

  currentTime = 1_101;
  assert.equal(await cache.get("key-1"), null);
});

test("deletes in-memory cache entries", async () => {
  const cache = createInMemoryTtlCache({ ttlMs: 60_000 });

  await cache.set("key-1", { value: "cached" });
  assert.equal(cache.size(), 1);
  assert.equal(await cache.delete("key-1"), true);
  assert.equal(cache.size(), 0);
  assert.equal(await cache.get("key-1"), null);
});

test("persists file cache entries across cache instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shibei-video-cache-"));
  try {
    const first = createFileTtlCache({ dir, ttlMs: 60_000 });
    const second = createFileTtlCache({ dir, ttlMs: 60_000 });

    await first.set("learning-source:key", {
      title: "费曼学习法",
      nested: { value: "cached" }
    });

    assert.deepEqual(await second.get("learning-source:key"), {
      title: "费曼学习法",
      nested: { value: "cached" }
    });
    assert.equal(await second.size(), 1);
    assert.equal(await second.delete("learning-source:key"), true);
    assert.equal(await first.get("learning-source:key"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("expires file cache entries after ttl", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shibei-video-cache-"));
  let currentTime = 1_000;
  try {
    const cache = createFileTtlCache({
      dir,
      ttlMs: 100,
      now: () => currentTime
    });

    await cache.set("key-1", { value: "cached" });
    assert.deepEqual(await cache.get("key-1"), { value: "cached" });

    currentTime = 1_101;
    assert.equal(await cache.get("key-1"), null);
    assert.equal(await cache.size(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("limits file cache entries by removing older files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shibei-video-cache-"));
  try {
    const cache = createFileTtlCache({ dir, ttlMs: 60_000, maxEntries: 2 });

    await cache.set("key-1", { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cache.set("key-2", { value: 2 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await cache.set("key-3", { value: 3 });

    assert.equal(await cache.size(), 2);
    assert.equal(await cache.get("key-1"), null);
    assert.deepEqual(await cache.get("key-2"), { value: 2 });
    assert.deepEqual(await cache.get("key-3"), { value: 3 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
