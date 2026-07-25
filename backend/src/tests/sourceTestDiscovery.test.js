import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverSourcePlan } from "../../scripts/check-source.mjs";

test("discovers syntax targets broadly while keeping test execution inside src", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recallo-source-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(root, "src", "nested"), { recursive: true }),
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "test-fixtures", "gallery"), { recursive: true }),
    mkdir(join(root, "test-fixtures", "node_modules", "ignored"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(root, "src", "alpha.js"), "export const alpha = true;\n"),
    writeFile(join(root, "src", "alpha.test.js"), "export const alphaTest = true;\n"),
    writeFile(join(root, "src", "nested", "beta.test.mjs"), "export const betaTest = true;\n"),
    writeFile(join(root, "src", "nested", "gamma.cjs"), "module.exports = true;\n"),
    writeFile(join(root, "scripts", "benchmark.mjs"), "export const benchmark = true;\n"),
    writeFile(join(root, "scripts", "outside.test.js"), "export const outside = true;\n"),
    writeFile(join(root, "test-fixtures", "gallery", "generate.cjs"), "module.exports = true;\n"),
    writeFile(join(root, "test-fixtures", "node_modules", "ignored", "hidden.js"), "bad syntax {\n"),
    writeFile(join(root, "src", "nested", "ignored.txt"), "ignored\n")
  ]);

  const plan = await discoverSourcePlan({ root, scope: "src" });
  assert.deepEqual(plan.syntaxScopes, ["src", "scripts", "test-fixtures"]);
  assert.deepEqual(
    plan.jsFiles.map((filePath) => relativeFixturePath(root, filePath)),
    [
      "scripts/benchmark.mjs",
      "scripts/outside.test.js",
      "src/alpha.js",
      "src/alpha.test.js",
      "src/nested/beta.test.mjs",
      "src/nested/gamma.cjs",
      "test-fixtures/gallery/generate.cjs"
    ]
  );
  assert.deepEqual(
    plan.testFiles.map((filePath) => relativeFixturePath(root, filePath)),
    ["src/alpha.test.js", "src/nested/beta.test.mjs"]
  );
});

test("keeps a focused V2 check inside src/v2", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recallo-v2-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src", "v2"), { recursive: true });
  await writeFile(join(root, "src", "v2", "contract.test.js"), "export const contract = true;\n");

  const plan = await discoverSourcePlan({ root, scope: "src/v2" });
  assert.equal(plan.scope, "src/v2");
  assert.deepEqual(plan.syntaxScopes, ["src/v2"]);
  assert.equal(plan.jsFiles.length, 1);
  assert.equal(plan.testFiles.length, 1);
  await assert.rejects(
    () => discoverSourcePlan({ root, scope: "../outside" }),
    /must stay inside backend root/
  );
});

function relativeFixturePath(root, filePath) {
  return filePath.slice(root.length + 1).replaceAll("\\", "/");
}
