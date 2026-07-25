import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open as openFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMediaExtractionError } from "./mediaErrors.js";
import { VIDEO_DEFAULTS } from "./videoDefaults.js";

const DEFAULT_MAX_BYTES = readPositiveInt(process.env.VIDEO_MEDIA_MAX_BYTES, VIDEO_DEFAULTS.mediaMaxBytes);
const DEFAULT_TIMEOUT_MS = readPositiveInt(process.env.VIDEO_MEDIA_FETCH_TIMEOUT_MS, VIDEO_DEFAULTS.mediaFetchTimeoutMs);

export async function downloadMediaToTempFile({
  mediaUrl,
  fetchImpl = fetch,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestHeaders = {}
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let dir = null;
  try {
    if (Object.keys(requestHeaders || {}).length > 0) {
      const rangedFile = await tryDownloadMediaByRanges({
        mediaUrl,
        fetchImpl,
        requestHeaders,
        signal: controller.signal,
        maxBytes
      });
      if (rangedFile) return rangedFile;
    }
    const response = await fetchImpl(mediaUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: requestHeaders
    });
    if (!response.ok) {
      throw createMediaExtractionError("video_media_unavailable", "视频内容暂时无法读取，请稍后重试。", {
        retryable: response.status >= 500,
        status: response.status
      });
    }
    const contentType = response.headers?.get?.("content-type") || response.headers?.get?.("Content-Type") || "";
    const contentLength = readContentLength(response.headers);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw createMediaExtractionError("video_media_too_large", "视频文件过大，暂时无法生成复习内容。", {
        retryable: false
      });
    }
    dir = join(tmpdir(), `shibei-video-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "source-video");
    const bytes = await writeResponseBodyToFile(response, path, { maxBytes });
    return { path, dir, bytes, contentType, sourceUrl: mediaUrl };
  } catch (error) {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    if (error?.name === "AbortError") {
      throw createMediaExtractionError("video_media_timeout", "读取视频内容超时，请稍后重试。", {
        retryable: true
      });
    }
    if (error?.code === "failed_extract_video") throw error;
    throw createMediaExtractionError("video_media_unavailable", "视频内容暂时无法读取，请稍后重试。", {
      retryable: true,
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryDownloadMediaByRanges({ mediaUrl, fetchImpl, requestHeaders, signal, maxBytes }) {
  const probe = await fetchImpl(mediaUrl, {
    signal,
    redirect: "follow",
    headers: { ...requestHeaders, range: "bytes=0-0" }
  }).catch(() => null);
  if (!probe || probe.status !== 206) {
    await probe?.body?.cancel?.().catch(() => {});
    return null;
  }
  const totalBytes = readContentRangeTotal(probe.headers);
  const contentType = probe.headers?.get?.("content-type") || "";
  await probe.body?.cancel?.().catch(() => {});
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  if (totalBytes > maxBytes) {
    throw createMediaExtractionError("video_media_too_large", "视频文件过大，暂时无法生成复习内容。", { retryable: false });
  }

  const dir = join(tmpdir(), `shibei-video-${randomUUID()}`);
  const path = join(dir, "source-video");
  const chunkBytes = readPositiveInt(process.env.VIDEO_MEDIA_RANGE_CHUNK_BYTES, 1024 * 1024);
  const concurrency = readPositiveInt(process.env.VIDEO_MEDIA_RANGE_CONCURRENCY, 4);
  await mkdir(dir, { recursive: true });
  const handle = await openFile(path, "w");
  try {
    await handle.truncate(totalBytes);
    const ranges = [];
    for (let start = 0; start < totalBytes; start += chunkBytes) {
      ranges.push({ start, end: Math.min(totalBytes - 1, start + chunkBytes - 1) });
    }
    await mapWithConcurrency(ranges, concurrency, async ({ start, end }, index) => {
      const buffer = await fetchRangeWithRetry({
        mediaUrl,
        fetchImpl,
        requestHeaders,
        signal,
        start,
        end,
        jitterMs: index * 13
      });
      await handle.write(buffer, 0, buffer.byteLength, start);
    });
    return { path, dir, bytes: totalBytes, contentType, sourceUrl: mediaUrl };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function fetchRangeWithRetry({ mediaUrl, fetchImpl, requestHeaders, signal, start, end, jitterMs }) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetchImpl(mediaUrl, {
        signal,
        redirect: "follow",
        headers: { ...requestHeaders, range: `bytes=${start}-${end}` }
      });
      if (response.status !== 206) throw new Error(`range request failed: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength !== end - start + 1) throw new Error("range response size mismatch");
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt >= 5 || signal.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt + jitterMs));
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await operation(items[index], index);
    }
  });
  await Promise.all(workers);
}

export async function cleanupMediaTempFiles(...files) {
  const dirs = files.flat().map((file) => file?.dir).filter(Boolean);
  await Promise.all([...new Set(dirs)].map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
}

async function writeResponseBodyToFile(response, path, { maxBytes }) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw createMediaExtractionError("video_media_too_large", "视频文件过大，暂时无法生成复习内容。", {
        retryable: false
      });
    }
    await writeFile(path, buffer);
    return buffer.byteLength;
  }

  const reader = response.body.getReader();
  const stream = createWriteStream(path);
  let bytes = 0;
  let finished = false;
  // A media connection can close while a temporary file is being cleaned up.
  // Keep the stream error observed so it cannot terminate the Node process.
  stream.on("error", () => {});
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel?.().catch(() => {});
        throw createMediaExtractionError("video_media_too_large", "视频文件过大，暂时无法生成复习内容。", {
          retryable: false
        });
      }
      if (!stream.write(chunk)) {
        await waitForStream(stream, "drain");
      }
    }
    stream.end();
    await waitForStream(stream, "finish");
    finished = true;
    return bytes;
  } finally {
    reader.releaseLock?.();
    if (!finished) {
      stream.destroy();
    }
  }
}

function waitForStream(stream, event) {
  return new Promise((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off(event, onSuccess);
      stream.off("error", onError);
    };
    stream.once(event, onSuccess);
    stream.once("error", onError);
  });
}

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function readContentLength(headers) {
  const value = headers?.get?.("content-length") || headers?.get?.("Content-Length") || "";
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readContentRangeTotal(headers) {
  const value = headers?.get?.("content-range") || headers?.get?.("Content-Range") || "";
  const match = String(value).match(/\/([0-9]+)$/);
  const number = Number(match?.[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}
