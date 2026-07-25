import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTikHubArticleSource,
  extractSourceContent
} from "./extractSourceContent.js";

test("builds V2 evidence blocks from normalized social content", () => {
  const result = buildTikHubArticleSource({
    provider: "tikhub",
    platform: "xiaohongshu",
    providerContentId: "note-1",
    kind: "image_text",
    title: "碎片化学习",
    text: "收藏并不等于记住。主动回忆要求用户先尝试回答，再查看解释，从而发现自己真正没有掌握的部分。",
    account: "学习笔记",
    sourceUrl: "https://www.xiaohongshu.com/explore/note-1",
    images: ["https://media.example.com/note.jpg"],
    coverUrl: ""
  });

  assert.equal(result.sourceType, "article_link");
  assert.equal(result.platform, "xiaohongshu");
  assert.equal(result.source.media.provider, "tikhub");
  assert.equal(result.source.media.providerContentId, "note-1");
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].id, "xiaohongshu-platform-text-001");
  assert.equal(result.blocks[0].sourceRole, "platform_description");
  assert.match(result.rawText, /主动回忆/);
});

test("routes Xiaohongshu image notes through TikHub instead of generic HTML extraction", async () => {
  let calls = 0;
  const result = await extractSourceContent({
    sourceType: "article_link",
    sourceUrl: "https://www.xiaohongshu.com/explore/note-2"
  }, {
    env: {
      TIKHUB_API_KEY: "configured",
      TIKHUB_CONTENT_ENABLED: "1"
    },
    fetchTikHubContentSource: async ({ sourceUrl }) => {
      calls += 1;
      assert.equal(sourceUrl, "https://www.xiaohongshu.com/explore/note-2");
      return {
        provider: "tikhub",
        platform: "xiaohongshu",
        providerContentId: "note-2",
        kind: "image_text",
        title: "检索练习",
        text: "检索练习不是重复阅读，而是在隐藏答案后主动尝试提取，再依据反馈修正错误。",
        account: "认知科学笔记",
        sourceUrl,
        images: []
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.sourceTitle, "检索练习");
  assert.equal(result.sourceAccount, "认知科学笔记");
  assert.equal(result.source.blocks[0].id, "xiaohongshu-platform-text-001");
});

test("allows the verified screenshot flow to force Xiaohongshu source extraction", async () => {
  let calls = 0;
  const result = await extractSourceContent({
    sourceType: "article_link",
    sourceUrl: "https://www.xiaohongshu.com/explore/note-verified",
    forceTikHubContent: true,
    screenshotText: "截图里清楚显示：先回忆再查看答案，用反馈修正真正没有掌握的部分。"
  }, {
    env: {
      TIKHUB_API_KEY: "configured",
      TIKHUB_CONTENT_ENABLED: "0"
    },
    fetchTikHubContentSource: async ({ sourceUrl }) => {
      calls += 1;
      return {
        provider: "tikhub",
        platform: "xiaohongshu",
        providerContentId: "note-verified",
        kind: "image_text",
        title: "截图已核验的笔记",
        text: "短文",
        account: "学习笔记",
        sourceUrl,
        images: []
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.sourceTitle, "截图已核验的笔记");
  assert.match(result.rawText, /先回忆再查看答案/);
});

test("short image-only social posts ask the user to use screenshot vision", () => {
  assert.throws(
    () => buildTikHubArticleSource({
      platform: "xiaohongshu",
      kind: "image_text",
      title: "图片笔记",
      text: "看图",
      images: ["https://media.example.com/note.jpg"]
    }),
    /请改用截图导入/
  );
});
