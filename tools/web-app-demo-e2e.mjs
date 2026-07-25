#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendRoot = resolve(repoRoot, "backend");
const requireFromBackend = createRequire(resolve(backendRoot, "package.json"));
const { chromium } = requireFromBackend("playwright");
const port = Number(process.env.RECALLO_WEB_E2E_PORT || 18764);
const externalBaseURL = process.env.RECALLO_WEB_E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const realMode = process.env.RECALLO_WEB_E2E_REAL === "1";
const screenshotPath = process.env.RECALLO_WEB_E2E_SCREENSHOT || `/tmp/recallo-web-app-demo-e2e-${realMode ? "real" : "mock"}.png`;
let serverProcess = null;
let serverOutput = "";

const firstSchedule = {
  nextReviewAt: "2020-01-01T00:00:00.000Z",
  intervalDays: 0,
  state: "scheduled",
  status: "scheduled"
};
const nextSchedule = {
  nextReviewAt: "2099-07-28T11:00:00.000Z",
  intervalDays: 3,
  state: "scheduled",
  status: "scheduled"
};
const memoryCard = {
  id: "e2e-memory-card-1",
  captureId: "e2e-capture-1",
  version: 2,
  state: "formal",
  coreKnowledge: "主动回忆能强化长期记忆的提取路径。",
  recallCue: "什么行为能强化长期记忆的提取路径？",
  hiddenSemantic: "主动回忆",
  explanation: "答案直接来自截图证据区域。",
  sourceEvidenceIds: ["evidence-1"],
  rarity: "SR",
  rarityReason: "SR · 可迁移到不同学习场景的方法。",
  rarityConfidence: 0.92,
  rarityRuleVersion: "recallo_rarity_v1",
  recallVariants: [],
  sourceTitle: "E2E B站截图",
  sourceUrl: "https://www.bilibili.com/video/BV1E2E",
  sourceStatus: "verified"
};

