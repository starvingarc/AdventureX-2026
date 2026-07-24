const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.io";

export async function searchLinks(query, {
  maxResults = 10,
  platform = "",
  fetchImpl = fetch,
  timeoutMs = Number(process.env.SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  apiUrl = process.env.SEARCH_API_URL || "",
  tikhubApiKey = process.env.TIKHUB_API_KEY || "",
  tikhubBaseUrl = process.env.TIKHUB_BASE_URL || DEFAULT_TIKHUB_BASE_URL
} = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return { provider: "none", query: "", results: [] };
  if (apiUrl) return callGenericSearch(cleanQuery, { apiUrl, maxResults, fetchImpl, timeoutMs });
  if (tikhubApiKey) return callTikHub(cleanQuery, { apiKey: tikhubApiKey, baseUrl: tikhubBaseUrl, maxResults, fetchImpl, timeoutMs, platform });
  if (process.env.TAVILY_API_KEY) return callTavily(cleanQuery, { maxResults, fetchImpl, timeoutMs });
  if (process.env.SERPER_API_KEY) return callSerper(cleanQuery, { maxResults, fetchImpl, timeoutMs });
  return { provider: "none", query: cleanQuery, results: [], errorCode: "search_provider_missing" };
}

async function callTikHub(query, options) {
  const requestedPlatform = normalizeTikHubPlatform(options.platform);
  const platforms = requestedPlatform ? [requestedPlatform] : detectTikHubSearchPlatforms(query);
  const settled = await Promise.allSettled(
    platforms.map((platform) => callTikHubPlatform(platform, query, options))
  );
  const rawResults = settled
    .filter((item) => item.status === "fulfilled")
    // Keep candidates from every platform. The old global slice happened
    // after Bilibili was flattened first, silently discarding Douyin/XHS.
    .flatMap((item) => item.value.slice(0, options.maxResults))
    .filter((item, index, items) => item.url && items.findIndex((candidate) => candidate.url === item.url) === index);
  let results = await hydrateTikHubSearchResults(rawResults, options);
  if (options.creatorFallback && requestedPlatform === "bilibili" && options.account) {
    const creatorResults = await fetchBilibiliCreatorVideos({
      account: options.account,
      searchResults: results,
      ...options
    }).catch(() => []);
    results = [...results, ...creatorResults]
      .filter((item, index, items) => item.url && items.findIndex((candidate) => candidate.url === item.url) === index);
  }
  if (results.length === 0) {
    const failure = settled.find((item) => item.status === "rejected");
    if (failure) throw failure.reason;
  }
  return { provider: "tikhub", query, platforms, results };
}

function normalizeTikHubPlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  return ["bilibili", "douyin", "xiaohongshu"].includes(platform) ? platform : "";
}

async function callTikHubPlatform(platform, query, { apiKey, baseUrl, fetchImpl, timeoutMs, maxResults }) {
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  let url;
  let request;
  if (platform === "bilibili") {
    const params = new URLSearchParams({
      keyword: query,
      order: "totalrank",
      page: "1",
      page_size: String(Math.min(50, Math.max(10, Number(maxResults) || 10)))
    });
    url = `${root}/api/v1/bilibili/web/fetch_general_search?${params}`;
    request = { method: "GET", headers };
  } else if (platform === "xiaohongshu") {
    const params = new URLSearchParams({ keyword: query, page: "1" });
    url = `${root}/api/v1/xiaohongshu/web_v3/fetch_search_notes?${params}`;
    request = { method: "GET", headers };
  } else {
    url = `${root}/api/v1/douyin/search/fetch_general_search_v2`;
    request = {
      method: "POST",
      headers,
      body: JSON.stringify({
        keyword: query,
        cursor: 0,
        sort_type: "0",
        publish_time: "0",
        filter_duration: "0",
        content_type: "0",
        search_id: "",
        backtrace: ""
      })
    };
  }
  const payload = await requestJsonWithRetry(url, request, { fetchImpl, timeoutMs, attempts: 2 });
  return normalizeTikHubResults(platform, payload);
}

