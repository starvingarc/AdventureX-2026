import CoreGraphics

enum V2HomeTab: CaseIterable, Identifiable {
    case learning
    case materials
    case upload
    case discover
    case notes

    var id: Self { self }

    static let visibleTabs: [V2HomeTab] = [.learning, .materials, .notes]

    var title: String {
        switch self {
        case .learning: "今日"
        case .materials: "知识库"
        case .upload: ""
        case .discover: "发现"
        case .notes: "我的"
        }
    }

    var inactiveAssetName: String? {
        switch self {
        case .learning: "V2NavLearningInactive"
        case .materials: "V2NavMaterialsInactive"
        case .upload: nil
        case .discover: "V2NavDiscoverInactive"
        case .notes: "TabProfileOutline"
        }
    }

    var selectedAssetName: String? {
        switch self {
        case .learning: "V2NavLearningSelected"
        case .materials: "V2NavMaterialsSelected"
        case .upload: nil
        case .discover: "V2NavDiscoverSelected"
        case .notes: "TabProfileFilled"
        }
    }
}

enum V2LearningPathNodeKind {
    case start
    case unit
}

enum V2LearningPathNodeState {
    case start
    case completed
    case current
    case inProgress
    case locked
}

enum V2LearningPathNodeAction {
    case mainline
    case practice
    case previewOnly
}

struct V2CurrentChapterData {
    let eyebrow: String
    let title: String
}

struct V2LearningPathNodeData: Identifiable, Equatable {
    let id: String
    let title: String
    let subtitle: String
    let kind: V2LearningPathNodeKind
    let state: V2LearningPathNodeState
    let action: V2LearningPathNodeAction
    let completedQuestionCount: Int
    let totalQuestionCount: Int
    let position: CGPoint
}

struct V2HomeData {
    let currentChapter: V2CurrentChapterData
    let nodes: [V2LearningPathNodeData]
    let currentNodeID: V2LearningPathNodeData.ID

    init(
        currentChapter: V2CurrentChapterData,
        nodes: [V2LearningPathNodeData],
        currentNodeID: V2LearningPathNodeData.ID
    ) {
        self.currentChapter = currentChapter
        self.nodes = nodes
        self.currentNodeID = currentNodeID
    }

    init(chapter: V2ReviewChapterData) {
        self.init(chapter: chapter, reviewSession: nil)
    }

    init(chapter: V2ReviewChapterData, reviewSession: V2BackendReviewSession?) {
        let currentNodeID = V2HomeData.currentNodeID(for: chapter, reviewSession: reviewSession)
        let completedUnitIDs = V2HomeData.completedUnitIDs(for: chapter, reviewSession: reviewSession)
        let completedQuestionCounts = V2HomeData.completedQuestionCounts(for: chapter, reviewSession: reviewSession)
        let startedUnitIDs = V2HomeData.startedUnitIDs(
            for: chapter,
            reviewSession: reviewSession,
            completedQuestionCounts: completedQuestionCounts
        )
        let startNode = V2LearningPathNodeData(
            id: "start",
            title: "开始",
            subtitle: "章节概要",
            kind: .start,
            state: currentNodeID == "start" ? .current : .completed,
            action: .mainline,
            completedQuestionCount: 0,
            totalQuestionCount: 0,
            position: CGPoint(x: 0.66, y: 0.88)
        )

        let unitNodes = chapter.units.enumerated().map { index, unit in
            V2LearningPathNodeData(
                id: unit.id,
                title: "单元\(index + 1)",
                subtitle: unit.title,
                kind: .unit,
                state: V2HomeData.nodeState(
                    unitID: unit.id,
                    currentNodeID: currentNodeID,
                    completedUnitIDs: completedUnitIDs,
                    startedUnitIDs: startedUnitIDs
                ),
                action: V2HomeData.nodeAction(
                    unitID: unit.id,
                    currentNodeID: currentNodeID,
                    completedUnitIDs: completedUnitIDs,
                    startedUnitIDs: startedUnitIDs,
                    isChapterCompleted: reviewSession?.completedAt != nil
                ),
                completedQuestionCount: completedQuestionCounts[unit.id, default: 0],
                totalQuestionCount: unit.questions.count,
                position: CGPoint(x: 0, y: 0)
            )
        }

        self.currentChapter = V2CurrentChapterData(
            eyebrow: "当前章节",
            title: chapter.title
        )
        self.nodes = [startNode] + unitNodes
        self.currentNodeID = currentNodeID
    }

