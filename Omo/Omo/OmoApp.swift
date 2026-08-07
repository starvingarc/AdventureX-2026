import SwiftUI

@main
struct OmoApp: App {
    @StateObject private var store = OmoStore()
    @StateObject private var notificationRouter = RecallNotificationRouter()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.light)
                .onReceive(notificationRouter.$cardID.compactMap { $0 }) { cardID in
                    store.handleRecallNotification(cardID: cardID)
                    notificationRouter.consume(cardID)
                }
        }
    }
}
