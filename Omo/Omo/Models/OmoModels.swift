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

enum MemoryAssessment: String, Codable, CaseIterable, Identifiable, Hashable {
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

enum MemorySourcePresentation: Equatable {
    case verified(URL)
    case screenshotOnly
    case fixture
    case unavailable
}

struct MemoryCard: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let generationMode: String?
    let coreKnowledge: String
    let recallCue: String
    let answer: String
    let explanation: String
    let sourceTitle: String
    let sourceAccount: String?
    let sourcePlatform: String?
    let sourceUrl: String?
    let sourceStatus: String?
    let sourceProvider: String?
    let sourceReason: String?
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

    var sourcePresentation: MemorySourcePresentation {
        if generationMode == "fixture" { return .fixture }
        if sourceStatus == "verified", let sourceURL { return .verified(sourceURL) }
        if sourceStatus == "screenshot_only" { return .screenshotOnly }
        return .unavailable
    }

    var sourceURL: URL? {
        guard let value = sourceUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: value),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host?.isEmpty == false else { return nil }
        return url
    }

    var sourceIsVerified: Bool {
        if case .verified = sourcePresentation { return true }
        return false
    }

    var sourcePlatformTitle: String? {
        guard let platform = sourcePlatform?.trimmingCharacters(in: .whitespacesAndNewlines),
              !platform.isEmpty, platform != "unknown" else { return nil }
        switch platform.lowercased() {
        case "bilibili": return "Bilibili"
        case "douyin": return "抖音"
        case "xiaohongshu": return "小红书"
        case "wechat": return "微信"
        case "zhihu": return "知乎"
        case "youtube": return "YouTube"
        default: return platform
        }
    }

    var createdAtText: String? {
        guard let date = ISO8601DateFormatter().date(from: createdAt) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
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
