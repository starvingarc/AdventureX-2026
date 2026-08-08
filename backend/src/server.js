import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createMemoryCard } from "./cardService.js";
import { buildReadiness, readRuntimeConfig } from "./runtimeConfig.js";
import { searchMemoryCards } from "./searchService.js";
import { createCardStore } from "./storeFactory.js";

export function createOmoServer(options = {}) {
  const env = options.env || process.env;
  const config = readRuntimeConfig(env);
  const store = options.store || createCardStore(config, options.storeOptions);
  const createCard = options.createCard || createMemoryCard;
  const searchCards = options.searchCards || searchMemoryCards;
  const activeScreenshotJobs = new Set();
  const publicPagesDirectory = options.publicPagesDirectory
    || env.OMO_PUBLIC_PAGES_DIR
    || fileURLToPath(new URL("../../docs/", import.meta.url));
  const currentReadiness = async () => {
    let storage;
    try {
      storage = await store.readiness({ production: config.production });
    } catch {
      storage = {
        ready: false,
        driver: config.storage.driver,
        durable: config.storage.durable,
        reason: "storage_unavailable",
        appliedVersions: [],
        pendingVersions: []
      };
    }
    return buildReadiness(config, { storage });
  };
  const scheduleScreenshotJob = (owner, jobId) => {
    const activeKey = `${owner}:${jobId}`;
    if (activeScreenshotJobs.has(activeKey)) return;
    activeScreenshotJobs.add(activeKey);
    setImmediate(async () => {
      let claimedJob;
      let leaseHeartbeat;
      try {
        claimedJob = await store.claimScreenshotJob(owner, jobId);
        if (!claimedJob) return;
        leaseHeartbeat = setInterval(async () => {
          try {
            await store.renewScreenshotJobLease(
              owner,
              jobId,
              claimedJob.attemptToken
            );
          } catch {
            // Terminal writes are still fenced if a heartbeat cannot reach storage.
          }
        }, 60_000);
        leaseHeartbeat.unref();
        const card = await createCard({
          imageBase64: claimedJob.imageBase64,
          mimeType: claimedJob.mimeType
        }, { config });
        const storedCard = await store.save(owner, card);
        await store.succeedScreenshotJob(
          owner,
          jobId,
          claimedJob.attemptToken,
          storedCard.id
        );
      } catch (error) {
        const failure = screenshotJobFailure(error);
        try {
          if (claimedJob) {
            await store.failScreenshotJob(
              owner,
              jobId,
              claimedJob.attemptToken,
              failure
            );
          }
        } catch {
          // Readiness and the job list surface storage failures on the next request.
        }
      } finally {
        if (leaseHeartbeat) clearInterval(leaseHeartbeat);
        activeScreenshotJobs.delete(activeKey);
      }
    });
  };
  const resumeScreenshotJobs = async () => {
    if (typeof store.recoverScreenshotJobs !== "function") return;
    const jobs = await store.recoverScreenshotJobs();
    for (const job of jobs) scheduleScreenshotJob(job.owner || "", job.id);
  };

  const httpServer = createServer(async (request, response) => {
    cors(response);
    if (request.method === "OPTIONS") return send(response, 204, null);

    const url = new URL(request.url || "/", "http://localhost");
    const owner = String(request.headers["x-device-id"] || "local-device");

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return send(response, 200, { service: "omo-api", status: "live" });
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return send(response, 200, {
          ok: true,
          service: "omo-api",
          status: "live"
        });
      }

      if (request.method === "GET" && url.pathname === "/api/readiness") {
        const readiness = await currentReadiness();
        return send(response, readiness.ready ? 200 : 503, readiness);
      }

      const publicPage = publicPageFilename(url.pathname);
      if (request.method === "GET" && publicPage) {
        const html = await readFile(resolve(publicPagesDirectory, publicPage), "utf8");
        return sendHTML(response, 200, html);
      }

      if (
        (config.production || config.database.configured)
        && isBusinessRoute(url.pathname)
      ) {
        const readiness = await currentReadiness();
        if (!readiness.ready) {
          return send(response, 503, {
            code: "service_not_ready",
            message: "服务依赖尚未就绪。",
            blockers: readiness.blockers
          });
        }
      }

      if (request.method === "GET" && url.pathname === "/api/memory-cards") {
        return send(response, 200, { cards: await store.list(owner) });
      }

      if (request.method === "POST" && url.pathname === "/api/screenshot-jobs") {
        const body = await readJSON(request);
        const job = await store.enqueueScreenshotJob(owner, {
          imageBase64: body.imageBase64,
          mimeType: body.mimeType
        });
        scheduleScreenshotJob(owner, job.id);
        return send(response, 202, { job });
      }

      if (request.method === "GET" && url.pathname === "/api/screenshot-jobs") {
        return send(response, 200, {
          jobs: await store.listScreenshotJobs(owner)
        });
      }

      const screenshotJobRetry = url.pathname.match(
        /^\/api\/screenshot-jobs\/([^/]+)\/retry$/
      );
      if (request.method === "POST" && screenshotJobRetry) {
        const jobId = decodeURIComponent(screenshotJobRetry[1]);
        const body = await readJSON(request);
        const job = await store.retryScreenshotJob(owner, jobId, {
          imageBase64: body.imageBase64,
          mimeType: body.mimeType
        });
        if (!job) {
          return send(response, 404, {
            code: "screenshot_job_not_found",
            message: "截图任务不存在。"
          });
        }
        scheduleScreenshotJob(owner, job.id);
        return send(response, 202, { job });
      }

      const screenshotJob = url.pathname.match(/^\/api\/screenshot-jobs\/([^/]+)$/);
      if (request.method === "GET" && screenshotJob) {
        const job = await store.getScreenshotJob(
          owner,
          decodeURIComponent(screenshotJob[1])
        );
        return job
          ? send(response, 200, { job })
          : send(response, 404, {
              code: "screenshot_job_not_found",
              message: "截图任务不存在。"
            });
      }

      if (request.method === "POST" && url.pathname === "/api/memory-cards/search") {
        const body = await readJSON(request);
        const result = await searchCards({
          query: body.query,
          cards: await store.list(owner)
        }, {
          config,
          fetchImpl: options.searchFetchImpl || fetch
        });
        return send(response, 200, result);
      }

      if (request.method === "POST" && url.pathname === "/api/sources/image-flow") {
        const body = await readJSON(request);
        const card = await createCard({
          imageBase64: body.imageBase64,
          mimeType: body.mimeType
        }, { config });
        const storedCard = await store.save(owner, card);
        return send(response, 200, { card: storedCard });
      }

      const assessment = url.pathname.match(/^\/api\/memory-cards\/([^/]+)\/assessments$/);
      if (request.method === "POST" && assessment) {
        const body = await readJSON(request);
        const card = await store.assess(
          owner,
          decodeURIComponent(assessment[1]),
          body.assessment,
          body.attemptId
        );
        return card
          ? send(response, 200, { card })
          : send(response, 404, {
            code: "card_not_found",
            message: "记忆卡不存在。"
          });
      }

      const deletion = url.pathname.match(/^\/api\/memory-cards\/([^/]+)$/);
      if (request.method === "DELETE" && deletion) {
        const cardId = decodeURIComponent(deletion[1]);
        const deleted = await store.delete(owner, cardId);
        return send(response, deleted ? 200 : 404, {
          deleted,
          cardId,
          ...(!deleted ? {
            code: "card_not_found",
            message: "记忆卡不存在。"
          } : {})
        });
      }

      return send(response, 404, {
        code: "route_not_found",
        message: "接口不存在。"
      });
    } catch (error) {
      return send(response, safeErrorStatus(error), safeErrorBody(error));
    }
  });
  httpServer.once("listening", () => {
    void resumeScreenshotJobs().catch(() => {});
    const recoveryTimer = setInterval(() => {
      void resumeScreenshotJobs().catch(() => {});
    }, 30_000);
    recoveryTimer.unref();
    httpServer.once("close", () => clearInterval(recoveryTimer));
  });
  if (!options.store) {
    httpServer.on("close", () => {
      void store.close?.();
    });
  }
  return httpServer;
}

