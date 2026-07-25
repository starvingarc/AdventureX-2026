import SwiftUI
import UserNotifications

private enum V2ReviewEntryMode: Equatable {
    case mainline
    case temporaryPractice

    var isTemporaryPractice: Bool {
        self == .temporaryPractice
    }
}

private enum V2NotificationRouteTarget {
    case success
    case failure
}

private struct V2PendingAIProcessingConsent: Identifiable {
    enum Payload {
        case sourceText(String)
        case screenshot(Data)
    }

    let id = UUID()
    let payload: Payload
}

struct V2RootView: View {
    @AppStorage("v2.hasSeenGenerationStartedEducation")
    private var hasSeenGenerationStartedEducation = false
    @AppStorage("v2.hasRequestedGenerationNotificationPermission")
    private var hasRequestedGenerationNotificationPermission = false
    @AppStorage("v2.hasAcceptedAIProcessingConsent")
    private var hasAcceptedAIProcessingConsent = false
    @AppStorage("v2.usesMockData")
    private var usesMockData = false
    @AppStorage("v2.activeLearningChapterID")
    private var activeLearningChapterID = ""
    @AppStorage("v2.completedReviewChapterIDs")
    private var completedReviewChapterIDsStorage = ""

    @State private var selectedTab: V2HomeTab = .learning
    @State private var routeStore = V2RouteStore()
    @State private var showsDeleteChapterConfirmation = false
    @State private var reviewEntryMode: V2ReviewEntryMode = .mainline
    @State private var questionInteractionStates: [String: V2QuestionInteractionState] = [:]
    @State private var backendChapters: [V2BackendChapter] = []
    @State private var backendChapter: V2BackendChapter?
    @State private var selectedBackendChapterID = ""
    @State private var backendReviewChapter: V2ReviewChapterData?
    @State private var v2ReviewSession: V2BackendReviewSession?
    @State private var awakeningResponse: V2AwakeningSessionResponse?
    @State private var isAwakeningLoading = false
    @State private var shouldAnimateAwakeningReveal = false
    @State private var backendNotifications: [NotificationItem] = []
    @State private var backendFavoriteQuestions: [FavoriteQuestionRecord] = []
    @State private var recommendedArticleFilters = V2DemoContentProvider.recommendedArticleFilters
    @State private var recommendedArticles = V2DemoContentProvider.recommendedArticles
    @State private var recommendedArticleChapters: [String: V2BackendChapter] = [:]
    @State private var loadingRecommendedArticleIDs: Set<String> = []
    @State private var importingRecommendedArticleIDs: Set<String> = []
    @State private var generationPollingTask: Task<Void, Never>?
    @State private var recommendedArticleSimulationTask: Task<Void, Never>?
    @State private var recommendedArticleGenerationSimulation: V2RecommendedArticleGenerationSimulation?
    @State private var recommendedArticleGenerationPendingChapters: [String: V2BackendChapter] = [:]
    @State private var hasLoadedInitialBackendChapter = false
    @State private var showsStartupSplash = true
    @State private var generationState = V2GenerationState()
    @State private var pendingAIProcessingConsent: V2PendingAIProcessingConsent?
    @State private var screenshotCards: [V2CapturedMemoryCard] = []
    @State private var screenshotAnalysisState = V2ScreenshotAnalysisState.idle
    @State private var screenshotAnalysisTask: Task<Void, Never>?
    @State private var screenshotDrawSession: V2ScreenshotDrawSession?
    @State private var account: AccountSnapshot?
    @State private var isAccountLoading = false
    @State private var accountMessage = ""

    private let apiClient: APIClient
    private let allowsMockDataToggle: Bool

    init(apiClient: APIClient = APIClient(), allowsMockDataToggle: Bool? = nil) {
        self.apiClient = apiClient
        #if DEBUG
        self.allowsMockDataToggle = allowsMockDataToggle ?? true
        #else
        self.allowsMockDataToggle = false
        #endif
    }

    private var usesFixtures: Bool {
        allowsMockDataToggle && usesMockData
    }

    private var reviewableScreenshotCards: [V2CapturedMemoryCard] {
        screenshotCards.filter {
            $0.card.state == .formal && $0.disposition == .createCard
        }
    }

    private var screenshotPoolCounts: [V2MemoryPool: Int] {
        let now = Date()
        return Dictionary(
            uniqueKeysWithValues: V2MemoryPool.allCases.map { pool in
                (pool, screenshotCards.filter { $0.isEligible(for: pool, now: now) }.count)
            }
        )
    }

    private var hasUnreadNotifications: Bool {
        backendNotifications.contains { !$0.dismissed && !$0.read }
    }

