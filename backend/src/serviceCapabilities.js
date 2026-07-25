import { buildSourceCapabilities } from "./sources/sourcePreflight.js";
import { enabledCapturePlatforms } from "./flow/search.js";

export const SERVICE_CAPABILITIES = Object.freeze({
  legacyChapterGeneration: true,
  v2ChapterGeneration: true,
  v2ReviewSessions: true,
  favoriteQuestions: true,
  notifications: true,
  sourceAnchors: true
});

export function buildServiceCapabilities(env = process.env) {
  const capturePlatforms = enabledCapturePlatforms(env.CAPTURE_PLATFORMS);
  return {
    ...SERVICE_CAPABILITIES,
    screenshotCapture: {
      enabled: true,
      inputMode: "direct_image",
      analysisProvider: "qwen_vision",
      platforms: {
        bilibili: { enabled: capturePlatforms.includes("bilibili") },
        douyin: { enabled: capturePlatforms.includes("douyin") },
        xiaohongshu: { enabled: capturePlatforms.includes("xiaohongshu") }
      }
    },
    sources: buildSourceCapabilities({ env })
  };
}
