import Foundation

struct KnowledgeLibrarySearchDocument: Equatable, Sendable {
    let id: String
    let coreKnowledge: String
    let recallCue: String
    let explanation: String
    let sourceTitle: String

    init(card: MemoryCard) {
        id = card.id
        coreKnowledge = card.coreKnowledge
        recallCue = card.recallCue
        explanation = card.explanation
        sourceTitle = card.sourceTitle
    }
}

struct KnowledgeLibrarySearchRequest: Equatable, Sendable {
    let query: String
    let candidates: [KnowledgeLibrarySearchDocument]
}

struct KnowledgeLibrarySearchResponse: Equatable, Sendable {
    let orderedCardIDs: [String]
}

protocol KnowledgeLibrarySearching: Sendable {
    func search(_ request: KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse
}

enum KnowledgeLibrarySearchError: LocalizedError, Equatable, Sendable {
    case unavailable
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "暂时无法搜索，请稍后重试。"
        case .failed(let message):
            message
        }
    }
}

struct UnavailableKnowledgeLibrarySearcher: KnowledgeLibrarySearching {
    func search(_ request: KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse {
        throw KnowledgeLibrarySearchError.unavailable
    }
}

#if DEBUG
struct DebugMockKnowledgeLibrarySearcher: KnowledgeLibrarySearching {
    enum Mode: Sendable {
        case matching
        case noResults
        case failure
    }

    let mode: Mode
    let delay: Duration

    init(mode: Mode = .matching, delay: Duration = .milliseconds(220)) {
        self.mode = mode
        self.delay = delay
    }

    func search(_ request: KnowledgeLibrarySearchRequest) async throws -> KnowledgeLibrarySearchResponse {
        try await Task.sleep(for: delay)
        switch mode {
        case .noResults:
            return KnowledgeLibrarySearchResponse(orderedCardIDs: [])
        case .failure:
            throw KnowledgeLibrarySearchError.unavailable
        case .matching:
            break
        }

        let query = Self.normalized(request.query)
        guard !query.isEmpty else {
            return KnowledgeLibrarySearchResponse(orderedCardIDs: request.candidates.map(\.id))
        }

        let queryTokens = Self.tokens(query)
        let ranked = request.candidates.compactMap { document -> (String, Int)? in
            let fields = [
                (document.coreKnowledge, 8),
                (document.recallCue, 5),
                (document.explanation, 3),
                (document.sourceTitle, 1)
            ]
            var score = 0
            for (field, weight) in fields {
                let normalized = Self.normalized(field)
                if normalized.contains(query) { score += 30 * weight }
                let overlap = queryTokens.intersection(Self.tokens(normalized)).count
                score += overlap * weight
            }
            return score > 0 ? (document.id, score) : nil
        }
        .sorted { lhs, rhs in
            lhs.1 == rhs.1 ? lhs.0 < rhs.0 : lhs.1 > rhs.1
        }

        return KnowledgeLibrarySearchResponse(orderedCardIDs: ranked.map(\.0))
    }

    private static func normalized(_ value: String) -> String {
        value
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .joined()
            .filter { $0.isLetter || $0.isNumber }
    }

    private static func tokens(_ value: String) -> Set<String> {
        let characters = Array(value)
        var values = Set(characters.map(String.init))
        guard characters.count > 1 else { return values }
        for index in 0..<(characters.count - 1) {
            values.insert(String(characters[index...index + 1]))
        }
        return values
    }
}
#endif
