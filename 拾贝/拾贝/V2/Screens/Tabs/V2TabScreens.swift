import SwiftUI
import PhotosUI

struct V2TabScaffold<Content: View>: View {
    @Binding var selectedTab: V2HomeTab
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            let bottomNavScale = min(1, geometry.size.width / 357)

            ZStack(alignment: .top) {
                V2Color.pageGreenBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    V2TopChrome {
                        Text(title)
                            .font(V2Typography.pageTitle)
                            .foregroundStyle(V2Color.topTitle)
                            .frame(maxWidth: .infinity)
                    }

                    ScrollView(showsIndicators: false) {
                        content()
                            .v2PageColumn()
                            .padding(.top, 28)
                            .padding(.bottom, 128)
                    }
                }

                VStack {
                    Spacer()

                    V2BottomNavigationBar(selectedTab: $selectedTab)
                        .scaleEffect(bottomNavScale, anchor: .bottom)
                        .frame(width: 357 * bottomNavScale, height: 94 * bottomNavScale)
                        .padding(.bottom, V2BottomNavPlacement.bottomPadding)
                }
                .zIndex(20)
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)
        }
    }
}

struct V2MaterialsView: View {
    @Binding var selectedTab: V2HomeTab
    let usesMockData: Bool
    let backendChapters: [V2BackendChapter]
    let completedChapterIDs: Set<String>
    let generatedChapterCount: Int
    let showsGeneratingChapterCard: Bool
    let generatingChapterTitle: String
    let generatingChapterStatus: V2ChapterReviewStatus
    let generatingProgressText: String
    let generatedChapter: V2ReviewChapterData?
    let screenshotCards: [V2CapturedMemoryCard]
    let openGeneratingChapter: (String?) -> Void
    let openChapter: (String) -> Void
    let deleteMemoryCard: (String) async throws -> Void

    @State private var pendingMemoryCardDeletion: V2CapturedMemoryCard?
    @State private var deletingMemoryCardID: String?
    @State private var memoryCardDeletionError = ""

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "知识库") {
            VStack(spacing: 16) {
                if !memoryCardDeletionError.isEmpty {
                    Text(memoryCardDeletionError)
                        .font(V2Typography.caption)
                        .foregroundStyle(V2Color.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("v2.library.delete-error")
                }

                if !screenshotCards.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("我的记忆卡")
                            .font(V2Typography.sectionTitle)
                            .foregroundStyle(V2Color.textPrimary)

                        ForEach(screenshotCards) { captured in
                            V2MemoryLibraryCard(
                                captured: captured,
                                isDeleting: deletingMemoryCardID == captured.id,
                                onDelete: { pendingMemoryCardDeletion = captured }
                            )
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 12)
                }

                ZStack(alignment: .topTrailing) {
                    V2GeneratedChaptersSummaryCard(count: generatedChapterCount)
                        .padding(.top, 54)

                    Image("V2MaterialsMascot")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(
                            width: V2MaterialsMascotMetrics.width,
                            height: V2MaterialsMascotMetrics.height
                        )
                        .offset(
                            x: V2MaterialsMascotMetrics.offsetX,
                            y: V2MaterialsMascotMetrics.offsetY
                        )
                        .opacity(0.98)
                        .allowsHitTesting(false)
                }
                .padding(.bottom, 16)

                if showsGeneratingChapterCard {
                    Button {
                        openGeneratingChapter(backendChapters.first?.id)
                    } label: {
                        V2ChapterCard(
                            title: generatingChapterTitle,
                            status: generatingChapterStatus,
                            source: "网页文章",
                            knowledgeCount: 0,
                            questionCount: 0,
                            generationProgressText: generatingProgressText
                        )
                    }
                    .buttonStyle(.plain)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                ForEach(backendChapters.filter { !showsGeneratingChapterCard || $0.id != backendChapters.first?.id }) { chapter in
                    Button {
                        if chapter.isV2GenerationPending || chapter.isV2GenerationFailed {
                            openGeneratingChapter(chapter.id)
                        } else {
                            openChapter(chapter.id)
                        }
                    } label: {
                        V2ChapterCard(
                            title: chapter.title,
                            status: listStatus(for: chapter),
                            source: chapter.sourceLabel,
                            knowledgeCount: chapter.units?.count ?? 0,
                            questionCount: chapter.questionCount,
                            generationProgressText: chapter.progress?.displayTextOrFallback ?? chapter.displayStatusText
                        )
                    }
                    .buttonStyle(.plain)
                }

            }
        }
        .alert(item: $pendingMemoryCardDeletion) { captured in
            Alert(
                title: Text("删除这条记忆？"),
                message: Text("删除后，这张卡或碎片会从知识库移除，且无法撤销。"),
                primaryButton: .destructive(Text("删除")) {
                    Task { @MainActor in
                        deletingMemoryCardID = captured.id
                        memoryCardDeletionError = ""
                        do {
                            try await deleteMemoryCard(captured.id)
                        } catch is CancellationError {
                            // The view is going away; keep the server as the source of truth.
                        } catch {
                            memoryCardDeletionError = error.localizedDescription
                        }
                        deletingMemoryCardID = nil
                    }
                },
                secondaryButton: .cancel(Text("取消"))
            )
        }
    }

    private func listStatus(for chapter: V2BackendChapter) -> V2ChapterReviewStatus {
        chapter.v2ListStatus(hasCompletedReviewOnce: completedChapterIDs.contains(chapter.id) || chapter.hasCompletedV2ReviewOnce)
    }
}

