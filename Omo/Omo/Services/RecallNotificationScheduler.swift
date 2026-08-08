import Foundation
import UserNotifications

protocol RecallNotificationScheduling: Sendable {
    func schedule(_ card: MemoryCard) async throws
    func cancel(cardID: String) async
}

struct RecallNotificationPlan: Equatable, Sendable {
    static let minimumLeadTime: TimeInterval = 60

    let identifier: String
    let title: String
    let body: String
    let userInfo: [String: String]
    let triggerDate: Date

    init(card: MemoryCard, now: Date = Date()) {
        identifier = "omo.recall.\(card.id)"
        title = "你还记得吗？"
        body = card.recallCue
        userInfo = ["cardID": card.id]
        let dueDate = try? Date(card.nextReviewAt, strategy: .iso8601)
        triggerDate = max(dueDate ?? now, now.addingTimeInterval(Self.minimumLeadTime))
    }
}

struct LocalRecallNotificationScheduler: RecallNotificationScheduling, @unchecked Sendable {
    private let center: UNUserNotificationCenter

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    func schedule(_ card: MemoryCard) async throws {
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else { return }

        let plan = RecallNotificationPlan(card: card)
        let content = UNMutableNotificationContent()
        content.title = plan.title
        content.body = plan.body
        content.sound = .default
        content.userInfo = plan.userInfo
        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, plan.triggerDate.timeIntervalSinceNow),
            repeats: false
        )
        center.removePendingNotificationRequests(withIdentifiers: [plan.identifier])
        try await center.add(
            UNNotificationRequest(
                identifier: plan.identifier,
                content: content,
                trigger: trigger
            )
        )
    }

    func cancel(cardID: String) async {
        center.removePendingNotificationRequests(withIdentifiers: ["omo.recall.\(cardID)"])
        center.removeDeliveredNotifications(withIdentifiers: ["omo.recall.\(cardID)"])
    }
}
