const DEFAULT_JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_GENERATION_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_IMAGE_FLOW_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const rateLimitBuckets = new Map();

export class RequestGuardError extends Error {
  constructor({
    statusCode = 400,
    errorCode = "bad_request",
    message = "请求不可用。",
    details = {}
  } = {}) {
    super(message);
    this.name = "RequestGuardError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export function corsHeadersForRequest(req, env = process.env) {
  const origin = readHeader(req, "origin");
  if (!isProductionLike(env)) {
    return {
      "access-control-allow-origin": origin || "*",
      "vary": "Origin"
    };
  }

  const allowedOrigins = parseAllowedOrigins(env.SHIBEI_ALLOWED_ORIGINS || env.SHIBEI_ALLOWED_ORIGIN || "");
  const fallbackOrigin = env.SHIBEI_PUBLIC_BASE_URL || allowedOrigins[0] || "";
  const allowedOrigin = origin && allowedOrigins.includes(origin)
    ? origin
    : !origin && fallbackOrigin
      ? fallbackOrigin
      : "";

  return allowedOrigin
    ? {
      "access-control-allow-origin": allowedOrigin,
      "vary": "Origin"
    }
    : { "vary": "Origin" };
}

export function corsPreflightHeaders(req, env = process.env) {
  return {
    ...corsHeadersForRequest(req, env),
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-device-id",
    "access-control-max-age": "600"
  };
}

export function resolveDeviceId(req, fallbackDeviceId = "demo-device") {
  const raw = readHeader(req, "x-device-id");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const deviceId = trimmed || fallbackDeviceId;
  const valid = isValidDeviceId(deviceId);
  return {
    deviceId,
    valid,
    error: valid ? null : {
      statusCode: 422,
      errorCode: "invalid_device_id",
      message: "设备标识无效，请重启 App 后再试。"
    }
  };
}

export function isValidDeviceId(value) {
  return DEVICE_ID_PATTERN.test(String(value || ""));
}

export function requestRequiresValidDeviceId(req) {
  const url = String(req?.url || "");
  const method = String(req?.method || "GET").toUpperCase();
  if (!url.startsWith("/api/")) return false;
  if (method === "OPTIONS") return false;
  if (method === "GET" && url === "/api/health") return false;
  if (method === "GET" && url === "/api/version") return false;
  if (method === "GET" && url.startsWith("/api/v2/recommended-articles")) return false;
  return true;
}

export function evaluateRequestGuards(req, {
  deviceIdResult = resolveDeviceId(req),
  env = process.env
} = {}) {
  if (requestRequiresValidDeviceId(req) && !deviceIdResult.valid) {
    return deviceIdResult.error;
  }

  const rateLimit = checkRateLimit(req, {
    deviceId: deviceIdResult.deviceId,
    env
  });
  if (!rateLimit.allowed) {
    return {
      statusCode: 429,
      errorCode: "rate_limited",
      message: rateLimit.message,
      details: {
        group: rateLimit.group,
        retryAfterSeconds: rateLimit.retryAfterSeconds
      }
    };
  }

  return null;
}

export async function readJsonBodyWithLimit(req, {
  maxBytes = maxBodyBytesForRequest(req, process.env)
} = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new RequestGuardError({
        statusCode: 413,
        errorCode: "request_body_too_large",
        message: "内容太长了，请缩短后再试。",
        details: { maxBytes }
      });
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestGuardError({
      statusCode: 400,
      errorCode: "invalid_json",
      message: "请求格式不正确，请重试。"
    });
  }
}

export function maxBodyBytesForRequest(req, env = process.env) {
  const explicit = readPositiveInt(env.SHIBEI_MAX_JSON_BODY_BYTES, 0);
  const generationExplicit = readPositiveInt(env.SHIBEI_MAX_GENERATION_BODY_BYTES, 0);
  const imageFlowExplicit = readPositiveInt(env.SHIBEI_MAX_IMAGE_FLOW_BODY_BYTES, 0);
  if (isImageFlowRoute(req)) return imageFlowExplicit || DEFAULT_IMAGE_FLOW_BODY_LIMIT_BYTES;
  if (isGenerationRoute(req)) return generationExplicit || DEFAULT_GENERATION_BODY_LIMIT_BYTES;
  return explicit || DEFAULT_JSON_BODY_LIMIT_BYTES;
}

