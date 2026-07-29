import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "omo-postgres-"));
const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = join(root, "data");
const socketDirectory = join(root, "socket");
const backupFile = join(root, "omo.backup");
const port = await availablePort();
const database = `omo_test_${process.pid}`;
const restoredDatabase = `${database}_restore`;
const connectionURL = `postgresql://postgres@127.0.0.1:${port}/${database}`;
let started = false;

mkdirSync(socketDirectory);

try {
  run("initdb", [
    "--pgdata", dataDirectory,
    "--username", "postgres",
    "--auth", "trust",
    "--no-locale",
    "--encoding", "UTF8"
  ]);
  run("pg_ctl", [
    "--pgdata", dataDirectory,
    "--options", `-h 127.0.0.1 -p ${port} -k ${socketDirectory}`,
    "--wait",
    "start"
  ]);
  started = true;
  run("createdb", ["--host", "127.0.0.1", "--port", String(port), "--username", "postgres", database]);

  run(process.execPath, ["--test", "test/postgres.integration.test.js"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      TEST_DATABASE_URL: connectionURL,
      OMO_ALLOW_TEST_DATABASE_RESET: "1"
    }
  });
  run(process.execPath, ["src/migrate.js", "--check"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: connectionURL
    }
  });
  run(process.execPath, ["src/migrate.js"], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: connectionURL
    }
  });

  run("pg_dump", [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--username", "postgres",
    "--format", "custom",
    "--file", backupFile,
    database
  ]);
  run("createdb", [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--username", "postgres",
    restoredDatabase
  ]);
  run("pg_restore", [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--username", "postgres",
    "--dbname", restoredDatabase,
    backupFile
  ]);
  const restored = capture("psql", [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--username", "postgres",
    "--dbname", restoredDatabase,
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT card->>'answer' FROM omo_memory_cards WHERE owner_id = 'recovery-owner' AND card_id = 'recovery-card'"
  ]);
  if (restored.trim() !== "合成答案") {
    throw new Error("Synthetic backup/restore readback failed.");
  }
  console.log("PostgreSQL migration, persistence, concurrency and recovery checks passed.");
} finally {
  if (started) {
    run("pg_ctl", ["--pgdata", dataDirectory, "--mode", "fast", "--wait", "stop"], {
      allowFailure: true
    });
  }
  rmSync(root, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    stdio: options.allowFailure ? "pipe" : "inherit"
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}.`);
  }
  return result.stdout;
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
