import Foundation

enum OmoTab: String, CaseIterable, Identifiable {
    case today
    case library
    case profile

    var id: Self { self }

    var title: String {
        switch self {
        case .today: "今日"
        case .library: "知识库"
        case .profile: "我的"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sparkles"
        case .library: "books.vertical"
        case .profile: "person"
        }
    }
}

enum MemoryAssessment: String, Codable, CaseIterable, Identifiable {
    case remembered
    case fuzzy
    case forgot

    var id: Self { self }

    var title: String {
        switch self {
        case .remembered: "记得"
        case .fuzzy: "模糊"
        case .forgot: "忘记"
        }
    }
}

struct MemoryCard: Codable, Identifiable, Equatable {
    let id: String
    let coreKnowledge: String
    let hiddenSemantic: String?
    let recallCue: String
    let answer: String
    let explanation: String
    let sourceTitle: String
    let sourceAccount: String?
    let sourcePlatform: String?
    let sourceUrl: String?
    let sourceStatus: String?
    let sourceProvider: String?
    let sourceConfidence: Double?
    let rarity: String
    let createdAt: String
    var masteryStage: String
    var nextReviewAt: String
    var reviewCount: Int
    var successfulRecallCount: Int
    var lastAssessment: MemoryAssessment?

    var masteryTitle: String {
        switch masteryStage {
        case "awakened": "唤醒"
        case "solidified": "稳固"
        case "engraved": "铭刻"
        default: "封存"
        }
    }

    var isDue: Bool {
        guard let date = ISO8601DateFormatter().date(from: nextReviewAt) else { return true }
        return date <= Date()
    }

    var nextReviewText: String {
        guard let date = ISO8601DateFormatter().date(from: nextReviewAt) else {
            return "等待安排"
        }
        if date <= Date() { return "现在可以唤醒" }
        return date.formatted(date: .abbreviated, time: .omitted) + " 再见"
    }

    var sourceIsVerified: Bool { sourceStatus == "verified" && sourceUrl?.isEmpty == false }

    var knowledgeSegments: RecallKnowledgeSegments? {
        RecallKnowledgeSegments.make(
            coreKnowledge: coreKnowledge,
            hiddenSemantic: hiddenSemantic
        )
    }

    var isRecallEligible: Bool { knowledgeSegments != nil }
}

struct RecallKnowledgeSegments: Equatable {
    let prefix: String
    let semantic: String
    let suffix: String

    static func make(coreKnowledge: String, hiddenSemantic: String?) -> Self? {
        let semantic = hiddenSemantic?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !semantic.isEmpty,
              let range = coreKnowledge.range(of: semantic) else {
            return nil
        }
        return Self(
            prefix: String(coreKnowledge[..<range.lowerBound]),
            semantic: semantic,
            suffix: String(coreKnowledge[range.upperBound...])
        )
    }
}

struct CardsResponse: Decodable {
    let cards: [MemoryCard]
}

struct CardResponse: Decodable {
    let card: MemoryCard
}

struct DeleteResponse: Decodable {
    let deleted: Bool
    let cardId: String
}

struct ScreenshotRequest: Encodable {
    let imageBase64: String
    let mimeType: String
}

struct AssessmentRequest: Encodable {
    let assessment: MemoryAssessment
    let attemptId: String
}