export function checkRateLimit(req, {
  deviceId = "unknown-device",
  env = process.env,
  now = Date.now()
} = {}) {
  if (env.SHIBEI_RATE_LIMIT_DISABLED === "1") {
    return { allowed: true, group: "disabled" };
  }

  const group = rateLimitGroupForRequest(req);
  if (group === "none") return { allowed: true, group };

  const config = rateLimitConfigForGroup(group, env);
  const ip = clientIpForRequest(req);
  const key = `${group}:${deviceId}:${ip}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + config.windowMs });
    cleanupRateLimitBuckets(now);
    return { allowed: true, group };
  }

  if (bucket.count >= config.limit) {
    return {
      allowed: false,
      group,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      message: group === "generation"
        ? "生成请求太频繁了，请稍后再试。"
        : "操作太频繁了，请稍后再试。"
    };
  }

  bucket.count += 1;
  return { allowed: true, group };
}

export function resetRequestGuardState() {
  rateLimitBuckets.clear();
}

export function rateLimitGroupForRequest(req) {
  const url = String(req?.url || "");
  const method = String(req?.method || "GET").toUpperCase();
  if (method === "OPTIONS") return "none";
  if (!url.startsWith("/api/")) return "none";
  if (method === "GET" && url === "/api/health") return "none";
  if (method === "GET" && url === "/api/version") return "none";
  if (isImageFlowRoute(req)) return "generation";
  if (isGenerationRoute(req)) return "generation";
  if (method === "POST" && /^\/api\/v2\/recommended-articles\/[^/]+\/import$/.test(url)) return "recommended-import";
  if (method !== "GET") return "mutation";
  return "normal-api";
}

function isGenerationRoute(req) {
  const url = String(req?.url || "");
  const method = String(req?.method || "GET").toUpperCase();
  return method === "POST" && (
    url === "/api/generate" ||
    url === "/api/regenerate" ||
    url === "/api/chapters" ||
    url === "/api/v2/chapters"
  );
}

function isImageFlowRoute(req) {
  return String(req?.method || "GET").toUpperCase() === "POST"
    && String(req?.url || "") === "/api/sources/image-flow";
}

function rateLimitConfigForGroup(group, env) {
  const windowMs = readPositiveInt(env.SHIBEI_RATE_LIMIT_WINDOW_MS, 60_000);
  switch (group) {
  case "generation":
    return {
      limit: readPositiveInt(env.SHIBEI_GENERATION_RATE_LIMIT, 12),
      windowMs: readPositiveInt(env.SHIBEI_GENERATION_RATE_LIMIT_WINDOW_MS, 10 * 60_000)
    };
  case "recommended-import":
    return {
      limit: readPositiveInt(env.SHIBEI_RECOMMENDED_IMPORT_RATE_LIMIT, 30),
      windowMs: readPositiveInt(env.SHIBEI_RECOMMENDED_IMPORT_RATE_LIMIT_WINDOW_MS, 10 * 60_000)
    };
  case "mutation":
    return {
      limit: readPositiveInt(env.SHIBEI_MUTATION_RATE_LIMIT, 120),
      windowMs
    };
  default:
    return {
      limit: readPositiveInt(env.SHIBEI_API_RATE_LIMIT, 300),
      windowMs
    };
  }
}

function cleanupRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 1000) return;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}

function clientIpForRequest(req) {
  const forwarded = readHeader(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown-ip";
  return req?.socket?.remoteAddress || "unknown-ip";
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isProductionLike(env) {
  return env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT_NAME === "production";
}

function readHeader(req, name) {
  const value = req?.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
