import assert from "node:assert/strict";
import test from "node:test";

import { transcribeMediaWithQwen } from "./qwenFileTranscriptionProvider.js";

test("lets Qwen auto-detect language unless an explicit language is configured", async () => {
  let taskRequest = null;
  const result = await transcribeMediaWithQwen({
    mediaUrl: "https://media.example.com/audio.mp3",
    apiKey: "test-key",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    language: "auto",
    pollMs: 1,
    timeoutMs: 1_000,
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes("/services/audio/asr/transcription")) {
        taskRequest = JSON.parse(options.body);
        return jsonResponse({ output: { task_id: "task-1" } });
      }
      if (String(url).includes("/tasks/task-1")) {
        return jsonResponse({
          output: {
            task_status: "SUCCEEDED",
            results: [{ transcription_url: "https://media.example.com/result.json" }]
          }
        });
      }
      return jsonResponse({
        transcripts: [{
          sentences: [{ begin_time: 0, end_time: 1200, text: "主动回忆" }]
        }]
      });
    }
  });

  assert.equal(Object.hasOwn(taskRequest.parameters, "language"), false);
  assert.equal(result.segments[0].text, "主动回忆");
  assert.equal(result.segments[0].endSeconds, 1.2);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  };
}
