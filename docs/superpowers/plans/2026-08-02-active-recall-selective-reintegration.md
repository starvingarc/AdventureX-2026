# Active Recall Selective Reintegration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the approved Omo Figma home and active-recall interaction on top of `omo/main@cb23265` without losing the team's runtime safety, Profile, persistence, tests, or collaboration work.

**Architecture:** Keep the current backend routes, `runtimeConfig`, store, `OmoStore`, and `APIClient` as the system boundaries. Extend the card contract with a validated `hiddenSemantic`, then compose the restored home from focused SwiftUI views whose pure round state is independently tested. Integrate existing Library, Profile, Settings, and photo upload as sheets or side-menu destinations so the home remains the single recall scene.

**Tech Stack:** Swift 5 / SwiftUI / XCTest / iOS Simulator, Node.js ESM / `node:test`, Xcode project, GitHub CLI.

---

## File map

### Backend

- Modify `backend/src/cardService.js`: generate, validate, repair, and persist `hiddenSemantic` while continuing to consume `runtimeConfig`.
- Modify `backend/test/cardService.test.js`: cover exact-substring validation, one repair, second failure, Fixture, screenshot-only rarity, and existing error privacy.
- Modify `backend/test/server.test.js`: assert the new field survives the HTTP route and invalid model output remains a sanitized 502.

### iOS model and state

- Modify `Omo/Omo/Models/OmoModels.swift`: optional decoding, exact segmentation, and recall eligibility.
- Modify `Omo/Omo/OmoStore.swift`: filter the draw pool to due and eligible cards and support a frozen maximum-ten-card round.
- Modify `Omo/OmoTests/APIClientDecodingTests.swift`: old-card and new-card decoding compatibility.
- Create `Omo/Omo/RecallInteractionState.swift`: pure reveal, submission, retry, and slider node rules.
- Create `Omo/OmoTests/RecallInteractionStateTests.swift`: boundary and transition tests.

### iOS visual interaction

- Create `Omo/Omo/RecallDesign.swift`: restored palette, typography, sizing, and fixed slider-gradient tokens.
- Create `Omo/Omo/RecallHomeView.swift`: Figma home, persistent folder/upload controls, summon state, and routing callbacks.
- Create `Omo/Omo/RecallRoundView.swift`: frozen four-layer deck and card-to-card orchestration.
- Create `Omo/Omo/RecallKnowledgeCardView.swift`: inline semantic masking, 80% reveal, details Sheet, and accessibility boundary.
- Create `Omo/Omo/RecallRatingSlider.swift`: four positions, fixed full-track gradient, haptics, cancel, submit, and retry.
- Modify `Omo/Omo/ContentView.swift`: replace the competing bottom-tab recall flow with the restored home and side-menu routing while retaining current Library/upload views and `ProfileView`.
- Modify `Omo/Omo.xcodeproj/project.pbxproj`: add the new Swift sources and tests to their targets if the project does not auto-discover them.
- Restore the `FirstLaunchArrow`, `FirstLaunchFolder`, `FirstLaunchMenu`, `FirstLaunchPanel`, and `FirstLaunchUpload` asset sets from `009e943` under `Omo/Omo/Assets.xcassets/`.

### Documentation and evidence

- Modify `docs/ios-api-data-contract-zh.md`: document `hiddenSemantic`, compatibility, and generation failure semantics.
- Modify `docs/frontend/v2-frontend-architecture.md`: document the home-scene composition and focused recall views.
- Modify `docs/frontend/v2-layout-system.md`: document the exact slider/reveal visual contract.
- Create `artifacts/active-recall-reintegration/README.md`: index Simulator screenshots and validation commands without committing user data.

## Task 1: Restore the backend hidden-semantic contract

**Files:**
- Modify: `backend/test/cardService.test.js`
- Modify: `backend/src/cardService.js`
- Test: `backend/test/cardService.test.js`

- [ ] **Step 1: Add failing contract tests**

Add a `generated()` fixture whose `coreKnowledge` contains `hiddenSemantic`, then assert:

```js
assert.equal(card.hiddenSemantic, "认知卸载");
assert.equal(card.answer, card.hiddenSemantic);
assert.ok(card.coreKnowledge.includes(card.hiddenSemantic));
```

Add a fetch stub that returns an invalid first result and valid second result. Assert two Qwen requests were made and the second prompt contains the validation error. Add a second-invalid test that expects `statusCode === 502`, `code === "model_invalid_response"`, and no source verification call.

- [ ] **Step 2: Verify the new tests fail for the intended reason**

Run:

