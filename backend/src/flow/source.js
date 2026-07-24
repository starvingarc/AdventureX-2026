import {
  extractSourceContent as defaultExtractSourceContent,
  isVideoUrl
} from "../sources/extractSourceContent.js";

// Keep platform extractors outside the flow while returning only the transcript
// window that corresponds to the screenshot when a player timestamp is available.
export async function extractFocusedSourceContent(input, {
  extractSourceContent = defaultExtractSourceContent
} = {}) {
  const extracted = await extractSourceContent(input);
  const source = appendScreenshotEvidence(extracted, input?.screenshotText);
  const focus = focusSourceContent(source, input?.timestampSeconds, {
    locatorTerms: input?.locatorTerms
  });
  return {
    ...source,
    overviewText: String(source.rawText || "").trim(),
    overviewBlocks: Array.isArray(source.blocks) ? source.blocks : [],
    rawText: focus.text,
    blocks: focus.blocks,
    focus
  };
}

function appendScreenshotEvidence(source, screenshotText) {
  const visibleText = String(screenshotText || "").trim();
  if (source?.sourceType !== "article_link" || source?.platform !== "xiaohongshu" || visibleText.length < 24) {
    return source;
  }
  const platformText = String(source.rawText || "").trim();
  const normalizedPlatform = normalize(platformText);
  const normalizedScreenshot = normalize(visibleText);
  if (!normalizedScreenshot || normalizedPlatform.includes(normalizedScreenshot)) return source;
  const rawText = [visibleText, platformText].filter(Boolean).join("\n\n");
  const blocks = [
    { id: "xiaohongshu-screenshot-ocr-001", type: "paragraph", sourceRole: "screenshot_ocr", text: visibleText },
    ...(Array.isArray(source.blocks) ? source.blocks : [])
  ];
  return { ...source, rawText, blocks };
}

export { isVideoUrl };

export function focusSourceContent(source, timestampSeconds, { radiusSeconds = 45, locatorTerms = [] } = {}) {
  const blocks = Array.isArray(source?.blocks) ? source.blocks : [];
  const timestamp = timestampSeconds === null || timestampSeconds === undefined || timestampSeconds === ""
    ? Number.NaN
    : Number(timestampSeconds);
  const timedBlocks = blocks.filter((block) => Number.isFinite(Number(block?.startSeconds)) && Number.isFinite(Number(block?.endSeconds)));
  if (!Number.isFinite(timestamp) && timedBlocks.length > 0) {
    const locatedTimestamp = locateByTerms(timedBlocks, locatorTerms);
    if (locatedTimestamp !== null) {
      return buildTimestampFocus(timedBlocks, locatedTimestamp, radiusSeconds, "transcript_match");
    }
  }
  if (!Number.isFinite(timestamp) || timedBlocks.length === 0) {
    return {
      status: Number.isFinite(timestamp) ? "timestamp_unavailable" : "timestamp_missing",
      timestampSeconds: Number.isFinite(timestamp) ? timestamp : null,
      blocks,
      text: String(source?.rawText || "").trim()
    };
  }

  return buildTimestampFocus(timedBlocks, timestamp, radiusSeconds, "timestamp_window");
}

function buildTimestampFocus(timedBlocks, timestamp, radiusSeconds, status) {
  const start = Math.max(0, timestamp - radiusSeconds);
  const end = timestamp + radiusSeconds;
  let selected = timedBlocks.filter((block) => Number(block.endSeconds) >= start && Number(block.startSeconds) <= end);
  if (selected.length === 0) {
    selected = [...timedBlocks]
      .sort((a, b) => distanceToTimestamp(a, timestamp) - distanceToTimestamp(b, timestamp))
      .slice(0, 4)
      .sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds));
  }
  return {
    status,
    timestampSeconds: timestamp,
    startSeconds: Number(selected[0]?.startSeconds),
    endSeconds: Number(selected.at(-1)?.endSeconds),
    blocks: selected,
    text: selected.map((block) => block.text).filter(Boolean).join("\n\n")
  };
}

function locateByTerms(blocks, terms) {
  const candidates = Array.isArray(terms) ? terms.map(normalize).filter((term) => term.length >= 2) : [];
  if (!candidates.length) return null;
  const ranked = blocks.map((block) => {
    const text = normalize(block.text);
    const score = candidates.reduce((total, term) => total + (text.includes(term) ? Math.min(3, term.length) : 0), 0);
    return { block, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 2 ? Number(ranked[0].block.startSeconds) : null;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^\u4e00-\u9fff0-9a-z]/g, "");
}

function distanceToTimestamp(block, timestamp) {
  const start = Number(block.startSeconds);
  const end = Number(block.endSeconds);
  if (timestamp >= start && timestamp <= end) return 0;
  return Math.min(Math.abs(timestamp - start), Math.abs(timestamp - end));
}
