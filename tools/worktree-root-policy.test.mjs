import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRecallWorktreeRoot,
  isAllowedRecallWorktreeRoot
} from "./worktree-root-policy.mjs";

test("preserves the canonical local basename contract", () => {
  const result = classifyRecallWorktreeRoot(
    "/Users/hanmingyu/Downloads/拾贝-prod-hardening"
  );
  assert.equal(result.allowed, true);
  assert.equal(result.kind, "canonical_local");
  assert.equal(isAllowedRecallWorktreeRoot("/tmp/拾贝-prod-hardening"), true);
});

test("allows only approved versioned bridge-amax worktree suffixes", () => {
  for (const root of [
    "/data1/yuxiao/recallo-v062-frontend",
    "/data1/yuxiao/recallo-v062-integration",
    "/data1/yuxiao/recallo-v063-kimi",
    "/data1/yuxiao/recallo-v063-qoder",
    "/data1/yuxiao/recallo-v063-security",
    "/data1/yuxiao/recallo-v063-persistence",
    "/data1/yuxiao/recallo-v063-ios-contract"
  ]) {
    const result = classifyRecallWorktreeRoot(root);
    assert.equal(result.allowed, true, root);
    assert.equal(result.kind, "bridge_amax_isolated", root);
  }
});

test("rejects arbitrary data1 paths and near-match bypasses", () => {
  for (const root of [
    "/data1/yuxiao/recallo-v063-evil",
    "/data1/yuxiao/recallo-v063-security-extra",
    "/data1/yuxiao/recallo-v063-persistence-copy",
    "/data1/yuxiao/recallo-v063-ios-contract-extra",
    "/data1/yuxiao/recallo-v063-ios_contract",
    "/data1/yuxiao/recallo-v063-security/child",
    "/data1/yuxiao/recallo-vx-security",
    "/data1/yuxiao/random-project",
    "/data1/other/recallo-v063-security",
    "/tmp/recallo-v063-security"
  ]) {
    assert.equal(isAllowedRecallWorktreeRoot(root), false, root);
  }
});