```bash
npm --prefix backend test -- --test-name-pattern='hidden semantic|repairs one invalid'
```

Expected: failures because the current card has no `hiddenSemantic` and does not retry invalid output.

- [ ] **Step 3: Implement validation and one repair through current runtime configuration**

Export an exact validator:

```js
export function hasValidHiddenSemantic(value) {
  const coreKnowledge = text(value?.coreKnowledge);
  const hiddenSemantic = text(value?.hiddenSemantic);
  return hiddenSemantic.length > 0 && coreKnowledge.includes(hiddenSemantic);
}
```

Change Qwen generation to accept a `mode`, include `hiddenSemantic` in the schema prompt, and on the first invalid candidate make exactly one additional request using the same image plus a sanitized validation reason. Keep `config.qwen.baseURL`, API key, model, timeout, stable network error mapping, and `AbortSignal.timeout` from the current implementation.

After the second invalid candidate, throw:

```js
throw httpError(
  502,
  "model_invalid_response",
  "视觉模型返回的承重语义无法验证。"
);
```

Construct the returned card with:

```js
hiddenSemantic,
answer: hiddenSemantic,
rarity: source.status === "verified" && validRarities.has(generated.rarity)
  ? generated.rarity
  : "R"
```

Update `demoCard()` so `hiddenSemantic: "再次想起"` is an exact substring of its `coreKnowledge`. Do not alter Demo-mode gating, readiness, or production failure behavior.

- [ ] **Step 4: Run backend tests**

Run:

```bash
npm --prefix backend test
```

Expected: all existing and new backend tests pass; no production/runtimeConfig test is removed.

- [ ] **Step 5: Commit the backend contract**

```bash
git add backend/src/cardService.js backend/test/cardService.test.js backend/test/server.test.js
git commit -m "feat: restore validated hidden semantic cards"
```

## Task 2: Add compatible iOS modeling and pure recall state

**Files:**
- Modify: `Omo/Omo/Models/OmoModels.swift`
- Modify: `Omo/Omo/OmoStore.swift`
- Modify: `Omo/OmoTests/APIClientDecodingTests.swift`
- Create: `Omo/Omo/RecallInteractionState.swift`
- Create: `Omo/OmoTests/RecallInteractionStateTests.swift`

- [ ] **Step 1: Write failing model and state tests**

Decode one JSON card containing `hiddenSemantic` and one legacy card without it. Assert the first is recall eligible and segments into the first exact match, while the second remains decodable but ineligible.

Add pure state tests for:

```swift
state.updateCoverage(0.79) // showsRating == false
state.updateCoverage(0.80) // coverage == 1, showsRating == true
```

Also assert successful submission advances and reseals, failure preserves the index and retries the same assessment, and slider positions resolve to cancel / forgot / fuzzy / remembered at `0.00 / 0.42 / 0.70 / 0.97`.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:OmoTests/APIClientDecodingTests -only-testing:OmoTests/RecallInteractionStateTests
```

Expected: compile/test failure because the new model property and state types do not yet exist.

- [ ] **Step 3: Add exact segmentation and eligibility**

Add `let hiddenSemantic: String?` to `MemoryCard` and:

```swift
struct RecallKnowledgeSegments: Equatable {
    let prefix: String
    let semantic: String
    let suffix: String

