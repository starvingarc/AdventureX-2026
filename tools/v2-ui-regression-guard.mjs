#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const files = {
  questionComponents: resolve(repoRoot, "拾贝/拾贝/V2/Components/Flow/V2QuestionComponents.swift"),
  reviewFlowScreens: resolve(repoRoot, "拾贝/拾贝/V2/Screens/Review/V2ReviewFlowScreens.swift"),
  awakeningViews: resolve(repoRoot, "拾贝/拾贝/V2/Screens/Home/V2AwakeningViews.swift"),
  awakeningModels: resolve(repoRoot, "拾贝/拾贝/V2/Models/V2AwakeningModels.swift"),
  screenshotAwakeningViews: resolve(repoRoot, "拾贝/拾贝/V2/Screens/Home/V2ScreenshotAwakeningViews.swift"),
  screenshotMemoryModels: resolve(repoRoot, "拾贝/拾贝/V2/Models/V2ScreenshotMemoryModels.swift"),
  tabScreens: resolve(repoRoot, "拾贝/拾贝/V2/Screens/Tabs/V2TabScreens.swift"),
  v2Root: resolve(repoRoot, "拾贝/拾贝/V2/V2RootView.swift"),
  apiClient: resolve(repoRoot, "拾贝/拾贝/Services/APIClient.swift"),
  apiClientTests: resolve(repoRoot, "拾贝/拾贝Tests/APIClientDecodingTests.swift")
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")])
);
const matchingCardSource = extractMatchingCardSource(source.questionComponents);
const matchingScreenSource = extractMatchingScreenSource(source.reviewFlowScreens);

