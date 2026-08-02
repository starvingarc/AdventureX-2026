import Foundation

struct APIClient {
    #if DEBUG
    static let defaultBaseURL = URL(string: "http://127.0.0.1:5174")!
    #else
    static let defaultBaseURL = URL(string: "https://shibei-production.up.railway.app")!
    #endif

    private let baseURL: URL
    private let session: URLSession
    private let deviceID: String

    init(baseURL: URL = APIClient.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = ProcessInfo.processInfo.environment["OMO_API_BASE_URL"]
            .flatMap(URL.init(string:)) ?? baseURL
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

private struct APIErrorBody: Decodable {
    let message: String
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
