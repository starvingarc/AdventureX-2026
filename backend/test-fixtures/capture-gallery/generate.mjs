import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const galleryRoot = fileURLToPath(new URL(".", import.meta.url));
const viewport = { width: 390, height: 844 };
const fixtures = [
  {
    id: "synthetic-bilibili-recall",
    expectedPlatform: "bilibili",
    source: "sources/bilibili-recall.html",
    file: "bilibili-recall.png"
  },
  {
    id: "synthetic-douyin-spacing",
    expectedPlatform: "douyin",
    source: "sources/douyin-spacing.html",
    file: "douyin-spacing.png"
  }
];

const browser = await chromium.launch({ headless: true });
try {
  const generated = [];
  for (const fixture of fixtures) {
    const sourcePath = join(galleryRoot, fixture.source);
    const outputPath = join(galleryRoot, fixture.file);
    const sourceBytes = await readFile(sourcePath);
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(sourceBytes.toString("utf8"), { waitUntil: "load" });
    await page.screenshot({
      path: outputPath,
      type: "png",
      fullPage: false,
      animations: "disabled"
    });
    await page.close();
    const imageBytes = await readFile(outputPath);
    generated.push({
      ...fixture,
      width: viewport.width,
      height: viewport.height,
      mimeType: "image/png",
      bytes: imageBytes.length,
      sha256: digest(imageBytes),
      sourceSha256: digest(sourceBytes),
      provenance: "Repository-authored synthetic HTML; no external visual assets.",
      personalInformation: false
    });
  }

  const manifest = {
    schemaVersion: "capture_fixture_gallery_1",
    purpose: "Deterministic screenshot inputs for Recallo platform-flow tests.",
    generation: {
      command: "npm --prefix backend run fixtures:capture-gallery",
      script: "generate.mjs",
      engine: "playwright-chromium",
      engineVersion: browser.version(),
      viewport,
      deviceScaleFactor: 1
    },
    fixtures: generated
  };
  await writeFile(
    join(galleryRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(`Generated ${generated.length} capture fixtures.`);
} finally {
  await browser.close();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