private struct V2MemoryLibraryCard: View {
    let captured: V2CapturedMemoryCard
    let isDeleting: Bool
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(libraryStatusTitle)
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.primary)
                Spacer()
                if isFormalReviewCard {
                    Text(captured.masteryStage.title)
                        .font(V2Typography.caption)
                        .foregroundStyle(V2Color.textMuted)
                }
                Button(action: onDelete) {
                    Image(systemName: isDeleting ? "hourglass" : "trash")
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(V2Color.textMuted)
                .disabled(isDeleting)
                .accessibilityLabel("删除这条记忆")
            }

            Text(captured.card.coreKnowledge)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(V2Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 5) {
                Image(systemName: sourceSymbol)
                Text(sourceTitle)
                    .lineLimit(1)
                Spacer()
                if isFormalReviewCard, let schedule = captured.schedule {
                    Text(schedule.displayText)
                        .lineLimit(1)
                }
            }
            .font(V2Typography.caption)
            .foregroundStyle(V2Color.textMuted)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow()
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(captured.card.coreKnowledge)，\(sourceTitle)")
        .accessibilityIdentifier("v2.library.card.\(captured.id)")
    }

    private var isFormalReviewCard: Bool {
        captured.card.state == .formal && captured.disposition == .createCard
    }

    private var libraryStatusTitle: String {
        switch captured.disposition {
        case .archiveOnly:
            "已保存碎片"
        case .needsConfirmation:
            "待确认"
        case .createCard:
            captured.card.rarity?.rawValue ?? "记忆卡"
        }
    }

    private var sourceTitle: String {
        switch captured.card.sourceStatus {
        case .verified:
            captured.card.sourceTitle ?? "来源已核对"
        case .partial:
            "部分来源已核对"
        case .unconfirmed:
            "来源尚未确认"
        }
    }

    private var sourceSymbol: String {
        switch captured.card.sourceStatus {
        case .verified: "checkmark.seal.fill"
        case .partial: "checkmark.seal"
        case .unconfirmed: "questionmark.circle"
        }
    }
}

private enum V2MaterialsMascotMetrics {
    static let width: CGFloat = 166
    static let height: CGFloat = 138
    static let offsetX: CGFloat = 10
    static let offsetY: CGFloat = -6
}

private extension V2BackendChapter {
    var isV2GenerationPending: Bool {
        status != "completed" && !isV2GenerationFailed
    }

    var isV2GenerationFailed: Bool {
        status == "failed_generation" || status == "failed_input" || status == "failed_questions" || progress?.status == "failed"
    }

    func v2ListStatus(hasCompletedReviewOnce: Bool = false) -> V2ChapterReviewStatus {
        if isV2GenerationFailed {
            return .failed
        }
        if isV2GenerationPending {
            return .generating
        }
        if hasCompletedReviewOnce || hasCompletedV2ReviewOnce {
            return .completed
        }
        if v2ReviewSession != nil {
            return .reviewing
        }
        return .notStarted
    }
}

struct V2GeneratingChapterDetailView: View {
    let progress: Double
    let statusText: String
    let isCompleted: Bool
    let onBack: () -> Void
    let onSource: () -> Void
    let onOpenChapter: () -> Void
    let onDelete: () -> Void

    var body: some View {
        V2FlowScreen(
            title: "章节详情",
            onBack: onBack
        ) {
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    generatingDetailDecorations(in: geometry.size)

                    Image("V2GeneratingChapterMascot")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(width: 275, height: 255)
                        .position(x: geometry.size.width / 2 - 3, y: 146.5)
                        .allowsHitTesting(false)
                        .zIndex(1)

                    V2GeneratingChapterDetailCard(
                        progress: CGFloat(progress),
                        statusText: statusText,
                        isCompleted: isCompleted,
                        onSource: onSource,
                        onOpenChapter: onOpenChapter,
                        onDelete: onDelete
                    )
                    .position(x: geometry.size.width / 2, y: 432.5)
                    .zIndex(2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(height: 760)
        }
    }

    @ViewBuilder
    private func generatingDetailDecorations(in size: CGSize) -> some View {
        Image("V2BgDecoSmallPlantCluster")
            .resizable()
            .renderingMode(.original)
            .scaledToFit()
            .frame(width: 59.5)
            .opacity(0.64)
            .position(x: size.width - 24, y: 631)
            .allowsHitTesting(false)

        Image("V2BgDecoLeftHillPlant")
            .resizable()
            .renderingMode(.original)
            .scaledToFit()
            .frame(width: 108.5)
            .opacity(0.52)
            .position(x: 37, y: 730)
            .allowsHitTesting(false)
    }
}

struct V2UploadView: View {
    @Binding var selectedTab: V2HomeTab
    let isSubmittingGeneration: Bool
    let preflightSource: (String) async throws -> SourcePreflightResponse
    let preflightSourceWithMetadata: (String) async throws -> SourcePreflightResponse
    let onGenerate: (String) -> Void
    let screenshotAnalysisState: V2ScreenshotAnalysisState
    let onAnalyzeScreenshot: (Data) -> Void
    @State private var sourceText = ""
    @State private var validationMessage = ""
    @State private var screenshotLoadMessage = ""
    @State private var selectedScreenshotItem: PhotosPickerItem?
    @State private var preflightState = V2UploadPreflightState.idle
    @State private var preflightTask: Task<Void, Never>?

    private var trimmedSourceText: String {
        sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var parsedSourceInput: ChapterInput {
        ChapterInput.parse(trimmedSourceText)
    }

    private var preflightInputKey: String {
        parsedSourceInput.sourceUrl ?? trimmedSourceText
    }

    private var canStartGeneration: Bool {
        guard !isSubmittingGeneration, !trimmedSourceText.isEmpty else {
            return false
        }
        let parsed = parsedSourceInput
        guard parsed.validationError == nil else {
            return false
        }
        if let sourceUrl = parsed.sourceUrl, !sourceUrl.isEmpty {
            return preflightState.canGenerate(for: sourceUrl)
        }
        return parsed.canSubmit
    }

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "上传") {
            ZStack(alignment: .top) {
                V2UploadBackgroundDecorations()
                    .allowsHitTesting(false)

                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        V2Keyboard.dismiss()
                    }

                VStack(spacing: V2UploadPageMetrics.verticalSpacing) {
                    V2UploadMascotInputGroup(
                        urlText: $sourceText,
                        preflightState: preflightState,
                        input: preflightInputKey
                    )
                        .padding(.top, V2UploadPageMetrics.groupTopPadding)

                    PhotosPicker(
                        selection: $selectedScreenshotItem,
                        matching: .images,
                        photoLibrary: .shared()
                    ) {
                        HStack(spacing: 10) {
                            Image(systemName: "photo.badge.plus")
                            Text(screenshotButtonTitle)
                        }
                        .font(V2Typography.bodyEmphasis)
                        .foregroundStyle(V2Color.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 53)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(V2Color.surfaceCream)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(V2Color.borderSoftGreen, lineWidth: 1)
                                )
                        )
                    }
                    .disabled(screenshotAnalysisState.isBusy)
                    .accessibilityHint("选择 B站或抖音截图，交给 AI 生成一张记忆卡")

