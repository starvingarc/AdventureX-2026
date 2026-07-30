const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_QWEN_MODEL = "qwen3-vl-plus";
const DEFAULT_QWEN_TIMEOUT_MS = 60_000;
const DEFAULT_TIKHUB_BASE_URL = "https://api.tikhub.io";
const DEFAULT_TIKHUB_TIMEOUT_MS = 15_000;
const DEFAULT_DATABASE_POOL_MAX = 10;
const DEFAULT_DATABASE_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_IDLE_TIMEOUT_MS = 30_000;

export function readRuntimeConfig(env = process.env) {
  const nodeEnv = clean(env.NODE_ENV || "development").toLowerCase();
  const production = nodeEnv === "production";
  const demo = parseFlag(env.OMO_DEMO_MODE);
  const qwenBaseURL = resolveEnvironmentValue(
    env,
    "QWEN_BASE_URL",
    "BASE_URL",
    DEFAULT_QWEN_BASE_URL
  );
  const qwenModel = resolveEnvironmentValue(
    env,
    "QWEN_MODEL",
    "AI_MODEL",
    DEFAULT_QWEN_MODEL
  );
  const qwenTimeout = resolveEnvironmentValue(
    env,
    "QWEN_TIMEOUT_MS",
    "MODEL_REQUEST_TIMEOUT_MS",
    String(DEFAULT_QWEN_TIMEOUT_MS)
  );
  const tikhubApiKey = resolveEnvironmentValue(
    env,
    "TIKHUB_API_KEY",
    "TICKHUB_API_KEY",
    ""
  );
  const qwenURL = parseHTTPURL(qwenBaseURL.value);
  const tikhubURL = parseHTTPURL(env.TIKHUB_BASE_URL || DEFAULT_TIKHUB_BASE_URL);
  const qwenTimeoutValue = parsePositiveInteger(qwenTimeout.value);
  const tikhubTimeoutValue = parsePositiveInteger(
    env.TIKHUB_TIMEOUT_MS || String(DEFAULT_TIKHUB_TIMEOUT_MS)
  );
  const qwenApiKey = clean(env.QWEN_API);
  const databaseURL = clean(env.DATABASE_URL);
  const databaseURLValid = !databaseURL || isPostgresURL(databaseURL);
  const databasePoolMax = parsePositiveInteger(
    env.DATABASE_POOL_MAX || String(DEFAULT_DATABASE_POOL_MAX)
  );
  const databaseConnectTimeout = parsePositiveInteger(
    env.DATABASE_CONNECT_TIMEOUT_MS || String(DEFAULT_DATABASE_CONNECT_TIMEOUT_MS)
  );
  const databaseIdleTimeout = parsePositiveInteger(
    env.DATABASE_IDLE_TIMEOUT_MS || String(DEFAULT_DATABASE_IDLE_TIMEOUT_MS)
  );
  const deprecatedEnvironmentVariables = [
    qwenBaseURL.legacyName,
    qwenModel.legacyName,
    qwenTimeout.legacyName,
    tikhubApiKey.legacyName
  ].filter(Boolean);

  return {
    nodeEnv,
    production,
    demo: {
      requested: demo.enabled,
      enabled: demo.enabled && !production,
      valid: demo.valid
    },
    qwen: {
      apiKey: qwenApiKey,
      configured: Boolean(qwenApiKey),
      baseURL: qwenURL.value,
      baseURLValid: qwenURL.valid,
      model: clean(qwenModel.value),
      timeoutMs: qwenTimeoutValue.value,
      timeoutValid: qwenTimeoutValue.valid
    },
    tikhub: {
      apiKey: clean(tikhubApiKey.value),
      configured: Boolean(clean(tikhubApiKey.value)),
      baseURL: tikhubURL.value,
      baseURLValid: tikhubURL.valid,
      timeoutMs: tikhubTimeoutValue.value,
      timeoutValid: tikhubTimeoutValue.valid
    },
    database: {
      connectionString: databaseURL,
      configured: Boolean(databaseURL),
      urlValid: databaseURLValid,
      poolMax: databasePoolMax.value,
      poolMaxValid: databasePoolMax.valid,
      connectTimeoutMs: databaseConnectTimeout.value,
      connectTimeoutValid: databaseConnectTimeout.valid,
      idleTimeoutMs: databaseIdleTimeout.value,
      idleTimeoutValid: databaseIdleTimeout.valid
    },
    storage: {
      driver: databaseURL ? "postgres" : "json",
      durable: Boolean(databaseURL),
      filePath: clean(env.CARD_STORE_PATH)
    },
    deprecatedEnvironmentVariables
  };
}

