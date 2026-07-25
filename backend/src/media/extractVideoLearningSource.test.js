import assert from "node:assert/strict";
import test from "node:test";

import { extractVideoLearningSource } from "./extractVideoLearningSource.js";
import { createMediaExtractionError } from "./mediaErrors.js";
import { createMediaUsageRecorder } from "./mediaCost.js";
import { buildVideoSourceCacheKey, createInMemoryTtlCache } from "./videoExtractionCache.js";
import { createNoopVideoFramePackProvider } from "./videoFramePackProvider.js";
import { createNoopVisualUnderstandingProvider } from "./visualUnderstandingProvider.js";

test("extracts a video learning source through provider, media, audio, and ASR", async () => {
  const calls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/abc/",
    provider: {
      fetchVideoSource: async () => {
        calls.push("provider");
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-1",
          title: "AI 产品调研",
          description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据，并把访谈记录转成可验证的主题清单。",
          account: "产品老张",
          sourceUrl: "https://v.douyin.com/abc/",
          mediaUrl: "https://media.example.com/video.mp4",
          coverUrl: "https://media.example.com/cover.jpg",
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async () => {
      calls.push("download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => {
      calls.push("asr");
      return {
        provider: "mock_asr",
        segments: [
          {
            id: "seg-1",
            startSeconds: 0,
            endSeconds: 4,
            text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。最后把主题映射到可以执行的产品实验，避免只停留在总结层面。"
          }
        ]
      };
    },
    cleanup: async (...files) => {
      calls.push(`cleanup:${files.length}`);
    }
  });

  assert.deepEqual(calls, ["provider", "download", "audio", "asr", "cleanup:2"]);
  assert.equal(learningSource.platform, "douyin");
  assert.match(learningSource.normalizedText, /平台文案/);
  assert.match(learningSource.normalizedText, /先明确用户问题/);
});

test("uses yt-dlp media downloader for universal video provider results", async () => {
  const calls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.youtube.com/watch?v=abc",
    provider: {
      name: "yt-dlp",
      fetchVideoSource: async () => {
        calls.push("provider");
        return {
          provider: "yt-dlp",
          platform: "youtube",
          providerContentId: "youtube-abc",
          title: "多 Agent 通信设计",
          description: "平台文案说明这条视频介绍多 Agent 通信的拓扑、协议和共享状态。",
          account: "AI Teacher",
          sourceUrl: "https://www.youtube.com/watch?v=abc",
          mediaUrl: "https://www.youtube.com/watch?v=abc",
          mediaDownload: {
            provider: "yt-dlp",
            sourceUrl: "https://www.youtube.com/watch?v=abc",
            formatSelector: "bv*+ba/best"
          }
        };
      }
    },
    downloadMedia: async () => {
      calls.push("http-download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    downloadYtDlpMedia: async ({ sourceUrl, formatSelector }) => {
      calls.push(`yt-dlp-download:${sourceUrl}:${formatSelector}`);
      return {
        path: "/tmp/video-dir/source-video.mp4",
        dir: "/tmp/video-dir",
        bytes: 1024,
        contentType: "video/mp4"
      };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 6,
        text: "多 Agent 通信设计首先要定义拓扑结构，然后明确消息协议，最后决定共享状态和异常恢复机制。面试时要说明为什么选择这种协作方式，以及它如何降低系统耦合。"
      }]
    }),
    cleanup: async (...files) => calls.push(`cleanup:${files.length}`)
  });

  assert.deepEqual(calls, [
    "provider",
    "yt-dlp-download:https://www.youtube.com/watch?v=abc:bv*+ba/best",
    "audio",
    "cleanup:2"
  ]);
  assert.equal(learningSource.platform, "youtube");
  assert.match(learningSource.normalizedText, /消息协议/);
});

test("rejects video links when the backend feature flag is disabled", async () => {
  const restoreEnv = setEnvForTest({ VIDEO_LINK_ENABLED: "false" });
  try {
    await assert.rejects(
      () => extractVideoLearningSource({
        sourceUrl: "https://www.bilibili.com/video/BV1disabled"
      }),
      (error) => (
        error.mediaErrorType === "video_link_disabled"
        && error.retryable === false
        && /暂未开放/.test(error.message)
      )
    );
  } finally {
    restoreEnv();
  }
});

test("rejects yt-dlp platforms when the yt-dlp feature flag is disabled", async () => {
  const restoreEnv = setEnvForTest({ VIDEO_YTDLP_ENABLED: "off" });
  try {
    await assert.rejects(
      () => extractVideoLearningSource({
        sourceUrl: "https://www.youtube.com/watch?v=disabled"
      }),
      (error) => (
        error.mediaErrorType === "video_ytdlp_disabled"
        && error.retryable === false
        && /B站/.test(error.message)
      )
    );
  } finally {
    restoreEnv();
  }
});

