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
