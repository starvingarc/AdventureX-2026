import { readRuntimeConfig } from "./runtimeConfig.js";

export async function verifyScreenshotSource(identity, {
  apiKey,
  baseURL,
  timeoutMs,
  fetchImpl = fetch
} = {}) {
  const runtime = readRuntimeConfig();
  const providerConfig = {
    apiKey: apiKey ?? runtime.tikhub.apiKey,
    baseURL: baseURL ?? runtime.tikhub.baseURL,
    timeoutMs: timeoutMs ?? runtime.tikhub.timeoutMs
  };
  const platform = String(identity?.platform || "").toLowerCase();
  const title = clean(identity?.sourceTitle);
  const account = clean(identity?.sourceAccount);
  if (!providerConfig.apiKey || platform !== "bilibili" || !title || !account) {
    return unresolved(
      platform,
      providerConfig.apiKey ? "identity_incomplete" : "provider_missing"
    );
  }

  const queries = [...new Set([title, `${account} ${title}`])].slice(0, 2);
  const candidates = [];
  try {
    for (const query of queries) {
      const results = await searchBilibili(query, { ...providerConfig, fetchImpl });
      candidates.push(...results);
      const match = pickStrictCandidate(candidates, { title, account });
      if (match) return { ...match, status: "verified", provider: "tikhub", reason: "" };
    }
  } catch (error) {
    return unresolved(platform, sourceFailureReason(error));
  }
  return unresolved(platform, "strict_match_not_found");
}

export function pickStrictCandidate(candidates, identity) {
  const expectedTitle = comparable(identity?.title || identity?.sourceTitle);
  const expectedAccount = comparable(identity?.account || identity?.sourceAccount);
  if (!expectedTitle || !expectedAccount) return null;

  return candidates
    .map((candidate) => {
      const titleSimilarity = similarity(expectedTitle, comparable(candidate.title));
      const accountSimilarity = similarity(expectedAccount, comparable(candidate.account));
      return {
        ...candidate,
        titleSimilarity,
        accountSimilarity,
        confidence: Number((titleSimilarity * 0.72 + accountSimilarity * 0.28).toFixed(3))
      };
    })
    .filter((item) => item.url && item.titleSimilarity >= 0.42 && item.accountSimilarity >= 0.62)
    .sort((left, right) => right.confidence - left.confidence)[0] || null;
}

async function searchBilibili(keyword, { apiKey, baseURL, timeoutMs, fetchImpl }) {
  let endpoint;
  try {
    endpoint = new URL("/api/v1/bilibili/app/fetch_search_by_type", `${baseURL}/`);
  } catch {
    throw sourceError("provider_config_invalid");
  }
  endpoint.searchParams.set("keyword", keyword);
  endpoint.searchParams.set("search_type", "video");
  endpoint.searchParams.set("page_size", "20");
  endpoint.searchParams.set("order", "0");

  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (isTimeout(error)) throw sourceError("provider_timeout");
    throw sourceError("provider_unavailable");
  }
  if (!response.ok) throw sourceError("provider_unavailable");

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw sourceError("provider_invalid_response");
  }
  if (![undefined, 0, 200].includes(payload.code)) {
    throw sourceError("provider_rejected");
  }
  const items = payload?.data?.data?.items || payload?.data?.items || [];
  return items.map((item) => {
    const video = item?.av || item?.video || item;
    const aid = clean(item?.param || video?.aid);
    const bvid = clean(video?.bvid);
    return {
      platform: "bilibili",
      title: stripHTML(video?.title || video?.name),
      account: clean(video?.author || video?.up_name),
      url: clean(video?.arcurl || video?.url)
        || (bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : "")
    };
  }).filter((item) => item.title && item.url);
}

function unresolved(platform, reason) {
  return { status: "screenshot_only", provider: "tikhub", platform: platform || "unknown", reason };
}

function sourceFailureReason(error) {
  return error?.sourceCode || (isTimeout(error) ? "provider_timeout" : "provider_unavailable");
}

function sourceError(sourceCode) {
  return Object.assign(new Error("Source verification failed."), { sourceCode });
}

function isTimeout(error) {
  return ["AbortError", "TimeoutError"].includes(error?.name);
}

function similarity(left, right) {
  if (!left || !right) return 0;
  if (left === right || left.includes(right) || right.includes(left)) return 1;
  const leftPairs = pairs(left);
  const rightPairs = pairs(right);
  const common = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * common) / (leftPairs.size + rightPairs.size || 1);
}

function pairs(value) {
  if (value.length < 2) return new Set([value]);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

function comparable(value) {
  return stripHTML(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function stripHTML(value) {
  return clean(value).replace(/<[^>]+>/g, "");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