test("rejects video platforms outside the configured allowlist", async () => {
  const restoreEnv = setEnvForTest({ VIDEO_PLATFORM_ALLOWLIST: "douyin,xiaohongshu" });
  try {
    await assert.rejects(
      () => extractVideoLearningSource({
        sourceUrl: "https://www.bilibili.com/video/BV1blocked"
      }),
      (error) => (
        error.mediaErrorType === "unsupported_video_platform"
        && error.retryable === false
        && error.provider === "bilibili"
      )
    );
  } finally {
    restoreEnv();
  }
});

test("rejects videos longer than the configured duration limit before download", async () => {
  const calls = [];
  await assert.rejects(
    () => extractVideoLearningSource({
      sourceUrl: "https://www.bilibili.com/video/BV1long",
      maxDurationSeconds: 900,
      provider: {
        name: "yt-dlp",
        fetchVideoSource: async () => {
          calls.push("provider");
          return {
            provider: "yt-dlp",
            platform: "bilibili",
            title: "超长课程",
            sourceUrl: "https://www.bilibili.com/video/BV1long",
            mediaUrl: "https://www.bilibili.com/video/BV1long",
            durationSeconds: 901,
            mediaDownload: {
              provider: "yt-dlp",
              sourceUrl: "https://www.bilibili.com/video/BV1long"
            }
          };
        }
      },
      downloadYtDlpMedia: async () => {
        calls.push("yt-dlp-download");
        return { path: "/tmp/video-dir/source-video.mp4", dir: "/tmp/video-dir" };
      },
      cleanup: async () => calls.push("cleanup")
    }),
    (error) => (
      error.mediaErrorType === "video_duration_too_long"
      && error.retryable === false
      && /15 分钟/.test(error.message)
    )
  );
  assert.deepEqual(calls, ["provider"]);
});

test("allows videos at the configured duration limit", async () => {
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.bilibili.com/video/BV1limit",
    maxDurationSeconds: 900,
    provider: {
      name: "yt-dlp",
      fetchVideoSource: async () => ({
        provider: "yt-dlp",
        platform: "bilibili",
        title: "十五分钟课程",
        description: "平台文案说明这条视频介绍 Agent 的定义、工具调用和任务拆解。",
        sourceUrl: "https://www.bilibili.com/video/BV1limit",
        mediaUrl: "https://www.bilibili.com/video/BV1limit",
        durationSeconds: 900,
        mediaDownload: {
          provider: "yt-dlp",
          sourceUrl: "https://www.bilibili.com/video/BV1limit"
        }
      })
    },
    downloadYtDlpMedia: async () => ({
      path: "/tmp/video-dir/source-video.mp4",
      dir: "/tmp/video-dir",
      bytes: 2048,
      contentType: "video/mp4"
    }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 6,
        text: "Agent 是能够理解目标并调用工具完成任务的系统。学习时要区分模型本身、工具调用、记忆状态和任务规划，并用具体流程解释它们如何协作。"
      }]
    }),
    cleanup: async () => {}
  });

  assert.equal(learningSource.durationSeconds, 900);
  assert.match(learningSource.normalizedText, /工具调用/);
});

function setEnvForTest(values) {
  const previous = new Map();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("cleans temporary files when ASR fails", async () => {
  const calls = [];
  await assert.rejects(
    () => extractVideoLearningSource({
      sourceUrl: "https://v.douyin.com/abc/",
      provider: {
        fetchVideoSource: async () => ({
          provider: "tikhub",
          platform: "douyin",
          title: "AI 产品调研",
          sourceUrl: "https://v.douyin.com/abc/",
          mediaUrl: "https://media.example.com/video.mp4"
        })
      },
      downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" }),
      extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
      transcribeAudio: async () => {
        throw new Error("asr failed");
      },
      cleanup: async (...files) => calls.push(`cleanup:${files.length}`)
    }),
    /asr failed/
  );
  assert.deepEqual(calls, ["cleanup:2"]);
});

test("uses platform subtitles before falling back to ASR", async () => {
  const calls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.xiaohongshu.com/discovery/item/1",
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "xiaohongshu",
        providerContentId: "xhs-1",
        title: "设计原则",
        description: "平台文案说明这条视频介绍苹果设计原则。",
        account: "Design_韬",
        sourceUrl: "https://www.xiaohongshu.com/discovery/item/1",
        mediaUrl: "https://media.example.com/video.mp4",
        subtitles: [{ language: "zh-CN", url: "https://media.example.com/zh.srt" }]
      })
    },
    downloadMedia: async () => {
      calls.push("download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    fetchPlatformTranscript: async ({ subtitles }) => {
      calls.push(`subtitle:${subtitles[0].language}`);
      return {
        provider: "platform_subtitle:zh-CN",
        segments: [{
          id: "subtitle-1",
          startSeconds: 1,
          endSeconds: 5,
          text: "出色设计需要先明确内容层级，再用动效帮助用户理解状态变化。设计师应该把核心任务放在最容易注意的位置，用对比、留白和节奏降低理解成本，并在每一次状态切换中给出清晰反馈。"
        }]
      };
    },
    transcribeAudio: async () => {
      calls.push("asr");
      return { provider: "mock_asr", segments: [] };
    },
    cleanup: async (...files) => {
      calls.push(`cleanup:${files.length}`);
    }
  });

  assert.deepEqual(calls, ["subtitle:zh-CN"]);
  assert.match(learningSource.normalizedText, /内容层级/);
});

