import XCTest
@testable import Omo

final class APIClientDecodingTests: XCTestCase {
    func testMemoryCardDecodesFromMinimalAPIContract() throws {
        let data = #"{"id":"card-1","coreKnowledge":"知识点","recallCue":"提示","answer":"答案","explanation":"解释","sourceTitle":"截图","rarity":"SR","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.id, "card-1")
        XCTAssertEqual(card.rarity, "SR")
        XCTAssertEqual(card.masteryTitle, "封存")
        XCTAssertEqual(card.sourcePresentation, .unavailable)
    }

    func testVerifiedSourceRequiresSafeWebURLAndNonFixtureGeneration() throws {
        let verified = try decodeCard(
            generationMode: "qwen",
            sourceStatus: "verified",
            sourceUrl: "https://www.bilibili.com/video/BV1test"
        )
        XCTAssertEqual(
            verified.sourcePresentation,
            .verified(URL(string: "https://www.bilibili.com/video/BV1test")!)
        )

        let invalidURL = try decodeCard(
            generationMode: "qwen",
            sourceStatus: "verified",
            sourceUrl: "javascript:alert(1)"
        )
        XCTAssertEqual(invalidURL.sourcePresentation, .unavailable)

        let fixture = try decodeCard(
            generationMode: "fixture",
            sourceStatus: "verified",
            sourceUrl: "https://example.com/not-real"
        )
        XCTAssertEqual(fixture.sourcePresentation, .fixture)
    }

    func testScreenshotOnlySourceHasHonestFallback() throws {
        let card = try decodeCard(
            generationMode: "qwen",
            sourceStatus: "screenshot_only",
            sourceUrl: nil
        )
        XCTAssertEqual(card.sourcePresentation, .screenshotOnly)
        XCTAssertFalse(card.sourceIsVerified)
    }

    private func decodeCard(
        generationMode: String,
        sourceStatus: String,
        sourceUrl: String?
    ) throws -> MemoryCard {
        var object: [String: Any] = [
            "id": "card-source",
            "generationMode": generationMode,
            "coreKnowledge": "知识点",
            "recallCue": "提示",
            "answer": "答案",
            "explanation": "解释",
            "sourceTitle": "来源",
            "sourceStatus": sourceStatus,
            "rarity": "R",
            "createdAt": "2026-07-29T00:00:00Z",
            "masteryStage": "sealed",
            "nextReviewAt": "2026-07-29T00:00:00Z",
            "reviewCount": 0,
            "successfulRecallCount": 0,
            "lastAssessment": NSNull()
        ]
        if let sourceUrl { object["sourceUrl"] = sourceUrl }
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(MemoryCard.self, from: data)
    }
}
