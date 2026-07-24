export const VIDEO_DEFAULTS = Object.freeze({
  maxDurationSeconds: 2 * 60 * 60,
  platformAllowlist: Object.freeze([
    "douyin",
    "xiaohongshu",
    "youtube",
    "bilibili",
    "direct_video_file",
    "generic_web"
  ]),
  asrProvider: "local_whisper",
  localWhisperModel: "small",
  localWhisperDevice: "auto",
  localWhisperComputeType: "int8",
  localWhisperLanguage: "auto",
  frameProvider: "none",
  visualProvider: "none",
  visualModel: "qwen3-vl-flash",
  mediaMaxBytes: 40 * 1024 * 1024,
  audioMaxBytes: 20 * 1024 * 1024,
  mediaFetchTimeoutMs: 60_000,
  tikhubUnitCostUsd: 0.001
});
