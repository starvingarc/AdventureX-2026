import CryptoKit
import SwiftUI
import UIKit

enum OmoLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

@MainActor
final class OmoStore: ObservableObject {
    @Published var cards: [MemoryCard] = []
    @Published var selectedTab: OmoTab = .today
    @Published var presentedCard: MemoryCard?
    @Published var pendingCard: MemoryCard?
    @Published var notificationRecallCard: MemoryCard?
    @Published private(set) var screenshotJobs: [ScreenshotJob] = []
    @Published private(set) var pendingRecallCardID: String?
    @Published private(set) var loadState: OmoLoadState = .idle
    @Published var message = ""

    private let api: any OmoAPIProviding
    private let notificationScheduler: any RecallNotificationScheduling
    private let screenshotJobCache: any ScreenshotJobPersisting
    private var screenshotPollingTasks: [String: Task<Void, Never>] = [:]

    init(
        api: any OmoAPIProviding = APIClient(),
        notificationScheduler: any RecallNotificationScheduling = LocalRecallNotificationScheduler(),
        screenshotJobCache: any ScreenshotJobPersisting = ScreenshotJobCache()
    ) {
        self.api = api
        self.notificationScheduler = notificationScheduler
        self.screenshotJobCache = screenshotJobCache
    }

    var dueCards: [MemoryCard] {
        cards
            .filter { $0.isDue && $0.isRecallEligible }
            .sorted { $0.nextReviewAt < $1.nextReviewAt }
    }

    var nextRecallDeck: [MemoryCard] {
        Array(dueCards.prefix(10))
    }

    var activeScreenshotJobs: [ScreenshotJob] {
        screenshotJobs.filter(\.isActive)
    }

    var failedScreenshotJobs: [ScreenshotJob] {
        screenshotJobs.filter { $0.state == .failed }
    }

    func load() async {
        guard loadState != .loading else { return }
        loadState = .loading
        let cachedJobs = (try? await screenshotJobCache.loadJobs()) ?? []
        screenshotJobs = cachedJobs
        do {
            async let loadedCards = api.cards()
            async let loadedJobs = api.screenshotJobs()
            cards = try await loadedCards
            let serverJobs = try await loadedJobs
            mergeScreenshotJobs(serverJobs, cachedJobs: cachedJobs)
            for job in serverJobs {
                try? await screenshotJobCache.update(job: job)
                if job.state == .succeeded {
                    try? await screenshotJobCache.removeImage(for: job.id)
                }
            }
            await resumeLocalJobsMissingFromServer(serverJobIDs: Set(serverJobs.map(\.id)))
            for job in screenshotJobs where job.isActive { startPolling(job.id) }
            resolvePendingRecallNotification()
            message = ""
            loadState = .loaded
        } catch {
            message = error.localizedDescription
            loadState = .failed(error.localizedDescription)
        }
    }

    func draw() {
        presentedCard = dueCards.first
    }

    func handleRecallNotification(cardID: String) {
        selectedTab = .today
        presentedCard = nil
        if let card = cards.first(where: { $0.id == cardID && $0.isRecallEligible }) {
            notificationRecallCard = card
            pendingRecallCardID = nil
        } else {
            notificationRecallCard = nil
            pendingRecallCardID = cardID
        }
    }

    func resolvePendingRecallNotification() {
        guard let cardID = pendingRecallCardID else { return }
        pendingRecallCardID = nil
        guard let card = cards.first(where: { $0.id == cardID && $0.isRecallEligible }) else {
            notificationRecallCard = nil
            return
        }
        notificationRecallCard = card
    }

