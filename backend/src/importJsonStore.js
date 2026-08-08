import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getMigrationStatus } from "./migrations.js";
import { createPostgresPool, PostgresCardStore } from "./postgresStore.js";
import { databaseConfigValid, readRuntimeConfig } from "./runtimeConfig.js";

export async function importJsonCards({ filePath, store, dryRun = false }) {
  if (!filePath) throw importError("import_file_required", "缺少 JSON Store 路径。");
  let entries;
  try {
    entries = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw importError("import_file_invalid", "JSON Store 无法读取或解析。");
  }
  if (!Array.isArray(entries)) {
    throw importError("import_schema_invalid", "JSON Store 顶层必须是数组。");
  }

  let imported = 0;
  let existing = 0;
  for (const entry of entries) {
    const owner = String(entry?.owner || "");
    const card = entry?.card;
    if (!owner || !card?.id || typeof card !== "object") {
      throw importError("import_schema_invalid", "JSON Store 条目缺少 owner 或 card。");
    }
    const current = await store.get(owner, card.id);
    if (current) {
      existing += 1;
      continue;
    }
    if (!dryRun) await store.save(owner, card);
    imported += 1;
  }

  return {
    scanned: entries.length,
    imported,
    existing,
    dryRun
  };
}

const isCLI = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCLI) {
  const config = readRuntimeConfig();
  const filePath = argumentValue("--file") || config.storage.filePath;
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm-authorized-data");

  if (!config.database.configured || !databaseConfigValid(config.database)) {
    console.error(JSON.stringify({
      ok: false,
      code: config.database.configured ? "database_config_invalid" : "database_url_missing"
    }));
    process.exitCode = 1;
  } else if (!dryRun && !confirmed) {
    console.error(JSON.stringify({ ok: false, code: "import_authorization_required" }));
    process.exitCode = 1;
  } else {
    const pool = createPostgresPool(config.database);
    const store = new PostgresCardStore(pool);
    try {
      const status = await getMigrationStatus(pool);
      if (!status.ready) {
        throw importError(status.reason, "PostgreSQL migration 尚未就绪。");
      }
      const result = await importJsonCards({ filePath, store, dryRun });
      console.log(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        ok: false,
        code: error?.code || "import_failed"
      }));
      process.exitCode = 1;
    } finally {
      await store.close();
    }
  }
}

function argumentValue(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

function importError(code, message) {
  return Object.assign(new Error(message), {
    statusCode: 422,
    code,
    expose: true
  });
}
