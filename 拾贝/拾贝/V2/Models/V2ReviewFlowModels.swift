import Foundation

enum V2AppRoute: Equatable {
    case awakening
    case notifications
    case imageFlowResult
    case generationFailureDetail(chapterID: String)
    case profile
    case generatingChapterDetail(chapterID: String?)
    case chapterDetail(chapterID: String)
    case sourceArticle(chapterID: String)
    case recommendedArticle(articleID: String)
    case chapterOverview(chapterID: String)
    case unitOverview(chapterID: String, unitID: String)
    case question(chapterID: String, unitID: String, questionID: String)
    case savedQuestion(index: Int)
    case savedBackendQuestion(item: V2SavedQuestionDisplayItem)
    case unitSummary(chapterID: String, unitID: String)
    case chapterSummary(chapterID: String)
}

enum V2QuestionKind {
    case multipleChoice
    case trueFalse
    case matching
}

enum V2QuestionOptionState {
    case normal
    case correct
    case wrong
}

enum V2MatchingOptionState {
    case normal
    case selected
    case correct
    case wrong
    case locked
}

enum V2MatchingSide: Equatable {
    case left
    case right
}

struct V2MatchingSelection: Equatable {
    let side: V2MatchingSide
    let pairID: String
}

struct V2MultipleChoiceInteractionState: Equatable {
    var selectedIndex: Int?
    var isFavoriteSaved = false
    var feedbackPanelVisible = true
}

struct V2MatchingInteractionState: Equatable {
    var selected: V2MatchingSelection?
    var leftStates: [String: V2MatchingOptionState] = [:]
    var rightStates: [String: V2MatchingOptionState] = [:]
    var isFavoriteSaved = false
    var feedbackPanelVisible = true
}

struct V2QuestionInteractionState: Equatable {
    var multipleChoice = V2MultipleChoiceInteractionState()
    var matching = V2MatchingInteractionState()
}

enum V2ChapterReviewStatus {
    case generating
    case failed
    case notStarted
    case reviewing
    case completed

    var title: String {
        switch self {
        case .generating: "生成中"
        case .failed: "生成失败"
        case .notStarted: "未学习"
        case .reviewing: "学习中"
        case .completed: "已完成"
        }
    }

    var foregroundColor: V2ColorValue {
        switch self {
        case .generating: V2ColorValue(hex: 0x469CFF)
        case .failed: V2ColorValue(hex: 0xED765C)
        case .notStarted: V2ColorValue(hex: 0x878787)
        case .reviewing: V2ColorValue(hex: 0xC08D26)
        case .completed: V2ColorValue(hex: 0x98A84E)
        }
    }

    var backgroundColor: V2ColorValue {
        switch self {
        case .generating: V2ColorValue(hex: 0xC7E1FF)
        case .failed: V2ColorValue(hex: 0xF8D6CE)
        case .notStarted: V2ColorValue(hex: 0xE9E9E9)
        case .reviewing: V2ColorValue(hex: 0xFCEDC4)
        case .completed: V2ColorValue(hex: 0xE8EBBD)
        }
    }
}

struct V2ColorValue: Equatable {
    let hex: UInt
}

struct V2ReviewChapterData {
    let title: String
    let overview: String
    let sourceTitle: String
    let sourceAuthor: String
    let sourceURL: String
    let sourceBody: [V2SourceArticleBlock]
    let contentBasis: V2SourceContentBasis?
    let units: [V2ReviewUnitData]

    init(
        title: String,
        overview: String,
        sourceTitle: String,
        sourceAuthor: String,
        sourceURL: String,
        sourceBody: [V2SourceArticleBlock],
        contentBasis: V2SourceContentBasis? = nil,
        units: [V2ReviewUnitData]
    ) {
        self.title = title
        self.overview = overview
        self.sourceTitle = sourceTitle
        self.sourceAuthor = sourceAuthor
        self.sourceURL = sourceURL
        self.sourceBody = sourceBody
        self.contentBasis = contentBasis
        self.units = units
    }
}

struct V2SourceContentBasis: Equatable {
    let basis: String
    let message: String
}

struct V2SourceArticleBlock: Identifiable, Equatable {
    enum Kind: Equatable {
        case heading
        case paragraph
        case quote
    }

    let id: String
    let kind: Kind
    let text: String
    let sourceRole: String?
    let startSeconds: Double?
    let endSeconds: Double?

    init(
        id: String,
        kind: Kind,
        text: String,
        sourceRole: String? = nil,
        startSeconds: Double? = nil,
        endSeconds: Double? = nil
    ) {
        self.id = id
        self.kind = kind
        self.text = text
        self.sourceRole = sourceRole
        self.startSeconds = startSeconds
        self.endSeconds = endSeconds
    }
}

struct V2ReviewUnitData: Identifiable, Equatable {
    let id: String
    let title: String
    let overview: String
    let questions: [V2ReviewQuestionData]
    let completionMessage: String
}

struct V2ReviewQuestionData: Identifiable, Equatable {
    let id: String
    let kind: V2QuestionKind
    let title: String
    let prompt: String
    let options: [String]
    let correctOptionIndex: Int?
    let matchingPairs: [V2MatchingPairData]
    let feedback: String
    let sourceAnchorId: String?
    let sourceExcerpt: String
}

struct V2MatchingPairData: Identifiable, Equatable {
    let id: String
    let left: String
    let right: String
}

struct V2SavedQuestionData: Identifiable, Equatable {
    let id: String
    let unitID: String
    let questionID: String
    let title: String
    let source: String
    let type: String
}

struct V2SavedQuestionDisplayItem: Identifiable, Equatable {
    let id: String
    let chapterID: String
    let chapterTitle: String
    let unitID: String
    let unitTitle: String
    let questionID: String
    let title: String
    let source: String
    let type: String
}