    var body: some View {
        ZStack(alignment: .top) {
            currentView
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            if showsStartupSplash {
                V2SplashView()
                    .transition(.opacity)
                    .zIndex(200)
            }

            if generationState.showsStartedDialog {
                Color.black
                    .opacity(0.2)
                    .ignoresSafeArea()
                    .transition(.opacity)
                    .zIndex(100)

                GeometryReader { geometry in
                    V2GenerationStartedDialog {
                        dismissGenerationStartedDialog()
                    }
                    .position(
                        x: geometry.size.width / 2,
                        y: geometry.size.height / 2
                    )
                }
                .ignoresSafeArea()
                .transition(.scale(scale: 0.98).combined(with: .opacity))
                .zIndex(101)
            }
        }
        .task(id: usesFixtures) {
            await runStartupSequence()
        }
        .alert("删除章节", isPresented: $showsDeleteChapterConfirmation) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                Task {
                    await deleteSelectedBackendChapter()
                }
            }
        } message: {
            Text("删除后，这个章节和它的生成任务都会被移除。")
        }
        .sheet(item: $pendingAIProcessingConsent) { pendingConsent in
            V2AIProcessingConsentSheet(
                onAgree: {
                    hasAcceptedAIProcessingConsent = true
                    pendingAIProcessingConsent = nil
                    switch pendingConsent.payload {
                    case .sourceText(let sourceText):
                        startV2GenerationAfterConsent(sourceText: sourceText)
                    case .screenshot(let imageData):
                        startScreenshotAnalysisAfterConsent(imageData: imageData)
                    }
                },
                onCancel: {
                    pendingAIProcessingConsent = nil
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $screenshotDrawSession) { session in
            V2ScreenshotAwakeningFlowView(
                session: session,
                onAssessment: { cardID, assessment, attemptID in
                    try await applyScreenshotAssessment(
                        cardID: cardID,
                        assessment: assessment,
                        attemptID: attemptID
                    )
                },
                onClose: {
                    screenshotDrawSession = nil
                }
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: .shiBeiDidRegisterForRemoteNotifications)) { notification in
            guard let token = notification.userInfo?["deviceToken"] as? String else { return }
            Task {
                await registerPushToken(token)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .shiBeiDidReceiveRemoteNotificationResponse)) { notification in
            Task {
                await openRemoteNotification(userInfo: notification.userInfo ?? [:])
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .shiBeiDidFailRemoteNotificationRegistration)) { notification in
            let message = notification.userInfo?["message"] as? String ?? "无法注册系统通知"
            generationState.errorText = message
        }
    }

    @ViewBuilder
    private var currentView: some View {
        if let route = routeStore.current {
            routeView(route)
        } else {
            tabView
        }
    }

    @ViewBuilder
    private var tabView: some View {
        switch selectedTab {
        case .learning:
            V2AwakeningHomeView(
                response: awakeningResponse,
                hasReviewableContent: !reviewableScreenshotCards.isEmpty || usesFixtures || backendChapters.contains(where: isHomeLearningCandidate),
                isLoading: isAwakeningLoading,
                selectedTab: $selectedTab,
                showsUnreadNotificationBadge: hasUnreadNotifications,
                onOpenNotifications: { pushRoute(.notifications) },
                onOpenProfile: { selectedTab = .notes },
                screenshotCardCount: reviewableScreenshotCards.count,
                screenshotPoolCounts: screenshotPoolCounts,
                onDrawScreenshot: { pool in
                    openScreenshotDraw(mode: .single, pool: pool)
                },
                onContinuousScreenshotDraw: { pool in
                    openScreenshotDraw(mode: .continuous, pool: pool)
                },
                onDraw: {
                    Task {
                        await openAwakeningCard()
                    }
                },
                onAddContent: { selectedTab = .upload }
            )
        case .materials:
            V2MaterialsView(
                selectedTab: $selectedTab,
                usesMockData: usesFixtures,
                backendChapters: backendChapters,
                completedChapterIDs: completedReviewChapterIDs,
                generatedChapterCount: generatedChapterCount,
                showsGeneratingChapterCard: generationState.showsChapterCard,
                generatingChapterTitle: backendChapter?.title ?? "正在生成新的章节",
                generatingChapterStatus: isActiveGenerationFailed ? .failed : .generating,
                generatingProgressText: generationDisplayText,
                generatedChapter: backendReviewChapter,
                screenshotCards: screenshotCards,
                openGeneratingChapter: openGeneratingChapter(id:),
                openChapter: openBackendChapter,
                deleteMemoryCard: { cardID in
                    try await deleteScreenshotMemoryCard(id: cardID)
                }
            )
        case .upload:
            V2UploadView(
                selectedTab: $selectedTab,
                isSubmittingGeneration: generationState.isSubmitting,
                preflightSource: { input in
                    try await apiClient.preflightSource(input: input, fetchMetadata: false)
                },
                preflightSourceWithMetadata: { input in
                    try await apiClient.preflightSource(input: input, fetchMetadata: true)
                },
                onGenerate: startV2Generation,
                screenshotAnalysisState: screenshotAnalysisState,
                onAnalyzeScreenshot: requestScreenshotAnalysis
            )
        case .discover:
            V2DiscoverView(
                selectedTab: $selectedTab,
                filters: recommendedArticleFilters,
                articles: recommendedArticles,
                openArticle: openRecommendedArticle
            )
        case .notes:
            V2ProfileTabView(
                selectedTab: $selectedTab,
                usesMockData: $usesMockData,
                allowsMockDataToggle: allowsMockDataToggle,
                reviewedCount: profileReviewedKnowledgeCountText,
                streakDays: profileStreakDaysText,
                account: account,
                isAccountLoading: isAccountLoading,
                accountMessage: accountMessage,
                onSignInWithApple: signInWithApple,
                onDeleteAccount: deleteAccount
            )
        }
    }

    @ViewBuilder
    private func routeView(_ route: V2AppRoute) -> some View {
        switch route {
        case .awakening:
            if let response = awakeningResponse,
               response.awakeningSession?.status == "completed" {
                V2AwakeningCompletionView(
                    response: response,
                    isLoading: isAwakeningLoading,
                    onNext: {
                        Task {
                            await drawNextAwakeningCard()
                        }
                    },
                    onExit: {
                        resetToHome(tab: .learning)
                    }
                )
                .id("awakening-complete-\(response.awakeningSession?.id ?? "")")
            } else if let response = awakeningResponse,
                      response.hasActiveCard {
                V2AwakeningFlowView(
                    response: response,
                    shouldAnimateReveal: shouldAnimateAwakeningReveal,
                    isSubmitting: isAwakeningLoading,
                    onBack: {
                        resetToHome(tab: .learning)
                    },
                    onAnswer: { optionID in
                        Task {
                            await answerAwakeningCard(optionID: optionID)
                        }
                    },
                    onComplete: {
                        Task {
                            await completeAwakeningCard()
                        }
                    },
                    onSource: openAwakeningSource
                )
                .id("awakening-card-\(response.awakeningSession?.id ?? "")")
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .notifications:
            V2NotificationView(
                usesMockData: usesFixtures,
                notifications: backendNotifications,
                onBack: goBack,
                onOpenSuccess: { notification in
                    openNotification(notification, target: .success)
                },
                onOpenFailure: { notification in
                    openNotification(notification, target: .failure)
                }
            )
        case .generationFailureDetail(let chapterID):
            V2GenerationFailureDetailView(
                title: "章节详情",
                failureReason: activeGenerationFailureReason(for: chapterID),
                onBack: goBack,
                onSource: openSource,
                onDelete: { showsDeleteChapterConfirmation = true }
            )
        case .profile:
            V2ProfileView(
                usesMockData: $usesMockData,
                allowsMockDataToggle: allowsMockDataToggle,
                reviewedCount: profileReviewedKnowledgeCountText,
                streakDays: profileStreakDaysText,
                account: account,
                isAccountLoading: isAccountLoading,
                accountMessage: accountMessage,
                onSignInWithApple: signInWithApple,
                onDeleteAccount: deleteAccount,
                onBack: goBack
            )
        case .generatingChapterDetail:
            if isActiveGenerationFailed {
                V2GenerationFailureDetailView(
                    title: "章节详情",
                    failureReason: activeGenerationFailureReason,
                    onBack: goBack,
                    onSource: openSource,
                    onDelete: { showsDeleteChapterConfirmation = true }
                )
                .id("generating-detail-failed")
            } else {
                V2GeneratingChapterDetailView(
                    progress: activeGenerationProgress,
                    statusText: generationDisplayText,
                    isCompleted: canOpenGeneratedChapterFromGenerationDetail,
                    onBack: goBack,
                    onSource: openSource,
                    onOpenChapter: { replaceRoute(chapterDetailRoute()) },
                    onDelete: { showsDeleteChapterConfirmation = true }
                )
                .id("generating-detail-running")
            }
        case .chapterDetail(let chapterID):
            if let chapter = reviewChapter(for: chapterID) {
                V2ChapterDetailView(
                    chapter: chapter,
                    primaryActionTitle: chapterDetailPrimaryActionTitle(chapterID: chapterID),
                    onBack: goBack,
                    onContinue: { continueFromChapterDetail(chapterID: chapterID) },
                    onStartUnitReview: { unitID in startReviewFromChapterDetailUnit(chapterID: chapterID, unitID: unitID) },
                    onSource: openSource,
                    onDelete: { showsDeleteChapterConfirmation = true }
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .sourceArticle(let chapterID):
            if let chapter = reviewChapter(for: chapterID) {
                V2SourceArticleView(chapter: chapter, question: sourceQuestion, onBack: goBack)
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .recommendedArticle(let articleID):
            if let article = recommendedArticle(id: articleID) {
                V2RecommendedArticleDetailView(
                    article: article,
                    chapter: recommendedArticleReviewChapter(id: articleID),
                    isLoading: loadingRecommendedArticleIDs.contains(articleID),
                    isImporting: importingRecommendedArticleIDs.contains(articleID),
                    onBack: goBack,
                    onLoad: { loadRecommendedArticleDetailIfNeeded(articleID: articleID) },
                    onGenerate: { importRecommendedArticle(id: articleID) }
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .chapterOverview(let chapterID):
            if let chapter = reviewChapter(for: chapterID) {
                V2ChapterOverviewView(
                    chapter: chapter,
                    onBack: goBack,
                    onContinue: continueAfterChapterOverview
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .unitOverview(let chapterID, let unitID):
            if let unit = activeUnit(chapterID: chapterID, id: unitID) {
                V2UnitOverviewView(
                    unit: unit,
                    unitTitle: unitDisplayTitle(id: unitID) ?? unit.title,
                    progress: progressIndex(unitID: unitID),
                    onBack: goBack,
                    onContinue: { continueAfterUnitOverview(unitID: unitID) }
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .question(let chapterID, let unitID, let questionID):
            if let question = activeQuestion(chapterID: chapterID, unitID: unitID, questionID: questionID) {
                let progress = progressIndex(unitID: unitID, questionID: questionID)
                let unitTitle = unitDisplayTitle(id: unitID) ?? question.title
                switch question.kind {
                case .multipleChoice, .trueFalse:
                    V2MultipleChoiceQuestionView(
                        question: question,
                        unitTitle: unitTitle,
                        progress: progress,
                        state: multipleChoiceStateBinding(unitID: unitID, questionID: questionID),
                        onBack: goBack,
                        onSource: openSource,
                        onFavoriteChange: { isSaved in
                            toggleBackendFavorite(questionID: questionID, isSaved: isSaved)
                        },
                        onAnswerReady: {
                            persistBackendAnswerProgress(unitID: unitID, questionID: questionID)
                        },
                        onContinue: { continueAfterQuestion(unitID: unitID, questionID: questionID) }
                    )
                case .matching:
                    V2MatchingQuestionView(
                        question: question,
                        unitTitle: unitTitle,
                        progress: progress,
                        state: matchingStateBinding(unitID: unitID, questionID: questionID),
                        onBack: goBack,
                        onSource: openSource,
                        onFavoriteChange: { isSaved in
                            toggleBackendFavorite(questionID: questionID, isSaved: isSaved)
                        },
                        onAnswerReady: {
                            persistBackendAnswerProgress(unitID: unitID, questionID: questionID)
                        },
                        onContinue: { continueAfterQuestion(unitID: unitID, questionID: questionID) }
                    )
                }
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .savedQuestion(let index):
            if let savedQuestion = V2ReviewFixture.savedQuestion(at: index),
               let question = V2ReviewFixture.question(for: savedQuestion) {
                let progress = (current: 0, total: 1)
                let unitTitle = V2ReviewFixture.unitDisplayTitle(id: savedQuestion.unitID) ?? question.title
                switch question.kind {
                case .multipleChoice, .trueFalse:
                    V2MultipleChoiceQuestionView(
                        question: question,
                        unitTitle: unitTitle,
                        progress: progress,
                        state: multipleChoiceStateBinding(key: savedQuestionStateKey(index: index)),
                        onBack: goBack,
                        onSource: openSource,
                        onContinue: { continueAfterSavedQuestion(index: index) }
                    )
                case .matching:
                    V2MatchingQuestionView(
                        question: question,
                        unitTitle: unitTitle,
                        progress: progress,
                        state: matchingStateBinding(key: savedQuestionStateKey(index: index)),
                        onBack: goBack,
                        onSource: openSource,
                        onContinue: { continueAfterSavedQuestion(index: index) }
                    )
                }
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .savedBackendQuestion(let savedQuestion):
            if let question = activeQuestion(chapterID: savedQuestion.chapterID, unitID: savedQuestion.unitID, questionID: savedQuestion.questionID) {
                let progress = (current: 0, total: 1)
                switch question.kind {
                case .multipleChoice, .trueFalse:
                    V2MultipleChoiceQuestionView(
                        question: question,
                        unitTitle: savedQuestion.unitTitle,
                        progress: progress,
                        state: multipleChoiceStateBinding(
                            key: backendSavedQuestionStateKey(questionID: savedQuestion.questionID),
                            favoriteOverride: isBackendQuestionFavorite(chapterID: savedQuestion.chapterID, questionID: savedQuestion.questionID)
                        ),
                        onBack: goBack,
                        onSource: openSource,
                        onFavoriteChange: { isSaved in
                            toggleBackendFavorite(chapterID: savedQuestion.chapterID, questionID: savedQuestion.questionID, isSaved: isSaved)
                        },
                        onContinue: { continueAfterBackendSavedQuestion(savedQuestion) }
                    )
                case .matching:
                    V2MatchingQuestionView(
                        question: question,
                        unitTitle: savedQuestion.unitTitle,
                        progress: progress,
                        state: matchingStateBinding(
                            key: backendSavedQuestionStateKey(questionID: savedQuestion.questionID),
                            favoriteOverride: isBackendQuestionFavorite(chapterID: savedQuestion.chapterID, questionID: savedQuestion.questionID)
                        ),
                        onBack: goBack,
                        onSource: openSource,
                        onFavoriteChange: { isSaved in
                            toggleBackendFavorite(chapterID: savedQuestion.chapterID, questionID: savedQuestion.questionID, isSaved: isSaved)
                        },
                        onContinue: { continueAfterBackendSavedQuestion(savedQuestion) }
                    )
                }
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .unitSummary(let chapterID, let unitID):
            if let unit = activeUnit(chapterID: chapterID, id: unitID) {
                V2UnitSummaryView(
                    unit: unit,
                    onBack: goBack,
                    onContinue: { continueAfterUnit(unitID: unitID) }
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        case .chapterSummary(let chapterID):
            if let chapter = reviewChapter(for: chapterID) {
                V2ChapterSummaryView(
                    chapter: chapter,
                    onBack: goBack,
                    onHome: completeChapterReviewAndReturnHome,
                    onDetail: { pushRoute(chapterDetailRoute(chapterID: chapterID)) }
                )
            } else {
                V2MissingRouteView(onBack: goBack)
            }
        }
    }

    private var sourceQuestion: V2ReviewQuestionData? {
        reviewQuestion(for: routeStore.previous)
    }

    private func reviewQuestion(for sourceRoute: V2AppRoute?) -> V2ReviewQuestionData? {
        guard let sourceRoute else {
            return nil
        }
        switch sourceRoute {
        case .awakening:
            return awakeningResponse?.card?.reviewQuestion(feedback: awakeningResponse?.feedback)
        case .question(let chapterID, let unitID, let questionID):
            return activeQuestion(chapterID: chapterID, unitID: unitID, questionID: questionID)
        case .savedQuestion(let index):
            guard let savedQuestion = V2ReviewFixture.savedQuestion(at: index) else {
                return nil
            }
            return V2ReviewFixture.question(for: savedQuestion)
        case .savedBackendQuestion(let savedQuestion):
            return activeQuestion(chapterID: savedQuestion.chapterID, unitID: savedQuestion.unitID, questionID: savedQuestion.questionID)
        default:
            return nil
        }
    }

    private func openNode(_ node: V2LearningPathNodeData) {
        guard selectActiveLearningChapter() else {
            return
        }

        guard node.action != .previewOnly else {
            return
        }

        selectedTab = .learning

        if node.action == .practice, node.kind == .unit {
            startTemporaryPractice(unitID: node.id)
            return
        }

        reviewEntryMode = .mainline
        if node.kind == .start {
            resetToRoute(chapterOverviewRoute(), tab: .learning)
        } else if usesBackendReviewChapter {
            Task {
                await openBackendLearningPathNode(node)
            }
        } else if node.id == v2ReviewSession?.currentCard.unitId,
                  let currentRoute = route(for: v2ReviewSession?.currentCard) {
            resetToRoute(currentRoute, tab: .learning)
        } else {
            resetToRoute(unitOverviewRoute(unitID: node.id), tab: .learning)
        }
    }

    @MainActor
    private func openBackendLearningPathNode(_ node: V2LearningPathNodeData) async {
        if node.state == .current || node.id == v2ReviewSession?.displayCard.unitId {
            await startOrResumeBackendReviewFromLearningPath(fallbackUnitID: node.id)
            return
        }

        if node.state == .completed {
            await replayBackendReviewFromUnit(unitID: node.id)
            return
        }

        resetToRoute(unitOverviewRoute(unitID: node.id), tab: .learning)
    }

    private func startTemporaryPractice(unitID: String) {
        guard usesBackendReviewChapter else {
            reviewEntryMode = .temporaryPractice
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(unitOverviewRoute(unitID: unitID))
            return
        }

        reviewEntryMode = .temporaryPractice
        selectedTab = .learning
        Task {
            await startBackendPracticeFromUnit(unitID: unitID)
        }
    }

    private func openActiveLearningChapterDetail() {
        guard selectActiveLearningChapter() else {
            return
        }
        pushRoute(chapterDetailRoute())
    }

    private func openSavedQuestion(index: Int) {
        guard usesFixtures else {
            return
        }
        selectedTab = .materials
        questionInteractionStates.removeValue(forKey: savedQuestionStateKey(index: index))
        routeStore.reset(to: .savedQuestion(index: index))
    }

    private func openBackendSavedQuestion(favoriteID: String) {
        guard let savedQuestion = backendSavedQuestionItem(id: favoriteID),
              selectBackendChapter(id: savedQuestion.chapterID) else {
            return
        }
        selectedTab = .materials
        questionInteractionStates.removeValue(forKey: backendSavedQuestionStateKey(questionID: savedQuestion.questionID))
        routeStore.reset(to: .savedBackendQuestion(item: savedQuestion))
    }

    private func openGeneratingChapter(id: String?) {
        let requestedChapterID = id
        guard let id, selectBackendChapter(id: id) else {
            pushRoute(.generatingChapterDetail(chapterID: requestedChapterID))
            return
        }
        selectedTab = .materials
        pushRoute(.generatingChapterDetail(chapterID: id))
    }

    private func openBackendChapter(id: String) {
        guard selectBackendChapter(id: id) else {
            pushRoute(chapterDetailRoute(chapterID: id))
            return
        }
        selectedTab = .materials
        if backendReviewChapter != nil {
            pushRoute(chapterDetailRoute(chapterID: id))
        } else {
            pushRoute(.generatingChapterDetail(chapterID: id))
        }
    }

    @discardableResult
    private func selectBackendChapter(id: String) -> Bool {
        guard let chapter = backendChapters.first(where: { $0.id == id }) else {
            return false
        }
        applyBackendChapter(chapter, activateForReview: true)
        return true
    }

    private func openRecommendedArticle(_ article: V2RecommendedArticleItem) {
        pushRoute(.recommendedArticle(articleID: article.id))
        loadRecommendedArticleDetailIfNeeded(articleID: article.id)
    }

    private func recommendedArticle(id: String) -> V2RecommendedArticleItem? {
        recommendedArticles.first { $0.id == id }
    }

    private func recommendedArticleReviewChapter(id: String) -> V2ReviewChapterData? {
        if usesFixtures {
            return V2ReviewFixture.chapter
        }
        return recommendedArticleChapters[id]?.toReviewChapterData()
    }

    private func loadRecommendedArticleDetailIfNeeded(articleID: String) {
        guard !usesFixtures,
              recommendedArticleChapters[articleID] == nil,
              !loadingRecommendedArticleIDs.contains(articleID) else {
            return
        }

        loadingRecommendedArticleIDs.insert(articleID)
        Task {
            do {
                let response = try await apiClient.fetchRecommendedArticleDetail(id: articleID)
                await MainActor.run {
                    mergeRecommendedArticle(response.article)
                    recommendedArticleChapters[articleID] = response.chapter
                    loadingRecommendedArticleIDs.remove(articleID)
                }
            } catch {
                await MainActor.run {
                    loadingRecommendedArticleIDs.remove(articleID)
                    generationState.errorText = error.localizedDescription
                }
            }
        }
    }

    private func importRecommendedArticle(id articleID: String) {
        guard !usesFixtures else {
            startRecommendedArticleGenerationSimulation(simulationID: "fixture-\(articleID)")
            return
        }
        guard !importingRecommendedArticleIDs.contains(articleID) else {
            return
        }

        importingRecommendedArticleIDs.insert(articleID)
        let simulationID = "recommended-\(articleID)-\(Date().timeIntervalSince1970)"
        startRecommendedArticleGenerationSimulation(simulationID: simulationID)
        Task {
            do {
                let response = try await apiClient.importRecommendedArticle(id: articleID)
                await MainActor.run {
                    importingRecommendedArticleIDs.remove(articleID)
                    mergeRecommendedArticle(response.article)
                    recommendedArticleChapters[articleID] = response.chapter
                    upsertBackendChapter(response.chapter)
                    recommendedArticleGenerationPendingChapters[simulationID] = response.chapter
                    bindRecommendedArticleGenerationSimulation(simulationID: simulationID, chapterID: response.chapter.id)
                }
            } catch {
                await MainActor.run {
                    importingRecommendedArticleIDs.remove(articleID)
                    recommendedArticleGenerationPendingChapters.removeValue(forKey: simulationID)
                    if recommendedArticleGenerationSimulation?.id == simulationID {
                        recommendedArticleGenerationSimulation = nil
                        recommendedArticleSimulationTask?.cancel()
                        recommendedArticleSimulationTask = nil
                    }
                    generationState.errorText = error.localizedDescription
                }
            }
        }
    }

    private func mergeRecommendedArticle(_ article: V2RecommendedArticleItem) {
        if let index = recommendedArticles.firstIndex(where: { $0.id == article.id }) {
            recommendedArticles[index] = article
        } else {
            recommendedArticles.insert(article, at: 0)
        }
    }

    private func openFirstUnit() {
        replaceRoute(unitOverviewRoute(unitID: activeFirstUnitID))
    }

    private func openFirstQuestion(in unitID: String) {
        guard let questionID = firstQuestionID(in: unitID) else {
            replaceRoute(unitSummaryRoute(unitID: unitID))
            return
        }
        replaceRoute(questionRoute(unitID: unitID, questionID: questionID))
    }

    private func continueAfterChapterOverview() {
        reviewEntryMode = .mainline
        guard usesBackendReviewChapter else {
            openFirstUnit()
            return
        }

        Task {
            await advanceBackendReviewAndRoute(fallback: unitOverviewRoute(unitID: activeFirstUnitID))
        }
    }

    private func startReviewFromChapterDetailUnit(chapterID: String, unitID: String) {
        if !usesFixtures {
            _ = selectBackendChapter(id: chapterID)
        }
        startTemporaryPractice(unitID: unitID)
    }

    @MainActor
    private func startBackendPracticeFromUnit(unitID: String) async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                resetToRoute(unitOverviewRoute(unitID: unitID), tab: .learning)
                return
            }

            let response = try await apiClient.startV2PracticeSession(
                sessionId: session.id,
                unitId: unitID
            )
            applyV2ReviewSessionResponse(response)
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(route(for: response.reviewSession?.displayCard) ?? unitOverviewRoute(unitID: unitID))
        } catch {
            generationState.errorText = error.localizedDescription
            resetToRoute(unitOverviewRoute(unitID: unitID), tab: .learning)
        }
    }

    @MainActor
    private func focusBackendReviewUnitAndRoute(unitID: String) async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                resetToRoute(unitOverviewRoute(unitID: unitID), tab: .learning)
                return
            }

            let response = try await apiClient.focusV2ReviewUnit(
                sessionId: session.id,
                unitId: unitID
            )
            activeLearningChapterID = response.chapter.id
            applyV2ReviewSessionResponse(response)
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(route(for: response.reviewSession?.currentCard) ?? unitOverviewRoute(unitID: unitID))
        } catch {
            generationState.errorText = error.localizedDescription
            resetToRoute(unitOverviewRoute(unitID: unitID), tab: .learning)
        }
    }

    private func continueAfterUnitOverview(unitID: String) {
        if usesBackendReviewChapter, reviewEntryMode.isTemporaryPractice {
            let fallback: V2AppRoute = firstQuestionID(in: unitID)
                .map { questionRoute(unitID: unitID, questionID: $0) }
                ?? unitSummaryRoute(unitID: unitID)
            Task {
                await advanceBackendPracticeAndRoute(fallback: fallback)
            }
            return
        }

        guard usesBackendReviewChapter, !reviewEntryMode.isTemporaryPractice else {
            openFirstQuestion(in: unitID)
            return
        }

        let fallback: V2AppRoute = firstQuestionID(in: unitID)
            .map { questionRoute(unitID: unitID, questionID: $0) }
            ?? unitSummaryRoute(unitID: unitID)

        Task {
            await advanceBackendReviewAndRoute(fallback: fallback)
        }
    }

    private func continueAfterQuestion(unitID: String, questionID: String) {
        if usesBackendReviewChapter, reviewEntryMode.isTemporaryPractice {
            Task {
                await persistBackendPracticeAnswerAndContinue(unitID: unitID, questionID: questionID)
            }
            return
        }

        guard usesBackendReviewChapter, !reviewEntryMode.isTemporaryPractice else {
            advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
            return
        }

        Task {
            await persistBackendAnswerAndContinue(unitID: unitID, questionID: questionID)
        }
    }

    private func advanceLocalAfterQuestion(unitID: String, questionID: String) {
        questionInteractionStates.removeValue(forKey: questionStateKey(unitID: unitID, questionID: questionID))

        if let nextQuestion = nextQuestion(after: questionID, in: unitID) {
            replaceRoute(questionRoute(unitID: unitID, questionID: nextQuestion.id))
        } else {
            replaceRoute(unitSummaryRoute(unitID: unitID))
        }
    }

    private func questionStateKey(unitID: String, questionID: String) -> String {
        if reviewEntryMode.isTemporaryPractice, let practice = v2ReviewSession?.practice {
            return "review-practice::\(v2ReviewSession?.id ?? "session")::\(practice.id)::\(unitID)::\(questionID)"
        }
        if reviewEntryMode.isTemporaryPractice {
            return "review-practice::local::\(unitID)::\(questionID)"
        }
        if let practice = v2ReviewSession?.practice {
            return "review-practice::\(v2ReviewSession?.id ?? "session")::\(practice.id)::\(unitID)::\(questionID)"
        }
        return "review::\(v2ReviewSession?.id ?? "local")::\(unitID)::\(questionID)"
    }

    private func savedQuestionStateKey(index: Int) -> String {
        "notes::saved-question::\(index)"
    }

    private func backendSavedQuestionStateKey(questionID: String) -> String {
        "notes::backend-saved-question::\(questionID)"
    }

    private func continueAfterSavedQuestion(index: Int) {
        questionInteractionStates.removeValue(forKey: savedQuestionStateKey(index: index))

        let nextIndex = index + 1
        if V2ReviewFixture.savedQuestions.indices.contains(nextIndex) {
            questionInteractionStates.removeValue(forKey: savedQuestionStateKey(index: nextIndex))
            replaceRoute(.savedQuestion(index: nextIndex))
        } else {
            resetToHome(tab: .materials)
        }
    }

    private func continueAfterBackendSavedQuestion(_ currentQuestion: V2SavedQuestionDisplayItem) {
        questionInteractionStates.removeValue(forKey: backendSavedQuestionStateKey(questionID: currentQuestion.questionID))

        let savedQuestions = backendSavedQuestionItems
        guard let currentIndex = savedQuestions.firstIndex(where: { $0.questionID == currentQuestion.questionID }) else {
            resetToHome(tab: .materials)
            return
        }

        let nextIndex = currentIndex + 1
        guard savedQuestions.indices.contains(nextIndex) else {
            resetToHome(tab: .materials)
            return
        }

        let nextQuestion = savedQuestions[nextIndex]
        guard selectBackendChapter(id: nextQuestion.chapterID) else {
            resetToHome(tab: .materials)
            return
        }
        questionInteractionStates.removeValue(forKey: backendSavedQuestionStateKey(questionID: nextQuestion.questionID))
        replaceRoute(.savedBackendQuestion(item: nextQuestion))
    }

    private func questionInteractionBinding(
        unitID: String,
        questionID: String
    ) -> Binding<V2QuestionInteractionState> {
        questionInteractionBinding(key: questionStateKey(unitID: unitID, questionID: questionID))
    }

    private func questionInteractionBinding(key: String) -> Binding<V2QuestionInteractionState> {
        return Binding(
            get: {
                questionInteractionStates[key, default: V2QuestionInteractionState()]
            },
            set: { newValue in
                questionInteractionStates[key] = newValue
            }
        )
    }

    private func multipleChoiceStateBinding(
        key: String,
        favoriteOverride: Bool? = nil
    ) -> Binding<V2MultipleChoiceInteractionState> {
        let interaction = questionInteractionBinding(key: key)
        return Binding(
            get: {
                var state = interaction.wrappedValue.multipleChoice
                if let favoriteOverride {
                    state.isFavoriteSaved = favoriteOverride
                }
                return state
            },
            set: { newValue in
                var rootState = interaction.wrappedValue
                rootState.multipleChoice = newValue
                interaction.wrappedValue = rootState
            }
        )
    }

    private func multipleChoiceStateBinding(
        unitID: String,
        questionID: String
    ) -> Binding<V2MultipleChoiceInteractionState> {
        let favoriteOverride = usesFixtures ? nil : isBackendQuestionFavorite(questionID: questionID)
        return multipleChoiceStateBinding(
            key: questionStateKey(unitID: unitID, questionID: questionID),
            favoriteOverride: favoriteOverride
        )
    }

    private func matchingStateBinding(
        key: String,
        favoriteOverride: Bool? = nil
    ) -> Binding<V2MatchingInteractionState> {
        let interaction = questionInteractionBinding(key: key)
        return Binding(
            get: {
                var state = interaction.wrappedValue.matching
                if let favoriteOverride {
                    state.isFavoriteSaved = favoriteOverride
                }
                return state
            },
            set: { newValue in
                var rootState = interaction.wrappedValue
                rootState.matching = newValue
                interaction.wrappedValue = rootState
            }
        )
    }

    private func matchingStateBinding(
        unitID: String,
        questionID: String
    ) -> Binding<V2MatchingInteractionState> {
        let favoriteOverride = usesFixtures ? nil : isBackendQuestionFavorite(questionID: questionID)
        return matchingStateBinding(
            key: questionStateKey(unitID: unitID, questionID: questionID),
            favoriteOverride: favoriteOverride
        )
    }

    private func continueAfterUnit(unitID: String) {
        if reviewEntryMode.isTemporaryPractice {
            if usesBackendReviewChapter {
                Task {
                    await finishBackendPracticeAndReturnHome()
                }
                return
            }
            reviewEntryMode = .mainline
            resetToHome(tab: .learning)
            return
        }

        guard usesBackendReviewChapter else {
            advanceLocalAfterUnit(unitID: unitID)
            return
        }

        Task {
            await advanceBackendReviewAndRoute(fallback: routeAfterUnitSummary(unitID: unitID))
        }
    }

    private func advanceLocalAfterUnit(unitID: String) {
        if let nextUnit = nextUnit(after: unitID) {
            replaceRoute(unitOverviewRoute(unitID: nextUnit.id))
        } else {
            replaceRoute(chapterSummaryRoute())
        }
    }

    private func routeAfterUnitSummary(unitID: String) -> V2AppRoute {
        if let nextUnit = nextUnit(after: unitID) {
            return unitOverviewRoute(unitID: nextUnit.id)
        }
        return chapterSummaryRoute()
    }

    private func completeChapterReviewAndReturnHome() {
        guard usesBackendReviewChapter else {
            resetToHome(tab: .learning)
            return
        }

        Task {
            await advanceBackendReviewAndRoute(fallback: chapterSummaryRoute(), resetHomeOnCompletion: true)
        }
    }

    private func continueFromChapterDetail(chapterID: String? = nil) {
        reviewEntryMode = .mainline
        let resolvedChapterID = resolvedChapterID(chapterID)
        if !usesFixtures,
           backendChapter(for: resolvedChapterID)?.status == "completed" {
            Task {
                await startOrResumeBackendReviewFromChapterDetail(chapterID: resolvedChapterID)
            }
            return
        }

        let currentNodeID = V2HomeFixture.home.currentNodeID
        selectedTab = .learning
        routeStore.clearStack()
        if activeUnit(id: currentNodeID) != nil {
            replaceRoute(unitOverviewRoute(unitID: currentNodeID))
        } else {
            openFirstUnit()
        }
    }

    private var activeChapter: V2ReviewChapterData? {
        reviewChapter(for: selectedBackendChapterID)
            ?? backendReviewChapter
            ?? (usesFixtures ? V2ReviewFixture.chapter : nil)
    }

    private func resolvedChapterID(_ preferredChapterID: String? = nil) -> String {
        if let preferredChapterID, !preferredChapterID.isEmpty {
            return preferredChapterID
        }
        if !selectedBackendChapterID.isEmpty {
            return selectedBackendChapterID
        }
        if let activeID = activeReviewBackendChapter?.id, !activeID.isEmpty {
            return activeID
        }
        if let learningID = activeLearningBackendChapter?.id, !learningID.isEmpty {
            return learningID
        }
        if usesFixtures {
            return "v2-fixture"
        }
        return ""
    }

    private func backendChapter(for chapterID: String) -> V2BackendChapter? {
        guard !chapterID.isEmpty else {
            return nil
        }
        return backendChapters.first { $0.id == chapterID }
            ?? (backendChapter?.id == chapterID ? backendChapter : nil)
    }

    private func reviewChapter(for chapterID: String) -> V2ReviewChapterData? {
        if usesFixtures, chapterID == "v2-fixture" {
            return V2ReviewFixture.chapter
        }
        if let chapter = backendChapter(for: chapterID)?.toReviewChapterData() {
            return chapter
        }
        if selectedBackendChapterID == chapterID {
            return backendReviewChapter
        }
        return nil
    }

    private var isShowingGenerationDetail: Bool {
        if case .generatingChapterDetail(_) = routeStore.current {
            return true
        }
        return false
    }

    private func chapterDetailPrimaryActionTitle(chapterID: String) -> String {
        guard !usesFixtures,
              backendChapter(for: chapterID)?.status == "completed",
              let session = reviewSession(for: chapterID),
              session.completedAt == nil else {
            return "开始学习"
        }
        return "继续学习"
    }

    private var activeHomeData: V2HomeData {
        if usesFixtures {
            return V2HomeFixture.home
        }
        guard let activeLearningReviewChapter,
              let activeLearningBackendChapter else {
            return V2HomeFixture.empty
        }
        return V2HomeData(
            chapter: activeLearningReviewChapter,
            reviewSession: activeLearningBackendChapter.v2ReviewSession
        )
    }

    private var activeLearningBackendChapter: V2BackendChapter? {
        if let chapter = backendChapters.first(where: { $0.id == activeLearningChapterID }),
           isHomeLearningCandidate(chapter) {
            return chapter
        }

        return backendChapters.first(where: isMainlineInProgressCandidate)
            ?? backendChapters.first(where: isHomeLearningCandidate)
    }

    private func isHomeLearningCandidate(_ chapter: V2BackendChapter) -> Bool {
        guard chapter.status == "completed",
              chapter.toReviewChapterData() != nil else {
            return false
        }
        return true
    }

    private func isMainlineInProgressCandidate(_ chapter: V2BackendChapter) -> Bool {
        guard isHomeLearningCandidate(chapter) else {
            return false
        }
        return chapter.v2ReviewSession?.completedAt == nil
    }

    private func isInProgressLearningCandidate(_ chapter: V2BackendChapter) -> Bool {
        isHomeLearningCandidate(chapter) && chapter.v2ReviewSession != nil
    }

    private var activeLearningReviewChapter: V2ReviewChapterData? {
        activeLearningBackendChapter?.toReviewChapterData()
    }

    @discardableResult
    private func selectActiveLearningChapter() -> Bool {
        guard let chapter = activeLearningBackendChapter else {
            return false
        }
        applyBackendChapter(chapter, activateForReview: true)
        return true
    }

    private var generatedChapterCount: Int {
        let completedBackendCount = backendChapters.filter { $0.status == "completed" }.count
        if usesFixtures {
            return max(completedBackendCount, 1)
        }
        return completedBackendCount
    }

    private var profileReviewedKnowledgeCountText: String {
        if usesFixtures {
            return "35"
        }
        return String(profileReviewedKnowledgeCount)
    }

    private var profileStreakDaysText: String {
        if usesFixtures {
            return "7"
        }
        return String(profileLearningStreakDays)
    }

    private var profileReviewedKnowledgeCount: Int {
        backendChapters.reduce(0) { total, chapter in
            total + reviewedKnowledgeCount(in: chapter)
        }
    }

    private func reviewedKnowledgeCount(in chapter: V2BackendChapter) -> Int {
        let units = chapter.units ?? []
        guard !units.isEmpty, let session = chapter.v2ReviewSession else {
            return 0
        }

        if session.completedAt != nil {
            return units.count
        }

        let unitIds = Set(units.map(\.id))
        let reviewedUnitIds = Set(
            session.completedStepIds.compactMap { stepId -> String? in
                guard let separatorIndex = stepId.firstIndex(of: ":") else {
                    return nil
                }
                let unitId = String(stepId[..<separatorIndex])
                return unitIds.contains(unitId) ? unitId : nil
            }
        )
        return reviewedUnitIds.count
    }

    private var profileLearningStreakDays: Int {
        let calendar = Calendar.current
        let activeDays = Set(
            backendChapters.compactMap { chapter -> Date? in
                guard let session = chapter.v2ReviewSession else {
                    return nil
                }
                return (session.completedAt ?? session.updatedAt).v2ISO8601Date
                    ?? session.createdAt.v2ISO8601Date
            }
            .map { calendar.startOfDay(for: $0) }
        )

        guard !activeDays.isEmpty else {
            return 0
        }

        var streak = 0
        var day = calendar.startOfDay(for: Date())
        while activeDays.contains(day) {
            streak += 1
            guard let previousDay = calendar.date(byAdding: .day, value: -1, to: day) else {
                break
            }
            day = previousDay
        }

        return streak
    }

    private var activeFirstUnitID: String {
        activeChapter?.units.first?.id ?? ""
    }

    private var selectedBackendChapter: V2BackendChapter? {
        guard !selectedBackendChapterID.isEmpty else {
            return nil
        }
        return backendChapters.first { $0.id == selectedBackendChapterID }
    }

    private var activeReviewBackendChapter: V2BackendChapter? {
        selectedBackendChapter ?? backendChapter
    }

    private var activeReviewSession: V2BackendReviewSession? {
        v2ReviewSession ?? selectedBackendChapter?.v2ReviewSession
    }

    private func reviewSession(for chapterID: String) -> V2BackendReviewSession? {
        if v2ReviewSession?.chapterId == chapterID {
            return v2ReviewSession
        }
        return backendChapter(for: chapterID)?.v2ReviewSession
    }

    private var deletionTargetBackendChapter: V2BackendChapter? {
        switch routeStore.current {
        case .generationFailureDetail(let chapterID):
            return backendChapter(for: chapterID) ?? activeReviewBackendChapter
        case .generatingChapterDetail(let chapterID):
            if let chapterID, let chapter = backendChapter(for: chapterID) {
                return chapter
            }
            return backendChapter ?? activeReviewBackendChapter
        default:
            return activeReviewBackendChapter
        }
    }

    private var backendSavedQuestionItems: [V2SavedQuestionDisplayItem] {
        backendFavoriteQuestions.compactMap { record in
            backendSavedQuestionItem(record: record)
        }
    }

    private var generationDisplayText: String {
        if let simulation = recommendedArticleGenerationSimulation {
            return simulation.statusText
        }
        if !generationState.errorText.isEmpty {
            return generationState.errorText
        }
        return backendChapter?.progress?.displayTextOrFallback ?? "正在提交生成任务..."
    }

    private var activeGenerationProgress: Double {
        if let simulation = recommendedArticleGenerationSimulation {
            return simulation.progress
        }
        return backendChapter?.progress?.progress ?? 0
    }

    private var canOpenGeneratedChapterFromGenerationDetail: Bool {
        guard recommendedArticleGenerationSimulation == nil,
              let chapter = backendChapter,
              isCompletedGenerationChapter(chapter) else {
            return false
        }
        return chapter.toReviewChapterData() != nil
    }

    private var isActiveGenerationFailed: Bool {
        if recommendedArticleGenerationSimulation != nil {
            return false
        }
        guard let chapter = backendChapter else {
            return false
        }
        return isFailedGenerationStatus(chapter.status) || chapter.progress?.status == "failed"
    }

    private var activeGenerationFailureReason: String {
        let reason = backendChapter?.failureReason
            ?? backendChapter?.progress?.failureMessage
            ?? generationState.errorText
        guard !reason.isEmpty else {
            return "生成失败，请删除后重新上传。"
        }
        return userFacingGenerationFailureReason(reason)
    }

    private func activeGenerationFailureReason(for chapterID: String) -> String {
        let chapter = backendChapter(for: chapterID)
        let reason = chapter?.failureReason
            ?? chapter?.progress?.failureMessage
            ?? (backendChapter?.id == chapterID ? generationState.errorText : "")
        guard !reason.isEmpty else {
            return "生成失败，请删除后重新上传。"
        }
        return userFacingGenerationFailureReason(reason)
    }

    private func userFacingGenerationFailureReason(_ reason: String) -> String {
        let lowercasedReason = reason.lowercased()
        let internalMarkers = [
            "payload.",
            "sourceanchor",
            "blockids",
            "schema",
            "json",
            "contract",
            "playwright",
            "api key",
            "openai_api_key",
            "deepseek_api_key"
        ]
        if internalMarkers.contains(where: { lowercasedReason.contains($0) }) {
            return "生成时遇到结构处理异常。可以删除章节后重新生成。"
        }
        if lowercasedReason.contains("timeout") || reason.contains("超时") {
            return "生成服务响应超时，请稍后重试。"
        }
        if reason.contains("HTTP 403") || reason.contains("HTTP 401") {
            return "这个链接暂时无法公开访问。可以换一个链接，或稍后重试。"
        }
        if reason.contains("HTTP 404") {
            return "没有找到这篇文章。可以检查链接是否正确。"
        }
        return reason
    }

    private var canOpenActiveSource: Bool {
        let chapter = routeChapterID(routeStore.current).flatMap(reviewChapter(for:)) ?? activeChapter
        guard let chapter else {
            return false
        }
        return !chapter.sourceBody.isEmpty
    }

    private var usesBackendReviewChapter: Bool {
        !usesFixtures && activeChapter != nil && activeReviewBackendChapter?.status == "completed"
    }

    private func activeUnit(id: String) -> V2ReviewUnitData? {
        activeChapter?.units.first { $0.id == id }
    }

    private func activeUnit(chapterID: String, id: String) -> V2ReviewUnitData? {
        reviewChapter(for: chapterID)?.units.first { $0.id == id }
    }

    private func activeQuestion(unitID: String, questionID: String) -> V2ReviewQuestionData? {
        activeUnit(id: unitID)?.questions.first { $0.id == questionID }
    }

    private func activeQuestion(chapterID: String, unitID: String, questionID: String) -> V2ReviewQuestionData? {
        activeUnit(chapterID: chapterID, id: unitID)?.questions.first { $0.id == questionID }
    }

    private func unitDisplayTitle(id: String) -> String? {
        guard let activeChapter,
              let index = activeChapter.units.firstIndex(where: { $0.id == id }) else {
            return nil
        }
        return "单元\(index + 1)"
    }

    private func firstQuestionID(in unitID: String) -> String? {
        activeUnit(id: unitID)?.questions.first?.id
    }

    private func nextQuestion(after questionID: String, in unitID: String) -> V2ReviewQuestionData? {
        guard let questions = activeUnit(id: unitID)?.questions,
              let index = questions.firstIndex(where: { $0.id == questionID }),
              questions.indices.contains(index + 1) else {
            return nil
        }
        return questions[index + 1]
    }

    private func nextUnit(after unitID: String) -> V2ReviewUnitData? {
        if backendReviewChapter == nil,
           V2ReviewFixture.completesChapterAfterCurrentFixtureUnit,
           unitID == "unit-1" {
            return nil
        }

        guard let activeChapter,
              let index = activeChapter.units.firstIndex(where: { $0.id == unitID }),
              activeChapter.units.indices.contains(index + 1) else {
            return nil
        }
        return activeChapter.units[index + 1]
    }

    private func progressIndex(unitID: String, questionID: String? = nil) -> (current: Int, total: Int) {
        guard let activeChapter else {
            return (1, 1)
        }
        let total = activeChapter.units.reduce(0) { $0 + $1.questions.count }
        var current = 1

        for unit in activeChapter.units {
            if unit.id == unitID {
                if let questionID,
                   let questionIndex = unit.questions.firstIndex(where: { $0.id == questionID }) {
                    current += questionIndex
                }
                return (current, max(total, 1))
            }
            current += unit.questions.count
        }

        return (current, max(total, 1))
    }

    private func startV2Generation(sourceText: String) {
        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        guard hasAcceptedAIProcessingConsent else {
            pendingAIProcessingConsent = V2PendingAIProcessingConsent(payload: .sourceText(trimmed))
            return
        }

        startV2GenerationAfterConsent(sourceText: trimmed)
    }

    private func requestScreenshotAnalysis(_ imageData: Data) {
        guard !imageData.isEmpty else {
            screenshotAnalysisState = .failed("没有读取到图片，请重新选择。")
            return
        }
        guard hasAcceptedAIProcessingConsent else {
            pendingAIProcessingConsent = V2PendingAIProcessingConsent(payload: .screenshot(imageData))
            return
        }
        startScreenshotAnalysisAfterConsent(imageData: imageData)
    }

    private func startScreenshotAnalysisAfterConsent(imageData: Data) {
        screenshotAnalysisTask?.cancel()
        screenshotAnalysisState = .preparing
        screenshotAnalysisTask = Task {
            do {
                let preparedData = try V2ScreenshotImageProcessor.prepare(imageData)
                try Task.checkCancellation()
                screenshotAnalysisState = .analyzing
                let response = try await apiClient.analyzeScreenshot(imageData: preparedData)
                try Task.checkCancellation()
                let captureAnalysis = response.captureAnalysis
                let disposition = captureAnalysis?.disposition
                    ?? (response.memoryCard?.state == .formal ? .createCard : .archiveOnly)
                guard var memoryCard = captureAnalysis?.memoryCard ?? response.memoryCard else {
                    throw V2ScreenshotAnalysisError.missingMemoryCard
                }
                if let captureAnalysis {
                    memoryCard.sourceStatus = captureAnalysis.sourceStatus
                }
                let captured = V2CapturedMemoryCard(
                    card: memoryCard,
                    screenshotData: preparedData,
                    schedule: disposition == .createCard
                        ? (captureAnalysis?.schedule ?? response.schedule)
                        : nil,
                    disposition: disposition
                )
                if let index = screenshotCards.firstIndex(where: { $0.id == captured.id }) {
                    screenshotCards[index] = captured
                } else {
                    screenshotCards.append(captured)
                }
                guard disposition == .createCard, memoryCard.state == .formal else {
                    screenshotAnalysisState = .generated(
                        disposition == .needsConfirmation
                            ? "证据不足，已保存为待确认碎片。"
                            : "这条内容已保存为碎片，不进入复习。"
                    )
                    selectedTab = .materials
                    return
                }
                screenshotAnalysisState = .generated(
                    "记忆卡已生成，正在打开。"
                )
                selectedTab = .learning
                screenshotDrawSession = V2ScreenshotDrawSession.make(
                    mode: .single,
                    from: [captured],
                    pool: .due
                )
            } catch is CancellationError {
                return
            } catch {
                screenshotAnalysisState = .failed(error.localizedDescription)
            }
        }
    }

    private func openScreenshotDraw(mode: V2ScreenshotDrawMode, pool: V2MemoryPool) {
        guard let session = V2ScreenshotDrawSession.make(
            mode: mode,
            from: reviewableScreenshotCards,
            pool: pool
        ) else {
            return
        }
        screenshotDrawSession = session
    }

    @MainActor
    private func applyScreenshotAssessment(
        cardID: String,
        assessment: V2MemoryAssessment,
        attemptID: String
    ) async throws -> CaptureMemoryCardAssessmentResponse {
        let response = try await apiClient.assessCaptureMemoryCard(
            id: cardID,
            assessment: assessment.rawValue,
            attemptId: attemptID
        )
        let canonicalAssessment = response.canonicalAssessment(fallback: assessment)
        if let index = screenshotCards.firstIndex(where: { $0.id == cardID }) {
            screenshotCards[index].apply(
                canonicalAssessment,
                schedule: response.schedule,
                serverMastery: response.mastery
            )
        }
        return response
    }

    @MainActor
    private func deleteScreenshotMemoryCard(id: String) async throws {
        let response = try await apiClient.deleteCaptureMemoryCard(id: id)
        guard response.deleted, response.cardId == id else {
            throw APIClientError.invalidResponse
        }
        screenshotCards.removeAll { $0.id == id }
        if screenshotDrawSession?.cards.contains(where: { $0.id == id }) == true {
            screenshotDrawSession = nil
        }
    }

    private func startV2GenerationAfterConsent(sourceText: String) {
        let trimmed = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }

        selectedTab = .materials
        routeStore.reset(to: .generatingChapterDetail(chapterID: nil))
        backendChapter = nil
        backendReviewChapter = nil
        v2ReviewSession = nil
        questionInteractionStates.removeAll()
        let originalSourceURLString = URL(string: trimmed)?.scheme?.hasPrefix("http") == true ? trimmed : ""
        generationState.prepareForSubmission(originalSourceURLString: originalSourceURLString)
        generationPollingTask?.cancel()
        let clientRequestId = "ios-v2-\(UUID().uuidString)"

        if hasSeenGenerationStartedEducation {
            generationState.showsChapterCard = true
        } else {
            withAnimation(.easeOut(duration: 0.18)) {
                generationState.showsStartedDialog = true
            }
        }

        Task {
            do {
                let response = try await apiClient.createV2Chapter(
                    sourceText: trimmed,
                    clientRequestId: clientRequestId
                )
                await MainActor.run {
                    generationState.finishSubmitting()
                    applyBackendChapter(response.chapter)
                }
                startGenerationPolling(chapterID: response.chapter.id)
            } catch {
                await MainActor.run {
                    generationState.markError(error.localizedDescription)
                }
            }
        }
    }

    private func startGenerationPolling(chapterID: String) {
        generationPollingTask?.cancel()
        generationPollingTask = Task {
            let pollingIntervals: [UInt64] = Array(repeating: 1_250_000_000, count: 240)
                + Array(repeating: 5_000_000_000, count: 120)
            for interval in pollingIntervals {
                if Task.isCancelled {
                    return
                }

                do {
                    let chapter = try await apiClient.fetchV2Chapter(id: chapterID)
                    await MainActor.run {
                        let shouldActivateGeneratedChapter = isShowingGenerationDetail
                            && isCompletedGenerationChapter(chapter)
                            && chapter.toReviewChapterData() != nil
                        applyBackendChapter(chapter, activateForReview: shouldActivateGeneratedChapter)
                    }
                    if chapter.progress?.isFinished == true || isTerminalGenerationStatus(chapter.status) {
                        await MainActor.run {
                            generationPollingTask = nil
                            routeCompletedGenerationIfNeeded(chapter)
                        }
                        await refreshBackendNotifications()
                        return
                    }
                } catch {
                    await MainActor.run {
                        generationState.errorText = error.localizedDescription
                    }
                }

                try? await Task.sleep(nanoseconds: interval)
            }
            await MainActor.run {
                generationPollingTask = nil
                generationState.showsChapterCard = true
                generationState.errorText = "视频还在处理中，可以稍后回到材料页查看结果。"
            }
        }
    }

    @MainActor
    private func runStartupSequence() async {
        async let minimumDisplayDuration: Void = sleepStartupSplashMinimumDuration()
        await refreshAccount()
        await loadLatestBackendChapterIfNeeded()
        await refreshCaptureMemoryCards()
        await refreshAwakeningSession()
        await minimumDisplayDuration

        guard showsStartupSplash else {
            return
        }

        withAnimation(.easeOut(duration: 0.25)) {
            showsStartupSplash = false
        }
    }

    private func sleepStartupSplashMinimumDuration() async {
        try? await Task.sleep(nanoseconds: 650_000_000)
    }

    @MainActor
    private func refreshAccount() async {
        guard !usesFixtures else {
            account = nil
            accountMessage = ""
            return
        }
        do {
            let response = try await apiClient.fetchAccount()
            account = response.account
        } catch {
            accountMessage = ""
        }
    }

    @MainActor
    private func signInWithApple(identityTokenData: Data?, authorizationCodeData: Data?) async {
        guard let identityTokenData,
              let identityToken = String(data: identityTokenData, encoding: .utf8),
              !identityToken.isEmpty else {
            accountMessage = "Apple 登录没有返回有效凭证，请重试。"
            return
        }
        let authorizationCode = authorizationCodeData.flatMap { String(data: $0, encoding: .utf8) }
        isAccountLoading = true
        accountMessage = ""
        do {
            let response = try await apiClient.signInWithApple(identityToken: identityToken, authorizationCode: authorizationCode)
            account = response.account
            accountMessage = "已绑定 Apple 账号。"
            await refreshBackendContentAfterAccountChange()
        } catch {
            accountMessage = userFacingErrorMessage(error, fallback: "Apple 登录失败，请稍后重试。")
        }
        isAccountLoading = false
    }

    @MainActor
    private func deleteAccount() async {
        isAccountLoading = true
        accountMessage = ""
        do {
            _ = try await apiClient.deleteAccount()
            clearCaptureMemoryStateAfterAccountDeletion()
            account = nil
            accountMessage = "账号数据已删除，当前设备会继续以匿名模式使用。"
            await refreshBackendContentAfterAccountChange()
        } catch {
            accountMessage = userFacingErrorMessage(error, fallback: "删除账号失败，请稍后重试。")
        }
        isAccountLoading = false
    }

    private func clearCaptureMemoryStateAfterAccountDeletion() {
        screenshotAnalysisTask?.cancel()
        screenshotAnalysisTask = nil
        screenshotCards.removeAll()
        screenshotDrawSession = nil
        screenshotAnalysisState = .idle
        pendingAIProcessingConsent = nil
        V2ScreenshotPersistence.clear()
    }

    @MainActor
    private func refreshBackendContentAfterAccountChange() async {
        hasLoadedInitialBackendChapter = false
        await loadLatestBackendChapterIfNeeded()
        await refreshCaptureMemoryCards()
        await refreshAwakeningSession()
    }

    @MainActor
    private func refreshCaptureMemoryCards() async {
        guard !usesFixtures else { return }
        do {
            let records = try await apiClient.fetchCaptureMemoryCards()
            screenshotCards = records.map(V2CapturedMemoryCard.init(record:))
        } catch {
            // Capture cards are an independent slice. A temporary list failure
            // must not hide chapters or block the rest of app startup.
        }
    }

    @MainActor
    private func refreshAwakeningSession() async {
        if usesFixtures {
            awakeningResponse = V2AwakeningFixture.homeResponse
            return
        }

        do {
            let response = try await apiClient.fetchV2AwakeningSession()
            awakeningResponse = response
            if let chapter = response.chapter {
                applyBackendChapter(chapter)
            }
        } catch {
            awakeningResponse = V2AwakeningSessionResponse(
                availableCount: 0,
                awakeningSession: nil,
                card: nil,
                feedback: nil,
                chapter: nil
            )
            generationState.errorText = userFacingErrorMessage(
                error,
                fallback: "暂时无法读取待唤醒记忆。"
            )
        }
    }

    private func userFacingErrorMessage(_ error: Error, fallback: String) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? fallback : message
    }

    @MainActor
    private func loadLatestBackendChapterIfNeeded() async {
        guard !usesFixtures, !hasLoadedInitialBackendChapter else {
            return
        }
        hasLoadedInitialBackendChapter = true

        do {
            backendNotifications = (try? await apiClient.fetchNotifications()) ?? []
            backendFavoriteQuestions = (try? await apiClient.fetchFavoriteQuestions()) ?? []
            if let recommendedResponse = try? await apiClient.fetchRecommendedArticles() {
                recommendedArticleFilters = recommendedResponse.filters
                recommendedArticles = recommendedResponse.articles
            }
            let chapters = try await apiClient.fetchV2Chapters()
            rememberCompletedReviews(in: chapters)
            backendChapters = chapters
            guard let latestChapter = chapters.first else {
                return
            }
            let initialChapter = activeLearningBackendChapter ?? latestChapter
            applyBackendChapter(initialChapter, activateForReview: true)
            if !isTerminalGenerationStatus(latestChapter.status) {
                startGenerationPolling(chapterID: latestChapter.id)
            }
        } catch {
            generationState.errorText = error.localizedDescription
        }
    }

    private func applyBackendChapter(_ chapter: V2BackendChapter, activateForReview: Bool = false) {
        rememberCompletedReviewIfNeeded(chapter)
        let previousChapterID = backendChapter?.id
        backendChapter = chapter
        upsertBackendChapter(chapter)
        if activateForReview {
            selectedBackendChapterID = chapter.id
        }

        let updatesActiveReviewChapter = selectedBackendChapterID.isEmpty || selectedBackendChapterID == chapter.id
        if previousChapterID != chapter.id && updatesActiveReviewChapter {
            generationState.clearError()
            backendReviewChapter = nil
            v2ReviewSession = nil
        }
        if updatesActiveReviewChapter, let reviewChapter = chapter.toReviewChapterData() {
            backendReviewChapter = reviewChapter
        }
        if updatesActiveReviewChapter, let session = chapter.v2ReviewSession {
            v2ReviewSession = session
            hydrateLocalQuestionStates(from: session)
        }
        if isCompletedGenerationChapter(chapter) {
            generationState.showsChapterCard = recommendedArticleGenerationSimulation != nil
            generationState.finishSubmitting()
            generationState.clearError()
        } else if isFailedGenerationStatus(chapter.status) || chapter.progress?.status == "failed" {
            generationState.showsChapterCard = true
            generationState.finishSubmitting()
            generationState.clearError()
        }
    }

    private func upsertBackendChapter(_ chapter: V2BackendChapter) {
        if let index = backendChapters.firstIndex(where: { $0.id == chapter.id }) {
            backendChapters[index] = chapter
        } else {
            backendChapters.insert(chapter, at: 0)
        }
    }

    private var completedReviewChapterIDs: Set<String> {
        Set(
            completedReviewChapterIDsStorage
                .split(separator: "\n")
                .map(String.init)
                .filter { !$0.isEmpty }
        )
    }

    private func rememberCompletedReviews(in chapters: [V2BackendChapter]) {
        for chapter in chapters {
            rememberCompletedReviewIfNeeded(chapter)
        }
    }

    private func rememberCompletedReviewIfNeeded(_ chapter: V2BackendChapter) {
        guard chapter.hasCompletedV2ReviewOnce else {
            return
        }
        rememberCompletedReview(chapterID: chapter.id)
    }

    private func rememberCompletedReview(chapterID: String) {
        guard !chapterID.isEmpty else {
            return
        }
        var ids = completedReviewChapterIDs
        guard ids.insert(chapterID).inserted else {
            return
        }
        completedReviewChapterIDsStorage = ids.sorted().joined(separator: "\n")
    }

    private func forgetCompletedReview(chapterID: String) {
        guard !chapterID.isEmpty else {
            return
        }
        var ids = completedReviewChapterIDs
        guard ids.remove(chapterID) != nil else {
            return
        }
        completedReviewChapterIDsStorage = ids.sorted().joined(separator: "\n")
    }

    private func isTerminalGenerationStatus(_ status: String) -> Bool {
        status == "completed" || isFailedGenerationStatus(status)
    }

    private func isCompletedGenerationChapter(_ chapter: V2BackendChapter) -> Bool {
        chapter.status == "completed" || chapter.progress?.status == "completed"
    }

    private func isFailedGenerationStatus(_ status: String) -> Bool {
        status == "failed_generation" || status == "failed_input" || status == "failed_questions" || status == "failed"
    }

    private func routeCompletedGenerationIfNeeded(_ chapter: V2BackendChapter) {
        guard isShowingGenerationDetail,
              isCompletedGenerationChapter(chapter),
              chapter.toReviewChapterData() != nil else {
            return
        }
        replaceRoute(chapterDetailRoute(chapterID: chapter.id))
    }

    @MainActor
    private func deleteSelectedBackendChapter() async {
        guard let chapterID = deletionTargetBackendChapter?.id else {
            resetToHome(tab: .materials)
            return
        }

        generationPollingTask?.cancel()
        recommendedArticleSimulationTask?.cancel()
        generationPollingTask = nil
        recommendedArticleSimulationTask = nil

        do {
            _ = try await apiClient.deleteChapter(id: chapterID)
            backendChapters.removeAll { $0.id == chapterID }
            backendNotifications.removeAll { $0.chapterId == chapterID }
            backendFavoriteQuestions.removeAll { $0.chapterId == chapterID }
            forgetCompletedReview(chapterID: chapterID)
            if activeLearningChapterID == chapterID {
                activeLearningChapterID = ""
            }
            if selectedBackendChapterID == chapterID {
                selectedBackendChapterID = ""
            }
            backendChapter = backendChapters.first
            backendReviewChapter = selectedBackendChapter?.toReviewChapterData() ?? backendChapter?.toReviewChapterData()
            v2ReviewSession = selectedBackendChapter?.v2ReviewSession ?? backendChapter?.v2ReviewSession
            recommendedArticleGenerationSimulation = nil
            recommendedArticleGenerationPendingChapters.removeAll()
            generationState.resetAfterDelete()
            resetToHome(tab: .materials)
        } catch {
            generationState.errorText = error.localizedDescription
        }
    }

    private func showGeneratedChapterDetail() {
        selectedTab = .materials
        routeStore.reset(to: .generatingChapterDetail(chapterID: backendChapter?.id))
        if hasSeenGenerationStartedEducation {
            generationState.showsChapterCard = true
        } else {
            generationState.showsChapterCard = false
            withAnimation(.easeOut(duration: 0.18)) {
                generationState.showsStartedDialog = true
            }
        }
    }

    private func bindRecommendedArticleGenerationSimulation(simulationID: String, chapterID: String) {
        guard recommendedArticleGenerationSimulation?.id == simulationID else {
            return
        }
        recommendedArticleGenerationSimulation?.chapterID = chapterID
        if recommendedArticleSimulationTask == nil,
           (recommendedArticleGenerationSimulation?.progress ?? 0) >= 0.98 {
            finishRecommendedArticleGenerationSimulation(simulationID: simulationID)
        }
    }

    private func finishRecommendedArticleGenerationSimulation(simulationID: String) {
        guard recommendedArticleGenerationSimulation?.id == simulationID else {
            return
        }
        recommendedArticleGenerationSimulation = nil
        recommendedArticleSimulationTask = nil
        if let chapter = recommendedArticleGenerationPendingChapters.removeValue(forKey: simulationID) {
            applyBackendChapter(chapter, activateForReview: isShowingGenerationDetail)
        }
        generationState.showsChapterCard = false
        generationState.clearError()
        if isShowingGenerationDetail {
            replaceRoute(chapterDetailRoute(chapterID: backendChapter?.id))
        }
    }

    private func startRecommendedArticleGenerationSimulation(simulationID: String, chapterID: String? = nil) {
        generationPollingTask?.cancel()
        generationPollingTask = nil
        recommendedArticleSimulationTask?.cancel()
        recommendedArticleGenerationPendingChapters.removeAll()
        selectedTab = .materials
        generationState.resetAfterDelete()
        generationState.showsChapterCard = true
        recommendedArticleGenerationSimulation = V2RecommendedArticleGenerationSimulation(
            id: simulationID,
            chapterID: chapterID,
            progress: V2RecommendedArticleSimulationTimeline.steps.first?.progress ?? 0,
            statusText: V2RecommendedArticleSimulationTimeline.steps.first?.statusText ?? "准备生成"
        )
        routeStore.reset(to: .generatingChapterDetail(chapterID: chapterID))

        if !hasSeenGenerationStartedEducation {
            withAnimation(.easeOut(duration: 0.18)) {
                generationState.showsStartedDialog = true
            }
        }

        recommendedArticleSimulationTask = Task {
            for step in V2RecommendedArticleSimulationTimeline.steps {
                if Task.isCancelled {
                    return
                }
                await MainActor.run {
                    guard recommendedArticleGenerationSimulation?.id == simulationID else {
                        return
                    }
                    withAnimation(.easeInOut(duration: 0.22)) {
                        recommendedArticleGenerationSimulation?.progress = step.progress
                        recommendedArticleGenerationSimulation?.statusText = step.statusText
                    }
                }
                try? await Task.sleep(nanoseconds: step.durationNanoseconds)
            }

            await MainActor.run {
                guard recommendedArticleGenerationSimulation?.id == simulationID else {
                    return
                }
                if recommendedArticleGenerationSimulation?.chapterID == nil && !usesFixtures {
                    recommendedArticleSimulationTask = nil
                    recommendedArticleGenerationSimulation?.progress = 0.98
                    recommendedArticleGenerationSimulation?.statusText = "正在整理结果"
                } else {
                    finishRecommendedArticleGenerationSimulation(simulationID: simulationID)
                }
            }
        }
    }

    private func dismissGenerationStartedDialog() {
        hasSeenGenerationStartedEducation = true
        let shouldRequestNotificationPermission = !hasRequestedGenerationNotificationPermission
        if shouldRequestNotificationPermission {
            hasRequestedGenerationNotificationPermission = true
        }

        withAnimation(.easeOut(duration: 0.16)) {
            generationState.showsStartedDialog = false
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                generationState.showsChapterCard = true
            }
        }

        if shouldRequestNotificationPermission {
            Task {
                try? await Task.sleep(nanoseconds: 350_000_000)
                await requestGenerationNotificationPermissionIfNeeded()
            }
        }
    }

    private func requestGenerationNotificationPermissionIfNeeded() async {
        let status = await PushNotificationService.authorizationStatus()
        switch status {
        case .notDetermined:
            _ = try? await PushNotificationService.requestAuthorizationAndRegister()
        case .authorized, .provisional, .ephemeral:
            await PushNotificationService.registerIfAuthorized()
        case .denied:
            break
        @unknown default:
            break
        }
    }

    @MainActor
    private func refreshBackendNotifications() async {
        guard !usesFixtures else { return }
        backendNotifications = (try? await apiClient.fetchNotifications()) ?? backendNotifications
    }

    private func registerPushToken(_ token: String) async {
        guard !usesFixtures else { return }

        do {
            _ = try await apiClient.registerPushToken(
                token,
                environment: .current,
                preferredLanguage: .zhHans
            )
        } catch {
            await MainActor.run {
                generationState.errorText = error.localizedDescription
            }
        }
    }

    private func openRemoteNotification(userInfo: [AnyHashable: Any]) async {
        await refreshBackendNotifications()

        let notificationID = userInfo["notificationId"] as? String
        let chapterID = userInfo["chapterId"] as? String
        let notificationType = userInfo["type"] as? String
        let notification = backendNotifications.first {
            (notificationID != nil && $0.id == notificationID) ||
            (chapterID != nil && $0.chapterId == chapterID)
        }

        if let notification {
            await MainActor.run {
                openNotification(
                    notification,
                    target: notification.type == .generationFailed ? .failure : .success
                )
            }
            return
        }

        if let chapterID {
            await openNotificationChapter(chapterID: chapterID)
            await MainActor.run {
                resetToRoute(
                    notificationType == "generation_failed"
                        ? generationFailureRoute(chapterID: chapterID)
                        : chapterDetailRoute(chapterID: chapterID),
                    tab: .materials
                )
            }
        }
    }

    private func openNotification(_ notification: NotificationItem, target: V2NotificationRouteTarget) {
        let chapterID = notification.chapterId
        let targetRoute: V2AppRoute = target == .failure
            ? generationFailureRoute(chapterID: chapterID)
            : chapterDetailRoute(chapterID: chapterID)
        let cachedChapter = backendChapters.first(where: { $0.id == chapterID })
        if let cachedChapter {
            applyBackendChapter(cachedChapter, activateForReview: true)
            pushRoute(targetRoute)
        }

        Task {
            async let dismissed: Void = dismissOpenedNotification(notification)
            await openNotificationChapter(chapterID: chapterID, forceRefresh: cachedChapter != nil)
            await dismissed

            if cachedChapter == nil {
                await MainActor.run {
                    pushRoute(targetRoute)
                }
            }
        }
    }

    @MainActor
    private func dismissOpenedNotification(_ notification: NotificationItem) async {
        if let index = backendNotifications.firstIndex(where: { $0.id == notification.id }) {
            backendNotifications[index].read = true
            backendNotifications[index].dismissed = true
        }

        guard !usesFixtures, !notification.dismissed else { return }

        do {
            let updated = try await apiClient.dismissNotification(id: notification.id)
            if let index = backendNotifications.firstIndex(where: { $0.id == updated.id }) {
                backendNotifications[index] = updated
            }
        } catch {
            generationState.errorText = error.localizedDescription
        }
    }

    private func openNotificationChapter(chapterID: String, forceRefresh: Bool = false) async {
        guard !chapterID.isEmpty, forceRefresh || selectedBackendChapterID != chapterID else { return }

        do {
            let chapter = try await apiClient.fetchV2Chapter(id: chapterID)
            await MainActor.run {
                applyBackendChapter(chapter, activateForReview: true)
            }
        } catch {
            await MainActor.run {
                generationState.errorText = error.localizedDescription
            }
        }
    }

    @MainActor
    private func openAwakeningCard() async {
        guard !isAwakeningLoading else { return }
        let wasActive = awakeningResponse?.hasActiveCard == true
        isAwakeningLoading = true
        defer { isAwakeningLoading = false }

        if usesFixtures {
            if !wasActive {
                awakeningResponse = V2AwakeningFixture.initialResponse
            }
            shouldAnimateAwakeningReveal = !wasActive
            selectedTab = .learning
            routeStore.reset(to: .awakening)
            return
        }

        do {
            let response: V2AwakeningSessionResponse
            if wasActive, let current = awakeningResponse {
                response = current
            } else {
                response = try await apiClient.startOrResumeV2AwakeningSession()
            }
            awakeningResponse = response
            if let chapter = response.chapter {
                applyBackendChapter(chapter)
            }
            guard response.hasActiveCard else { return }
            shouldAnimateAwakeningReveal = !wasActive
            selectedTab = .learning
            routeStore.reset(to: .awakening)
        } catch {
            generationState.errorText = userFacingErrorMessage(
                error,
                fallback: "暂时无法抽取记忆卡。"
            )
        }
    }

    @MainActor
    private func answerAwakeningCard(optionID: String) async {
        guard !isAwakeningLoading,
              let session = awakeningResponse?.awakeningSession else {
            return
        }
        isAwakeningLoading = true
        defer { isAwakeningLoading = false }

        if usesFixtures {
            awakeningResponse = V2AwakeningFixture.answeredResponse(
                selectedOptionId: optionID,
                from: awakeningResponse
            )
            return
        }

        do {
            let response = try await apiClient.answerV2AwakeningSession(
                sessionId: session.id,
                selectedOptionId: optionID,
                attemptId: "ios-awakening-\(UUID().uuidString)"
            )
            awakeningResponse = response
            if let chapter = response.chapter {
                applyBackendChapter(chapter)
            }
        } catch {
            generationState.errorText = userFacingErrorMessage(
                error,
                fallback: "答案没有保存，请重试。"
            )
        }
    }

    @MainActor
    private func completeAwakeningCard() async {
        guard !isAwakeningLoading,
              let session = awakeningResponse?.awakeningSession else {
            return
        }
        isAwakeningLoading = true
        defer { isAwakeningLoading = false }

        if usesFixtures {
            awakeningResponse = V2AwakeningFixture.completedResponse(from: awakeningResponse)
            return
        }

        do {
            let response = try await apiClient.completeV2AwakeningSession(sessionId: session.id)
            awakeningResponse = response
            if let chapter = response.chapter {
                applyBackendChapter(chapter)
            }
        } catch {
            generationState.errorText = userFacingErrorMessage(
                error,
                fallback: "这张记忆卡暂时无法完成。"
            )
        }
    }

    @MainActor
    private func drawNextAwakeningCard() async {
        guard !isAwakeningLoading else { return }
        isAwakeningLoading = true
        defer { isAwakeningLoading = false }

        if usesFixtures {
            awakeningResponse = V2AwakeningFixture.initialResponse
            shouldAnimateAwakeningReveal = true
            routeStore.reset(to: .awakening)
            return
        }

        do {
            let response = try await apiClient.startOrResumeV2AwakeningSession()
            awakeningResponse = response
            if let chapter = response.chapter {
                applyBackendChapter(chapter)
            }
            if response.hasActiveCard {
                shouldAnimateAwakeningReveal = true
                routeStore.reset(to: .awakening)
            } else {
                resetToHome(tab: .learning)
            }
        } catch {
            generationState.errorText = userFacingErrorMessage(
                error,
                fallback: "暂时没有抽到下一张记忆卡。"
            )
        }
    }

    private func openAwakeningSource() {
        guard let chapterID = awakeningResponse?.awakeningSession?.chapterId else {
            return
        }
        if !usesFixtures {
            _ = selectBackendChapter(id: chapterID)
        }
        pushRoute(sourceArticleRoute(chapterID: chapterID))
    }

    private func openSource() {
        if case .generatingChapterDetail = routeStore.current,
           !canOpenGeneratedChapterFromGenerationDetail {
            return
        }

        guard canOpenActiveSource else {
            return
        }

        let sourceAnchorId = reviewQuestion(for: routeStore.current)?.sourceAnchorId ?? sourceQuestion?.sourceAnchorId
        if usesBackendReviewChapter, !reviewEntryMode.isTemporaryPractice {
            Task {
                await openBackendSourceRouteIfPossible(sourceAnchorId: sourceAnchorId)
            }
        }
        pushRoute(sourceArticleRoute())
    }

    private func chapterDetailRoute(chapterID: String? = nil) -> V2AppRoute {
        .chapterDetail(chapterID: resolvedChapterID(chapterID))
    }

    private func sourceArticleRoute(chapterID: String? = nil) -> V2AppRoute {
        .sourceArticle(chapterID: resolvedChapterID(chapterID ?? routeChapterID(routeStore.current)))
    }

    private func chapterOverviewRoute(chapterID: String? = nil) -> V2AppRoute {
        .chapterOverview(chapterID: resolvedChapterID(chapterID))
    }

    private func unitOverviewRoute(unitID: String, chapterID: String? = nil) -> V2AppRoute {
        .unitOverview(chapterID: resolvedChapterID(chapterID), unitID: unitID)
    }

    private func questionRoute(unitID: String, questionID: String, chapterID: String? = nil) -> V2AppRoute {
        .question(chapterID: resolvedChapterID(chapterID), unitID: unitID, questionID: questionID)
    }

    private func unitSummaryRoute(unitID: String, chapterID: String? = nil) -> V2AppRoute {
        .unitSummary(chapterID: resolvedChapterID(chapterID), unitID: unitID)
    }

    private func chapterSummaryRoute(chapterID: String? = nil) -> V2AppRoute {
        .chapterSummary(chapterID: resolvedChapterID(chapterID))
    }

    private func generationFailureRoute(chapterID: String? = nil) -> V2AppRoute {
        .generationFailureDetail(chapterID: resolvedChapterID(chapterID))
    }

    private func routeChapterID(_ route: V2AppRoute?) -> String? {
        switch route {
        case .awakening:
            awakeningResponse?.awakeningSession?.chapterId
        case .generationFailureDetail(let chapterID),
             .chapterDetail(let chapterID),
             .sourceArticle(let chapterID),
             .chapterOverview(let chapterID),
             .unitOverview(let chapterID, _),
             .question(let chapterID, _, _),
             .unitSummary(let chapterID, _),
             .chapterSummary(let chapterID):
            chapterID
        case .generatingChapterDetail(let chapterID):
            chapterID
        case .savedBackendQuestion(let item):
            item.chapterID
        default:
            nil
        }
    }

    private func pushRoute(_ nextRoute: V2AppRoute) {
        routeStore.push(nextRoute)
    }

    private func replaceRoute(_ nextRoute: V2AppRoute) {
        routeStore.replace(with: nextRoute)
    }

    private func resetToRoute(_ nextRoute: V2AppRoute, tab: V2HomeTab? = nil) {
        if let tab {
            selectedTab = tab
        }
        routeStore.reset(to: nextRoute)
    }

    private func resetToHome(tab: V2HomeTab? = nil) {
        if let tab {
            selectedTab = tab
        }
        reviewEntryMode = .mainline
        routeStore.resetToRoot()
    }

    private func goBack() {
        guard let route = routeStore.current else {
            routeStore.clearStack()
            return
        }

        if case .sourceArticle = route,
           usesBackendReviewChapter,
           !reviewEntryMode.isTemporaryPractice {
            Task {
                await returnFromBackendSourceRouteIfPossible()
            }
        }

        if case .question = route {
            resetToHome(tab: .learning)
            return
        }

        if case .awakening = route {
            resetToHome(tab: .learning)
            return
        }

        if case .savedQuestion = route {
            resetToHome(tab: .materials)
            return
        }

        if case .savedBackendQuestion = route {
            resetToHome(tab: .materials)
            return
        }

        routeStore.pop()
    }

    @MainActor
    private func startOrResumeBackendReviewFromChapterDetail(chapterID: String) async {
        guard !chapterID.isEmpty else {
            openFirstUnit()
            return
        }

        do {
            let response = try await apiClient.startOrResumeV2ReviewSession(chapterId: chapterID)
            activeLearningChapterID = chapterID
            applyV2ReviewSessionResponse(response)
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(route(for: response.reviewSession?.displayCard) ?? unitOverviewRoute(unitID: activeFirstUnitID, chapterID: chapterID))
        } catch {
            generationState.errorText = error.localizedDescription
            openFirstUnit()
        }
    }

    @MainActor
    private func startOrResumeBackendReviewFromLearningPath(fallbackUnitID: String) async {
        guard let chapterID = activeReviewBackendChapter?.id else {
            resetToRoute(unitOverviewRoute(unitID: fallbackUnitID), tab: .learning)
            return
        }

        do {
            let response = try await apiClient.startOrResumeV2ReviewSession(chapterId: chapterID)
            activeLearningChapterID = chapterID
            applyV2ReviewSessionResponse(response)
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(route(for: response.reviewSession?.displayCard) ?? unitOverviewRoute(unitID: fallbackUnitID, chapterID: chapterID))
        } catch {
            generationState.errorText = error.localizedDescription
            resetToRoute(unitOverviewRoute(unitID: fallbackUnitID, chapterID: chapterID), tab: .learning)
        }
    }

    @MainActor
    private func replayBackendReviewFromUnit(unitID: String) async {
        guard let chapterID = activeReviewBackendChapter?.id else {
            resetToRoute(unitOverviewRoute(unitID: unitID), tab: .learning)
            return
        }

        do {
            let response = try await apiClient.replayV2ReviewSessionFromUnit(chapterId: chapterID, unitId: unitID)
            activeLearningChapterID = chapterID
            applyV2ReviewSessionResponse(response)
            selectedTab = .learning
            routeStore.clearStack()
            replaceRoute(route(for: response.reviewSession?.displayCard) ?? unitOverviewRoute(unitID: unitID, chapterID: chapterID))
        } catch {
            generationState.errorText = error.localizedDescription
            resetToRoute(unitOverviewRoute(unitID: unitID, chapterID: chapterID), tab: .learning)
        }
    }

    @MainActor
    private func advanceBackendReviewAndRoute(
        fallback: V2AppRoute,
        resetHomeOnCompletion: Bool = false
    ) async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                routeToReviewCard(fallback)
                return
            }

            let response = try await apiClient.advanceV2ReviewSession(sessionId: session.id)
            applyV2ReviewSessionResponse(response)

            if resetHomeOnCompletion, response.reviewSession?.completedAt != nil {
                resetToHome(tab: .learning)
                return
            }

            routeToReviewCard(route(for: response.reviewSession?.displayCard) ?? fallback)
        } catch {
            generationState.errorText = error.localizedDescription
            routeToReviewCard(fallback)
        }
    }

    @MainActor
    private func advanceBackendPracticeAndRoute(fallback: V2AppRoute) async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                routeToReviewCard(fallback)
                return
            }

            let response = try await apiClient.advanceV2PracticeSession(sessionId: session.id)
            applyV2ReviewSessionResponse(response)
            routeToReviewCard(route(for: response.reviewSession?.displayCard) ?? fallback)
        } catch {
            generationState.errorText = error.localizedDescription
            routeToReviewCard(fallback)
        }
    }

    @MainActor
    private func finishBackendPracticeAndReturnHome() async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                resetToHome(tab: .learning)
                return
            }
            let response = try await apiClient.finishV2PracticeSession(sessionId: session.id)
            applyV2ReviewSessionResponse(response)
        } catch {
            generationState.errorText = error.localizedDescription
        }
        reviewEntryMode = .mainline
        resetToHome(tab: .learning)
    }

    @MainActor
    private func persistBackendAnswerProgress(unitID: String, questionID: String) {
        guard usesBackendReviewChapter,
              !reviewEntryMode.isTemporaryPractice,
              let payload = backendAnswerPayload(unitID: unitID, questionID: questionID) else {
            return
        }

        Task {
            do {
                guard let session = try await ensureV2ReviewSession() else {
                    return
                }
                let response = try await apiClient.answerV2Question(
                    sessionId: session.id,
                    unitId: unitID,
                    questionId: questionID,
                    result: payload.result,
                    selectedOptionId: payload.selectedOptionId,
                    matchedPairs: payload.matchedPairs,
                    lockedPairIds: payload.lockedPairIds
                )
                await MainActor.run {
                    applyV2ReviewSessionResponse(
                        response,
                        preservingCurrentCardIfMovedPastAnswerFor: (unitID: unitID, questionID: questionID)
                    )
                }
            } catch {
                await MainActor.run {
                    generationState.errorText = error.localizedDescription
                }
            }
        }
    }

    @MainActor
    private func persistBackendAnswerAndContinue(unitID: String, questionID: String) async {
        guard let payload = backendAnswerPayload(unitID: unitID, questionID: questionID) else {
            advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
            return
        }

        do {
            guard let session = try await ensureV2ReviewSession() else {
                advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
                return
            }

            let answerResponse = try await apiClient.answerV2Question(
                sessionId: session.id,
                unitId: unitID,
                questionId: questionID,
                result: payload.result,
                selectedOptionId: payload.selectedOptionId,
                matchedPairs: payload.matchedPairs,
                lockedPairIds: payload.lockedPairIds
            )
            applyV2ReviewSessionResponse(answerResponse)

            if let updatedSession = answerResponse.reviewSession {
                let advanceResponse = try await apiClient.advanceV2ReviewSession(sessionId: updatedSession.id)
                applyV2ReviewSessionResponse(advanceResponse)
                questionInteractionStates.removeValue(forKey: questionStateKey(unitID: unitID, questionID: questionID))
                routeToReviewCard(route(for: advanceResponse.reviewSession?.displayCard) ?? localRouteAfterQuestion(unitID: unitID, questionID: questionID))
                return
            }
        } catch {
            generationState.errorText = error.localizedDescription
        }

        advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
    }

    @MainActor
    private func persistBackendPracticeAnswerAndContinue(unitID: String, questionID: String) async {
        guard let payload = backendAnswerPayload(unitID: unitID, questionID: questionID) else {
            advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
            return
        }

        do {
            guard let session = try await ensureV2ReviewSession() else {
                advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
                return
            }

            let answerResponse = try await apiClient.answerV2PracticeQuestion(
                sessionId: session.id,
                unitId: unitID,
                questionId: questionID,
                result: payload.result,
                selectedOptionId: payload.selectedOptionId,
                matchedPairs: payload.matchedPairs,
                lockedPairIds: payload.lockedPairIds
            )
            applyV2ReviewSessionResponse(answerResponse)

            let advanceResponse = try await apiClient.advanceV2PracticeSession(sessionId: session.id)
            applyV2ReviewSessionResponse(advanceResponse)
            questionInteractionStates.removeValue(forKey: questionStateKey(unitID: unitID, questionID: questionID))
            routeToReviewCard(route(for: advanceResponse.reviewSession?.displayCard) ?? localRouteAfterQuestion(unitID: unitID, questionID: questionID))
            return
        } catch {
            generationState.errorText = error.localizedDescription
        }

        advanceLocalAfterQuestion(unitID: unitID, questionID: questionID)
    }

    private func routeToReviewCard(_ route: V2AppRoute) {
        selectedTab = .learning
        replaceRoute(route)
    }

    private func localRouteAfterQuestion(unitID: String, questionID: String) -> V2AppRoute {
        if let nextQuestion = nextQuestion(after: questionID, in: unitID) {
            return questionRoute(unitID: unitID, questionID: nextQuestion.id)
        }
        return unitSummaryRoute(unitID: unitID)
    }

    @MainActor
    private func ensureV2ReviewSession() async throws -> V2BackendReviewSession? {
        if let activeReviewSession {
            return activeReviewSession
        }

        guard let chapterID = activeReviewBackendChapter?.id else {
            return nil
        }

        let response = try await apiClient.startOrResumeV2ReviewSession(chapterId: chapterID)
        applyV2ReviewSessionResponse(response)
        return response.reviewSession
    }

    private func applyV2ReviewSessionResponse(
        _ response: V2ReviewSessionResponse,
        preservingCurrentCardIfMovedPastAnswerFor answeredQuestion: (unitID: String, questionID: String)? = nil
    ) {
        var responseSession = response.reviewSession ?? response.chapter.v2ReviewSession
        if let answeredQuestion,
           let currentCard = v2ReviewSession?.currentCard,
           shouldPreserveCurrentCard(
               currentCard,
               insteadOfAnswerSaveFor: answeredQuestion
           ),
           let session = responseSession {
            responseSession = V2BackendReviewSession(
                schemaVersion: session.schemaVersion,
                id: session.id,
                chapterId: session.chapterId,
                status: session.status,
                currentCard: currentCard,
                activeCard: session.activeCard,
                questionStates: session.questionStates,
                activeQuestionStates: session.activeQuestionStates,
                completedStepIds: session.completedStepIds,
                mode: session.mode,
                practice: session.practice,
                sourceRoute: session.sourceRoute,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                completedAt: session.completedAt
            )
        }
        let chapterWithSession = response.chapter.replacingReviewSession(responseSession)
        applyBackendChapter(chapterWithSession, activateForReview: true)
        if let session = responseSession {
            v2ReviewSession = session
            hydrateLocalQuestionStates(from: session)
        }
    }

    private func shouldPreserveCurrentCard(
        _ currentCard: V2BackendReviewCard,
        insteadOfAnswerSaveFor answeredQuestion: (unitID: String, questionID: String)
    ) -> Bool {
        guard currentCard.type == "question" || currentCard.type == "question_feedback" else {
            return true
        }
        return currentCard.unitId != answeredQuestion.unitID
            || currentCard.questionId != answeredQuestion.questionID
    }

    private func route(for card: V2BackendReviewCard?) -> V2AppRoute? {
        guard let card else {
            return nil
        }
        let chapterID = resolvedChapterID(card.chapterId)

        switch card.type {
        case "chapter_overview":
            return chapterOverviewRoute(chapterID: chapterID)
        case "unit_overview":
            guard let unitID = card.unitId,
                  activeUnit(chapterID: chapterID, id: unitID) != nil else {
                return nil
            }
            return unitOverviewRoute(unitID: unitID, chapterID: chapterID)
        case "question", "question_feedback":
            guard let unitID = card.unitId, let questionID = card.questionId else {
                return nil
            }
            guard activeQuestion(chapterID: chapterID, unitID: unitID, questionID: questionID) != nil else {
                return nil
            }
            return questionRoute(unitID: unitID, questionID: questionID, chapterID: chapterID)
        case "unit_summary":
            guard let unitID = card.unitId,
                  activeUnit(chapterID: chapterID, id: unitID) != nil else {
                return nil
            }
            return unitSummaryRoute(unitID: unitID, chapterID: chapterID)
        case "chapter_summary":
            return chapterSummaryRoute(chapterID: chapterID)
        default:
            return nil
        }
    }

    private func backendAnswerPayload(
        unitID: String,
        questionID: String
    ) -> (
        result: String,
        selectedOptionId: String?,
        matchedPairs: [V2BackendMatchedPair],
        lockedPairIds: [String]
    )? {
        guard let question = activeQuestion(unitID: unitID, questionID: questionID) else {
            return nil
        }

        let key = questionStateKey(unitID: unitID, questionID: questionID)
        let interaction = questionInteractionStates[key, default: V2QuestionInteractionState()]

        switch question.kind {
        case .multipleChoice, .trueFalse:
            guard let selectedIndex = interaction.multipleChoice.selectedIndex else {
                return nil
            }
            return (
                result: selectedIndex == question.correctOptionIndex ? "correct" : "wrong",
                selectedOptionId: optionID(for: selectedIndex),
                matchedPairs: [],
                lockedPairIds: []
            )
        case .matching:
            let lockedPairIds = question.matchingPairs
                .filter {
                    interaction.matching.leftStates[$0.id] == .locked
                        && interaction.matching.rightStates[$0.id] == .locked
                }
                .map(\.id)
            let isCorrect = lockedPairIds.count == question.matchingPairs.count && !question.matchingPairs.isEmpty
            let matchedPairs = lockedPairIds.map {
                V2BackendMatchedPair(leftId: $0, rightId: $0)
            }
            return (
                result: isCorrect ? "correct" : "wrong",
                selectedOptionId: nil,
                matchedPairs: matchedPairs,
                lockedPairIds: lockedPairIds
            )
        }
    }

    private func optionID(for index: Int) -> String? {
        ["A", "B", "C", "D", "E", "F"].indices.contains(index) ? ["A", "B", "C", "D", "E", "F"][index] : nil
    }

    private func hydrateLocalQuestionStates(from session: V2BackendReviewSession) {
        if session.displayCard.type == "question",
           let unitID = session.displayCard.unitId,
           let questionID = session.displayCard.questionId,
           session.displayQuestionStates[questionID] == nil {
            questionInteractionStates.removeValue(forKey: questionStateKey(unitID: unitID, questionID: questionID))
        }

        for (questionID, backendState) in session.displayQuestionStates {
            guard let unitID = unitID(containingQuestionID: questionID),
                  let question = activeQuestion(unitID: unitID, questionID: questionID) else {
                continue
            }

            let key = questionStateKey(unitID: unitID, questionID: questionID)
            var interaction = questionInteractionStates[key, default: V2QuestionInteractionState()]

            switch question.kind {
            case .multipleChoice, .trueFalse:
                if let selectedOptionId = backendState.selectedOptionId,
                   let selectedIndex = optionIndex(for: selectedOptionId) {
                    interaction.multipleChoice.selectedIndex = selectedIndex
                }
                interaction.multipleChoice.feedbackPanelVisible = backendState.feedbackVisible
            case .matching:
                if backendState.status == "answered", backendState.result == "correct" {
                    for pair in question.matchingPairs {
                        interaction.matching.leftStates[pair.id] = .locked
                        interaction.matching.rightStates[pair.id] = .locked
                    }
                }
                interaction.matching.feedbackPanelVisible = backendState.feedbackVisible
            }

            questionInteractionStates[key] = interaction
        }
    }

    private func optionIndex(for optionID: String) -> Int? {
        ["A", "B", "C", "D", "E", "F"].firstIndex(of: optionID)
    }

    private func unitID(containingQuestionID questionID: String) -> String? {
        activeChapter?.units.first { unit in
            unit.questions.contains { $0.id == questionID }
        }?.id
    }

    private func isBackendQuestionFavorite(questionID: String) -> Bool {
        guard let chapterID = activeReviewBackendChapter?.id else {
            return false
        }
        return isBackendQuestionFavorite(chapterID: chapterID, questionID: questionID)
    }

    private func isBackendQuestionFavorite(chapterID: String, questionID: String) -> Bool {
        backendFavoriteRecord(chapterID: chapterID, questionID: questionID) != nil
    }

    private func backendFavoriteRecord(chapterID: String, questionID: String) -> FavoriteQuestionRecord? {
        backendFavoriteQuestions.first { record in
            record.chapterId == chapterID && record.questionId == questionID
        }
    }

    private func toggleBackendFavorite(questionID: String, isSaved: Bool) {
        guard let chapterID = activeReviewBackendChapter?.id else {
            return
        }
        toggleBackendFavorite(chapterID: chapterID, questionID: questionID, isSaved: isSaved)
    }

    private func toggleBackendFavorite(chapterID: String, questionID: String, isSaved: Bool) {
        guard !usesFixtures else {
            return
        }

        let previous = backendFavoriteQuestions

        if isSaved {
            guard backendFavoriteRecord(chapterID: chapterID, questionID: questionID) == nil else {
                return
            }
            let localRecord = FavoriteQuestionRecord(
                id: "local-\(chapterID)-\(questionID)",
                chapterId: chapterID,
                questionId: questionID,
                createdAt: Date.nowISO8601
            )
            backendFavoriteQuestions.insert(localRecord, at: 0)

            Task {
                do {
                    let saved = try await apiClient.createFavoriteQuestion(chapterId: chapterID, questionId: questionID)
                    await MainActor.run {
                        backendFavoriteQuestions.removeAll { record in
                            record.chapterId == chapterID && record.questionId == questionID
                        }
                        backendFavoriteQuestions.insert(saved, at: 0)
                    }
                } catch {
                    await MainActor.run {
                        backendFavoriteQuestions = previous
                        generationState.errorText = error.localizedDescription
                    }
                }
            }
        } else {
            guard let existing = backendFavoriteRecord(chapterID: chapterID, questionID: questionID) else {
                return
            }
            backendFavoriteQuestions.removeAll { $0.id == existing.id }

            Task {
                do {
                    _ = try await apiClient.deleteFavoriteQuestion(id: existing.id)
                } catch {
                    await MainActor.run {
                        backendFavoriteQuestions = previous
                        generationState.errorText = error.localizedDescription
                    }
                }
            }
        }
    }

    private func backendSavedQuestionItem(id: String) -> V2SavedQuestionDisplayItem? {
        guard let record = backendFavoriteQuestions.first(where: { $0.id == id }) else {
            return nil
        }
        return backendSavedQuestionItem(record: record)
    }

    private func backendSavedQuestionItem(record: FavoriteQuestionRecord) -> V2SavedQuestionDisplayItem? {
        guard let chapter = backendChapters.first(where: { $0.id == record.chapterId }),
              let reviewChapter = chapter.toReviewChapterData() else {
            return nil
        }

        for (unitIndex, unit) in reviewChapter.units.enumerated() {
            guard let question = unit.questions.first(where: { $0.id == record.questionId }) else {
                continue
            }

            return V2SavedQuestionDisplayItem(
                id: record.id,
                chapterID: record.chapterId,
                chapterTitle: reviewChapter.title,
                unitID: unit.id,
                unitTitle: "单元\(unitIndex + 1)",
                questionID: question.id,
                title: question.prompt.isEmpty ? question.title : question.prompt,
                source: reviewChapter.title,
                type: question.kind == .matching ? "连线题" : "选择题"
            )
        }

        return nil
    }

    @MainActor
    private func openBackendSourceRouteIfPossible(sourceAnchorId: String?) async {
        do {
            guard let session = try await ensureV2ReviewSession() else {
                return
            }
            let response = try await apiClient.openV2SourceFromReview(sessionId: session.id, sourceAnchorId: sourceAnchorId)
            applyV2ReviewSessionResponse(response)
        } catch {
            generationState.errorText = error.localizedDescription
        }
    }

    @MainActor
    private func returnFromBackendSourceRouteIfPossible() async {
        guard let session = v2ReviewSession else {
            return
        }

        do {
            let response = try await apiClient.returnFromV2SourceToReview(sessionId: session.id)
            applyV2ReviewSessionResponse(response)
        } catch {
            generationState.errorText = error.localizedDescription
        }
    }
}