test("uses a public audio URL before downloading media for Qwen ASR", async () => {
  const calls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.bilibili.com/video/BV1fast",
    provider: {
      fetchVideoSource: async () => ({
        provider: "bilibili_api",
        platform: "bilibili",
        title: "直连音频转写",
        account: "测试博主",
        sourceUrl: "https://www.bilibili.com/video/BV1fast",
        mediaUrl: "https://media.example.com/audio.m4a",
        audioUrl: "https://media.example.com/audio.m4a"
      })
    },
    downloadMedia: async () => {
      calls.push("download");
      throw new Error("direct ASR should skip download");
    },
    speechToTextProvider: {
      name: "qwen_filetrans",
      transcribeMedia: async ({ mediaUrl }) => {
        calls.push(`remote:${mediaUrl}`);
        return {
          provider: "qwen_filetrans",
          segments: [{
            id: "asr-1",
            startSeconds: 0,
            endSeconds: 12,
            text: "远端语音转写直接读取平台音频地址，因此不需要在后端重复下载完整视频。带时间戳的内容会被后续截图定位逻辑用于生成附近知识点，并且全片转写也能独立生成完整知识地图。"
          }]
        };
      },
      transcribeAudio: async () => {
        throw new Error("local fallback should not run");
      }
    },
    cleanup: async () => calls.push("cleanup")
  });

  assert.deepEqual(calls, ["remote:https://media.example.com/audio.m4a", "cleanup"]);
  assert.match(learningSource.normalizedText, /不需要在后端重复下载/);
});

test("uses a short-lived public media URL for Qwen after a platform CDN rejects it", async () => {
  const mediaUrls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.bilibili.com/video/BV1qwen",
    publicMediaBaseUrl: "https://api.example.com",
    provider: {
      fetchVideoSource: async () => ({
        provider: "bilibili_api",
        platform: "bilibili",
        title: "无字幕视频",
        account: "测试博主",
        sourceUrl: "https://www.bilibili.com/video/BV1qwen",
        mediaUrl: "https://www.bilibili.com/video/BV1qwen",
        audioUrl: "https://cdn.example.com/blocked-audio.m4a",
        mediaDownload: { provider: "yt-dlp", sourceUrl: "https://www.bilibili.com/video/BV1qwen", formatSelector: "bestaudio/best" }
      })
    },
    downloadYtDlpMedia: async () => ({
      path: "/tmp/video-dir/source-audio.m4a",
      dir: "/tmp/video-dir",
      contentType: "audio/mp4",
      isAudioOnly: true
    }),
    speechToTextProvider: {
      name: "qwen_filetrans",
      transcribeMedia: async ({ mediaUrl }) => {
        mediaUrls.push(mediaUrl);
        if (mediaUrl.includes("cdn.example.com")) throw new Error("FILE_403_FORBIDDEN");
        return {
          provider: "qwen_filetrans",
          segments: [{
            id: "asr-1",
            startSeconds: 0,
            endSeconds: 12,
            text: "短期公网地址让 Qwen 能够读取音频并返回时间戳。对于没有平台字幕的视频，系统先保留原始音频格式，再把随机令牌地址交给异步转写服务。得到带时间戳的语音文本后，截图位置可以回到对应片段，完整视频则生成独立的知识地图。这样既避免平台 CDN 拒绝模型访问，也不会把本地临时文件长期暴露到公网。"
          }]
        };
      },
      transcribeAudio: async () => {
        throw new Error("local fallback should not run");
      }
    },
    cleanup: async () => {}
  });

  assert.equal(mediaUrls.length, 2);
  assert.match(mediaUrls[1], /^https:\/\/api\.example\.com\/api\/asr-media\/[0-9a-f-]{36}$/);
  assert.match(learningSource.normalizedText, /短期公网地址/);
});

