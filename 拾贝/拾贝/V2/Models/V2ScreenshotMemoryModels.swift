import Foundation
import UIKit

struct V2CapturedMemoryCard: Identifiable, Equatable {
    let card: ImageFlowMemoryCard
    let screenshotData: Data
    var schedule: ImageFlowReviewSchedule?
    let disposition: CaptureAnalysisDisposition
    var masteryStage: V2MemoryMasteryStage
    var successfulRecallCount: Int
    var reviewCount: Int
    var lastAssessment: V2MemoryAssessment?
    let capturedAt: Date

    var id: String { card.id }

    init(
        card: ImageFlowMemoryCard,
        screenshotData: Data,
        schedule: ImageFlowReviewSchedule? = nil,
        disposition: CaptureAnalysisDisposition? = nil,
        masteryStage: V2MemoryMasteryStage = .sealed,
        successfulRecallCount: Int = 0,
        reviewCount: Int = 0,
        lastAssessment: V2MemoryAssessment? = nil,
        capturedAt: Date = Date()
    ) {
        let resolvedDisposition = disposition
            ?? (card.state == .formal ? .createCard : .archiveOnly)
        let isFormalReviewCard = card.state == .formal && resolvedDisposition == .createCard
        self.card = card
        self.screenshotData = screenshotData
        self.schedule = isFormalReviewCard ? schedule : nil
        self.disposition = resolvedDisposition
        self.masteryStage = isFormalReviewCard ? masteryStage : .sealed
        self.successfulRecallCount = isFormalReviewCard ? successfulRecallCount : 0
        self.reviewCount = isFormalReviewCard ? reviewCount : 0
        self.lastAssessment = isFormalReviewCard ? lastAssessment : nil
        self.capturedAt = capturedAt
    }

    init(record: CaptureMemoryCardRecord) {
        let isFormalReviewCard = record.memoryCard.state == .formal && record.disposition == .createCard
        card = record.memoryCard
        screenshotData = Data()
        schedule = isFormalReviewCard ? record.schedule : nil
        disposition = record.disposition
        masteryStage = isFormalReviewCard ? (V2MemoryMasteryStage(rawServerValue: record.masteryStage) ?? .sealed) : .sealed
        successfulRecallCount = isFormalReviewCard ? (record.successfulRecallCount ?? 0) : 0
        reviewCount = isFormalReviewCard ? (record.reviewCount ?? 0) : 0
        lastAssessment = isFormalReviewCard ? record.lastAssessment.flatMap(V2MemoryAssessment.init(rawValue:)) : nil
        capturedAt = V2ScreenshotDateParser.date(from: record.capturedAt)
            ?? V2ScreenshotDateParser.date(from: record.memoryCard.createdAt)
            ?? Date()
    }

    mutating func apply(
        _ assessment: V2MemoryAssessment,
        schedule updatedSchedule: ImageFlowReviewSchedule,
        serverMastery: CaptureMemoryCardAssessmentResponse.Mastery? = nil
    ) {
        guard card.state == .formal, disposition == .createCard else {
            return
        }
        lastAssessment = assessment
        schedule = updatedSchedule
        if let serverMastery {
            masteryStage = V2MemoryMasteryStage(rawServerValue: serverMastery.after)
                ?? masteryStage.applying(assessment)
            successfulRecallCount = max(0, serverMastery.successfulRecallCount)
            reviewCount = max(0, serverMastery.reviewCount)
        } else {
            if assessment == .remembered {
                successfulRecallCount += 1
            }
            reviewCount += 1
            masteryStage = masteryStage.applying(assessment)
        }
    }

    func reviewCycleKey(scheduleOverride: ImageFlowReviewSchedule? = nil) -> String {
        let nextReviewAt = scheduleOverride?.nextReviewAt
            ?? schedule?.nextReviewAt
            ?? "initial"
        return "\(id)-\(nextReviewAt)"
    }