                    if let screenshotStatusText {
                        Text(screenshotStatusText)
                            .font(V2Typography.label)
                            .foregroundStyle(screenshotStatusIsError ? V2Color.feedbackWrongBorder : V2Color.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .multilineTextAlignment(.center)
                    }

                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(V2Color.borderSoftGreen)
                            .frame(height: 1)
                        Text("或粘贴链接 / 正文")
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textMuted)
                        Rectangle()
                            .fill(V2Color.borderSoftGreen)
                            .frame(height: 1)
                    }

                    V2PrimaryActionButton(
                        title: primaryActionTitle,
                        tone: canStartGeneration ? .normal : .disabled
                    ) {
                        guard canStartGeneration else {
                            handleBlockedGenerateTap()
                            return
                        }
                        let trimmed = trimmedSourceText
                        guard !trimmed.isEmpty else {
                            validationMessage = "请先粘贴文章链接或正文"
                            return
                        }
                        validationMessage = ""
                        Task {
                            await validateMetadataThenGenerate(trimmed)
                        }
                    }

                    if !validationMessage.isEmpty {
                        Text(validationMessage)
                            .font(V2Typography.label)
                            .foregroundStyle(V2Color.feedbackWrongBorder)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
            .frame(minHeight: V2UploadPageMetrics.contentHeight, alignment: .top)
            .onChange(of: sourceText) { newValue in
                schedulePreflight(for: newValue)
            }
            .onChange(of: selectedScreenshotItem) { item in
                guard let item else { return }
                screenshotLoadMessage = ""
                Task {
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self) else {
                            screenshotLoadMessage = "没有读取到图片，请重新选择。"
                            return
                        }
                        onAnalyzeScreenshot(data)
                    } catch {
                        screenshotLoadMessage = "读取图片失败，请重新选择。"
                    }
                    selectedScreenshotItem = nil
                }
            }
            .onDisappear {
                preflightTask?.cancel()
            }
        }
    }

    private var primaryActionTitle: String {
        if isSubmittingGeneration {
            return "正在提交"
        }
        if case .checkingMetadata(let input) = preflightState, input == preflightInputKey {
            return "正在确认"
        }
        return "开始生成"
    }

    private var screenshotButtonTitle: String {
        switch screenshotAnalysisState {
        case .preparing:
            "正在压缩截图"
        case .analyzing:
            "正在整理记忆卡"
        default:
            "从截图生成记忆卡"
        }
    }

    private var screenshotStatusText: String? {
        if !screenshotLoadMessage.isEmpty {
            return screenshotLoadMessage
        }
        switch screenshotAnalysisState {
        case .idle:
            return "MVP 现场主测 B站与抖音截图"
        case .preparing:
            return "正在为上传准备图片…"
        case .analyzing:
            return "AI 正在识别标题、核对来源并生成卡片…"
        case .generated(let message), .failed(let message):
            return message
        }
    }

    private var screenshotStatusIsError: Bool {
        if !screenshotLoadMessage.isEmpty { return true }
        if case .failed = screenshotAnalysisState { return true }
        return false
    }

    private func schedulePreflight(for value: String) {
        preflightTask?.cancel()
        validationMessage = ""
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            preflightState = .idle
            return
        }

        let parsed = ChapterInput.parse(trimmed)
        guard parsed.validationError == nil else {
            preflightState = .failed(input: trimmed, message: "这不是有效的链接。请粘贴 http 或 https 开头的链接。")
            return
        }
        guard let sourceUrl = parsed.sourceUrl, !sourceUrl.isEmpty else {
            preflightState = .idle
            return
        }

        preflightState = .checking(input: sourceUrl)
        preflightTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else {
                return
            }
            do {
                let response = try await preflightSource(sourceUrl)
                await MainActor.run {
                    guard preflightInputKey == sourceUrl else {
                        return
                    }
                    preflightState = response.canGenerate
                        ? .ready(input: sourceUrl, response: response)
                        : .blocked(input: sourceUrl, response: response)
                }
            } catch {
                await MainActor.run {
                    guard preflightInputKey == sourceUrl else {
                        return
                    }
                    preflightState = .failed(input: sourceUrl, message: "识别不到链接信息")
                }
            }
        }
    }

    private func handleBlockedGenerateTap() {
        let trimmed = trimmedSourceText
        guard !trimmed.isEmpty else {
            validationMessage = "请先粘贴文章链接或正文"
            return
        }

        let parsed = ChapterInput.parse(trimmed)
        if parsed.validationError != nil {
            validationMessage = "这不是有效的链接。请粘贴 http 或 https 开头的链接。"
            return
        }
        if let sourceUrl = parsed.sourceUrl, !sourceUrl.isEmpty {
            switch preflightState {
            case .blocked(let input, let response) where input == sourceUrl:
                validationMessage = response.userMessage
            case .failed(let input, let message) where input == sourceUrl:
                validationMessage = message
            case .checking:
                validationMessage = "正在读取链接信息，请稍等"
            case .checkingMetadata:
                validationMessage = "正在确认视频信息，请稍等"
            default:
                validationMessage = "请等待链接识别完成"
                schedulePreflight(for: trimmed)
            }
            return
        }

        validationMessage = "正文太短，至少需要 24 个字"
    }

    @MainActor
    private func validateMetadataThenGenerate(_ input: String) async {
        let parsed = ChapterInput.parse(input)
        guard parsed.sourceType == .videoLink, let sourceUrl = parsed.sourceUrl else {
            onGenerate(input)
            return
        }

        preflightTask?.cancel()
        preflightState = .checkingMetadata(input: sourceUrl)
        do {
            let response = try await preflightSourceWithMetadata(sourceUrl)
            guard preflightInputKey == sourceUrl else {
                return
            }
            if response.canGenerate {
                preflightState = .ready(input: sourceUrl, response: response)
                onGenerate(input)
            } else {
                preflightState = .blocked(input: sourceUrl, response: response)
                validationMessage = response.userMessage
            }
        } catch {
            guard preflightInputKey == sourceUrl else {
                return
            }
            preflightState = .failed(input: sourceUrl, message: "暂时无法读取视频信息，请稍后重试。")
            validationMessage = "暂时无法读取视频信息，请稍后重试。"
        }
    }
}

