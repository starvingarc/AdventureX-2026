import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpeechToTextProvider,
  resolveSpeechToTextProviderName
} from "./speechToTextProvider.js";

test("resolves ASR provider from explicit env, then local whisper default", () => {
  assert.equal(resolveSpeechToTextProviderName({ VIDEO_ASR_PROVIDER: "local_whisper", OPENAI_API_KEY: "key" }), "local_whisper");
  assert.equal(resolveSpeechToTextProviderName({ OPENAI_API_KEY: "key" }), "local_whisper");
  assert.equal(resolveSpeechToTextProviderName({ QWEN_API: "summary-only-key" }), "local_whisper");
  assert.equal(resolveSpeechToTextProviderName({ QWEN_ASR_API_KEY: "asr-key" }), "qwen_filetrans");
  assert.equal(resolveSpeechToTextProviderName({}), "local_whisper");
});

test("creates local whisper provider for faster_whisper alias", () => {
  const provider = createSpeechToTextProvider({ env: { VIDEO_ASR_PROVIDER: "faster_whisper" } });
  assert.equal(provider.name, "local_whisper");
  assert.equal(typeof provider.transcribeAudio, "function");
});

test("creates OpenAI ASR provider for explicit openai configuration", () => {
  const provider = createSpeechToTextProvider({ env: { VIDEO_ASR_PROVIDER: "openai" } });
  assert.equal(provider.name, "openai");
  assert.equal(typeof provider.transcribeAudio, "function");
});

test("rejects unsupported ASR providers", () => {
  assert.throws(
    () => createSpeechToTextProvider({ env: { VIDEO_ASR_PROVIDER: "unknown-asr" } }),
    /暂不支持的语音转写供应商：unknown-asr/
  );
});
