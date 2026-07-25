#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanTextForSecrets } from "./secret-scan.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const expectedBaseUrl = args["base-url"] || "https://shibei-production.up.railway.app";
const checks = [];

if (args.help) {
  printUsage();
  process.exit(0);
}

const inputsPath = args.inputs ? resolveFromRepo(args.inputs) : "";
checks.push(check(
  "inputs_argument_present",
  Boolean(inputsPath),
  "pass --inputs path/to/completed-deployment-inputs.md"
));
checks.push(check(
  "inputs_file_exists",
  Boolean(inputsPath) && existsSync(inputsPath),
  inputsPath ? `${inputsPath} must exist` : "no inputs file provided"
));

let markdown = "";
if (inputsPath && existsSync(inputsPath)) {
  markdown = readFileSync(inputsPath, "utf8");
  checks.push(check(
    "not_template_file",
    !/deploy-inputs\.template\.md$/i.test(inputsPath) && !/deployment-inputs\.template\.md$/i.test(inputsPath),
    "copy the template to a dated completed note before running this guard"
  ));
  checks.push(check(
    "title_present",
    markdown.includes("# V2 Production Deploy Inputs"),
    "inputs file must use the V2 production deploy inputs template"
  ));
  checkRequiredFields(markdown);
  checkDataStrategy(markdown);
  checkRequiredSecretPresence(markdown);
  checkSafety(markdown);
}