private enum V2UploadPreflightState: Equatable {
    case idle
    case checking(input: String)
    case checkingMetadata(input: String)
    case ready(input: String, response: SourcePreflightResponse)
    case blocked(input: String, response: SourcePreflightResponse)
    case failed(input: String, message: String)

    func canGenerate(for input: String) -> Bool {
        if case .ready(let checkedInput, let response) = self {
            return checkedInput == input && response.canGenerate
        }
        return false
    }

    func feedback(for input: String) -> V2UploadPreflightFeedback? {
        switch self {
        case .idle:
            return nil
        case .checking(let checkedInput) where checkedInput == input:
            return V2UploadPreflightFeedback(
                message: "正在识别内容类型",
                isError: false
            )
        case .checkingMetadata(let checkedInput) where checkedInput == input:
            return V2UploadPreflightFeedback(
                message: "正在确认视频标题和时长",
                isError: false
            )
        case .ready(let checkedInput, let response) where checkedInput == input:
            return V2UploadPreflightFeedback(
                message: "将根据\(Self.sourceBasisLabel(response))生成学习内容",
                isError: false
            )
        case .blocked(let checkedInput, let response) where checkedInput == input:
            return V2UploadPreflightFeedback(
                message: response.userMessage,
                isError: true
            )
        case .failed(let checkedInput, let message) where checkedInput == input:
            return V2UploadPreflightFeedback(
                message: message,
                isError: true
            )
        default:
            return nil
        }
    }

    private static func sourceBasisLabel(_ response: SourcePreflightResponse) -> String {
        switch response.sourceType {
        case "video_link":
            let platformLabel = response.platformLabel ?? "视频"
            return platformLabel.contains("视频") ? platformLabel : "\(platformLabel)视频"
        case "wechat_article":
            return "公众号文章"
        case "article_link":
            return "网页文章"
        default:
            return response.platformLabel ?? "当前链接"
        }
    }
}

private struct V2UploadPreflightFeedback: Equatable {
    let message: String
    let isError: Bool
}

private struct V2UploadPreflightStatusRow: View {
    let feedback: V2UploadPreflightFeedback

    var body: some View {
        Text(feedback.message)
            .font(V2UploadInputCardMetrics.feedbackFont)
            .foregroundStyle(feedback.isError ? V2Color.feedbackWrongBorder : V2UploadInputCardMetrics.feedbackColor)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(
                maxWidth: .infinity,
                alignment: .center
            )
            .multilineTextAlignment(.center)
            .padding(.horizontal, V2UploadInputCardMetrics.feedbackHorizontalPadding)
    }
}

private struct V2UploadMascotInputGroup: View {
    @Binding var urlText: String
    let preflightState: V2UploadPreflightState
    let input: String

    private var feedback: V2UploadPreflightFeedback? {
        preflightState.feedback(for: input)
    }

    private var cardHeight: CGFloat {
        V2UploadInputCardMetrics.cardHeight(hasFeedback: feedback != nil)
    }

    private var groupHeight: CGFloat {
        V2UploadMascotInputMetrics.groupHeight(cardHeight: cardHeight)
    }

    var body: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width, V2UploadMascotInputMetrics.maxWidth)

            ZStack(alignment: .top) {
                Image("V2UploadMascotBack")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: V2UploadMascotInputMetrics.backWidth)
                    .position(
                        x: width * V2UploadMascotInputMetrics.backCenterXRatio,
                        y: V2UploadMascotInputMetrics.backCenterY
                    )
                    .zIndex(0)

                V2UploadLinkInputCard(urlText: $urlText, feedback: feedback)
                    .frame(width: width, height: cardHeight)
                    .position(
                        x: width / 2,
                        y: V2UploadMascotInputMetrics.cardCenterY(cardHeight: cardHeight)
                    )
                    .zIndex(1)

                Image("V2UploadMascotFront")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: V2UploadMascotInputMetrics.frontWidth)
                    .position(
                        x: width * V2UploadMascotInputMetrics.frontCenterXRatio,
                        y: V2UploadMascotInputMetrics.frontCenterY
                    )
                    .zIndex(2)
            }
            .frame(width: width, height: groupHeight)
            .frame(maxWidth: .infinity)
        }
        .frame(height: groupHeight)
    }
}

private struct V2UploadLinkInputCard: View {
    @Binding var urlText: String
    let feedback: V2UploadPreflightFeedback?
    @FocusState private var isURLFieldFocused: Bool

    var body: some View {
        VStack(alignment: .center, spacing: V2UploadInputCardMetrics.titleToFieldSpacing) {
            Text("添加学习内容")
                .font(V2UploadInputCardMetrics.titleFont)
                .foregroundStyle(V2UploadInputCardMetrics.titleColor)
                .frame(maxWidth: .infinity)

            HStack(spacing: V2UploadInputCardMetrics.fieldContentSpacing) {
                Image("V2UploadLinkIcon")
                    .resizable()
                    .renderingMode(.original)
                    .frame(
                        width: V2UploadInputCardMetrics.linkIconSize,
                        height: V2UploadInputCardMetrics.linkIconSize
                    )

                TextField(text: $urlText) {
                    Text("粘贴文章或视频链接")
                        .font(V2UploadInputCardMetrics.placeholderFont)
                        .foregroundStyle(V2UploadInputCardMetrics.placeholderColor)
                }
                    .font(V2UploadInputCardMetrics.placeholderFont)
                    .foregroundStyle(V2UploadInputCardMetrics.inputTextColor)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.done)
                    .focused($isURLFieldFocused)
                    .onSubmit {
                        isURLFieldFocused = false
                    }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, V2UploadInputCardMetrics.fieldHorizontalPadding)
            .frame(height: V2UploadInputCardMetrics.fieldHeight)
            .background(
                RoundedRectangle(cornerRadius: V2UploadInputCardMetrics.fieldRadius, style: .continuous)
                    .fill(V2UploadInputCardMetrics.fieldFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: V2UploadInputCardMetrics.fieldRadius, style: .continuous)
                            .stroke(V2Color.borderSoftGreen.opacity(0.8), lineWidth: 1)
                    )
            )