test("splits long audio and merges concurrent ASR timestamps", async () => {
  const mediaUrls = [];
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://www.bilibili.com/video/BV1parallel",
    maxDurationSeconds: 1_200,
    publicMediaBaseUrl: "https://api.example.com",
    provider: {
      fetchVideoSource: async () => ({
        provider: "bilibili_api",
        platform: "bilibili",
        title: "并发长视频转写",
        description: "平台文案介绍并发转写测试。",
        account: "测试博主",
        sourceUrl: "https://www.bilibili.com/video/BV1parallel",
        mediaUrl: "https://cdn.example.com/audio.m4a",
        mediaRequestHeaders: { referer: "https://www.bilibili.com/" },
        durationSeconds: 1_200
      })
    },
    downloadMedia: async () => ({
      path: "/tmp/video-dir/source-audio.m4a",
      dir: "/tmp/video-dir",
      contentType: "audio/mp4",
      isAudioOnly: true
    }),
    splitAudioForAsr: async () => ({
      dir: "/tmp/video-dir/asr-chunks",
      chunks: [
        { path: "/tmp/chunk-0.mp3", contentType: "audio/mpeg", chunkIndex: 0, startSeconds: 0 },
        { path: "/tmp/chunk-1.mp3", contentType: "audio/mpeg", chunkIndex: 1, startSeconds: 300 }
      ]
    }),
    speechToTextProvider: {
      name: "qwen_filetrans",
      transcribeMedia: async ({ mediaUrl }) => {
        mediaUrls.push(mediaUrl);
        return {
          provider: "qwen_filetrans",
          segments: [{ id: "asr-1", startSeconds: 2, endSeconds: 12, text: "并发分片返回带时间戳的完整语音内容，用于生成截图附近知识点和全片总结。" }]
        };
      },
      transcribeAudio: async () => { throw new Error("local fallback should not run"); }
    },
    cleanup: async () => {}
  });

  assert.equal(mediaUrls.length, 2);
  assert.deepEqual(learningSource.transcriptSegments.map((segment) => segment.startSeconds), [2, 302]);
  assert.match(learningSource.normalizedText, /全片总结/);
});

test("caches TikHub video source responses without caching downstream extraction", async () => {
  const calls = [];
  const videoSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  const options = {
    sourceUrl: "https://v.douyin.com/cache-source/",
    videoSourceCache,
    learningSourceCache: null,
    provider: {
      fetchVideoSource: async () => {
        calls.push("provider");
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-cache-1",
          title: "AI 产品调研",
          description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据。",
          account: "产品老张",
          sourceUrl: "https://v.douyin.com/cache-source/",
          mediaUrl: "https://media.example.com/video.mp4",
          coverUrl: "https://media.example.com/cover.jpg",
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async () => {
      calls.push("download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 5,
        text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。最后把主题映射到可以执行的产品实验，避免只停留在总结层面。这个流程要求团队把观察、证据、判断和下一步动作串起来。"
      }]
    }),
    framePackProvider: createNoopVideoFramePackProvider(),
    visualUnderstandingProvider: createNoopVisualUnderstandingProvider(),
    cleanup: async () => {}
  };

  await extractVideoLearningSource(options);
  await extractVideoLearningSource(options);

  assert.deepEqual(calls, ["provider", "download", "audio", "download", "audio"]);
});