function detectTikHubSearchPlatforms(query) {
  const value = String(query || "");
  if (/哔哩|bilibili|B站|巫师财经/i.test(value)) return ["bilibili"];
  if (/小红书|xiaohongshu|xhs/i.test(value)) return ["xiaohongshu"];
  if (/抖音|douyin/i.test(value)) return ["douyin"];
  return ["bilibili", "douyin", "xiaohongshu"];
}

function normalizeTikHubResults(platform, payload) {
  const items = findTikHubItems(platform, payload);
  return items.map((item) => normalizeTikHubItem(platform, item)).filter((item) => item.url);
}

function findTikHubItems(platform, payload) {
  const candidates = platform === "bilibili"
    ? [payload?.data?.result, payload?.data?.data?.result, payload?.result]
    : platform === "xiaohongshu"
      ? [payload?.data?.data?.items, payload?.data?.items, payload?.data?.data, payload?.items]
      : [
          payload?.data?.business_data,
          payload?.data?.data?.business_data,
          payload?.data?.data,
          payload?.data?.data?.data,
          payload?.data?.items,
          payload?.items
        ];
  return candidates.find(Array.isArray) || [];
}

function normalizeTikHubItem(platform, item) {
  if (platform === "bilibili") {
    const data = item?.video || item;
    const bvid = cleanValue(data?.bvid);
    return {
      platform,
      title: stripHtml(data?.title || data?.name),
      url: cleanValue(data?.arcurl || data?.url) || (bvid ? `https://www.bilibili.com/video/${bvid}` : ""),
      account: cleanValue(data?.author || data?.up_name),
      accountId: cleanValue(data?.mid || data?.uid),
      snippet: cleanValue(data?.description || data?.desc || data?.author || data?.up_name)
    };
  }
  if (platform === "xiaohongshu") {
    const data = item?.note_card || item?.note || item;
    const id = cleanValue(data?.note_id || data?.id || item?.id);
    return {
      platform,
      title: cleanValue(data?.display_title || data?.title || data?.desc),
      url: cleanValue(data?.url || data?.share_url || item?.url) || (id ? `https://www.xiaohongshu.com/explore/${id}` : ""),
      account: cleanValue(data?.user?.nickname || data?.user_info?.nickname),
      snippet: cleanValue(data?.desc || data?.user?.nickname || data?.user_info?.nickname)
    };
  }
  const data = item?.data?.aweme_info || item?.aweme_info || item?.aweme_detail || item;
  const id = cleanValue(data?.aweme_id || data?.id);
  return {
    platform,
    title: cleanValue(data?.desc || data?.caption || data?.title),
    // Prefer the stable canonical URL. Search share URLs use iesdouyin.com and
    // contain short-lived tracking parameters that should not enter caches.
    url: id ? `https://www.douyin.com/video/${id}` : cleanValue(data?.share_url || data?.url),
    account: cleanValue(data?.author?.nickname || data?.author?.unique_id),
    snippet: cleanValue(data?.author?.nickname || data?.author?.unique_id || data?.desc)
  };
}

