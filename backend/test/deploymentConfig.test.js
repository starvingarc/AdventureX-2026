import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

test("Railway staging builds the backend from an explicit Dockerfile", async () => {
  const railwayConfig = JSON.parse(
    await readFile(new URL("railway.json", repositoryRoot), "utf8")
  );
  const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");

  assert.equal(railwayConfig.build?.builder, "DOCKERFILE");
  assert.equal(railwayConfig.build?.dockerfilePath, "Dockerfile");
  assert.match(dockerfile, /^FROM node:20-alpine$/m);
  assert.match(
    dockerfile,
    /^COPY backend\/package\.json backend\/package-lock\.json \.\/$/m
  );
  assert.match(dockerfile, /^RUN npm ci --omit=dev$/m);
  assert.match(dockerfile, /^COPY backend\/ \.\/$/m);
  assert.match(dockerfile, /^CMD \["npm", "start"\]$/m);
});

test("Railway container listens on every interface", async () => {
  const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");

  assert.match(dockerfile, /^ENV HOST=0\.0\.0\.0$/m);
});

test("Release builds target only the verified TestFlight staging API", async () => {
  const project = await readFile(
    new URL("Omo/Omo.xcodeproj/project.pbxproj", repositoryRoot),
    "utf8"
  );

  assert.match(
    project,
    /OMO_API_BASE_URL = "https:\/\/omo-api-staging-staging\.up\.railway\.app";/
  );
  assert.doesNotMatch(project, /shibei-production\.up\.railway\.app/);
});

test("Omo uses an independent app identity and build sequence", async () => {
  const project = await readFile(
    new URL("Omo/Omo.xcodeproj/project.pbxproj", repositoryRoot),
    "utf8"
  );

  assert.equal(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.maxhan\.omo;/g)?.length,
    2
  );
  assert.equal(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.maxhan\.omo\.Tests;/g)?.length,
    2
  );
  assert.equal(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.maxhan\.omo\.UITests;/g)?.length,
    2
  );
  assert.equal(project.match(/CURRENT_PROJECT_VERSION = 1;/g)?.length, 6);
  assert.doesNotMatch(project, /com\.maxhan\.shibei/);
});
