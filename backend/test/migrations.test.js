import assert from "node:assert/strict";
import test from "node:test";

import { loadMigrations } from "../src/migrations.js";

test("migration set includes durable screenshot jobs after assessment idempotency", async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.version), ["001", "002", "003"]);
  assert.match(migrations[2].sql, /CREATE TABLE omo_screenshot_jobs/);
  assert.match(migrations[2].sql, /UNIQUE \(owner_id, fingerprint\)/);
});
