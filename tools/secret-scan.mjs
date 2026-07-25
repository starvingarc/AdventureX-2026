#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_TEXT_BYTES = 5_000_000;

const SECRET_PATTERNS = [
  {
    type: "qwen_dotted_api_key",
    expression: /\bsk-ws-[A-Za-z0-9._-]{12,}\b/gi,
    capture: 0
  },
  {
    type: "model_api_key",
    expression: /\bsk-(?!ws-)[A-Za-z0-9._-]{20,}\b/gi,
    capture: 0
  },
  {
    type: "tikhub_base64_assignment",
    expression: /\bTIKHUB(?:[\s_-]+API)(?:[\s_-]+KEY)?\s*[:=]\s*["']?([A-Za-z0-9+/_-]{32,}={0,2})/gi,
    capture: 1
  },
  {
    type: "database_url",
    expression: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s"'`<>]+/gi,
    capture: 0
  },
  {
    type: "github_token",
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    capture: 0
  },
  {
    type: "aws_access_key_id",
    expression: /\bAKIA[0-9A-Z]{16}\b/g,
    capture: 0
  },
  {
    type: "private_key_block",
    expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    capture: 0
  }
];

export function scanTextForSecrets(text, { path = "<text>", source = "text" } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const pattern of SECRET_PATTERNS) {
      const expression = new RegExp(pattern.expression.source, pattern.expression.flags);
      for (const match of line.matchAll(expression)) {
        const value = match[pattern.capture];
        if (!value) continue;
        findings.push({
          path,
          line: lineIndex + 1,
          source,
          type: pattern.type,
          masked: maskSecret(value),
          fingerprint: fingerprint(value),
          length: value.length
        });
      }
    }
  }

  return findings;
}

export function collectCurrentInputs(cwd = process.cwd()) {
  const inputs = [];
  const trackedPaths = gitNullList(["ls-files", "-z"], cwd);

  for (const path of trackedPaths) {
    const absolutePath = resolve(cwd, path);
    if (!existsSync(absolutePath)) continue;
    const content = readFileSync(absolutePath);
    if (content.length > MAX_TEXT_BYTES) {
      if (!content.includes(0)) {
        inputs.push(unscannedInput(path, "worktree", content.length, "max_text_bytes_exceeded"));
      }
      continue;
    }
    if (content.includes(0)) continue;
    inputs.push({ path, source: "worktree", text: content.toString("utf8") });
  }

  const stagedPaths = gitNullList([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z"
  ], cwd);

  for (const path of stagedPaths) {
    const stagedSize = gitBlobSize(path, cwd);
    if (stagedSize > MAX_TEXT_BYTES) {
      inputs.push(unscannedInput(path, "index", stagedSize, "max_text_bytes_exceeded"));
      continue;
    }
    let content;
    try {
      content = execFileSync("git", ["show", `:${path}`], {
        cwd,
        encoding: "buffer",
        maxBuffer: MAX_TEXT_BYTES + 1024
      });
    } catch {
      inputs.push(unscannedInput(path, "index", stagedSize, "index_content_unreadable"));
      continue;
    }
    if (content.includes(0)) continue;
    inputs.push({ path, source: "index", text: content.toString("utf8") });
  }

  return inputs;
}

export function scanInputs(inputs) {
  const deduped = new Map();

  for (const input of inputs) {
    const inputFindings = input.unscannedReason
      ? [unscannedFinding(input)]
      : scanTextForSecrets(input.text, input);
    for (const finding of inputFindings) {
      const key = [finding.path, finding.line, finding.type, finding.fingerprint].join("|");
      const existing = deduped.get(key);
      if (existing) {
        existing.sources.add(finding.source);
      } else {
        deduped.set(key, { ...finding, sources: new Set([finding.source]) });
      }
    }
  }

  return [...deduped.values()]
    .map((finding) => ({
      ...finding,
      source: [...finding.sources].sort().join(","),
      sources: undefined
    }))
    .sort(compareFindings);
}

