import XCTest
@testable import Omo

final class KnowledgeLibrarySearchTests: XCTestCase {
    @MainActor
    func testDefaultDependencyUsesAPIWhileExplicitFixtureUsesMock() {
        let live = KnowledgeLibraryDependencies.makeSearcher(arguments: ["Omo"])
        let fixture = KnowledgeLibraryDependencies.makeSearcher(
            arguments: ["Omo", "-OmoLibraryMockSearch"]
        )

        XCTAssertTrue(live is APIKnowledgeLibrarySearcher)
        XCTAssertTrue(fixture is DebugMockKnowledgeLibrarySearcher)
    }

    func testDebugMockSearchRequiresExplicitFixtureArgument() {
        XCTAssertFalse(KnowledgeLibraryDebugConfiguration.current(arguments: []).usesMockSearch)
        XCTAssertTrue(
            KnowledgeLibraryDebugConfiguration.current(
                arguments: ["Omo", "-OmoLibraryMockSearch"]
            ).usesMockSearch
        )
    }

    @MainActor
    func testBlankQueryRestoresAllCardsAndCancelsSearch() async {
        let cards = [testCard("a", "认知卸载"), testCard("b", "提取练习")]
        let searcher = SearchStub { request in
            try? await Task.sleep(for: .milliseconds(100))
            return .init(orderedCardIDs: [request.candidates[0].id])
        }
        let model = KnowledgeLibraryViewModel(cards: cards, searcher: searcher)

        model.query = "认知"
        model.submit()
        model.query = "   "
        model.submit()
        await Task.yield()

        XCTAssertEqual(model.state, .all)
        XCTAssertEqual(model.visibleCards, cards)
        XCTAssertEqual(model.currentPage, 0)
    }

    @MainActor
    func testLatestRequestWinsWhenOlderResponseFinishesLast() async {
        let cards = [testCard("old", "旧结果"), testCard("new", "新结果")]
        let searcher = SearchStub { request in
            if request.query == "旧" {
                try? await Task.sleep(for: .milliseconds(180))
                return .init(orderedCardIDs: ["old"])
            }
            try? await Task.sleep(for: .milliseconds(20))
            return .init(orderedCardIDs: ["new"])
        }
        let model = KnowledgeLibraryViewModel(cards: cards, searcher: searcher)

        model.query = "旧"
        model.submit()
        model.query = "新"
        model.submit()
        try? await Task.sleep(for: .milliseconds(240))

        XCTAssertEqual(model.state, .results)
        XCTAssertEqual(model.visibleCards.map(\.id), ["new"])
    }

    @MainActor
    func testResultMappingDropsUnknownAndDuplicateIDs() async {
        let cards = [testCard("a", "甲"), testCard("b", "乙")]
        let searcher = SearchStub { _ in
            .init(orderedCardIDs: ["b", "missing", "b", "a"])
        }
        let model = KnowledgeLibraryViewModel(cards: cards, searcher: searcher)

        model.query = "知识"
        model.submit()
        await model.waitForSearchForTesting()

        XCTAssertEqual(model.state, .results)
        XCTAssertEqual(model.visibleCards.map(\.id), ["b", "a"])
    }

    @MainActor
    func testEmptyResponseAndFailureRemainDistinct() async {
        let card = testCard("a", "甲")
        let empty = KnowledgeLibraryViewModel(
            cards: [card],
            searcher: SearchStub { _ in .init(orderedCardIDs: []) }
        )
        empty.query = "没有"
        empty.submit()
        await empty.waitForSearchForTesting()

        XCTAssertEqual(empty.state, .noResults)
        XCTAssertTrue(empty.visibleCards.isEmpty)

        let failed = KnowledgeLibraryViewModel(
            cards: [card],
            searcher: SearchStub { _ in throw KnowledgeLibrarySearchError.unavailable }
        )
        failed.query = "失败"
        failed.submit()
        await failed.waitForSearchForTesting()

        XCTAssertEqual(failed.state, .failed(message: "暂时无法搜索，请稍后重试。"))
        XCTAssertEqual(failed.query, "失败")
    }

    @MainActor
    func testServiceFailureDoesNotLeavePreviousResultsVisible() async {
        let attempts = AttemptCounter()
        let card = testCard("a", "认知卸载")
        let model = KnowledgeLibraryViewModel(
            cards: [card],
            searcher: SearchStub { _ in
                if await attempts.increment() == 1 {
                    return .init(orderedCardIDs: ["a"])
                }
                throw KnowledgeLibrarySearchError.unavailable
            }
        )

        model.query = "第一次"
        model.submit()
        await model.waitForSearchForTesting()
        XCTAssertEqual(model.visibleCards.map(\.id), ["a"])

        model.query = "第二次"
        model.submit()
        await model.waitForSearchForTesting()

        XCTAssertTrue(model.visibleCards.isEmpty)
        XCTAssertEqual(model.state, .failed(message: "暂时无法搜索，请稍后重试。"))
    }

