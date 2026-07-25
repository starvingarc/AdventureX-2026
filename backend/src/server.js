import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./env.js";
import { STATUS_TEXT } from "./generation/types.js";
import {
  createGenerationNotification,
  createRegeneratingChapter,
  createSubmittedChapter,
  failedSourceResult,
  generateFromInput,
  generationTimeoutError,
  regenerateFromChapter,
  withTimeout
} from "./chapterGeneration.js";
import {
  applyAnnotation,
  autoLabelReviewRows,
  buildQualityRun,
  calculateRunStats,
  expandReviewRows,
  loadQualityRun,
  mergeAutoLabels,
  qualityRunManualCsvFile,
  saveQualityRun,
  toCsv
} from "./qualityWorkbench.js";
import {
  chapterCount,
  checkDatabase,
  claimDailyGenerationQuota,
  deleteAccountData as deleteDatabaseAccountData,
  deleteChapter as deleteDatabaseChapter,
  deleteDeviceData as deleteDatabaseDeviceData,
  deleteFavoriteQuestion as deleteDatabaseFavoriteQuestion,
  deleteNotificationsForChapter,
  enqueueGenerationJob,
  enqueueIdempotentGenerationJob,
  ensureDevice,
  findOrCreateAccountForProvider,
  getFavoriteQuestion as getDatabaseFavoriteQuestion,
  getAccountForDevice as getDatabaseAccountForDevice,
  getChapter as getDatabaseChapter,
  getGenerationQueueSummary,
  getNotification as getDatabaseNotification,
  getPendingGenerationJobByIdempotencyKey,
  hasDatabase,
  initDatabase,
  listChapters as listDatabaseChapters,
  listFavoriteQuestions as listDatabaseFavoriteQuestions,
  listNotifications as listDatabaseNotifications,
  listPushTokens as listDatabasePushTokens,
  startGenerationJob,
  updateGenerationJob,
  upsertChapter as upsertDatabaseChapter,
  upsertFavoriteQuestion as upsertDatabaseFavoriteQuestion,
  upsertNotification as upsertDatabaseNotification,
  upsertPushToken as upsertDatabasePushToken
} from "./db.js";
import { GenerationQuotaError } from "./generationQuota.js";
import { apnsConfigurationSummary, isAPNSConfigured, sendGenerationNotification } from "./apns.js";
import { buildServiceCapabilities } from "./serviceCapabilities.js";
import { enqueueV2ChapterGeneration } from "./v2/generation/v2ChapterQueue.js";
import {
  getRecommendedArticleCoverPath,
  getRecommendedArticleDetail,
  importRecommendedArticleChapter,
  loadRecommendedArticleCatalog,
  serializeRecommendedArticleCatalogForClient,
  serializeRecommendedArticleForClient
} from "./v2/recommended/recommendedArticles.js";
import {
  advanceReviewCardV2,
  answerQuestionV2,
  createReviewSessionV2,
  focusReviewUnitV2,
  normalizeReviewSessionV2,
  openSourceFromReviewV2,
  returnFromSourceToReviewV2,
  setQuestionFeedbackVisibleV2,
  startReplayFromUnitV2
} from "./v2/state/reviewSessionV2.js";
import {
  answerAwakeningSessionV2,
  completeAwakeningSessionV2,
  createAwakeningSessionV2,
  isActiveAwakeningSessionV2,
  listAwakeningCandidatesV2,
  serializeAwakeningResponseV2
} from "./v2/state/awakeningSessionV2.js";
import {
  corsHeadersForRequest,
  corsPreflightHeaders,
  evaluateRequestGuards,
  readJsonBodyWithLimit,
  RequestGuardError,
  resolveDeviceId
} from "./security/requestGuards.js";
import { buildVersionInfo } from "./versionInfo.js";
import { AppleAuthError, verifyAppleIdentityToken } from "./appleAuth.js";
import { buildSourceCapabilities, preflightSourceInput } from "./sources/sourcePreflight.js";
import { imageFlowInternalEvidence, runImageFlow } from "./flow/index.js";
import { createImageFlowJob, getImageFlowJob } from "./flow/imageFlowJobs.js";
import { configureScreenshotE2EFixture } from "./flow/e2eScreenshotFixture.js";
import {
  captureMemoryRepository,
  isCapturePersistenceStale
} from "./flow/captureMemoryStore.js";
import { buildMemoizedVideoRuntimeReadiness } from "./media/videoRuntimeReadiness.js";
import { takeTemporaryPublicMedia } from "./media/temporaryPublicMedia.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");
const docsRoot = resolve(projectRoot, "docs");
const costRunRoot = resolve(projectRoot, ".tmp", "cost-runs");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 5173);
const startedAt = new Date().toISOString();
const DEFAULT_DEVICE_ID = "demo-device";
const memoryByDeviceId = new Map();
const generationRuns = new Map();
const INITIAL_MASTERY_SCORE = 50;
const REINFORCEMENT_GAP = 3;
const REVIEW_SESSION_SCHEMA_VERSION = 2;
const MAX_REINFORCEMENTS_PER_QUESTION = 2;
const GENERATION_JOB_TIMEOUT_MS = readPositiveInt(process.env.GENERATION_JOB_TIMEOUT_MS, 360_000);
const databaseInitializedByParent = process.env.SHIBEI_DB_INITIALIZED_BY_PARENT === "1";

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...responseCorsHeaders(res),
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-device-id"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    ...responseCorsHeaders(res)
  });
  res.end(body);
}

function responseCorsHeaders(res) {
  return res.shibeiCorsHeaders || { "access-control-allow-origin": "*" };
}

function requestBaseUrl(req) {
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (!host) return process.env.SHIBEI_PUBLIC_BASE_URL || "";
  const inferredProto = proto || (host.endsWith(".up.railway.app") ? "https" : "http");
  return `${inferredProto}://${host}`;
}

async function sendPublicHtml(req, res, fileName) {
  const filePath = resolve(docsRoot, fileName);
  if (!filePath.startsWith(docsRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const data = await readFile(filePath, "utf8");
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...responseCorsHeaders(res)
    });
    res.end();
    return;
  }
  sendText(res, 200, data, "text/html; charset=utf-8");
}

