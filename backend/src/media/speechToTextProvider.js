import { createMediaExtractionError } from "./mediaErrors.js";
import { transcribeAudioWithLocalWhisper } from "./localWhisperTranscriptionProvider.js";
import { transcribeAudioWithOpenAI } from "./openAITranscriptionProvider.js";
import { transcribeMediaWithQwen } from "./qwenFileTranscriptionProvider.js";
import { VIDEO_DEFAULTS } from "./videoDefaults.js";

export function resolveSpeechToTextProviderName(env = process.env) {
  const explicitProvider = String(env.VIDEO_ASR_PROVIDER || "").trim().toLowerCase();
  if (explicitProvider) return explicitProvider;
  if (env.QWEN_ASR_API_KEY || env.QWEN_API || env.DASHSCOPE_API_KEY) return "qwen_filetrans";
  return VIDEO_DEFAULTS.asrProvider;
}

export function createSpeechToTextProvider({
  env = process.env
} = {}) {
  const providerName = resolveSpeechToTextProviderName(env);
  if (providerName === "openai") {
    return {
      name: "openai",
      async transcribeAudio(args) {
        return transcribeAudioWithOpenAI(args);
      }
    };
  }

  if (["qwen", "qwen_filetrans", "qwen_asr"].includes(providerName)) {
    return {
      name: "qwen_filetrans",
      async transcribeMedia(args) {
        return transcribeMediaWithQwen(args);
      },
      async transcribeAudio(args) {
        return transcribeAudioWithLocalWhisper(args);
      }
    };
  }

  if (providerName === "local_whisper" || providerName === "faster_whisper") {
    return {
      name: "local_whisper",
      async transcribeAudio(args) {
        return transcribeAudioWithLocalWhisper(args);
      }
    };
  }

  throw createMediaExtractionError(
    "unsupported_asr_provider",
    `暂不支持的语音转写供应商：${providerName}`,
    { retryable: false, provider: providerName }
  );
}
