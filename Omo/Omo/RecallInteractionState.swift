import Foundation

enum RecallCardPhase: Equatable {
    case covered
    case scratching
    case revealed
    case submitting(MemoryAssessment)
    case submissionFailed(MemoryAssessment)
}

struct RecallRoundState: Equatable {
    static let revealThreshold = 0.8

    let cardCount: Int
    private(set) var currentIndex = 0
    private(set) var coverage: Double = 0
    private(set) var phase: RecallCardPhase = .covered

    var isComplete: Bool { currentIndex >= cardCount }
    var showsRating: Bool { phase == .revealed || isSubmissionFailure }
    var canScratch: Bool { phase == .covered || phase == .scratching }

    private var isSubmissionFailure: Bool {
        if case .submissionFailed = phase { return true }
        return false
    }

    mutating func updateCoverage(_ value: Double) {
        guard canScratch else { return }
        coverage = min(1, max(coverage, value))
        if coverage >= Self.revealThreshold {
            coverage = 1
            phase = .revealed
        } else if coverage > 0 {
            phase = .scratching
        }
    }

    mutating func beginSubmission(_ assessment: MemoryAssessment) {
        guard showsRating else { return }
        phase = .submitting(assessment)
    }

    mutating func failSubmission() {
        guard case .submitting(let assessment) = phase else { return }
        phase = .submissionFailed(assessment)
    }

    mutating func retryAssessment() -> MemoryAssessment? {
        guard case .submissionFailed(let assessment) = phase else { return nil }
        phase = .submitting(assessment)
        return assessment
    }

    mutating func finishSubmission() {
        guard case .submitting = phase else { return }
        currentIndex += 1
        coverage = 0
        phase = .covered
    }
}

enum RecallRatingScale {
    static let cancelPosition = 0.0
    static let nodes: [(assessment: MemoryAssessment, position: Double)] = [
        (.forgot, 0.42),
        (.fuzzy, 0.70),
        (.remembered, 0.97)
    ]

    static func nearestAssessment(at position: Double) -> MemoryAssessment? {
        let value = min(1, max(0, position))
        guard value >= nodes[0].position / 2 else { return nil }
        return nodes.min(by: { abs($0.position - value) < abs($1.position - value) })?.assessment
    }

    static func position(for assessment: MemoryAssessment?) -> Double {
        guard let assessment else { return cancelPosition }
        return nodes.first(where: { $0.assessment == assessment })?.position ?? cancelPosition
    }
}
