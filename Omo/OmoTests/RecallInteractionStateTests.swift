import XCTest
import UIKit
@testable import Omo

final class RecallInteractionStateTests: XCTestCase {
    func testNotificationPlanCarriesQuestionAndCardIDWithoutAnswerContent() {
        let card = notificationTestCard()
        let now = Date(timeIntervalSince1970: 1_700_000_000)

        let plan = RecallNotificationPlan(card: card, now: now)

        XCTAssertEqual(plan.title, "你还记得吗？")
        XCTAssertEqual(plan.body, "为什么保存截图反而可能更难记住？")
        XCTAssertEqual(plan.userInfo, ["cardID": "notification-card"])
        XCTAssertGreaterThan(plan.triggerDate, now)
        XCTAssertFalse(plan.title.contains(card.answer))
        XCTAssertFalse(plan.body.contains(card.answer))
        XCTAssertFalse(plan.userInfo.values.contains(card.answer))
        XCTAssertFalse(plan.userInfo.values.contains(card.explanation))
    }

    @MainActor
    func testNotificationRouteReturnsToTodayAndOverlaysTheMatchingCard() {
        let card = notificationTestCard()
        let store = OmoStore()
        store.cards = [card]
        store.selectedTab = .library
        store.presentedCard = card

        store.handleRecallNotification(cardID: card.id)

        XCTAssertEqual(store.selectedTab, .today)
        XCTAssertNil(store.presentedCard)
        XCTAssertEqual(store.notificationRecallCard?.id, card.id)
        XCTAssertNil(store.pendingRecallCardID)
    }

    @MainActor
    func testNotificationRouteWaitsForCardsThenSafelyDropsAnUnknownID() {
        let card = notificationTestCard()
        let store = OmoStore()

        store.handleRecallNotification(cardID: card.id)
        XCTAssertEqual(store.pendingRecallCardID, card.id)
        XCTAssertNil(store.notificationRecallCard)

        store.cards = [card]
        store.resolvePendingRecallNotification()
        XCTAssertEqual(store.notificationRecallCard?.id, card.id)

        store.notificationRecallCard = nil
        store.handleRecallNotification(cardID: "missing-card")
        store.resolvePendingRecallNotification()
        XCTAssertNil(store.notificationRecallCard)
        XCTAssertNil(store.pendingRecallCardID)
    }

    @MainActor
    func testCreateAssessAndDeleteKeepLocalRecallNotificationInSync() async throws {
        let created = notificationTestCard(nextReviewAt: "2026-08-09T08:00:00Z")
        let assessed = notificationTestCard(
            nextReviewAt: "2026-08-12T08:00:00Z",
            reviewCount: 1,
            lastAssessment: .remembered
        )
        let scheduler = NotificationSchedulerSpy()
        let store = OmoStore(
            api: OmoAPIStub(createdCard: created, assessedCard: assessed),
            notificationScheduler: scheduler
        )
        let imageData = try XCTUnwrap(UIImage(systemName: "circle")?.pngData())

        let createdSuccessfully = await store.createCard(from: imageData)
        XCTAssertTrue(createdSuccessfully)
        _ = try await store.assess(created, as: .remembered)
        await store.delete(assessed)

        let snapshot = await scheduler.snapshot()
        XCTAssertEqual(snapshot.scheduled.map(\.nextReviewAt), [
            "2026-08-09T08:00:00Z",
            "2026-08-12T08:00:00Z"
        ])
        XCTAssertEqual(snapshot.cancelledCardIDs, [created.id])
    }

    func testScratchMustReachEightyPercentBeforeRatingAppears() {
        var state = RecallRoundState(cardCount: 2)

        state.updateCoverage(0.79)
        XCTAssertFalse(state.showsRating)
        XCTAssertFalse(state.showsContext)
        XCTAssertEqual(state.coverage, 0.79, accuracy: 0.001)

        state.updateCoverage(0.8)
        XCTAssertTrue(state.showsRating)
        XCTAssertTrue(state.showsContext)
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
        XCTAssertNil(RecallRatingScale.nearestAssessment(at: 0.20))
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 0.42), .forgot)
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 0.70), .fuzzy)
        XCTAssertEqual(RecallRatingScale.nearestAssessment(at: 0.97), .remembered)
        XCTAssertEqual(RecallRatingScale.position(for: nil), 0)
        XCTAssertEqual(RecallRatingScale.position(for: .forgot), 0.42)
        XCTAssertEqual(RecallRatingScale.position(for: .fuzzy), 0.70)
        XCTAssertEqual(RecallRatingScale.position(for: .remembered), 0.97)
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

private func notificationTestCard(
    nextReviewAt: String = "2026-08-08T00:00:00Z",
    reviewCount: Int = 0,
    lastAssessment: MemoryAssessment? = nil
) -> MemoryCard {
    MemoryCard(
        id: "notification-card",
        coreKnowledge: "截图可能削弱记忆，因为它会触发认知卸载。",
        hiddenSemantic: "认知卸载",
        recallCue: "为什么保存截图反而可能更难记住？",
        answer: "认知卸载",
        explanation: "设备替代了主动编码。",
        sourceTitle: "合成测试来源",
        sourceAccount: nil,
        sourcePlatform: nil,
        sourceUrl: nil,
        sourceStatus: "screenshot_only",
        sourceProvider: nil,
        sourceConfidence: nil,
        rarity: "R",
        createdAt: "2026-08-08T00:00:00Z",
        masteryStage: "sealed",
        nextReviewAt: nextReviewAt,
        reviewCount: reviewCount,
        successfulRecallCount: 0,
        lastAssessment: lastAssessment
    )
}

private struct OmoAPIStub: OmoAPIProviding {
    let createdCard: MemoryCard
    let assessedCard: MemoryCard

    func cards() async throws -> [MemoryCard] { [] }
    func createCard(from imageData: Data) async throws -> MemoryCard { createdCard }
    func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws -> MemoryCard {
        assessedCard
    }
    func delete(_ card: MemoryCard) async throws {}
}

private actor NotificationSchedulerSpy: RecallNotificationScheduling {
    private var scheduled: [MemoryCard] = []
    private var cancelledCardIDs: [String] = []

    func schedule(_ card: MemoryCard) async throws {
        scheduled.append(card)
    }

    func cancel(cardID: String) async {
        cancelledCardIDs.append(cardID)
    }

    func snapshot() -> (scheduled: [MemoryCard], cancelledCardIDs: [String]) {
        (scheduled, cancelledCardIDs)
    }
}
