import XCTest
import UIKit
@testable import 拾贝

final class APIClientDecodingTests: XCTestCase {
    func testDecodesChaptersResponseShape() throws {
        let data = try fixtureData(named: "completed-chapter")
        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)
        let responseData = try JSONEncoder().encode(ChaptersResponse(chapters: [fixture.chapter]))

        let response = try JSONDecoder().decode(ChaptersResponse.self, from: responseData)

        XCTAssertEqual(response.chapters.count, 1)
        XCTAssertEqual(response.chapters[0].id, fixture.chapter.id)
        XCTAssertEqual(response.chapters[0].knowledgePoints.count, fixture.chapter.knowledgePoints.count)
    }

    func testDecodesLegacyChapterWithoutCoreSummary() throws {
        var payload = try completedChapterPayload()
        var chapter = try XCTUnwrap(payload["chapter"] as? [String: Any])
        chapter.removeValue(forKey: "coreSummary")
        payload["chapter"] = chapter
        let data = try JSONSerialization.data(withJSONObject: payload)

        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)

        XCTAssertEqual(fixture.chapter.coreSummary, "")
        XCTAssertEqual(fixture.chapter.id, "chapter-ai-agent-business")
    }

    func testDecodesLegacyChapterWithInvalidCoreSummaryType() throws {
        var payload = try completedChapterPayload()
        var chapter = try XCTUnwrap(payload["chapter"] as? [String: Any])
        chapter["coreSummary"] = ["legacy": true]
        payload["chapter"] = chapter
        let data = try JSONSerialization.data(withJSONObject: payload)

        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)

        XCTAssertEqual(fixture.chapter.coreSummary, "")
        XCTAssertEqual(fixture.chapter.id, "chapter-ai-agent-business")
    }

    func testDecodesChapterResponseShape() throws {
        let data = try fixtureData(named: "failed-chapter")
        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)
        let responseData = try JSONEncoder().encode(ChapterResponse(chapter: fixture.chapter))

        let response = try JSONDecoder().decode(ChapterResponse.self, from: responseData)

        XCTAssertEqual(response.chapter.id, fixture.chapter.id)
        XCTAssertTrue(response.chapter.status.isFailed)
    }

    func testParsesLongTextChapterInput() {
        let input = ChapterInput.parse("  这是一段足够长的普通文本，用来测试粘贴正文的添加流程。  ")

        XCTAssertEqual(input.sourceType, .text)
        XCTAssertEqual(input.rawText, "这是一段足够长的普通文本，用来测试粘贴正文的添加流程。")
        XCTAssertNil(input.sourceUrl)
        XCTAssertTrue(input.canSubmit)
    }

    func testParsesArticleURLChapterInput() {
        let input = ChapterInput.parse("https://example.com/article")

        XCTAssertEqual(input.sourceType, .articleLink)
        XCTAssertEqual(input.sourceUrl, "https://example.com/article")
        XCTAssertNil(input.rawText)
        XCTAssertTrue(input.canSubmit)
    }

    func testParsesWechatArticleURLChapterInput() {
        let input = ChapterInput.parse("https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A")

        XCTAssertEqual(input.sourceType, .wechatArticle)
        XCTAssertEqual(input.sourceUrl, "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A")
        XCTAssertNil(input.rawText)
        XCTAssertTrue(input.canSubmit)
    }

    func testParsesVideoURLChapterInput() {
        let input = ChapterInput.parse("https://www.youtube.com/watch?v=abc123")

        XCTAssertEqual(input.sourceType, .videoLink)
        XCTAssertEqual(input.sourceUrl, "https://www.youtube.com/watch?v=abc123")
        XCTAssertNil(input.rawText)
        XCTAssertTrue(input.canSubmit)
    }

    func testTreatsNonHTTPURLChapterInputAsInvalidLink() {
        let input = ChapterInput.parse("ftp://example.com/article")

        XCTAssertEqual(input.sourceType, .text)
        XCTAssertEqual(input.rawText, "ftp://example.com/article")
        XCTAssertNil(input.sourceUrl)
        XCTAssertEqual(input.validationError, .invalidLinkFormat)
        XCTAssertFalse(input.canSubmit)
    }

    func testTreatsLinkLikeInputsWithoutHTTPSchemeAsInvalidLink() {
        let values = [
            "mp.weixin.qq.com/s/abc",
            "www.example.com/a",
            "http//example.com/a",
            "https:/example.com/a"
        ]

        for value in values {
            let input = ChapterInput.parse(value)

            XCTAssertEqual(input.sourceType, .text, value)
            XCTAssertEqual(input.rawText, value, value)
            XCTAssertNil(input.sourceUrl, value)
            XCTAssertEqual(input.validationError, .invalidLinkFormat, value)
            XCTAssertFalse(input.canSubmit, value)
        }
    }

    func testParsesShortTextChapterInputAsTextTooShort() {
        let input = ChapterInput.parse("短文本")

        XCTAssertEqual(input.sourceType, .text)
        XCTAssertEqual(input.rawText, "短文本")
        XCTAssertNil(input.sourceUrl)
        XCTAssertNil(input.validationError)
        XCTAssertFalse(input.canSubmit)
    }

    func testParsesMixedTextAndURLChapterInputAsLink() {
        let input = ChapterInput.parse("请学习这篇文章 https://example.com/article")

        XCTAssertEqual(input.sourceType, .articleLink)
        XCTAssertNil(input.rawText)
        XCTAssertEqual(input.sourceUrl, "https://example.com/article")
        XCTAssertNil(input.validationError)
    }

    func testParsesSharedXiaohongshuTextAsVideoLink() {
        let input = ChapterInput.parse("98 【Agent Skill过多？4招提升命中 - 小哲讲大模型 / 小红书 - 你的生活兴趣社区】 😆 CzNutypu7EuXU05 😆 https://www.xiaohongshu.com/discovery/item/6a1a977b00000000360194ee?source=webshare&xhsshare=pc_web&xsec_token=ABTAH-AAksyoinRIIxRW83BYFC98M4RM8oSLYoaBdwwec=&xsec_source=pc_share")

        XCTAssertEqual(input.sourceType, .videoLink)
        XCTAssertNil(input.rawText)
        XCTAssertEqual(input.sourceUrl, "https://www.xiaohongshu.com/discovery/item/6a1a977b00000000360194ee?source=webshare&xhsshare=pc_web&xsec_token=ABTAH-AAksyoinRIIxRW83BYFC98M4RM8oSLYoaBdwwec=&xsec_source=pc_share")
        XCTAssertNil(input.validationError)
    }

    func testTrimsTrailingPunctuationFromSharedURL() {
        let input = ChapterInput.parse("请看这个链接（https://www.bilibili.com/video/BV1hYGd63EnU/）")

        XCTAssertEqual(input.sourceType, .videoLink)
        XCTAssertEqual(input.sourceUrl, "https://www.bilibili.com/video/BV1hYGd63EnU/")
        XCTAssertNil(input.validationError)
    }

    func testDecodesNotificationsResponseShape() throws {
        let data = try fixtureData(named: "completed-chapter")
        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)
        let notification = try XCTUnwrap(fixture.notification)
        let responseData = try JSONEncoder().encode(NotificationsResponse(notifications: [notification]))

        let response = try JSONDecoder().decode(NotificationsResponse.self, from: responseData)

        XCTAssertEqual(response.notifications.count, 1)
        XCTAssertEqual(response.notifications[0].chapterId, fixture.chapter.id)
    }

    func testDecodesNotificationReadResponseShape() throws {
        var notification = try completedChapterNotification()
        notification.read = true
        let responseData = try JSONEncoder().encode(NotificationMutationResponse(notification: notification))

        let response = try JSONDecoder().decode(NotificationMutationResponse.self, from: responseData)

        XCTAssertTrue(response.notification.read)
        XCTAssertFalse(response.notification.dismissed)
    }

    func testDecodesNotificationDismissResponseShape() throws {
        var notification = try completedChapterNotification()
        notification.read = true
        notification.dismissed = true
        let responseData = try JSONEncoder().encode(NotificationMutationResponse(notification: notification))

        let response = try JSONDecoder().decode(NotificationMutationResponse.self, from: responseData)

        XCTAssertTrue(response.notification.read)
        XCTAssertTrue(response.notification.dismissed)
    }

    func testDecodesSuccessfulChapterMutationResponseShape() throws {
        let data = try fixtureData(named: "completed-chapter")
        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)
        let responseData = try JSONEncoder().encode(
            ChapterMutationResponse(status: .completed, chapter: fixture.chapter, notification: fixture.notification, message: "")
        )

        let response = try JSONDecoder().decode(ChapterMutationResponse.self, from: responseData)

        XCTAssertEqual(response.status, .completed)
        XCTAssertEqual(response.chapter.id, fixture.chapter.id)
        XCTAssertEqual(response.notification?.chapterId, fixture.chapter.id)
    }

    func testDecodesFailedChapterMutationResponseShape() throws {
        let data = try fixtureData(named: "failed-chapter")
        let fixture = try JSONDecoder().decode(ChapterFixture.self, from: data)
        let notification = NotificationItem(
            id: "notification-failed",
            chapterId: fixture.chapter.id,
            type: .generationFailed,
            title: "生成失败",
            body: "点击查看原因",
            read: false,
            dismissed: false,
            createdAt: "2026-05-17T00:00:00Z"
        )
        let responseData = try JSONEncoder().encode(
            ChapterMutationResponse(status: fixture.chapter.status, chapter: fixture.chapter, notification: notification, message: fixture.chapter.failureReason)
        )

        let response = try JSONDecoder().decode(ChapterMutationResponse.self, from: responseData)

        XCTAssertTrue(response.chapter.status.isFailed)
        XCTAssertEqual(response.notification?.type, .generationFailed)
    }

    func testEncodesTextChapterCreateRequestShape() throws {
        let input = ChapterInput.parse("这是一段足够长的输入内容，用于生成一个新的复习章节。")
        let data = try JSONEncoder().encode(ChapterCreateRequest(input: input))
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(payload?["sourceType"] as? String, "text")
        XCTAssertEqual(payload?["rawText"] as? String, input.rawText)
        XCTAssertNil(payload?["sourceUrl"])
    }

    func testEncodesArticleLinkChapterCreateRequestShape() throws {
        let input = ChapterInput.parse("https://example.com/article")
        let data = try JSONEncoder().encode(ChapterCreateRequest(input: input))
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(payload?["sourceType"] as? String, "article_link")
        XCTAssertNil(payload?["rawText"])
        XCTAssertEqual(payload?["sourceUrl"] as? String, "https://example.com/article")
    }

    func testEncodesWechatArticleChapterCreateRequestShape() throws {
        let input = ChapterInput.parse("https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A")
        let data = try JSONEncoder().encode(ChapterCreateRequest(input: input))
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(payload?["sourceType"] as? String, "wechat_article")
        XCTAssertNil(payload?["rawText"])
        XCTAssertEqual(payload?["sourceUrl"] as? String, "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A")
    }

    func testEncodesV2WechatArticleChapterCreateRequestShape() throws {
        let request = V2CreateChapterRequest(
            clientRequestId: "ios-v2-test",
            sourceType: ChapterInput.parse("https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A").sourceType.rawValue,
            sourceUrl: "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A",
            sourceTitle: nil,
            rawText: nil
        )
        let data = try JSONEncoder().encode(request)
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(payload?["sourceType"] as? String, "wechat_article")
        XCTAssertEqual(payload?["sourceUrl"] as? String, "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A")
    }

    func testV2SourceLabelDistinguishesWechatArticle() {
        let chapter = V2BackendChapter(
            schemaVersion: "v2_review_path_1",
            id: "chapter-wechat",
            title: "游戏化体验",
            status: "completed",
            displayStatusText: nil,
            failureReason: nil,
            source: V2BackendSource(
                type: "wechat_article",
                title: "游戏化体验",
                author: nil,
                account: "公众号",
                accountOrDomain: "公众号",
                url: "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A",
                rawText: nil,
                cleanedText: nil,
                rawInput: nil,
                extractedText: nil,
                blocks: nil
            ),
            summaryCard: nil,
            units: nil,
            chapterSummary: nil,
            generationProgress: nil,
            v2ReviewSession: nil
        )

        XCTAssertEqual(chapter.sourceLabel, "微信公众号")
    }

    func testV2SourceLabelInfersWechatArticleFromLegacyTextTypeURL() {
        let chapter = V2BackendChapter(
            schemaVersion: "v2_review_path_1",
            id: "chapter-wechat-legacy",
            title: "游戏化体验",
            status: "completed",
            displayStatusText: nil,
            failureReason: nil,
            source: V2BackendSource(
                type: "text",
                title: "游戏化体验",
                author: nil,
                account: nil,
                accountOrDomain: nil,
                url: "https://mp.weixin.qq.com/s/_WY2GXs-iynGePgdsYLi0A",
                rawText: nil,
                cleanedText: nil,
                rawInput: nil,
                extractedText: nil,
                blocks: nil
            ),
            summaryCard: nil,
            units: nil,
            chapterSummary: nil,
            generationProgress: nil,
            v2ReviewSession: nil
        )

        XCTAssertEqual(chapter.sourceLabel, "微信公众号")
    }

    func testEncodesVideoLinkChapterCreateRequestShape() throws {
        let input = ChapterInput.parse("https://www.youtube.com/watch?v=abc123")
        let data = try JSONEncoder().encode(ChapterCreateRequest(input: input))
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertEqual(payload?["sourceType"] as? String, "video_link")
        XCTAssertNil(payload?["rawText"])
        XCTAssertEqual(payload?["sourceUrl"] as? String, "https://www.youtube.com/watch?v=abc123")
    }

    func testDecodesChapterDeletionResponseShape() throws {
        let responseData = try JSONEncoder().encode(ChapterDeletionResponse(deleted: true, chapterId: "chapter-1"))

        let response = try JSONDecoder().decode(ChapterDeletionResponse.self, from: responseData)

        XCTAssertTrue(response.deleted)
        XCTAssertEqual(response.chapterId, "chapter-1")
    }

    func testDecodesReviewSessionResponseShape() throws {
        var fixture = try completedChapterFixture()
        let active = try activeReviewSessionFixture()
        fixture.chapter.reviewSession = active.reviewSession
        let question = try XCTUnwrap(fixture.chapter.questions.first { $0.id == active.currentQuestionId })
        let responseData = try JSONEncoder().encode(
            ReviewSessionResponse(chapter: fixture.chapter, reviewSession: active.reviewSession, currentQuestion: question)
        )

        let response = try JSONDecoder().decode(ReviewSessionResponse.self, from: responseData)

        XCTAssertEqual(response.chapter.id, fixture.chapter.id)
        XCTAssertEqual(response.reviewSession?.id, active.reviewSession.id)
        XCTAssertEqual(response.currentQuestion?.id, active.currentQuestionId)
    }

    func testDecodesAttemptResponseWithActiveSessionShape() throws {
        var fixture = try completedChapterFixture()
        let active = try activeReviewSessionFixture()
        fixture.chapter.reviewSession = active.reviewSession
        let attempt = try XCTUnwrap(active.reviewSession.attempts.first)
        let question = try XCTUnwrap(fixture.chapter.questions.first { $0.id == active.currentQuestionId })
        let responseData = try JSONEncoder().encode(
            AttemptResponse(chapter: fixture.chapter, reviewSession: active.reviewSession, attempt: attempt, currentQuestion: question)
        )

        let response = try JSONDecoder().decode(AttemptResponse.self, from: responseData)

        XCTAssertEqual(response.reviewSession.status, .active)
        XCTAssertEqual(response.attempt.id, attempt.id)
        XCTAssertNotNil(response.currentQuestion)
    }

    func testDecodesAttemptResponseWithCompletedSessionShape() throws {
        var fixture = try completedChapterFixture()
        var active = try activeReviewSessionFixture()
        active.reviewSession.status = .completed
        active.reviewSession.completedAt = "2026-05-17T00:00:00Z"
        fixture.chapter.reviewSession = active.reviewSession
        let attempt = try XCTUnwrap(active.reviewSession.attempts.first)
        let responseData = try JSONEncoder().encode(
            AttemptResponse(chapter: fixture.chapter, reviewSession: active.reviewSession, attempt: attempt, currentQuestion: nil)
        )

        let response = try JSONDecoder().decode(AttemptResponse.self, from: responseData)

        XCTAssertEqual(response.reviewSession.status, .completed)
        XCTAssertNil(response.currentQuestion)
    }

    func testDecodesFeedbackResponseShape() throws {
        var fixture = try completedChapterFixture()
        let active = try activeReviewSessionFixture()
        fixture.chapter.reviewSession = active.reviewSession
        let question = try XCTUnwrap(fixture.chapter.questions.first)
        let feedback = QuestionFeedback(
            id: "feedback-1",
            questionId: question.id,
            knowledgePointId: question.knowledgePointId,
            chapterId: fixture.chapter.id,
            reviewSessionId: active.reviewSession.id,
            feedbackType: .unclear,
            severity: "severe",
            actionTaken: "removed_from_pool",
            invalidatedAttemptId: active.reviewSession.attempts.first?.id ?? "",
            createdAt: "2026-05-17T00:00:00Z"
        )
        let responseData = try JSONEncoder().encode(
            FeedbackResponse(chapter: fixture.chapter, feedback: feedback, reviewSession: active.reviewSession)
        )

        let response = try JSONDecoder().decode(FeedbackResponse.self, from: responseData)

        XCTAssertEqual(response.feedback.feedbackType, .unclear)
        XCTAssertTrue(response.feedback.feedbackType.isSevere)
        XCTAssertEqual(response.reviewSession?.id, active.reviewSession.id)
    }

    func testDecodesUnansweredAwakeningCardWithoutLeakingAnswer() throws {
        let data = Data(
            """
            {
              "availableCount": 3,
              "awakeningSession": {
                "schemaVersion": "v2_awakening_session_1",
                "id": "awakening-1",
                "status": "revealed_unanswered",
                "chapterId": "chapter-1",
                "unitId": "unit-1",
                "questionId": "question-1",
                "dueReason": "time_decay",
                "lifecycleState": "due",
                "sourceType": "article_link",
                "sourceAgeDays": 83,
                "visualSeed": "seed",
                "answer": null,
                "revealedAt": "2026-07-24T10:00:00.000Z",
                "answeredAt": null,
                "completedAt": null,
                "createdAt": "2026-07-24T10:00:00.000Z",
                "updatedAt": "2026-07-24T10:00:00.000Z"
              },
              "card": {
                "id": "card-1",
                "sessionId": "awakening-1",
                "chapterId": "chapter-1",
                "chapterTitle": "共享上下文",
                "unitId": "unit-1",
                "unitTitle": "协作基础",
                "questionId": "question-1",
                "sourceType": "article_link",
                "sourceAgeDays": 83,
                "lifecycleState": "due",
                "dueReason": "time_decay",
                "visualSeed": "seed",
                "question": {
                  "id": "question-1",
                  "type": "multiple_choice",
                  "stem": "团队首先应该补足什么？",
                  "options": [
                    {"id": "a", "text": "共享上下文"},
                    {"id": "b", "text": "减少沟通"}
                  ]
                }
              },
              "feedback": null,
              "chapter": null
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(V2AwakeningSessionResponse.self, from: data)

        XCTAssertTrue(response.hasActiveCard)
        XCTAssertEqual(response.awakeningSession?.lifecycleTitle, "待唤醒")
        XCTAssertEqual(response.card?.question.options.map(\.id), ["a", "b"])
        XCTAssertNil(response.feedback)
    }

    func testDecodesFormalScreenshotMemoryCard() throws {
        let data = Data(
            """
            {
              "status": "completed",
              "memoryCard": {
                "id": "card-1",
                "state": "formal",
                "coreKnowledge": "什么情况下使用间隔复习？ → 需要长期记住时",
                "recallCue": "什么情况下使用间隔复习？",
                "hiddenSemantic": "需要长期记住时",
                "explanation": "它适合跨越较长时间保持的信息。",
                "rarity": "SR",
                "rarityReason": "这是一条可在相似场景复用的方法或机制。",
                "sourceTitle": "间隔复习",
                "sourceUrl": "https://www.bilibili.com/video/BVtest",
                "sourceStatus": "verified"
              }
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(ImageFlowResponse.self, from: data)

        XCTAssertEqual(response.memoryCard?.state, .formal)
        XCTAssertEqual(response.memoryCard?.rarity, .sr)
        XCTAssertEqual(response.memoryCard?.hiddenSemantic, "需要长期记住时")
        XCTAssertEqual(response.memoryCard?.sourceStatus, .verified)
    }

    func testDecodesScreenshotFragmentFromFailureResponse() throws {
        let data = Data(
            """
            {
              "status": "search_match_low_confidence",
              "message": "没有找到可信来源。",
              "memoryCard": {
                "id": "fragment-1",
                "state": "fragment",
                "coreKnowledge": "待核对标题",
                "recallCue": "你当时为什么想记住这张截图？",
                "explanation": "没有找到可信来源。",
                "sourceStatus": "unconfirmed"
              }
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(ImageFlowResponse.self, from: data)

        XCTAssertEqual(response.memoryCard?.state, .fragment)
        XCTAssertNil(response.memoryCard?.rarity)
        XCTAssertNil(response.memoryCard?.hiddenSemantic)
        XCTAssertEqual(response.memoryCard?.sourceStatus, .unconfirmed)
    }

    func testScreenshotDrawSessionDeduplicatesAndLimitsContinuousDraw() {
        let cards = (0..<12).map { index in
            V2CapturedMemoryCard(
                card: ImageFlowMemoryCard(
                    id: "card-\(index % 11)",
                    state: .formal,
                    coreKnowledge: "知识 \(index)",
                    recallCue: "问题 \(index)",
                    hiddenSemantic: "答案 \(index)",
                    explanation: "解释",
                    rarity: .r,
                    rarityReason: "原因",
                    sourceTitle: nil,
                    sourceUrl: nil,
                    sourceStatus: .verified
                ),
                screenshotData: Data()
            )
        }

        let session = V2ScreenshotDrawSession.make(mode: .continuous, from: cards)

        XCTAssertEqual(session?.cards.count, 10)
        XCTAssertEqual(Set(session?.cards.map(\.id) ?? []).count, 10)
    }

    func testScreenshotMemoryPoolsUseTransparentEligibilityRules() {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let oldCard = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "old"),
            screenshotData: Data(),
            capturedAt: now.addingTimeInterval(-31 * 24 * 60 * 60)
        )
        let fadingCard = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "fading"),
            screenshotData: Data(),
            lastAssessment: .forgot,
            capturedAt: now
        )

        let timeCapsule = V2ScreenshotDrawSession.make(
            mode: .continuous,
            from: [oldCard, fadingCard],
            pool: .timeCapsule,
            now: now
        )
        let fading = V2ScreenshotDrawSession.make(
            mode: .continuous,
            from: [oldCard, fadingCard],
            pool: .fading,
            now: now
        )

        XCTAssertEqual(timeCapsule?.cards.map(\.id), ["old"])
        XCTAssertEqual(fading?.cards.map(\.id), ["fading"])
    }

    func testScreenshotMasteryAdvancesFromRecallEvidenceWithoutRegressing() {
        var card = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "mastery"),
            screenshotData: Data()
        )

        card.apply(.fuzzy, schedule: schedule(days: 1))
        XCTAssertEqual(card.masteryStage, .awakened)

        card.apply(.forgot, schedule: schedule(days: 1))
        XCTAssertEqual(card.masteryStage, .awakened)

        card.apply(.remembered, schedule: schedule(days: 3))
        XCTAssertEqual(card.masteryStage, .solidified)

        card.apply(.remembered, schedule: schedule(days: 7))
        XCTAssertEqual(card.masteryStage, .engraved)
        XCTAssertEqual(card.successfulRecallCount, 2)
        XCTAssertEqual(card.schedule?.intervalDays, 7)
    }

    func testServerMasteryOverridesLegacyClientProgression() throws {
        let data = Data(
            """
            {
              "schemaVersion": "capture_memory_assessment_1",
              "cardId": "capture-card-1",
              "assessment": {
                "attemptId": "attempt-server-mastery",
                "assessment": "remembered",
                "assessedAt": "2026-07-25T10:00:00.000Z",
                "repeated": true
              },
              "mastery": {
                "before": "awakened",
                "after": "solidified",
                "successfulRecallCount": 7,
                "reviewCount": 11
              },
              "schedule": {
                "nextReviewAt": "2026-08-01T10:00:00.000Z",
                "intervalDays": 7,
                "state": "scheduled"
              }
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(CaptureMemoryCardAssessmentResponse.self, from: data)
        var card = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "capture-card-1"),
            screenshotData: Data()
        )
        let canonicalAssessment = response.canonicalAssessment(fallback: .forgot)
        card.apply(canonicalAssessment, schedule: response.schedule, serverMastery: response.mastery)

        XCTAssertEqual(response.mastery?.before, "awakened")
        XCTAssertEqual(response.mastery?.after, "solidified")
        XCTAssertEqual(card.masteryStage, .solidified)
        XCTAssertEqual(card.successfulRecallCount, 7)
        XCTAssertEqual(card.reviewCount, 11)
        XCTAssertEqual(card.lastAssessment, .remembered)
        XCTAssertEqual(canonicalAssessment, .remembered)
        XCTAssertEqual(V2MemoryMasteryStage(rawServerValue: "stable"), .solidified)
    }

    func testOptionalScheduleProducesStableInitialReviewCycleKey() {
        let card = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "unscheduled"),
            screenshotData: Data()
        )

        XCTAssertEqual(card.reviewCycleKey(), "unscheduled-initial")
        XCTAssertEqual(card.reviewCycleKey(), card.reviewCycleKey())
    }

    func testPresentationResumeRejectsDifferentReviewCycle() {
        let initial = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "cycle-card"),
            screenshotData: Data(),
            schedule: schedule(at: Date(timeIntervalSince1970: 2_000_000_000), days: 1)
        )
        let persistedKey = initial.reviewCycleKey()
        let nextCycle = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "cycle-card"),
            screenshotData: Data(),
            schedule: schedule(at: Date(timeIntervalSince1970: 2_000_086_400), days: 3)
        )

        XCTAssertTrue(initial.matchesPersistedPresentation(
            cardID: initial.id,
            reviewCycleKey: persistedKey
        ))
        XCTAssertFalse(nextCycle.matchesPersistedPresentation(
            cardID: initial.id,
            reviewCycleKey: persistedKey
        ))
    }

    func testAccountDeletionClearsPersistedScreenshotRecallState() throws {
        let suiteName = "recallo.tests.account-deletion.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        for key in V2ScreenshotPersistence.keys {
            defaults.set("private-capture-state", forKey: key)
        }

        V2ScreenshotPersistence.clear(from: defaults)

        XCTAssertFalse(V2ScreenshotPersistence.keys.isEmpty)
        for key in V2ScreenshotPersistence.keys {
            XCTAssertNil(defaults.object(forKey: key), key)
        }
        XCTAssertTrue(V2ScreenshotPersistence.keys.contains("recallo.v06.scratchPaths"))
        XCTAssertTrue(V2ScreenshotPersistence.keys.contains("recallo.v06.presentationReviewCycleKey"))
        XCTAssertTrue(V2ScreenshotPersistence.keys.contains("recallo.v06.assessedReviewCycles"))
    }

    func testDecodesCaptureAnalysisV2WithTypedVariantsAndPartialSource() throws {
        let data = Data(
            """
            {
              "status": "completed",
              "captureAnalysis": {
                "schemaVersion": "capture_memory_card_2",
                "disposition": "create_card",
                "sourceStatus": "partial",
                "memoryCard": {
                  "id": "capture-card-1",
                  "coreKnowledge": "主动提取比被动重看更能暴露遗忘。",
                  "recallCue": "什么方式更能暴露遗忘？",
                  "hiddenSemantic": "主动提取",
                  "explanation": "主动提取要求用户先重建答案。",
                  "sourceEvidenceIds": ["evidence-1"],
                  "rarity": "SR",
                  "rarityReason": "可以迁移到多个学习场景。",
                  "rarityConfidence": 0.87,
                  "rarityRuleVersion": "core-potential-1",
                  "sourceStatus": "partial",
                  "recallVariants": [
                    {
                      "id": "variant-cloze",
                      "type": "semantic_cloze",
                      "prompt": "____比被动重看更能暴露遗忘。",
                      "answer": "主动提取",
                      "options": [],
                      "correctOptionId": null,
                      "correctBoolean": null,
                      "explanation": "原句遮挡。",
                      "sourceEvidenceIds": ["evidence-1"]
                    },
                    {
                      "id": "variant-tf",
                      "type": "true_false",
                      "prompt": "被动重看更能暴露遗忘。",
                      "answer": "错误",
                      "options": [],
                      "correctOptionId": null,
                      "correctBoolean": false,
                      "explanation": "证据支持主动提取。",
                      "sourceEvidenceIds": ["evidence-1"]
                    },
                    {
                      "id": "variant-mcq",
                      "type": "multiple_choice",
                      "prompt": "哪种方式更能暴露遗忘？",
                      "answer": "主动提取",
                      "options": [
                        {"id": "a", "text": "主动提取"},
                        {"id": "b", "text": "被动重看"}
                      ],
                      "correctOptionId": "a",
                      "correctBoolean": null,
                      "explanation": "只有一个正确答案。",
                      "sourceEvidenceIds": ["evidence-1"]
                    }
                  ]
                },
                "schedule": {
                  "nextReviewAt": "2026-07-25T10:00:00.000Z",
                  "intervalDays": 1,
                  "state": "scheduled",
                  "status": "scheduled"
                }
              }
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(ImageFlowResponse.self, from: data)

        XCTAssertEqual(response.captureAnalysis?.schemaVersion, "capture_memory_card_2")
        XCTAssertEqual(response.captureAnalysis?.disposition, .createCard)
        XCTAssertEqual(response.captureAnalysis?.sourceStatus, .partial)
        XCTAssertEqual(response.captureAnalysis?.memoryCard?.recallVariants?.map(\.type), [
            .semanticCloze,
            .trueFalse,
            .multipleChoice
        ])
        XCTAssertEqual(response.captureAnalysis?.schedule?.intervalDays, 1)
        XCTAssertNotNil(response.captureAnalysis?.schedule?.nextReviewDate)
    }

    func testDecodesFlatCaptureCardListAndCanonicalScheduleState() throws {
        let data = Data(
            """
            {
              "schemaVersion": "capture_memory_cards_1",
              "cards": [{
                "id": "capture-card-1",
                "state": "formal",
                "coreKnowledge": "证据绑定让复习结果可核对。",
                "recallCue": "什么让复习结果可核对？",
                "hiddenSemantic": "证据绑定",
                "explanation": "答案对应原始证据。",
                "sourceEvidenceIds": ["evidence-1"],
                "rarity": "R",
                "rarityReason": "具体且有用。",
                "sourceStatus": "verified",
                "schedule": {
                  "nextReviewAt": "2026-07-24T09:00:00.000Z",
                  "intervalDays": 1,
                  "state": "due",
                  "status": "due"
                },
                "createdAt": "2026-07-20T09:00:00.000Z",
                "updatedAt": "2026-07-24T09:00:00.000Z"
              }]
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(CaptureMemoryCardsResponse.self, from: data)

        XCTAssertEqual(response.cards.first?.memoryCard.id, "capture-card-1")
        XCTAssertEqual(response.cards.first?.disposition, .createCard)
        XCTAssertEqual(response.cards.first?.schedule?.state, "due")
        XCTAssertEqual(response.cards.first?.capturedAt, "2026-07-20T09:00:00.000Z")
    }

    func testDecodesIdempotentCaptureAssessmentSchedule() throws {
        let data = Data(
            """
            {
              "schemaVersion": "capture_memory_assessment_1",
              "cardId": "capture-card-1",
              "assessment": {
                "attemptId": "attempt-stable",
                "assessment": "remembered",
                "assessedAt": "2026-07-24T10:00:00.000Z",
                "repeated": true
              },
              "schedule": {
                "nextReviewAt": "2026-07-27T10:00:00.000Z",
                "intervalDays": 3,
                "state": "scheduled",
                "status": "scheduled"
              }
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(CaptureMemoryCardAssessmentResponse.self, from: data)

        XCTAssertEqual(response.assessment.attemptId, "attempt-stable")
        XCTAssertTrue(response.assessment.repeated)
        XCTAssertEqual(response.schedule.intervalDays, 3)
        XCTAssertNil(response.mastery)
    }

    func testFragmentsNeverEnterFormalReviewPools() {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let fragment = ImageFlowMemoryCard(
            id: "fragment-archive",
            state: .fragment,
            coreKnowledge: "待确认的截图内容",
            recallCue: "为什么保存它？",
            hiddenSemantic: nil,
            explanation: "来源不足",
            rarity: nil,
            rarityReason: nil,
            sourceTitle: nil,
            sourceUrl: nil,
            sourceStatus: .unconfirmed
        )
        let archived = V2CapturedMemoryCard(
            card: fragment,
            screenshotData: Data(),
            disposition: .archiveOnly,
            capturedAt: now.addingTimeInterval(-60 * 24 * 60 * 60)
        )
        let pending = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "pending-formal-shape"),
            screenshotData: Data(),
            disposition: .needsConfirmation,
            lastAssessment: .forgot,
            capturedAt: now.addingTimeInterval(-60 * 24 * 60 * 60)
        )

        for pool in V2MemoryPool.allCases {
            XCTAssertFalse(archived.isEligible(for: pool, now: now))
            XCTAssertFalse(pending.isEligible(for: pool, now: now))
            XCTAssertNil(V2ScreenshotDrawSession.make(mode: .single, from: [archived, pending], pool: pool, now: now))
        }
        XCTAssertNil(archived.schedule)
        XCTAssertNil(pending.schedule)
        XCTAssertNil(archived.lastAssessment)
        XCTAssertNil(pending.lastAssessment)
        XCTAssertEqual(archived.successfulRecallCount, 0)
        XCTAssertEqual(pending.reviewCount, 0)
    }

    func testDecodesCaptureMemoryCardDeletionContract() throws {
        let data = Data(
            """
            {
              "schemaVersion": "capture_memory_card_deletion_1",
              "deleted": true,
              "cardId": "capture-card-1",
              "captureId": "capture-1",
              "deletedAt": "2026-07-25T10:00:00.000Z"
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(CaptureMemoryCardDeletionResponse.self, from: data)

        XCTAssertTrue(response.deleted)
        XCTAssertEqual(response.cardId, "capture-card-1")
        XCTAssertEqual(response.captureId, "capture-1")
    }

    func testDuePoolUsesNextReviewTimeAndStableOrdering() {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let later = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "later"),
            screenshotData: Data(),
            schedule: schedule(at: now.addingTimeInterval(-60), days: 1),
            capturedAt: now.addingTimeInterval(-300)
        )
        let earlier = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "earlier"),
            screenshotData: Data(),
            schedule: schedule(at: now.addingTimeInterval(-600), days: 1),
            capturedAt: now.addingTimeInterval(-200)
        )
        let future = V2CapturedMemoryCard(
            card: makeScreenshotMemoryCard(id: "future"),
            screenshotData: Data(),
            schedule: schedule(at: now.addingTimeInterval(600), days: 1),
            capturedAt: now.addingTimeInterval(-100)
        )

        let session = V2ScreenshotDrawSession.make(
            mode: .continuous,
            from: [later, future, earlier],
            pool: .due,
            now: now
        )

        XCTAssertEqual(session?.cards.map(\.id), ["earlier", "later"])
    }

    func testScreenshotImageProcessorProducesBoundedJPEG() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 3_000, height: 1_500))
        let image = renderer.image { context in
            UIColor.systemGreen.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 3_000, height: 1_500))
        }
        let source = try XCTUnwrap(image.pngData())

        let prepared = try V2ScreenshotImageProcessor.prepare(source)
        let decoded = try XCTUnwrap(UIImage(data: prepared))

        XCTAssertLessThanOrEqual(prepared.count, V2ScreenshotImageProcessor.maximumBytes)
        XCTAssertLessThanOrEqual(max(decoded.size.width, decoded.size.height), V2ScreenshotImageProcessor.maximumEdge)
    }

    private func makeScreenshotMemoryCard(id: String) -> ImageFlowMemoryCard {
        ImageFlowMemoryCard(
            id: id,
            state: .formal,
            coreKnowledge: "知识",
            recallCue: "问题",
            hiddenSemantic: "答案",
            explanation: "解释",
            rarity: .r,
            rarityReason: "原因",
            sourceTitle: nil,
            sourceUrl: nil,
            sourceStatus: .verified
        )
    }

    private func schedule(days: Int) -> ImageFlowReviewSchedule {
        schedule(at: Date(timeIntervalSince1970: 2_000_000_000), days: days)
    }

    private func schedule(at date: Date, days: Int) -> ImageFlowReviewSchedule {
        ImageFlowReviewSchedule(
            nextReviewAt: ISO8601DateFormatter().string(from: date),
            intervalDays: days,
            state: "scheduled",
            status: "scheduled"
        )
    }

    private func fixtureData(named name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: name, withExtension: "json")
                ?? Bundle(for: Self.self).url(forResource: name, withExtension: "json")
        )
        return try Data(contentsOf: url)
    }

    private func completedChapterPayload() throws -> [String: Any] {
        let data = try fixtureData(named: "completed-chapter")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func completedChapterFixture() throws -> ChapterFixture {
        let data = try fixtureData(named: "completed-chapter")
        return try JSONDecoder().decode(ChapterFixture.self, from: data)
    }

    private func completedChapterNotification() throws -> NotificationItem {
        let fixture = try completedChapterFixture()
        return try XCTUnwrap(fixture.notification)
    }

    private func activeReviewSessionFixture() throws -> ActiveReviewSessionFixture {
        let data = try fixtureData(named: "active-review-session")
        return try JSONDecoder().decode(ActiveReviewSessionFixture.self, from: data)
    }
}
