import Foundation

struct APIClient {
    #if DEBUG
    static let localBaseURL = URL(string: "http://127.0.0.1:5173")!
    static var defaultBaseURL: URL {
        launchArgumentBaseURL ?? productionBaseURL
    }
    #else
    static let defaultBaseURL = APIClient.productionBaseURL
    #endif
    static let productionBaseURL = URL(string: "https://shibei-production.up.railway.app")!

    #if DEBUG
    private static var launchArgumentBaseURL: URL? {
        let arguments = ProcessInfo.processInfo.arguments
        for flag in ["-RecalloAPIBaseURL", "-RecalloV2APIBaseURL", "-ShibeiAPIBaseURL", "-ShibeiV2APIBaseURL"] {
            if let index = arguments.firstIndex(of: flag) {
                let valueIndex = arguments.index(after: index)
                if valueIndex < arguments.endIndex, let url = URL(string: arguments[valueIndex]) {
                    return url
                }
            }
        }
        if let value = ProcessInfo.processInfo.environment["RECALLO_API_BASE_URL"]
            ?? ProcessInfo.processInfo.environment["RECALLO_V2_API_BASE_URL"]
            ?? ProcessInfo.processInfo.environment["SHIBEI_API_BASE_URL"]
            ?? ProcessInfo.processInfo.environment["SHIBEI_V2_API_BASE_URL"] {
            return URL(string: value)
        }
        return nil
    }
    #endif

    var baseURL: URL
    var session: URLSession
    var decoder: JSONDecoder
    var deviceId: String

    init(
        baseURL: URL = APIClient.defaultBaseURL,
        session: URLSession = .shared,
        decoder: JSONDecoder = JSONDecoder(),
        deviceId: String = DeviceIdentityStore.shared.currentDeviceId()
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
        self.deviceId = deviceId
    }

    func fetchChapters() async throws -> [Chapter] {
        let response: ChaptersResponse = try await get("/api/chapters")
        return response.chapters
    }

    func fetchChapter(id: String) async throws -> Chapter {
        let response: ChapterResponse = try await get("/api/chapters/\(id)")
        return response.chapter
    }

    func fetchNotifications() async throws -> [NotificationItem] {
        let response: NotificationsResponse = try await get("/api/notifications")
        return response.notifications
    }

    func fetchFavoriteQuestions() async throws -> [FavoriteQuestionRecord] {
        let response: FavoriteQuestionsResponse = try await get("/api/favorites/questions")
        return response.favorites
    }

    func createFavoriteQuestion(chapterId: String, questionId: String) async throws -> FavoriteQuestionRecord {
        let request = FavoriteQuestionRequest(chapterId: chapterId, questionId: questionId)
        let response: FavoriteQuestionMutationResponse = try await send("/api/favorites/questions", method: "POST", body: request, acceptsFailureBody: false)
        return response.favorite
    }