private enum V2RecommendedArticleSimulationTimeline {
    struct Step {
        let progress: Double
        let statusText: String
        let durationNanoseconds: UInt64
    }

    static let steps: [Step] = [
        Step(progress: 0.08, statusText: "正在提取原文", durationNanoseconds: 1_200_000_000),
        Step(progress: 0.28, statusText: "正在分析文章", durationNanoseconds: 1_300_000_000),
        Step(progress: 0.48, statusText: "正在整理知识点", durationNanoseconds: 1_300_000_000),
        Step(progress: 0.68, statusText: "正在设计练习", durationNanoseconds: 1_300_000_000),
        Step(progress: 0.86, statusText: "正在生成题目", durationNanoseconds: 1_200_000_000),
        Step(progress: 1.0, statusText: "正在整理结果", durationNanoseconds: 900_000_000)
    ]
}

private struct V2MissingRouteView: View {
    let onBack: () -> Void

    var body: some View {
        V2FlowScreen(title: "页面暂不可用", onBack: onBack) {
            V2InfoCard {
                Text("页面数据暂时没有同步完成，请返回后重试。")
                    .font(V2Typography.body)
                    .foregroundStyle(V2Color.textSecondary)
            }
            .v2PageColumn()
            .padding(.top, 28)
        }
    }
}

struct V2RootView_Previews: PreviewProvider {
    static var previews: some View {
        V2RootView()
            .previewDevice("iPhone 17")
            .previewDisplayName("V2 Root - iPhone 17")
    }
}