test("refreshes cached TikHub source once when cached media URL is stale", async () => {
  const calls = [];
  const recorder = createMediaUsageRecorder({ runId: "stale-media-url-run" });
  const videoSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  const learningSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  let providerCallCount = 0;
  let downloadCallCount = 0;
  const options = {
    sourceUrl: "https://v.douyin.com/stale-media-url/",
    videoSourceCache,
    learningSourceCache,
    mediaUsageRecorder: recorder,
    provider: {
      fetchVideoSource: async () => {
        providerCallCount += 1;
        calls.push(`provider:${providerCallCount}`);
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-stale-media-url",
          title: "AI 产品调研",
          description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据。",
          account: "产品老张",
          sourceUrl: "https://v.douyin.com/stale-media-url/",
          mediaUrl: `https://media.example.com/video-${providerCallCount}.mp4`,
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async ({ mediaUrl }) => {
      downloadCallCount += 1;
      calls.push(`download:${mediaUrl}`);
      if (downloadCallCount === 2) {
        throw createMediaExtractionError(
          "video_media_unavailable",
          "cached media URL expired",
          { retryable: true }
        );
      }
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 5,
        text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。这个流程适合转成复习材料。"
      }]
    }),
    cleanup: async () => {}
  };

  await extractVideoLearningSource(options);
  await extractVideoLearningSource({
    ...options,
    learningSourceCache: null
  });

  assert.deepEqual(calls, [
    "provider:1",
    "download:https://media.example.com/video-1.mp4",
    "audio",
    "download:https://media.example.com/video-1.mp4",
    "provider:2",
    "download:https://media.example.com/video-2.mp4",
    "audio"
  ]);
  assert.equal(providerCallCount, 2);
  assert.equal(downloadCallCount, 3);
  const tikhubFetches = recorder.calls.filter((call) => call.stage === "tikhub_fetch");
  const mediaFetches = recorder.calls.filter((call) => call.stage === "video_media_fetch");
  assert.equal(tikhubFetches.length, 3);
  assert.equal(tikhubFetches.at(-1).metadata.staleVideoSourceCache, true);
  assert.equal(tikhubFetches.at(-1).metadata.refetchedProviderSource, true);
  assert.equal(mediaFetches.at(-1).metadata.staleVideoSourceCache, true);
  assert.equal(mediaFetches.at(-1).metadata.refetchedProviderSource, true);
});