async function sendAppDemoAsset(req, res, fileName) {
  const assetRoot = resolve(docsRoot, "app-demo-assets");
  const filePath = resolve(assetRoot, fileName);
  if (filePath !== assetRoot && !filePath.startsWith(`${assetRoot}/`)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const contentType = filePath.endsWith(".svg")
    ? "image/svg+xml; charset=utf-8"
    : "application/octet-stream";
  const data = await readFile(filePath);
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": "public, max-age=3600",
    ...responseCorsHeaders(res)
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

async function readBody(req) {
  return readJsonBodyWithLimit(req);
}

async function handleGenerate(req, res) {
  const body = await readBody(req);
  try {
    const result = body.regenerateFromChapter
      ? await regenerateFromChapter(body.regenerateFromChapter)
      : await generateFromInput(body);
    sendJson(res, result.status === "completed" ? 200 : 422, result);
  } catch (error) {
    const status = error?.code || error?.status || "failed_questions";
    const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
    const statusCode = message.includes("OPENAI_API_KEY") || message.includes("DEEPSEEK_API_KEY") ? 500 : 422;
    sendJson(res, statusCode, failedSourceResult({ status, message, body }));
  }
}

async function handleCreateChapter(req, res) {
  const body = await readBody(req);
  const deviceId = getDeviceId(req);
  const submittedChapter = await upsertMemoryChapter(deviceId, createSubmittedChapter(body));
  if (hasDatabase) {
    await enqueueGenerationJob(deviceId, {
      id: createId("generation"),
      chapterId: submittedChapter.id,
      status: "submitted",
      currentStage: "submitted",
      jobType: "create_chapter",
      payload: { body }
    });
  }
  sendJson(res, 202, {
    status: submittedChapter.status,
    chapter: serializeChapterForClient(submittedChapter),
    notification: null,
    message: "已排队，正在等待生成。"
  });
  if (!hasDatabase) void runChapterGeneration(deviceId, submittedChapter.id, body);
}

async function handleCreateV2Chapter(req, res) {
  if (!hasDatabase) {
    sendJson(res, 503, {
      errorCode: "v2_queue_requires_database",
      message: "V2 本地队列测试需要配置 DATABASE_URL 后再启动 backend。"
    });
    return;
  }

  const body = await readBody(req);
  const deviceId = getDeviceId(req);
  const result = await enqueueV2ChapterGeneration({
    deviceId,
    body,
    deps: {
      getPendingGenerationJobByIdempotencyKey,
      getChapter: getDatabaseChapter,
      upsertChapter: upsertDatabaseChapter,
      enqueueIdempotentGenerationJob,
      claimDailyGenerationQuota
    }
  });

  sendJson(res, 202, {
    ...result,
    chapter: serializeChapterForClient(result.chapter),
    message: result.generationProgress?.displayText || "已收到文章，准备生成"
  });
}

async function handleSourcePreflight(req, res) {
  const body = await readBody(req);
  const result = await preflightSourceInput({
    rawInput: body.input || body.sourceUrl || body.rawText,
    sourceType: body.sourceType,
    fetchMetadata: body.fetchMetadata === true
  });
  sendJson(res, result.ok ? 200 : 422, result);
}

async function handleImageFlow(req, res) {
  const body = await readBody(req);
  const deviceId = getDeviceId(req);
  const input = {
    imageBase64: body.imageBase64 || body.image || "",
    mimeType: body.mimeType || "",
    imagePath: process.env.NODE_ENV === "development" ? body.imagePath || "" : "",
    sourceUrl: body.sourceUrl || "",
    publicMediaBaseUrl: process.env.SHIBEI_PUBLIC_BASE_URL || requestBaseUrl(req),
    includeDetails: false
  };
  const persistenceEpoch = await captureMemoryRepository.beginPersistence(deviceId);
  const imageSha256 = await imageFlowImageSha256(input);
  if (body.async === true) {
    const job = createImageFlowJob(
      async (onProgress) => {
        const result = await runImageFlow(configureScreenshotE2EFixture({
          ...input, onProgress
        }));
        await persistCaptureMemoryResult(deviceId, result, {
          imageSha256,
          persistenceEpoch
        });
        return result;
      },
      { ownerId: deviceId }
    );
    sendJson(res, 202, job);
    return;
  }
  try {
    const result = await runImageFlow(configureScreenshotE2EFixture(input));
    await persistCaptureMemoryResult(deviceId, result, {
      imageSha256,
      persistenceEpoch
    });
    const statusCode = result.status === "cancelled"
      ? 409
      : result.status === "completed" || result.status === "vision_completed" ? 200 : 422;
    sendJson(res, statusCode, result);
  } catch (error) {
    sendJson(res, 422, {
      status: "failed",
      errorCode: error?.code || "image_flow_failed",
      message: error?.message || "截图处理失败，请稍后重试。"
    });
  }
}

async function persistCaptureMemoryResult(deviceId, result, {
  imageSha256 = "",
  persistenceEpoch = null
} = {}) {
  const stored = await captureMemoryRepository.persistCaptureResult(deviceId, result, {
    deviceId,
    imageSha256,
    persistenceEpoch,
    evidence: imageFlowInternalEvidence(result)
  });
  if (isCapturePersistenceStale(stored)) {
    result.status = "cancelled";
    result.errorCode = stored.errorCode;
    result.message = "任务处理期间数据已被删除，本次结果未保存。";
    result.captureAnalysis = null;
    result.memoryCard = null;
    result.review = null;
    result.schedule = null;
    delete result.captureId;
    return stored;
  }
  if (stored && result?.captureAnalysis) {
    const payload = captureMemoryCardPayload(stored);
    result.captureId = stored.captureId;
    result.captureAnalysis.disposition = stored.disposition;
    result.captureAnalysis.memoryCard = stored.disposition === "create_card" ? payload : null;
    result.captureAnalysis.schedule = stored.schedule || null;
    result.memoryCard = stored.disposition === "create_card"
      ? {
          ...(result.memoryCard || {}),
          id: stored.id,
          state: "formal",
          nextReviewAt: stored.schedule?.nextReviewAt
        }
      : { ...payload, state: "fragment" };
    result.schedule = stored.schedule || null;
    if (stored.disposition !== "create_card") result.review = null;
  }
  return stored;
}

function captureMemoryCardPayload(stored) {
  const fields = stored?.disposition === "create_card"
    ? [
        "id", "coreKnowledge", "recallCue", "hiddenSemantic", "explanation",
        "sourceEvidenceIds", "rarity", "rarityReason", "rarityConfidence",
        "rarityRuleVersion", "recallVariants", "sourceStatus", "sourceTitle", "sourceUrl"
      ]
    : ["id", "coreKnowledge", "recallCue", "explanation", "sourceStatus"];
  const payload = {};
  for (const field of fields) {
    if (stored?.[field] !== undefined) payload[field] = structuredClone(stored[field]);
  }
  return payload;
}

async function imageFlowImageSha256(input) {
  const encoded = String(input?.imageBase64 || "").trim();
  if (encoded) {
    const payload = encoded.replace(/^data:image\/[A-Za-z0-9.+-]+;base64,/i, "").replace(/\s+/g, "");
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
      const bytes = Buffer.from(payload, "base64");
      if (bytes.length > 0) return createHash("sha256").update(bytes).digest("hex");
    }
  }
  if (input?.imagePath) {
    const bytes = await readFile(input.imagePath).catch(() => null);
    if (bytes?.length) return createHash("sha256").update(bytes).digest("hex");
  }
  return createHash("sha256")
    .update([input?.mimeType, input?.sourceUrl, encoded].map((value) => String(value || "")).join("\n"))
    .digest("hex");
}

async function handleTemporaryAsrMedia(req, res, token) {
  const media = takeTemporaryPublicMedia(token);
  if (!media) {
    sendText(res, 404, "Not found");
    return;
  }
  const file = await stat(media.path).catch(() => null);
  if (!file?.isFile() || file.size <= 0) {
    sendText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": media.contentType,
    "content-length": file.size,
    "cache-control": "no-store",
    ...responseCorsHeaders(res)
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(media.path).on("error", () => res.destroy()).pipe(res);
}

async function handleAppleAuth(req, res) {
  if (!hasDatabase) {
    sendJson(res, 503, {
      errorCode: "account_requires_database",
      message: "账号登录需要启用云端数据库。"
    });
    return;
  }
  const deviceId = getDeviceId(req);
  const body = await readBody(req);
  try {
    const appleIdentity = await verifyAppleIdentityToken(body.identityToken || body.identity_token);
    const result = await findOrCreateAccountForProvider({
      provider: appleIdentity.provider,
      providerSubject: appleIdentity.providerSubject,
      email: appleIdentity.email,
      deviceId
    });
    sendJson(res, 200, {
      ok: true,
      account: result.account,
      linkedDeviceId: result.linkedDeviceId,
      ownership: result.ownership
    });
  } catch (error) {
    if (error instanceof AppleAuthError) {
      sendJson(res, error.statusCode || 401, {
        errorCode: error.errorCode,
        message: error.message
      });
      return;
    }
    throw error;
  }
}

async function handleGetAccount(req, res) {
  if (!hasDatabase) {
    sendJson(res, 200, { account: null, mode: "memory" });
    return;
  }
  const account = await getDatabaseAccountForDevice(getDeviceId(req));
  sendJson(res, 200, { account, mode: account ? "account" : "anonymous" });
}

async function handleDeleteAccount(req, res) {
  if (!hasDatabase) {
    sendJson(res, 503, {
      errorCode: "account_requires_database",
      message: "账号删除需要启用云端数据库。"
    });
    return;
  }
  const deviceId = getDeviceId(req);
  const account = await getDatabaseAccountForDevice(deviceId);
  if (!account) {
    sendJson(res, 404, {
      errorCode: "account_not_found",
      message: "当前设备还没有绑定账号。"
    });
    return;
  }
  const result = await deleteDatabaseAccountData(account.id, {
    requestedDeviceId: deviceId,
    reason: "account_deleted_by_user"
  });
  sendJson(res, 200, {
    ok: true,
    deleted: result,
    appleTokenRevocation: {
      status: "not_configured",
      message: "服务端已删除账号数据。Apple token revoke 需要在接入 authorization code exchange 后启用。"
    }
  });
}

async function handleCreateQualityRun(req, res) {
  const body = await readBody(req);
  const runId = createQualityRunId();
  try {
    const result = await generateFromInput(body);
    const initialRun = buildQualityRun({ id: runId, input: body, result });
    let run = initialRun;
    try {
      const autoLabels = await autoLabelReviewRows(initialRun.reviewRows);
      run = {
        ...initialRun,
        status: "ready_for_review",
        autoLabelError: "",
        reviewRows: mergeAutoLabels(initialRun.reviewRows, autoLabels)
      };
      run.stats = calculateRunStats(run.reviewRows);
    } catch (error) {
      run = {
        ...initialRun,
        status: "auto_label_failed",
        autoLabelError: error instanceof Error ? error.message : "AI 预标注失败。"
      };
    }
    await saveQualityRun(run);
    sendJson(res, 200, run);
  } catch (error) {
    sendJson(res, 422, {
      id: runId,
      status: "generation_failed",
      message: error instanceof Error ? error.message : "质量工作台生成失败。"
    });
  }
}

async function handleCreateCostRun(req, res) {
  if (!costWorkbenchEnabled()) {
    sendJson(res, 404, {
      errorCode: "cost_workbench_disabled",
      message: "成本工作台未开启。"
    });
    return;
  }

  const body = await readBody(req);
  try {
    const result = await generateFromInput(body);
    const responseBody = buildCostRunResponse(result);
    const storage = await saveCostRunResponse(responseBody);
    sendJson(res, result.status === "completed" ? 200 : 422, {
      ...responseBody,
      costRunStorage: storage
    });
  } catch (error) {
    const status = error?.code || error?.status || "failed_questions";
    const message = error instanceof Error ? error.message : "成本计算生成失败，请稍后重试。";
    const statusCode = message.includes("OPENAI_API_KEY") || message.includes("DEEPSEEK_API_KEY") ? 500 : 422;
    const responseBody = {
      status,
      errorCode: status,
      message,
      generatedAt: new Date().toISOString()
    };
    const storage = await saveCostRunResponse(responseBody);
    sendJson(res, statusCode, {
      ...responseBody,
      costRunStorage: storage
    });
  }
}

async function handleAutoLabelQualityRun(req, res, runId) {
  try {
    const body = await readBody(req);
    const run = await loadQualityRun(runId);
    const ids = Array.isArray(body.questionIds) ? new Set(body.questionIds.map(String)) : null;
    const rows = ids ? run.reviewRows.filter((row) => ids.has(row.questionId)) : run.reviewRows;
    const autoLabels = await autoLabelReviewRows(rows);
    run.reviewRows = mergeAutoLabels(expandReviewRows(run.reviewRows), autoLabels);
    run.status = "ready_for_review";
    run.autoLabelError = "";
    run.updatedAt = new Date().toISOString();
    run.stats = calculateRunStats(run.reviewRows);
    await saveQualityRun(run);
    sendJson(res, 200, run);
  } catch (error) {
    sendJson(res, 422, {
      errorCode: "auto_label_failed",
      message: error instanceof Error ? error.message : "AI 预标注失败。"
    });
  }
}

async function handleQualityRunAnnotation(req, res, runId) {
  try {
    const body = await readBody(req);
    const run = await loadQualityRun(runId);
    const annotations = Array.isArray(body.annotations) ? body.annotations : [body];
    const results = annotations.map((annotation) => applyAnnotation(run, annotation));
    await saveQualityRun(run);
    sendJson(res, 200, { run, results });
  } catch (error) {
    sendJson(res, 422, {
      errorCode: "annotation_save_failed",
      message: error instanceof Error ? error.message : "保存标注失败。"
    });
  }
}

async function handleGetQualityRun(req, res, runId) {
  try {
    const run = await loadQualityRun(runId);
    sendJson(res, 200, run);
  } catch {
    sendJson(res, 404, { errorCode: "quality_run_not_found", message: "质量工作台记录不存在。" });
  }
}

async function handleExportQualityRun(req, res, runId) {
  try {
    const run = await loadQualityRun(runId);
    const csv = toCsv(run.reviewRows);
    sendText(res, 200, csv, "text/csv; charset=utf-8");
  } catch {
    try {
      const csv = await readFile(qualityRunManualCsvFile(runId), "utf8");
      sendText(res, 200, csv, "text/csv; charset=utf-8");
    } catch {
      sendJson(res, 404, { errorCode: "quality_run_not_found", message: "质量工作台记录不存在。" });
    }
  }
}

async function runChapterGeneration(deviceId, chapterId, body) {
  const runId = createId("generation");
  generationRuns.set(generationRunKey(deviceId, chapterId), runId);
  if (hasDatabase) {
    await startGenerationJob(deviceId, {
      id: runId,
      chapterId,
      status: "submitted",
      currentStage: "submitted"
    });
  }
  const updateStage = (status) => updateMemoryChapterStage(deviceId, chapterId, status, runId).catch((error) => {
    console.error("Failed to update generation stage", error);
  });
  try {
    await updateStage("extracting_content");
    const result = await withTimeout(
      generateFromInput(body, { onStage: updateStage }),
      GENERATION_JOB_TIMEOUT_MS,
      () => generationTimeoutError()
    );
    if (!isCurrentGenerationRun(deviceId, chapterId, runId)) return;
    const existing = await getStoredChapter(deviceId, chapterId);
    const chapter = await upsertMemoryChapter(deviceId, {
      ...(result.chapter || failedSourceResult({
      status: result.status,
      message: result.message || "生成失败",
      body
    }).chapter),
      id: chapterId,
      createdAt: existing?.createdAt
    });
    await createMemoryNotification(deviceId, chapter);
    if (hasDatabase) {
      await updateGenerationJob(deviceId, runId, {
        status: chapter.status,
        currentStage: chapter.status,
        finished: true
      });
    }
  } catch (error) {
    if (!isCurrentGenerationRun(deviceId, chapterId, runId)) return;
    const status = error?.code || error?.status || "failed_questions";
    const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
    const failed = failedSourceResult({ status, message, body });
    const existing = await getStoredChapter(deviceId, chapterId);
    const chapter = await upsertMemoryChapter(deviceId, {
      ...failed.chapter,
      id: chapterId,
      createdAt: existing?.createdAt
    });
    await createMemoryNotification(deviceId, chapter);
    if (hasDatabase) {
      await updateGenerationJob(deviceId, runId, {
        status,
        currentStage: status,
        errorMessage: message,
        finished: true
      });
    }
  } finally {
    if (isCurrentGenerationRun(deviceId, chapterId, runId)) {
      generationRuns.delete(generationRunKey(deviceId, chapterId));
    }
  }
}

async function handleRegenerateChapter(req, res, chapterId) {
  const deviceId = getDeviceId(req);
  const existing = await getStoredChapter(deviceId, chapterId);
  if (!existing) {
    sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
    return;
  }
  const submittedChapter = await upsertMemoryChapter(deviceId, createRegeneratingChapter(existing));
  if (hasDatabase) {
    await enqueueGenerationJob(deviceId, {
      id: createId("generation"),
      chapterId: existing.id,
      status: "submitted",
      currentStage: "submitted",
      jobType: "regenerate_chapter",
      payload: { chapterId: existing.id }
    });
  }
  sendJson(res, 202, {
    status: submittedChapter.status,
    chapter: serializeChapterForClient(submittedChapter),
    notification: null,
    message: "已排队，正在等待重新生成。"
  });
  if (!hasDatabase) void runChapterRegeneration(deviceId, existing);
}

async function runChapterRegeneration(deviceId, existing) {
  const runId = createId("generation");
  generationRuns.set(generationRunKey(deviceId, existing.id), runId);
  if (hasDatabase) {
    await startGenerationJob(deviceId, {
      id: runId,
      chapterId: existing.id,
      status: "submitted",
      currentStage: "submitted"
    });
  }
  const updateStage = (status) => updateMemoryChapterStage(deviceId, existing.id, status, runId).catch((error) => {
    console.error("Failed to update regeneration stage", error);
  });
  try {
    await updateStage("generating_points");
    const result = await withTimeout(
      regenerateFromChapter(existing, { onStage: updateStage }),
      GENERATION_JOB_TIMEOUT_MS,
      () => generationTimeoutError()
    );
    if (!isCurrentGenerationRun(deviceId, existing.id, runId)) return;
    const chapter = await upsertMemoryChapter(deviceId, {
      ...(result.chapter || {}),
      id: existing.id,
      createdAt: existing.createdAt
    });
    await createMemoryNotification(deviceId, chapter);
    if (hasDatabase) {
      await updateGenerationJob(deviceId, runId, {
        status: chapter.status,
        currentStage: chapter.status,
        finished: true
      });
    }
  } catch (error) {
    if (!isCurrentGenerationRun(deviceId, existing.id, runId)) return;
    const status = error?.code || error?.status || "failed_questions";
    const message = error instanceof Error ? error.message : "重新生成失败，请稍后重试。";
    const failed = failedSourceResult({ status, message, body: existing });
    const chapter = await upsertMemoryChapter(deviceId, {
      ...failed.chapter,
      id: existing.id,
      createdAt: existing.createdAt
    });
    await createMemoryNotification(deviceId, chapter);
    if (hasDatabase) {
      await updateGenerationJob(deviceId, runId, {
        status,
        currentStage: status,
        errorMessage: message,
        finished: true
      });
    }
  } finally {
    if (isCurrentGenerationRun(deviceId, existing.id, runId)) {
      generationRuns.delete(generationRunKey(deviceId, existing.id));
    }
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createQualityRunId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `quality-workbench-${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function costWorkbenchEnabled() {
  if (process.env.ENABLE_COST_WORKBENCH === "1") return true;
  if (process.env.ENABLE_COST_WORKBENCH === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function buildCostRunResponse(result = {}) {
  const chapter = result.chapter || {};
  const generationMeta = chapter.generationMeta || {};
  const modelUsage = Array.isArray(generationMeta.modelUsage) ? generationMeta.modelUsage : [];
  const costSummary = generationMeta.costSummary || {
    callCount: modelUsage.length,
    currencies: [],
    totalsByCurrency: {},
    byStage: [],
    reportText: ""
  };

  return {
    status: result.status || chapter.status || "unknown",
    displayStatusText: result.displayStatusText || chapter.displayStatusText || "",
    message: result.message || chapter.failureReason || "",
    chapterTitle: chapter.title || "",
    questionCount: Array.isArray(chapter.questions) ? chapter.questions.length : 0,
    knowledgePointCount: Array.isArray(chapter.knowledgePoints) ? chapter.knowledgePoints.length : 0,
    qualitySummary: chapter.qualitySummary || null,
    generationRunId: generationMeta.generationRunId || "",
    modelUsage,
    costSummary,
    reportText: costSummary.reportText || "",
    generatedAt: new Date().toISOString()
  };
}

async function saveCostRunResponse(responseBody, { root = costRunRoot } = {}) {
  await mkdir(root, { recursive: true });
  const runId = sanitizeCostRunFileName(responseBody.generationRunId || responseBody.generatedAt || `cost-run-${Date.now()}`);
  const runFileName = `${runId}.json`;
  const runPath = join(root, runFileName);
  const latestPath = join(root, "latest.json");
  const storage = {
    latestPath: relativeProjectPath(latestPath),
    runPath: relativeProjectPath(runPath)
  };
  const payload = {
    ...responseBody,
    costRunStorage: storage
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(runPath, serialized, "utf8");
  await writeFile(latestPath, serialized, "utf8");
  return storage;
}

function sanitizeCostRunFileName(value) {
  return String(value || "cost-run")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "cost-run";
}

function relativeProjectPath(filePath) {
  return normalize(filePath).startsWith(normalize(projectRoot))
    ? normalize(filePath).slice(normalize(projectRoot).length + 1)
    : normalize(filePath);
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function generationRunKey(deviceId, chapterId) {
  return `${deviceId}:${chapterId}`;
}

function getDeviceId(req) {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_DEVICE_ID;
}

function getMemory(deviceId) {
  if (!memoryByDeviceId.has(deviceId)) {
    memoryByDeviceId.set(deviceId, { chapters: [], notifications: [], pushTokens: [], favorites: [] });
  }
  return memoryByDeviceId.get(deviceId);
}

async function listStoredChapters(deviceId) {
  if (hasDatabase) return listDatabaseChapters(deviceId);
  return getMemory(deviceId).chapters;
}

async function getStoredChapter(deviceId, chapterId) {
  if (hasDatabase) return getDatabaseChapter(deviceId, chapterId);
  return getMemory(deviceId).chapters.find((item) => item.id === chapterId) || null;
}

async function upsertStoredChapter(deviceId, chapter) {
  const record = ensureChapterRecord(chapter);
  if (hasDatabase) return upsertDatabaseChapter(deviceId, record);
  const memory = getMemory(deviceId);
  const existingIndex = memory.chapters.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) {
    memory.chapters.splice(existingIndex, 1, { ...memory.chapters[existingIndex], ...record });
  } else {
    memory.chapters.unshift(record);
  }
  return memory.chapters.find((item) => item.id === record.id);
}

async function deleteStoredChapter(deviceId, chapterId) {
  if (hasDatabase) return deleteDatabaseChapter(deviceId, chapterId);
  const memory = getMemory(deviceId);
  const before = memory.chapters.length;
  memory.chapters = memory.chapters.filter((chapter) => chapter.id !== chapterId);
  memory.notifications = memory.notifications.filter((notification) => notification.chapterId !== chapterId);
  memory.favorites = memory.favorites.filter((favorite) => favorite.chapterId !== chapterId);
  return memory.chapters.length !== before;
}

async function deleteStoredDeviceData(deviceId) {
  generationRuns.forEach((_, key) => {
    if (key.startsWith(`${deviceId}:`)) generationRuns.delete(key);
  });
  if (hasDatabase) return deleteDatabaseDeviceData(deviceId);
  const memory = getMemory(deviceId);
  const deleted = {
    chapters: memory.chapters.length,
    notifications: memory.notifications.length,
    generationJobs: 0,
    favorites: memory.favorites.length
  };
  memory.chapters = [];
  memory.notifications = [];
  memory.pushTokens = [];
  memory.favorites = [];
  return deleted;
}

async function listStoredFavoriteQuestions(deviceId) {
  if (hasDatabase) return listDatabaseFavoriteQuestions(deviceId);
  return getMemory(deviceId).favorites;
}

async function getStoredFavoriteQuestion(deviceId, favoriteId) {
  if (hasDatabase) return getDatabaseFavoriteQuestion(deviceId, favoriteId);
  return getMemory(deviceId).favorites.find((item) => item.id === favoriteId) || null;
}

async function upsertStoredFavoriteQuestion(deviceId, favorite) {
  const record = normalizeFavoriteQuestion(favorite);
  if (hasDatabase) return upsertDatabaseFavoriteQuestion(deviceId, record);
  const memory = getMemory(deviceId);
  const existingIndex = memory.favorites.findIndex((item) => item.chapterId === record.chapterId && item.questionId === record.questionId);
  if (existingIndex >= 0) {
    memory.favorites.splice(existingIndex, 1, record);
  } else {
    memory.favorites.unshift(record);
  }
  return memory.favorites.find((item) => item.id === record.id);
}

async function deleteStoredFavoriteQuestion(deviceId, favoriteId) {
  if (hasDatabase) return deleteDatabaseFavoriteQuestion(deviceId, favoriteId);
  const memory = getMemory(deviceId);
  const before = memory.favorites.length;
  memory.favorites = memory.favorites.filter((item) => item.id !== favoriteId);
  return memory.favorites.length !== before;
}

async function upsertStoredPushToken(deviceId, pushToken) {
  const record = normalizePushToken(pushToken);
  if (record.token.length < 32) return null;
  if (hasDatabase) {
    await upsertDatabasePushToken(deviceId, record);
    return record;
  }
  const memory = getMemory(deviceId);
  memory.pushTokens = [record];
  return record;
}

async function listStoredPushTokens(deviceId) {
  if (hasDatabase) return listDatabasePushTokens(deviceId);
  return getMemory(deviceId).pushTokens;
}

async function listStoredNotifications(deviceId) {
  if (hasDatabase) return listDatabaseNotifications(deviceId);
  return getMemory(deviceId).notifications;
}

async function getStoredNotification(deviceId, notificationId) {
  if (hasDatabase) return getDatabaseNotification(deviceId, notificationId);
  return getMemory(deviceId).notifications.find((item) => item.id === notificationId) || null;
}

async function upsertStoredNotification(deviceId, notification) {
  const record = normalizeNotification(notification);
  if (hasDatabase) return upsertDatabaseNotification(deviceId, record);
  const memory = getMemory(deviceId);
  const existingIndex = memory.notifications.findIndex((item) => item.id === record.id);
  if (existingIndex >= 0) {
    memory.notifications.splice(existingIndex, 1, record);
  } else {
    memory.notifications.unshift(record);
  }
  return memory.notifications.find((item) => item.id === record.id);
}

async function deleteStoredNotificationsForChapter(deviceId, chapterId, type = "") {
  if (hasDatabase) {
    await deleteNotificationsForChapter(deviceId, chapterId, type);
    return;
  }
  const memory = getMemory(deviceId);
  memory.notifications = memory.notifications.filter((item) => {
    if (item.chapterId !== chapterId) return true;
    return type ? item.type !== type : false;
  });
}

function isCurrentGenerationRun(deviceId, chapterId, runId) {
  return generationRuns.get(generationRunKey(deviceId, chapterId)) === runId;
}

async function updateMemoryChapterStage(deviceId, chapterId, status, runId) {
  if (!isCurrentGenerationRun(deviceId, chapterId, runId)) return;
  const chapter = await getStoredChapter(deviceId, chapterId);
  if (!chapter) return;

  const now = new Date().toISOString();
  const displayStatusText = STATUS_TEXT[status] || status;
  const meta = chapter.generationMeta || { stages: [] };
  const stages = Array.isArray(meta.stages) ? meta.stages : [];
  const shouldAppend = meta.currentStage !== status || stages.length === 0;

  chapter.status = status;
  chapter.displayStatusText = displayStatusText;
  chapter.generationMeta = {
    ...meta,
    currentStage: status,
    stages: shouldAppend
      ? [...stages, { status, displayStatusText, at: now }]
      : stages
  };
  chapter.updatedAt = now;
  await upsertStoredChapter(deviceId, chapter);
  if (hasDatabase) {
    await updateGenerationJob(deviceId, runId, {
      status,
      currentStage: status
    });
  }
}

function normalizeChapterSource(chapter, chapterId) {
  const source = chapter.source || {};
  const type = normalizeSourceType(source.type || chapter.sourceType);
  const rawInput = toStringValue(source.rawInput || source.rawText || chapter.rawInput || chapter.sourceText || "");
  const extractedText = toStringValue(source.extractedText || source.cleanedText || chapter.extractedText || rawInput);
  const author = toStringValue(source.author || source.publisher || source.accountOrDomain || source.account || chapter.sourceAccount || chapter.source_account_or_platform || "");
  const accountOrDomain = toStringValue(source.accountOrDomain || source.account || source.author || source.publisher || chapter.sourceAccount || chapter.source_account_or_platform || "");
  const contentBasis = normalizeSourceContentBasis(source.contentBasis);
  return {
    type,
    title: toStringValue(source.title || chapter.sourceTitle || chapter.title || (type === "text" ? "粘贴文字" : "未命名来源")),
    url: toStringValue(source.url || chapter.sourceUrl || ""),
    author,
    accountOrDomain,
    platform: toStringValue(source.platform || chapter.sourcePlatform || ""),
    durationSeconds: Number.isFinite(Number(source.durationSeconds || chapter.durationSeconds))
      ? Number(source.durationSeconds || chapter.durationSeconds)
      : null,
    ...(contentBasis ? { contentBasis } : {}),
    media: normalizeSourceMedia(source.media),
    rawInput,
    extractedText,
    blocks: normalizeV2SourceBlocks(source.blocks),
    chapterId,
    account: accountOrDomain,
    rawText: rawInput,
    cleanedText: extractedText
  };
}

function normalizeSourceContentBasis(contentBasis) {
  if (!contentBasis || typeof contentBasis !== "object" || Array.isArray(contentBasis)) return null;
  const basis = toStringValue(contentBasis.basis);
  const message = toStringValue(contentBasis.message);
  if (!["audio_visual", "audio_transcript"].includes(basis) || !message) return null;
  return { basis, message };
}

function normalizeSourceType(type) {
  return ["text", "article_link", "wechat_article", "video_link"].includes(type) ? type : "text";
}

function normalizeKnowledgeType(type) {
  return ["concept", "judgment", "method", "scenario", "counterexample", "comparison", "step"].includes(type) ? type : "concept";
}

function normalizeStructureRole(role) {
  return [
    "main_claim",
    "supporting_reason",
    "method_step",
    "boundary",
    "case_evidence",
    "background",
    "detail"
  ].includes(role) ? role : "";
}

function normalizeQuestionType(type) {
  return ["multiple_choice", "true_false", "scenario_judgment"].includes(type) ? type : "multiple_choice";
}

function normalizeChapterStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_TEXT, status) ? status : "failed_questions";
}

function toStringValue(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function toNumberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toIntegerValue(value, fallback = 0) {
  return Math.round(toNumberValue(value, fallback));
}

function nullableInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeKnowledgePoints(points, chapterId) {
  const now = new Date().toISOString();
  return points.map((point, index) => {
    const id = toStringValue(point.id || `kp-${index + 1}`);
    const sourceSnippet = toStringValue(point.sourceSnippet || point.source_snippet || point.sourceQuote || "");
    return {
      id,
      chapterId: toStringValue(point.chapterId || point.chapter_id || chapterId),
      title: toStringValue(point.title || `知识点 ${index + 1}`),
      summary: toStringValue(point.summary || point.keyClaim || ""),
      keyClaim: toStringValue(point.keyClaim || point.summary || ""),
      knowledgeType: normalizeKnowledgeType(point.knowledgeType || point.knowledge_type),
      structureRole: normalizeStructureRole(point.structureRole || point.structure_role),
      importanceScore: toIntegerValue(point.importanceScore ?? point.importance_score, 3),
      coverageReason: toStringValue(point.coverageReason || point.coverage_reason || ""),
      sourceSnippet,
      sourceQuote: toStringValue(point.sourceQuote || sourceSnippet),
      sourceOrder: toIntegerValue(point.sourceOrder ?? point.source_order, index),
      sourceStartOffset: nullableInteger(point.sourceStartOffset ?? point.source_start_offset),
      sourceEndOffset: nullableInteger(point.sourceEndOffset ?? point.source_end_offset),
      testabilityScore: toIntegerValue(point.testabilityScore ?? point.testability_score, 3),
      masteryScore: toIntegerValue(point.masteryScore ?? point.mastery_score, INITIAL_MASTERY_SCORE),
      answeredCount: toIntegerValue(point.answeredCount ?? point.answered_count, 0),
      lastReviewedAt: point.lastReviewedAt ? toStringValue(point.lastReviewedAt) : null,
      lastDecayAppliedAt: point.lastDecayAppliedAt ? toStringValue(point.lastDecayAppliedAt) : null,
      createdAt: toStringValue(point.createdAt || now),
      updatedAt: toStringValue(point.updatedAt || now)
    };
  }).sort(compareNormalizedSourceOrder);
}

function normalizeQuestions(questions, chapterId, knowledgePoints = []) {
  const now = new Date().toISOString();
  return questions.map((question, index) => {
    const knowledgePointId = toStringValue(question.knowledgePointId || question.pointId || question.knowledge_point_id || "");
    const point = knowledgePoints.find((item) => item.id === knowledgePointId);
    const sourceSnippet = toStringValue(question.sourceSnippet || question.source_snippet || question.sourceQuote || "");
    return {
      id: toStringValue(question.id || `q-${index + 1}`),
      chapterId: toStringValue(question.chapterId || question.chapter_id || chapterId),
      knowledgePointId,
      pointId: knowledgePointId,
      pointTitle: toStringValue(question.pointTitle || point?.title || ""),
      type: normalizeQuestionType(question.type || question.questionType || question.question_type),
      stem: toStringValue(question.stem || ""),
      options: normalizeQuestionOptions(question.options),
      correctOptionId: toStringValue(question.correctOptionId || question.correct_answer || question.correctAnswer || ""),
      correctUnderstanding: toStringValue(question.correctUnderstanding || question.correct_understanding || question.fullExplanation || ""),
      commonMisconception: toStringValue(question.commonMisconception || question.common_misconception || ""),
      sourceSnippet,
      sourceQuote: toStringValue(question.sourceQuote || sourceSnippet),
      memoryAngle: toStringValue(question.memoryAngle || ""),
      sourceOrder: toIntegerValue(question.sourceOrder ?? question.source_order ?? point?.sourceOrder, index),
      sourceStartOffset: nullableInteger(question.sourceStartOffset ?? question.source_start_offset ?? point?.sourceStartOffset),
      sourceEndOffset: nullableInteger(question.sourceEndOffset ?? question.source_end_offset ?? point?.sourceEndOffset),
      difficulty: toStringValue(question.difficulty || "medium"),
      qualityScore: normalizeQualityScore(question.qualityScore),
      qualityIssues: Array.isArray(question.qualityIssues) ? question.qualityIssues.map((issue) => toStringValue(issue)).filter(Boolean) : [],
      trustDiagnostics: normalizeTrustDiagnostics(question.trustDiagnostics),
      confidenceReasons: Array.isArray(question.confidenceReasons) ? question.confidenceReasons.map((reason) => toStringValue(reason)).filter(Boolean) : [],
      blockingReasons: Array.isArray(question.blockingReasons) ? question.blockingReasons.map((reason) => toStringValue(reason)).filter(Boolean) : [],
      confidenceTier: toStringValue(question.confidenceTier || ""),
      sourceContextSelection: question.sourceContextSelection && typeof question.sourceContextSelection === "object" ? question.sourceContextSelection : null,
      sourcePrecisionScore: nullableNumber(question.sourcePrecisionScore ?? question.trustDiagnostics?.sourcePrecisionScore),
      sourceSpecificityScore: nullableNumber(question.sourceSpecificityScore),
      sourceMinimalityScore: nullableNumber(question.sourceMinimalityScore),
      sourceEvidenceRole: toStringValue(question.sourceEvidenceRole || ""),
      sourceBlockId: toStringValue(question.sourceBlockId || question.sourceContextSelection?.sourceBlockId || ""),
      sourceEvidenceDiversityScore: nullableNumber(question.sourceEvidenceDiversityScore ?? question.sourceContextSelection?.sourceEvidenceDiversityScore),
      sourceReuseReason: toStringValue(question.sourceReuseReason || question.sourceContextSelection?.sourceReuseReason || ""),
      sourceOverlapGroupId: toStringValue(question.sourceOverlapGroupId || ""),
      sourceOverlapRatio: nullableNumber(question.sourceOverlapRatio),
      sourceReuseCount: toIntegerValue(question.sourceReuseCount ?? question.sourceContextSelection?.reuseCount, 0),
      confidenceLevel: question.confidenceLevel === "low" ? "low" : "high",
      retainedBy: toStringValue(question.retainedBy || (question.confidenceLevel === "low" ? "best_effort_quality_fallback" : "quality_pass")),
      shortExplanation: toStringValue(question.shortExplanation || question.explanation || ""),
      fullExplanation: toStringValue(question.fullExplanation || question.correctUnderstanding || question.correct_understanding || ""),
      pitfalls: Array.isArray(question.pitfalls) ? question.pitfalls.map((pitfall) => toStringValue(pitfall)).filter(Boolean) : [],
      isNew: Boolean(question.isNew),
      createdAt: toStringValue(question.createdAt || now),
      updatedAt: toStringValue(question.updatedAt || now)
    };
  }).sort(compareNormalizedSourceOrder);
}

function normalizeTrustDiagnostics(value) {
  if (!value || typeof value !== "object") return {};
  return {
    answerGroundingScore: nullableNumber(value.answerGroundingScore),
    explanationFaithfulnessScore: nullableNumber(value.explanationFaithfulnessScore),
    contextRelevanceScore: nullableNumber(value.contextRelevanceScore),
    misconceptionSupportScore: nullableNumber(value.misconceptionSupportScore),
    sourcePrecisionScore: nullableNumber(value.sourcePrecisionScore)
  };
}

function compareNormalizedSourceOrder(a, b) {
  if (a.sourceOrder !== b.sourceOrder) return a.sourceOrder - b.sourceOrder;
  const aStart = Number.isFinite(a.sourceStartOffset) ? a.sourceStartOffset : Number.MAX_SAFE_INTEGER;
  const bStart = Number.isFinite(b.sourceStartOffset) ? b.sourceStartOffset : Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;
  return String(a.id).localeCompare(String(b.id));
}

function normalizeQuestionOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option, index) => ({
    id: toStringValue(option?.id || `option-${index + 1}`),
    text: toStringValue(option?.text || option?.label || option?.content || "")
  }));
}

function normalizeV2SourceBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block, index) => ({
    id: toStringValue(block?.id || `p-${String(index + 1).padStart(3, "0")}`),
    type: toStringValue(block?.type || "paragraph"),
    text: toStringValue(block?.text || ""),
    ...(block?.sourceRole ? { sourceRole: toStringValue(block.sourceRole) } : {}),
    ...(Number.isFinite(Number(block?.startSeconds)) ? { startSeconds: Number(block.startSeconds) } : {}),
    ...(Number.isFinite(Number(block?.endSeconds)) ? { endSeconds: Number(block.endSeconds) } : {})
  })).filter((block) => block.text);
}

function normalizeSourceMedia(media) {
  if (!media || typeof media !== "object" || Array.isArray(media)) return null;
  return {
    provider: toStringValue(media.provider || ""),
    providerContentId: toStringValue(media.providerContentId || ""),
    coverUrl: toStringValue(media.coverUrl || ""),
    playUrlExpiresAt: toStringValue(media.playUrlExpiresAt || "")
  };
}

function normalizeV2SummaryCard(summaryCard) {
  if (!summaryCard || typeof summaryCard !== "object" || Array.isArray(summaryCard)) return null;
  return {
    text: toStringValue(summaryCard.text || ""),
    ...(summaryCard.note ? { note: toStringValue(summaryCard.note) } : {})
  };
}

function normalizeV2ChapterSummary(chapterSummary) {
  if (!chapterSummary || typeof chapterSummary !== "object" || Array.isArray(chapterSummary)) return null;
  return {
    title: toStringValue(chapterSummary.title || "章节完成"),
    statsText: toStringValue(chapterSummary.statsText || ""),
    encouragementText: toStringValue(chapterSummary.encouragementText || "")
  };
}

function normalizeV2Units(units) {
  if (!Array.isArray(units)) return [];
  return units.map((unit, index) => ({
    id: toStringValue(unit?.id || `unit-${index + 1}`),
    order: toIntegerValue(unit?.order, index + 1),
    title: toStringValue(unit?.title || `知识点 ${index + 1}`),
    nodeLabel: toStringValue(unit?.nodeLabel || unit?.title || ""),
    shortSummary: toStringValue(unit?.shortSummary || ""),
    detailSummary: toStringValue(unit?.detailSummary || ""),
    why: toStringValue(unit?.why || ""),
    sourceAnchor: normalizeV2SourceAnchor(unit?.sourceAnchor),
    overview: {
      text: toStringValue(unit?.overview?.text || unit?.overview || "")
    },
    questions: normalizeV2UnitQuestions(unit?.questions),
    summary: {
      title: toStringValue(unit?.summary?.title || "单元完成"),
      text: toStringValue(unit?.summary?.text || "")
    }
  }));
}

function normalizeV2SourceAnchor(anchor) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  return {
    id: toStringValue(anchor.id || ""),
    label: toStringValue(anchor.label || ""),
    blockIds: Array.isArray(anchor.blockIds) ? anchor.blockIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    quote: toStringValue(anchor.quote || "")
  };
}

function normalizeV2UnitQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((question, index) => ({
    id: toStringValue(question?.id || `q-${index + 1}`),
    type: toStringValue(question?.type || "multiple_choice"),
    stem: toStringValue(question?.stem || question?.prompt || ""),
    options: normalizeQuestionOptions(question?.options),
    correctOptionId: toStringValue(question?.correctOptionId || ""),
    leftItems: normalizeQuestionOptions(question?.leftItems),
    rightItems: normalizeQuestionOptions(question?.rightItems),
    pairs: Array.isArray(question?.pairs)
      ? question.pairs.map((pair) => ({
        leftId: toStringValue(pair?.leftId || ""),
        rightId: toStringValue(pair?.rightId || "")
      })).filter((pair) => pair.leftId && pair.rightId)
      : [],
    explanation: toStringValue(question?.explanation || question?.shortExplanation || ""),
    sourceAnchorId: toStringValue(question?.sourceAnchorId || "")
  }));
}

function normalizeQualityScore(qualityScore) {
  if (!qualityScore || typeof qualityScore !== "object" || Array.isArray(qualityScore)) return null;
  return Object.fromEntries(
    Object.entries(qualityScore)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function normalizeQualitySummary(qualitySummary) {
  if (!qualitySummary || typeof qualitySummary !== "object" || Array.isArray(qualitySummary)) return null;
  return {
    averageQualityScore: Number.isFinite(Number(qualitySummary.averageQualityScore))
      ? Number(qualitySummary.averageQualityScore)
      : (Number.isFinite(Number(qualitySummary.averageScore)) ? Number(qualitySummary.averageScore) : null),
    questionCoverageRate: Number.isFinite(Number(qualitySummary.questionCoverageRate))
      ? Number(qualitySummary.questionCoverageRate)
      : (Number.isFinite(Number(qualitySummary.coverageRate)) ? Number(qualitySummary.coverageRate) : null),
    totalGenerated: toIntegerValue(qualitySummary.totalGenerated, 0),
    retainedQuestionCount: toIntegerValue(qualitySummary.retainedQuestionCount, 0),
    averageQuestionsPerPoint: Number.isFinite(Number(qualitySummary.averageQuestionsPerPoint))
      ? Number(qualitySummary.averageQuestionsPerPoint)
      : 0,
    questionCountDistribution: normalizeObjectCounts(qualitySummary.questionCountDistribution),
    questionTypeCoverage: normalizeObjectCounts(qualitySummary.questionTypeCoverage),
    lowConfidenceQuestionCount: toIntegerValue(qualitySummary.lowConfidenceQuestionCount, 0),
    uncoveredPointCount: toIntegerValue(qualitySummary.uncoveredPointCount, 0),
    seriousIssueCount: toIntegerValue(qualitySummary.seriousIssueCount, 0),
    judgeUnavailable: Boolean(qualitySummary.judgeUnavailable)
  };
}

function normalizeObjectCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, count]) => Number.isFinite(Number(count)))
      .map(([key, count]) => [String(key), Number(count)])
  );
}

function ensureChapterRecord(chapter) {
  const now = new Date().toISOString();
  const id = chapter.id || createId("chapter");
  const source = normalizeChapterSource(chapter, id);
  const knowledgePoints = normalizeKnowledgePoints(chapter.knowledgePoints || [], id);
  const filteredKnowledgePoints = normalizeKnowledgePoints(chapter.filteredKnowledgePoints || [], id);
  const questions = normalizeQuestions(chapter.questions || [], id, knowledgePoints);
  const units = normalizeV2Units(chapter.units || []);
  const status = normalizeChapterStatus(chapter.status || "completed");
  const baseChapter = { ...chapter, id, source, knowledgePoints, questions };
  return {
    schemaVersion: toStringValue(chapter.schemaVersion || ""),
    id,
    title: toStringValue(chapter.title || chapter.chapterTitle || source.title || "未命名章节"),
    status,
    displayStatusText: toStringValue(chapter.displayStatusText || STATUS_TEXT[status] || ""),
    failureReason: toStringValue(chapter.failureReason || ""),
    source,
    sourceType: source.type,
    sourceText: source.rawInput || source.extractedText || "",
    coreSummary: toStringValue(chapter.coreSummary || ""),
    summaryCard: normalizeV2SummaryCard(chapter.summaryCard),
    units,
    chapterSummary: normalizeV2ChapterSummary(chapter.chapterSummary),
    knowledgePoints,
    filteredKnowledgePoints,
    questions,
    qualitySummary: normalizeQualitySummary(chapter.qualitySummary),
    generationMeta: normalizeGenerationMeta(chapter.generationMeta),
    generationProgress: normalizeGenerationProgress(
      chapter.generationProgress ||
      chapter.generationMeta?.v2Progress ||
      chapter.generationMeta?.generationProgress,
      id
    ),
    reviewSession: chapter.reviewSession ? normalizeReviewSession(chapter.reviewSession, baseChapter) : null,
    v2ReviewSession: chapter.v2ReviewSession || chapter.v2_review_session || null,
    v2AwakeningSession: chapter.v2AwakeningSession || chapter.v2_awakening_session || null,
    v2ReviewCompletedAt: toStringValue(
      chapter.v2ReviewCompletedAt ||
      chapter.v2_review_completed_at ||
      chapter.v2ReviewSession?.completedAt ||
      chapter.v2_review_session?.completedAt ||
      ""
    ),
    masteredPoints: toIntegerValue(chapter.masteredPoints, 0),
    removedQuestionIds: Array.isArray(chapter.removedQuestionIds) ? chapter.removedQuestionIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    downgradedQuestionIds: Array.isArray(chapter.downgradedQuestionIds) ? chapter.downgradedQuestionIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    feedbackRecords: normalizeFeedbackRecords(chapter.feedbackRecords),
    dismissedFromNotifications: Boolean(chapter.dismissedFromNotifications),
    createdAt: toStringValue(chapter.createdAt || now),
    updatedAt: toStringValue(chapter.updatedAt || now)
  };
}

function serializeChapterForClient(chapter) {
  return ensureChapterRecord(chapter);
}

function serializeChaptersForClient(chapters = []) {
  return chapters.map(serializeChapterForClient);
}

function normalizeGenerationProgress(progress, chapterId = "") {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return null;
  return {
    jobId: toStringValue(progress.jobId || ""),
    chapterId: toStringValue(progress.chapterId || chapterId),
    status: toStringValue(progress.status || ""),
    stage: toStringValue(progress.stage || ""),
    stageGroup: toStringValue(progress.stageGroup || ""),
    displayText: toStringValue(progress.displayText || ""),
    progress:
      progress.progress === null || progress.progress === undefined
        ? null
        : Number.isFinite(Number(progress.progress))
          ? Number(progress.progress)
          : null,
    retryCount: toIntegerValue(progress.retryCount, 0),
    userVisible: progress.userVisible === undefined ? true : Boolean(progress.userVisible),
    ...(progress.unitIndex === null || progress.unitIndex === undefined ? {} : { unitIndex: toIntegerValue(progress.unitIndex, 0) }),
    ...(progress.unitTitle ? { unitTitle: toStringValue(progress.unitTitle) } : {}),
    ...(progress.attempt === null || progress.attempt === undefined ? {} : { attempt: toIntegerValue(progress.attempt, 0) }),
    ...(progress.maxAttempts === null || progress.maxAttempts === undefined ? {} : { maxAttempts: toIntegerValue(progress.maxAttempts, 0) }),
    canRetry: Boolean(progress.canRetry),
    updatedAt: toStringValue(progress.updatedAt || ""),
    ...(progress.failureCode ? { failureCode: toStringValue(progress.failureCode) } : {}),
    ...(progress.failureMessage ? { failureMessage: toStringValue(progress.failureMessage) } : {})
  };
}

function normalizeGenerationMeta(generationMeta) {
  if (!generationMeta || typeof generationMeta !== "object" || Array.isArray(generationMeta)) return null;
  const { generationRunId, modelUsage, costSummary, ...clientMeta } = generationMeta;
  return {
    ...clientMeta,
    currentStage: clientMeta.currentStage ? toStringValue(clientMeta.currentStage) : null,
    qualifiedQuestionCount: clientMeta.qualifiedQuestionCount === undefined || clientMeta.qualifiedQuestionCount === null
      ? null
      : toIntegerValue(clientMeta.qualifiedQuestionCount, 0),
    failedStage: clientMeta.failedStage ? toStringValue(clientMeta.failedStage) : null,
    failureReason: clientMeta.failureReason ? toStringValue(clientMeta.failureReason) : null
  };
}

function normalizeNotification(notification = {}) {
  return {
    id: toStringValue(notification.id || createId("notification")),
    chapterId: toStringValue(notification.chapterId || notification.chapter_id || ""),
    type: notification.type === "generation_failed" ? "generation_failed" : "generation_completed",
    title: toStringValue(notification.title || ""),
    body: toStringValue(notification.body || ""),
    read: Boolean(notification.read),
    dismissed: Boolean(notification.dismissed),
    pushAttemptedAt: toStringValue(notification.pushAttemptedAt || notification.push_attempted_at || ""),
    pushSentAt: toStringValue(notification.pushSentAt || notification.push_sent_at || ""),
    pushDeliveryStatus: toStringValue(notification.pushDeliveryStatus || notification.push_delivery_status || ""),
    pushDeliveryError: toStringValue(notification.pushDeliveryError || notification.push_delivery_error || ""),
    pushAttemptCount: toIntegerValue(notification.pushAttemptCount ?? notification.push_attempt_count, 0),
    createdAt: toStringValue(notification.createdAt || notification.created_at || new Date().toISOString())
  };
}

function serializeNotificationForClient(notification) {
  return normalizeNotification(notification);
}

function serializeNotificationsForClient(notifications = []) {
  return notifications.map(serializeNotificationForClient);
}

function normalizeFavoriteQuestion(favorite = {}) {
  const chapterId = toStringValue(favorite.chapterId || favorite.chapter_id || "");
  const questionId = toStringValue(favorite.questionId || favorite.question_id || "");
  return {
    id: toStringValue(favorite.id || createFavoriteQuestionId(chapterId, questionId)),
    chapterId,
    questionId,
    createdAt: toStringValue(favorite.createdAt || favorite.created_at || new Date().toISOString())
  };
}

function createFavoriteQuestionId(chapterId, questionId) {
  return `favorite-${encodeURIComponent(chapterId)}-${encodeURIComponent(questionId)}`;
}

function serializeFavoriteQuestionForClient(favorite) {
  return normalizeFavoriteQuestion(favorite);
}

function serializeFavoriteQuestionsForClient(favorites = []) {
  return favorites.map(serializeFavoriteQuestionForClient);
}

function chapterHasQuestion(chapter, questionId) {
  if (!chapter || !questionId) return false;
  if ((chapter.questions || []).some((question) => question.id === questionId)) {
    return true;
  }
  return (chapter.units || []).some((unit) => {
    return (unit.questions || []).some((question) => question.id === questionId);
  });
}

function normalizeFeedbackRecords(feedbackRecords) {
  if (!Array.isArray(feedbackRecords)) return [];
  return feedbackRecords.map((feedback, index) => ({
    id: toStringValue(feedback.id || `feedback-${index + 1}`),
    questionId: toStringValue(feedback.questionId || feedback.question_id || ""),
    knowledgePointId: toStringValue(feedback.knowledgePointId || feedback.knowledge_point_id || ""),
    chapterId: toStringValue(feedback.chapterId || feedback.chapter_id || ""),
    reviewSessionId: toStringValue(feedback.reviewSessionId || feedback.review_session_id || ""),
    feedbackType: normalizeFeedbackType(feedback.feedbackType || feedback.feedback_type || feedback.type),
    severity: toStringValue(feedback.severity || "light"),
    actionTaken: toStringValue(feedback.actionTaken || feedback.action_taken || ""),
    invalidatedAttemptId: toStringValue(feedback.invalidatedAttemptId || feedback.invalidated_attempt_id || ""),
    createdAt: toStringValue(feedback.createdAt || feedback.created_at || new Date().toISOString())
  }));
}

async function upsertMemoryChapter(deviceId, chapter) {
  return upsertStoredChapter(deviceId, chapter);
}

async function createMemoryNotification(deviceId, chapter) {
  return createGenerationNotification({
    deviceId,
    chapter,
    deleteNotificationsForChapter: deleteStoredNotificationsForChapter,
    upsertNotification: upsertStoredNotification,
    sendPushNotifications: sendStoredPushNotifications
  });
}

function normalizePushToken(pushToken = {}) {
  const now = new Date().toISOString();
  return {
    token: toStringValue(pushToken.token || pushToken.deviceToken || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase(),
    platform: pushToken.platform === "ios" ? "ios" : "ios",
    environment: pushToken.environment === "sandbox" ? "sandbox" : "production",
    preferredLanguage: normalizePreferredLanguage(pushToken.preferredLanguage || pushToken.preferred_language),
    createdAt: toStringValue(pushToken.createdAt || pushToken.created_at || now),
    updatedAt: toStringValue(pushToken.updatedAt || pushToken.updated_at || now)
  };
}

function normalizePreferredLanguage(value = "") {
  return value === "en" ? "en" : "zh-Hans";
}

function serializePushTokenForDiagnostics(token = {}) {
  const normalized = normalizePushToken(token);
  const tail = normalized.token ? normalized.token.slice(-8) : "";
  return {
    tokenTail: tail,
    platform: normalized.platform,
    environment: normalized.environment,
    preferredLanguage: normalized.preferredLanguage,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

function serializeNotificationPushDiagnostics(notification = {}) {
  const normalized = normalizeNotification(notification);
  return {
    id: normalized.id,
    chapterId: normalized.chapterId,
    type: normalized.type,
    title: normalized.title,
    read: normalized.read,
    dismissed: normalized.dismissed,
    pushAttemptedAt: normalized.pushAttemptedAt,
    pushSentAt: normalized.pushSentAt,
    pushDeliveryStatus: normalized.pushDeliveryStatus,
    pushDeliveryError: normalized.pushDeliveryError,
    pushAttemptCount: normalized.pushAttemptCount,
    createdAt: normalized.createdAt
  };
}

async function sendStoredPushNotifications(deviceId, notification, chapter) {
  if (!notification || notification.dismissed) return { skipped: true, reason: "notification_unavailable" };
  if (!isAPNSConfigured()) {
    await updateStoredNotificationPushDelivery(deviceId, notification, {
      status: "apns_not_configured",
      error: "APNs is not configured."
    });
    return { skipped: true, reason: "apns_not_configured" };
  }
  try {
    const tokens = await listStoredPushTokens(deviceId);
    if (tokens.length === 0) {
      await updateStoredNotificationPushDelivery(deviceId, notification, {
        status: "no_tokens",
        error: "No APNs token registered for this device."
      });
      return { skipped: true, reason: "no_tokens" };
    }

    const results = await Promise.all(tokens.map(async (token) => {
      const result = await sendGenerationNotification({ token, notification, chapter });
      if (result && !result.skipped && !result.ok) {
        console.warn("APNs send failed", {
          deviceId,
          chapterId: chapter?.id,
          notificationId: notification.id,
          status: result.status,
          body: result.body
        });
      }
      return { token, result };
    }));
    const sentCount = results.filter(({ result }) => result?.ok).length;
    const failedResult = results.find(({ result }) => result && !result.skipped && !result.ok)?.result;
    await updateStoredNotificationPushDelivery(deviceId, notification, {
      sent: sentCount > 0,
      status: sentCount > 0 ? "sent" : "failed",
      error: sentCount > 0 ? "" : (failedResult?.body || failedResult?.status || "APNs send failed.")
    });
    return { sentCount, tokenCount: tokens.length };
  } catch (error) {
    console.warn("APNs send skipped after error", error instanceof Error ? error.message : error);
    await updateStoredNotificationPushDelivery(deviceId, notification, {
      status: "error",
      error: error instanceof Error ? error.message : "APNs send failed."
    });
    return { skipped: true, reason: "error" };
  }
}

async function updateStoredNotificationPushDelivery(deviceId, notification, delivery = {}) {
  const current = await getStoredNotification(deviceId, notification.id) || notification;
  const now = new Date().toISOString();
  const next = normalizeNotification({
    ...current,
    pushAttemptedAt: now,
    pushSentAt: delivery.sent ? now : current.pushSentAt,
    pushDeliveryStatus: delivery.status || current.pushDeliveryStatus,
    pushDeliveryError: delivery.error === undefined ? current.pushDeliveryError : toStringValue(delivery.error),
    pushAttemptCount: toIntegerValue(current.pushAttemptCount, 0) + 1
  });
  await upsertStoredNotification(deviceId, next);
  return next;
}

function normalizeReviewSession(session = {}, chapter = {}) {
  const now = new Date().toISOString();
  const normalized = {
    schemaVersion: toIntegerValue(session.schemaVersion ?? session.schema_version, 1),
    id: toStringValue(session.id || createId("session")),
    chapterId: toStringValue(session.chapterId || chapter.id || ""),
    status: normalizeReviewSessionStatus(session.status),
    queue: normalizeReviewQueue(session.queue),
    reinforcementQueue: Array.isArray(session.reinforcementQueue) ? session.reinforcementQueue.map((id) => toStringValue(id)).filter(Boolean) : [],
    currentQueueIndex: toIntegerValue(session.currentQueueIndex, 0),
    attempts: Array.isArray(session.attempts) ? session.attempts.map(normalizeReviewAttempt) : [],
    masteryByPointId: normalizeMasteryByPointId(session.masteryByPointId),
    answeredPointIds: Array.isArray(session.answeredPointIds) ? session.answeredPointIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    masteredThisRoundPointIds: Array.isArray(session.masteredThisRoundPointIds) ? session.masteredThisRoundPointIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    completedQueueItemIds: Array.isArray(session.completedQueueItemIds) ? session.completedQueueItemIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    correctQuestionIds: Array.isArray(session.correctQuestionIds) ? session.correctQuestionIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    needsReviewQuestionIds: Array.isArray(session.needsReviewQuestionIds) ? session.needsReviewQuestionIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    skippedPointIds: Array.isArray(session.skippedPointIds) ? session.skippedPointIds.map((id) => toStringValue(id)).filter(Boolean) : [],
    createdAt: toStringValue(session.createdAt || now),
    updatedAt: toStringValue(session.updatedAt || now),
    completedAt: session.completedAt ? toStringValue(session.completedAt) : null
  };
  for (const point of chapter.knowledgePoints || []) {
    if (!Number.isFinite(normalized.masteryByPointId[point.id])) {
      normalized.masteryByPointId[point.id] = point.masteryScore ?? INITIAL_MASTERY_SCORE;
    }
  }
  return normalized;
}

function normalizeReviewSessionStatus(status) {
  return ["active", "completed", "abandoned"].includes(status) ? status : "active";
}

function normalizeReviewQueue(queue) {
  if (!Array.isArray(queue)) return [];
  return queue.map((item, index) => ({
    id: toStringValue(item?.id || `queue-${index + 1}`),
    pointId: toStringValue(item?.pointId || item?.point_id || ""),
    questionId: toStringValue(item?.questionId || item?.question_id || ""),
    isReinforcement: Boolean(item?.isReinforcement || item?.is_reinforcement),
    reinforcementAttempt: toIntegerValue(item?.reinforcementAttempt ?? item?.reinforcement_attempt, 0)
  }));
}

function normalizeMasteryByPointId(masteryByPointId) {
  if (!masteryByPointId || typeof masteryByPointId !== "object" || Array.isArray(masteryByPointId)) return {};
  return Object.fromEntries(
    Object.entries(masteryByPointId)
      .map(([key, value]) => [key, toIntegerValue(value, INITIAL_MASTERY_SCORE)])
  );
}

function normalizeReviewAttempt(attempt = {}) {
  return {
    id: toStringValue(attempt.id || createId("attempt")),
    reviewSessionId: toStringValue(attempt.reviewSessionId || attempt.review_session_id || ""),
    chapterId: toStringValue(attempt.chapterId || attempt.chapter_id || ""),
    knowledgePointId: toStringValue(attempt.knowledgePointId || attempt.knowledge_point_id || ""),
    questionId: toStringValue(attempt.questionId || attempt.question_id || ""),
    queueItemId: toStringValue(attempt.queueItemId || attempt.queue_item_id || ""),
    answer: toStringValue(attempt.answer || ""),
    result: attempt.result || "unknown",
    isReinforcement: Boolean(attempt.isReinforcement || attempt.is_reinforcement),
    masteryScoreBefore: toIntegerValue(attempt.masteryScoreBefore ?? attempt.mastery_score_before, INITIAL_MASTERY_SCORE),
    masteryScoreAfter: toIntegerValue(attempt.masteryScoreAfter ?? attempt.mastery_score_after, INITIAL_MASTERY_SCORE),
    invalidatedByFeedback: Boolean(attempt.invalidatedByFeedback || attempt.invalidated_by_feedback),
    skippedDueToQuestionFeedback: Boolean(attempt.skippedDueToQuestionFeedback || attempt.skipped_due_to_question_feedback),
    answeredAt: toStringValue(attempt.answeredAt || attempt.answered_at || new Date().toISOString())
  };
}

function createReviewSessionForChapter(chapter) {
  const masteryByPointId = {};
  for (const point of chapter.knowledgePoints || []) {
    masteryByPointId[point.id] = point.masteryScore ?? INITIAL_MASTERY_SCORE;
  }
  return normalizeReviewSession({
    schemaVersion: REVIEW_SESSION_SCHEMA_VERSION,
    id: createId("session"),
    chapterId: chapter.id,
    status: "active",
    queue: buildReviewQueueForChapter(chapter),
    reinforcementQueue: [],
    currentQueueIndex: 0,
    attempts: [],
    masteryByPointId,
    answeredPointIds: [],
    masteredThisRoundPointIds: [],
    completedQueueItemIds: [],
    correctQuestionIds: [],
    needsReviewQuestionIds: [],
    skippedPointIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  }, chapter);
}

function buildReviewQueueForChapter(chapter) {
  return reviewableQuestionsForChapter(chapter).map((question) => ({
    id: createId("queue"),
    pointId: question.knowledgePointId,
    questionId: question.id,
    isReinforcement: false,
    reinforcementAttempt: 0
  }));
}

function reviewableQuestionsForChapter(chapter) {
  const removed = new Set(chapter.removedQuestionIds || []);
  const pointOrder = new Map(
    [...(chapter.knowledgePoints || [])]
      .sort(compareNormalizedSourceOrder)
      .map((point, index) => [point.id, index])
  );
  return [...(chapter.questions || [])]
    .filter((question) => question?.id && question.knowledgePointId && !removed.has(question.id))
    .sort((a, b) => {
      const aPoint = pointOrder.has(a.knowledgePointId) ? pointOrder.get(a.knowledgePointId) : Number.MAX_SAFE_INTEGER;
      const bPoint = pointOrder.has(b.knowledgePointId) ? pointOrder.get(b.knowledgePointId) : Number.MAX_SAFE_INTEGER;
      if (aPoint !== bPoint) return aPoint - bPoint;
      return compareNormalizedSourceOrder(a, b);
    });
}

function startOrResumeReviewSession(chapter) {
  const existingSession = chapter.reviewSession
    ? normalizeReviewSession(chapter.reviewSession, chapter)
    : null;
  if (existingSession?.status === "active") {
    chapter.reviewSession = migrateReviewSessionIfNeeded(chapter, existingSession);
  } else {
    chapter.reviewSession = createReviewSessionForChapter(chapter);
  }
  recalculateRoundMastery(chapter, chapter.reviewSession);
  updateChapterMasteredPoints(chapter, chapter.reviewSession);
  chapter.updatedAt = new Date().toISOString();
  return chapter.reviewSession;
}

function migrateReviewSessionIfNeeded(chapter, session) {
  if (session.schemaVersion >= REVIEW_SESSION_SCHEMA_VERSION) {
    ensureReviewQueueCoversAllQuestions(chapter, session);
    return session;
  }

  const migrated = normalizeReviewSession({
    ...session,
    schemaVersion: REVIEW_SESSION_SCHEMA_VERSION,
    queue: buildReviewQueueForChapter(chapter),
    reinforcementQueue: [],
    completedQueueItemIds: [],
    correctQuestionIds: [],
    needsReviewQuestionIds: []
  }, chapter);

  for (const attempt of migrated.attempts.filter((item) => !item.invalidatedByFeedback)) {
    if (attempt.result === "correct") addUnique(migrated.correctQuestionIds, attempt.questionId);
  }
  for (const legacyItem of session.queue || []) {
    if (session.masteredThisRoundPointIds?.includes(legacyItem.pointId)) {
      addUnique(migrated.correctQuestionIds, legacyItem.questionId);
    }
  }
  for (const item of migrated.queue) {
    if (migrated.correctQuestionIds.includes(item.questionId)) addUnique(migrated.completedQueueItemIds, item.id);
  }
  const nextIndex = nextAvailableQueueIndex(chapter, migrated, 0);
  migrated.currentQueueIndex = nextIndex >= 0 ? nextIndex : Math.max(0, migrated.queue.length - 1);
  return migrated;
}

function ensureReviewQueueCoversAllQuestions(chapter, session) {
  const queuedMainQuestionIds = new Set(
    session.queue
      .filter((item) => !item.isReinforcement)
      .map((item) => item.questionId)
  );
  for (const question of reviewableQuestionsForChapter(chapter)) {
    if (queuedMainQuestionIds.has(question.id)) continue;
    session.queue.push({
      id: createId("queue"),
      pointId: question.knowledgePointId,
      questionId: question.id,
      isReinforcement: false,
      reinforcementAttempt: 0
    });
  }
}

function currentQueueItem(session) {
  return session.queue[session.currentQueueIndex] || null;
}

function currentQuestionForSession(chapter, session) {
  const item = currentQueueItem(session);
  return questionById(chapter, item?.questionId);
}

function questionById(chapter, questionId) {
  return (chapter.questions || []).find((question) => question.id === questionId) || null;
}

function pickQuestionForPoint(chapter, pointId, excludeQuestionId = "") {
  const removed = new Set(chapter.removedQuestionIds || []);
  const candidates = (chapter.questions || []).filter((question) => {
    return question.knowledgePointId === pointId && !removed.has(question.id);
  }).sort(compareNormalizedSourceOrder);
  if (!candidates.length) return null;
  return candidates.find((question) => question.id !== excludeQuestionId) || candidates[0];
}

function recordSessionAttempt(chapter, body = {}) {
  const session = startOrResumeReviewSession(chapter);
  const item = queueItemForAttempt(session, body);
  const submittedQuestionId = toStringValue(body.questionId || body.question_id || "");
  const question = item ? questionById(chapter, item.questionId) : (submittedQuestionId ? questionById(chapter, submittedQuestionId) : currentQuestionForSession(chapter, session));
  if (!item || !question) {
    const error = new Error("当前复习队列没有可作答题目。");
    error.statusCode = 422;
    throw error;
  }
  if (submittedQuestionId && item.questionId !== submittedQuestionId) {
    const error = new Error("答题队列项和题目不匹配，请刷新后重试。");
    error.statusCode = 409;
    throw error;
  }
  const pointId = item.pointId || question.knowledgePointId;
  const result = normalizeAttemptResult(body.result);
  const scoreBefore = session.masteryByPointId[pointId] ?? INITIAL_MASTERY_SCORE;
  const isReinforcement = Boolean(item.isReinforcement);
  const scoreAfter = clampMastery(scoreBefore + scoreDelta(result, isReinforcement));
  const attempt = normalizeReviewAttempt({
    id: createId("attempt"),
    reviewSessionId: session.id,
    chapterId: chapter.id,
    knowledgePointId: pointId,
    questionId: question.id,
    queueItemId: item.id,
    answer: body.answer || body.selectedOptionId || "",
    result,
    isReinforcement,
    masteryScoreBefore: scoreBefore,
    masteryScoreAfter: scoreAfter,
    answeredAt: new Date().toISOString()
  });

  session.attempts.push(attempt);
  session.masteryByPointId[pointId] = scoreAfter;
  addUnique(session.answeredPointIds, pointId);
  addUnique(session.completedQueueItemIds, item.id);
  if (result === "correct") {
    addUnique(session.correctQuestionIds, question.id);
    session.needsReviewQuestionIds = session.needsReviewQuestionIds.filter((id) => id !== question.id);
    session.reinforcementQueue = session.reinforcementQueue.filter((id) => id !== question.id);
    removeFutureReinforcementForQuestion(session, question.id);
  } else {
    scheduleReinforcement(chapter, session, item);
  }
  recalculateRoundMastery(chapter, session);

  const nextIndex = nextAvailableQueueIndex(chapter, session, session.currentQueueIndex + 1);
  session.currentQueueIndex = nextIndex >= 0 ? nextIndex : session.currentQueueIndex;
  if (isSessionComplete(chapter, session)) {
    session.status = "completed";
    session.completedAt = new Date().toISOString();
  }
  session.updatedAt = new Date().toISOString();
  updateChapterMasteredPoints(chapter, session);
  chapter.updatedAt = new Date().toISOString();
  return { attempt, session, question: currentQuestionForSession(chapter, session) };
}

function queueItemForAttempt(session, body = {}) {
  const queueItemId = toStringValue(body.queueItemId || body.queue_item_id || "");
  const questionId = toStringValue(body.questionId || body.question_id || "");
  if (queueItemId) {
    return session.queue.find((item) => item.id === queueItemId) || null;
  }
  const current = currentQueueItem(session);
  if (!questionId || current?.questionId === questionId) return current;
  return session.queue.find((item) => item.questionId === questionId && !session.completedQueueItemIds.includes(item.id))
    || session.queue.find((item) => item.questionId === questionId)
    || current;
}

function normalizeAttemptResult(result) {
  if (result === "wrong" || result === "incorrect") return "incorrect";
  if (result === "correct") return "correct";
  return "unknown";
}

function scoreDelta(result, isReinforcement) {
  if (result === "correct") return isReinforcement ? 10 : 15;
  return isReinforcement ? -15 : -20;
}

function scheduleReinforcement(chapter, session, answeredItem) {
  const questionId = answeredItem.questionId;
  removeFutureReinforcementForQuestion(session, questionId);
  const nextReinforcementAttempt = toIntegerValue(answeredItem.reinforcementAttempt, 0) + 1;
  if (nextReinforcementAttempt > MAX_REINFORCEMENTS_PER_QUESTION) {
    addUnique(session.needsReviewQuestionIds, questionId);
    session.reinforcementQueue = session.reinforcementQueue.filter((id) => id !== questionId);
    return;
  }
  addUnique(session.reinforcementQueue, questionId);
  const item = {
    id: createId("reinforce"),
    pointId: answeredItem.pointId,
    questionId,
    isReinforcement: true,
    reinforcementAttempt: nextReinforcementAttempt
  };
  session.queue.splice(reinforcementInsertIndex(chapter, session, answeredItem.pointId), 0, item);
}

function reinforcementInsertIndex(chapter, session, pointId) {
  let seenOtherQuestions = 0;
  for (let index = session.currentQueueIndex + 1; index < session.queue.length; index += 1) {
    const item = session.queue[index];
    if (!isQueueItemAvailable(chapter, session, item) || item.pointId === pointId) continue;
    seenOtherQuestions += 1;
    if (seenOtherQuestions >= REINFORCEMENT_GAP) return index + 1;
  }
  return session.queue.length;
}

function removeFutureReinforcementForQuestion(session, questionId) {
  session.queue = session.queue.filter((item, index) => {
    if (index <= session.currentQueueIndex) return true;
    return !(item.isReinforcement && item.questionId === questionId);
  });
}

function nextAvailableQueueIndex(chapter, session, startIndex) {
  for (let index = startIndex; index < session.queue.length; index += 1) {
    if (!session.completedQueueItemIds.includes(session.queue[index].id)
      && isQueueItemAvailable(chapter, session, session.queue[index])) return index;
  }
  return -1;
}

function isQueueItemAvailable(chapter, session, item) {
  if (!item || session.skippedPointIds.includes(item.pointId)) return false;
  return Boolean(questionById(chapter, item.questionId) && !(chapter.removedQuestionIds || []).includes(item.questionId));
}

function requiredQueueItemsForSession(chapter, session) {
  return (session.queue || []).filter((item) => isQueueItemAvailable(chapter, session, item));
}

function isSessionComplete(chapter, session) {
  const required = requiredQueueItemsForSession(chapter, session);
  return required.length > 0 && required.every((item) => session.completedQueueItemIds.includes(item.id));
}

function currentMasteredCount(chapter, session) {
  recalculateRoundMastery(chapter, session);
  return session.masteredThisRoundPointIds.length;
}

function updateChapterMasteredPoints(chapter, session) {
  if (!session) return;
  const totalPointCount = Array.isArray(chapter.knowledgePoints) ? chapter.knowledgePoints.length : 0;
  const currentCount = currentMasteredCount(chapter, session);
  const lifetimeCount = Math.max(
    toIntegerValue(chapter.masteredPoints, 0),
    currentCount
  );
  chapter.masteredPoints = Math.min(totalPointCount, lifetimeCount);
}

function recalculateRoundMastery(chapter, session) {
  const removed = new Set(chapter.removedQuestionIds || []);
  const mainQuestionsByPoint = new Map();
  for (const item of session.queue || []) {
    if (item.isReinforcement || session.skippedPointIds.includes(item.pointId) || removed.has(item.questionId)) continue;
    if (!questionById(chapter, item.questionId)) continue;
    if (!mainQuestionsByPoint.has(item.pointId)) mainQuestionsByPoint.set(item.pointId, []);
    mainQuestionsByPoint.get(item.pointId).push(item.questionId);
  }
  session.masteredThisRoundPointIds = [];
  for (const [pointId, questionIds] of mainQuestionsByPoint.entries()) {
    if (questionIds.every((id) => session.correctQuestionIds.includes(id))) {
      session.masteredThisRoundPointIds.push(pointId);
    }
  }
}

async function handleQuestionFeedback(deviceId, questionId, body = {}) {
  const chapters = await listStoredChapters(deviceId);
  const chapter = chapters.find((item) => item.questions?.some((question) => question.id === questionId));
  if (!chapter) return null;
  const question = questionById(chapter, questionId);
  const session = chapter.reviewSession ? normalizeReviewSession(chapter.reviewSession, chapter) : null;
  const pointId = question.knowledgePointId;
  const feedbackType = normalizeFeedbackType(body.feedbackType || body.type);
  const severe = isSevereFeedback(feedbackType);
  let invalidatedAttemptId = "";
  let actionTaken = "downranked_for_user";

  if (severe) {
    addUnique(chapter.removedQuestionIds, questionId);
    actionTaken = "removed_from_pool";
    if (session) {
      const attempt = latestValidAttemptForQuestion(session, questionId);
      if (attempt) {
        attempt.invalidatedByFeedback = true;
        attempt.skippedDueToQuestionFeedback = true;
        session.masteryByPointId[attempt.knowledgePointId] = attempt.masteryScoreBefore;
        invalidatedAttemptId = attempt.id;
      }
      session.queue = session.queue.filter((item, index) => index === session.currentQueueIndex || item.questionId !== questionId);
      session.completedQueueItemIds = session.completedQueueItemIds.filter((id) => {
        const queueItem = session.queue.find((item) => item.id === id);
        return queueItem && queueItem.questionId !== questionId;
      });
      session.correctQuestionIds = session.correctQuestionIds.filter((id) => id !== questionId);
      session.needsReviewQuestionIds = session.needsReviewQuestionIds.filter((id) => id !== questionId);
      session.reinforcementQueue = session.reinforcementQueue.filter((id) => id !== questionId);
      if (!pickQuestionForPoint(chapter, pointId)) {
        addUnique(session.skippedPointIds, pointId);
        session.answeredPointIds = session.answeredPointIds.filter((id) => id !== pointId);
        session.masteredThisRoundPointIds = session.masteredThisRoundPointIds.filter((id) => id !== pointId);
        actionTaken = "skipped_for_session";
      }
      recalculateRoundMastery(chapter, session);
      session.updatedAt = new Date().toISOString();
      chapter.reviewSession = session;
    }
  } else {
    addUnique(chapter.downgradedQuestionIds, questionId);
  }

  const feedback = {
    id: createId("feedback"),
    questionId,
    knowledgePointId: pointId,
    chapterId: chapter.id,
    reviewSessionId: session?.id || "",
    feedbackType,
    severity: severe ? "severe" : "light",
    actionTaken,
    invalidatedAttemptId,
    createdAt: new Date().toISOString()
  };
  chapter.feedbackRecords.push(feedback);
  if (session) updateChapterMasteredPoints(chapter, session);
  chapter.updatedAt = new Date().toISOString();
  await upsertStoredChapter(deviceId, chapter);
  return { chapter, feedback, reviewSession: chapter.reviewSession };
}

function isV2ReviewableChapter(chapter) {
  return Boolean(
    chapter &&
    String(chapter.status || "") === "completed" &&
    Array.isArray(chapter.units) &&
    chapter.units.length > 0
  );
}

function startOrResumeV2ReviewSession(chapter) {
  if (!isV2ReviewableChapter(chapter)) {
    const error = new Error("这个章节暂时不能开始 V2 复习。");
    error.statusCode = 422;
    throw error;
  }

  const existingSession = chapter.v2ReviewSession
    ? normalizeReviewSessionV2(chapter, chapter.v2ReviewSession)
    : null;
  rememberV2ReviewCompletion(chapter, existingSession);

  chapter.v2ReviewSession = existingSession?.status === "active"
    ? existingSession
    : createReviewSessionV2(chapter);
  chapter.updatedAt = new Date().toISOString();
  return chapter.v2ReviewSession;
}

function applyV2ReviewSessionMutation(chapter, mutator) {
  if (!isV2ReviewableChapter(chapter)) {
    const error = new Error("这个章节暂时不能继续 V2 复习。");
    error.statusCode = 422;
    throw error;
  }

  const currentSession = chapter.v2ReviewSession
    ? normalizeReviewSessionV2(chapter, chapter.v2ReviewSession)
    : createReviewSessionV2(chapter);
  chapter.v2ReviewSession = mutator(currentSession);
  rememberV2ReviewCompletion(chapter, chapter.v2ReviewSession);
  chapter.updatedAt = new Date().toISOString();
  return chapter.v2ReviewSession;
}

function rememberV2ReviewCompletion(chapter, session) {
  const completedAt = toStringValue(session?.completedAt || "");
  if (!completedAt) return;
  chapter.v2ReviewCompletedAt = toStringValue(chapter.v2ReviewCompletedAt || "") || completedAt;
}

function serializeV2ReviewSessionResponse(chapter, reviewSession) {
  const responseChapter = serializeChapterForClient(chapter);
  return {
    chapter: responseChapter,
    reviewSession: reviewSession
      ? normalizeReviewSessionV2(responseChapter, reviewSession)
      : null
  };
}

function activeAwakeningChapter(chapters = []) {
  return [...chapters]
    .filter((chapter) => isActiveAwakeningSessionV2(chapter.v2AwakeningSession))
    .sort((left, right) => {
      const leftUpdatedAt = Date.parse(left.v2AwakeningSession?.updatedAt || left.updatedAt || "") || 0;
      const rightUpdatedAt = Date.parse(right.v2AwakeningSession?.updatedAt || right.updatedAt || "") || 0;
      return rightUpdatedAt - leftUpdatedAt;
    })[0] || null;
}

function latestCompletedAwakeningQuestionId(chapters = []) {
  const latest = [...chapters]
    .filter((chapter) => chapter.v2AwakeningSession?.status === "completed")
    .sort((left, right) => {
      const leftCompletedAt = Date.parse(left.v2AwakeningSession?.completedAt || "") || 0;
      const rightCompletedAt = Date.parse(right.v2AwakeningSession?.completedAt || "") || 0;
      return rightCompletedAt - leftCompletedAt;
    })[0];
  return toStringValue(latest?.v2AwakeningSession?.questionId || "");
}

function serializeStoredAwakeningResponse(deviceId, chapters, chapter, session) {
  const availableCount = listAwakeningCandidatesV2(chapters, {
    deviceId,
    excludeQuestionId: session?.status === "completed" ? session.questionId : ""
  }).length;
  return {
    ...serializeAwakeningResponseV2({
      chapter,
      session,
      availableCount
    }),
    chapter: chapter ? serializeChapterForClient(chapter) : null
  };
}

function normalizeFeedbackType(type) {
  if (type === "wrong_answer") return "answer_wrong";
  if (type === "unrelated_source") return "unrelated_to_source";
  if (type === "too_easy" || type === "unclear" || type === "unrelated_to_source" || type === "answer_wrong") return type;
  return "unclear";
}

function isSevereFeedback(type) {
  return type === "answer_wrong" || type === "unclear" || type === "unrelated_to_source";
}

function latestValidAttemptForQuestion(session, questionId) {
  for (let index = session.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = session.attempts[index];
    if (attempt.questionId === questionId && !attempt.invalidatedByFeedback) return attempt;
  }
  return null;
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function clampMastery(value) {
  return Math.min(100, Math.max(0, value));
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/") {
    sendJson(res, 200, {
      service: "shibei-api",
      status: "ok",
      workflow: "link -> extract -> summarize -> review"
    });
    return;
  }
  sendJson(res, 404, { errorCode: "not_found", message: "接口不存在。" });
}

const server = createServer(async (req, res) => {
  res.shibeiCorsHeaders = corsHeadersForRequest(req);
  const deviceIdResult = resolveDeviceId(req, DEFAULT_DEVICE_ID);
  const deviceId = deviceIdResult.deviceId;

  try {
    const guardError = evaluateRequestGuards(req, { deviceIdResult });
    if (guardError) {
      sendJson(res, guardError.statusCode || 400, {
        errorCode: guardError.errorCode || "request_rejected",
        message: guardError.message || "请求暂时不可用。"
      });
      return;
    }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsPreflightHeaders(req)
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://localhost");
  const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

  if (["GET", "HEAD"].includes(req.method) && pathname === "/demo") {
    await sendPublicHtml(req, res, "ios-app-demo.html");
    return;
  }

  if (["GET", "HEAD"].includes(req.method) && ["/app-demo", "/ios-preview"].includes(pathname)) {
    await sendPublicHtml(req, res, "ios-app-demo.html");
    return;
  }

  if (["GET", "HEAD"].includes(req.method) && pathname.startsWith("/app-demo-assets/")) {
    await sendAppDemoAsset(req, res, pathname.slice("/app-demo-assets/".length));
    return;
  }

  if (["GET", "HEAD"].includes(req.method) && ["/privacy", "/privacy-policy.html"].includes(pathname)) {
    await sendPublicHtml(req, res, "privacy-policy.html");
    return;
  }

  if (["GET", "HEAD"].includes(req.method) && ["/support", "/support.html"].includes(pathname)) {
    await sendPublicHtml(req, res, "support.html");
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    const database = await checkDatabase();
    const count = hasDatabase ? await chapterCount() : Array.from(memoryByDeviceId.values()).reduce((sum, item) => sum + item.chapters.length, 0);
    const queue = hasDatabase ? await getGenerationQueueSummary() : null;
    const version = await buildVersionInfo({ startedAt });
    sendJson(res, 200, {
      ok: true,
      service: "recallo-api",
      startedAt,
      version,
      storage: hasDatabase ? "postgres" : "memory",
      database,
      queue,
      apns: apnsConfigurationSummary(),
      capabilities: buildServiceCapabilities(),
      chapterCount: count,
      memoryChapterCount: count
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/version") {
    sendJson(res, 200, await buildVersionInfo({ startedAt }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/source/capabilities") {
    sendJson(res, 200, buildSourceCapabilities());
    return;
  }

  if (req.method === "GET" && req.url === "/api/source/runtime-readiness") {
    const expectedToken = process.env.RUNTIME_READINESS_TOKEN || "";
    const actualToken = req.headers["x-runtime-readiness-token"] || "";
    if (!expectedToken || actualToken !== expectedToken) {
      sendJson(res, 404, { errorCode: "not_found", message: "Not found" });
      return;
    }
    sendJson(res, 200, await buildMemoizedVideoRuntimeReadiness());
    return;
  }

  const temporaryMediaMatch = pathname.match(/^\/api\/asr-media\/([0-9a-f-]{36})$/i);
  if (["GET", "HEAD"].includes(req.method) && temporaryMediaMatch) {
    await handleTemporaryAsrMedia(req, res, temporaryMediaMatch[1]);
    return;
  }

  if (req.method === "POST" && req.url === "/api/sources/preflight") {
    await handleSourcePreflight(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/sources/image-flow") {
    await handleImageFlow(req, res);
    return;
  }

  const imageFlowJobMatch = pathname.match(/^\/api\/sources\/image-flow\/jobs\/([0-9a-f-]{36})$/i);
  if (req.method === "GET" && imageFlowJobMatch) {
    const job = getImageFlowJob(imageFlowJobMatch[1], { ownerId: getDeviceId(req) });
    sendJson(res, job ? 200 : 404, job || { errorCode: "image_flow_job_not_found", message: "任务不存在或已过期。" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/memory-cards") {
    try {
      const result = await captureMemoryRepository.list(deviceId, {
        pool: requestUrl.searchParams.get("pool") || ""
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 422, {
        errorCode: error.code || "capture_memory_cards_unavailable",
        message: error.message || "暂时无法读取记忆卡。"
      });
    }
    return;
  }

  const captureMemoryCardMatch = pathname.match(/^\/api\/memory-cards\/([^/]+)$/);
  if (req.method === "DELETE" && captureMemoryCardMatch) {
    const result = await captureMemoryRepository.deleteCard(
      deviceId,
      decodeURIComponent(captureMemoryCardMatch[1])
    );
    if (!result) {
      sendJson(res, 404, {
        errorCode: "capture_memory_card_not_found",
        message: "记忆卡不存在。"
      });
    } else {
      sendJson(res, 200, result);
    }
    return;
  }

  const captureMemoryAssessmentMatch = pathname.match(/^\/api\/memory-cards\/([^/]+)\/assessments$/);
  if (req.method === "POST" && captureMemoryAssessmentMatch) {
    try {
      const body = await readBody(req);
      const result = await captureMemoryRepository.recordAssessment(
        deviceId,
        decodeURIComponent(captureMemoryAssessmentMatch[1]),
        {
          attemptId: body.attemptId,
          assessment: body.assessment
        }
      );
      if (!result) {
        sendJson(res, 404, {
          errorCode: "capture_memory_card_not_found",
          message: "记忆卡不存在。"
        });
      } else {
        sendJson(res, 200, result);
      }
    } catch (error) {
      sendJson(res, error.statusCode || 422, {
        errorCode: error.code || "capture_memory_assessment_not_recorded",
        message: error.message || "复习反馈保存失败。"
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/apple") {
    await handleAppleAuth(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/account") {
    await handleGetAccount(req, res);
    return;
  }

  if (req.method === "DELETE" && req.url === "/api/account") {
    await handleDeleteAccount(req, res);
    return;
  }

  if (req.method === "POST" && (req.url === "/api/generate" || req.url === "/api/regenerate")) {
    await handleGenerate(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/quality-runs") {
    await handleCreateQualityRun(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/cost-runs") {
    await handleCreateCostRun(req, res);
    return;
  }

  const qualityRunExportMatch = req.url?.match(/^\/api\/quality-runs\/([^/]+)\/export\.csv$/);
  if (qualityRunExportMatch && req.method === "GET") {
    await handleExportQualityRun(req, res, decodeURIComponent(qualityRunExportMatch[1]));
    return;
  }

  const qualityRunAutoLabelMatch = req.url?.match(/^\/api\/quality-runs\/([^/]+)\/auto-label$/);
  if (qualityRunAutoLabelMatch && req.method === "POST") {
    await handleAutoLabelQualityRun(req, res, decodeURIComponent(qualityRunAutoLabelMatch[1]));
    return;
  }

  const qualityRunAnnotationMatch = req.url?.match(/^\/api\/quality-runs\/([^/]+)\/annotations$/);
  if (qualityRunAnnotationMatch && req.method === "POST") {
    await handleQualityRunAnnotation(req, res, decodeURIComponent(qualityRunAnnotationMatch[1]));
    return;
  }

  const qualityRunMatch = req.url?.match(/^\/api\/quality-runs\/([^/]+)$/);
  if (qualityRunMatch && req.method === "GET") {
    await handleGetQualityRun(req, res, decodeURIComponent(qualityRunMatch[1]));
    return;
  }

  if (req.method === "POST" && req.url === "/api/chapters") {
    await handleCreateChapter(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/v2/chapters") {
    await handleCreateV2Chapter(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/v2/recommended-articles") {
    try {
      const catalog = await loadRecommendedArticleCatalog();
      sendJson(res, 200, serializeRecommendedArticleCatalogForClient(catalog, { baseUrl: requestBaseUrl(req) }));
    } catch (error) {
      sendJson(res, 500, {
        errorCode: "recommended_articles_unavailable",
        message: error instanceof Error ? error.message : "推荐文章暂时不可用。"
      });
    }
    return;
  }

  const recommendedArticleCoverMatch = req.url?.match(/^\/api\/v2\/recommended-articles\/([^/]+)\/cover$/);
  if (recommendedArticleCoverMatch && req.method === "GET") {
    try {
      const coverPath = await getRecommendedArticleCoverPath({
        articleId: decodeURIComponent(recommendedArticleCoverMatch[1])
      });
      const data = await readFile(coverPath);
      res.writeHead(200, {
        "content-type": contentTypes[extname(coverPath)] || "application/octet-stream",
        ...responseCorsHeaders(res),
        "cache-control": "public, max-age=3600"
      });
      res.end(data);
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        errorCode: error.errorCode || "recommended_article_cover_unavailable",
        message: error instanceof Error ? error.message : "推荐文章封面暂时不可用。"
      });
    }
    return;
  }

  const recommendedArticleDetailMatch = req.url?.match(/^\/api\/v2\/recommended-articles\/([^/]+)$/);
  if (recommendedArticleDetailMatch && req.method === "GET") {
    try {
      const result = await getRecommendedArticleDetail({
        articleId: decodeURIComponent(recommendedArticleDetailMatch[1])
      });
      sendJson(res, 200, {
        article: serializeRecommendedArticleForClient(result.article, { baseUrl: requestBaseUrl(req) }),
        chapter: serializeChapterForClient(result.chapter)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        errorCode: error.errorCode || "recommended_article_detail_unavailable",
        message: error instanceof Error ? error.message : "推荐文章详情暂时不可用。"
      });
    }
    return;
  }

  const recommendedArticleImportMatch = req.url?.match(/^\/api\/v2\/recommended-articles\/([^/]+)\/import$/);
  if (recommendedArticleImportMatch && req.method === "POST") {
    try {
      const result = await importRecommendedArticleChapter({
        articleId: decodeURIComponent(recommendedArticleImportMatch[1]),
        deviceId,
        services: {
          upsertChapter: upsertStoredChapter
        }
      });
      sendJson(res, 201, {
        article: serializeRecommendedArticleForClient(result.article, { baseUrl: requestBaseUrl(req) }),
        chapter: serializeChapterForClient(result.chapter)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        errorCode: error.errorCode || "recommended_article_import_failed",
        message: error instanceof Error ? error.message : "推荐文章导入失败。"
      });
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/chapters") {
    const chapters = await listStoredChapters(deviceId);
    sendJson(res, 200, { chapters: sortByCreatedAtDesc(serializeChaptersForClient(chapters)) });
    return;
  }

  if (req.method === "GET" && req.url === "/api/favorites/questions") {
    const favorites = await listStoredFavoriteQuestions(deviceId);
    sendJson(res, 200, { favorites: serializeFavoriteQuestionsForClient(favorites) });
    return;
  }

  if (req.method === "POST" && req.url === "/api/favorites/questions") {
    const body = await readBody(req);
  const chapterId = toStringValue(body.chapterId || body.chapter_id || "");
  const questionId = toStringValue(body.questionId || body.question_id || "");
  const chapter = chapterId ? await getStoredChapter(deviceId, chapterId) : null;
  const questionExists = chapterHasQuestion(chapter, questionId);
  if (!chapter || !questionExists) {
    sendJson(res, 404, { errorCode: "favorite_question_not_found", message: "收藏的题目不存在。" });
    return;
    }
    const favorite = await upsertStoredFavoriteQuestion(deviceId, {
      id: createFavoriteQuestionId(chapterId, questionId),
      chapterId,
      questionId,
      createdAt: body.createdAt || body.created_at || new Date().toISOString()
    });
    sendJson(res, 200, { favorite: serializeFavoriteQuestionForClient(favorite) });
    return;
  }

  const favoriteQuestionMatch = req.url?.match(/^\/api\/favorites\/questions\/([^/]+)$/);
  if (favoriteQuestionMatch && req.method === "DELETE") {
    const favoriteId = decodeURIComponent(favoriteQuestionMatch[1]);
    const deleted = await deleteStoredFavoriteQuestion(deviceId, favoriteId);
    if (!deleted) sendJson(res, 404, { errorCode: "favorite_not_found", message: "收藏记录不存在。" });
    else sendJson(res, 200, { deleted: true, favoriteId });
    return;
  }

  if (req.method === "DELETE" && req.url === "/api/device-data") {
    const deleted = await deleteStoredDeviceData(deviceId);
    if (!hasDatabase) {
      deleted.captureMemoryCards = await captureMemoryRepository.clearDevice(deviceId);
    }
    sendJson(res, 200, { ok: true, deleted });
    return;
  }

  if (req.method === "POST" && req.url === "/api/devices/push-token") {
    const body = await readBody(req);
    const pushToken = await upsertStoredPushToken(deviceId, body);
    if (!pushToken) {
      sendJson(res, 422, { errorCode: "invalid_push_token", message: "推送 token 无效。" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      pushToken: {
        platform: pushToken.platform,
        environment: pushToken.environment,
        preferredLanguage: pushToken.preferredLanguage
      },
      apnsConfigured: isAPNSConfigured(),
      apns: apnsConfigurationSummary()
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/devices/push-status") {
    const [tokens, notifications] = await Promise.all([
      listStoredPushTokens(deviceId),
      listStoredNotifications(deviceId)
    ]);
    sendJson(res, 200, {
      ok: true,
      apns: apnsConfigurationSummary(),
      pushTokenCount: tokens.length,
      pushTokens: tokens.map(serializePushTokenForDiagnostics),
      recentNotifications: sortByCreatedAtDesc(notifications)
        .slice(0, 10)
        .map(serializeNotificationPushDiagnostics)
    });
    return;
  }

  if (req.url === "/api/v2/awakening-session" && (req.method === "GET" || req.method === "POST")) {
    const chapters = await listStoredChapters(deviceId);
    const activeChapter = activeAwakeningChapter(chapters);
    if (activeChapter) {
      sendJson(
        res,
        200,
        serializeStoredAwakeningResponse(
          deviceId,
          chapters,
          activeChapter,
          activeChapter.v2AwakeningSession
        )
      );
      return;
    }

    if (req.method === "GET") {
      sendJson(
        res,
        200,
        serializeStoredAwakeningResponse(deviceId, chapters, null, null)
      );
      return;
    }

    try {
      const created = createAwakeningSessionV2(chapters, {
        deviceId,
        excludeQuestionId: latestCompletedAwakeningQuestionId(chapters)
      });
      if (!created.session || !created.chapter) {
        sendJson(
          res,
          200,
          serializeStoredAwakeningResponse(deviceId, chapters, null, null)
        );
        return;
      }

      created.chapter.v2AwakeningSession = created.session;
      created.chapter.updatedAt = new Date().toISOString();
      await upsertStoredChapter(deviceId, created.chapter);
      sendJson(
        res,
        200,
        serializeStoredAwakeningResponse(
          deviceId,
          chapters,
          created.chapter,
          created.session
        )
      );
    } catch (error) {
      sendJson(res, error.statusCode || 422, {
        errorCode: error.code || "v2_awakening_session_unavailable",
        message: error.message || "暂时无法唤醒这段记忆。"
      });
    }
    return;
  }

  const awakeningActionMatch = req.url?.match(/^\/api\/v2\/awakening-sessions\/([^/]+)\/(answer|complete)$/);
  if (awakeningActionMatch && req.method === "POST") {
    const sessionId = decodeURIComponent(awakeningActionMatch[1]);
    const action = awakeningActionMatch[2];
    const chapters = await listStoredChapters(deviceId);
    const chapter = chapters.find((item) => item.v2AwakeningSession?.id === sessionId);
    if (!chapter) {
      sendJson(res, 404, {
        errorCode: "v2_awakening_session_not_found",
        message: "这张记忆卡已经不存在。"
      });
      return;
    }

    try {
      if (action === "answer") {
        const body = await readBody(req);
        const result = answerAwakeningSessionV2(chapter, chapter.v2AwakeningSession, body);
        chapter.v2AwakeningSession = result.session;
        if (result.reviewSession) {
          chapter.v2ReviewSession = result.reviewSession;
        }
      } else {
        chapter.v2AwakeningSession = completeAwakeningSessionV2(chapter.v2AwakeningSession);
      }
      chapter.updatedAt = new Date().toISOString();
      await upsertStoredChapter(deviceId, chapter);
      sendJson(
        res,
        200,
        serializeStoredAwakeningResponse(
          deviceId,
          chapters,
          chapter,
          chapter.v2AwakeningSession
        )
      );
    } catch (error) {
      sendJson(res, error.statusCode || 422, {
        errorCode: error.code || "v2_awakening_session_update_failed",
        message: error.message || "这张记忆卡的状态保存失败。"
      });
    }
    return;
  }

  const chapterMatch = req.url?.match(/^\/api\/chapters\/([^/]+)$/);
  if (chapterMatch && req.method === "GET") {
    const chapter = await getStoredChapter(deviceId, decodeURIComponent(chapterMatch[1]));
    if (!chapter) sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
    else sendJson(res, 200, { chapter: serializeChapterForClient(chapter) });
    return;
  }

  if (chapterMatch && req.method === "DELETE") {
    const chapterId = decodeURIComponent(chapterMatch[1]);
    const deleted = await deleteStoredChapter(deviceId, chapterId);
    if (!deleted) sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
    else sendJson(res, 200, { deleted: true, chapterId });
    return;
  }

  const regenerateMatch = req.url?.match(/^\/api\/chapters\/([^/]+)\/regenerate$/);
  if (regenerateMatch && req.method === "POST") {
    await handleRegenerateChapter(req, res, decodeURIComponent(regenerateMatch[1]));
    return;
  }

  const v2ReviewSessionMatch = req.url?.match(/^\/api\/v2\/chapters\/([^/]+)\/review-session$/);
  if (v2ReviewSessionMatch && (req.method === "GET" || req.method === "POST")) {
    const chapter = await getStoredChapter(deviceId, decodeURIComponent(v2ReviewSessionMatch[1]));
    if (!chapter) {
      sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
      return;
    }
    if (!isV2ReviewableChapter(chapter)) {
      sendJson(res, 422, { errorCode: "chapter_not_reviewable", message: "这个章节暂时不能开始 V2 复习。", chapter: serializeChapterForClient(chapter) });
      return;
    }
    try {
      const reviewSession = req.method === "POST"
        ? startOrResumeV2ReviewSession(chapter)
        : chapter.v2ReviewSession ? normalizeReviewSessionV2(chapter, chapter.v2ReviewSession) : null;
      if (reviewSession) chapter.v2ReviewSession = reviewSession;
      await upsertStoredChapter(deviceId, chapter);
      sendJson(res, 200, serializeV2ReviewSessionResponse(chapter, reviewSession));
    } catch (error) {
      sendJson(res, error.statusCode || 422, { errorCode: "v2_review_session_unavailable", message: error.message || "V2 复习会话不可用。" });
    }
    return;
  }

  const v2ReviewReplayMatch = req.url?.match(/^\/api\/v2\/chapters\/([^/]+)\/review-session\/replay-from-unit$/);
  if (v2ReviewReplayMatch && req.method === "POST") {
    const chapter = await getStoredChapter(deviceId, decodeURIComponent(v2ReviewReplayMatch[1]));
    if (!chapter) {
      sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
      return;
    }
    if (!isV2ReviewableChapter(chapter)) {
      sendJson(res, 422, { errorCode: "chapter_not_reviewable", message: "这个章节暂时不能开始 V2 复习。", chapter: serializeChapterForClient(chapter) });
      return;
    }
    try {
      const body = await readBody(req);
      const currentSession = chapter.v2ReviewSession
        ? normalizeReviewSessionV2(chapter, chapter.v2ReviewSession)
        : createReviewSessionV2(chapter);
      rememberV2ReviewCompletion(chapter, currentSession);
      const reviewSession = startReplayFromUnitV2(chapter, currentSession, {
        unitId: body?.unitId
      });
      chapter.v2ReviewSession = reviewSession;
      chapter.updatedAt = new Date().toISOString();
      await upsertStoredChapter(deviceId, chapter);
      sendJson(res, 200, serializeV2ReviewSessionResponse(chapter, reviewSession));
    } catch (error) {
      sendJson(res, error.statusCode || 422, { errorCode: "v2_review_replay_unavailable", message: error.message || "无法从这个单元重新复习。" });
    }
    return;
  }

  const v2ReviewSessionActionMatch = req.url?.match(/^\/api\/v2\/review-sessions\/([^/]+)\/(advance|answer|focus-unit|feedback-visibility|source-open|source-return)$/);
  if (v2ReviewSessionActionMatch && req.method === "POST") {
    const sessionId = decodeURIComponent(v2ReviewSessionActionMatch[1]);
    const action = v2ReviewSessionActionMatch[2];
    const chapters = await listStoredChapters(deviceId);
    const chapter = chapters.find((item) => item.v2ReviewSession?.id === sessionId);
    if (!chapter) {
      sendJson(res, 404, { errorCode: "v2_review_session_not_found", message: "V2 复习会话不存在。" });
      return;
    }
    try {
      const body = await readBody(req);
      const reviewSession = applyV2ReviewSessionMutation(chapter, (session) => {
        switch (action) {
        case "advance":
          return advanceReviewCardV2(chapter, session);
        case "answer":
          return answerQuestionV2(chapter, session, body);
        case "focus-unit":
          return focusReviewUnitV2(chapter, session, body);
        case "feedback-visibility":
          return setQuestionFeedbackVisibleV2(chapter, session, body);
        case "source-open":
          return openSourceFromReviewV2(chapter, session, body);
        case "source-return":
          return returnFromSourceToReviewV2(chapter, session);
        default:
          return session;
        }
      });
      await upsertStoredChapter(deviceId, chapter);
      sendJson(res, 200, serializeV2ReviewSessionResponse(chapter, reviewSession));
    } catch (error) {
      sendJson(res, error.statusCode || 422, { errorCode: "v2_review_session_update_failed", message: error.message || "V2 复习状态保存失败。" });
    }
    return;
  }

  const reviewSessionMatch = req.url?.match(/^\/api\/chapters\/([^/]+)\/review-session$/);
  if (reviewSessionMatch && (req.method === "GET" || req.method === "POST")) {
    const chapter = await getStoredChapter(deviceId, decodeURIComponent(reviewSessionMatch[1]));
    if (!chapter) {
      sendJson(res, 404, { errorCode: "chapter_not_found", message: "章节不存在。" });
      return;
    }
    if (String(chapter.status || "") !== "completed") {
      sendJson(res, 422, { errorCode: "chapter_not_reviewable", message: "这个章节暂时不能开始复习。", chapter: serializeChapterForClient(chapter) });
      return;
    }
    const reviewSession = req.method === "POST"
      ? startOrResumeReviewSession(chapter)
      : chapter.reviewSession ? normalizeReviewSession(chapter.reviewSession, chapter) : null;
    if (reviewSession) chapter.reviewSession = reviewSession;
    await upsertStoredChapter(deviceId, chapter);
    const responseChapter = serializeChapterForClient(chapter);
    sendJson(res, 200, {
      chapter: responseChapter,
      reviewSession,
      currentQuestion: reviewSession && reviewSession.status !== "completed" ? currentQuestionForSession(responseChapter, reviewSession) : null
    });
    return;
  }

  const attemptMatch = req.url?.match(/^\/api\/review-sessions\/([^/]+)\/attempts$/);
  if (attemptMatch && req.method === "POST") {
    const sessionId = decodeURIComponent(attemptMatch[1]);
    const chapters = await listStoredChapters(deviceId);
    const chapter = chapters.find((item) => item.reviewSession?.id === sessionId);
    if (!chapter) {
      sendJson(res, 404, { errorCode: "review_session_not_found", message: "复习会话不存在。" });
      return;
    }
    try {
      const body = await readBody(req);
      const result = recordSessionAttempt(chapter, body);
      await upsertStoredChapter(deviceId, chapter);
      const responseChapter = serializeChapterForClient(chapter);
      sendJson(res, 200, {
        chapter: responseChapter,
        reviewSession: result.session,
        attempt: result.attempt,
        currentQuestion: result.session.status === "completed" ? null : currentQuestionForSession(responseChapter, result.session)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 422, { errorCode: "attempt_not_recorded", message: error.message || "答题记录保存失败。" });
    }
    return;
  }

  const feedbackMatch = req.url?.match(/^\/api\/questions\/([^/]+)\/feedback$/);
  if (feedbackMatch && req.method === "POST") {
    const body = await readBody(req);
    const result = await handleQuestionFeedback(deviceId, decodeURIComponent(feedbackMatch[1]), body);
    if (!result) {
      sendJson(res, 404, { errorCode: "question_not_found", message: "题目不存在。" });
      return;
    }
    const responseChapter = serializeChapterForClient(result.chapter);
    sendJson(res, 200, {
      ...result,
      chapter: responseChapter,
      reviewSession: responseChapter.reviewSession
    });
    return;
  }

  if (req.method === "GET" && req.url === "/api/notifications") {
    const notifications = await listStoredNotifications(deviceId);
    sendJson(res, 200, { notifications: sortByCreatedAtDesc(serializeNotificationsForClient(notifications)) });
    return;
  }

  const notificationActionMatch = req.url?.match(/^\/api\/notifications\/([^/]+)\/(read|dismiss)$/);
  if (notificationActionMatch && req.method === "POST") {
    const notification = await getStoredNotification(deviceId, decodeURIComponent(notificationActionMatch[1]));
    if (!notification) {
      sendJson(res, 404, { errorCode: "notification_not_found", message: "通知不存在。" });
      return;
    }
    if (notificationActionMatch[2] === "read") notification.read = true;
    if (notificationActionMatch[2] === "dismiss") {
      notification.read = true;
      notification.dismissed = true;
    }
    const saved = await upsertStoredNotification(deviceId, notification);
    sendJson(res, 200, { notification: serializeNotificationForClient(saved) });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { errorCode: "method_not_allowed", message: "不支持的请求方法。" });
  } catch (error) {
    handleRequestError(res, error);
  }
});

function handleRequestError(res, error) {
  if (res.writableEnded) return;
  if (error instanceof GenerationQuotaError) {
    sendJson(res, error.statusCode, {
      errorCode: error.errorCode,
      message: error.message,
      quota: error.quota || null
    });
    return;
  }
  if (error instanceof RequestGuardError) {
    sendJson(res, error.statusCode, {
      errorCode: error.errorCode,
      message: error.message
    });
    return;
  }
  console.error("Unhandled request error", error);
  sendJson(res, 500, {
    errorCode: "internal_server_error",
    message: "服务暂时不可用，请稍后再试。"
  });
}

function startServer() {
  const initialization = databaseInitializedByParent
    ? Promise.resolve({ storage: hasDatabase ? "postgres" : "memory" })
    : initDatabase();

  return initialization
    .then((result) => {
      server.listen(port, host, () => {
        console.log(`Recallo Demo 已启动：http://${host}:${port} (${result.storage})`);
      });
    })
    .catch((error) => {
      console.error("数据库初始化失败", error);
      process.exit(1);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

export {
  buildCostRunResponse,
  captureMemoryCardPayload,
  costWorkbenchEnabled,
  createReviewSessionForChapter,
  persistCaptureMemoryResult,
  recordSessionAttempt,
  saveCostRunResponse,
  server,
  serializeChapterForClient,
  startOrResumeReviewSession,
  startOrResumeV2ReviewSession
};
