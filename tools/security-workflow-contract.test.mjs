import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dbExportWorkflow = readFileSync(
  new URL("../.github/workflows/v2-production-db-export.yml", import.meta.url),
  "utf8"
);
const deployGuard = readFileSync(
  new URL("./production-deploy-inputs-guard.mjs", import.meta.url),
  "utf8"
);

test("database export requires a repository encryption secret", () => {
  assert.match(
    dbExportWorkflow,
    /BACKUP_ENCRYPTION_PASSPHRASE: \$\{\{ secrets\.PRODUCTION_DB_EXPORT_PASSPHRASE \}\}/
  );
  assert.match(dbExportWorkflow, /\$\{#BACKUP_ENCRYPTION_PASSPHRASE\}.*-lt 24/);
});

test("provider and encryption secrets are scoped to the steps that use them", () => {
  const jobHeader = dbExportWorkflow.slice(
    dbExportWorkflow.indexOf("jobs:"),
    dbExportWorkflow.indexOf("    steps:")
  );
  assert.doesNotMatch(jobHeader, /RAILWAY_API_TOKEN/);
  assert.doesNotMatch(jobHeader, /BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.match(dbExportWorkflow, /id: database_url[\s\S]*value=\$database_url.*GITHUB_OUTPUT/);
  assert.doesNotMatch(dbExportWorkflow, /DATABASE_URL<<EOF/);
});

test("database export encrypts before removing plaintext", () => {
  assert.match(dbExportWorkflow, /openssl enc[\s\S]*-aes-256-cbc[\s\S]*-pbkdf2[\s\S]*-iter 200000[\s\S]*-md sha256/);
  assert.match(dbExportWorkflow, /-pass env:BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.match(dbExportWorkflow, /rm -f "\$backup_file"/);
  assert.match(dbExportWorkflow, /if \[ -e "\$backup_file" \]/);
});

test("database export uploads only encrypted dump artifacts", () => {
  const uploadStep = dbExportWorkflow.slice(
    dbExportWorkflow.indexOf("- name: Upload database export artifact")
  );
  assert.match(uploadStep, /path: production-db-export\/\*\.dump\.enc/);
  assert.doesNotMatch(uploadStep, /path: production-db-export\/\s*$/m);
});

test("production deploy input guard delegates key detection to the shared scanner", () => {
  assert.match(deployGuard, /import \{ scanTextForSecrets \} from "\.\/secret-scan\.mjs"/);
  assert.match(deployGuard, /scanTextForSecrets\(text/);
  assert.match(deployGuard, /qwen_dotted_api_key/);
  assert.match(deployGuard, /tikhub_base64_assignment/);
  assert.match(deployGuard, /database_url/);
});
