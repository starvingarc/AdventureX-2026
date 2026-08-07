import Foundation
import UserNotifications

final class RecallNotificationRouter: NSObject, ObservableObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    @Published private(set) var cardID: String?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func consume(_ consumedCardID: String) {
        guard cardID == consumedCardID else { return }
        cardID = nil
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let cardID = response.notification.request.content.userInfo["cardID"] as? String,
              !cardID.isEmpty else { return }
        await MainActor.run { self.cardID = cardID }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }
}
