import Foundation

protocol OmoAPIProviding: Sendable {
    func cards() async throws -> [MemoryCard]
    func createCard(from imageData: Data) async throws -> MemoryCard
    func screenshotJobs() async throws -> [ScreenshotJob]
    func createScreenshotJob(from imageData: Data) async throws -> ScreenshotJob
    func screenshotJob(id: String) async throws -> ScreenshotJob
    func retryScreenshotJob(id: String, imageData: Data) async throws -> ScreenshotJob
    func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws -> MemoryCard
    func delete(_ card: MemoryCard) async throws
}

extension OmoAPIProviding {
    func screenshotJobs() async throws -> [ScreenshotJob] { [] }

    func createScreenshotJob(from imageData: Data) async throws -> ScreenshotJob {
        throw APIError.server("截图任务接口尚未配置。")
    }

    func screenshotJob(id: String) async throws -> ScreenshotJob {
        throw APIError.server("截图任务接口尚未配置。")
    }

    func retryScreenshotJob(id: String, imageData: Data) async throws -> ScreenshotJob {
        throw APIError.server("截图任务接口尚未配置。")
    }
}

enum AppEnvironmentError: LocalizedError, Equatable {
    case missingAPIBaseURL
    case invalidAPIBaseURL

    var errorDescription: String? {
        switch self {
        case .missingAPIBaseURL:
            "测试服务尚未配置。"
        case .invalidAPIBaseURL:
            "测试服务地址无效。"
        }
    }
}

enum AppEnvironment {
    static let apiBaseURLInfoKey = "OmoAPIBaseURL"
    #if DEBUG || OMO_TESTING
    static let debugLocalhostURL = URL(string: "http://127.0.0.1:5174")!
    #endif

    static func currentAPIBaseURL() throws -> URL {
        try resolveAPIBaseURL(
            infoDictionary: Bundle.main.infoDictionary ?? [:],
            processEnvironment: ProcessInfo.processInfo.environment,
            allowsDebugLocalhostFallback: allowsDebugLocalhostFallback
        )
    }

    static func resolveAPIBaseURL(
        infoDictionary: [String: Any],
        processEnvironment: [String: String],
        allowsDebugLocalhostFallback: Bool
    ) throws -> URL {
        let environmentValue = allowsDebugLocalhostFallback
            ? clean(processEnvironment["OMO_API_BASE_URL"])
            : nil
        let bundleValue = clean(infoDictionary[apiBaseURLInfoKey] as? String)
        guard let rawValue = environmentValue ?? bundleValue else {
            #if DEBUG || OMO_TESTING
            if allowsDebugLocalhostFallback { return debugLocalhostURL }
            #endif
            throw AppEnvironmentError.missingAPIBaseURL
        }
        guard let components = URLComponents(string: rawValue),
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              !host.isEmpty,
              !isBlockedLegacyProductionHost(host),
              let url = components.url else {
            throw AppEnvironmentError.invalidAPIBaseURL
        }

        if scheme == "https" { return url }
        #if DEBUG || OMO_TESTING
        if allowsDebugLocalhostFallback,
           scheme == "http",
           ["127.0.0.1", "localhost"].contains(host) {
            return url
        }
        #endif
        throw AppEnvironmentError.invalidAPIBaseURL
    }

    private static var allowsDebugLocalhostFallback: Bool {
        #if DEBUG || OMO_TESTING
        true
        #else
        false
        #endif
    }

    private static func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              !value.contains("$(") else { return nil }
        return value
    }

    private static func isBlockedLegacyProductionHost(_ host: String) -> Bool {
        // Keep the retired production endpoint out of distributable binaries while still
        // rejecting it if it is accidentally supplied by a build configuration.
        host.utf8.reduce(UInt64(5_381)) { hash, byte in
            ((hash &* 33) ^ UInt64(byte))
        } == 0x561b_bc0f_374f_6d64
    }
}

struct APIClient: Sendable {
    private let baseURL: URL?
    private let session: URLSession
    private let deviceID: String

    init(baseURL: URL? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? (try? AppEnvironment.currentAPIBaseURL())
        self.session = session
        self.deviceID = Self.deviceID()
    }

    func cards() async throws -> [MemoryCard] {
        let response: CardsResponse = try await request("/api/memory-cards")
        return response.cards
    }

