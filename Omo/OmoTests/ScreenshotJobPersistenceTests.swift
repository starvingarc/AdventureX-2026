import XCTest
@testable import Omo

final class ScreenshotJobPersistenceTests: XCTestCase {
    func testAcceptedJobAndRetryImageSurviveCacheRecreation() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "omo-job-cache-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let job = screenshotJob(state: .accepted)
        let imageData = Data("durable-image".utf8)

        let first = ScreenshotJobCache(directory: directory)
        try await first.save(job: job, imageData: imageData)

        let restarted = ScreenshotJobCache(directory: directory)
        let restartedJobs = try await restarted.loadJobs()
        let restartedImage = try await restarted.imageData(for: job.id)
        XCTAssertEqual(restartedJobs, [job])
        XCTAssertEqual(restartedImage, imageData)

        try await restarted.removeImage(for: job.id)
        let removedImage = try await restarted.imageData(for: job.id)
        let preservedJobs = try await restarted.loadJobs()
        XCTAssertNil(removedImage)
        XCTAssertEqual(preservedJobs, [job])
    }
}

private func screenshotJob(state: ScreenshotJobState) -> ScreenshotJob {
    ScreenshotJob(
        id: "job-durable",
        state: state,
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:00:00Z",
        attemptCount: 0,
        cardId: "",
        errorCode: "",
        errorMessage: "",
        retryable: false
    )
}
