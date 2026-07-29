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
}
