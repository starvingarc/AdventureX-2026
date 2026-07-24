import { primeTikHubSearchSource } from "../media/tikhubSearchSourceCache.js";
import { normalizeTikHubContent } from "../sources/tikhubContentProvider.js";

// Hedged Douyin searches normally complete in 3-7 seconds. Keep enough room
// for one slow upstream response without returning a raw AbortError to the UI.
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.io";
const searchCache = new Map();

export async function searchLinks(query, {
  maxResults = 10,
  platform = "",
  account = "",
  creatorFallback = false,
  fetchImpl = fetch,
  timeoutMs = Number(process.env.SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  apiUrl = process.env.SEARCH_API_URL || "",
  tikhubApiKey = process.env.TIKHUB_API_KEY || "",
  tikhubBaseUrl = process.env.TIKHUB_BASE_URL || DEFAULT_TIKHUB_BASE_URL
} = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return { provider: "none", query: "", results: [] };
  if (apiUrl) return callGenericSearch(cleanQuery, { apiUrl, maxResults, fetchImpl, timeoutMs });
  if (tikhubApiKey) return callTikHub(cleanQuery, {
    apiKey: tikhubApiKey,
    baseUrl: tikhubBaseUrl,
    maxResults,
    fetchImpl,
    timeoutMs,
    platform,
    account,
    creatorFallback
  });
  if (process.env.TAVILY_API_KEY) return callTavily(cleanQuery, { maxResults, fetchImpl, timeoutMs });
  if (process.env.SERPER_API_KEY) return callSerper(cleanQuery, { maxResults, fetchImpl, timeoutMs });
  return { provider: "none", query: cleanQuery, results: [], errorCode: "search_provider_missing" };
}

async function callTikHub(query, options) {
  let effectiveOptions = options;
  if (options.fetchImpl === fetch && options.creatorFallback) {
    const platform = normalizeTikHubPlatform(options.platform) || "all";
    const standardKey = [platform, query, options.maxResults, "standard"].join(":");
    const standardSearch = readSearchCache(standardKey);
    if (standardSearch) {
      const seed = await standardSearch.catch(() => null);
      if (Array.isArray(seed?.results)) effectiveOptions = { ...options, seedResults: seed.results };
    }
  }
  const cacheKey = effectiveOptions.fetchImpl === fetch
    ? [
        normalizeTikHubPlatform(effectiveOptions.platform) || "all",
        query,
        effectiveOptions.maxResults,
        effectiveOptions.creatorFallback ? `creator:${normalizeComparableText(effectiveOptions.account)}` : "standard"
      ].join(":")
    : "";
  const cached = readSearchCache(cacheKey);
  if (cached) return cached;
  const pending = callTikHubUncached(query, effectiveOptions);
  if (cacheKey) writeSearchCache(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    if (cacheKey) searchCache.delete(cacheKey);
    throw error;
  }
}

async function callTikHubUncached(query, options) {
  const requestedPlatform = normalizeTikHubPlatform(options.platform);
  const platforms = requestedPlatform ? [requestedPlatform] : detectTikHubSearchPlatforms(query);
  const settled = Array.isArray(options.seedResults)
    ? []
    : await Promise.allSettled(platforms.map((platform) => callTikHubPlatform(platform, query, options)));
  const rawResults = (Array.isArray(options.seedResults)
    ? options.seedResults
    : settled
      .filter((item) => item.status === "fulfilled")
      // Keep candidates from every platform. The old global slice happened
      // after Bilibili was flattened first, silently discarding Douyin/XHS.
      .flatMap((item) => item.value.slice(0, options.maxResults)))
    .filter((item, index, items) => item.url && items.findIndex((candidate) => candidate.url === item.url) === index);
  let results = await hydrateTikHubSearchResults(rawResults, options);
  if (options.creatorFallback && ["bilibili", "douyin"].includes(requestedPlatform) && options.account) {
    const creatorResults = requestedPlatform === "bilibili"
      ? await fetchBilibiliCreatorVideos({
          account: options.account,
          searchResults: results,
          ...options
        }).catch(() => [])
      : await fetchDouyinCreatorPosts({
          account: options.account,
          query,
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
  return ["bilibili", "douyin", "xiaohongshu", "wechat", "zhihu"].includes(platform) ? platform : "";
}

async function callTikHubPlatform(platform, query, { apiKey, baseUrl, fetchImpl, timeoutMs, maxResults, account }) {
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  let url;
  let request;
  if (platform === "bilibili") {
    const params = new URLSearchParams({
      keyword: query,
      search_type: "video",
      cursor: "",
      // Bilibili's APP search changes ranking when page_size is only 10 and
      // can omit an otherwise exact title. Fetch 20, then keep maxResults.
      page_size: "20",
      order: "0"
    });
    url = `${root}/api/v1/bilibili/app/fetch_search_by_type?${params}`;
    request = { method: "GET", headers };
  } else if (platform === "xiaohongshu") {
    const params = new URLSearchParams({
      keyword: query,
      page: "1",
      sort_type: "general",
      note_type: "不限",
      time_filter: "不限"
    });
    url = `${root}/api/v1/xiaohongshu/app_v2/search_notes?${params}`;
    request = { method: "GET", headers };
  } else if (platform === "wechat") {
    url = `${root}/api/v1/wechat_search/v2/fetch_search`;
    request = {
      method: "POST",
      headers,
      body: JSON.stringify({
        keyword: query,
        business_type: "article",
        sort: "default",
        publish_time: "all",
        offset: 0,
        raw: false
      })
    };
  } else if (platform === "zhihu") {
    return searchZhihuContent({ query, account, apiKey, root, fetchImpl, timeoutMs, maxResults });
  } else {
    // Screenshots can point at ordinary videos, image posts or animated image
    // posts. TikHub's general endpoint returns all of those; the old
    // video-only search silently discarded aweme_type=68 posts.
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
    try {
      const payload = await requestJsonWithRetry(
        `${root}/api/v1/douyin/search/fetch_general_search_v1`,
        request,
        { fetchImpl, timeoutMs, attempts: 2 }
      );
      const results = normalizeTikHubResults("douyin", payload);
      if (results.length) return results;
    } catch {
      // Older TikHub deployments may not expose general search. Preserve the
      // video V2/V1 hedge as a compatibility fallback.
    }
    const videoRequest = {
      ...request,
      body: JSON.stringify({
        keyword: query,
        cursor: 0,
        sort_type: "0",
        publish_time: "0",
        filter_duration: "0",
        content_type: "1",
        search_id: "",
        backtrace: ""
      })
    };
    return callHedgedDouyinSearch({ root, request: videoRequest, fetchImpl, timeoutMs });
  }
  const payload = await requestJsonWithRetry(url, request, { fetchImpl, timeoutMs, attempts: 2 });
  return normalizeTikHubResults(platform, payload);
}

function callHedgedDouyinSearch({ root, request, fetchImpl, timeoutMs }) {
  const requestEndpoint = async (version) => {
    const payload = await requestJson(
      `${root}/api/v1/douyin/search/fetch_video_search_${version}`,
      request,
      { fetchImpl, timeoutMs }
    );
    const results = normalizeTikHubResults("douyin", payload);
    if (!results.length) throw new Error(`douyin video search ${version} returned no results`);
    return results;
  };
  const hedgeDelayMs = readPositiveInt(process.env.TIKHUB_SEARCH_HEDGE_DELAY_MS, 1_200);
  return new Promise((resolveSearch, rejectSearch) => {
    let settled = false;
    let fallbackStarted = false;
    const failures = [];
    let timer;
    const succeed = (results) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveSearch(results);
    };
    const fail = (error) => {
      failures.push(error);
      if (!fallbackStarted) {
        startFallback();
        return;
      }
      if (failures.length >= 2 && !settled) {
        settled = true;
        rejectSearch(failures.at(-1));
      }
    };
    const startFallback = () => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      requestEndpoint("v1").then(succeed, fail);
    };
    timer = setTimeout(startFallback, hedgeDelayMs);
    requestEndpoint("v2").then(succeed, fail);
  });
}

function detectTikHubSearchPlatforms(query) {
  const value = String(query || "");
  if (/哔哩|bilibili|B站|巫师财经/i.test(value)) return ["bilibili"];
  if (/小红书|xiaohongshu|xhs/i.test(value)) return ["xiaohongshu"];
  if (/抖音|douyin/i.test(value)) return ["douyin"];
  if (/公众号|微信|wechat/i.test(value)) return ["wechat"];
  if (/知乎|zhihu/i.test(value)) return ["zhihu"];
  return ["bilibili", "douyin", "xiaohongshu"];
}

function normalizeTikHubResults(platform, payload) {
  const items = findTikHubItems(platform, payload);
  return items.map((item) => normalizeTikHubItem(platform, item)).filter((item) => item.url);
}

function findTikHubItems(platform, payload) {
  const candidates = platform === "bilibili"
    ? [
        payload?.data?.data?.items,
        payload?.data?.items,
        payload?.data?.result,
        payload?.data?.data?.result,
        payload?.result
      ]
    : platform === "xiaohongshu"
      ? [payload?.data?.data?.items, payload?.data?.items, payload?.data?.data, payload?.items]
      : platform === "wechat"
        ? [payload?.data?.items, payload?.data?.data?.items, payload?.items]
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
    const data = item?.av || item?.video || item;
    const bvid = cleanValue(data?.bvid);
    const aid = cleanValue(item?.param || data?.aid || data?.param);
    return {
      platform,
      title: stripHtml(data?.title || data?.name),
      url: cleanValue(data?.arcurl || data?.url)
        || (bvid ? `https://www.bilibili.com/video/${bvid}` : aid ? `https://www.bilibili.com/video/av${aid}` : ""),
      account: cleanValue(data?.author || data?.up_name),
      accountId: cleanValue(data?.mid || data?.uid),
      snippet: cleanValue(data?.description || data?.desc || data?.author || data?.up_name)
    };
  }
  if (platform === "xiaohongshu") {
    const data = item?.note_card || item?.note || item;
    const id = cleanValue(data?.note_id || data?.id || item?.id);
    const xsecToken = cleanValue(data?.xsec_token || item?.xsec_token);
    const canonicalUrl = id
      ? `https://www.xiaohongshu.com/explore/${id}${xsecToken ? `?xsec_token=${encodeURIComponent(xsecToken)}` : ""}`
      : "";
    return {
      platform,
      kind: String(data?.type || data?.note_type || "").toLowerCase().includes("video") ? "video" : "image_text",
      title: cleanValue(data?.display_title || data?.title || data?.desc),
      url: cleanValue(data?.url || data?.share_url || item?.url) || canonicalUrl,
      account: cleanValue(data?.user?.nickname || data?.user_info?.nickname),
      snippet: cleanValue(data?.desc || data?.user?.nickname || data?.user_info?.nickname)
    };
  }
  if (platform === "wechat") {
    const source = item?.source || item?.jumpInfo || {};
    return {
      platform,
      title: stripHtml(item?.title || item?.name),
      url: cleanValue(item?.doc_url || item?.url || item?.link || item?.jumpInfo?.url),
      account: stripHtml(source?.title || source?.nickName || item?.account_name || item?.author),
      snippet: stripHtml(item?.desc || item?.description || source?.title)
    };
  }
  const data = item?.data?.aweme_info || item?.aweme_info || item?.aweme_detail || item;
  const id = cleanValue(data?.aweme_id || data?.id);
  const normalized = {
    platform,
    kind: Array.isArray(data?.images) && data.images.length > 0 && !data?.video?.play_addr
      ? "image_text"
      : "video",
    title: cleanValue(data?.desc || data?.caption || data?.title),
    // Prefer the stable canonical URL. Search share URLs use iesdouyin.com and
    // contain short-lived tracking parameters that should not enter caches.
    url: id ? `https://www.douyin.com/video/${id}` : cleanValue(data?.share_url || data?.url),
    account: cleanValue(data?.author?.nickname || data?.author?.unique_id),
    accountId: cleanValue(data?.author?.sec_uid || data?.author?.sec_user_id),
    snippet: cleanValue(data?.author?.nickname || data?.author?.unique_id || data?.desc)
  };
  if (normalized.url) {
    try {
      primeTikHubSearchSource(normalized.url, normalizeTikHubContent("douyin", data, normalized.url));
    } catch {
      // Search remains useful when a result has incomplete media metadata.
    }
  }
  return normalized;
}

async function searchZhihuContent({ query, account, apiKey, root, fetchImpl, timeoutMs, maxResults }) {
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const articlesPromise = searchZhihuArticles({ query, headers, root, fetchImpl, timeoutMs, maxResults })
    .catch(() => []);
  let pins = [];
  if (account) {
    try {
      const userParams = new URLSearchParams({ keyword: account, offset: "0", limit: "10" });
      const usersPayload = await requestJsonWithRetry(
        `${root}/api/v1/zhihu/web/fetch_user_search_v3?${userParams}`,
        { method: "GET", headers },
        { fetchImpl, timeoutMs, attempts: 2 }
      );
      const users = firstArray(
        usersPayload?.data?.data,
        usersPayload?.data?.items,
        usersPayload?.data?.data?.items,
        usersPayload?.data,
        usersPayload?.items
      );
      const wanted = normalizeComparableText(account);
      const normalizedUsers = users.map((item) => item?.object || item?.user || item);
      const user = normalizedUsers.find((item) => normalizeComparableText(stripHtml(item?.name || item?.title)) === wanted)
        || normalizedUsers.find((item) => normalizeComparableText(stripHtml(item?.name || item?.title)).includes(wanted));
      const token = cleanValue(user?.url_token || user?.token || user?.id);
      if (token) {
        const pinParams = new URLSearchParams({
          user_url_token: token,
          offset: "0",
          limit: String(Math.min(20, Math.max(10, Number(maxResults) || 10)))
        });
        const pinsPayload = await requestJsonWithRetry(
          `${root}/api/v1/zhihu/web/fetch_user_pins?${pinParams}`,
          { method: "GET", headers },
          { fetchImpl, timeoutMs, attempts: 2 }
        );
        pins = firstArray(
          pinsPayload?.data?.data,
          pinsPayload?.data?.items,
          pinsPayload?.data?.data?.items,
          pinsPayload?.data,
          pinsPayload?.items
        ).map((item) => normalizeZhihuPinSearchItem(item, account)).filter((item) => item.url);
      }
    } catch {
      // Content search below still covers answers and articles when user lookup fails.
    }
  }

  const articles = await articlesPromise;
  const combined = [...articles, ...pins].filter((item, index, items) => (
    item.url && items.findIndex((candidate) => candidate.url === item.url) === index
  ));
  return rankPlatformResults(combined, { query, account });
}

function rankPlatformResults(items, { query, account }) {
  const accountText = normalizeComparableText(account);
  const queryText = normalizeComparableText(query);
  const titleTarget = accountText ? queryText.replace(accountText, "") : queryText;
  return [...items].sort((left, right) => relevance(right) - relevance(left));

  function relevance(item) {
    const title = normalizeComparableText(item?.title);
    const candidateAccount = normalizeComparableText(item?.account);
    const titleScore = diceBigrams(title, titleTarget);
    const accountScore = accountText && candidateAccount === accountText ? 1 : 0;
    return titleScore * 0.85 + accountScore * 0.15;
  }
}

function diceBigrams(left, right) {
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return 1;
  const leftGrams = new Set(Array.from({ length: Math.max(1, left.length - 1) }, (_, index) => left.slice(index, index + 2)));
  const rightGrams = new Set(Array.from({ length: Math.max(1, right.length - 1) }, (_, index) => right.slice(index, index + 2)));
  const common = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return (2 * common) / (leftGrams.size + rightGrams.size || 1);
}

async function searchZhihuArticles({ query, headers, root, fetchImpl, timeoutMs, maxResults }) {
  const params = new URLSearchParams({
    keyword: query,
    offset: "0",
    limit: String(Math.min(20, Math.max(10, Number(maxResults) || 10)))
  });
  const payload = await requestJsonWithRetry(
    `${root}/api/v1/zhihu/web/fetch_article_search_v3?${params}`,
    { method: "GET", headers },
    { fetchImpl, timeoutMs, attempts: 2 }
  );
  return firstArray(
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.data?.items,
    payload?.data,
    payload?.items
  ).map(normalizeZhihuArticleSearchItem).filter((item) => item.url);
}

function normalizeZhihuPinSearchItem(item, fallbackAccount = "") {
  const data = item?.object || item?.pin || item;
  const id = cleanValue(data?.id || data?.pin_id);
  const html = cleanValue(data?.content_html)
    || (Array.isArray(data?.content)
      ? data.content.map((part) => part?.own_text || part?.content || part?.text || "").join("<br>")
      : cleanValue(data?.content));
  const title = pinHeadline(data?.excerpt_title || html || data?.excerpt || data?.content);
  return {
    platform: "zhihu",
    title,
    url: id ? `https://www.zhihu.com/pin/${id}` : cleanValue(data?.url),
    account: stripHtml(data?.author?.name || data?.author?.nickname || fallbackAccount),
    snippet: stripHtml(data?.excerpt || html).slice(0, 500)
  };
}

function normalizeZhihuArticleSearchItem(item) {
  const data = item?.object || item?.article || item;
  const id = cleanValue(data?.id || data?.article_id);
  const rawUrl = cleanValue(data?.url);
  const answerId = rawUrl.match(/\/answers?\/(\d+)/)?.[1]
    || (data?.type === "answer" ? id : "");
  const articleId = rawUrl.match(/\/articles?\/(\d+)/)?.[1]
    || (data?.type === "article" ? id : "");
  const canonicalUrl = answerId
    ? `https://www.zhihu.com/answer/${answerId}`
    : articleId
      ? `https://zhuanlan.zhihu.com/p/${articleId}`
      : rawUrl;
  return {
    platform: "zhihu",
    title: stripHtml(data?.title || data?.name),
    url: canonicalUrl || (id ? `https://zhuanlan.zhihu.com/p/${id}` : ""),
    account: stripHtml(data?.author?.name || data?.author?.nickname),
    snippet: stripHtml(data?.excerpt || data?.description || data?.content).slice(0, 500)
  };
}

function pinHeadline(value) {
  const firstLine = cleanValue(value).split(/<br\s*\/?\s*>|\r?\n/i).map(stripHtml).find(Boolean) || "";
  return firstLine.slice(0, 160);
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function readSearchCache(key) {
  if (!key) return null;
  const item = searchCache.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return item.value;
}

function writeSearchCache(key, value) {
  const ttlMs = readPositiveInt(process.env.TIKHUB_SEARCH_CACHE_TTL_MS, 10 * 60 * 1000);
  searchCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (searchCache.size > 128) searchCache.delete(searchCache.keys().next().value);
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function fetchBilibiliCreatorVideos({ account, searchResults, apiKey, baseUrl, fetchImpl, timeoutMs }) {
  const normalizedAccount = normalizeComparableText(account);
  let owner = searchResults.find((item) => (
    item.accountId && normalizeComparableText(item.account) === normalizedAccount
  ));
  if (!owner?.accountId) {
    owner = await resolveBilibiliCreator({ account, apiKey, baseUrl, fetchImpl, timeoutMs });
  }
  if (!owner?.accountId) return [];
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const pages = await Promise.all([1, 2].map(async (page) => {
    const params = new URLSearchParams({
      user_id: owner.accountId,
      post_filter: "archive",
      page: String(page),
      ps: "20"
    });
    const payload = await requestJson(`${root}/api/v1/bilibili/app/fetch_user_videos?${params}`, {
      headers: { authorization: `Bearer ${apiKey}` }
    }, { fetchImpl, timeoutMs: Math.max(timeoutMs, 12_000) });
    return payload?.data?.data?.item
      || payload?.data?.data?.data?.item
      || payload?.data?.item
      || [];
  }));
  return pages.flat().map((item) => {
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

async function fetchDouyinCreatorPosts({ account, query, searchResults = [], apiKey, baseUrl, fetchImpl, timeoutMs, maxResults }) {
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  const wanted = normalizeComparableText(account);
  const seededProfiles = searchResults.map((item) => ({
    nickname: cleanValue(item?.account),
    secUid: cleanValue(item?.accountId),
    followers: 0,
    similarity: diceBigrams(normalizeComparableText(item?.account), wanted)
  })).filter((item) => item.secUid && item.similarity >= 0.75)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.secUid === item.secUid) === index);
  let profiles = seededProfiles.slice(0, 4);
  if (profiles.length === 0) {
    const payload = await requestJsonWithRetry(
      `${root}/api/v1/douyin/search/fetch_user_search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          keyword: account,
          cursor: 0,
          douyin_user_fans: "",
          douyin_user_type: "",
          search_id: ""
        })
      },
      { fetchImpl, timeoutMs, attempts: 2 }
    );
    profiles = normalizeDouyinUserProfiles(payload, account).slice(0, 4);
  }
  if (profiles.length === 0) return [];

  // Duplicate display names are common on Douyin. Query a few best matching
  // profiles in parallel, then let the normal title+account scorer select the
  // exact post instead of trusting the first user-search row.
  const pages = await Promise.all(profiles.map(async (profile) => {
    const params = new URLSearchParams({
      sec_user_id: profile.secUid,
      max_cursor: "0",
      count: String(Math.min(20, Math.max(10, Number(maxResults) || 10))),
      sort_type: "0"
    });
    const postsPayload = await requestJsonWithRetry(
      `${root}/api/v1/douyin/app/v3/fetch_user_post_videos?${params}`,
      { method: "GET", headers },
      { fetchImpl, timeoutMs: Math.max(timeoutMs, 12_000), attempts: 2 }
    );
    return findDouyinAwemeItems(postsPayload).map((item) => ({ item, profile }));
  }));
  return rankPlatformResults(
    pages.flat().map(({ item, profile }) => ({
      ...normalizeTikHubItem("douyin", item),
      account: cleanValue(item?.author?.nickname) || profile.nickname,
      discovery: "creator_posts"
    })).filter((item, index, items) => (
      item.url && item.title && items.findIndex((candidate) => candidate.url === item.url) === index
    )),
    { query, account }
  );
}

function normalizeDouyinUserProfiles(payload, account) {
  const wanted = normalizeComparableText(account);
  const rows = firstArray(payload?.data?.user_list, payload?.data?.data?.user_list, payload?.user_list);
  return rows.map((row) => {
    let data = row?.user_info || row?.user || row;
    const rawData = row?.dynamic_patch?.raw_data;
    if (rawData) {
      try {
        const parsed = JSON.parse(rawData);
        data = parsed?.user_info || parsed?.user || data;
      } catch {
        // Ignore a malformed dynamic card while keeping any direct user_info.
      }
    }
    const nickname = cleanValue(data?.nickname || data?.name);
    return {
      nickname,
      secUid: cleanValue(data?.sec_uid || data?.sec_user_id),
      followers: Number(data?.follower_count) || 0,
      similarity: diceBigrams(normalizeComparableText(nickname), wanted)
    };
  }).filter((item) => item.nickname && item.secUid && item.similarity >= 0.55)
    .sort((left, right) => right.similarity - left.similarity || right.followers - left.followers);
}

function findDouyinAwemeItems(payload) {
  const direct = firstArray(
    payload?.data?.aweme_list,
    payload?.data?.data?.aweme_list,
    payload?.data?.data,
    payload?.aweme_list
  );
  if (direct.length) return direct.map((item) => item?.aweme_info || item).filter((item) => item?.aweme_id);
  const found = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.aweme_id && value.author) found.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(payload);
  return found.filter((item, index, items) => (
    items.findIndex((candidate) => candidate.aweme_id === item.aweme_id) === index
  ));
}

async function resolveBilibiliCreator({ account, apiKey, baseUrl, fetchImpl, timeoutMs }) {
  const root = String(baseUrl || DEFAULT_TIKHUB_BASE_URL).replace(/\/+$/, "");
  const params = new URLSearchParams({
    keyword: account,
    search_type: "user",
    cursor: "",
    page_size: "10",
    order: "0"
  });
  const payload = await requestJson(`${root}/api/v1/bilibili/app/fetch_search_by_type?${params}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  }, { fetchImpl, timeoutMs });
  const items = firstArray(payload?.data?.data?.items, payload?.data?.items);
  const wanted = normalizeComparableText(account);
  const item = items.find((candidate) => normalizeComparableText(candidate?.author?.title) === wanted)
    || items.find((candidate) => normalizeComparableText(candidate?.author?.title).includes(wanted));
  return item ? {
    account: cleanValue(item?.author?.title),
    accountId: cleanValue(item?.param || item?.author?.mid || item?.mid)
  } : null;
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