test("does not repeatedly refresh TikHub source when refreshed media URL also fails", async () => {
  const videoSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  await videoSourceCache.set(buildVideoSourceCacheKey({
    sourceUrl: "https://v.douyin.com/repeated-stale-media-url/"
  }), {
    provider: "tikhub",
    platform: "douyin",
    providerContentId: "douyin-repeated-stale-media-url",
    title: "AI 产品调研",
    description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据。",
    account: "产品老张",
    sourceUrl: "https://v.douyin.com/repeated-stale-media-url/",
    mediaUrl: "https://media.example.com/stale-video.mp4",
    durationSeconds: 60
  });
  let providerCallCount = 0;
  let downloadCallCount = 0;
  const options = {
    sourceUrl: "https://v.douyin.com/repeated-stale-media-url/",
    videoSourceCache,
    learningSourceCache: null,
    provider: {
      fetchVideoSource: async () => {
        providerCallCount += 1;
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-repeated-stale-media-url",
          title: "AI 产品调研",
          description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据。",
          account: "产品老张",
          sourceUrl: "https://v.douyin.com/repeated-stale-media-url/",
          mediaUrl: `https://media.example.com/repeated-video-${providerCallCount}.mp4`,
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async () => {
      downloadCallCount += 1;
      throw createMediaExtractionError(
        "video_media_unavailable",
        "media URL unavailable",
        { retryable: true }
      );
    },
    extractAudio: async () => {
      throw new Error("audio should not run");
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: []
    }),
    cleanup: async () => {}
  };

  await assert.rejects(
    () => extractVideoLearningSource(options),
    /media URL unavailable/
  );

  assert.equal(providerCallCount, 1);
  assert.equal(downloadCallCount, 2);
});

test("caches full video learning sources so generation retries do not re-fetch media", async () => {
  const calls = [];
  const firstRecorder = createMediaUsageRecorder({ runId: "video-cache-run-1" });
  const secondRecorder = createMediaUsageRecorder({ runId: "video-cache-run-2" });
  const learningSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  const options = {
    sourceUrl: "https://v.douyin.com/cache-learning-source/",
    videoSourceCache: createInMemoryTtlCache({ ttlMs: 60_000 }),
    learningSourceCache,
    provider: {
      fetchVideoSource: async () => {
        calls.push("provider");
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-cache-2",
          title: "AI 产品调研",
          description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据。",
          account: "产品老张",
          sourceUrl: "https://v.douyin.com/cache-learning-source/",
          mediaUrl: "https://media.example.com/video.mp4",
          coverUrl: "https://media.example.com/cover.jpg",
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async () => {
      calls.push("download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 5,
        text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑。最后把主题映射到可以执行的产品实验，避免只停留在总结层面。这个流程要求团队把观察、证据、判断和下一步动作串起来。"
      }]
    }),
    framePackProvider: createNoopVideoFramePackProvider(),
    visualUnderstandingProvider: createNoopVisualUnderstandingProvider(),
    cleanup: async () => {}
  };

  const first = await extractVideoLearningSource({ ...options, mediaUsageRecorder: firstRecorder });
  const second = await extractVideoLearningSource({ ...options, mediaUsageRecorder: secondRecorder });

  assert.deepEqual(calls, ["provider", "download", "audio"]);
  assert.equal(first.extractionMeta.cache.hit, false);
  assert.equal(second.extractionMeta.cache.hit, true);
  assert.equal(second.title, "AI 产品调研");
  assert.equal(secondRecorder.calls.length, 1);
  assert.equal(secondRecorder.calls.at(-1).stage, "video_learning_source_cache");
  assert.equal(secondRecorder.calls.at(-1).metadata.cacheHit, true);
  assert.equal(second.extractionMeta.mediaUsage.callCount, 1);
});

test("does not cache transcript-only fallback when visual understanding fails", async () => {
  const calls = [];
  let visualCallCount = 0;
  const learningSourceCache = createInMemoryTtlCache({ ttlMs: 60_000 });
  const options = {
    sourceUrl: "https://v.douyin.com/visual-cache-fallback/",
    videoSourceCache: null,
    learningSourceCache,
    provider: {
      fetchVideoSource: async () => {
        calls.push("provider");
        return {
          provider: "tikhub",
          platform: "douyin",
          providerContentId: "douyin-visual-cache-fallback",
          title: "多 Agent 通信",
          description: "平台文案说明这条视频讲多 Agent 通信设计，核心是拓扑、契约和共享状态。",
          account: "小哲讲大模型",
          sourceUrl: "https://v.douyin.com/visual-cache-fallback/",
          mediaUrl: "https://media.example.com/video.mp4",
          durationSeconds: 60
        };
      }
    },
    downloadMedia: async () => {
      calls.push("download");
      return { path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" };
    },
    extractAudio: async () => {
      calls.push("audio");
      return { path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" };
    },
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [{
        id: "seg-1",
        startSeconds: 0,
        endSeconds: 8,
        text: "多 Agent 通信设计要先选择通信拓扑，再定义结构化消息契约，最后维护共享状态。"
      }]
    }),
    framePackProvider: {
      name: "crv_style_ffmpeg",
      createFramePack: async () => ({
        provider: "crv_style_ffmpeg",
        skipped: false,
        frames: [{ id: "frame-0001", path: "/tmp/f.jpg", startSeconds: 0, endSeconds: 5, kept: true }],
        grids: [{ id: "grid-0001", path: "/tmp/g.jpg", frameIds: ["frame-0001"], startSeconds: 0, endSeconds: 5 }]
      })
    },
    visualUnderstandingProvider: {
      name: "mock-vision",
      model: "mock-vl"
    },
    understandVisuals: async () => {
      visualCallCount += 1;
      if (visualCallCount === 1) throw new Error("no_json_object");
      return {
        provider: "mock-vision",
        model: "mock-vl",
        segments: [{
          id: "visual-001",
          startSeconds: 0,
          endSeconds: 5,
          text: "画面展示三个 Agent 通过共享状态进行协作通信。"
        }]
      };
    },
    cleanup: async () => {}
  };

  const first = await extractVideoLearningSource(options);
  const second = await extractVideoLearningSource(options);

  assert.equal(first.extractionMeta.cache.hit, false);
  assert.equal(first.extractionMeta.cache.stored, false);
  assert.equal(first.extractionMeta.visualUnderstanding.status, "failed");
  assert.equal(second.extractionMeta.cache.hit, false);
  assert.equal(second.extractionMeta.cache.stored, true);
  assert.equal(second.extractionMeta.visualUnderstanding.status, "succeeded");
  assert.equal(second.visualSegments.length, 1);
  assert.equal(visualCallCount, 2);
  assert.deepEqual(calls, ["provider", "download", "audio", "provider", "download", "audio"]);
});

test("records media usage summary when a recorder is provided", async () => {
  const recorder = createMediaUsageRecorder({ runId: "run-1" });
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/abc/",
    mediaUsageRecorder: recorder,
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "douyin",
        providerContentId: "douyin-1",
        title: "AI 产品调研",
        description: "平台文案说明这条视频讲 AI 调研流程，强调先定义问题，再整理证据，并形成产品实验。",
        account: "产品老张",
        sourceUrl: "https://v.douyin.com/abc/",
        mediaUrl: "https://media.example.com/video.mp4"
      })
    },
    downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir", bytes: 1200, contentType: "video/mp4" }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir", format: "wav", sampleRate: 16000 }),
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [
        {
          id: "seg-1",
          startSeconds: 0,
          endSeconds: 8,
          text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑，最后映射到可执行实验。"
        }
      ]
    }),
    framePackProvider: createNoopVideoFramePackProvider(),
    visualUnderstandingProvider: createNoopVisualUnderstandingProvider(),
    cleanup: async () => {}
  });

  assert.equal(recorder.calls.length, 6);
  assert.equal(learningSource.extractionMeta.mediaUsage.callCount, 6);
  assert.equal(learningSource.extractionMeta.mediaUsage.byStage.video_media_fetch.callCount, 1);
  assert.equal(learningSource.extractionMeta.mediaUsage.byStage.audio_transcription.callCount, 1);
  assert.equal(learningSource.extractionMeta.mediaUsage.byStage.video_frame_pack.callCount, 1);
  assert.equal(learningSource.extractionMeta.mediaUsage.byStage.visual_understanding.callCount, 1);
  assert.equal(recorder.calls[3].provider, "mock_asr");
  assert.equal(recorder.calls[4].provider, "none");
  assert.equal(recorder.calls[4].metadata.skipped, true);
  assert.equal(recorder.calls[5].provider, "none");
  assert.equal(recorder.calls[5].metadata.skipped, true);
});

