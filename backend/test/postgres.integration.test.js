import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

import { importJsonCards } from "../src/importJsonStore.js";
import { getMigrationStatus, runMigrations } from "../src/migrations.js";
import { PostgresCardStore } from "../src/postgresStore.js";
import { createOmoServer } from "../src/server.js";

const databaseURL = process.env.TEST_DATABASE_URL || "";
const resetAllowed = process.env.OMO_ALLOW_TEST_DATABASE_RESET === "1";

test("PostgreSQL migrations, persistence, concurrency and import", {
  skip: !databaseURL
}, async (context) => {
  assert.equal(resetAllowed, true, "OMO_ALLOW_TEST_DATABASE_RESET=1 is required");
  const parsedURL = new URL(databaseURL);
  assert.ok(["127.0.0.1", "localhost"].includes(parsedURL.hostname));
  assert.match(parsedURL.pathname, /^\/omo_test_/);

  let pool = createPool();
  await resetSchema(pool);
  await verifyFailedMigrationRollback(pool, context);

  const [firstRunner, secondRunner] = await Promise.all([
    runMigrations(pool, { targetVersion: "001" }),
    runMigrations(pool, { targetVersion: "001" })
  ]);
  assert.deepEqual(
    [...firstRunner.newlyApplied, ...secondRunner.newlyApplied].sort(),
    ["001"]
  );
  const upgradeRequired = await getMigrationStatus(pool);
  assert.equal(upgradeRequired.ready, false);
  assert.deepEqual(upgradeRequired.pendingVersions, ["002"]);

  const upgraded = await runMigrations(pool);
  assert.deepEqual(upgraded.newlyApplied, ["002"]);
  assert.equal((await getMigrationStatus(pool)).ready, true);
  await verifyChecksumDrift(pool, context);

  let store = new PostgresCardStore(pool);
  const card = memoryCard("card-canonical");
  await store.save("device-a", card);
  const duplicate = await store.save("device-a", {
    ...card,
    answer: "不应覆盖 canonical 卡片"
  });
  assert.equal(duplicate.answer, "合成答案");
  await store.close();

  pool = createPool();
  store = new PostgresCardStore(pool);
  assert.equal((await store.get("device-a", card.id)).answer, "合成答案");

  const firstAssessment = await store.assess(
    "device-a",
    card.id,
    "remembered",
    "attempt-idempotent"
  );
  const repeatedAssessment = await store.assess(
    "device-a",
    card.id,
    "forgot",
    "attempt-idempotent"
  );
  assert.equal(firstAssessment.reviewCount, 1);
  assert.equal(repeatedAssessment.reviewCount, 1);
  assert.equal(repeatedAssessment.lastAssessment, "remembered");

  await Promise.all([
    store.assess("device-a", card.id, "remembered", "attempt-concurrent-a"),
    store.assess("device-a", card.id, "remembered", "attempt-concurrent-b")
  ]);
  const assessed = await store.get("device-a", card.id);
  assert.equal(assessed.reviewCount, 3);
  assert.equal(assessed.successfulRecallCount, 3);

  const raceCard = memoryCard("card-delete-race");
  await store.save("device-a", raceCard);
  const race = await Promise.allSettled([
    store.assess("device-a", raceCard.id, "remembered", "attempt-race"),
    store.delete("device-a", raceCard.id)
  ]);
  assert.equal(race.every((result) => result.status === "fulfilled"), true);
  assert.equal(await store.get("device-a", raceCard.id), null);

  const importDirectory = mkdtempSync(join(tmpdir(), "omo-import-"));
  context.after(() => rmSync(importDirectory, { recursive: true, force: true }));
  const importFile = join(importDirectory, "cards.json");
  writeFileSync(importFile, JSON.stringify([
    { owner: "device-import", card: memoryCard("card-imported") }
  ]));
  const dryRun = await importJsonCards({ filePath: importFile, store, dryRun: true });
  assert.deepEqual(dryRun, { scanned: 1, imported: 1, existing: 0, dryRun: true });
  assert.equal(await store.get("device-import", "card-imported"), null);
  const imported = await importJsonCards({ filePath: importFile, store });
  assert.deepEqual(imported, { scanned: 1, imported: 1, existing: 0, dryRun: false });
  const importedAgain = await importJsonCards({ filePath: importFile, store });
  assert.deepEqual(importedAgain, { scanned: 1, imported: 0, existing: 1, dryRun: false });

  await store.close();
  await verifyServiceRestart();

  pool = createPool();
  store = new PostgresCardStore(pool);
  await store.save("recovery-owner", memoryCard("recovery-card"));
  assert.equal((await store.readiness()).ready, true);
  await store.close();
});

