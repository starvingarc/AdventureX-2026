import XCTest
@testable import Omo

final class RecallInteractionStateTests: XCTestCase {
    func testScratchMustReachEightyPercentBeforeRatingAppears() {
        var state = RecallRoundState(cardCount: 2)

        state.updateCoverage(0.79)
        XCTAssertFalse(state.showsRating)
        XCTAssertEqual(state.coverage, 0.79, accuracy: 0.001)

        state.updateCoverage(0.8)
        XCTAssertTrue(state.showsRating)
        XCTAssertEqual(state.coverage, 1)
    }

    func testSuccessfulAssessmentAdvancesAndResealsNextCard() {
        var state = RecallRoundState(cardCount: 2)
        state.updateCoverage(1)
        state.beginSubmission(.remembered)
        state.finishSubmission()

        XCTAssertEqual(state.currentIndex, 1)
        XCTAssertEqual(state.coverage, 0)
        XCTAssertEqual(state.phase, .covered)
        XCTAssertFalse(state.isComplete)
    }

    func testLastAssessmentCompletesRound() {
        var state = RecallRoundState(cardCount: 1)
        state.updateCoverage(1)
        state.beginSubmission(.forgot)
        state.finishSubmission()

        XCTAssertTrue(state.isComplete)
    }

    func testFailedAssessmentCanRetryWithoutAdvancing() {
        var state = RecallRoundState(cardCount: 2)
        state.updateCoverage(1)
        state.beginSubmission(.fuzzy)
        state.failSubmission()

        XCTAssertEqual(state.currentIndex, 0)
        XCTAssertEqual(state.retryAssessment(), .fuzzy)
        XCTAssertEqual(state.phase, .submitting(.fuzzy))
    }

    func testRatingScaleUsesLeftEdgeAsCancelAndThreeAssessmentNodes() {
        XCTAssertNil(RecallRatingScale.nearestAssessment(at: 0))
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 0.28), .forgot)
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 0.62), .fuzzy)
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 1), .remembered)
    }

    func testKnowledgeSegmentsSupportBeginningMiddleAndEndMatches() {
        XCTAssertEqual(
            RecallKnowledgeSegments.make(coreKnowledge: "主动提取能够暴露遗忘", hiddenSemantic: "主动提取"),
            RecallKnowledgeSegments(prefix: "", semantic: "主动提取", suffix: "能够暴露遗忘")
        )
        XCTAssertEqual(
            RecallKnowledgeSegments.make(coreKnowledge: "熟悉感不等于真正掌握", hiddenSemantic: "不等于"),
            RecallKnowledgeSegments(prefix: "熟悉感", semantic: "不等于", suffix: "真正掌握")
        )
        XCTAssertEqual(
            RecallKnowledgeSegments.make(coreKnowledge: "关键机制是认知卸载", hiddenSemantic: "认知卸载"),
            RecallKnowledgeSegments(prefix: "关键机制是", semantic: "认知卸载", suffix: "")
        )
    }

    func testKnowledgeSegmentsUseFirstExactMatchAndRejectInvalidValues() {
        XCTAssertEqual(
            RecallKnowledgeSegments.make(coreKnowledge: "提取后核对，再次提取", hiddenSemantic: "提取"),
            RecallKnowledgeSegments(prefix: "", semantic: "提取", suffix: "后核对，再次提取")
        )
        XCTAssertNil(RecallKnowledgeSegments.make(coreKnowledge: "认知卸载", hiddenSemantic: "认知  卸载"))
        XCTAssertNil(RecallKnowledgeSegments.make(coreKnowledge: "认知卸载", hiddenSemantic: ""))
    }
}