export function buildReadiness(config, runtime = {}) {
  const blockers = [];
  const demoForbidden = config.production && config.demo.requested;
  const modelProvider = config.qwen.configured
    ? "qwen"
    : config.demo.enabled
      ? "fixture"
      : "none";
  const modelReady = config.qwen.configured
    ? config.qwen.baseURLValid && config.qwen.timeoutValid && Boolean(config.qwen.model)
    : config.demo.enabled;
  const sourceReady = config.tikhub.configured
    && config.tikhub.baseURLValid
    && config.tikhub.timeoutValid;
  const storageRequired = config.production || config.database.configured;
  const storageStatus = runtime.storage || {
    ready: !storageRequired && config.storage.driver === "json",
    driver: config.storage.driver,
    durable: config.storage.durable,
    reason: storageRequired ? "storage_not_checked" : ""
  };
  const storageReady = Boolean(storageStatus.ready)
    && (!storageRequired || Boolean(storageStatus.durable));

  if (!config.demo.valid) blockers.push("demo_mode_invalid");
  if (demoForbidden) blockers.push("demo_mode_forbidden");
  if (!config.qwen.configured && !config.demo.enabled) blockers.push("qwen_api_missing");
  if (config.qwen.configured && !config.qwen.baseURLValid) blockers.push("qwen_base_url_invalid");
  if (config.qwen.configured && !config.qwen.timeoutValid) blockers.push("qwen_timeout_invalid");
  if (config.qwen.configured && !config.qwen.model) blockers.push("qwen_model_missing");

  if (config.production) {
    if (!config.tikhub.configured) blockers.push("tikhub_api_key_missing");
    if (config.tikhub.configured && !config.tikhub.baseURLValid) {
      blockers.push("tikhub_base_url_invalid");
    }
    if (config.tikhub.configured && !config.tikhub.timeoutValid) {
      blockers.push("tikhub_timeout_invalid");
    }
  }
  if (!config.database.configured && config.production) {
    blockers.push("durable_storage_unavailable");
  }
  if (config.database.configured && !config.database.urlValid) {
    blockers.push("database_url_invalid");
  }
  if (config.database.configured && !config.database.poolMaxValid) {
    blockers.push("database_pool_max_invalid");
  }
  if (config.database.configured && !config.database.connectTimeoutValid) {
    blockers.push("database_connect_timeout_invalid");
  }
  if (config.database.configured && !config.database.idleTimeoutValid) {
    blockers.push("database_idle_timeout_invalid");
  }
  const databaseReady = databaseConfigValid(config.database);
  if (storageRequired && config.database.configured && databaseReady && !storageReady) {
    blockers.push(
      storageStatus.reason
      || (storageStatus.durable ? "storage_unavailable" : "durable_storage_unavailable")
    );
  }

  return {
    ready: blockers.length === 0,
    service: "omo-api",
    mode: config.production ? "production" : "development",
    checks: {
      model: {
        required: true,
        ready: modelReady && !demoForbidden,
        provider: modelProvider
      },
      source: {
        required: config.production,
        ready: sourceReady,
        provider: "tikhub"
      },
      storage: {
        required: storageRequired,
        ready: storageReady,
        driver: storageStatus.driver || config.storage.driver,
        durable: Boolean(storageStatus.durable),
        reason: storageStatus.reason || "",
        appliedVersions: storageStatus.appliedVersions || [],
        pendingVersions: storageStatus.pendingVersions || []
      }
    },
    blockers,
    warnings: config.deprecatedEnvironmentVariables.map(
      (name) => `deprecated_environment_variable:${name}`
    )
  };
}

export function databaseConfigValid(database) {
  return database.urlValid
    && database.poolMaxValid
    && database.connectTimeoutValid
    && database.idleTimeoutValid;
}

function resolveEnvironmentValue(env, canonicalName, legacyName, fallback) {
  const canonical = clean(env[canonicalName]);
  if (canonical) return { value: canonical, legacyName: "" };
  const legacy = clean(env[legacyName]);
  if (legacy) return { value: legacy, legacyName };
  return { value: fallback, legacyName: "" };
}

function parseFlag(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false") {
    return { enabled: false, valid: true };
  }
  if (normalized === "1" || normalized === "true") {
    return { enabled: true, valid: true };
  }
  return { enabled: false, valid: false };
}

function parsePositiveInteger(value) {
  const normalized = clean(value);
  if (!/^\d+$/.test(normalized)) return { value: 0, valid: false };
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0
    ? { value: number, valid: true }
    : { value: 0, valid: false };
}

function parseHTTPURL(value) {
  try {
    const parsed = new URL(clean(value));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { value: "", valid: false };
    }
    return { value: parsed.toString().replace(/\/$/, ""), valid: true };
  } catch {
    return { value: "", valid: false };
  }
}

function isPostgresURL(value) {
  try {
    const parsed = new URL(value);
    return ["postgres:", "postgresql:"].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && Boolean(parsed.pathname.replace(/\//g, ""));
  } catch {
    return false;
  }
}

function clean(value) {
  return String(value || "").trim();
}
