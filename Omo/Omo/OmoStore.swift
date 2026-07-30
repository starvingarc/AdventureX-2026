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
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-OmoLibraryDetailFixture") {
            cards = ProcessInfo.processInfo.arguments.contains("-OmoLibraryDetailScreenshotOnly")
                ? Array(Self.libraryDetailFixtures.reversed())
                : Self.libraryDetailFixtures
            message = ""
            return
        }
        #endif
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

#if DEBUG
private extension OmoStore {
    static let libraryDetailFixtures = [
        MemoryCard(
            id: "library-detail-verified",
            generationMode: "qwen",
            coreKnowledge: "传统搜索依赖精确关键词，而视觉模型可以先从截图恢复标题、作者与内容位置，再用受限来源查询核对候选内容。",
            recallCue: "如何从一张社媒截图恢复可靠来源？",
            answer: "先识别截图中的身份线索，再对候选来源进行标题与作者的严格匹配。",
            explanation: "只有候选内容与截图证据一致时才标记为已核验；匹配不足时应保留为截图来源，不能补造链接或作者。这里使用较长文本检查详情页在小屏和大字号下的换行、滚动与阅读顺序。",
            sourceTitle: "告别信息差，AI + 投行分析框架",
            sourceAccount: "Xuan_酱",
            sourcePlatform: "bilibili",
            sourceUrl: "https://www.bilibili.com/video/BV1fixture",
            sourceStatus: "verified",
            sourceProvider: "tikhub",
            sourceReason: nil,
            sourceConfidence: 0.98,
            rarity: "SR",
            createdAt: "2026-07-30T08:00:00Z",
            masteryStage: "awakened",
            nextReviewAt: "2026-08-01T08:00:00Z",
            reviewCount: 2,
            successfulRecallCount: 1,
            lastAssessment: .fuzzy
        ),
        MemoryCard(
            id: "library-detail-screenshot",
            generationMode: "qwen",
            coreKnowledge: "证据不足时，卡片只能诚实地保留截图内容。",
            recallCue: "来源没有核验成功时应该怎样展示？",
            answer: "显示仅依据截图，不提供伪造的原文入口。",
            explanation: "这张合成 Fixture 专门验证缺失来源的降级表现。",
            sourceTitle: "截图内容",
            sourceAccount: nil,
            sourcePlatform: "unknown",
            sourceUrl: nil,
            sourceStatus: "screenshot_only",
            sourceProvider: "tikhub",
            sourceReason: "strict_match_not_found",
            sourceConfidence: 0,
            rarity: "R",
            createdAt: "2026-07-29T08:00:00Z",
            masteryStage: "sealed",
            nextReviewAt: "2026-07-30T08:00:00Z",
            reviewCount: 0,
            successfulRecallCount: 0,
            lastAssessment: nil
        )
    ]
}
#endif

private enum ImageError: LocalizedError {
    case invalid

    var errorDescription: String? { "无法读取这张图片，请换一张截图。" }
}
