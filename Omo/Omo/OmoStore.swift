import SwiftUI
import UIKit

@MainActor
final class OmoStore: ObservableObject {
    @Published var cards: [MemoryCard] = []
    @Published var selectedTab: OmoTab = .today
    @Published var presentedCard: MemoryCard?
    @Published var pendingCard: MemoryCard?
    @Published var isLoading = false
    @Published var isCreating = false
    @Published var message = ""

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    var dueCards: [MemoryCard] {
        cards.filter(\.isDue).sorted { $0.nextReviewAt < $1.nextReviewAt }
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            cards = try await api.cards()
            message = ""
        } catch {
            message = error.localizedDescription
        }
    }

    func draw() {
        presentedCard = dueCards.first
    }

    func createCard(from data: Data) async -> Bool {
        guard !isCreating else { return false }
        isCreating = true
        defer { isCreating = false }
        do {
            let image = try Self.preparedImage(data)
            let card = try await api.createCard(from: image)
            upsert(card)
            selectedTab = .today
            pendingCard = card
            message = ""
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws -> MemoryCard {
        let updated = try await api.assess(card, as: assessment)
        upsert(updated)
        presentedCard = updated
        return updated
    }

    func delete(_ card: MemoryCard) async {
        do {
            try await api.delete(card)
            cards.removeAll { $0.id == card.id }
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
}

private enum ImageError: LocalizedError {
    case invalid

    var errorDescription: String? { "无法读取这张图片，请换一张截图。" }
}