            if let feedback {
                V2UploadPreflightStatusRow(feedback: feedback)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(V2UploadInputCardMetrics.outerPadding)
        .frame(maxWidth: .infinity)
        .frame(height: V2UploadInputCardMetrics.cardHeight(hasFeedback: feedback != nil))
        .background(
            RoundedRectangle(cornerRadius: V2UploadInputCardMetrics.cardRadius, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow()
        )
        .animation(.easeInOut(duration: 0.18), value: feedback)
    }
}

private struct V2UploadBackgroundDecorations: View {
    var body: some View {
        GeometryReader { proxy in
            Image("V2BgDecoLeftHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 114, height: 85)
                .position(x: 20, y: 134)
                .opacity(0.72)

            Image("V2BgDecoRightHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 105, height: 57)
                .position(x: proxy.size.width - 6, y: 128)
                .opacity(0.72)

            Image("V2BgDecoSmallPlantCluster")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 62, height: 56)
                .position(x: proxy.size.width - 2, y: 392)
                .opacity(0.72)
        }
    }
}

private enum V2UploadPageMetrics {
    static let groupTopPadding: CGFloat = 72
    static let baseCardToActionSpacing: CGFloat = 55
    static let verticalSpacing: CGFloat = baseCardToActionSpacing
    static let contentHeight: CGFloat = 600
}

private enum V2Keyboard {
    static func dismiss() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

private enum V2UploadMascotInputMetrics {
    static let maxWidth: CGFloat = 321
    static let backWidth: CGFloat = 94
    static let frontWidth: CGFloat = 69
    static let cardTop: CGFloat = 82
    static let backCenterXRatio: CGFloat = 0.808
    static let backCenterY: CGFloat = 84
    static let frontCenterXRatio: CGFloat = 0.796
    static let frontCenterY: CGFloat = 85

    static func groupHeight(cardHeight: CGFloat) -> CGFloat {
        cardTop + cardHeight
    }

    static func cardCenterY(cardHeight: CGFloat) -> CGFloat {
        cardTop + cardHeight / 2
    }
}

private enum V2UploadInputCardMetrics {
    static let baseCardHeight: CGFloat = 148
    static let expandedCardHeight: CGFloat = 178
    static let outerPadding: CGFloat = 18
    static let cardRadius: CGFloat = 20
    static let titleFont = Font.system(size: 16, weight: .regular)
    static let titleColor = V2Color.topTitle
    static let titleToFieldSpacing: CGFloat = 20
    static let fieldHeight: CGFloat = 55
    static let fieldRadius: CGFloat = 15
    static let fieldHorizontalPadding: CGFloat = 15
    static let fieldContentSpacing: CGFloat = 12
    static let linkIconSize: CGFloat = 34
    static let placeholderFont = Font.system(size: 12, weight: .regular)
    static let placeholderColor = Color(hex: 0xB7B7B7)
    static let inputTextColor = V2Color.topTitle
    static let fieldFill = Color(hex: 0xFFFBF6)
    static let feedbackFont = V2Typography.micro
    static let feedbackColor = V2Color.primary
    static let feedbackHorizontalPadding: CGFloat = fieldHorizontalPadding

    static func cardHeight(hasFeedback: Bool) -> CGFloat {
        hasFeedback ? expandedCardHeight : baseCardHeight
    }
}

struct V2DiscoverView: View {
    @Binding var selectedTab: V2HomeTab
    let filters: [V2RecommendedArticleFilter]
    let articles: [V2RecommendedArticleItem]
    let openArticle: (V2RecommendedArticleItem) -> Void
    @State private var selectedFilterID = "all"

    private var filteredArticles: [V2RecommendedArticleItem] {
        if selectedFilterID == "all" {
            return articles
        }
        return articles.filter { $0.tags.contains(selectedFilterID) }
    }

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "发现") {
            VStack(alignment: .leading, spacing: 20) {
                V2DiscoverHeroCard()

                V2DiscoverFilterBar(
                    filters: filters,
                    selectedFilterID: selectedFilterID,
                    onSelect: { filter in
                        selectedFilterID = filter.id
                    }
                )

                ForEach(filteredArticles) { article in
                    V2RecommendedArticleCard(
                        title: article.title,
                        source: article.source,
                        coverImageUrl: article.coverImageUrl,
                        tags: article.tags,
                        action: { openArticle(article) }
                    )
                }
            }
        }
    }
}

struct V2NotesView: View {
    @Binding var selectedTab: V2HomeTab
    let usesMockData: Bool
    let savedQuestions: [V2SavedQuestionDisplayItem]
    let onOpenSavedQuestion: (Int) -> Void
    let onOpenBackendSavedQuestion: (String) -> Void

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "笔记") {
            ZStack(alignment: .topLeading) {
                V2NotesBackgroundDecorations()
                    .zIndex(0)
                    .allowsHitTesting(false)

                V2NotesSummaryCard(count: savedQuestionCount)
                    .offset(y: V2NotesPageMetrics.summaryY)
                    .zIndex(2)

                Image("V2NotesMascot")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: V2NotesPageMetrics.mascotWidth, height: V2NotesPageMetrics.mascotHeight)
                    .offset(x: V2NotesPageMetrics.mascotX, y: V2NotesPageMetrics.mascotY)
                    .allowsHitTesting(false)
                    .zIndex(4)

                if usesMockData {
                    ForEach(Array(V2ReviewFixture.savedQuestions.enumerated()), id: \.element.id) { index, savedQuestion in
                        Button {
                            onOpenSavedQuestion(index)
                        } label: {
                            V2SavedQuestionCard(
                                title: savedQuestion.title,
                                source: savedQuestion.source,
                                type: savedQuestion.type
                            )
                        }
                        .buttonStyle(.plain)
                        .offset(y: V2NotesPageMetrics.cardY(for: index))
                        .zIndex(2)
                    }
                } else if !savedQuestions.isEmpty {
                    ForEach(Array(savedQuestions.enumerated()), id: \.element.id) { index, savedQuestion in
                        Button {
                            onOpenBackendSavedQuestion(savedQuestion.id)
                        } label: {
                            V2SavedQuestionCard(
                                title: savedQuestion.title,
                                source: savedQuestion.source,
                                type: savedQuestion.type
                            )
                        }
                        .buttonStyle(.plain)
                        .offset(y: V2NotesPageMetrics.cardY(for: index))
                        .zIndex(2)
                    }
                }
            }
            .frame(width: V2Layout.contentMaxWidth, height: V2NotesPageMetrics.contentHeight, alignment: .topLeading)
        }
    }

    private var savedQuestionCount: Int {
        usesMockData ? V2ReviewFixture.savedQuestions.count : savedQuestions.count
    }
}

