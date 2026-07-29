import { createPostgresPool } from "./postgresStore.js";
import { getMigrationStatus, runMigrations } from "./migrations.js";
import { databaseConfigValid, readRuntimeConfig } from "./runtimeConfig.js";

const config = readRuntimeConfig();
const checkOnly = process.argv.includes("--check");

if (!config.database.configured || !databaseConfigValid(config.database)) {
  console.error(JSON.stringify({
    ok: false,
    code: config.database.configured ? "database_config_invalid" : "database_url_missing"
  }));
  process.exitCode = 1;
} else {
  const pool = createPostgresPool(config.database);
  try {
    if (checkOnly) {
      const status = await getMigrationStatus(pool);
      console.log(JSON.stringify(status));
      if (!status.ready) process.exitCode = 1;
    } else {
      const result = await runMigrations(pool);
      console.log(JSON.stringify({
        ok: true,
        targetVersion: result.targetVersion,
        newlyApplied: result.newlyApplied
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error?.migrationCode || "migration_failed"
    }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
