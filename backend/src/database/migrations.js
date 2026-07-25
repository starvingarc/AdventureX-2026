import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../migrations/", import.meta.url)
);

const MIGRATION_FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_KEY = "recallo-versioned-migrations-v1";

export async function runVersionedMigrations(pool, {
  directory = DEFAULT_MIGRATIONS_DIRECTORY
} = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("runVersionedMigrations requires a PostgreSQL pool");
  }
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const appliedResult = await client.query(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
    );
    const applied = new Map(appliedResult.rows.map((row) => [String(row.version), row]));

    for (const migration of migrations) {
      const previous = applied.get(migration.version);
      if (previous) {
        if (String(previous.checksum) !== migration.checksum) {
          throw migrationError(
            "migration_checksum_mismatch",
            `Migration ${migration.version} checksum does not match the applied migration.`
          );
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      );
    }
    await client.query("COMMIT");
    return {
      ok: true,
      applied: migrations.filter((item) => !applied.has(item.version)).map((item) => item.version),
      currentVersion: migrations.at(-1)?.version || ""
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function loadMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const versions = new Set();
  const migrations = [];
  for (const fileName of fileNames) {
    const match = fileName.match(MIGRATION_FILE_PATTERN);
    if (!match) {
      throw migrationError(
        "migration_filename_invalid",
        `Migration file name must match NNN_name.sql: ${fileName}`
      );
    }
    const [, version, name] = match;
    if (versions.has(version)) {
      throw migrationError("migration_version_duplicate", `Duplicate migration version: ${version}`);
    }
    versions.add(version);
    const sql = await readFile(join(directory, fileName), "utf8");
    if (!sql.trim()) {
      throw migrationError("migration_empty", `Migration is empty: ${fileName}`);
    }
    migrations.push({
      version,
      name,
      fileName,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    });
  }
  return migrations;
}

function migrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