    var isEmpty: Bool {
        nodes.isEmpty
    }

    var initialViewportAnchorNodeID: V2LearningPathNodeData.ID {
        guard let currentIndex = nodes.firstIndex(where: { $0.id == currentNodeID }) else {
            return currentNodeID
        }

        let lastBottomEligibleIndex = max(0, nodes.count - 3)
        let anchorIndex = min(currentIndex, lastBottomEligibleIndex)
        return nodes[anchorIndex].id
    }

    private static func currentNodeID(
        for chapter: V2ReviewChapterData,
        reviewSession: V2BackendReviewSession?
    ) -> String {
        guard let reviewSession else {
            return chapter.units.first?.id ?? "start"
        }

        if reviewSession.completedAt != nil {
            return chapter.units.last?.id ?? "start"
        }

        let displayCard = reviewSession.displayCard

        if displayCard.type == "chapter_overview" {
            return "start"
        }

        if let unitID = displayCard.unitId,
           chapter.units.contains(where: { $0.id == unitID }) {
            return unitID
        }

        return chapter.units.first?.id ?? "start"
    }

    private static func completedUnitIDs(
        for chapter: V2ReviewChapterData,
        reviewSession: V2BackendReviewSession?
    ) -> Set<String> {
        guard let reviewSession else {
            return []
        }

        if reviewSession.completedAt != nil {
            return Set(chapter.units.map(\.id))
        }

        let unitIDs = Set(chapter.units.map(\.id))
        return Set(
            reviewSession.completedStepIds.compactMap { stepID in
                guard stepID.hasSuffix(":summary"),
                      let separatorIndex = stepID.firstIndex(of: ":") else {
                    return nil
                }
                let unitID = String(stepID[..<separatorIndex])
                return unitIDs.contains(unitID) ? unitID : nil
            }
        )
    }

    private static func completedQuestionCounts(
        for chapter: V2ReviewChapterData,
        reviewSession: V2BackendReviewSession?
    ) -> [String: Int] {
        guard let reviewSession else {
            return [:]
        }

        let questionIDsByUnitID = Dictionary(
            uniqueKeysWithValues: chapter.units.map { unit in
                (unit.id, Set(unit.questions.map(\.id)))
            }
        )
        var counts: [String: Int] = [:]

        for stepID in reviewSession.completedStepIds {
            guard let separatorIndex = stepID.firstIndex(of: ":") else {
                continue
            }
            let unitID = String(stepID[..<separatorIndex])
            let questionID = String(stepID[stepID.index(after: separatorIndex)...])
            guard questionIDsByUnitID[unitID]?.contains(questionID) == true else {
                continue
            }
            counts[unitID, default: 0] += 1
        }

        return counts
    }

    private static func startedUnitIDs(
        for chapter: V2ReviewChapterData,
        reviewSession: V2BackendReviewSession?,
        completedQuestionCounts: [String: Int]
    ) -> Set<String> {
        guard let reviewSession else {
            return []
        }

        let unitIDs = Set(chapter.units.map(\.id))
        let overviewStartedUnitIDs = reviewSession.completedStepIds.compactMap { stepID -> String? in
            guard stepID.hasSuffix(":overview"),
                  let separatorIndex = stepID.firstIndex(of: ":") else {
                return nil
            }
            let unitID = String(stepID[..<separatorIndex])
            return unitIDs.contains(unitID) ? unitID : nil
        }
        let questionStartedUnitIDs = completedQuestionCounts
            .filter { $0.value > 0 }
            .map { $0.key }

        return Set(overviewStartedUnitIDs + questionStartedUnitIDs)
    }

    private static func nodeState(
        unitID: String,
        currentNodeID: String,
        completedUnitIDs: Set<String>,
        startedUnitIDs: Set<String>
    ) -> V2LearningPathNodeState {
        if completedUnitIDs.contains(unitID) {
            return .completed
        }

        if unitID == currentNodeID {
            return .current
        }

        if startedUnitIDs.contains(unitID) {
            return .inProgress
        }

        return .locked
    }

    private static func nodeAction(
        unitID: String,
        currentNodeID: String,
        completedUnitIDs: Set<String>,
        startedUnitIDs: Set<String>,
        isChapterCompleted: Bool
    ) -> V2LearningPathNodeAction {
        if isChapterCompleted {
            return .practice
        }

        if unitID == currentNodeID {
            return .mainline
        }

        if completedUnitIDs.contains(unitID) || startedUnitIDs.contains(unitID) {
            return .practice
        }

        return .previewOnly
    }
}