    @MainActor
    func testRetryPreservesQuery() async {
        let attempts = AttemptCounter()
        let model = KnowledgeLibraryViewModel(
            cards: [testCard("a", "认知卸载")],
            searcher: SearchStub { _ in
                if await attempts.increment() == 1 {
                    throw KnowledgeLibrarySearchError.unavailable
                }
                return .init(orderedCardIDs: ["a"])
            }
        )

        model.query = "认知"
        model.submit()
        await model.waitForSearchForTesting()
        model.retry()
        await model.waitForSearchForTesting()

        XCTAssertEqual(model.query, "认知")
        XCTAssertEqual(model.state, .results)
        XCTAssertEqual(model.visibleCards.map(\.id), ["a"])
    }

    @MainActor
    func testFinalVoiceTranscriptUpdatesQueryAndSubmitsExactlyOnce() async {
        let attempts = AttemptCounter()
        let speech = SpeechStub()
        let model = KnowledgeLibraryViewModel(
            cards: [testCard("a", "认知卸载")],
            searcher: SearchStub { _ in
                _ = await attempts.increment()
                return .init(orderedCardIDs: ["a"])
            },
            speechTranscriber: speech
        )

        await model.startOrStopVoice()
        speech.send(.transcript("如何避免认知卸载", isFinal: true))
        await Task.yield()
        await model.waitForSearchForTesting()

        let attemptCount = await attempts.current
        XCTAssertEqual(model.query, "如何避免认知卸载")
        XCTAssertEqual(attemptCount, 1)
        XCTAssertEqual(model.state, .results)
    }

    @MainActor
    func testVoicePermissionFailureDoesNotEraseTypedQuery() async {
        let speech = SpeechStub()
        let model = KnowledgeLibraryViewModel(
            cards: [testCard("a", "认知卸载")],
            searcher: SearchStub { _ in .init(orderedCardIDs: []) },
            speechTranscriber: speech
        )
        model.query = "已经输入的内容"

        await model.startOrStopVoice()
        speech.send(.denied)
        await model.waitForSpeechStateForTesting(.denied)

        XCTAssertEqual(model.query, "已经输入的内容")
        XCTAssertEqual(model.speechState, .denied)
    }

    @MainActor
    func testDisappearStopsListening() async {
        let speech = SpeechStub()
        let model = KnowledgeLibraryViewModel(
            cards: [testCard("a", "认知卸载")],
            searcher: SearchStub { _ in .init(orderedCardIDs: []) },
            speechTranscriber: speech
        )

        await model.startOrStopVoice()
        model.onDisappear()

        XCTAssertEqual(speech.stopCount, 1)
    }

}

private struct SearchStub: KnowledgeLibrarySearching {
    let handler: @Sendable (KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse

    init(_ handler: @escaping @Sendable (KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse) {
        self.handler = handler
    }

    func search(_ request: KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse {
        try await handler(request)
    }
}

private actor AttemptCounter {
    private var value = 0

    func increment() -> Int {
        value += 1
        return value
    }

    var current: Int { value }
}

@MainActor
private final class SpeechStub: KnowledgeLibrarySpeechTranscribing {
    let events: AsyncStream<KnowledgeLibrarySpeechEvent>
    private var continuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
    private(set) var stopCount = 0

    init() {
        var continuation: AsyncStream<KnowledgeLibrarySpeechEvent>.Continuation?
        events = AsyncStream { continuation = $0 }
        self.continuation = continuation
    }

    func start() async {
        continuation?.yield(.listening)
    }

    func stop() {
        stopCount += 1
        continuation?.yield(.stopped)
    }

    func send(_ event: KnowledgeLibrarySpeechEvent) {
        continuation?.yield(event)
    }
}

private func testCard(_ id: String, _ knowledge: String) -> MemoryCard {
    MemoryCard(
        id: id,
        coreKnowledge: knowledge,
        hiddenSemantic: nil,
        recallCue: "你还记得什么？",
        answer: knowledge,
        explanation: "合成测试解释",
        sourceTitle: "合成测试来源",
        sourceAccount: nil,
        sourcePlatform: nil,
        sourceUrl: nil,
        sourceStatus: "screenshot_only",
        sourceProvider: nil,
        sourceConfidence: nil,
        rarity: "R",
        createdAt: "2026-08-03T00:00:00Z",
        masteryStage: "sealed",
        nextReviewAt: "2026-08-03T00:00:00Z",
        reviewCount: 0,
        successfulRecallCount: 0,
        lastAssessment: nil
    )
}
