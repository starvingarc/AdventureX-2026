import XCTest
@testable import Omo

final class APIClientDecodingTests: XCTestCase {
    func testReleaseEnvironmentRejectsMissingAPIURLInsteadOfFallingBackToProduction() {
        XCTAssertThrowsError(
            try AppEnvironment.resolveAPIBaseURL(
                infoDictionary: [:],
                processEnvironment: [:],
                allowsDebugLocalhostFallback: false
            )
        ) { error in
            XCTAssertEqual(error as? AppEnvironmentError, .missingAPIBaseURL)
        }
    }

    func testReleaseEnvironmentAcceptsInjectedHTTPSStagingURL() throws {
        for value in [
            "https://omo-testflight-staging.example.com",
            "https://omo-testflight-staging-production.up.railway.app"
        ] {
            let url = try AppEnvironment.resolveAPIBaseURL(
                infoDictionary: ["OmoAPIBaseURL": value],
                processEnvironment: [:],
                allowsDebugLocalhostFallback: false
            )

            XCTAssertEqual(url.absoluteString, value)
        }
    }

    func testReleaseEnvironmentRejectsInsecureAndLegacyProductionURLs() {
        for value in [
            "http://staging.example.com",
            "https://shibei-production.up.railway.app"
        ] {
            XCTAssertThrowsError(
                try AppEnvironment.resolveAPIBaseURL(
                    infoDictionary: ["OmoAPIBaseURL": value],
                    processEnvironment: [:],
                    allowsDebugLocalhostFallback: false
                )
            ) { error in
                XCTAssertEqual(error as? AppEnvironmentError, .invalidAPIBaseURL)
            }
        }
    }

    func testDebugEnvironmentAllowsExplicitOverrideAndLocalFallback() throws {
        let override = try AppEnvironment.resolveAPIBaseURL(
            infoDictionary: [:],
            processEnvironment: ["OMO_API_BASE_URL": "http://127.0.0.1:9999"],
            allowsDebugLocalhostFallback: true
        )
        let fallback = try AppEnvironment.resolveAPIBaseURL(
            infoDictionary: [:],
            processEnvironment: [:],
            allowsDebugLocalhostFallback: true
        )

        XCTAssertEqual(override.absoluteString, "http://127.0.0.1:9999")
        XCTAssertEqual(fallback.absoluteString, "http://127.0.0.1:5174")
    }

    func testMemoryCardDecodesFromMinimalAPIContract() throws {
        let data = #"{"id":"card-1","coreKnowledge":"知识点","recallCue":"提示","answer":"答案","explanation":"解释","sourceTitle":"截图","rarity":"SR","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.id, "card-1")
        XCTAssertEqual(card.rarity, "SR")
        XCTAssertEqual(card.masteryTitle, "封存")
        XCTAssertNil(card.hiddenSemantic)
        XCTAssertFalse(card.isRecallEligible)
    }

    func testMemoryCardDecodesHiddenSemanticAndBuildsExactSegments() throws {
        let data = #"{"id":"card-2","coreKnowledge":"截图可能触发认知卸载。","hiddenSemantic":"认知卸载","recallCue":"为什么截图会影响记忆？","answer":"认知卸载","explanation":"设备替代了主动编码。","sourceTitle":"截图","rarity":"R","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertTrue(card.isRecallEligible)
        XCTAssertEqual(
            card.knowledgeSegments,
            RecallKnowledgeSegments(prefix: "截图可能触发", semantic: "认知卸载", suffix: "。")
        )
    }

    @MainActor
    func testRecallDeckIsEligibleDueAndLimitedToTenCards() throws {
        let store = OmoStore()
        store.cards = try (0..<12).map { try makeCard(id: "valid-\($0)", hiddenSemantic: "知识") }
        store.cards.append(try makeCard(id: "legacy", hiddenSemantic: nil))

        XCTAssertEqual(store.nextRecallDeck.count, 10)
        XCTAssertTrue(store.nextRecallDeck.allSatisfy(\.isRecallEligible))
        XCTAssertFalse(store.nextRecallDeck.contains { $0.id == "legacy" })
    }

    private func makeCard(id: String, hiddenSemantic: String?) throws -> MemoryCard {
        var object: [String: Any] = [
            "id": id,
            "coreKnowledge": "完整知识",
            "recallCue": "提示",
            "answer": hiddenSemantic ?? "旧答案",
            "explanation": "解释",
            "sourceTitle": "截图",
            "rarity": "R",
            "createdAt": "2020-01-01T00:00:00Z",
            "masteryStage": "sealed",
            "nextReviewAt": "2020-01-01T00:00:00Z",
            "reviewCount": 0,
            "successfulRecallCount": 0,
            "lastAssessment": NSNull()
        ]
        if let hiddenSemantic { object["hiddenSemantic"] = hiddenSemantic }
        return try JSONDecoder().decode(
            MemoryCard.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }
}
