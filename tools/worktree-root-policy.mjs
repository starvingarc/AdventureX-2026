import { basename, normalize } from "node:path";

export const CANONICAL_LOCAL_ROOT_BASENAME = "拾贝-prod-hardening";
export const APPROVED_BRIDGE_WORKTREE_SUFFIXES = Object.freeze([
  "frontend",
  "integration",
  "kimi",
  "qoder",
  "security",
  "persistence",
  "ios-contract"
]);

const bridgeSuffixExpression = APPROVED_BRIDGE_WORKTREE_SUFFIXES.join("|");
const approvedBridgeRootPattern = new RegExp(
  `^/data1/yuxiao/recallo-v[0-9]+-(?:${bridgeSuffixExpression})$`
);

export function classifyRecallWorktreeRoot(candidateRoot) {
  const normalizedRoot = normalize(String(candidateRoot || ""));
  if (basename(normalizedRoot) === CANONICAL_LOCAL_ROOT_BASENAME) {
    return { allowed: true, kind: "canonical_local", normalizedRoot };
  }
  if (approvedBridgeRootPattern.test(normalizedRoot)) {
    return { allowed: true, kind: "bridge_amax_isolated", normalizedRoot };
  }
  return { allowed: false, kind: "unapproved", normalizedRoot };
}

export function isAllowedRecallWorktreeRoot(candidateRoot) {
  return classifyRecallWorktreeRoot(candidateRoot).allowed;
}

export function approvedRootDescription() {
  return [
    `basename=${CANONICAL_LOCAL_ROOT_BASENAME}`,
    `/data1/yuxiao/recallo-v<digits>-<approved-suffix>`,
    `approvedSuffixes=${APPROVED_BRIDGE_WORKTREE_SUFFIXES.join(",")}`
  ].join(" or ");
}