export function collectHistoryFindings(cwd = process.cwd()) {
  const output = execFileSync("git", [
    "log",
    "--all",
    "--full-history",
    "--format=__RECALLO_COMMIT__%H",
    "--patch",
    "--no-color",
    "--no-ext-diff",
    "--find-renames"
  ], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024
  });

  let commit = "";
  let path = "<history>";
  const findings = [];

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("__RECALLO_COMMIT__")) {
      commit = line.slice("__RECALLO_COMMIT__".length);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      path = line.slice(6);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;

    for (const finding of scanTextForSecrets(line.slice(1), {
      path,
      source: `commit:${commit.slice(0, 12)}`
    })) {
      findings.push({ ...finding, line: 0 });
    }
  }

  const deduped = new Map();
  for (const finding of findings) {
    const key = [finding.path, finding.type, finding.fingerprint, finding.source].join("|");
    if (!deduped.has(key)) deduped.set(key, finding);
  }
  return [...deduped.values()].sort(compareFindings);
}

export function formatFinding(finding) {
  const location = finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
  return [
    location,
    `type=${finding.type}`,
    `source=${finding.source}`,
    `masked=${finding.masked}`,
    `sha256=${finding.fingerprint}`,
    `len=${finding.length}`,
    ...(finding.reason ? [`reason=${finding.reason}`] : [])
  ].join(" | ");
}

export function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function maskSecret(value) {
  if (value.length <= 8) return `${value.slice(0, 1)}…${value.slice(-1)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function gitNullList(args, cwd) {
  const output = execFileSync("git", args, { cwd, encoding: "buffer" });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function gitBlobSize(path, cwd) {
  try {
    const value = execFileSync("git", ["cat-file", "-s", `:${path}`], {
      cwd,
      encoding: "utf8"
    }).trim();
    const size = Number(value);
    return Number.isFinite(size) && size >= 0 ? size : -1;
  } catch {
    return -1;
  }
}

function unscannedInput(path, source, length, unscannedReason) {
  return { path, source, length, unscannedReason };
}

function unscannedFinding(input) {
  const reason = String(input.unscannedReason || "content_unscanned");
  const length = Number.isFinite(Number(input.length)) ? Number(input.length) : -1;
  return {
    path: input.path,
    line: 0,
    source: input.source,
    type: "unscanned_text_input",
    masked: "not-scanned",
    fingerprint: fingerprint([input.path, input.source, length, reason].join(":")),
    length,
    reason
  };
}

function compareFindings(left, right) {
  return left.path.localeCompare(right.path)
    || left.line - right.line
    || left.type.localeCompare(right.type)
    || left.fingerprint.localeCompare(right.fingerprint);
}

function parseMode(argv) {
  if (argv.includes("--history")) return "history";
  if (argv.includes("--current")) return "current";
  if (argv.includes("--help")) return "help";
  return "current";
}

function runCli() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "help") {
    console.log([
      "Usage:",
      "  node tools/secret-scan.mjs --current",
      "  node tools/secret-scan.mjs --history",
      "",
      "The current scan covers tracked worktree files plus staged index content.",
      "The history scan is explicit and is not part of normal commit/push gates.",
      `Text inputs larger than ${MAX_TEXT_BYTES} bytes fail closed as auditable findings.`,
      "Findings only print masked values and SHA-256 fingerprints."
    ].join("\n"));
    return;
  }

  const findings = mode === "history"
    ? collectHistoryFindings()
    : scanInputs(collectCurrentInputs());

  console.log("# Recallo Secret Scan");
  console.log(`mode=${mode}`);
  console.log(`findings=${findings.length}`);
  for (const finding of findings) console.log(`FAIL ${formatFinding(finding)}`);

  if (findings.length > 0) {
    console.error("Secret scan failed. Resolve secret findings or explicitly blocked inputs before continuing.");
    process.exitCode = 1;
  } else {
    console.log("PASS no secret-shaped values found");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) runCli();