async function verifyChecksumDrift(pool, context) {
  const directory = mkdtempSync(join(tmpdir(), "omo-migrations-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  for (const name of [
    "001-create-owners-and-memory-cards.sql",
    "002-add-assessment-idempotency-and-version.sql"
  ]) {
    copyFileSync(new URL(name, migrationsDirectory), join(directory, basename(name)));
  }
  const firstMigration = join(directory, "001-create-owners-and-memory-cards.sql");
  writeFileSync(firstMigration, `${readFileSync(firstMigration, "utf8")}\n-- drift\n`);
  const status = await getMigrationStatus(pool, { migrationsDirectory: directory });
  assert.equal(status.ready, false);
  assert.equal(status.reason, "storage_migration_drift");
}

async function verifyFailedMigrationRollback(pool, context) {
  const directory = mkdtempSync(join(tmpdir(), "omo-broken-migration-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "001-broken-migration.sql"),
    `CREATE TABLE migration_rollback_probe (id INTEGER);
     SELECT * FROM table_that_does_not_exist;`
  );

  await assert.rejects(
    runMigrations(pool, { migrationsDirectory: directory }),
    (error) => error.migrationCode === "migration_failed"
  );
  const result = await pool.query(
    `SELECT
       to_regclass('public.migration_rollback_probe') AS probe,
       to_regclass('public.omo_schema_migrations') AS migrations`
  );
  assert.equal(result.rows[0].probe, null);
  assert.equal(result.rows[0].migrations, null);
}

async function resetSchema(pool) {
  await pool.query("DROP TABLE IF EXISTS omo_assessment_attempts CASCADE");
  await pool.query("DROP TABLE IF EXISTS omo_memory_cards CASCADE");
  await pool.query("DROP TABLE IF EXISTS omo_owners CASCADE");
  await pool.query("DROP TABLE IF EXISTS omo_schema_migrations CASCADE");
}

async function verifyServiceRestart() {
  let pool = createPool();
  let store = new PostgresCardStore(pool);
  let server = createOmoServer({
    env: {
      NODE_ENV: "development",
      OMO_DEMO_MODE: "1",
      DATABASE_URL: databaseURL
    },
    store
  });
  let baseURL = await listen(server);
  const created = await fetch(`${baseURL}/api/sources/image-flow`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": "service-restart-owner"
    },
    body: JSON.stringify({ imageBase64: "c2VydmljZS1yZXN0YXJ0" })
  });
  assert.equal(created.status, 200);
  const createdCard = (await created.json()).card;
  await closeServer(server);
  await store.close();

  pool = createPool();
  store = new PostgresCardStore(pool);
  server = createOmoServer({
    env: {
      NODE_ENV: "development",
      OMO_DEMO_MODE: "1",
      DATABASE_URL: databaseURL
    },
    store
  });
  baseURL = await listen(server);
  const readback = await fetch(`${baseURL}/api/memory-cards`, {
    headers: { "x-device-id": "service-restart-owner" }
  });
  const cards = (await readback.json()).cards;
  assert.equal(readback.status, 200);
  assert.equal(cards.some((card) => card.id === createdCard.id), true);
  await closeServer(server);
  await store.close();
}

function listen(server) {
  return new Promise((resolveURL, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolveURL(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

function createPool() {
  return new Pool({
    connectionString: databaseURL,
    max: 6,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 1_000
  });
}

function memoryCard(id) {
  const now = new Date().toISOString();
  return {
    id,
    generationMode: "fixture",
    coreKnowledge: "合成知识",
    recallCue: "合成提示",
    answer: "合成答案",
    explanation: "合成解释",
    sourceTitle: "合成来源",
    sourceAccount: "",
    sourcePlatform: "unknown",
    sourceUrl: "",
    sourceStatus: "screenshot_only",
    sourceProvider: "tikhub",
    sourceReason: "provider_missing",
    sourceConfidence: 0,
    rarity: "R",
    createdAt: now,
    masteryStage: "sealed",
    nextReviewAt: now,
    reviewCount: 0,
    successfulRecallCount: 0,
    lastAssessment: null,
    stepIndex: 0,
    attemptIds: []
  };
}
