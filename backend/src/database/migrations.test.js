import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  loadMigrations,
  runVersionedMigrations
} from "./migrations.js";

class FakeMigrationClient {
  constructor() {
    this.applied = new Map();
    this.queries = [];
    this.released = false;
  }

  async query(sql, params = []) {
    const text = String(sql).trim();
    this.queries.push({ text, params });
    if (text.startsWith("SELECT version, name, checksum FROM schema_migrations")) {
      return { rows: [...this.applied.entries()].map(([version, value]) => ({ version, ...value })) };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      this.applied.set(String(params[0]), { name: params[1], checksum: params[2] });
    }
    return { rows: [], rowCount: 0 };
  }

  release() {
    this.released = true;
  }
}

function poolFor(client) {
  return { connect: async () => client };
}

test("loads ordered versioned migrations with a content checksum", async () => {
  const migrations = await loadMigrations(DEFAULT_MIGRATIONS_DIRECTORY);
  assert.deepEqual(migrations.map((item) => item.version), ["001", "002"]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[1].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[0].sql, /CREATE TABLE captures/);
  assert.match(migrations[0].sql, /sealed.*awakened.*solidified.*engraved/s);
  assert.doesNotMatch(migrations[0].sql, /original_image|image_base64|full_model_response|model_response/i);
  assert.match(migrations[1].sql, /capture_persistence_epoch BIGINT NOT NULL DEFAULT 0/);
});

test("applies each migration once under a transaction and advisory lock", async () => {
  const client = new FakeMigrationClient();
  const pool = poolFor(client);
  const first = await runVersionedMigrations(pool);
  const second = await runVersionedMigrations(pool);

  assert.deepEqual(first.applied, ["001", "002"]);
  assert.deepEqual(second.applied, []);
  assert.equal(client.applied.size, 2);
  assert.equal(client.queries.filter((item) => item.text === "BEGIN").length, 2);
  assert.equal(client.queries.filter((item) => item.text === "COMMIT").length, 2);
  assert.equal(client.queries.filter((item) => item.text.includes("pg_advisory_xact_lock")).length, 2);
  assert.equal(client.released, true);
});

test("rejects an applied migration whose checksum changed and rolls back", async () => {
  const client = new FakeMigrationClient();
  await runVersionedMigrations(poolFor(client));
  const previous = client.applied.get("001");
  client.applied.set("001", { ...previous, checksum: "0".repeat(64) });

  await assert.rejects(
    runVersionedMigrations(poolFor(client)),
    (error) => error?.code === "migration_checksum_mismatch"
  );
  assert.equal(client.queries.at(-1).text, "ROLLBACK");
});
