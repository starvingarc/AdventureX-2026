import XCTest
@testable import Omo

final class APIClientDecodingTests: XCTestCase {
    func testMemoryCardDecodesFromMinimalAPIContract() throws {
        let data = #"{"id":"card-1","coreKnowledge":"知识点","recallCue":"提示","answer":"答案","explanation":"解释","sourceTitle":"截图","rarity":"SR","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.id, "card-1")
        XCTAssertEqual(card.rarity, "SR")
        XCTAssertEqual(card.masteryTitle, "封存")
    }
}