    func deleteFavoriteQuestion(id: String) async throws -> FavoriteQuestionDeletionResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await send("/api/favorites/questions/\(encodedId)", method: "DELETE", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func markNotificationRead(id: String) async throws -> NotificationItem {
        let response: NotificationMutationResponse = try await send("/api/notifications/\(id)/read", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
        return response.notification
    }

    func dismissNotification(id: String) async throws -> NotificationItem {
        let response: NotificationMutationResponse = try await send("/api/notifications/\(id)/dismiss", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
        return response.notification
    }

    func createChapter(input: ChapterInput) async throws -> ChapterCreationResult {
        let request = ChapterCreateRequest(input: input)
        let response: ChapterMutationResponse = try await send("/api/chapters", method: "POST", body: request, acceptsFailureBody: true)
        return ChapterCreationResult(chapter: response.chapter, notification: response.notification)
    }

    func createV2Chapter(sourceText: String, clientRequestId: String) async throws -> V2CreateChapterResponse {
        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = ChapterInput.parse(trimmed)
        let isURL = input.sourceUrl?.isEmpty == false
        let request = V2CreateChapterRequest(
            clientRequestId: clientRequestId,
            sourceType: isURL ? input.sourceType.rawValue : "text",
            sourceUrl: input.sourceUrl,
            sourceTitle: isURL ? nil : String(trimmed.prefix(24)),
            rawText: isURL ? nil : trimmed
        )
        return try await send("/api/v2/chapters", method: "POST", body: request, acceptsFailureBody: false)
    }

    func preflightSource(input: String, fetchMetadata: Bool = false) async throws -> SourcePreflightResponse {
        let request = SourcePreflightRequest(
            input: input.trimmingCharacters(in: .whitespacesAndNewlines),
            fetchMetadata: fetchMetadata
        )
        return try await send("/api/sources/preflight", method: "POST", body: request, acceptsFailureBody: true)
    }

    func analyzeScreenshot(
        imageData: Data,
        mimeType: String = "image/jpeg",
        sourceUrl: String? = nil
    ) async throws -> ImageFlowResponse {
        let request = ImageFlowRequest(
            imageBase64: imageData.base64EncodedString(),
            mimeType: mimeType,
            sourceUrl: sourceUrl
        )
        return try await send(
            "/api/sources/image-flow",
            method: "POST",
            body: request,
            acceptsFailureBody: true,
            timeoutInterval: 300
        )
    }

    func fetchCaptureMemoryCards() async throws -> [CaptureMemoryCardRecord] {
        let response: CaptureMemoryCardsResponse = try await get("/api/memory-cards")
        return response.cards
    }

    func assessCaptureMemoryCard(
        id: String,
        assessment: String,
        attemptId: String
    ) async throws -> CaptureMemoryCardAssessmentResponse {
        let request = CaptureMemoryCardAssessmentRequest(
            assessment: assessment,
            attemptId: attemptId
        )
        return try await send(
            "/api/memory-cards/\(encodedPathComponent(id))/assessments",
            method: "POST",
            body: request,
            acceptsFailureBody: false
        )
    }

    func deleteCaptureMemoryCard(id: String) async throws -> CaptureMemoryCardDeletionResponse {
        try await send(
            "/api/memory-cards/\(encodedPathComponent(id))",
            method: "DELETE",
            body: EmptyRequest(),
            acceptsFailureBody: false
        )
    }

    func fetchV2Chapter(id: String) async throws -> V2BackendChapter {
        let response: V2BackendChapterResponse = try await get("/api/chapters/\(encodedPathComponent(id))")
        return response.chapter
    }

    func fetchV2Chapters() async throws -> [V2BackendChapter] {
        let response: V2BackendChaptersResponse = try await get("/api/chapters")
        return response.chapters
    }

    func fetchRecommendedArticles() async throws -> V2RecommendedArticlesResponse {
        try await get("/api/v2/recommended-articles")
    }

    func fetchRecommendedArticleDetail(id: String) async throws -> V2RecommendedArticleDetailResponse {
        try await get("/api/v2/recommended-articles/\(encodedPathComponent(id))")
    }

    func fetchV2AwakeningSession() async throws -> V2AwakeningSessionResponse {
        try await get("/api/v2/awakening-session")
    }

    func startOrResumeV2AwakeningSession() async throws -> V2AwakeningSessionResponse {
        try await send("/api/v2/awakening-session", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func answerV2AwakeningSession(
        sessionId: String,
        selectedOptionId: String,
        attemptId: String
    ) async throws -> V2AwakeningSessionResponse {
        let request = V2AwakeningAnswerRequest(
            selectedOptionId: selectedOptionId,
            attemptId: attemptId
        )
        return try await send(
            "/api/v2/awakening-sessions/\(encodedPathComponent(sessionId))/answer",
            method: "POST",
            body: request,
            acceptsFailureBody: false
        )
    }

    func completeV2AwakeningSession(sessionId: String) async throws -> V2AwakeningSessionResponse {
        try await send(
            "/api/v2/awakening-sessions/\(encodedPathComponent(sessionId))/complete",
            method: "POST",
            body: EmptyRequest(),
            acceptsFailureBody: false
        )
    }

    func importRecommendedArticle(id: String) async throws -> V2RecommendedArticleDetailResponse {
        try await send("/api/v2/recommended-articles/\(encodedPathComponent(id))/import", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func startOrResumeV2ReviewSession(chapterId: String) async throws -> V2ReviewSessionResponse {
        try await send("/api/v2/chapters/\(encodedPathComponent(chapterId))/review-session", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func replayV2ReviewSessionFromUnit(chapterId: String, unitId: String) async throws -> V2ReviewSessionResponse {
        let request = V2ReplayFromUnitRequest(unitId: unitId)
        return try await send("/api/v2/chapters/\(encodedPathComponent(chapterId))/review-session/replay-from-unit", method: "POST", body: request, acceptsFailureBody: false)
    }

    func fetchV2ReviewSession(chapterId: String) async throws -> V2ReviewSessionResponse {
        try await get("/api/v2/chapters/\(encodedPathComponent(chapterId))/review-session")
    }

    func advanceV2ReviewSession(sessionId: String) async throws -> V2ReviewSessionResponse {
        try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/advance", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func focusV2ReviewUnit(sessionId: String, unitId: String) async throws -> V2ReviewSessionResponse {
        let request = V2FocusUnitRequest(unitId: unitId)
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/focus-unit", method: "POST", body: request, acceptsFailureBody: false)
    }

    func startV2PracticeSession(sessionId: String, unitId: String) async throws -> V2ReviewSessionResponse {
        let request = V2PracticeStartRequest(unitId: unitId)
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/practice/start", method: "POST", body: request, acceptsFailureBody: false)
    }

    func advanceV2PracticeSession(sessionId: String) async throws -> V2ReviewSessionResponse {
        try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/practice/advance", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func answerV2PracticeQuestion(
        sessionId: String,
        unitId: String,
        questionId: String,
        result: String,
        selectedOptionId: String?,
        matchedPairs: [V2BackendMatchedPair] = [],
        lockedPairIds: [String] = []
    ) async throws -> V2ReviewSessionResponse {
        let request = V2AnswerQuestionRequest(
            unitId: unitId,
            questionId: questionId,
            result: result,
            selectedOptionId: selectedOptionId,
            matchedPairs: matchedPairs,
            lockedPairIds: lockedPairIds
        )
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/practice/answer", method: "POST", body: request, acceptsFailureBody: false)
    }

    func finishV2PracticeSession(sessionId: String) async throws -> V2ReviewSessionResponse {
        try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/practice/finish", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func answerV2Question(
        sessionId: String,
        unitId: String,
        questionId: String,
        result: String,
        selectedOptionId: String?,
        matchedPairs: [V2BackendMatchedPair] = [],
        lockedPairIds: [String] = []
    ) async throws -> V2ReviewSessionResponse {
        let request = V2AnswerQuestionRequest(
            unitId: unitId,
            questionId: questionId,
            result: result,
            selectedOptionId: selectedOptionId,
            matchedPairs: matchedPairs,
            lockedPairIds: lockedPairIds
        )
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/answer", method: "POST", body: request, acceptsFailureBody: false)
    }

    func setV2QuestionFeedbackVisible(sessionId: String, questionId: String, visible: Bool) async throws -> V2ReviewSessionResponse {
        let request = V2FeedbackVisibilityRequest(questionId: questionId, visible: visible)
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/feedback-visibility", method: "POST", body: request, acceptsFailureBody: false)
    }

    func openV2SourceFromReview(sessionId: String, sourceAnchorId: String?, entry: String = "review") async throws -> V2ReviewSessionResponse {
        let request = V2SourceOpenRequest(sourceAnchorId: sourceAnchorId, entry: entry)
        return try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/source-open", method: "POST", body: request, acceptsFailureBody: false)
    }

    func returnFromV2SourceToReview(sessionId: String) async throws -> V2ReviewSessionResponse {
        try await send("/api/v2/review-sessions/\(encodedPathComponent(sessionId))/source-return", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func regenerateChapter(id: String) async throws -> ChapterCreationResult {
        let response: ChapterMutationResponse = try await send("/api/chapters/\(id)/regenerate", method: "POST", body: EmptyRequest(), acceptsFailureBody: true)
        return ChapterCreationResult(chapter: response.chapter, notification: response.notification)
    }

    func deleteChapter(id: String) async throws -> ChapterDeletionResponse {
        try await send("/api/chapters/\(id)", method: "DELETE", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func startOrResumeReviewSession(chapterId: String) async throws -> ReviewSessionResponse {
        try await send("/api/chapters/\(chapterId)/review-session", method: "POST", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func fetchReviewSession(chapterId: String) async throws -> ReviewSessionResponse {
        try await get("/api/chapters/\(chapterId)/review-session")
    }

    func submitAttempt(sessionId: String, queueItemId: String?, questionId: String, answer: String?, result: AttemptResult) async throws -> AttemptResponse {
        let request = AttemptRequest(queueItemId: queueItemId, questionId: questionId, answer: answer ?? "", result: result)
        return try await send("/api/review-sessions/\(sessionId)/attempts", method: "POST", body: request, acceptsFailureBody: false)
    }

    func submitFeedback(questionId: String, feedbackType: FeedbackType) async throws -> FeedbackResponse {
        let request = FeedbackRequest(feedbackType: feedbackType)
        return try await send("/api/questions/\(questionId)/feedback", method: "POST", body: request, acceptsFailureBody: false)
    }

    func deleteDeviceData() async throws -> DeviceDataDeletionResponse {
        try await send("/api/device-data", method: "DELETE", body: EmptyRequest(), acceptsFailureBody: false)
    }

    func registerPushToken(_ token: String, environment: PushTokenEnvironment, preferredLanguage: AppLanguage) async throws -> PushTokenRegistrationResponse {
        let request = PushTokenRequest(token: token, environment: environment, preferredLanguage: preferredLanguage.rawValue)
        return try await send("/api/devices/push-token", method: "POST", body: request, acceptsFailureBody: false)
    }

    func fetchPushStatus() async throws -> PushStatusResponse {
        try await get("/api/devices/push-status")
    }

    func fetchAccount() async throws -> AccountStatusResponse {
        try await get("/api/account")
    }

    func signInWithApple(identityToken: String, authorizationCode: String?) async throws -> AccountAuthResponse {
        let request = AppleAuthRequest(identityToken: identityToken, authorizationCode: authorizationCode)
        return try await send("/api/auth/apple", method: "POST", body: request, acceptsFailureBody: false)
    }

    func deleteAccount() async throws -> AccountDeletionResponse {
        try await send("/api/account", method: "DELETE", body: EmptyRequest(), acceptsFailureBody: false)
    }

    private func get<Response: Decodable>(_ path: String) async throws -> Response {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue(deviceId, forHTTPHeaderField: "X-Device-Id")
        #if DEBUG
        print("[Recallo] API GET \(url.absoluteString) device=\(deviceId.suffix(6))")
        #endif

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        #if DEBUG
        print("[Recallo] API GET status=\(httpResponse.statusCode) path=\(path)")
        #endif
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw APIClientError.httpStatus(httpResponse.statusCode)
        }
        return try decode(Response.self, from: data, path: path)
    }

    private func encodedPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func send<Request: Encodable, Response: Decodable>(
        _ path: String,
        method: String,
        body: Request,
        acceptsFailureBody: Bool,
        timeoutInterval: TimeInterval? = nil
    ) async throws -> Response {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let timeoutInterval {
            request.timeoutInterval = timeoutInterval
        }
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue(deviceId, forHTTPHeaderField: "X-Device-Id")
        #if DEBUG
        print("[Recallo] API \(method) \(url.absoluteString) device=\(deviceId.suffix(6))")
        #endif
        if method != "DELETE" {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        #if DEBUG
        print("[Recallo] API \(method) status=\(httpResponse.statusCode) path=\(path)")
        #endif
        if (200..<300).contains(httpResponse.statusCode) || (acceptsFailureBody && httpResponse.statusCode == 422) {
            return try decode(Response.self, from: data, path: path)
        }
        if let serverError = try? decoder.decode(APIErrorResponse.self, from: data) {
            throw APIClientError.serverMessage(serverError.message)
        }
        throw APIClientError.httpStatus(httpResponse.statusCode)
    }

    private func decode<Response: Decodable>(_ type: Response.Type, from data: Data, path: String) throws -> Response {
        do {
            return try decoder.decode(type, from: data)
        } catch let error as DecodingError {
            let message = Self.describeDecodingError(error)
            #if DEBUG
            print("[Recallo] API decode failed path=\(path): \(message)")
            #endif
            throw APIClientError.decoding(message)
        } catch {
            #if DEBUG
            print("[Recallo] API decode failed path=\(path): \(error.localizedDescription)")
            #endif
            throw error
        }
    }

    private static func describeDecodingError(_ error: DecodingError) -> String {
        switch error {
        case .typeMismatch(let type, let context):
            "Field \(codingPathDescription(context.codingPath)) type mismatch. Expected \(type)."
        case .valueNotFound(let type, let context):
            "Field \(codingPathDescription(context.codingPath)) is missing a value. Expected \(type)."
        case .keyNotFound(let key, let context):
            "Field \(codingPathDescription(context.codingPath + [key])) is missing."
        case .dataCorrupted(let context):
            "Field \(codingPathDescription(context.codingPath)) data corrupted: \(context.debugDescription)"
        @unknown default:
            "API response could not be decoded."
        }
    }

    private static func codingPathDescription(_ path: [CodingKey]) -> String {
        guard !path.isEmpty else { return "<root>" }
        return path.map { key in
            if let intValue = key.intValue {
                return "[\(intValue)]"
            }
            return key.stringValue
        }.joined(separator: ".")
    }
}

enum APIClientError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case serverMessage(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Invalid API response."
        case .httpStatus(let statusCode):
            "API request failed: HTTP \(statusCode)."
        case .serverMessage(let message):
            message
        case .decoding(let message):
            "API response is incompatible: \(message)"
        }
    }
}

struct EmptyRequest: Codable {}

enum PushTokenEnvironment: String, Codable {
    case sandbox
    case production

    static var current: PushTokenEnvironment {
        let value = Bundle.main.object(forInfoDictionaryKey: "ShiBeiAPNSEnvironment") as? String
        switch value?.lowercased() {
        case "development", "sandbox":
            return .sandbox
        case "production":
            return .production
        default:
            return .production
        }
    }
}

struct PushTokenRequest: Codable {
    var token: String
    var platform: String = "ios"
    var environment: PushTokenEnvironment
    var preferredLanguage: String
}

struct PushTokenRegistrationResponse: Codable {
    struct RegisteredToken: Codable {
        var platform: String
        var environment: PushTokenEnvironment
    }

    var ok: Bool
    var pushToken: RegisteredToken?
    var apnsConfigured: Bool?
}

struct PushStatusResponse: Codable {
    struct APNSSummary: Codable {
        var configured: Bool
        var environment: String?
        var bundleId: String?
    }

    struct Token: Codable {
        var tokenTail: String
        var platform: String
        var environment: PushTokenEnvironment
        var updatedAt: String
    }

    struct RecentNotification: Codable {
        var id: String
        var type: String
        var title: String
        var pushAttemptedAt: String
        var pushDeliveryStatus: String
        var pushDeliveryError: String
        var pushAttemptCount: Int
        var createdAt: String
    }

    var ok: Bool
    var apns: APNSSummary
    var pushTokenCount: Int
    var pushTokens: [Token]
    var recentNotifications: [RecentNotification]
}

struct AccountSnapshot: Codable, Equatable {
    var id: String
    var provider: String
    var createdAt: String
    var updatedAt: String
    var deletedAt: String?
}

struct AccountStatusResponse: Codable {
    var account: AccountSnapshot?
    var mode: String
}

struct AppleAuthRequest: Codable {
    var identityToken: String
    var authorizationCode: String?
}

struct AccountAuthResponse: Codable {
    var ok: Bool
    var account: AccountSnapshot
    var linkedDeviceId: String
}

struct AccountDeletionResponse: Codable {
    struct DeletedSummary: Codable {
        var accountId: String
        var deletionJobId: String
    }

    var ok: Bool
    var deleted: DeletedSummary
}

struct ChapterCreateRequest: Codable {
    var sourceType: String
    var rawText: String?
    var sourceUrl: String?
    var sourceTitle: String?

    init(input: ChapterInput) {
        sourceType = input.sourceType.rawValue
        rawText = input.rawText
        sourceUrl = input.sourceUrl
        sourceTitle = input.sourceTitle
    }
}

struct ImageFlowRequest: Codable {
    var imageBase64: String
    var mimeType: String
    var sourceUrl: String?
}

struct ImageFlowResponse: Decodable {
    struct Link: Codable {
        var title: String
        var url: String
        var snippet: String
    }

    var status: String
    var message: String?
    var query: String?
    var link: Link?
    var sourceFallback: Bool?
    var memoryCard: ImageFlowMemoryCard?
    var schemaVersion: String?
    var disposition: CaptureAnalysisDisposition?
    var schedule: ImageFlowReviewSchedule?
    var captureAnalysis: CaptureAnalysisV2?
}

struct ImageFlowMemoryCard: Decodable, Equatable, Identifiable {
    enum State: String, Codable {
        case formal
        case fragment
    }

    enum Rarity: String, Codable {
        case r = "R"
        case sr = "SR"
        case ssr = "SSR"
    }

    enum SourceStatus: String, Codable {
        case verified
        case partial
        case unconfirmed
    }

    var id: String
    var captureId: String? = nil
    var version: Int? = nil
    var state: State
    var coreKnowledge: String
    var recallCue: String
    var hiddenSemantic: String?
    var explanation: String
    var sourceEvidenceIds: [String]? = nil
    var recallVariants: [ImageFlowRecallVariant]? = nil
    var rarity: Rarity?
    var rarityReason: String?
    var rarityReasons: [String]? = nil
    var rarityConfidence: Double? = nil
    var rarityRuleVersion: String? = nil
    var sourceTitle: String?
    var sourceUrl: String?
    var sourceStatus: SourceStatus
    var createdAt: String? = nil
    var updatedAt: String? = nil
}

extension ImageFlowMemoryCard {
    private enum CodingKeys: String, CodingKey {
        case id
        case captureId
        case version
        case state
        case coreKnowledge
        case recallCue
        case hiddenSemantic
        case explanation
        case sourceEvidenceIds
        case recallVariants
        case rarity
        case rarityReason
        case rarityReasons
        case rarityConfidence
        case rarityRuleVersion
        case sourceTitle
        case sourceUrl
        case sourceStatus
        case createdAt
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        captureId = try container.decodeIfPresent(String.self, forKey: .captureId)
        version = try container.decodeIfPresent(Int.self, forKey: .version)
        state = try container.decodeIfPresent(State.self, forKey: .state) ?? .formal
        coreKnowledge = try container.decode(String.self, forKey: .coreKnowledge)
        recallCue = try container.decode(String.self, forKey: .recallCue)
        hiddenSemantic = try container.decodeIfPresent(String.self, forKey: .hiddenSemantic)
        explanation = try container.decode(String.self, forKey: .explanation)
        sourceEvidenceIds = try container.decodeIfPresent([String].self, forKey: .sourceEvidenceIds)
        recallVariants = try container.decodeIfPresent([ImageFlowRecallVariant].self, forKey: .recallVariants)
        rarity = try container.decodeIfPresent(Rarity.self, forKey: .rarity)
        rarityReason = try container.decodeIfPresent(String.self, forKey: .rarityReason)
        rarityReasons = try container.decodeIfPresent([String].self, forKey: .rarityReasons)
        rarityConfidence = try container.decodeIfPresent(Double.self, forKey: .rarityConfidence)
        rarityRuleVersion = try container.decodeIfPresent(String.self, forKey: .rarityRuleVersion)
        sourceTitle = try container.decodeIfPresent(String.self, forKey: .sourceTitle)
        sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        sourceStatus = try container.decodeIfPresent(SourceStatus.self, forKey: .sourceStatus) ?? .unconfirmed
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

enum CaptureAnalysisDisposition: String, Codable, Equatable {
    case createCard = "create_card"
    case archiveOnly = "archive_only"
    case needsConfirmation = "needs_confirmation"
}

struct ImageFlowRecallVariant: Codable, Equatable, Identifiable {
    enum Kind: String, Codable, Equatable {
        case semanticCloze = "semantic_cloze"
        case trueFalse = "true_false"
        case multipleChoice = "multiple_choice"
    }

    var id: String
    var type: Kind
    var prompt: String
    var answer: String?
    var options: [ImageFlowRecallOption]
    var correctOptionId: String?
    var correctBoolean: Bool?
    var explanation: String
    var sourceEvidenceIds: [String]
}

struct ImageFlowRecallOption: Codable, Equatable, Identifiable {
    var id: String
    var text: String
}

struct ImageFlowReviewSchedule: Decodable, Equatable {
    var nextReviewAt: String
    var intervalDays: Int
    var state: String
    var status: String?

    init(
        nextReviewAt: String,
        intervalDays: Int,
        state: String,
        status: String? = nil
    ) {
        self.nextReviewAt = nextReviewAt
        self.intervalDays = intervalDays
        self.state = state
        self.status = status
    }

    private enum CodingKeys: String, CodingKey {
        case nextReviewAt
        case intervalDays
        case state
        case status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        nextReviewAt = try container.decode(String.self, forKey: .nextReviewAt)
        intervalDays = try container.decode(Int.self, forKey: .intervalDays)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        state = try container.decodeIfPresent(String.self, forKey: .state)
            ?? status
            ?? "scheduled"
    }

    var nextReviewDate: Date? {
        Self.parseISO8601(nextReviewAt)
    }

    func isDue(at now: Date = Date()) -> Bool {
        guard let nextReviewDate else { return false }
        return nextReviewDate <= now
    }

    var displayText: String {
        guard let nextReviewDate else { return "下次复习时间待同步" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .current
        formatter.dateFormat = "M月d日 HH:mm"
        return "\(formatter.string(from: nextReviewDate)) 再次召回"
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractionalFormatter.date(from: value)
            ?? ISO8601DateFormatter().date(from: value)
    }
}

struct CaptureAnalysisV2: Decodable, Equatable {
    var schemaVersion: String
    var disposition: CaptureAnalysisDisposition
    var sourceStatus: ImageFlowMemoryCard.SourceStatus
    var memoryCard: ImageFlowMemoryCard?
    var schedule: ImageFlowReviewSchedule?
}

struct CaptureMemoryCardsResponse: Decodable, Equatable {
    var cards: [CaptureMemoryCardRecord]

    private enum CodingKeys: String, CodingKey {
        case cards
        case items
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cards = try container.decodeIfPresent([CaptureMemoryCardRecord].self, forKey: .cards)
            ?? container.decodeIfPresent([CaptureMemoryCardRecord].self, forKey: .items)
            ?? []
    }
}

struct CaptureMemoryCardRecord: Decodable, Equatable {
    var memoryCard: ImageFlowMemoryCard
    var disposition: CaptureAnalysisDisposition
    var schedule: ImageFlowReviewSchedule?
    var masteryStage: String?
    var successfulRecallCount: Int?
    var reviewCount: Int?
    var lastAssessment: String?
    var capturedAt: String?

    private enum CodingKeys: String, CodingKey {
        case memoryCard
        case card
        case disposition
        case schedule
        case masteryStage
        case successfulRecallCount
        case reviewCount
        case lastAssessment
        case capturedAt
    }

    init(
        memoryCard: ImageFlowMemoryCard,
        disposition: CaptureAnalysisDisposition? = nil,
        schedule: ImageFlowReviewSchedule?,
        masteryStage: String?,
        successfulRecallCount: Int?,
        reviewCount: Int? = nil,
        lastAssessment: String?,
        capturedAt: String?
    ) {
        self.memoryCard = memoryCard
        self.disposition = disposition
            ?? (memoryCard.state == .formal ? .createCard : .archiveOnly)
        self.schedule = schedule
        self.masteryStage = masteryStage
        self.successfulRecallCount = successfulRecallCount
        self.reviewCount = reviewCount
        self.lastAssessment = lastAssessment
        self.capturedAt = capturedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nestedCard = try container.decodeIfPresent(ImageFlowMemoryCard.self, forKey: .memoryCard)
            ?? container.decodeIfPresent(ImageFlowMemoryCard.self, forKey: .card) {
            memoryCard = nestedCard
        } else {
            memoryCard = try ImageFlowMemoryCard(from: decoder)
        }
        disposition = try container.decodeIfPresent(CaptureAnalysisDisposition.self, forKey: .disposition)
            ?? (memoryCard.state == .formal ? .createCard : .archiveOnly)
        schedule = try container.decodeIfPresent(ImageFlowReviewSchedule.self, forKey: .schedule)
        masteryStage = try container.decodeIfPresent(String.self, forKey: .masteryStage)
        successfulRecallCount = try container.decodeIfPresent(Int.self, forKey: .successfulRecallCount)
        reviewCount = try container.decodeIfPresent(Int.self, forKey: .reviewCount)
        lastAssessment = try container.decodeIfPresent(String.self, forKey: .lastAssessment)
        capturedAt = try container.decodeIfPresent(String.self, forKey: .capturedAt)
            ?? memoryCard.createdAt
    }
}

struct CaptureMemoryCardAssessmentRequest: Encodable {
    var assessment: String
    var attemptId: String
}

struct CaptureMemoryCardAssessmentResponse: Decodable, Equatable {
    struct Assessment: Decodable, Equatable {
        var attemptId: String
        var assessment: String
        var assessedAt: String
        var repeated: Bool
    }

    struct Mastery: Decodable, Equatable {
        var before: String
        var after: String
        var successfulRecallCount: Int
        var reviewCount: Int
    }

    var schemaVersion: String
    var cardId: String
    var assessment: Assessment
    var mastery: Mastery?
    var schedule: ImageFlowReviewSchedule
}

struct CaptureMemoryCardDeletionResponse: Decodable, Equatable {
    var schemaVersion: String
    var deleted: Bool
    var cardId: String
    var captureId: String
    var deletedAt: String
}

struct AttemptRequest: Codable {
    var queueItemId: String?
    var questionId: String
    var answer: String
    var result: AttemptResult
}

struct FeedbackRequest: Codable {
    var feedbackType: FeedbackType
}

struct ChaptersResponse: Codable {
    var chapters: [Chapter]
}

struct ChapterResponse: Codable {
    var chapter: Chapter
}

struct NotificationsResponse: Codable {
    var notifications: [NotificationItem]
}

struct FavoriteQuestionsResponse: Codable {
    var favorites: [FavoriteQuestionRecord]
}

struct FavoriteQuestionRequest: Codable {
    var chapterId: String
    var questionId: String
}

struct FavoriteQuestionMutationResponse: Codable {
    var favorite: FavoriteQuestionRecord
}

struct FavoriteQuestionDeletionResponse: Codable {
    var deleted: Bool
    var favoriteId: String
}

struct NotificationMutationResponse: Codable {
    var notification: NotificationItem
}

struct ChapterMutationResponse: Codable {
    var status: ChapterStatus?
    var chapter: Chapter
    var notification: NotificationItem?
    var message: String?
}

struct ChapterDeletionResponse: Codable {
    var deleted: Bool
    var chapterId: String
}

struct DeviceDataDeletionResponse: Codable {
    struct Deleted: Codable {
        var chapters: Int
        var notifications: Int
        var generationJobs: Int
        var favorites: Int?
    }

    var ok: Bool
    var deleted: Deleted
}

struct APIErrorResponse: Codable {
    var errorCode: String?
    var message: String
}

struct ReviewSessionResponse: Codable {
    var chapter: Chapter
    var reviewSession: ReviewSession?
    var currentQuestion: ReviewQuestion?
}

struct AttemptResponse: Codable {
    var chapter: Chapter
    var reviewSession: ReviewSession
    var attempt: ReviewAttempt
    var currentQuestion: ReviewQuestion?
}

struct FeedbackResponse: Codable {
    var chapter: Chapter
    var feedback: QuestionFeedback
    var reviewSession: ReviewSession?
}
