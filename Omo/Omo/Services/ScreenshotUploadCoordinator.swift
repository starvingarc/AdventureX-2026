import Combine
import Foundation

@MainActor
final class ScreenshotUploadCoordinator: ObservableObject {
    enum Phase: Equatable {
        case idle
        case awaitingConsent
        case submitting
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var errorMessage = ""
    private var pendingImageData: Data?

    var needsConsent: Bool { phase == .awaitingConsent }
    var isSubmitting: Bool { phase == .submitting }

    func receive(_ data: Data, hasConsent: Bool) {
        guard !data.isEmpty else {
            errorMessage = "无法读取这张图片。"
            phase = .idle
            return
        }
        errorMessage = ""
        pendingImageData = data
        phase = hasConsent ? .submitting : .awaitingConsent
    }

    func submitReceived(
        using submit: (Data) async -> Bool
    ) async -> Bool {
        guard phase == .submitting, let data = pendingImageData else { return false }
        return await finishSubmission(data, using: submit)
    }

    func confirmConsent(
        using submit: (Data) async -> Bool
    ) async -> Bool {
        guard phase == .awaitingConsent, let data = pendingImageData else { return false }
        phase = .submitting
        return await finishSubmission(data, using: submit)
    }

    func cancelConsent() {
        pendingImageData = nil
        phase = .idle
    }

    private func finishSubmission(
        _ data: Data,
        using submit: (Data) async -> Bool
    ) async -> Bool {
        let accepted = await submit(data)
        if !accepted { errorMessage = "截图任务未能接收，请重试。" }
        pendingImageData = nil
        phase = .idle
        return accepted
    }
}
