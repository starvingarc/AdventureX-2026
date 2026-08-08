import XCTest
@testable import Omo

final class APIClientDecodingTests: XCTestCase {
    func testScreenshotSubmissionUsesDurableJobEndpointAndDecodesAcceptedState() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [APIClientURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        APIClientURLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/screenshot-jobs")
            XCTAssertEqual(request.timeoutInterval, 30)
            let body = try requestBodyData(request)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: String]
            )
            XCTAssertEqual(object["mimeType"], "image/jpeg")
            XCTAssertEqual(object["imageBase64"], Data("image".utf8).base64EncodedString())
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 202,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )
            )
            let data = #"{"job":{"id":"job-1","state":"accepted","createdAt":"2026-08-08T00:00:00Z","updatedAt":"2026-08-08T00:00:00Z","attemptCount":0,"cardId":"","errorCode":"","errorMessage":"","retryable":false}}"#.data(using: .utf8)!
            return (response, data)
        }
        defer { APIClientURLProtocolStub.handler = nil }

        let job = try await APIClient(
            baseURL: URL(string: "https://omo-testflight-staging.example.com")!,
            session: session
        ).createScreenshotJob(from: Data("image".utf8))

        XCTAssertEqual(job.id, "job-1")
        XCTAssertEqual(job.state, .accepted)
        XCTAssertTrue(job.isActive)
        XCTAssertFalse(job.canRetry)
    }

    func testAIProcessingConsentRequiresPromptUntilExplicitlyGranted() {
        XCTAssertTrue(AIProcessingConsent.requiresPrompt(hasConsent: false))
        XCTAssertFalse(AIProcessingConsent.requiresPrompt(hasConsent: true))
        XCTAssertEqual(AIProcessingConsent.defaultsKey, "omo.ai-processing-consent.v1")
    }

    func testKnowledgeLibrarySearchSendsOnlyQueryWithDeviceIDAndDecodesOrderedIDs() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [APIClientURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        APIClientURLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/memory-cards/search")
            XCTAssertFalse((request.value(forHTTPHeaderField: "X-Device-Id") ?? "").isEmpty)
            let body = try requestBodyData(request)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: String]
            )
            XCTAssertEqual(object, ["query": "如何避免认知卸载"])
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )
            )
            return (response, #"{"orderedCardIDs":["card-b","card-a"]}"#.data(using: .utf8)!)
        }
        defer { APIClientURLProtocolStub.handler = nil }

        let result = try await APIClient(
            baseURL: URL(string: "https://omo-testflight-staging.example.com")!,
            session: session
        ).searchKnowledgeLibrary(query: "如何避免认知卸载")

        XCTAssertEqual(result.orderedCardIDs, ["card-b", "card-a"])
    }

    func testReleaseEnvironmentRejectsMissingAPIURLInsteadOfFallingBackToProduction() {
        XCTAssertThrowsError(
            try AppEnvironment.resolveAPIBaseURL(
                infoDictionary: [:],
                processEnvironment: [:],
                allowsDebugLocalhostFallback: false
            )
        ) { error in
            XCTAssertEqual(error as? AppEnvironmentError, .missingAPIBaseURL)
        }
    }

    func testReleaseEnvironmentAcceptsInjectedHTTPSStagingURL() throws {
        for value in [
            "https://omo-testflight-staging.example.com",
            "https://omo-testflight-staging-production.up.railway.app"
        ] {
            let url = try AppEnvironment.resolveAPIBaseURL(
                infoDictionary: ["OmoAPIBaseURL": value],
                processEnvironment: [:],
                allowsDebugLocalhostFallback: false
            )

            XCTAssertEqual(url.absoluteString, value)
        }
    }

    func testReleaseEnvironmentRejectsInsecureAndLegacyProductionURLs() {
        for value in [
            "http://staging.example.com",
            "https://shibei-production.up.railway.app"
        ] {
            XCTAssertThrowsError(
                try AppEnvironment.resolveAPIBaseURL(
                    infoDictionary: ["OmoAPIBaseURL": value],
                    processEnvironment: [:],
                    allowsDebugLocalhostFallback: false
                )
            ) { error in
                XCTAssertEqual(error as? AppEnvironmentError, .invalidAPIBaseURL)
            }
        }
    }

    func testDebugEnvironmentAllowsExplicitOverrideAndLocalFallback() throws {
        let override = try AppEnvironment.resolveAPIBaseURL(
            infoDictionary: [:],
            processEnvironment: ["OMO_API_BASE_URL": "http://127.0.0.1:9999"],
            allowsDebugLocalhostFallback: true
        )
        let fallback = try AppEnvironment.resolveAPIBaseURL(
            infoDictionary: [:],
            processEnvironment: [:],
            allowsDebugLocalhostFallback: true
        )

        XCTAssertEqual(override.absoluteString, "http://127.0.0.1:9999")
        XCTAssertEqual(fallback.absoluteString, "http://127.0.0.1:5174")
    }

    func testMemoryCardDecodesFromMinimalAPIContract() throws {
        let data = #"{"id":"card-1","coreKnowledge":"知识点","recallCue":"提示","answer":"答案","explanation":"解释","sourceTitle":"截图","rarity":"SR","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertEqual(card.id, "card-1")
        XCTAssertEqual(card.rarity, "SR")
        XCTAssertEqual(card.masteryTitle, "封存")
        XCTAssertNil(card.hiddenSemantic)
        XCTAssertFalse(card.isRecallEligible)
    }

    func testMemoryCardDecodesHiddenSemanticAndBuildsExactSegments() throws {
        let data = #"{"id":"card-2","coreKnowledge":"截图可能触发认知卸载。","hiddenSemantic":"认知卸载","recallCue":"为什么截图会影响记忆？","answer":"认知卸载","explanation":"设备替代了主动编码。","sourceTitle":"截图","rarity":"R","createdAt":"2026-07-29T00:00:00Z","masteryStage":"sealed","nextReviewAt":"2026-07-29T00:00:00Z","reviewCount":0,"successfulRecallCount":0,"lastAssessment":null}"#.data(using: .utf8)!

        let card = try JSONDecoder().decode(MemoryCard.self, from: data)

        XCTAssertTrue(card.isRecallEligible)
        XCTAssertEqual(
            card.knowledgeSegments,
            RecallKnowledgeSegments(prefix: "截图可能触发", semantic: "认知卸载", suffix: "。")
        )
    }

    @MainActor
    func testRecallDeckIsEligibleDueAndLimitedToTenCards() throws {
        let store = OmoStore()
        store.cards = try (0..<12).map { try makeCard(id: "valid-\($0)", hiddenSemantic: "知识") }
        store.cards.append(try makeCard(id: "legacy", hiddenSemantic: nil))

        XCTAssertEqual(store.nextRecallDeck.count, 10)
        XCTAssertTrue(store.nextRecallDeck.allSatisfy(\.isRecallEligible))
        XCTAssertFalse(store.nextRecallDeck.contains { $0.id == "legacy" })
    }

    private func makeCard(id: String, hiddenSemantic: String?) throws -> MemoryCard {
        var object: [String: Any] = [
            "id": id,
            "coreKnowledge": "完整知识",
            "recallCue": "提示",
            "answer": hiddenSemantic ?? "旧答案",
            "explanation": "解释",
            "sourceTitle": "截图",
            "rarity": "R",
            "createdAt": "2020-01-01T00:00:00Z",
            "masteryStage": "sealed",
            "nextReviewAt": "2020-01-01T00:00:00Z",
            "reviewCount": 0,
            "successfulRecallCount": 0,
            "lastAssessment": NSNull()
        ]
        if let hiddenSemantic { object["hiddenSemantic"] = hiddenSemantic }
        return try JSONDecoder().decode(
            MemoryCard.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }
}

private func requestBodyData(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody { return body }
    let stream = try XCTUnwrap(request.httpBodyStream)
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1_024)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { throw try XCTUnwrap(stream.streamError) }
        if count == 0 { break }
        data.append(buffer, count: count)
    }
    return data
}

private final class APIClientURLProtocolStub: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let handler = try XCTUnwrap(Self.handler)
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
