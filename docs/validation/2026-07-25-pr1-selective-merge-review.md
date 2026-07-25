# PR #1 selective merge review

Review date: 2026-07-25

Pull request: [Improve full-screen screenshot source discovery](https://github.com/starvingarc/AdventureX-2026/pull/1)

Review target: `agent/v06-frontend-integration-server`

## PR facts

- Base commit: `83378937`
- Head commit: `d1c1ec20`
- Size: 8 commits, 50 changed files, 4787 additions, 220 deletions
- GitHub mergeability: not mergeable at review time
- The PR predates the current v0.6 recall ritual and touches screenshot OCR, search, ASR, cache, iOS flow, tests, and binary fixtures.

## Decision

Do not merge or cherry-pick the PR as a unit. No PR hunk is copied into the v0.6 integration branch.

The useful product capabilities described by the PR are already present in the current implementation through newer, tested paths. Copying their older implementation would add parallel code or overwrite the current recall interaction. The remaining changes either contradict frozen product decisions, are outside the frontend time box, or lack asset provenance.

## Feature triage

| PR area | Decision | Current evidence |
| --- | --- | --- |
| Apple Vision full-screen OCR | Reject | Product decision is visual-model-first. `backend/src/flow/vision.js` uses the configured Qwen vision model, with `qwen3.7-plus-2026-05-26` as the default. |
| Platform-aware search | Already present | `backend/src/flow/search.js` contains provider chaining and platform-aware fallbacks. |
| Bilibili title/creator recovery | Already present | Current search and source-discovery flow includes Bilibili creator fallback without adding a second iOS OCR path. |
| Subtitle language preference | Already present | `backend/src/media/platformSubtitles.js` prefers Chinese and source-language tracks before English. |
| Qwen ASR automatic language handling | Already present | `backend/src/media/qwenFileTranscriptionProvider.js` delegates language handling to the configured Qwen provider. |
| Local Whisper persistent worker | Defer | Potential backend optimization, but not required for the current frontend interaction iteration. It needs isolated latency and process-lifecycle evidence before adoption. |
| Screenshot upload and async image-flow result | Already present | `APIClient.analyzeScreenshot`, `/api/sources/image-flow`, job polling, and V2 screenshot states are wired in the current tree. |
| PR-era iOS result UI | Reject | It is based on the pre-v0.6 flow and would conflict with the one-card recall, scratch reveal, feedback, and checkpoint states. |
| Binary screenshot fixtures | Reject pending provenance | Real screenshots cannot enter the repository without authorization, redaction, and `docs/asset-provenance.md` registration. |
| Three-card or chapter-style result presentation | Reject for v0.6 | The current contract intentionally selects one primary memory point per source. |

## Qoder review

Qoder ran in Agent mode with extreme reasoning and inspected the current integration tree read-only through `bridge-amax`. Its independent conclusion matched the primary review:

- direct merge would revert the newer recall ritual;
- search, ASR, screenshot ingestion, and result handling already exist;
- Apple Vision OCR conflicts with the visual-model-first decision;
- new image assets require provenance before adoption.

Qoder could not fetch the private PR diff from the server because no GitHub credential is installed there, so line-level PR facts were supplied by the authenticated primary review. Qoder made no file changes.

## Kimi review status

Kimi was assigned a parallel read-only review through the desktop app. It reached the same private-PR access boundary and requested a command that would create a local temporary file. That command was not approved because all project access and execution are restricted to `bridge-amax`. The integration did not wait for or rely on an unverified Kimi conclusion.

## Accepted value

No old implementation was accepted, because the useful behavior is already implemented in the current tree. The review preserves these capabilities as explicit merge requirements:

- visual-model-first screenshot analysis;
- platform-aware link discovery with Bilibili fallback;
- Chinese/source subtitle preference and ASR fallback;
- async screenshot analysis and a single evidence-bound memory card;
- v0.6 recall ritual and asset provenance gate.

## Follow-up

- Close or park PR #1 after the author confirms there is no unlisted behavior to preserve.
- Evaluate a persistent local Whisper worker only as a separate backend performance change with benchmark evidence.
- If any PR image is still desired, add authorization, redaction status, source, processing steps, use location, and checksum before importing it.

## Verification baseline

The final integration must keep the backend suite, iOS static guards, browser interaction regression, and `git diff --check` green on `bridge-amax` before `main` is updated.