private struct V2NotesBackgroundDecorations: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Image("V2BgDecoLeftHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: V2NotesPageMetrics.leftDecorationWidth)
                .offset(x: V2NotesPageMetrics.leftDecorationX, y: V2NotesPageMetrics.leftDecorationY)

            Image("V2BgDecoRightHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: V2NotesPageMetrics.rightTopDecorationWidth)
                .offset(x: V2NotesPageMetrics.rightTopDecorationX, y: V2NotesPageMetrics.rightTopDecorationY)

            Image("V2BgDecoSmallPlantCluster")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: V2NotesPageMetrics.rightMidDecorationWidth)
                .offset(x: V2NotesPageMetrics.rightMidDecorationX, y: V2NotesPageMetrics.rightMidDecorationY)
        }
        .opacity(V2NotesPageMetrics.decorationOpacity)
    }
}

private enum V2NotesPageMetrics {
    static let summaryY: CGFloat = 32
    static let mascotX: CGFloat = 206
    static let mascotY: CGFloat = -12
    static let mascotWidth: CGFloat = 94
    static let mascotHeight: CGFloat = 127
    static let firstCardY: CGFloat = 142
    static let cardGap: CGFloat = 19
    static let cardHeight: CGFloat = 136
    static let secondCardY: CGFloat = firstCardY + cardHeight + cardGap
    static let thirdCardY: CGFloat = secondCardY + cardHeight + cardGap
    static let contentHeight: CGFloat = thirdCardY + cardHeight + 24
    static func cardY(for index: Int) -> CGFloat {
        firstCardY + CGFloat(index) * (cardHeight + cardGap)
    }
    static let decorationOpacity: Double = 0.66
    static let leftDecorationWidth: CGFloat = 113
    static let leftDecorationX: CGFloat = -62
    static let leftDecorationY: CGFloat = 298
    static let rightTopDecorationWidth: CGFloat = 104
    static let rightTopDecorationX: CGFloat = 246
    static let rightTopDecorationY: CGFloat = 82
    static let rightMidDecorationWidth: CGFloat = 62
    static let rightMidDecorationX: CGFloat = 290
    static let rightMidDecorationY: CGFloat = 360
}

struct V2NotificationView: View {
    let usesMockData: Bool
    let notifications: [NotificationItem]
    let onBack: () -> Void
    let onOpenSuccess: (NotificationItem) -> Void
    let onOpenFailure: (NotificationItem) -> Void

    var body: some View {
        V2FlowScreen(
            title: "通知",
            onBack: onBack
        ) {
            V2NotificationScreenContent(
                unreadCount: unreadCount,
                notifications: displayNotifications,
                onOpenSuccess: onOpenSuccess,
                onOpenFailure: onOpenFailure
            )
        }
    }

    private var displayNotifications: [NotificationItem] {
        if usesMockData {
            return [
                NotificationItem(
                    id: "v2-mock-notification-success",
                    chapterId: "v2-mock-chapter",
                    type: .generationCompleted,
                    title: "章节已生成",
                    body: "《如何把AI Agent用到你的生意经》已准备好，可以开始学习",
                    read: false,
                    dismissed: false,
                    createdAt: ""
                ),
                NotificationItem(
                    id: "v2-mock-notification-failure",
                    chapterId: "v2-mock-chapter",
                    type: .generationFailed,
                    title: "生成失败",
                    body: "章节生成失败，点击查看具体原因",
                    read: false,
                    dismissed: false,
                    createdAt: ""
                )
            ]
        }
        return notifications.filter { !$0.dismissed }
    }

    private var unreadCount: Int {
        displayNotifications.filter { !$0.read }.count
    }

}

private struct V2NotificationScreenContent: View {
    let unreadCount: Int
    let notifications: [NotificationItem]
    let onOpenSuccess: (NotificationItem) -> Void
    let onOpenFailure: (NotificationItem) -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                V2NotificationDecorations(width: geometry.size.width)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .allowsHitTesting(false)
                    .zIndex(0)

                V2NotificationList(
                    unreadCount: unreadCount,
                    notifications: notifications,
                    onOpenSuccess: onOpenSuccess,
                    onOpenFailure: onOpenFailure
                )
                .frame(width: V2Layout.contentMaxWidth)
                .padding(.top, V2NotificationLayout.listTop)
                .zIndex(3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(height: V2NotificationLayout.screenHeight)
    }
}

private enum V2NotificationLayout {
    static let screenHeight: CGFloat = 760
    static let listTop: CGFloat = 36
    static let summaryHeight: CGFloat = 82
    static let cardHeight: CGFloat = 116
    static let verticalGap: CGFloat = 22
}

private struct V2NotificationList: View {
    let unreadCount: Int
    let notifications: [NotificationItem]
    let onOpenSuccess: (NotificationItem) -> Void
    let onOpenFailure: (NotificationItem) -> Void

    var body: some View {
        VStack(spacing: 22) {
            V2NotificationSummaryBanner(unreadCount: unreadCount)
            notificationCards
        }
    }

    @ViewBuilder
    private var notificationCards: some View {
        ForEach(notifications) { notification in
            V2NotificationRow(
                notification: notification,
                action: { action(for: notification)(notification) }
            )
        }
    }

    private func action(for notification: NotificationItem) -> (NotificationItem) -> Void {
        switch notification.type {
        case .generationCompleted:
            return onOpenSuccess
        case .generationFailed:
            return onOpenFailure
        }
    }
}

private struct V2NotificationRow: View {
    let notification: NotificationItem
    let action: () -> Void

    var body: some View {
        V2NotificationCard(
            title: notification.title,
            message: notification.body,
            isSuccess: notification.type == .generationCompleted,
            action: action
        )
    }
}

private struct V2NotificationDecorations: View {
    let width: CGFloat

