import { callModelJson } from "../generation/openaiClient.js";

// Keep question generation replaceable without coupling the flow to V2 internals.
export { generateQuickReviewPath } from "../v2/generation/quickReviewGenerator.js";

const VIDEO_OVERVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "highlights"],
  properties: {
    summary: { type: "string" },
    highlights: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } }
  }
};

export async function generateVideoOverview({
  title = "",
  account = "",
  rawText = ""
} = {}, {
  modelJsonCaller = callModelJson,
  maxInputCharacters = Number(process.env.VIDEO_OVERVIEW_MAX_INPUT_CHARS) || 14_000
} = {}) {
  const content = selectOverviewWindow(rawText, maxInputCharacters);
  if (!content) return { summary: "未提取到可用于生成全片概览的语音内容。", highlights: [] };
  const output = await modelJsonCaller({
    system: [
      "你总结一条视频的完整转写内容。",
      "只依据输入，不补充原文没有的信息。",
      "summary 用 2-4 句概括全片脉络；highlights 输出 2-5 条短要点。",
      "不要生成题目，不要使用 Markdown。"
    ].join("\n"),
    user: [`标题：${title}`, account ? `博主：${account}` : "", `全片转写：\n${content}`].filter(Boolean).join("\n\n"),
    schemaName: "shibei_video_overview_v1",
    schema: VIDEO_OVERVIEW_SCHEMA,
    stage: "video_overview",
    estimatedOutputTokens: 260
  });
  return {
    summary: String(output?.summary || "").trim() || "该视频已完成全片转写。",
    highlights: Array.isArray(output?.highlights)
      ? output.highlights.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
      : []
  };
}

function selectOverviewWindow(value, maxCharacters) {
  const text = String(value || "").trim();
  if (text.length <= maxCharacters) return text;
  const size = Math.floor(maxCharacters / 3);
  const middle = Math.floor(text.length / 2);
  return [text.slice(0, size), text.slice(middle - Math.floor(size / 2), middle + Math.ceil(size / 2)), text.slice(-size)]
    .join("\n\n[中间内容已省略]\n\n");
}
