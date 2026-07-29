import SwiftUI

@main
struct OmoApp: App {
    @StateObject private var store = OmoStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.light)
        }
    }
}
