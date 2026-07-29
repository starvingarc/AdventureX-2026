import XCTest
@testable import Omo

final class APIClientDecodingTests: XCTestCase {
    func testMemoryCardDecodesFromMinimalAPIContract() throws {
        let data = #"{"id":"card-1","coreKnowledge":"知识点","recallCue":"提示","answer":"答案","explanation":"解释","sourceTitle":"截图","rarity":"SR","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.id, "card-1")
        XCTAssertEqual(card.rarity, "SR")
        XCTAssertEqual(card.masteryTitle, "封存")
        XCTAssertNil(card.hiddenSemantic)
        XCTAssertFalse(card.isRecallEligible)
    }

    func testMemoryCardDecodesValidatedHiddenSemanticContract() throws {
        let data = #"{"id":"card-2","coreKnowledge":"截图可能削弱记忆，因为它会触发认知卸载。","hiddenSemantic":"认知卸载","recallCue":"为什么保存截图反而更难记住？","answer":"认知卸载","explanation":"设备替代了主动编码。","sourceTitle":"截图与记忆","rarity":"R","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.hiddenSemantic, "认知卸载")
        XCTAssertTrue(card.isRecallEligible)
        XCTAssertEqual(card.knowledgeSegments?.prefix, "截图可能削弱记忆，因为它会触发")
        XCTAssertEqual(card.knowledgeSegments?.semantic, "认知卸载")
        XCTAssertEqual(card.knowledgeSegments?.suffix, "。")
    }
}