    static func make(coreKnowledge: String, hiddenSemantic: String?) -> Self? {
        let semantic = hiddenSemantic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !semantic.isEmpty, let range = coreKnowledge.range(of: semantic) else { return nil }
        return Self(
            prefix: String(coreKnowledge[..<range.lowerBound]),
            semantic: semantic,
            suffix: String(coreKnowledge[range.upperBound...])
        )
    }
}
```

Expose `knowledgeSegments` and `isRecallEligible`. Change `dueCards` to filter both `isDue` and `isRecallEligible`, without filtering `cards` used by Library.

- [ ] **Step 4: Add the pure round state and slider scale**

Implement `RecallRoundState` phases `covered`, `scratching`, `revealed`, `submitting`, and `submissionFailed`, using `static let revealThreshold = 0.8`. Implement `RecallRatingScale` with the exact four positions and nearest-node behavior; left-side release must return `nil`.

- [ ] **Step 5: Run focused iOS tests**

Run the command from Step 2.

Expected: all focused tests pass.

- [ ] **Step 6: Commit model and state**

```bash
git add Omo/Omo/Models/OmoModels.swift Omo/Omo/OmoStore.swift Omo/Omo/RecallInteractionState.swift Omo/OmoTests/APIClientDecodingTests.swift Omo/OmoTests/RecallInteractionStateTests.swift Omo/Omo.xcodeproj/project.pbxproj
git commit -m "feat: add compatible active recall state"
```

## Task 3: Restore Figma assets and the inline scratch card

**Files:**
- Create: `Omo/Omo/RecallDesign.swift`
- Create: `Omo/Omo/RecallKnowledgeCardView.swift`
- Restore: `Omo/Omo/Assets.xcassets/FirstLaunchArrow.imageset/*`
- Restore: `Omo/Omo/Assets.xcassets/FirstLaunchFolder.imageset/*`
- Restore: `Omo/Omo/Assets.xcassets/FirstLaunchMenu.imageset/*`
- Restore: `Omo/Omo/Assets.xcassets/FirstLaunchPanel.imageset/*`
- Restore: `Omo/Omo/Assets.xcassets/FirstLaunchUpload.imageset/*`

- [ ] **Step 1: Restore only the approved asset sets from the old implementation**

Confirm and restore only the exact approved asset paths:

```bash
git ls-tree -r --name-only 009e943 Omo/Omo/Assets.xcassets | rg 'FirstLaunch(Arrow|Folder|Menu|Panel|Upload)\.imageset/'
git restore --source=009e943 -- \
  Omo/Omo/Assets.xcassets/FirstLaunchArrow.imageset \
  Omo/Omo/Assets.xcassets/FirstLaunchFolder.imageset \
  Omo/Omo/Assets.xcassets/FirstLaunchMenu.imageset \
  Omo/Omo/Assets.xcassets/FirstLaunchPanel.imageset \
  Omo/Omo/Assets.xcassets/FirstLaunchUpload.imageset
```

Do not copy old Profile, backend runtime, or unrelated source files.

- [ ] **Step 2: Add visual tokens**

Define the approved cream/orange/teal palette, card corner radius, shadow, spacing, and semantic emphasis in `RecallDesign`. Define one fixed full-track `LinearGradient`; consumers mask it by filled width rather than recreating a local gradient.

- [ ] **Step 3: Implement inline semantic rendering**

Render `prefix`, a masked `semantic`, and `suffix` as one visual sentence. The mask canvas must cover only the semantic glyph bounds. Feed drag paths into coverage calculation, reveal exactly the touched region, and call `updateCoverage`; at 80%, normalize to full reveal and emit one light haptic.

The revealed semantic uses a heavier weight and accent color than its surrounding text. Remove the current whole-answer scratch view and “直接揭晓” path from this recall route.

- [ ] **Step 4: Protect accessibility and details behavior**

Before reveal, expose only the prefix/suffix recall context and a scratch instruction; do not expose the semantic in VoiceOver. After reveal, expose the complete sentence. Add a secondary details control that opens a Sheet containing full knowledge, explanation, source metadata, verified link when available, and honest screenshot-only status without changing scratch state.

- [ ] **Step 5: Compile the iOS target**

Run:

```bash
xcodebuild build -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17'
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 6: Commit card visuals**

```bash
git add Omo/Omo/Assets.xcassets Omo/Omo/RecallDesign.swift Omo/Omo/RecallKnowledgeCardView.swift Omo/Omo.xcodeproj/project.pbxproj
git commit -m "feat: restore inline scratch knowledge card"
```

## Task 4: Restore the four-position self-rating slider

**Files:**
- Create: `Omo/Omo/RecallRatingSlider.swift`
- Test: `Omo/OmoTests/RecallInteractionStateTests.swift`

- [ ] **Step 1: Add slider mapping boundary tests**

Assert the cancel region remains `nil` through `0.20`, exact assessment nodes return their enum values, and `position(for:)` returns the exact approved constants.

- [ ] **Step 2: Implement drag, snap, and submit behavior**

Start the thumb at cancel. During drag, resolve the nearest semantic region and trigger light haptics only when entering a different assessment node. On release at cancel, animate back to zero and call no submission closure. On release at an assessment node, snap to its absolute position and call the closure once.

- [ ] **Step 3: Implement the approved color behavior**

Place one fixed full-width gradient behind the track and reveal it with a leading-aligned width mask equal to drag progress. Sample the same absolute progress for thumb outline/shadow. Render the arrow with a constant teal foreground style; do not apply the track gradient to it.

- [ ] **Step 4: Add submission states**

Disable further drag while submitting. On failure, keep the revealed card, show an inline retry action, and retain the failed assessment. Retrying submits the same value once; successful completion delegates card advancement to the round state.

- [ ] **Step 5: Run state tests and build**

Run:

```bash
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:OmoTests/RecallInteractionStateTests
xcodebuild build -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17'
```

Expected: tests pass and build succeeds.

- [ ] **Step 6: Commit the slider**

```bash
git add Omo/Omo/RecallRatingSlider.swift Omo/OmoTests/RecallInteractionStateTests.swift Omo/Omo.xcodeproj/project.pbxproj
git commit -m "feat: restore sliding recall assessment"
```

## Task 5: Recompose the approved home and frozen ten-card round

**Files:**
- Create: `Omo/Omo/RecallHomeView.swift`
- Create: `Omo/Omo/RecallRoundView.swift`
- Modify: `Omo/Omo/ContentView.swift`
- Modify: `Omo/Omo/OmoStore.swift`
- Preserve: `Omo/Omo/ProfileView.swift`

- [ ] **Step 1: Build a frozen round from eligible cards**

At IP tap, copy `Array(store.dueCards.prefix(10))` into round-local state. Never recompute the array during the round. A successful assessment advances within the frozen array; the last success clears the round and returns the home to idle.

- [ ] **Step 2: Restore the home composition**

Use the approved Figma assets and warm background. Display first-use upload guidance when `store.cards.isEmpty`; display IP draw guidance when eligible cards exist. Keep the folder and upload controls visible above all idle/summon/round states. The default draw starts on IP tap; no single-draw selector, category selector, textual pity mechanic, or mid-round close button is added.

- [ ] **Step 3: Render a four-layer deck and rarity glow**

Show the current card plus at most three offset backing cards. Allow only the top card to receive scratch gestures. The next card may emit a subtle rarity-colored glow before becoming the top card; rarity remains decorative and requires no tap or acknowledgment.

- [ ] **Step 4: Preserve navigation and team screens**

Replace the bottom-tab shell with the restored home and side menu. Folder opens the current Library presentation, upload opens the current `PhotosPicker` flow, and the side menu opens the current `ProfileView` or Settings. Library renders full card knowledge directly and never applies scratch masking. Do not copy the old Profile implementation or remove the team file.

- [ ] **Step 5: Preserve error and task behavior**

Keep the current store loading/upload error messages, task cancellation, pending generated-card feedback, delete behavior, and assessment API. Ensure upload completion returns to the home scene and does not create an alternate recall route.

- [ ] **Step 6: Run the complete iOS test suite**

Run:

```bash
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17'
```

Expected: all Omo tests pass.

- [ ] **Step 7: Commit home integration**

```bash
git add Omo/Omo/ContentView.swift Omo/Omo/OmoStore.swift Omo/Omo/RecallHomeView.swift Omo/Omo/RecallRoundView.swift Omo/Omo.xcodeproj/project.pbxproj
git commit -m "feat: restore the Omo active recall home"
```

## Task 6: Align stable documentation and run static gates

**Files:**
- Modify: `docs/ios-api-data-contract-zh.md`
- Modify: `docs/frontend/v2-frontend-architecture.md`
- Modify: `docs/frontend/v2-layout-system.md`
- Modify: `docs/superpowers/plans/2026-08-02-active-recall-selective-reintegration.md`

- [ ] **Step 1: Update the API contract**

Add `hiddenSemantic` to the JSON example and state that new cards require an exact non-empty substring, `answer` mirrors it for compatibility, invalid first output gets one repair, and invalid second output returns sanitized `model_invalid_response` without persistence.

- [ ] **Step 2: Update frontend architecture and layout**

Document the home-scene component boundaries, persistent folder/upload controls, maximum-ten frozen round, four-layer deck, 80% inline reveal, four slider positions, fixed full-track gradient, constant teal arrow, and Library's unmasked complete display.

- [ ] **Step 3: Run repository documentation and drift scans**

Run:

```bash
npm --prefix backend run docs:check
rg -n '42%|直接揭晓|three assessment|三按钮' docs Omo/Omo --glob '!docs/superpowers/specs/**'
git diff --check
```

Expected: docs check passes; drift search has no active product/implementation contradiction; diff check is silent.

- [ ] **Step 4: Commit documentation**

```bash
git add docs
git commit -m "docs: align active recall implementation contracts"
```

## Task 7: Full automated verification

**Files:**
- Verify: `backend/test/*.test.js`
- Verify: `Omo/OmoTests/*.swift`

- [ ] **Step 1: Run every backend gate**

```bash
npm --prefix backend test
npm --prefix backend run docs:check
```

Expected: all tests and docs checks pass.

- [ ] **Step 2: Run every iOS test on the primary Simulator**

```bash
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=iPhone 17'
```

Expected: `TEST SUCCEEDED`.

- [ ] **Step 3: Build for a smaller screen**

Build against the installed small-screen device:

```bash
xcodebuild build -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,name=Recallo Audit iPhone SE 3 iOS26'
```

Expected: `BUILD SUCCEEDED` without changing production layout just for the device.

- [ ] **Step 4: Audit preservation explicitly**

Run:

```bash
test -f backend/src/runtimeConfig.js
test -f Omo/Omo/ProfileView.swift
rg -n 'demo_mode_forbidden|service_not_ready|durable_storage_unavailable' backend/src backend/test
git diff --name-status cb23265...HEAD
```

Expected: runtimeConfig and Profile remain present, safety codes remain tested, and the diff contains only intentional restoration/documentation changes.

## Task 8: Simulator interaction acceptance and screenshot evidence

**Files:**
- Create: `artifacts/active-recall-reintegration/README.md`
- Create: `artifacts/active-recall-reintegration/*.png`

- [ ] **Step 1: Start backend in explicit local Fixture mode**

Run:

```bash
OMO_DEMO_MODE=1 NODE_ENV=development npm --prefix backend start
```

Expected: local service starts without claiming production readiness.

- [ ] **Step 2: Boot, install, and launch the app**

Build for `Recallo Audit iPhone 17 Pro`, boot UDID `7921F57F-018A-471E-997D-F23EACC4A1EE`, install the derived `.app`, and launch the bundle with `-OmoSkipLaunch`. Use dedicated Debug-only recall-state arguments added and tested in this task for deterministic screenshot states; retain `-OmoProfileLargeFixture` for Profile overflow evidence. Do not add Release-only mock behavior.

- [ ] **Step 3: Capture every required visual state**

Capture PNG evidence for: first-use empty home, populated idle home, summon animation/poster, four-layer covered deck, partial scratch below 80%, complete reveal at 80%, cancel position, forgot, fuzzy, remembered, submission failure/retry, next card, final completion, card details, Library unmasked card, Profile, upload picker return, Reduce Motion, and a larger Dynamic Type state.

- [ ] **Step 4: Inspect the real interactions**

Use Simulator input to verify scratch responds only on the semantic region, rating remains absent at 79%, release at cancel does not advance, each node submits the correct enum, folder/upload remain usable during the round, and the next card resets to covered. Inspect VoiceOver labels before and after reveal for semantic leakage.

- [ ] **Step 5: Index the evidence**

Write exact device, OS, commit, commands, result, and relative image filename in `artifacts/active-recall-reintegration/README.md`. State that Fixture screenshots prove UI state only and that Qwen/TikHub/production remain unverified without credentials.

- [ ] **Step 6: Commit acceptance artifacts**

```bash
git add artifacts/active-recall-reintegration
git commit -m "test: record active recall simulator acceptance"
```

## Task 9: Completion audit, push, and PR

**Files:**
- Review: all changed files against `docs/superpowers/specs/2026-08-02-active-recall-selective-reintegration-design.md`

- [ ] **Step 1: Audit every specification requirement**

Create a requirement-to-evidence checklist covering the Figma home, maximum-ten deck, inline semantic scratch, 80% threshold, four slider positions, fixed gradient, fixed arrow, persistent actions, Profile preservation, runtime safety preservation, old-card compatibility, automated tests, and Simulator evidence. Resolve every missing or contradictory item before proceeding.

- [ ] **Step 2: Confirm branch and working tree**

```bash
git branch --show-current
git status --short
git log --oneline --decorate omo/main..HEAD
```

Expected: branch is `codex/continue-from-latest-main`, status is clean, and commits are scoped and reviewable.

- [ ] **Step 3: Push only the feature branch**

```bash
git push -u omo codex/continue-from-latest-main
```

Expected: remote branch is created; `main` is unchanged.

- [ ] **Step 4: Create a PR targeting main**

```bash
gh pr create --repo starvingarc/Omo --base main --head codex/continue-from-latest-main --title 'Restore approved active recall interaction' --body-file /tmp/omo-active-recall-pr-body.md
```

The PR body must summarize preserved team changes, restored behavior, backend/iOS tests, Simulator evidence, known external-service verification limits, and explicitly state that no open PostgreSQL or Library Detail PR was incorporated.

- [ ] **Step 5: Inspect the created PR**

```bash
gh pr view --repo starvingarc/Omo --json url,baseRefName,headRefName,state,mergeable,statusCheckRollup
```

Expected: base is `main`, head is `codex/continue-from-latest-main`, PR is open, and no direct merge has occurred.