export const server = createOmoServer();

function safeErrorStatus(error) {
  return error?.expose && Number.isInteger(error.statusCode)
    ? error.statusCode
    : 500;
}

function safeErrorBody(error) {
  if (error?.expose && error.code && error.message) {
    return {
      code: error.code,
      message: error.message
    };
  }
  return {
    code: "internal_error",
    message: "服务器暂时无法处理请求。"
  };
}

function screenshotJobFailure(error) {
  const code = String(error?.code || "processing_failed");
  const messages = {
    model_timeout: "截图处理超时，请重试。",
    model_unavailable: "AI 暂时无法处理这张截图，请重试。",
    model_upstream_error: "AI 暂时无法处理这张截图，请重试。",
    model_invalid_response: "这张截图暂时无法生成知识卡，请重试。",
    storage_unavailable: "知识卡暂时无法保存，请重试。"
  };
  return {
    code,
    message: messages[code] || "截图处理失败，请重试。",
    retryable: true
  };
}

function isBusinessRoute(pathname) {
  return pathname === "/api/sources/image-flow"
    || pathname === "/api/screenshot-jobs"
    || pathname.startsWith("/api/screenshot-jobs/")
    || pathname === "/api/memory-cards"
    || pathname.startsWith("/api/memory-cards/");
}

function readJSON(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(httpError(413, "payload_too_large", "截图过大，请压缩后重试。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(httpError(400, "invalid_json", "请求内容不是有效 JSON。"));
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body) {
  if (status === 204) {
    response.writeHead(status);
    return response.end();
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendHTML(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function publicPageFilename(pathname) {
  if (
    pathname === "/privacy"
    || pathname === "/privacy/"
    || pathname === "/privacy-policy.html"
  ) {
    return "privacy-policy.html";
  }
  if (
    pathname === "/support"
    || pathname === "/support/"
    || pathname === "/support.html"
  ) {
    return "support.html";
  }
  return null;
}

function cors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "Content-Type,X-Device-Id");
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: true
  });
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT || 5174);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () => {
    console.log(`Omo API: http://${host}:${port}`);
  });
}
