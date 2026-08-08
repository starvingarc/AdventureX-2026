import Foundation

protocol ScreenshotJobPersisting: Sendable {
    func loadJobs() async throws -> [ScreenshotJob]
    func save(job: ScreenshotJob, imageData: Data) async throws
    func update(job: ScreenshotJob) async throws
    func imageData(for jobID: String) async throws -> Data?
    func removeImage(for jobID: String) async throws
    func removeJob(for jobID: String) async throws
}

actor ScreenshotJobCache: ScreenshotJobPersisting {
    private let directory: URL
    private let metadataURL: URL
    private let fileManager: FileManager

    init(
        directory: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        let root = directory ?? fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: "Omo/ScreenshotJobs", directoryHint: .isDirectory)
        self.directory = root
        metadataURL = root.appending(path: "jobs.json", directoryHint: .notDirectory)
    }

    func loadJobs() throws -> [ScreenshotJob] {
        guard fileManager.fileExists(atPath: metadataURL.path) else { return [] }
        return try JSONDecoder().decode(
            [ScreenshotJob].self,
            from: Data(contentsOf: metadataURL)
        )
    }

    func save(job: ScreenshotJob, imageData: Data) throws {
        try ensureDirectory()
        try imageData.write(to: imageURL(for: job.id), options: .atomic)
        try applyFileProtection(to: imageURL(for: job.id))
        try update(job: job)
    }

    func update(job: ScreenshotJob) throws {
        try ensureDirectory()
        var jobs = try loadJobs()
        if let index = jobs.firstIndex(where: { $0.id == job.id }) {
            jobs[index] = job
        } else {
            jobs.append(job)
        }
        jobs.sort { $0.createdAt > $1.createdAt }
        let data = try JSONEncoder().encode(jobs)
        try data.write(to: metadataURL, options: .atomic)
        try applyFileProtection(to: metadataURL)
    }

    func imageData(for jobID: String) throws -> Data? {
        let url = imageURL(for: jobID)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    func removeImage(for jobID: String) throws {
        let url = imageURL(for: jobID)
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    func removeJob(for jobID: String) throws {
        try removeImage(for: jobID)
        var jobs = try loadJobs()
        jobs.removeAll { $0.id == jobID }
        try ensureDirectory()
        let data = try JSONEncoder().encode(jobs)
        try data.write(to: metadataURL, options: .atomic)
        try applyFileProtection(to: metadataURL)
    }

    private func ensureDirectory() throws {
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try applyFileProtection(to: directory)
    }

    private func imageURL(for jobID: String) -> URL {
        directory.appending(path: "\(jobID).jpg", directoryHint: .notDirectory)
    }

    private func applyFileProtection(to url: URL) throws {
        #if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }
}
