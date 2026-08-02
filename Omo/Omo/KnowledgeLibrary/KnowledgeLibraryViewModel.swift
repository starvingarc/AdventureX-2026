import Foundation

enum KnowledgeLibraryResultsState: Equatable {
    case all
    case searching
    case results
    case noResults
    case failed(message: String)
}

@MainActor
final class KnowledgeLibraryViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var state: KnowledgeLibraryResultsState = .all
    @Published private(set) var visibleCards: [MemoryCard]
    @Published var currentPage = 0

    private var allCards: [MemoryCard]
    private let searcher: any KnowledgeLibrarySearching
    private var searchTask: Task<Void, Never>?
    private var requestGeneration = UUID()

    init(cards: [MemoryCard], searcher: any KnowledgeLibrarySearching) {
        allCards = cards
        visibleCards = cards
        self.searcher = searcher
    }

    deinit {
        searchTask?.cancel()
    }

    func updateCards(_ cards: [MemoryCard]) {
        allCards = cards
        switch state {
        case .all:
            visibleCards = cards
        case .results:
            let allowed = Dictionary(cards.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            visibleCards = visibleCards.compactMap { allowed[$0.id] }
            if visibleCards.isEmpty { state = .noResults }
        case .searching, .noResults, .failed:
            break
        }
        currentPage = 0
    }

    func submit() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            clearQuery()
            return
        }

        query = trimmed
        cancelSearch()
        let generation = UUID()
        requestGeneration = generation
        state = .searching
        currentPage = 0
        let request = KnowledgeLibrarySearchRequest(
            query: trimmed,
            candidates: allCards.map(KnowledgeLibrarySearchDocument.init(card:))
        )

        searchTask = Task { [weak self, searcher] in
            do {
                let response = try await searcher.search(request)
                guard !Task.isCancelled else { return }
                self?.apply(response, generation: generation)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self?.apply(error, generation: generation)
            }
        }
    }

    func retry() {
        submit()
    }

    func clearQuery() {
        cancelSearch()
        query = ""
        state = .all
        visibleCards = allCards
        currentPage = 0
    }

    func cancelSearch() {
        searchTask?.cancel()
        searchTask = nil
        requestGeneration = UUID()
    }

    func waitForSearchForTesting() async {
        await searchTask?.value
    }

    private func apply(_ response: KnowledgeLibrarySearchResponse, generation: UUID) {
        guard generation == requestGeneration else { return }
        let cardsByID = Dictionary(allCards.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<String>()
        visibleCards = response.orderedCardIDs.compactMap { id in
            guard seen.insert(id).inserted else { return nil }
            return cardsByID[id]
        }
        state = visibleCards.isEmpty ? .noResults : .results
        currentPage = 0
    }

    private func apply(_ error: Error, generation: UUID) {
        guard generation == requestGeneration else { return }
        let message = (error as? LocalizedError)?.errorDescription
            ?? KnowledgeLibrarySearchError.unavailable.errorDescription
            ?? "暂时无法搜索，请稍后重试。"
        visibleCards = []
        state = .failed(message: message)
        currentPage = 0
    }
}