test("records structured frame pack failure diagnostics internally", async () => {
  const recorder = createMediaUsageRecorder({ runId: "frame-pack-diagnostics-run" });
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/frame-pack-diagnostics/",
    mediaUsageRecorder: recorder,
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "douyin",
        providerContentId: "douyin-frame-pack-diagnostics",
        title: "AI 产品调研",
        description: "平台文案说明这条视频讲 AI 调研流程，强调把画面证据和口播证据合并成学习材料。",
        account: "产品老张",
        sourceUrl: "https://v.douyin.com/frame-pack-diagnostics/",
        mediaUrl: "https://media.example.com/video.mp4"
      })
    },
    downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [
        {
          id: "seg-1",
          startSeconds: 0,
          endSeconds: 8,
          text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑，最后映射到可执行实验。"
        }
      ]
    }),
    framePackProvider: {
      name: "crv_style_ffmpeg",
      createFramePack: async () => ({
        provider: "crv_style_ffmpeg",
        skipped: true,
        reason: "video_frame_pack_failed",
        frames: [],
        grids: [],
        debug: {
          failureCode: "video_frame_pack_failed",
          failureMessage: "ffmpeg exited with unsupported codec",
          retryable: true
        }
      })
    },
    cleanup: async () => {}
  });

  const frameUsage = learningSource.extractionMeta.mediaUsage.byStage.video_frame_pack;
  assert.equal(frameUsage.metadata.skipped, true);
  assert.equal(frameUsage.metadata.failureCode, "video_frame_pack_failed");
  assert.equal(frameUsage.metadata.failureMessage, "ffmpeg exited with unsupported codec");
  assert.equal(frameUsage.metadata.retryable, true);
  assert.equal(learningSource.extractionMeta.userVisibleContentBasis.basis, "audio_transcript");
});

test("passes timestamped frame pack into visual understanding", async () => {
  let receivedFramePack = null;
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/abc/",
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "douyin",
        sourceUrl: "https://v.douyin.com/abc/",
        title: "Figma Motion",
        description: "平台文案说明这个视频介绍 Figma Motion 的动画能力，并用屏幕录制展示 shader 和组件化流程。",
        account: "月半AI酱",
        durationSeconds: 76,
        mediaUrl: "https://media.example.com/video.mp4",
        providerContentId: "video-1"
      })
    },
    downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
    transcribeAudio: async () => ({
      provider: "local_whisper",
      segments: [{
        startSeconds: 0,
        endSeconds: 5,
        text: "这是一个 Figma Motion 教程，介绍 shader、组件、变量、agent 和开发模式五个重点更新。"
      }]
    }),
    framePackProvider: {
      name: "crv_style_ffmpeg",
      createFramePack: async () => ({
        provider: "crv_style_ffmpeg",
        skipped: false,
        frames: [{ id: "frame-0001", path: "/tmp/f.jpg", startSeconds: 0, endSeconds: 5, kept: true }],
        grids: [{ id: "grid-0001", path: "/tmp/g.jpg", frameIds: ["frame-0001"], startSeconds: 0, endSeconds: 5 }],
        debug: { keptFrameCount: 1, timestampMode: "metadata" }
      })
    },
    understandVisuals: async ({ framePack }) => {
      receivedFramePack = framePack;
      return {
        provider: "fake-vision",
        segments: [{ id: "visual-001", startSeconds: 0, endSeconds: 5, text: "画面展示 Figma Motion 面板。" }]
      };
    },
    cleanup: async () => {}
  });

  assert.equal(receivedFramePack.provider, "crv_style_ffmpeg");
  assert.equal(receivedFramePack.frames.length, 1);
  assert.equal(learningSource.visualSegments.length, 1);
  assert.match(learningSource.normalizedText, /画面展示 Figma Motion 面板/);
});