console.log("# Recallo V2 Production Deploy Inputs Guard");
console.log(`baseUrl=${expectedBaseUrl}`);
console.log("");
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name} - ${item.detail}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error("");
  console.error(`Production deploy inputs guard failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

function checkRequiredFields(text) {
  const required = [
    ["PR", "candidate_pr"],
    ["Candidate commit", "candidate_commit"],
    ["`V2 Production Readiness` run URL", "readiness_run_url"],
    ["Operator", "operator"],
    ["Date/time", "date_time"],
    ["Production base URL", "production_base_url"],
    ["Railway project", "railway_project"],
    ["Railway environment", "railway_environment"],
    ["Railway service name", "railway_service_name"],
    ["Railway service id", "railway_service_id"],
    ["Connected branch", "connected_branch"],
    ["Autodeploy state", "autodeploy_state"],
    ["Current production deployment id", "current_production_deployment_id"],
    ["Video config source", "video_config_source"],
    ["Video runtime strategy", "video_runtime_strategy"],
    ["Video ASR provider", "video_asr_provider"],
    ["Video visual provider", "video_visual_provider"],
    ["Video max duration seconds", "video_max_duration_seconds"],
    ["Rollback method", "rollback_method"],
    ["Rollback command or console path", "rollback_command_or_console_path"],
    ["Rollback owner", "rollback_owner"],
    ["Data strategy", "data_strategy"],
    ["Old production data status", "old_production_data_status"],
    ["Old data export reference", "old_data_export_reference"],
    ["Old data export created/verified at", "old_data_export_created_verified_at"],
    ["First deploy should use smoke after gate", "first_deploy_smoke_after_gate"],
    ["Reason to proceed", "reason_to_proceed"],
    ["Known risks", "known_risks"]
  ];

  for (const [label, name] of required) {
    checks.push(check(
      `field_${name}`,
      hasFilledMarkdownField(text, label),
      `${label} must be filled`
    ));
  }

  checks.push(check(
    "production_base_url_expected",
    getMarkdownField(text, "Production base URL") === expectedBaseUrl,
    `Production base URL must be ${expectedBaseUrl}`
  ));
  checks.push(check(
    "confirmation_phrase",
    getMarkdownField(text, "Confirmation phrase for workflow") === "deploy-v2-production",
    "Confirmation phrase for workflow must be deploy-v2-production"
  ));
  checks.push(check(
    "rollback_confirmation_phrase",
    getMarkdownField(text, "Rollback confirmation phrase for workflow") === "rollback-ready",
    "Rollback confirmation phrase for workflow must be rollback-ready"
  ));
  checks.push(check(
    "first_deploy_smoke_disabled",
    /^no$/i.test(getMarkdownField(text, "First deploy should use smoke after gate")),
    "first deploy must keep smoke disabled until readiness gate passes"
  ));
}

function checkDataStrategy(text) {
  const strategy = getMarkdownField(text, "Data strategy");
  checks.push(check(
    "data_strategy_allowed",
    ["preserve-data", "reset-data"].includes(strategy),
    "Data strategy must be preserve-data or reset-data"
  ));

  if (strategy === "reset-data") {
    checks.push(check(
      "data_reset_confirmation",
      getMarkdownField(text, "Data reset confirmation") === "reset-old-test-data",
      "reset-data requires Data reset confirmation: reset-old-test-data"
    ));
    checks.push(check(
      "old_data_status_test_only",
      /^test data only$/i.test(getMarkdownField(text, "Old production data status")),
      "reset-data requires Old production data status: test data only"
    ));
    for (const label of [
      "Backup/snapshot reference",
      "Backup created/verified at",
      "Restore method",
      "Restore owner",
      "Restore rehearsal status"
    ]) {
      checks.push(check(
        `preserve_data_${slug(label)}_not_required`,
        true,
        `${label} is not required for reset-data because old test data may be cleared`
      ));
    }
    return;
  }

  for (const [label, name] of [
    ["Backup/snapshot reference", "backup_snapshot_reference"],
    ["Backup created/verified at", "backup_created_verified_at"],
    ["Restore method", "restore_method"],
    ["Restore owner", "restore_owner"],
    ["Restore rehearsal status", "restore_rehearsal_status"]
  ]) {
    checks.push(check(
      `field_${name}`,
      hasFilledMarkdownField(text, label),
      `${label} must be filled for preserve-data`
    ));
  }
}

function checkRequiredSecretPresence(text) {
  const secretLabels = [
    "`RAILWAY_TOKEN`",
    "`DATABASE_URL`",
    "`DEEPSEEK_API_KEY` or `OPENAI_API_KEY`",
    "`AI_PROVIDER`",
    "model env (`DEEPSEEK_MODEL` or `OPENAI_MODEL`)",
    "APNS env set for production bundle",
    "`TIKHUB_API_KEY` when video enabled",
    "`QWEN_API_KEY` or `DASHSCOPE_API_KEY` when visual enabled"
  ];
  for (const label of secretLabels) {
    checks.push(check(
      `secret_presence_${slug(label)}`,
      /^yes$/i.test(getMarkdownField(text, label)),
      `${label} must be marked yes without recording the value`
    ));
  }
}

function checkSafety(text) {
  const detectedTypes = new Set(
    scanTextForSecrets(text, { path: "deployment-inputs", source: "guard" })
      .map((finding) => finding.type)
  );
  const scannerChecks = [
    ["qwen_dotted_api_key", "dotted Qwen or DashScope API key-looking value"],
    ["model_api_key", "model API key-looking value"],
    ["tikhub_base64_assignment", "TikHub API key assignment"],
    ["database_url", "database URL"],
    ["github_token", "GitHub token"],
    ["aws_access_key_id", "AWS access key id"],
    ["private_key_block", "private key block"]
  ];

  for (const [type, label] of scannerChecks) {
    checks.push(check(
      `no_${slug(type)}`,
      !detectedTypes.has(type),
      `inputs file must not contain ${label}`
    ));
  }

  const additionalPatterns = [
    [/RAILWAY(?:_API)?_TOKEN\s*=\s*\S+/i, "Railway token assignment"],
    [/APNS_PRIVATE_KEY(?:_BASE64)?\s*[:=]\s*\S+/i, "APNS private key value"]
  ];

  for (const [pattern, label] of additionalPatterns) {
    checks.push(check(
      `no_${slug(label)}`,
      !pattern.test(text),
      `inputs file must not contain ${label}`
    ));
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "1";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function printUsage() {
  console.log([
    "Usage:",
    "  npm run check:production-deploy-inputs -- \\",
    "    --inputs docs/production-readiness-evidence/YYYYMMDD-deployment-inputs.md",
    "",
    "This preflight guard is for the human deployment handoff before running the Railway deploy workflow.",
    "It checks that Railway target, rollback point, data strategy, and secret-presence fields are filled without storing secret values.",
    "Data strategy may be preserve-data or reset-data. reset-data still requires an old data export reference and explicit reset-old-test-data confirmation.",
    "It does not replace the final release evidence guard."
  ].join("\n"));
}

function resolveFromRepo(path) {
  return resolve(repoRoot, path);
}

function getMarkdownField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^-[ \\t]+${escaped}:[ \\t]*(.*)$`, "im"));
  if (!match) return "";
  return match[1].trim().replace(/^`([^`]+)`$/, "$1").trim();
}

function hasFilledMarkdownField(markdown, label) {
  const value = getMarkdownField(markdown, label);
  return Boolean(value) && !/^(n\/a|none|null|todo|unknown|pending|yes\/no|-+)$/i.test(value);
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}
