import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ReadableStream } from "node:stream/web";
import test from "node:test";

import { cleanupMediaTempFiles, downloadMediaToTempFile } from "./mediaFiles.js";

test("downloads media to a temp file and cleans it up", async () => {
  let receivedHeaders = null;
  const file = await downloadMediaToTempFile({
    mediaUrl: "https://media.example.com/video.mp4",
    maxBytes: 100,
    requestHeaders: { referer: "https://www.bilibili.com/" },
    fetchImpl: async (_url, options) => {
      receivedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "video/mp4"]]),
        arrayBuffer: async () => Buffer.from("fake-video")
      };
    }
  });

  assert.equal(file.contentType, "video/mp4");
  assert.equal(receivedHeaders.referer, "https://www.bilibili.com/");
  assert.equal(await readFile(file.path, "utf8"), "fake-video");
  await cleanupMediaTempFiles(file);
  assert.equal(existsSync(file.path), false);
});

test("rejects media larger than configured max bytes", async () => {
  await assert.rejects(
    () => downloadMediaToTempFile({
      mediaUrl: "https://media.example.com/video.mp4",
      maxBytes: 4,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "video/mp4"]]),
        arrayBuffer: async () => Buffer.from("too-large")
      })
    }),
    /视频文件过大/
  );
});

test("downloads protected CDN media with concurrent byte ranges", async () => {
  const source = Buffer.from("range-download-content");
  const ranges = [];
  const file = await downloadMediaToTempFile({
    mediaUrl: "https://cdn.example.com/audio.m4s",
    requestHeaders: { referer: "https://www.bilibili.com/" },
    maxBytes: 100,
    fetchImpl: async (_url, options) => {
      const value = options.headers.range;
      const [start, end] = value.slice(6).split("-").map(Number);
      const actualEnd = Number.isFinite(end) ? end : source.length - 1;
      ranges.push(value);
      return new Response(source.subarray(start, actualEnd + 1), {
        status: 206,
        headers: {
          "content-type": "audio/mp4",
          "content-range": `bytes ${start}-${actualEnd}/${source.length}`
        }
      });
    }
  });
  assert.equal(ranges[0], "bytes=0-0");
  assert.equal(await readFile(file.path, "utf8"), source.toString());
  await cleanupMediaTempFiles(file);
});

test("rejects oversized content-length before reading media body", async () => {
  let arrayBufferCalled = false;
  await assert.rejects(
    () => downloadMediaToTempFile({
      mediaUrl: "https://media.example.com/video.mp4",
      maxBytes: 4,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "video/mp4"],
          ["content-length", "9"]
        ]),
        arrayBuffer: async () => {
          arrayBufferCalled = true;
          return Buffer.from("too-large");
        }
      })
    }),
    /视频文件过大/
  );
  assert.equal(arrayBufferCalled, false);
});

test("aborts streamed media when body exceeds max bytes without content-length", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("too-"));
      controller.enqueue(Buffer.from("large"));
      controller.close();
    }
  });

  await assert.rejects(
    () => downloadMediaToTempFile({
      mediaUrl: "https://media.example.com/video.mp4",
      maxBytes: 4,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-type", "video/mp4"]]),
        body
      })
    }),
    /视频文件过大/
  );
});