async function main() {
  if (!externalBaseURL) {
    serverProcess = spawn(process.execPath, ["src/server.js"], {
      cwd: backendRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        GENERATION_WORKER_DISABLED: "1",
        DATABASE_URL: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stdout.on("data", chunk => { serverOutput += chunk; });
    serverProcess.stderr.on("data", chunk => { serverOutput += chunk; });
    await waitForServer(`${baseURL}/app-demo`, serverProcess);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
  });
  try {
    const api = makeAPIFixture();
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      reducedMotion: "no-preference"
    });
    if (!realMode) await installAPIRoutes(context, api);
    const page = await context.newPage();
    observeAPI(page, api, realMode);
    await page.addInitScript(() => { window.__RECALLO_E2E__ = true; });
    const consoleErrors = [];
    const requestFailures = [];
    const responseFailures = [];
    page.on("console", message => {
      if (message.type() === "error") {
        const location = message.location();
        consoleErrors.push(`${message.text()}${location.url ? ` @ ${location.url}` : ""}`);
      }
    });
    page.on("requestfailed", request => {
      requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`);
    });
    page.on("response", response => {
      if (response.status() >= 400) responseFailures.push(`${response.request().method()} ${response.url()} ${response.status()}`);
    });

    await page.goto(`${baseURL}/app-demo`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="v06-home"]').waitFor();
    assert.equal(await page.locator("script#recallo-v06-runtime").count(), 1, "the page must expose exactly one current runtime");
    assert.equal(await page.locator('[data-testid="recall-stack"]').isDisabled(), true, "empty library must not summon fixture content");

    await page.getByRole("button", { name: "添加第一张截图" }).click();
    const fixture = realMode ? loadRealFixture() : {
      name: "bilibili-e2e.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nC8AAAAASUVORK5CYII=", "base64")
    };
    await page.locator('[data-testid="capture-file"]').setInputFiles(fixture);
    await page.locator('[data-testid="submit-capture"]').click();
    await page.locator('[data-testid="v06-upload-complete"]').waitFor({ timeout: Number(process.env.RECALLO_WEB_E2E_TIMEOUT || (realMode ? 180_000 : 8_000)) });
    assert.equal(api.capturePosts, 1, "upload must submit exactly one capture job");
    assert.equal(api.capturePolls >= 1, true, "the UI must poll the async job until success");
    assert.equal(api.lastCaptureBody.async, true, "capture request must use explicit async mode");
    assert.match(api.lastCaptureBody.imageBase64, /^data:image\/png;base64,/, "the selected user file must be sent as image data");
    assert.equal(api.lastCaptureBody.mimeType, "image/png");

    await page.getByRole("button", { name: "立即召回这张" }).click();
    await page.locator('[data-testid="v06-summoning"]').waitFor();
    await page.getByRole("button", { name: "跳过" }).click();
    await page.locator('[data-testid="v06-recall"]').waitFor();

    const scratch = page.locator("canvas.scratch");
    const box = await scratch.boundingBox();
    assert.ok(box, "scratch canvas must be visible");
    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + 74, box.y + 24, { steps: 4 });
    await page.mouse.up();
    const partialCoverage = await page.evaluate(() => window.__recalloV06.getState().coverage);
    assert.ok(partialCoverage > 0 && partialCoverage < 0.45, `partial scratch must remain below reveal threshold, got ${partialCoverage}`);

    await page.reload({ waitUntil: "networkidle" });
    const paused = page.locator('[data-testid="v06-paused"]');
    if (await paused.count()) {
      await page.getByRole("button", { name: "继续回忆" }).click();
    }
    await page.locator('[data-testid="v06-recall"]').waitFor();
    const restoredCoverage = await page.evaluate(() => window.__recalloV06.getState().coverage);
    assert.equal(restoredCoverage, partialCoverage, "reload must restore the same scratch coverage");

    await page.locator("canvas.scratch").press("Enter");
    await page.getByRole("button", { name: "记得" }).click();
    await page.locator('[data-testid="v06-checkpoint"]').waitFor({ timeout: 5_000 });
    assert.equal(api.assessmentPosts, 1, "assessment must be persisted through the API");
    assert.equal(api.lastAssessmentBody.assessment, "remembered");
    assert.match(api.lastAssessmentBody.attemptId, /^web-capture-assessment-/);
    const observedNextReviewAt = await page.locator('[data-testid="next-review"]').getAttribute("data-next-review-at");
    assert.ok(observedNextReviewAt && Number.isFinite(Date.parse(observedNextReviewAt)), "checkpoint must expose a valid server nextReviewAt");
    assert.ok(Date.parse(observedNextReviewAt) > Date.now(), "remembered assessment must advance the next review into the future");
    if (!realMode) assert.equal(observedNextReviewAt, nextSchedule.nextReviewAt, "mock checkpoint must use its server schedule exactly");
    assert.equal(await page.locator('[data-testid="continue-recall"]').innerText(), "今天已完成", "a future-scheduled card must not be selected again immediately");

    await page.locator('[data-testid="continue-recall"]').click();
    await page.locator('[data-testid="v06-home"]').waitFor({ timeout: 3_000 });
    assert.equal(await page.locator('[data-testid="recall-stack"]').isDisabled(), true, "home recall entry must only use due cards");
    assert.equal(api.assessmentPosts, 1, "the same future card must not be assessed twice");
    await page.getByRole("button", { name: "知识库" }).click();
    await page.locator('[data-testid="v06-library"]').waitFor();
    assert.equal(await page.locator('[data-testid="library-card"]').count(), 1);
    await page.locator("[data-delete]").click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await page.locator('[data-testid="library-empty"]').waitFor();
    assert.equal(api.deleteRequests, 1, "delete must call the card API before removing UI state");
    if (!realMode) assert.equal(api.cards.length, 0);

    let failureStayedVisible = null;
    if (!realMode) {
      api.failNextCapture = true;
      await page.getByRole("button", { name: "添加第一张截图" }).click();
      await page.locator('[data-testid="capture-file"]').setInputFiles(fixture);
      await page.locator('[data-testid="submit-capture"]').click();
      await page.locator('[data-testid="upload-error"]').waitFor();
      assert.match(await page.locator('[data-testid="upload-error"]').innerText(), /E2E 明确失败/);
      assert.equal(await page.locator('[data-testid="v06-upload-complete"]').count(), 0, "failed API must never become fixture success");
      failureStayedVisible = true;
    }

    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);
    assert.ok(overflow <= 0, `375px viewport must not overflow, got ${overflow}px`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const expectedFailureStatus = failureStayedVisible ? 422 : null;
    const unexpectedResponses = responseFailures.filter(message => !expectedFailureStatus || !message.endsWith(` ${expectedFailureStatus}`));
    assert.deepEqual(unexpectedResponses, [], `HTTP errors: ${unexpectedResponses.join(" | ")}`);
    const unexpectedConsoleErrors = consoleErrors.filter(message => {
      if (message.endsWith(`@ ${baseURL}/favicon.ico`)) return false;
      return !(expectedFailureStatus && message.includes(`status of ${expectedFailureStatus}`));
    });
    assert.deepEqual(unexpectedConsoleErrors, [], `console errors: ${unexpectedConsoleErrors.join(" | ")}`);
    const unexpectedRequestFailures = requestFailures.filter(message => !(/app-demo-assets\//.test(message) && /net::ERR_ABORTED/.test(message)));
    assert.deepEqual(unexpectedRequestFailures, [], `request failures: ${unexpectedRequestFailures.join(" | ")}`);
    await context.close();

    let reducedDuration = null;
    if (!realMode) {
      api.cards = [recordFor(memoryCard, firstSchedule, null)];
      const reducedContext = await browser.newContext({
        viewport: { width: 375, height: 812 },
        reducedMotion: "reduce"
      });
      await installAPIRoutes(reducedContext, api);
      const reducedPage = await reducedContext.newPage();
      await reducedPage.addInitScript(() => { window.__RECALLO_E2E__ = true; });
      await reducedPage.goto(`${baseURL}/app-demo`, { waitUntil: "networkidle" });
      const startedAt = Date.now();
      await reducedPage.getByRole("button", { name: "让毛球取回一张" }).click();
      await reducedPage.locator('[data-testid="v06-recall"]').waitFor({ timeout: 1_000 });
      reducedDuration = Date.now() - startedAt;
      assert.ok(reducedDuration < 800, `Reduce Motion summon must finish quickly, got ${reducedDuration}ms`);
      assert.equal(await reducedPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
      await reducedContext.close();
    }

    console.log("# Recallo Web App Demo E2E");
    console.log(JSON.stringify({
      baseURL,
      mode: realMode ? "real-backend-fixture" : "mock-route",
      viewport: "375x812",
      upload: { posts: api.capturePosts, polls: api.capturePolls, usedSelectedFile: true },
      recall: { partialCoverage, restoredCoverage, assessmentPosts: api.assessmentPosts },
      schedule: observedNextReviewAt,
      deleteRequests: api.deleteRequests,
      failureStayedVisible,
      reducedMotionMs: reducedDuration,
      screenshotPath
    }, null, 2));
  } finally {
    await browser.close();
  }
}

function makeAPIFixture() {
  return {
    cards: [],
    capturePosts: 0,
    capturePolls: 0,
    assessmentPosts: 0,
    deleteRequests: 0,
    lastCaptureBody: null,
    lastAssessmentBody: null,
    failNextCapture: false
  };
}

function observeAPI(page, api, enabled) {
  if (!enabled) return;
  page.on("request", request => {
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method === "POST" && pathname === "/api/sources/image-flow") {
      api.capturePosts += 1;
      api.lastCaptureBody = request.postDataJSON();
    } else if (method === "GET" && pathname.startsWith("/api/sources/image-flow/jobs/")) {
      api.capturePolls += 1;
    } else if (method === "POST" && /\/api\/memory-cards\/[^/]+\/assessments$/.test(pathname)) {
      api.assessmentPosts += 1;
      api.lastAssessmentBody = request.postDataJSON();
    } else if (method === "DELETE" && /\/api\/memory-cards\/[^/]+$/.test(pathname)) {
      api.deleteRequests += 1;
    }
  });
}

function loadRealFixture() {
  const manifestPath = process.env.RECALLO_WEB_E2E_MANIFEST
    || join(backendRoot, "test-fixtures", "capture-gallery", "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`real E2E fixture manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entries = Array.isArray(manifest)
    ? manifest
    : manifest.fixtures || manifest.samples || manifest.items || manifest.images || [];
  const requested = process.env.RECALLO_WEB_E2E_FIXTURE;
  const selected = requested
    ? entries.find(entry => entry.id === requested || entry.file === requested)
    : entries.find(entry => ["bilibili", "douyin"].includes(entry.expectedPlatform)) || entries[0];
  if (!selected) throw new Error(`real E2E manifest has no usable fixture: ${manifestPath}`);
  const relativeFile = typeof selected === "string"
    ? selected
    : selected.file || selected.path || selected.image || selected.imagePath || selected.fixture;
  const fixturePath = resolve(dirname(manifestPath), relativeFile);
  if (!existsSync(fixturePath)) throw new Error(`real E2E fixture not found: ${fixturePath}`);
  const extension = extname(fixturePath).toLowerCase();
  const mimeType = selected.mimeType
    || ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[extension]
    || "image/png";
  return { name: basename(fixturePath), mimeType, buffer: readFileSync(fixturePath) };
}

async function installAPIRoutes(context, api) {
  await context.route("**/api/memory-cards", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      return fulfillJSON(route, 200, { cards: api.cards });
    }
    return route.continue();
  });
  await context.route("**/api/sources/image-flow", async route => {
    api.capturePosts += 1;
    api.lastCaptureBody = route.request().postDataJSON();
    if (api.failNextCapture) {
      api.failNextCapture = false;
      return fulfillJSON(route, 422, { errorCode: "e2e_capture_failed", message: "E2E 明确失败" });
    }
    api.capturePolls = 0;
    return fulfillJSON(route, 202, { jobId: "11111111-1111-4111-8111-111111111111", status: "queued" });
  });
  await context.route("**/api/sources/image-flow/jobs/**", async route => {
    api.capturePolls += 1;
    if (api.capturePolls === 1) {
      return fulfillJSON(route, 200, { status: "running", progress: { stage: "vision", message: "正在识别截图" } });
    }
    api.cards = [recordFor(memoryCard, firstSchedule, null)];
    return fulfillJSON(route, 200, {
      status: "succeeded",
      progress: { stage: "review", message: "记忆卡已生成" },
      result: {
        status: "completed",
        schemaVersion: "capture_memory_card_v2",
        disposition: "create_card",
        memoryCard,
        schedule: firstSchedule,
        captureAnalysis: {
          schemaVersion: "capture_memory_card_v2",
          disposition: "create_card",
          sourceStatus: "verified",
          memoryCard,
          schedule: firstSchedule
        }
      }
    });
  });
  await context.route("**/api/memory-cards/*/assessments", async route => {
    api.assessmentPosts += 1;
    api.lastAssessmentBody = route.request().postDataJSON();
    api.cards = [recordFor(memoryCard, nextSchedule, "remembered")];
    return fulfillJSON(route, 200, {
      assessment: { assessment: "remembered", attemptId: api.lastAssessmentBody.attemptId },
      schedule: nextSchedule,
      mastery: { before: "sealed", after: "awakened", successfulRecallCount: 1, reviewCount: 1 }
    });
  });
  await context.route("**/api/memory-cards/*", async route => {
    if (route.request().method() !== "DELETE") return route.continue();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1));
    api.deleteRequests += 1;
    api.cards = api.cards.filter(record => record.memoryCard.id !== id);
    return fulfillJSON(route, 200, { deleted: true, cardId: id });
  });
}

function recordFor(card, schedule, lastAssessment) {
  return {
    memoryCard: card,
    disposition: "create_card",
    schedule,
    masteryStage: lastAssessment ? "awakened" : "sealed",
    successfulRecallCount: lastAssessment ? 1 : 0,
    reviewCount: lastAssessment ? 1 : 0,
    lastAssessment,
    capturedAt: "2026-07-25T10:00:00.000Z"
  };
}

function fulfillJSON(route, status, body) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`backend exited before E2E:\n${serverOutput}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`backend did not become ready at ${url}:\n${serverOutput}`);
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => serverProcess.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000))
  ]);
  if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
}

main()
  .catch(error => {
    console.error(error);
    if (serverOutput) console.error(serverOutput);
    process.exitCode = 1;
  })
  .finally(stopServer);