test("merges visual understanding segments when a provider is injected", async () => {
  const recorder = createMediaUsageRecorder({ runId: "visual-usage-run" });
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/abc/",
    mediaUsageRecorder: recorder,
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "douyin",
        providerContentId: "douyin-1",
        title: "AI 产品调研",
        description: "平台文案说明这条视频讲 AI 调研流程，强调把画面证据和口播证据合并成学习材料。",
        account: "产品老张",
        sourceUrl: "https://v.douyin.com/abc/",
        mediaUrl: "https://media.example.com/video.mp4"
      })
    },
    downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [
        {
          id: "seg-1",
          startSeconds: 0,
          endSeconds: 8,
          text: "先明确用户问题，再整理主题，并检查每个主题有没有原始证据支撑，最后映射到可执行实验。"
        }
      ]
    }),
    visualUnderstandingProvider: {
      name: "mock-vision",
      understandVideo: async () => ({
        provider: "mock-vision",
        model: "mock-vl",
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
        segments: [
          {
            id: "frame-1",
            sourceRole: "visual_summary",
            startSeconds: 2,
            endSeconds: 5,
            text: "画面中的流程图把用户问题、访谈证据和实验假设连成三步。"
          }
        ]
      })
    },
    cleanup: async () => {}
  });

  assert.equal(learningSource.visualSegments.length, 1);
  assert.match(learningSource.normalizedText, /画面中的流程图/);
  assert.equal(learningSource.sourceSections.at(-1).sourceRole, "visual_summary");
  assert.equal(learningSource.extractionMeta.mediaUsage.byStage.visual_understanding.metadata.model, "mock-vl");
  assert.deepEqual(learningSource.extractionMeta.mediaUsage.byStage.visual_understanding.metadata.usage, {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150
  });
});

test("falls back to transcript-only source when visual understanding output is invalid", async () => {
  const recorder = createMediaUsageRecorder({ runId: "visual-fallback-run" });
  const learningSource = await extractVideoLearningSource({
    sourceUrl: "https://v.douyin.com/abc/",
    mediaUsageRecorder: recorder,
    provider: {
      fetchVideoSource: async () => ({
        provider: "tikhub",
        platform: "douyin",
        providerContentId: "douyin-visual-fallback",
        title: "多 Agent 通信",
        description: "平台文案说明这条视频讲多 Agent 通信设计，核心是拓扑、契约和共享状态。",
        account: "小哲讲大模型",
        sourceUrl: "https://v.douyin.com/abc/",
        mediaUrl: "https://media.example.com/video.mp4"
      })
    },
    downloadMedia: async () => ({ path: "/tmp/video-dir/source-video", dir: "/tmp/video-dir" }),
    extractAudio: async () => ({ path: "/tmp/video-dir/audio.wav", dir: "/tmp/video-dir" }),
    transcribeAudio: async () => ({
      provider: "mock_asr",
      segments: [
        {
          id: "seg-1",
          startSeconds: 0,
          endSeconds: 8,
          text: "多 Agent 通信设计要先选择通信拓扑，再定义结构化消息契约，最后维护共享状态。"
        }
      ]
    }),
    framePackProvider: {
      name: "crv_style_ffmpeg",
      createFramePack: async () => ({
        provider: "crv_style_ffmpeg",
        skipped: false,
        frames: [{ id: "frame-0001", path: "/tmp/f.jpg", startSeconds: 0, endSeconds: 5, kept: true }],
        grids: [{ id: "grid-0001", path: "/tmp/g.jpg", frameIds: ["frame-0001"], startSeconds: 0, endSeconds: 5 }],
        debug: { keptFrameCount: 1, timestampMode: "metadata" }
      })
    },
    understandVisuals: async () => {
      throw new Error("no_json_object");
    },
    cleanup: async () => {}
  });

  assert.equal(learningSource.visualSegments.length, 0);
  assert.match(learningSource.normalizedText, /多 Agent 通信设计/);
  assert.equal(learningSource.extractionMeta.visualUnderstanding.status, "failed");
  assert.equal(learningSource.extractionMeta.visualUnderstanding.failureCode, "visual_output_parse_failed");
  assert.equal(learningSource.extractionMeta.visualUnderstanding.retryable, true);
  assert.equal(learningSource.extractionMeta.userVisibleContentBasis.basis, "audio_transcript");
  assert.equal(learningSource.extractionMeta.userVisibleContentBasis.message, "本次主要基于视频字幕生成");
  assert.equal(
    learningSource.extractionMeta.mediaUsage.byStage.visual_understanding.metadata.status,
    "failed"
  );
});
