import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_SYNTAX_SCOPES = ["src", "scripts", "test-fixtures"];
const JAVASCRIPT_FILE = /\.(?:cjs|mjs|js)$/;
const JAVASCRIPT_TEST_FILE = /\.test\.(?:cjs|mjs|js)$/;

export async function discoverSourcePlan({
  root = backendRoot,
  scope = "src",
  syntaxScopes = null
} = {}) {
  const stableRoot = resolve(root);
  const testScope = resolveSourceScope(stableRoot, scope);
  const requestedSyntaxScopes = syntaxScopes || (
    testScope.normalized === "src" ? DEFAULT_SYNTAX_SCOPES : [testScope.normalized]
  );
  const resolvedSyntaxScopes = requestedSyntaxScopes.map((item) => (
    resolveSourceScope(stableRoot, item)
  ));
  const jsFiles = [...new Set((await Promise.all(
    resolvedSyntaxScopes.map((item) => collectJavaScriptFiles(item.path))
  )).flat())].sort((left, right) => left.localeCompare(right));
  const testFiles = jsFiles.filter((filePath) => (
    isWithin(testScope.path, filePath) && JAVASCRIPT_TEST_FILE.test(filePath)
  ));
  return {
    root: stableRoot,
    scope: testScope.normalized,
    syntaxScopes: resolvedSyntaxScopes.map((item) => item.normalized),
    jsFiles,
    testFiles
  };
}

export async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...await collectJavaScriptFiles(fullPath));
    } else if (entry.isFile() && JAVASCRIPT_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function runSourceChecks({
  root = backendRoot,
  scope = "src",
  testsOnly = false,
  listTests = false
} = {}) {
  const plan = await discoverSourcePlan({ root, scope });
  const relativeJsFiles = plan.jsFiles.map((filePath) => relative(plan.root, filePath));
  const relativeTestFiles = plan.testFiles.map((filePath) => relative(plan.root, filePath));
  console.log(
    `# Recallo backend source check scope=${plan.scope}`
    + ` syntax=${plan.syntaxScopes.join(",")} js=${plan.jsFiles.length}`
    + ` tests=${plan.testFiles.length}`
  );

  if (listTests) {
    for (const filePath of relativeTestFiles) console.log(normalizePath(filePath));
    return plan;
  }
  if (!testsOnly) {
    for (const filePath of relativeJsFiles) runNode(["--check", filePath], plan.root);
  }
  if (relativeTestFiles.length > 0) runNode(["--test", ...relativeTestFiles], plan.root);
  return plan;
}

function resolveSourceScope(stableRoot, scope) {
  const scopeRoot = resolve(stableRoot, scope);
  const relativeScope = relative(stableRoot, scopeRoot);
  const normalizedScope = normalizePath(relativeScope);
  if (
    !relativeScope
    || relativeScope === ".."
    || relativeScope.startsWith(`..${separatorFor(relativeScope)}`)
    || isAbsolute(relativeScope)
  ) {
    throw new Error(`Backend check scope must stay inside backend root: ${scope}`);
  }
  return { path: scopeRoot, normalized: normalizedScope };
}

function isWithin(directory, filePath) {
  const relativePath = relative(directory, filePath);
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${separatorFor(relativePath)}`)
    && !isAbsolute(relativePath);
}

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function parseArgs(argv) {
  const parsed = { scope: "src", testsOnly: false, listTests: false };
  for (const item of argv) {
    if (item === "--tests-only") parsed.testsOnly = true;
    else if (item === "--list-tests") parsed.listTests = true;
    else if (item.startsWith("--scope=")) parsed.scope = item.slice("--scope=".length);
    else throw new Error(`Unknown source check argument: ${item}`);
  }
  return parsed;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function separatorFor(value) {
  return String(value).includes("\\") ? "\\" : "/";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSourceChecks(parseArgs(process.argv.slice(2)));
}
