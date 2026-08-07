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
    @Published private(set) var speechState: KnowledgeLibrarySpeechState = .idle

    private var allCards: [MemoryCard]
    private let searcher: any KnowledgeLibrarySearching
    private let speechTranscriber: (any KnowledgeLibrarySpeechTranscribing)?
    private var searchTask: Task<Void, Never>?
    private var speechEventsTask: Task<Void, Never>?
    private var requestGeneration = UUID()

    init(
        cards: [MemoryCard],
        searcher: any KnowledgeLibrarySearching,
        speechTranscriber: (any KnowledgeLibrarySpeechTranscribing)? = nil
    ) {
        allCards = cards
        visibleCards = cards
        self.searcher = searcher
        self.speechTranscriber = speechTranscriber
        observeSpeechEvents()
    }

    deinit {
        searchTask?.cancel()
        speechEventsTask?.cancel()
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

    func startOrStopVoice() async {
        guard let speechTranscriber else {
            speechState = .unavailable
            return
        }
        if speechState == .listening {
            speechTranscriber.stop()
        } else {
            await speechTranscriber.start()
        }
    }

    func onDisappear() {
        cancelSearch()
        speechTranscriber?.stop()
    }

    #if DEBUG
    func waitForSearchForTesting() async {
        // Voice events arrive through an AsyncStream. The test may ask to wait
        // immediately after yielding a final transcript, before that event has
        // created the search task on the main actor.
        for _ in 0..<100 {
            if let searchTask {
                await searchTask.value
                return
            }
            await Task.yield()
        }
    }

    func waitForSpeechStateForTesting(_ expectedState: KnowledgeLibrarySpeechState) async {
        for _ in 0..<100 {
            if speechState == expectedState { return }
            await Task.yield()
        }
    }
    #endif

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

    private func observeSpeechEvents() {
        guard let speechTranscriber else { return }
        speechEventsTask = Task { [weak self] in
            for await event in speechTranscriber.events {
                guard !Task.isCancelled else { return }
                self?.handleSpeechEvent(event)
            }
        }
    }

    private func handleSpeechEvent(_ event: KnowledgeLibrarySpeechEvent) {
        switch event {
        case .listening:
            speechState = .listening
        case .transcript(let value, let isFinal):
            query = value
            if isFinal {
                speechState = .idle
                if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    submit()
                }
            }
        case .denied:
            speechState = .denied
        case .unavailable:
            speechState = .unavailable
        case .failed(let message):
            speechState = .failed(message)
        case .stopped:
            speechState = .idle
        }
    }
}