async function fetchBilibiliCreatorVideos({ account, searchResults, apiKey, baseUrl, fetchImpl, timeoutMs }) {
  const normalizedAccount = normalizeComparableText(account);
  const owner = searchResults.find((item) => (
    item.accountId && normalizeComparableText(item.account) === normalizedAccount
  ));
  if (!owner?.accountId) return [];
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const params = new URLSearchParams({
    user_id: owner.accountId,
    post_filter: "archive",
    page: "1",
    ps: "30"
  });
  const payload = await requestJson(`${root}/api/v1/bilibili/app/fetch_user_videos?${params}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  }, { fetchImpl, timeoutMs: Math.max(timeoutMs, 12_000) });
  const items = payload?.data?.data?.item
    || payload?.data?.data?.data?.item
    || payload?.data?.item
    || [];
  return (Array.isArray(items) ? items : []).map((item) => {
    const aid = cleanValue(item?.param || item?.aid);
    const bvid = cleanValue(item?.bvid);
    return {
      platform: "bilibili",
      title: cleanValue(item?.title),
      url: bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : "",
      account: cleanValue(item?.author).replace(/\s*等联合创作$/, "") || account,
      accountId: owner.accountId,
      snippet: cleanValue(item?.subtitle || item?.tname || account),
      discovery: "creator_posts"
    };
  }).filter((item) => item.url && item.title);
}

function normalizeComparableText(value) {
  return String(value || "").toLowerCase().replace(/[^\u4e00-\u9fff0-9a-z]/g, "");
}

async function hydrateTikHubSearchResults(results, { fetchImpl, timeoutMs }) {
  const missingBilibiliTitles = results.filter((item) => !item.title && bilibiliVideoId(item.url));
  if (missingBilibiliTitles.length === 0) return results;
  const metadata = await Promise.all(missingBilibiliTitles.map((item) => fetchBilibiliSearchMetadata(item.url, { fetchImpl, timeoutMs })));
  const byUrl = new Map(metadata.filter(Boolean).map((item) => [item.url, item]));
  return results.map((item) => ({ ...item, ...(byUrl.get(item.url) || {}) }));
}

async function fetchBilibiliSearchMetadata(sourceUrl, { fetchImpl, timeoutMs }) {
  const id = bilibiliVideoId(sourceUrl);
  if (!id) return null;
  try {
    const query = new URLSearchParams({ [id.key]: id.value });
    const payload = await requestJson(`https://api.bilibili.com/x/web-interface/view?${query}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    }, { fetchImpl, timeoutMs });
    const data = payload?.data;
    if (!data?.title) return null;
    return {
      url: sourceUrl,
      title: stripHtml(data.title),
      account: cleanValue(data?.owner?.name),
      snippet: cleanValue(data?.desc || data?.owner?.name)
    };
  } catch {
    // Search remains usable when Bilibili's metadata endpoint is temporarily unavailable.
    return null;
  }
}

function bilibiliVideoId(value) {
  try {
    const path = new URL(String(value)).pathname;
    const match = path.match(/\/(BV[0-9A-Za-z]+|av\d+)/i);
    if (!match) return null;
    return /^av/i.test(match[1])
      ? { key: "aid", value: match[1].slice(2) }
      : { key: "bvid", value: match[1] };
  } catch {
    return null;
  }
}

function stripHtml(value) {
  return cleanValue(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanValue(value) {
  return String(value || "").trim();
}

async function callTavily(query, options) {
  const payload = await requestJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: options.maxResults, search_depth: "basic" })
  }, options);
  return normalizeResults("tavily", query, payload?.results);
}

async function callSerper(query, options) {
  const payload = await requestJson("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.SERPER_API_KEY },
    body: JSON.stringify({ q: query, num: options.maxResults })
  }, options);
  return normalizeResults("serper", query, payload?.organic);
}

async function callGenericSearch(query, { apiUrl, maxResults, ...options }) {
  const headers = { "content-type": "application/json" };
  const key = process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY || "";
  if (key) headers.authorization = `Bearer ${key}`;
  const payload = await requestJson(apiUrl, {
    method: "POST", headers,
    body: JSON.stringify({ query, max_results: maxResults })
  }, options);
  return normalizeResults("generic", query, payload?.results || payload?.organic || payload?.data);
}

async function requestJson(url, options, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || `search http ${response.status}`);
    return body || {};
  } finally {
    clearTimeout(timer);
  }
}

async function requestJsonWithRetry(url, options, { attempts = 2, ...context }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(url, options, context);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

function normalizeResults(provider, query, items) {
  const results = (Array.isArray(items) ? items : []).map((item) => ({
    title: String(item?.title || item?.name || "").trim(),
    url: String(item?.url || item?.link || item?.href || "").trim(),
    snippet: String(item?.content || item?.snippet || item?.description || "").trim()
  })).filter((item) => /^https?:\/\//i.test(item.url));
  return { provider, query, results };
}