    func matchesPersistedPresentation(
        cardID: String,
        reviewCycleKey: String
    ) -> Bool {
        cardID == id && reviewCycleKey == self.reviewCycleKey()
    }

    func isEligible(for pool: V2MemoryPool, now: Date = Date()) -> Bool {
        guard card.state == .formal, disposition == .createCard else {
            return false
        }
        switch pool {
        case .due:
            schedule?.isDue(at: now) ?? (lastAssessment == nil)
        case .timeCapsule:
            capturedAt <= now.addingTimeInterval(-30 * 24 * 60 * 60)
        case .fading:
            lastAssessment == .fuzzy || lastAssessment == .forgot
        }
    }
}

extension CaptureMemoryCardAssessmentResponse {
    func canonicalAssessment(fallback: V2MemoryAssessment) -> V2MemoryAssessment {
        V2MemoryAssessment(rawValue: assessment.assessment) ?? fallback
    }
}

enum V2ScreenshotPersistence {
    static let keys = [
        "recallo.v06.currentCardID",
        "recallo.v06.currentIndex",
        "recallo.v06.phase",
        "recallo.v06.revealCoverage",
        "recallo.v06.isRevealed",
        "recallo.v06.scratchPaths",
        "recallo.v06.coveredCells",
        "recallo.v06.assessedReviewCycles",
        "recallo.v06.presentationReviewCycleKey",
        "recallo.v06.assessment",
        "recallo.v06.masteryBefore",
        "recallo.v06.masteryAfter",
        "recallo.v06.scheduleNextReviewAt",
        "recallo.v06.scheduleIntervalDays",
        "recallo.v06.scheduleState",
        "recallo.v06.scheduleStatus"
    ]

    static func clear(from defaults: UserDefaults = .standard) {
        for key in keys {
            defaults.removeObject(forKey: key)
        }
    }
}

enum V2ScreenshotAnalysisState: Equatable {
    case idle
    case preparing
    case analyzing
    case generated(String)
    case failed(String)

    var isBusy: Bool {
        self == .preparing || self == .analyzing
    }
}

enum V2ScreenshotDrawMode: Equatable {
    case single
    case continuous
}

enum V2MemoryPool: String, CaseIterable, Hashable, Identifiable {
    case due
    case timeCapsule = "time_capsule"
    case fading

    var id: String { rawValue }

    var title: String {
        switch self {
        case .due: "今日待唤醒"
        case .timeCapsule: "时间胶囊"
        case .fading: "快要遗忘"
        }
    }

    var subtitle: String {
        switch self {
        case .due: "今天最值得再次想起"
        case .timeCapsule: "来自更久以前的自己"
        case .fading: "优先修复模糊的记忆"
        }
    }

    var symbolName: String {
        switch self {
        case .due: "sparkles"
        case .timeCapsule: "hourglass"
        case .fading: "circle.dashed"
        }
    }
}

enum V2MemoryAssessment: String, Equatable {
    case remembered
    case fuzzy
    case forgot
}

enum V2MemoryMasteryStage: Int, CaseIterable, Equatable {
    case sealed
    case awakened
    case solidified
    case engraved

    var title: String {
        switch self {
        case .sealed: "封存"
        case .awakened: "唤醒"
        case .solidified: "稳固"
        case .engraved: "铭刻"
        }
    }

    init?(rawServerValue: String?) {
        switch rawServerValue {
        case "sealed": self = .sealed
        case "awakened": self = .awakened
        case "solidified", "stable": self = .solidified
        case "engraved": self = .engraved
        default: return nil
        }
    }

    func applying(_ assessment: V2MemoryAssessment) -> V2MemoryMasteryStage {
        if self == .sealed {
            return .awakened
        }
        guard assessment == .remembered else {
            return self
        }
        switch self {
        case .sealed:
            return .awakened
        case .awakened:
            return .solidified
        case .solidified, .engraved:
            return .engraved
        }
    }
}

