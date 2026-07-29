const TIKHUB_ROOT = "https://api.tikhub.io";

export async function verifyScreenshotSource(identity, {
  apiKey = process.env.TICKHUB_API_KEY || "",
  fetchImpl = fetch
} = {}) {
  const platform = String(identity?.platform || "").toLowerCase();
  const title = clean(identity?.sourceTitle);
  const account = clean(identity?.sourceAccount);
  if (!apiKey || platform !== "bilibili" || !title || !account) {
    return unresolved(platform, apiKey ? "identity_incomplete" : "provider_missing");
  }

  const queries = [...new Set([title, `${account} ${title}`])].slice(0, 2);
  const candidates = [];
  for (const query of queries) {
    const results = await searchBilibili(query, { apiKey, fetchImpl });
    candidates.push(...results);
    const match = pickStrictCandidate(candidates, { title, account });
    if (match) return { ...match, status: "verified", provider: "tikhub" };
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

async function searchBilibili(keyword, { apiKey, fetchImpl }) {
  const endpoint = new URL(`${process.env.TIKHUB_BASE_URL || TIKHUB_ROOT}/api/v1/bilibili/app/fetch_search_by_type`);
  endpoint.searchParams.set("keyword", keyword);
  endpoint.searchParams.set("search_type", "video");
  endpoint.searchParams.set("page_size", "20");
  endpoint.searchParams.set("order", "0");

  const response = await fetchImpl(endpoint, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(Number(process.env.TIKHUB_TIMEOUT_MS || 15_000))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || ![undefined, 0, 200].includes(payload.code)) return [];
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