    func createCard(from data: Data) async -> Bool {
        let image: Data
        do {
            image = try Self.preparedImage(data)
        } catch {
            message = error.localizedDescription
            return false
        }

        let optimistic = Self.optimisticScreenshotJob(for: image)
        upsert(optimistic)
        do {
            try await screenshotJobCache.save(job: optimistic, imageData: image)
            let accepted = try await api.createScreenshotJob(from: image)
            if accepted.id != optimistic.id {
                try? await screenshotJobCache.removeJob(for: optimistic.id)
                screenshotJobs.removeAll { $0.id == optimistic.id }
                try await screenshotJobCache.save(job: accepted, imageData: image)
            } else {
                try await screenshotJobCache.update(job: accepted)
            }
            upsert(accepted)
            selectedTab = .today
            message = ""
            startPolling(accepted.id)
            return true
        } catch {
            var failed = optimistic
            failed.state = .failed
            failed.updatedAt = ISO8601DateFormatter().string(from: Date())
            failed.errorCode = "submission_failed"
            failed.errorMessage = error.localizedDescription
            failed.retryable = true
            upsert(failed)
            try? await screenshotJobCache.update(job: failed)
            message = failed.errorMessage
            return false
        }
    }

    func retryScreenshotJob(_ job: ScreenshotJob) async -> Bool {
        guard job.canRetry,
              let image = try? await screenshotJobCache.imageData(for: job.id) else {
            message = "原截图已不可用，请重新选择截图。"
            return false
        }
        do {
            let accepted = try await api.retryScreenshotJob(id: job.id, imageData: image)
            upsert(accepted)
            try? await screenshotJobCache.update(job: accepted)
            message = ""
            startPolling(accepted.id)
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func refreshScreenshotJobs() async {
        do {
            let jobs = try await api.screenshotJobs()
            mergeScreenshotJobs(jobs, cachedJobs: screenshotJobs)
            for job in jobs {
                try? await screenshotJobCache.update(job: job)
                if job.state == .succeeded {
                    try? await screenshotJobCache.removeImage(for: job.id)
                } else if job.isActive {
                    startPolling(job.id)
                }
            }
            await refreshCardsAfterCompletedJobs(jobs)
        } catch {
            message = error.localizedDescription
        }
    }

    func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws -> MemoryCard {
        #if DEBUG || OMO_TESTING
        if Self.usesSuccessfulAssessmentFixture {
            var updated = card
            updated.nextReviewAt = "2100-01-01T00:00:00Z"
            updated.reviewCount += 1
            updated.successfulRecallCount += assessment == .remembered ? 1 : 0
            updated.lastAssessment = assessment
            upsert(updated)
            return updated
        }
        #endif
        let updated = try await api.assess(card, as: assessment)
        upsert(updated)
        try? await notificationScheduler.schedule(updated)
        return updated
    }

    func delete(_ card: MemoryCard) async {
        do {
            try await api.delete(card)
            cards.removeAll { $0.id == card.id }
            await notificationScheduler.cancel(cardID: card.id)
            message = ""
        } catch {
            message = error.localizedDescription
        }
    }

    private func upsert(_ card: MemoryCard) {
        if let index = cards.firstIndex(where: { $0.id == card.id }) {
            cards[index] = card
        } else {
            cards.insert(card, at: 0)
        }
    }

    private func upsert(_ job: ScreenshotJob) {
        if let index = screenshotJobs.firstIndex(where: { $0.id == job.id }) {
            screenshotJobs[index] = job
        } else {
            screenshotJobs.insert(job, at: 0)
        }
    }

    private func mergeScreenshotJobs(
        _ serverJobs: [ScreenshotJob],
        cachedJobs: [ScreenshotJob]
    ) {
        let serverByID = Dictionary(
            serverJobs.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let localOnly = cachedJobs.filter { serverByID[$0.id] == nil }
        screenshotJobs = (serverJobs + localOnly).sorted { $0.createdAt > $1.createdAt }
    }

    private func resumeLocalJobsMissingFromServer(serverJobIDs: Set<String>) async {
        let localJobs = screenshotJobs.filter {
            $0.isActive && !serverJobIDs.contains($0.id)
        }
        for job in localJobs {
            guard let image = try? await screenshotJobCache.imageData(for: job.id) else {
                continue
            }
            do {
                let accepted = try await api.createScreenshotJob(from: image)
                upsert(accepted)
                try? await screenshotJobCache.update(job: accepted)
            } catch {
                var failed = job
                failed.state = .failed
                failed.updatedAt = ISO8601DateFormatter().string(from: Date())
                failed.errorCode = "submission_failed"
                failed.errorMessage = error.localizedDescription
                failed.retryable = true
                upsert(failed)
                try? await screenshotJobCache.update(job: failed)
            }
        }
    }

    private func startPolling(_ jobID: String) {
        guard screenshotPollingTasks[jobID] == nil else { return }
        screenshotPollingTasks[jobID] = Task { [weak self] in
            guard let self else { return }
            defer { screenshotPollingTasks[jobID] = nil }
            for attempt in 0..<600 {
                if attempt > 0 {
                    try? await Task.sleep(for: .seconds(2))
                    guard !Task.isCancelled else { return }
                }
                do {
                    let job = try await api.screenshotJob(id: jobID)
                    upsert(job)
                    try? await screenshotJobCache.update(job: job)
                    if job.state == .succeeded {
                        try? await screenshotJobCache.removeImage(for: job.id)
                        await refreshCardsAfterCompletedJobs([job])
                        return
                    }
                    if job.state == .failed { return }
                } catch {
                    if attempt == 599 { message = error.localizedDescription }
                }
            }
        }
    }

    private func refreshCardsAfterCompletedJobs(_ jobs: [ScreenshotJob]) async {
        let completedIDs = Set(
            jobs.filter { $0.state == .succeeded }.map(\.cardId).filter { !$0.isEmpty }
        )
        guard !completedIDs.isEmpty else { return }
        guard let refreshed = try? await api.cards() else { return }
        let previousIDs = Set(cards.map(\.id))
        cards = refreshed
        for card in refreshed where completedIDs.contains(card.id) && !previousIDs.contains(card.id) {
            try? await notificationScheduler.schedule(card)
        }
    }

    private static func optimisticScreenshotJob(for image: Data) -> ScreenshotJob {
        let base64 = image.base64EncodedString()
        let digest = SHA256.hash(data: Data(base64.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let now = ISO8601DateFormatter().string(from: Date())
        return ScreenshotJob(
            id: "job-\(digest.prefix(20))",
            state: .accepted,
            createdAt: now,
            updatedAt: now,
            attemptCount: 0,
            cardId: "",
            errorCode: "",
            errorMessage: "",
            retryable: false
        )
    }

    private static func preparedImage(_ data: Data) throws -> Data {
        guard let image = UIImage(data: data) else { throw ImageError.invalid }
        let maximumEdge: CGFloat = 2048
        let longest = max(image.size.width, image.size.height)
        let scale = min(1, maximumEdge / max(1, longest))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.72) else {
            throw ImageError.invalid
        }
        return jpeg
    }

    #if DEBUG || OMO_TESTING
    private static var usesSuccessfulAssessmentFixture: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-OmoAssessmentFixture"),
              arguments.indices.contains(index + 1) else { return false }
        return arguments[index + 1] == "success"
    }

    func applyScreenshotJobDebugArguments(_ arguments: [String]) {
        guard let index = arguments.firstIndex(of: "-OmoScreenshotJobFixture"),
              arguments.indices.contains(index + 1) else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        switch arguments[index + 1] {
        case "active":
            screenshotJobs = [ScreenshotJob(
                id: "job-ui-active",
                state: .processing,
                createdAt: now,
                updatedAt: now,
                attemptCount: 1,
                cardId: "",
                errorCode: "",
                errorMessage: "",
                retryable: false
            )]
        case "failed":
            screenshotJobs = [ScreenshotJob(
                id: "job-ui-failed",
                state: .failed,
                createdAt: now,
                updatedAt: now,
                attemptCount: 1,
                cardId: "",
                errorCode: "model_timeout",
                errorMessage: "截图处理超时，请重试。",
                retryable: true
            )]
        default:
            break
        }
    }
    #endif
}

private enum ImageError: LocalizedError {
    case invalid

    var errorDescription: String? { "无法读取这张图片，请换一张截图。" }
}
