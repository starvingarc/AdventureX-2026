import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeVideoSourceUrl } from "./videoPlatforms.js";

export const VIDEO_SOURCE_CACHE_VERSION = "video-source-v1";
export const VIDEO_LEARNING_SOURCE_CACHE_VERSION = "video-learning-source-v2";

const DEFAULT_VIDEO_SOURCE_TTL_MS = readPositiveInt(
  process.env.VIDEO_SOURCE_CACHE_TTL_MS,
  7 * 24 * 60 * 60 * 1000
);
const DEFAULT_VIDEO_LEARNING_SOURCE_TTL_MS = readPositiveInt(
  process.env.VIDEO_LEARNING_SOURCE_CACHE_TTL_MS,
  30 * 24 * 60 * 60 * 1000
);
const DEFAULT_MAX_ENTRIES = readPositiveInt(process.env.VIDEO_EXTRACTION_CACHE_MAX_ENTRIES, 200);

let sharedVideoSourceCache = null;
let sharedLearningSourceCache = null;

export function getSharedVideoSourceCache() {
  if (!sharedVideoSourceCache) {
    sharedVideoSourceCache = createInMemoryTtlCache({
      ttlMs: DEFAULT_VIDEO_SOURCE_TTL_MS,
      maxEntries: DEFAULT_MAX_ENTRIES
    });
  }
  return sharedVideoSourceCache;
}

export function getSharedLearningSourceCache() {
  if (!sharedLearningSourceCache) {
    sharedLearningSourceCache = createInMemoryTtlCache({
      ttlMs: DEFAULT_VIDEO_LEARNING_SOURCE_TTL_MS,
      maxEntries: DEFAULT_MAX_ENTRIES
    });
  }
  return sharedLearningSourceCache;
}

export function createInMemoryTtlCache({
  ttlMs,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now()
} = {}) {
  const entries = new Map();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Number.isFinite(entry.expiresAt) && entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return cloneCacheValue(entry.value);
    },
    async set(key, value) {
      if (!key || value == null) return;
      entries.set(key, {
        value: cloneCacheValue(value),
        expiresAt: Number.isFinite(ttlMs) && ttlMs > 0 ? now() + ttlMs : null
      });
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        entries.delete(oldestKey);
      }
    },
    async delete(key) {
      if (!key) return false;
      return entries.delete(key);
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    }
  };
}

export function createFileTtlCache({
  dir,
  ttlMs,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now()
} = {}) {
  if (!dir) throw new Error("createFileTtlCache requires dir");

  return {
    async get(key) {
      if (!key) return null;
      const filePath = cacheFilePath(dir, key);
      let entry;
      try {
        entry = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        await rm(filePath, { force: true });
        return null;
      }
      if (entry?.key !== key) return null;
      if (Number.isFinite(entry.expiresAt) && entry.expiresAt <= now()) {
        await rm(filePath, { force: true });
        return null;
      }
      await writeCacheFile(filePath, entry);
      return cloneCacheValue(entry.value);
    },
    async set(key, value) {
      if (!key || value == null) return;
      await mkdir(dir, { recursive: true });
      await writeCacheFile(cacheFilePath(dir, key), {
        key,
        value: cloneCacheValue(value),
        expiresAt: Number.isFinite(ttlMs) && ttlMs > 0 ? now() + ttlMs : null
      });
      await enforceFileCacheLimit(dir, maxEntries);
    },
    async delete(key) {
      if (!key) return false;
      const filePath = cacheFilePath(dir, key);
      try {
        await rm(filePath, { force: false });
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    async size() {
      try {
        return (await readdir(dir)).filter((name) => name.endsWith(".json")).length;
      } catch (error) {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
    },
    async clear() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

export function buildVideoSourceCacheKey({ sourceUrl, rawText = "" } = {}) {
  return buildVersionedCacheKey({
    prefix: "video-source",
    version: VIDEO_SOURCE_CACHE_VERSION,
    value: normalizeCacheInput(sourceUrl || rawText)
  });
}

export function buildVideoLearningSourceCacheKey({
  sourceUrl,
  rawText = "",
  extractionVersion = VIDEO_LEARNING_SOURCE_CACHE_VERSION,
  extractionSignature = ""
} = {}) {
  return buildVersionedCacheKey({
    prefix: "video-learning-source",
    version: extractionSignature || extractionVersion,
    value: normalizeCacheInput(sourceUrl || rawText)
  });
}

export function buildVideoExtractionSignature({
  sourceProvider = "",
  asrProvider = "",
  asrMode = "full",
  frameProvider = "",
  visualProvider = "",
  visualModel = "",
  version = VIDEO_LEARNING_SOURCE_CACHE_VERSION
} = {}) {
  return [
    version,
    `source:${String(sourceProvider || "default")}`,
    `asr:${String(asrProvider || "default")}`,
    `asrMode:${String(asrMode || "full")}`,
    `frame:${String(frameProvider || "none")}`,
    `visual:${String(visualProvider || "none")}`,
    `visualModel:${String(visualModel || "none")}`
  ].join("|");
}

export async function readCache(cache, key) {
  if (!cache || !key || typeof cache.get !== "function") return null;
  const value = await cache.get(key);
  return value == null ? null : cloneCacheValue(value);
}

export async function writeCache(cache, key, value) {
  if (!cache || !key || typeof cache.set !== "function") return;
  await cache.set(key, cloneCacheValue(value));
}

export async function deleteCache(cache, key) {
  if (!cache || !key || typeof cache.delete !== "function") return false;
  return cache.delete(key);
}

export function cloneCacheValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function buildVersionedCacheKey({ prefix, version, value }) {
  return `${prefix}:${version}:${hashValue(value)}`;
}

function normalizeCacheInput(value) {
  const url = normalizeVideoSourceUrl(value);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.href;
}

function hashValue(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cacheFilePath(dir, key) {
  return join(dir, `${hashValue(key)}.json`);
}

async function writeCacheFile(filePath, entry) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entry)}\n`);
}

async function enforceFileCacheLimit(dir, maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) return;
  let names;
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (names.length <= maxEntries) return;
  const files = await Promise.all(names.map(async (name) => {
    const filePath = join(dir, name);
    const stats = await stat(filePath);
    return { filePath, mtimeMs: stats.mtimeMs };
  }));
  await Promise.all(
    files
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(0, Math.max(0, files.length - maxEntries))
      .map((file) => rm(file.filePath, { force: true }))
  );
}