    var body: some View {
        ZStack(alignment: .topLeading) {
            decoration(
                name: "V2BgDecoLeftHillPlant",
                width: 109,
                x: -8,
                y: 222
            )

            decoration(
                name: "V2BgDecoLeftHillPlant",
                width: 109,
                x: -6,
                y: 588
            )

            decoration(
                name: "V2BgDecoRightHillPlant",
                width: 104,
                x: 98,
                y: 213
            )

            decoration(
                name: "V2BgDecoSmallPlantCluster",
                width: 60,
                x: width - 53,
                y: 427
            )
        }
    }

    private func decoration(
        name: String,
        width: CGFloat,
        x: CGFloat,
        y: CGFloat
    ) -> some View {
        Image(name)
            .resizable()
            .renderingMode(.original)
            .scaledToFit()
            .frame(width: width)
            .opacity(0.74)
            .offset(x: x, y: y)
            .allowsHitTesting(false)
            .zIndex(0)
    }
}

struct V2GenerationFailureDetailView: View {
    var title = "章节详情"
    var failureReason = "当前链接正文提取失败，可能是网页暂时无法访问，或正文格式还不支持。"
    let onBack: () -> Void
    let onSource: () -> Void
    let onDelete: () -> Void

    var body: some View {
        V2FlowScreen(
            title: title,
            onBack: onBack
        ) {
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    failureDetailDecorations(in: geometry.size)

                    Image("V2NotificationFailureDetailMascot")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(
                            width: V2GenerationFailureDetailMetrics.mascotWidth,
                            height: V2GenerationFailureDetailMetrics.mascotHeight
                        )
                        .position(
                            x: geometry.size.width / 2 + V2GenerationFailureDetailMetrics.mascotCenterXOffset,
                            y: V2GenerationFailureDetailMetrics.mascotCenterY
                        )
                        .zIndex(1)

                    V2GenerationFailureDetailCard(
                        failureReason: failureReason,
                        onSource: onSource,
                        onDelete: onDelete
                    )
                        .position(x: geometry.size.width / 2, y: 402)
                        .zIndex(2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(height: 760)
        }
    }

    @ViewBuilder
    private func failureDetailDecorations(in size: CGSize) -> some View {
        Image("V2BgDecoSmallPlantCluster")
            .resizable()
            .renderingMode(.original)
            .scaledToFit()
            .frame(width: 60)
            .opacity(0.72)
            .offset(x: size.width - 52, y: 420)
            .allowsHitTesting(false)

        Image("V2BgDecoLeftHillPlant")
            .resizable()
            .renderingMode(.original)
            .scaledToFit()
            .frame(width: 109)
            .opacity(0.66)
            .offset(x: -6, y: 500)
            .allowsHitTesting(false)
    }
}

private enum V2GenerationFailureDetailMetrics {
    static let mascotWidth: CGFloat = 188
    static let mascotHeight: CGFloat = 207
    static let mascotCenterXOffset: CGFloat = 3
    static let mascotCenterY: CGFloat = 136
}

private struct V2GenerationFailureDetailCard: View {
    let failureReason: String
    let onSource: () -> Void
    let onDelete: () -> Void

    private let failureAccent = Color(hex: 0xF69582)
    private let failureTitle = V2Color.topTitle
    private let failureBody = Color(hex: 0x69655F)
    private let failureAccentShadow = V2ShadowSpec(
        color: Color(hex: 0xF69582).opacity(0.2),
        radius: 2,
        x: 0,
        y: 4
    )

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow()

            HStack(spacing: 0) {
                HStack(spacing: V2GenerationStatusCardMetrics.headerTitleSpacing) {
                    Image("V2NotificationFailureDetailIcon")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(
                            width: V2GenerationStatusCardMetrics.iconSize,
                            height: V2GenerationStatusCardMetrics.iconSize
                        )

                    Text("章节生成失败")
                        .font(V2Typography.cardTitleStandard)
                        .foregroundStyle(failureTitle)
                        .lineLimit(1)
                }

                Spacer(minLength: V2GenerationStatusCardMetrics.headerMinimumGap)

                V2NotificationFailureSourceButton(
                    accent: failureAccent,
                    shadow: failureAccentShadow,
                    action: onSource
                )
            }
            .frame(
                width: V2GenerationStatusCardMetrics.contentWidth,
                height: V2GenerationStatusCardMetrics.headerHeight,
                alignment: .leading
            )
            .offset(
                x: V2GenerationStatusCardMetrics.contentX,
                y: V2GenerationStatusCardMetrics.headerY
            )

            V2NotificationFailureReasonCard(reason: failureReason)
                .offset(
                    x: V2GenerationStatusCardMetrics.contentX,
                    y: V2GenerationStatusCardMetrics.failureReasonY
                )

            Button(action: onDelete) {
                Text("删除章节")
                    .font(V2Typography.primaryButton)
                    .foregroundStyle(.white)
                    .frame(
                        width: V2GenerationStatusCardMetrics.contentWidth,
                        height: V2GenerationStatusCardMetrics.primaryButtonHeight
                    )
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(failureAccent)
                            .v2Shadow(failureAccentShadow)
                    )
            }
            .buttonStyle(.plain)
            .offset(
                x: V2GenerationStatusCardMetrics.contentX,
                y: V2GenerationStatusCardMetrics.primaryButtonY
            )
        }
        .frame(
            width: V2GenerationStatusCardMetrics.cardWidth,
            height: V2GenerationStatusCardMetrics.cardHeight
        )
    }
}

private struct V2NotificationFailureSourceButton: View {
    let accent: Color
    let shadow: V2ShadowSpec
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(accent)
                        .frame(width: 23, height: 23)

                    V2FailureSourceLinkGlyph()
                        .stroke(
                            V2Color.surfaceCream,
                            style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round)
                        )
                        .frame(width: 12, height: 12)
                }
                .frame(width: 34, height: 34)

                Text("查看原文")
                    .font(V2Typography.labelRegular)
                    .foregroundStyle(Color(hex: 0x767676))
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(width: V2GenerationStatusCardMetrics.sourceChipWidth, alignment: .leading)
            .frame(minHeight: V2GenerationStatusCardMetrics.sourceChipHeight, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(V2Color.surfaceCream)
                    .v2Shadow(shadow)
            )
            .frame(
                width: V2GenerationStatusCardMetrics.sourceChipWidth,
                height: V2GenerationStatusCardMetrics.sourceChipHeight,
                alignment: .topLeading
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("查看原文")
    }
}

