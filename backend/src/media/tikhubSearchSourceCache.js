const entries = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 128;

export function primeTikHubSearchSource(sourceUrl, content, {
  now = Date.now(),
  ttlMs = readPositiveInt(process.env.TIKHUB_SEARCH_SOURCE_CACHE_TTL_MS, DEFAULT_TTL_MS)
} = {}) {
  const key = normalizeKey(sourceUrl);
  if (!key || !content?.mediaUrl) return false;
  purge(now);
  entries.set(key, { content, expiresAt: now + ttlMs });
  while (entries.size > DEFAULT_MAX_ENTRIES) entries.delete(entries.keys().next().value);
  return true;
}

export function readTikHubSearchSource(sourceUrl, { now = Date.now() } = {}) {
  purge(now);
  const item = entries.get(normalizeKey(sourceUrl));
  return item?.content || null;
}

export function clearTikHubSearchSourceCache() {
  entries.clear();
}

function purge(now) {
  for (const [key, item] of entries) {
    if (item.expiresAt <= now) entries.delete(key);
  }
}

function normalizeKey(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