const checks = [
  check(
    "matching_card_uses_external_width",
    /\.frame\(width: width(?:,|\))/.test(matchingCardSource),
    "V2MatchingOptionCard must use its width parameter, not a private fixed width."
  ),
  check(
    "matching_card_uses_external_exact_height",
    /\.frame\(width: width,\s*height: height\)/.test(matchingCardSource),
    "V2MatchingOptionCard must use its height parameter as the exact semantic height for the estimated line count."
  ),
  check(
    "matching_card_uses_external_horizontal_padding",
    /\.padding\(\.horizontal,\s*horizontalPadding\)/.test(matchingCardSource),
    "V2MatchingOptionCard must use its horizontalPadding parameter."
  ),
  check(
    "matching_card_has_no_outer_vertical_padding",
    !/ZStack\s*\{[\s\S]*?\}\s*\.padding\(\.vertical,/.test(matchingCardSource),
    "V2MatchingOptionCard must not add vertical padding around the whole card because it makes visual row gaps drift."
  ),
  check(
    "matching_card_has_no_private_fixed_width_metrics",
    !/static let (width|minHeight|textWidth): CGFloat =/.test(extractMatchingCardPrivateMetrics(source.questionComponents)),
    "V2MatchingOptionCard must not hide fixed width/minHeight/textWidth inside its private Metrics."
  ),
  check(
    "matching_screen_passes_card_metrics",
    /width:\s*V2MatchingPageMetrics\.optionCardWidth/.test(matchingScreenSource)
      && /let cardHeight = V2MatchingPageMetrics\.optionCardHeight\(for:\s*question\.matchingPairs\)/.test(matchingScreenSource)
      && /height:\s*cardHeight/.test(matchingScreenSource)
      && /horizontalPadding:\s*V2MatchingPageMetrics\.optionCardHorizontalPadding/.test(matchingScreenSource),
    "V2MatchingQuestionView must pass screen metrics into V2MatchingOptionCard."
  ),
  check(
    "matching_screen_uses_uniform_dynamic_heights",
    /static func optionCardHeight\(for pairs: \[V2MatchingPairData\]\) -> CGFloat/.test(matchingScreenSource)
      && /optionCardOneLineHeight/.test(matchingScreenSource)
      && /optionCardTwoLineHeight/.test(matchingScreenSource)
      && /optionCardThreeLineHeight/.test(matchingScreenSource),
    "Matching option cards should use one uniform compact height per question based on the longest option."
  ),
  check(
    "matching_screen_has_no_per_option_height",
    !/optionCardHeight\(for:\s*pair\.(left|right)\)|rowHeights|optionRowHeights/.test(matchingScreenSource),
    "Matching screen must keep all option cards in one question at the same height."
  ),
  check(
    "awakening_home_is_single_card_and_low_pressure",
    source.awakeningViews.includes("今天，唤醒一点记忆")
      && source.awakeningViews.includes('return response?.hasActiveCard == true ? "继续这张" : "召回一张"')
      && source.awakeningViews.includes("一次只看一张")
      && !source.awakeningViews.includes("V2MemoryPoolSelector")
      && !source.awakeningViews.includes("连续召回"),
    "Awakening home must expose one low-pressure recall entry without pool or mode selectors."
  ),
  check(
    "recall_ritual_uses_frozen_phase_contract",
    /enum V2RecallPresentationPhase[\s\S]*case home[\s\S]*case summoning[\s\S]*case recall[\s\S]*case scratching[\s\S]*case revealed[\s\S]*case assessing[\s\S]*case checkpoint[\s\S]*case stowing[\s\S]*case paused/.test(source.awakeningViews),
    "The recall ritual must keep the frozen nine-phase presentation contract."
  ),
  check(
    "recall_mascot_has_ten_states",
    /enum V2RecallMascotState[\s\S]*case idle[\s\S]*case reacting[\s\S]*case turning[\s\S]*case rummaging[\s\S]*case carrying[\s\S]*case watching[\s\S]*case acknowledging[\s\S]*case thinking[\s\S]*case sleeping[\s\S]*case farewell/.test(source.awakeningViews),
    "Five bundled poses must be composed into ten semantic mascot states."
  ),
  check(
    "scratch_reveal_uses_canvas_grid_threshold",
    source.screenshotAwakeningViews.includes("Canvas { context, size in")
      && source.screenshotAwakeningViews.includes("context.blendMode = .destinationOut")
      && source.screenshotAwakeningViews.includes("brushDiameter: CGFloat = 26")
      && source.screenshotAwakeningViews.includes("coverage >= 0.45"),
    "Scratch reveal must use a 26pt destination-out Canvas and a 45 percent grid threshold."
  ),
  check(
    "checkpoint_and_persistence_are_explicit",
    source.screenshotAwakeningViews.includes('"继续下一张"')
      && source.screenshotAwakeningViews.includes('Button("先收好"')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.currentCardID")')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.scratchPaths")')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.assessedReviewCycles")'),
    "Checkpoint choice, scratch restoration, and idempotent assessment markers must persist."
  ),
  check(
    "assessment_idempotency_is_scoped_to_review_cycle",
    source.screenshotAwakeningViews.includes("currentReviewCycleKey")
      && source.screenshotAwakeningViews.includes('attemptId: "ios-capture-assessment-\\(currentReviewCycleKey)"')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.assessedReviewCycles")')
      && !source.screenshotAwakeningViews.includes('attemptId: "ios-capture-assessment-\\(currentCard.id)"'),
    "Assessment idempotency must be stable for retries but change when the card enters a later review cycle."
  ),
  check(
    "optional_capture_schedule_has_stable_cycle_key",
    source.screenshotMemoryModels.includes('?? "initial"')
      && source.screenshotAwakeningViews.includes("currentCard.reviewCycleKey(scheduleOverride: currentSchedule)")
      && !source.screenshotAwakeningViews.includes("currentCard.schedule.nextReviewAt"),
    "Optional capture schedules must compile safely and use a deterministic initial review-cycle key."
  ),
  check(
    "capture_assessment_prefers_server_mastery",
    /struct Mastery: Decodable, Equatable[\s\S]*before: String[\s\S]*after: String[\s\S]*successfulRecallCount: Int[\s\S]*reviewCount: Int/.test(source.apiClient)
      && source.screenshotMemoryModels.includes("if let serverMastery")
      && source.v2Root.includes("serverMastery: response.mastery")
      && source.screenshotAwakeningViews.includes("if let serverMastery = response.mastery"),
    "Assessment responses may omit mastery for old servers, but server-owned mastery must win when present."
  ),
  check(
    "capture_assessment_uses_server_canonical_value",
    source.screenshotMemoryModels.includes("func canonicalAssessment(fallback: V2MemoryAssessment)")
      && source.v2Root.includes("let canonicalAssessment = response.canonicalAssessment(fallback: assessment)")
      && source.v2Root.includes("screenshotCards[index].apply(\n                canonicalAssessment,")
      && source.screenshotAwakeningViews.includes("assessment = canonicalAssessment"),
    "A repeated attempt must apply the assessment returned by the server, not a conflicting retry value."
  ),
  check(
    "checkpoint_resume_is_scoped_to_input_review_cycle",
    source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.presentationReviewCycleKey")')
      && source.screenshotAwakeningViews.includes("persistedPresentationReviewCycleKey = currentReviewCycleKey")
      && source.screenshotAwakeningViews.includes("restoredCard.matchesPersistedPresentation(")
      && source.screenshotAwakeningViews.includes("resetPresentationForCurrentCycle()")
      && source.screenshotMemoryModels.includes("func matchesPersistedPresentation(")
      && source.apiClientTests.includes("testPresentationResumeRejectsDifferentReviewCycle"),
    "Persisted scratch and reveal state must be discarded when the card advances to a different review cycle."
  ),
  check(
    "fragments_are_saved_but_never_reviewed",
    source.screenshotMemoryModels.includes("guard card.state == .formal, disposition == .createCard")
      && source.v2Root.includes("guard disposition == .createCard, memoryCard.state == .formal")
      && source.v2Root.includes("selectedTab = .materials")
      && source.tabScreens.includes('case .archiveOnly:\n            "已保存碎片"')
      && source.tabScreens.includes('case .needsConfirmation:\n            "待确认"')
      && source.tabScreens.includes("if isFormalReviewCard, let schedule = captured.schedule"),
    "Archive-only and confirmation-needed captures must remain visible fragments without mastery, scheduling, or draw eligibility."
  ),
  check(
    "capture_delete_waits_for_server_success",
    /func deleteCaptureMemoryCard\(id: String\)[\s\S]*?\/api\/memory-cards\/[\s\S]*?method: "DELETE"/.test(source.apiClient)
      && /let response = try await apiClient\.deleteCaptureMemoryCard\(id: id\)[\s\S]*?guard response\.deleted[\s\S]*?screenshotCards\.removeAll/.test(source.v2Root)
      && source.tabScreens.includes("删除这条记忆？")
      && source.tabScreens.includes("pendingMemoryCardDeletion"),
    "Knowledge-library deletion must be confirmed and local state may change only after a successful DELETE response."
  ),
  check(
    "account_deletion_clears_capture_state_before_refresh",
    /_ = try await apiClient\.deleteAccount\(\)[\s\S]*?clearCaptureMemoryStateAfterAccountDeletion\(\)[\s\S]*?await refreshBackendContentAfterAccountChange\(\)/.test(source.v2Root)
      && /clearCaptureMemoryStateAfterAccountDeletion\(\)[\s\S]*?screenshotAnalysisTask\?\.cancel\(\)[\s\S]*?screenshotCards\.removeAll\(\)[\s\S]*?screenshotDrawSession = nil[\s\S]*?V2ScreenshotPersistence\.clear\(\)/.test(source.v2Root)
      && source.screenshotMemoryModels.includes('"recallo.v06.scratchPaths"')
      && source.screenshotMemoryModels.includes('"recallo.v06.assessedReviewCycles"')
      && source.screenshotMemoryModels.includes('"recallo.v06.presentationReviewCycleKey"')
      && source.apiClientTests.includes("testAccountDeletionClearsPersistedScreenshotRecallState"),
    "A successful account deletion must erase in-memory and persisted capture state before any best-effort refresh."
  ),
  check(
    "ios_capture_contract_tests_cover_new_boundaries",
    source.apiClientTests.includes("testOptionalScheduleProducesStableInitialReviewCycleKey")
      && source.apiClientTests.includes("testServerMasteryOverridesLegacyClientProgression")
      && source.apiClientTests.includes("testFragmentsNeverEnterFormalReviewPools")
      && source.apiClientTests.includes("testDecodesCaptureMemoryCardDeletionContract")
      && source.apiClientTests.includes("canonicalAssessment(fallback: .forgot)")
      && source.apiClientTests.includes("testPresentationResumeRejectsDifferentReviewCycle")
      && source.apiClientTests.includes("testAccountDeletionClearsPersistedScreenshotRecallState")
      && source.apiClientTests.includes("XCTAssertNil(response.mastery)"),
    "Swift contract tests must retain optional schedule, server mastery, legacy response, fragment eligibility, and delete decoding coverage."
  ),
  check(
    "checkpoint_restores_assessment_mastery_and_schedule",
    source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.assessment")')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.masteryAfter")')
      && source.screenshotAwakeningViews.includes('@AppStorage("recallo.v06.scheduleNextReviewAt")')
      && source.screenshotAwakeningViews.includes("ImageFlowReviewSchedule("),
    "Checkpoint restoration must keep the submitted assessment, mastery transition, and returned schedule."
  ),
  check(
    "scratch_accessibility_and_coverage_share_cells",
    source.screenshotAwakeningViews.includes("adjustCoveredCells(by: 0.15)")
      && source.screenshotAwakeningViews.includes("brushDiameter / 2")
      && !source.screenshotAwakeningViews.includes("coverage = min(1, coverage + 0.15)"),
    "VoiceOver adjustment and finger scratching must share one cell-based coverage source without inflating the brush radius."
  ),
  check(
    "fuzzy_feedback_uses_tilt_without_inactive_pause",
    /case \.fuzzy: return \.turning/.test(source.screenshotAwakeningViews)
      && /case \.inactive:\s+persistPresentationState\(\)/.test(source.screenshotAwakeningViews),
    "Fuzzy feedback should use the head tilt and transient inactive events should not replace the ritual with a paused screen."
  ),
  check(
    "summon_timings_cover_first_next_and_reduced_motion",
    source.screenshotAwakeningViews.includes("[120_000_000, 360_000_000, 470_000_000, 300_000_000, 200_000_000]")
      && source.screenshotAwakeningViews.includes("[80_000_000, 180_000_000, 180_000_000, 140_000_000, 120_000_000]")
      && source.screenshotAwakeningViews.includes("180_000_000"),
    "Summoning must total 1450ms for the first card, 700ms later, and 180ms with Reduce Motion."
  ),
  check(
    "awakening_source_is_feedback_only",
    /if let feedback = response\.feedback \{[\s\S]*V2AnswerFeedbackPanel\([\s\S]*onSource:\s*onSource/.test(source.awakeningViews)
      && !/awakeningQuestionCard[\s\S]*Button\(action:\s*onSource\)/.test(source.awakeningViews),
    "The source entry must appear with answer feedback, not leak evidence before recall."
  ),
  check(
    "awakening_answer_is_server_backed",
    /answerV2AwakeningSession\([\s\S]*selectedOptionId:[\s\S]*attemptId:/.test(source.apiClient)
      && /api\/v2\/awakening-sessions\/.*\/answer/.test(source.apiClient)
      && /apiClient\.answerV2AwakeningSession\(/.test(source.v2Root),
    "Awakening answers must use the server-owned idempotent session endpoint."
  ),
  check(
    "awakening_failed_answer_can_retry",
    /\.onChange\(of:\s*isSubmitting\)[\s\S]*response\.feedback == nil[\s\S]*selectedOptionId = nil/.test(source.awakeningViews),
    "A failed answer submission must unlock the local option state for retry."
  ),
  check(
    "awakening_fixture_keeps_session_identity",
    /answeredResponse\([\s\S]*from current:[\s\S]*sessionId:\s*current\?\.awakeningSession\?\.id/.test(source.awakeningModels),
    "Fixture feedback must retain the current card session identity."
  )
];

console.log("# V2 UI Regression Guard");
for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name} - ${item.detail}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error("");
  console.error(`V2 UI regression guard failed: ${failed.map((item) => item.name).join(", ")}`);
  process.exit(1);
}

function check(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

function extractMatchingCardSource(fileSource) {
  const start = fileSource.indexOf("struct V2MatchingOptionCard");
  const end = fileSource.indexOf("struct V2AnswerFeedbackPanel");
  if (start < 0 || end < 0 || end <= start) return fileSource;
  return fileSource.slice(start, end);
}

function extractMatchingCardPrivateMetrics(fileSource) {
  const matchingCard = extractMatchingCardSource(fileSource);
  return /private enum Metrics \{([\s\S]*?)\n    \}/.exec(matchingCard)?.[1] || "";
}

function extractMatchingScreenSource(fileSource) {
  const start = fileSource.indexOf("struct V2MatchingQuestionView");
  const end = fileSource.indexOf("private enum V2QuestionFeedbackMetrics");
  if (start < 0 || end < 0 || end <= start) return fileSource;
  return fileSource.slice(start, end);
}