private struct V2FailureSourceLinkGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 12
        let sy = rect.height / 12

        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x * sx, y: y * sy)
        }

        var path = Path()
        path.move(to: p(4.36, 7.20))
        path.addLine(to: p(7.33, 3.93))
        path.move(to: p(3.10, 5.31))
        path.addLine(to: p(1.99, 6.53))
        path.addCurve(to: p(2.13, 9.65), control1: p(1.17, 7.43), control2: p(1.23, 8.83))
        path.addCurve(to: p(5.25, 9.50), control1: p(3.04, 10.47), control2: p(4.43, 10.40))
        path.addLine(to: p(6.37, 8.28))
        path.move(to: p(5.33, 2.86))
        path.addLine(to: p(6.44, 1.63))
        path.addCurve(to: p(9.56, 1.49), control1: p(7.27, 0.73), control2: p(8.66, 0.66))
        path.addCurve(to: p(9.71, 4.60), control1: p(10.47, 2.31), control2: p(10.53, 3.71))
        path.addLine(to: p(8.60, 5.83))

        return path
    }
}

private struct V2NotificationFailureReasonCard: View {
    let reason: String

    private let failureAccent = Color(hex: 0xF69582)
    private let failureTitle = V2Color.topTitle
    private let failureBody = Color(hex: 0x69655F)
    private let failureAccentShadow = V2ShadowSpec(
        color: Color(hex: 0xF69582).opacity(0.2),
        radius: 2,
        x: 0,
        y: 4
    )

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow(failureAccentShadow)

            Image("V2NotificationFailureReasonIcon")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 23, height: 24)
                .position(x: 28, y: 32)

            Circle()
                .fill(failureAccent)
                .frame(width: 5, height: 5)
                .position(x: 28.5, y: 59)

            VStack(alignment: .leading, spacing: 8) {
                Text("失败原因")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(failureTitle)

                Text(reason)
                    .font(V2Typography.labelRegular)
                    .foregroundStyle(failureBody)
                    .lineSpacing(5)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 204, alignment: .leading)
            .padding(.leading, 55)
            .padding(.top, 23)
        }
        .frame(width: 280, height: 95)
    }
}

struct V2ProfileView: View {
    @AppStorage("v2.profileAvatarImageData")
    private var profileAvatarImageData = Data()
    @AppStorage("v2.profilePresetAvatarName")
    private var profilePresetAvatarName = ""
    @AppStorage("v2.profileDisplayName")
    private var profileDisplayName = "Cappy"

    @Binding var usesMockData: Bool
    let allowsMockDataToggle: Bool
    let reviewedCount: String
    let streakDays: String
    let account: AccountSnapshot?
    let isAccountLoading: Bool
    let accountMessage: String
    let onSignInWithApple: (Data?, Data?) async -> Void
    let onDeleteAccount: () async -> Void
    let onBack: () -> Void

    var body: some View {
        V2FlowScreen(title: "我的", onBack: onBack) {
            ZStack {
                GeometryReader { geometry in
                    Image("V2BgDecoLeftHillPlant")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(width: 108)
                        .opacity(0.66)
                        .position(x: 38, y: 323)

                    Image("V2BgDecoLeftHillPlant")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(width: 105)
                        .opacity(0.66)
                        .position(x: 52, y: max(438, geometry.size.height - 242))
                }
                .allowsHitTesting(false)

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        V2ProfileHeaderCard(
                            name: $profileDisplayName,
                            reviewedCount: reviewedCount,
                            streakDays: streakDays,
                            avatarImageData: $profileAvatarImageData,
                            selectedPresetAvatarName: $profilePresetAvatarName
                        )

                        V2ProfileSettingsCard(
                            account: account,
                            isAccountLoading: isAccountLoading,
                            accountMessage: accountMessage,
                            onSignInWithApple: onSignInWithApple,
                            onDeleteAccount: onDeleteAccount
                        )

                        if allowsMockDataToggle {
                            V2RuntimeModeCard(usesMockData: $usesMockData)
                        }
                    }
                    .frame(maxWidth: V2Layout.contentMaxWidth)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
                    .padding(.bottom, 40)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct V2ProfileTabView: View {
    @AppStorage("v2.profileAvatarImageData")
    private var profileAvatarImageData = Data()
    @AppStorage("v2.profilePresetAvatarName")
    private var profilePresetAvatarName = ""
    @AppStorage("v2.profileDisplayName")
    private var profileDisplayName = "Cappy"

    @Binding var selectedTab: V2HomeTab
    @Binding var usesMockData: Bool
    let allowsMockDataToggle: Bool
    let reviewedCount: String
    let streakDays: String
    let account: AccountSnapshot?
    let isAccountLoading: Bool
    let accountMessage: String
    let onSignInWithApple: (Data?, Data?) async -> Void
    let onDeleteAccount: () async -> Void

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "我的") {
            VStack(spacing: 20) {
                V2ProfileHeaderCard(
                    name: $profileDisplayName,
                    reviewedCount: reviewedCount,
                    streakDays: streakDays,
                    avatarImageData: $profileAvatarImageData,
                    selectedPresetAvatarName: $profilePresetAvatarName
                )

                V2ProfileSettingsCard(
                    account: account,
                    isAccountLoading: isAccountLoading,
                    accountMessage: accountMessage,
                    onSignInWithApple: onSignInWithApple,
                    onDeleteAccount: onDeleteAccount
                )

                if allowsMockDataToggle {
                    V2RuntimeModeCard(usesMockData: $usesMockData)
                }
            }
        }
    }
}

private struct V2RuntimeModeCard: View {
    @Binding var usesMockData: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("演示数据")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(V2Color.topTitle)

                    Text(usesMockData ? "正在展示组件库 mock 数据" : "正在使用真实测试数据")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(Color(hex: 0x8B8B8B))
                }

                Spacer()

                Toggle("", isOn: $usesMockData)
                    .labelsHidden()
                    .tint(V2Color.primaryAction)
            }

            Text("关闭后，主页、全部章节、通知和笔记不会再自动塞入 fixture；只有真实生成或真实保存的数据会出现。")
                .font(V2Typography.caption)
                .foregroundStyle(Color(hex: 0x9A9A9A))
                .lineSpacing(3)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(width: V2Layout.contentMaxWidth, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow()
        )
    }
}
