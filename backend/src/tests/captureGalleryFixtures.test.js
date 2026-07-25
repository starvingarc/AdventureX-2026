import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const galleryRoot = new URL("../../test-fixtures/capture-gallery/", import.meta.url);

test("ships two synthetic capture fixtures with platform and provenance metadata", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", galleryRoot), "utf8"));
  assert.equal(manifest.schemaVersion, "capture_fixture_gallery_1");
  assert.equal(manifest.fixtures.length, 2);
  assert.deepEqual(
    manifest.fixtures.map((item) => item.expectedPlatform).sort(),
    ["bilibili", "douyin"]
  );

  for (const fixture of manifest.fixtures) {
    assert.equal(fixture.personalInformation, false);
    assert.match(fixture.provenance, /synthetic HTML/);
    const [imageBytes, sourceBytes] = await Promise.all([
      readFile(new URL(fixture.file, galleryRoot)),
      readFile(new URL(fixture.source, galleryRoot))
    ]);
    assert.ok(imageBytes.length > 10_000);
    assert.equal(imageBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(imageBytes.readUInt32BE(16), fixture.width);
    assert.equal(imageBytes.readUInt32BE(20), fixture.height);
    assert.equal(digest(imageBytes), fixture.sha256);
    assert.equal(digest(sourceBytes), fixture.sourceSha256);
  }
});

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
