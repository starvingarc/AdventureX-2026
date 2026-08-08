import Foundation

enum AIProcessingConsent {
    static let defaultsKey = "omo.ai-processing-consent.v1"

    static func requiresPrompt(hasConsent: Bool) -> Bool {
        !hasConsent
    }
}