    func createCard(from imageData: Data) async throws -> MemoryCard {
        let body = ScreenshotRequest(
            imageBase64: imageData.base64EncodedString(),
            mimeType: "image/jpeg"
        )
        let response: CardResponse = try await request(
            "/api/sources/image-flow",
            method: "POST",
            body: body,
            timeout: 120
        )
        return response.card
    }

    func screenshotJobs() async throws -> [ScreenshotJob] {
        let response: ScreenshotJobsResponse = try await request("/api/screenshot-jobs")
        return response.jobs
    }

    func createScreenshotJob(from imageData: Data) async throws -> ScreenshotJob {
        let body = ScreenshotRequest(
            imageBase64: imageData.base64EncodedString(),
            mimeType: "image/jpeg"
        )
        let response: ScreenshotJobResponse = try await request(
            "/api/screenshot-jobs",
            method: "POST",
            body: body
        )
        return response.job
    }

    func screenshotJob(id: String) async throws -> ScreenshotJob {
        let response: ScreenshotJobResponse = try await request(
            "/api/screenshot-jobs/\(id)"
        )
        return response.job
    }

    func retryScreenshotJob(id: String, imageData: Data) async throws -> ScreenshotJob {
        let body = ScreenshotRequest(
            imageBase64: imageData.base64EncodedString(),
            mimeType: "image/jpeg"
        )
        let response: ScreenshotJobResponse = try await request(
            "/api/screenshot-jobs/\(id)/retry",
            method: "POST",
            body: body
        )
        return response.job
    }

    func searchKnowledgeLibrary(query: String) async throws -> KnowledgeLibrarySearchResponse {
        let response: KnowledgeLibrarySearchAPIResponse = try await request(
            "/api/memory-cards/search",
            method: "POST",
            body: KnowledgeLibrarySearchAPIRequest(query: query)
        )
        return KnowledgeLibrarySearchResponse(orderedCardIDs: response.orderedCardIDs)
    }

    func assess(_ card: MemoryCard, as assessment: MemoryAssessment) async throws -> MemoryCard {
        let body = AssessmentRequest(
            assessment: assessment,
            attemptId: "ios-\(card.id)-\(card.reviewCount + 1)"
        )
        let response: CardResponse = try await request(
            "/api/memory-cards/\(card.id)/assessments",
            method: "POST",
            body: body
        )
        return response.card
    }

    func delete(_ card: MemoryCard) async throws {
        let response: DeleteResponse = try await request(
            "/api/memory-cards/\(card.id)",
            method: "DELETE"
        )
        guard response.deleted, response.cardId == card.id else {
            throw APIError.invalidResponse
        }
    }

    private func request<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        timeout: TimeInterval = 30
    ) async throws -> Response {
        try await request(path, method: method, body: Optional<String>.none, timeout: timeout)
    }

    private func request<Response: Decodable, Body: Encodable>(
        _ path: String,
        method: String,
        body: Body?,
        timeout: TimeInterval = 30
    ) async throws -> Response {
        guard let baseURL else {
            throw AppEnvironment.currentAPIBaseURLConfigurationError
        }
        var request = URLRequest(url: baseURL.appending(path: path))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(deviceID, forHTTPHeaderField: "X-Device-Id")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data).message)
                ?? "服务器请求失败（\(http.statusCode)）"
            throw APIError.server(message)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    private static func deviceID() -> String {
        let key = "omo.device-id"
        if let value = UserDefaults.standard.string(forKey: key) { return value }
        let value = UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
}

extension APIClient: OmoAPIProviding {}

private extension AppEnvironment {
    static var currentAPIBaseURLConfigurationError: Error {
        do {
            _ = try currentAPIBaseURL()
            return AppEnvironmentError.invalidAPIBaseURL
        } catch {
            return error
        }
    }
}

private struct APIErrorBody: Decodable {
    let message: String
}

private struct KnowledgeLibrarySearchAPIRequest: Encodable {
    let query: String
}

private struct KnowledgeLibrarySearchAPIResponse: Decodable {
    let orderedCardIDs: [String]
}

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "服务器没有返回有效结果。"
        case .server(let message): message
        case .decoding: "服务器数据格式无法读取。"
        }
    }
}
