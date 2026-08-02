# Knowledge Library Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan task-by-task with test-first checkpoints. The repository does not expose `superpowers:executing-plans` in this session, so the primary agent executes inline and records each checkpoint in the active repository plan.

**Goal:** Build the Figma-designed Omo knowledge library with complete-card browsing, measured masonry pagination, text and speech input, replaceable mock search, complete UI states, tests, and Simulator evidence.

**Architecture:** Extract the current private list into a focused `KnowledgeLibraryView` feature. A `@MainActor` view model owns a cancel-safe search state machine and speech orchestration behind protocols; a Debug fixture searcher supplies deterministic results without pretending to be production vector search. SwiftUI measures the rendered cards at the actual width and Dynamic Type size, then a pure paginator distributes those measured heights across two columns and horizontal pages.

**Tech Stack:** Swift 5, SwiftUI, Observation via `ObservableObject`, Speech, AVFoundation, XCTest, Xcode 26 / iOS 26 Simulator, repository Markdown contracts.

---

## File map

- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibrarySearch.swift`: request/result types, state enum, search protocol, deterministic Debug mock, unavailable production adapter.
- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibrarySpeech.swift`: speech protocol, state, Apple Speech/AVAudio implementation, Debug transcript implementation.
- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryViewModel.swift`: query, request cancellation, result mapping, speech/search state transitions.
- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryPagination.swift`: pure measured-height pagination and page models.
- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryView.swift`: screen shell, search bar, state views, pager, card, page indicator, detail/upload hooks.
- Create `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryDebugFixtures.swift`: synthetic cards and Debug-only launch argument parsing.
- Create `Omo/OmoTests/KnowledgeLibrarySearchTests.swift`: view-model state, races, mapping, speech handoff.
- Create `Omo/OmoTests/KnowledgeLibraryPaginationTests.swift`: order and measured-height page breaking.
- Modify `Omo/Omo/ContentView.swift`: remove the old private list/row and mount the feature with store callbacks.
- Modify `Omo/Omo/OmoStore.swift`: Debug-only synthetic library state injection without altering production load behavior.
- Modify `Omo/Omo/Models/OmoModels.swift`: `Sendable` conformance needed by structured concurrency.
- Modify `Omo/Omo/RecallDesign.swift`: named library tokens and component/screen metrics.
- Modify `Omo/Omo.xcodeproj/project.pbxproj`: Speech/Microphone generated Info.plist usage descriptions only; synchronized groups pick up new source files.
- Modify `Omo/Omo/Localizable.xcstrings`, `Omo/Omo/en.lproj/InfoPlist.strings`, `Omo/Omo/zh-Hans.lproj/InfoPlist.strings`: visible and permission copy.
- Modify `docs/knowledge-library-prd.md`, `docs/index.md`, `docs/frontend/v2-frontend-architecture.md`, `docs/frontend/v2-layout-system.md`, `docs/ios-api-data-contract-zh.md`, `docs/asset-provenance.md`, `docs/quality-baseline.md`: stable product, contract, layout, asset and validation facts.
- Modify `plans/codex-knowledge-library-search.md`, `PLANS.md`: progress and final evidence lifecycle.

### Task 1: Stabilize the product contract and search state with tests

**Files:**
- Create: `docs/knowledge-library-prd.md`
- Modify: `docs/index.md`
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibrarySearch.swift`
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryViewModel.swift`
- Test: `Omo/OmoTests/KnowledgeLibrarySearchTests.swift`

- [ ] **Step 1: Write the PRD before implementation**

Record the confirmed user story, default complete-card browsing, text/voice flows, horizontal paging, state table, non-goals, analytics names without an analytics SDK, accessibility, privacy, mock boundary, future backend contract, and acceptance matrix. Explicitly state: current build uses a Debug/test search adapter and does not prove production vector retrieval.

- [ ] **Step 2: Add failing view-model tests**

Use a controllable actor-backed spy:

```swift
actor SearchSpy: KnowledgeLibrarySearching {
    var continuations: [String: CheckedContinuation<KnowledgeLibrarySearchResponse, Error>] = [:]

    func search(_ request: KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse {
        try await withCheckedThrowingContinuation { continuation in
            continuations[request.query] = continuation
        }
    }

    func succeed(_ query: String, ids: [String]) {
        continuations.removeValue(forKey: query)?.resume(
            returning: .init(orderedCardIDs: ids)
        )
    }
}
```

Tests must assert:

```swift
@MainActor
func testBlankQueryRestoresAllCardsAndCancelsSearch() async

@MainActor
func testLatestRequestWinsWhenOlderResponseFinishesLast() async

@MainActor
func testResultMappingDropsUnknownAndDuplicateIDs() async

@MainActor
func testEmptyResponseAndFailureRemainDistinct() async

@MainActor
func testRetryPreservesQuery() async
```

- [ ] **Step 3: Run tests and prove the new types are missing**

Run:

```bash
xcodebuild -project Omo/Omo.xcodeproj -scheme Omo -showdestinations
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,id=<available-udid>' -only-testing:OmoTests/KnowledgeLibrarySearchTests
```

Expected: compile failure because `KnowledgeLibrarySearching` and `KnowledgeLibraryViewModel` do not exist.

- [ ] **Step 4: Implement the minimal search boundary and state machine**

Use production-shaped types with explicit candidate documents so the local mock can work without reaching into UI state:

```swift
struct KnowledgeLibrarySearchDocument: Equatable, Sendable {
    let id: String
    let coreKnowledge: String
    let recallCue: String
    let explanation: String
    let sourceTitle: String
}

struct KnowledgeLibrarySearchRequest: Equatable, Sendable {
    let query: String
    let candidates: [KnowledgeLibrarySearchDocument]
}

struct KnowledgeLibrarySearchResponse: Equatable, Sendable {
    let orderedCardIDs: [String]
}

protocol KnowledgeLibrarySearching: Sendable {
    func search(_ request: KnowledgeLibrarySearchRequest) async throws
        -> KnowledgeLibrarySearchResponse
}

enum KnowledgeLibraryResultsState: Equatable {
    case all
    case searching
    case results
    case noResults
    case failed(message: String)
}
```

The view model owns `query`, `state`, `visibleCards`, `currentPage`, and one `Task`. `submit()` trims query, cancels the previous task, captures a UUID generation, awaits search, filters response IDs through a dictionary of current cards, preserves response order, de-duplicates IDs, and only commits if generation is still current. `clearQuery()` cancels and restores `.all`. `updateCards(_:)` removes deleted results and restores all when the query is empty.

- [ ] **Step 5: Run the search tests**

Run the same `xcodebuild test` command. Expected: all `KnowledgeLibrarySearchTests` pass.

- [ ] **Step 6: Commit the contract and state layer**

```bash
git add docs/knowledge-library-prd.md docs/index.md Omo/Omo/KnowledgeLibrary Omo/OmoTests/KnowledgeLibrarySearchTests.swift plans/codex-knowledge-library-search.md
git commit -m "feat: add knowledge library search state"
```

### Task 2: Implement measured masonry pagination test-first

**Files:**
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryPagination.swift`
- Test: `Omo/OmoTests/KnowledgeLibraryPaginationTests.swift`

- [ ] **Step 1: Write failing pure paginator tests**

Use fixed item IDs and measured heights:

```swift
func testPaginatorFillsShorterColumnWithoutReordering()
func testPaginatorStartsNewPageBeforeEitherColumnOverflows()
func testSingleOversizedCardStillGetsItsOwnPage()
func testLargerMeasuredHeightsProduceMorePages()
func testEmptyInputProducesNoPages()
```

Assert both visual placement and logical reading order. Example:

```swift
let pages = paginator.pages(
    itemHeights: [("a", 120), ("b", 180), ("c", 100), ("d", 160)],
    availableHeight: 300,
    verticalSpacing: 18
)
XCTAssertEqual(pages.flatMap(\.readingOrder), ["a", "b", "c", "d"])
```

- [ ] **Step 2: Run tests and verify failure**

Run `-only-testing:OmoTests/KnowledgeLibraryPaginationTests`. Expected: compile failure because paginator types do not exist.

- [ ] **Step 3: Implement the pure paginator**

Define:

```swift
struct KnowledgeLibraryPage<ID: Hashable & Sendable>: Equatable, Sendable {
    struct Placement: Equatable, Sendable {
        let id: ID
        let column: Int
        let y: CGFloat
        let height: CGFloat
        let sourceIndex: Int
    }

    let placements: [Placement]
    var readingOrder: [ID] {
        placements.sorted { $0.sourceIndex < $1.sourceIndex }.map(\.id)
    }
}
```

Greedily place each measured item in the shorter column. If the selected column would exceed `availableHeight` and the current page is non-empty, close the page and place the item at `y = 0` on a new page. Preserve `sourceIndex` for accessibility order. Clamp invalid/negative heights to zero and guarantee an oversized card is never dropped.

- [ ] **Step 4: Run pagination and full unit tests**

Expected: pagination suite and existing `OmoTests` pass.

- [ ] **Step 5: Commit**

```bash
git add Omo/Omo/KnowledgeLibrary/KnowledgeLibraryPagination.swift Omo/OmoTests/KnowledgeLibraryPaginationTests.swift plans/codex-knowledge-library-search.md
git commit -m "feat: add measured knowledge card pagination"
```

### Task 3: Add real speech boundaries and Debug speech simulation

**Files:**
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibrarySpeech.swift`
- Modify: `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryViewModel.swift`
- Modify: `Omo/Omo.xcodeproj/project.pbxproj`
- Modify: `Omo/Omo/en.lproj/InfoPlist.strings`
- Modify: `Omo/Omo/zh-Hans.lproj/InfoPlist.strings`
- Test: `Omo/OmoTests/KnowledgeLibrarySearchTests.swift`

- [ ] **Step 1: Add failing speech handoff tests**

Implement a spy transcriber that emits states through an `AsyncStream` and test:

```swift
@MainActor
func testFinalVoiceTranscriptUpdatesQueryAndSubmitsExactlyOnce() async

@MainActor
func testVoicePermissionFailureDoesNotEraseTypedQuery() async

@MainActor
func testClearAndDisappearStopListening() async
```

- [ ] **Step 2: Run and verify failure**

Expected: missing `KnowledgeLibrarySpeechTranscribing` and speech state.

- [ ] **Step 3: Implement protocol and production controller**

Define:

```swift
enum KnowledgeLibrarySpeechEvent: Equatable, Sendable {
    case listening
    case transcript(String, isFinal: Bool)
    case denied
    case unavailable
    case failed(String)
    case stopped
}

protocol KnowledgeLibrarySpeechTranscribing: AnyObject {
    var events: AsyncStream<KnowledgeLibrarySpeechEvent> { get }
    func start() async
    func stop()
}
```

The Apple implementation wraps `SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))`, `SFSpeechAudioBufferRecognitionRequest`, and `AVAudioEngine`. It requests both authorization boundaries, installs one input tap, yields partial transcripts, removes the tap in every stop/error path, and never writes audio to disk. A Debug implementation yields a configured final transcript after a short deterministic delay.

Add generated Info.plist keys:

```text
INFOPLIST_KEY_NSMicrophoneUsageDescription = "用语音描述你想找的知识。"
INFOPLIST_KEY_NSSpeechRecognitionUsageDescription = "把你的语音转成知识库搜索文字。"
```

Localize the permission copy in `InfoPlist.strings`.

- [ ] **Step 4: Connect speech events to the view model**

`startOrStopVoice()` toggles listening. Partial transcripts update the query. A non-empty final transcript calls `submit()` once. Denied/unavailable/failed states preserve typed text and expose a recoverable message. `onDisappear()` cancels search and stops speech.

- [ ] **Step 5: Run tests and Debug build**

Expected: speech tests pass; Debug build links Speech/AVFoundation without privacy-key warnings.

- [ ] **Step 6: Commit**

```bash
git add Omo/Omo/KnowledgeLibrary Omo/OmoTests/KnowledgeLibrarySearchTests.swift Omo/Omo.xcodeproj/project.pbxproj Omo/Omo/*lproj/InfoPlist.strings plans/codex-knowledge-library-search.md
git commit -m "feat: add knowledge library voice input"
```

### Task 4: Build the Figma screen from tokens to components to page

**Files:**
- Modify: `Omo/Omo/RecallDesign.swift`
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryView.swift`
- Modify: `Omo/Omo/ContentView.swift`
- Modify/Create: exact asset files under `Omo/Omo/Assets.xcassets/`
- Modify: `docs/asset-provenance.md`
- Modify: `Omo/Omo/Localizable.xcstrings`

- [ ] **Step 1: Audit and import only exact assets**

Reuse existing FirstLaunch/Recall assets where their hashes and artwork match Figma. Import the supplied microphone and back SVG only if the existing asset is not exact. Record source URL/node, user attachment path, purpose, transformation and SHA-256 in `docs/asset-provenance.md`. Do not redraw raster artwork or replace it with an SF Symbol.

- [ ] **Step 2: Add library tokens and metrics**

Extend `RecallDesign.swift` with:

```swift
enum KnowledgeLibraryMetrics {
    static let referenceSize = CGSize(width: 402, height: 874)
    static let backFrame = CGRect(x: 21, y: 43, width: 70, height: 70)
    static let mascotFrame = CGRect(x: 222, y: 48, width: 157, height: 157)
    static let panelTop: CGFloat = 180
    static let searchFrame = CGRect(x: 21, y: 166, width: 356, height: 76)
    static let contentHorizontalInset: CGFloat = 27
    static let columnSpacing: CGFloat = 18
    static let rowSpacing: CGFloat = 20
    static let cardCornerRadius: CGFloat = 18
    static let cardContentInset: CGFloat = 18
    static let minimumControlSize: CGFloat = 44
}
```

Separate token constants (colors/shadows/type roles), component metrics, and screen placement metrics. Use existing `RecallPalette`; do not introduce near-duplicate literal colors inside view bodies.

- [ ] **Step 3: Implement focused components**

`KnowledgeLibrarySearchBar` uses a `TextField`, clear control, supplied microphone asset, and “帮我找” button. It supports keyboard `.search`, focus, listening border state, loading spinner, disabled empty submission and Dynamic Type growth.

`KnowledgeLibraryCardView` renders the whole `coreKnowledge`. If `knowledgeSegments` exists, use an `AttributedString` with regular teal/cream context and semibold coral/cream semantic emphasis. It uses deterministic color/rotation based on card ID, a full-card button hit area and one combined accessibility element.

`KnowledgeLibraryPager` creates an invisible non-accessible measurement layer at the real column width, receives actual rendered heights via a `PreferenceKey`, calls the pure paginator, and renders fixed-width pages in `TabView(indexDisplayMode: .never)`. The page indicator is one accessibility element.

- [ ] **Step 4: Compose the screen and all states**

Build the 402 × 874 reference composition with responsive safe-area scaling. Keep top chrome and search box stable; use the cream panel as the card/pager surface. Render:

```swift
switch viewModel.state {
case .all, .results:
    KnowledgeLibraryPager(cards: viewModel.visibleCards, currentPage: $viewModel.currentPage)
case .searching:
    KnowledgeLibraryLoadingView()
case .noResults:
    KnowledgeLibraryNoResultsView(onShowAll: viewModel.clearQuery)
case .failed(let message):
    KnowledgeLibraryFailureView(message: message, onRetry: viewModel.retry)
}
```

When the store has no cards, show the empty-library state and keep the upload button active. The folder artwork remains decorative on this already-open library page. Back changes `store.selectedTab` to `.today`; upload calls the existing PhotosPicker sheet; card tap sets `store.presentedCard`.

- [ ] **Step 5: Remove the old list without changing detail/upload contracts**

Delete private `LibraryView` and `MemoryCardRow` from `ContentView.swift`. Keep `LibraryCardDetailView` and `AddScreenshotView`. Mount `KnowledgeLibraryView(cards:onBack:onAdd:onOpenCard:)` from the `.library` branch.

- [ ] **Step 6: Build and inspect previews/Simulator**

Build on an available iPhone Simulator. Expected: no clipping at 402 × 874 reference size, card text complete, search field usable with keyboard, and page swipes update dots.

- [ ] **Step 7: Commit**

```bash
git add Omo/Omo/ContentView.swift Omo/Omo/RecallDesign.swift Omo/Omo/KnowledgeLibrary Omo/Omo/Assets.xcassets Omo/Omo/Localizable.xcstrings docs/asset-provenance.md plans/codex-knowledge-library-search.md
git commit -m "feat: recreate the Omo knowledge library"
```

### Task 5: Add deterministic mock scenarios and stable documentation

**Files:**
- Create: `Omo/Omo/KnowledgeLibrary/KnowledgeLibraryDebugFixtures.swift`
- Modify: `Omo/Omo/OmoStore.swift`
- Modify: `Omo/Omo/ContentView.swift`
- Modify: `docs/frontend/v2-frontend-architecture.md`
- Modify: `docs/frontend/v2-layout-system.md`
- Modify: `docs/ios-api-data-contract-zh.md`
- Modify: `docs/quality-baseline.md`
- Modify: `docs/knowledge-library-prd.md`
- Test: `Omo/OmoTests/KnowledgeLibrarySearchTests.swift`

- [ ] **Step 1: Add synthetic long/short card fixtures**

Create at least 12 entirely synthetic cards covering short, medium and multi-line complete knowledge, all rarity colors, legal/absent `hiddenSemantic`, verified/unverified sources, and stable IDs. They must not contain real user screenshots or production exports.

- [ ] **Step 2: Add Debug-only scenario parsing**

Under `#if DEBUG`, parse:

```text
-OmoOpenLibrary
-OmoLibraryFixture many|empty
-OmoLibraryQuery <query>
-OmoLibrarySearchNoResults
-OmoLibrarySearchFailure
-OmoLibraryVoiceTranscript <transcript>
-OmoLibrarySpeechDenied
```

Injection occurs only after normal `store.load()` and only when explicit arguments are present. Release builds have no fixture branch.

- [ ] **Step 3: Add deterministic mock search behavior**

The mock normalizes whitespace/case and scores synthetic documents by explicit query aliases plus field token overlap, with stable ID tie-breaking. Name it `DebugMockKnowledgeLibrarySearcher`; expose a visible Debug accessibility/debug value such as “模拟搜索数据” where appropriate. A configured failure/no-result mode returns exactly those states. Do not call it vector or semantic search in production-facing copy.

- [ ] **Step 4: Update stable contracts**

Document the implemented SwiftUI feature, protocol boundary, mock limitation, measured pagination, Speech privacy behavior and exact validation commands. In the API contract, label the future vector Endpoint as unimplemented and do not assign a live path unless backend code exists.

- [ ] **Step 5: Run documentation and unit gates**

```bash
npm --prefix backend run docs:check
git diff --check
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,id=<available-udid>'
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add Omo/Omo Omo/OmoTests docs plans/codex-knowledge-library-search.md
git commit -m "test: add knowledge library acceptance fixtures"
```

### Task 6: Simulator interaction audit and evidence

**Files:**
- Create/Modify: `docs/validation/knowledge-library-search-2026-08-03.md`
- Create: screenshot evidence under an ignored or documented validation-artifact path; do not commit personal/user data.
- Modify: `plans/codex-knowledge-library-search.md`

- [ ] **Step 1: Discover and boot actual destinations**

Run `xcodebuild ... -showdestinations`, select a common device plus a smaller or larger available iPhone, build the Debug app, boot/install/launch with explicit fixture arguments.

- [ ] **Step 2: Capture every required state**

Capture screenshots for all cards page 1, a later page, text query result, voice listening, simulated voice result, no results, failure, empty library, complete detail and upload sheet. Record bundle arguments, device, OS and screenshot path in the validation document.

- [ ] **Step 3: Audit interactions, not only pixels**

Actually type and submit through the Simulator keyboard, clear query, retry failure, tap mic, stop/restart, swipe pages, open a card, return, open upload, cancel upload and return home. Verify new queries reset page 1 and stale results never replace the current query.

- [ ] **Step 4: Audit system variants**

Check the common and alternate size, largest practical Dynamic Type, Reduce Motion, VoiceOver labels/reading order, keyboard/focus, light/dark system appearance, safe areas, hit targets, scrolling and horizontal overflow. Fix failures and recapture evidence.

- [ ] **Step 5: Run final gates**

```bash
npm --prefix backend run docs:check
git diff --check
xcodebuild test -project Omo/Omo.xcodeproj -scheme Omo -destination 'platform=iOS Simulator,id=<available-udid>'
xcodebuild build -project Omo/Omo.xcodeproj -scheme Omo -configuration Debug -destination 'platform=iOS Simulator,id=<available-udid>'
```

Expected: all exit 0. State explicitly that Simulator mock speech does not prove real-device recognition and mock search does not prove production vector retrieval.

- [ ] **Step 6: Commit validation evidence**

```bash
git add docs/validation/knowledge-library-search-2026-08-03.md plans/codex-knowledge-library-search.md
git commit -m "test: record knowledge library simulator acceptance"
```

### Task 7: Completion audit, plan retirement, push and review handoff

**Files:**
- Modify then delete: `plans/codex-knowledge-library-search.md`
- Modify: `PLANS.md`

- [ ] **Step 1: Audit every explicit requirement**

Map Figma visual structure, complete browsing, text input, speech input, replaceable mock search, all states, measured pagination, PRD, tests, Simulator interaction and screenshots to direct code/test/runtime evidence. Continue fixing if any evidence is missing or only indirect.

- [ ] **Step 2: Complete the repository plan**

Set status `completed`, check every finished task, record commands/results, devices, screenshot paths, unverified production vector/real-device speech boundaries and final commit SHAs. Commit only the completion evidence:

```bash
git add plans/codex-knowledge-library-search.md PLANS.md
git commit -m "plan: complete codex-knowledge-library-search"
```

- [ ] **Step 3: Retire the plan before PR**

Delete the plan, restore `PLANS.md` to the empty table, run docs check and diff check, then commit:

```bash
git add plans/codex-knowledge-library-search.md PLANS.md
git commit -m "plan: retire codex-knowledge-library-search"
```

- [ ] **Step 4: Push only the topic branch**

Push `codex/knowledge-library-search` to `omo`. Do not push or merge `main`. Because this is stacked on the open active-recall branch, make the dependency explicit in the PR/handoff and choose the safest review base supported by the team’s current PR state without rewriting either shared branch.

## Self-review

- Spec coverage: every requirement in the design spec maps to Tasks 1–7, including PRD, exact assets, measured heights, text/voice states, mock honesty, Debug fixtures, accessibility, Simulator screenshots and branch lifecycle.
- Placeholder scan: no `TBD`, generic “handle errors”, or unspecified test step remains. Future production vector work is explicitly a non-goal and contract boundary, not an implementation placeholder.
- Type consistency: request, response, search protocol, speech event, result state, view-model and paginator names are consistent across tasks. The implementation may add access modifiers but must not silently rename the frozen concepts without updating the spec and tests.
- Execution choice: the user requested autonomous execution in this goal. The primary agent will execute inline; no subagents are dispatched because this session’s collaboration policy does not authorize them.