struct V2ScreenshotDrawSession: Identifiable, Equatable {
    let id = UUID()
    let mode: V2ScreenshotDrawMode
    let pool: V2MemoryPool
    let cards: [V2CapturedMemoryCard]

    static func make(
        mode: V2ScreenshotDrawMode,
        from cards: [V2CapturedMemoryCard],
        pool: V2MemoryPool = .due,
        now: Date = Date()
    ) -> V2ScreenshotDrawSession? {
        let eligibleCards = cards.filter { $0.isEligible(for: pool, now: now) }
        let uniqueCards = eligibleCards.reduce(into: [V2CapturedMemoryCard]()) { result, card in
            if !result.contains(where: { $0.id == card.id }) {
                result.append(card)
            }
        }
        guard !uniqueCards.isEmpty else { return nil }
        let orderedCards = ordered(uniqueCards, for: pool)
        let selected = mode == .single ? Array(orderedCards.prefix(1)) : Array(orderedCards.prefix(10))
        return V2ScreenshotDrawSession(mode: mode, pool: pool, cards: selected)
    }

    private static func ordered(
        _ cards: [V2CapturedMemoryCard],
        for pool: V2MemoryPool
    ) -> [V2CapturedMemoryCard] {
        cards.sorted { lhs, rhs in
            switch pool {
            case .due:
                let lhsDate = lhs.schedule?.nextReviewDate ?? lhs.capturedAt
                let rhsDate = rhs.schedule?.nextReviewDate ?? rhs.capturedAt
                if lhsDate != rhsDate { return lhsDate < rhsDate }
            case .timeCapsule:
                if lhs.capturedAt != rhs.capturedAt { return lhs.capturedAt < rhs.capturedAt }
            case .fading:
                let lhsPriority = fadingPriority(lhs.lastAssessment)
                let rhsPriority = fadingPriority(rhs.lastAssessment)
                if lhsPriority != rhsPriority { return lhsPriority < rhsPriority }
                if lhs.capturedAt != rhs.capturedAt { return lhs.capturedAt < rhs.capturedAt }
            }
            return lhs.id < rhs.id
        }
    }

    private static func fadingPriority(_ assessment: V2MemoryAssessment?) -> Int {
        switch assessment {
        case .forgot: 0
        case .fuzzy: 1
        default: 2
        }
    }
}

private enum V2ScreenshotDateParser {
    static func date(from value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractionalFormatter.date(from: value)
            ?? ISO8601DateFormatter().date(from: value)
    }
}

enum V2ScreenshotImageProcessor {
    static let maximumBytes = 5_500_000
    static let maximumEdge: CGFloat = 2_048

    static func prepare(_ data: Data) throws -> Data {
        guard let image = UIImage(data: data) else {
            throw V2ScreenshotImageError.invalidImage
        }
        let resized = resize(image, maximumEdge: maximumEdge)
        for quality in stride(from: 0.82, through: 0.42, by: -0.08) {
            if let encoded = resized.jpegData(compressionQuality: quality),
               encoded.count <= maximumBytes {
                return encoded
            }
        }
        guard let encoded = resized.jpegData(compressionQuality: 0.32),
              encoded.count <= maximumBytes else {
            throw V2ScreenshotImageError.tooLarge
        }
        return encoded
    }

    private static func resize(_ image: UIImage, maximumEdge: CGFloat) -> UIImage {
        let size = image.size
        let longestEdge = max(size.width, size.height)
        guard longestEdge > maximumEdge, longestEdge > 0 else { return image }
        let scale = maximumEdge / longestEdge
        let targetSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}

enum V2ScreenshotImageError: LocalizedError {
    case invalidImage
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .invalidImage:
            "无法读取这张图片，请换一张截图。"
        case .tooLarge:
            "图片压缩后仍然过大，请先裁剪再试。"
        }
    }
}

enum V2ScreenshotAnalysisError: LocalizedError {
    case missingMemoryCard

    var errorDescription: String? {
        "服务器没有返回可用的记忆卡，请稍后重试。"
    }
}
