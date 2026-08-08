import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_PATTERN = /^(\d{3})-([a-z0-9-]+)\.sql$/;
const MIGRATION_LOCK_ID = 1_704_202_629;
const defaultMigrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

export async function loadMigrations(migrationsDirectory = defaultMigrationsDirectory) {
  const fileNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrations = [];
  const versions = new Set();

  for (const fileName of fileNames) {
    const match = fileName.match(MIGRATION_PATTERN);
    if (!match) {
      throw migrationError(
        "migration_name_invalid",
        `Migration name must match NNN-description.sql: ${fileName}`
      );
    }
    const version = match[1];
    if (versions.has(version)) {
      throw migrationError("migration_version_duplicate", `Duplicate migration: ${version}`);
    }
    versions.add(version);
    const sql = await readFile(resolve(migrationsDirectory, fileName), "utf8");
    migrations.push({
      version,
      name: fileName,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    });
  }

  if (!migrations.length) {
    throw migrationError("migration_set_empty", "No migrations were found.");
  }
  return migrations;
}

export async function runMigrations(pool, {
  migrationsDirectory = defaultMigrationsDirectory,
  targetVersion
} = {}) {
  const migrations = await loadMigrations(migrationsDirectory);
  const target = resolveTargetVersion(migrations, targetVersion);
  const selected = migrations.filter((migration) => migration.version <= target);
  const client = await connect(pool);

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await ensureMigrationTable(client);
    const applied = await readAppliedMigrations(client);
    validateAppliedMigrations(applied, selected, migrations);
    const appliedVersions = new Set(applied.map((migration) => migration.version));
    const newlyApplied = [];

    for (const migration of selected) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO omo_schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      );
      newlyApplied.push(migration.version);
    }

    await client.query("COMMIT");
    return {
      targetVersion: target,
      appliedVersions: selected.map((migration) => migration.version),
      newlyApplied
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.migrationCode) throw error;
    throw migrationError("migration_failed", "Database migration failed.");
  } finally {
    client.release();
  }
}

export async function getMigrationStatus(pool, {
  migrationsDirectory = defaultMigrationsDirectory
} = {}) {
  const migrations = await loadMigrations(migrationsDirectory);

  try {
    await pool.query("SELECT 1");
    const exists = await pool.query(
      `SELECT to_regclass('public.omo_schema_migrations') AS migration_table`
    );
    if (!exists.rows[0]?.migration_table) {
      return migrationStatus(false, "storage_migration_required", [], migrations);
    }
    const applied = await readAppliedMigrations(pool);
    try {
      validateAppliedMigrations(applied, migrations, migrations);
    } catch (error) {
      return migrationStatus(
        false,
        error.migrationCode === "migration_checksum_mismatch"
          ? "storage_migration_drift"
          : "storage_migration_unknown",
        applied,
        migrations
      );
    }
    const appliedVersions = new Set(applied.map((migration) => migration.version));
    const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
    if (pending.length) {
      return migrationStatus(false, "storage_migration_required", applied, pending);
    }
    return migrationStatus(true, "", applied, []);
  } catch {
    return migrationStatus(false, "storage_unavailable", [], migrations);
  }
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS omo_schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedMigrations(queryable) {
  const result = await queryable.query(
    `SELECT version, name, checksum, applied_at
     FROM omo_schema_migrations
     ORDER BY version`
  );
  return result.rows;
}

function validateAppliedMigrations(applied, selected, allMigrations) {
  const known = new Map(allMigrations.map((migration) => [migration.version, migration]));
  const selectedVersions = new Set(selected.map((migration) => migration.version));

  for (const migration of applied) {
    const expected = known.get(migration.version);
    if (!expected) {
      throw migrationError(
        "migration_unknown_version",
        `Database contains unknown migration ${migration.version}.`
      );
    }
    if (expected.checksum !== migration.checksum || expected.name !== migration.name) {
      throw migrationError(
        "migration_checksum_mismatch",
        `Migration ${migration.version} does not match its applied checksum.`
      );
    }
    if (!selectedVersions.has(migration.version)) {
      throw migrationError(
        "migration_target_behind",
        `Target is behind applied migration ${migration.version}.`
      );
    }
  }
}

function resolveTargetVersion(migrations, targetVersion) {
  if (!targetVersion) return migrations.at(-1).version;
  const normalized = String(targetVersion);
  if (!migrations.some((migration) => migration.version === normalized)) {
    throw migrationError("migration_target_invalid", `Unknown target: ${normalized}`);
  }
  return normalized;
}

async function connect(pool) {
  try {
    return await pool.connect();
  } catch {
    throw migrationError("storage_unavailable", "Database is unavailable.");
  }
}

function migrationStatus(ready, reason, applied, pending) {
  return {
    ready,
    driver: "postgres",
    durable: true,
    reason,
    appliedVersions: applied.map((migration) => migration.version),
    pendingVersions: pending.map((migration) => migration.version)
  };
}

function migrationError(migrationCode, message) {
  return Object.assign(new Error(message), {
    migrationCode,
    code: migrationCode,
    statusCode: 503,
    expose: true
  });
}
