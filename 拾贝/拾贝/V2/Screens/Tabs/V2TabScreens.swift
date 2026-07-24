import PhotosUI
import SwiftUI
import UIKit

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
    let openGeneratingChapter: (String?) -> Void
    let openChapter: (String) -> Void

    var body: some View {
        V2TabScaffold(selectedTab: $selectedTab, title: "全部章节") {
            VStack(spacing: 16) {
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

                if usesMockData {
                    Button {
                        openChapter("v2-fixture")
                    } label: {
                        V2ChapterCard(
                            title: V2ReviewFixture.chapter.title,
                            status: .reviewing,
                            source: "网页文章",
                            knowledgeCount: V2ReviewFixture.chapter.units.count,
                            questionCount: V2ReviewFixture.chapter.units.reduce(0) { $0 + $1.questions.count }
                        )
                    }
                    .buttonStyle(.plain)

                    Button {
                        openChapter("v2-fixture")
                    } label: {
                        V2ChapterCard(
                            title: "Claude Code hooks：把自动化放进工作流",
                            status: .notStarted,
                            source: "网页文章",
                            knowledgeCount: 7,
                            questionCount: 21
                        )
                    }
                    .buttonStyle(.plain)

                    Button {
                        openChapter("v2-fixture")
                    } label: {
                        V2ChapterCard(
                            title: "游戏化设计如何改善学习体验",
                            status: .completed,
                            source: "网页文章",
                            knowledgeCount: 6,
                            questionCount: 18
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func listStatus(for chapter: V2BackendChapter) -> V2ChapterReviewStatus {
        chapter.v2ListStatus(hasCompletedReviewOnce: completedChapterIDs.contains(chapter.id) || chapter.hasCompletedV2ReviewOnce)
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
    let onScreenshotFlow: (UIImage, (ImageFlowProgress) -> Void) async throws -> ImageFlowResponse
    let onScreenshotCompleted: (ImageFlowResponse) -> Void
    @State private var sourceText = ""
    @State private var validationMessage = ""
    @State private var preflightState = V2UploadPreflightState.idle
    @State private var preflightTask: Task<Void, Never>?
    @State private var selectedScreenshotItem: PhotosPickerItem?
    @State private var selectedScreenshot: UIImage?
    @State private var isScreenshotProcessing = false
    @State private var screenshotStatusText = ""

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
        guard !isSubmittingGeneration, !isScreenshotProcessing, !trimmedSourceText.isEmpty else {
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
                    screenshotUploadCard

                    V2UploadMascotInputGroup(
                        urlText: $sourceText,
                        preflightState: preflightState,
                        input: preflightInputKey
                    )
                        .padding(.top, V2UploadPageMetrics.groupTopPadding)

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
            .onDisappear {
                preflightTask?.cancel()
            }
        }
    }

    private var screenshotUploadCard: some View {
        V2InfoCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(V2Color.primaryAction)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("截图生成复习卡")
                            .font(V2Typography.bodyEmphasis)
                            .foregroundStyle(V2Color.textPrimary)
                        Text("支持抖音、小红书、B站等内容页截图")
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textMuted)
                    }
                }

                if let selectedScreenshot {
                    Image(uiImage: selectedScreenshot)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 190)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                PhotosPicker(selection: $selectedScreenshotItem, matching: .images) {
                    Label(selectedScreenshot == nil ? "选择截图" : "更换截图", systemImage: "photo.on.rectangle")
                        .font(V2Typography.bodySmallEmphasis)
                        .foregroundStyle(V2Color.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(V2Color.pageGreenBackground.opacity(0.72))
                        )
                }
                .buttonStyle(.plain)
                .disabled(isScreenshotProcessing)
                .onChange(of: selectedScreenshotItem) { item in
                    loadScreenshot(item)
                }

                if selectedScreenshot != nil {
                    V2PrimaryActionButton(
                        title: isScreenshotProcessing ? "正在整理" : "开始整理截图",
                        tone: isScreenshotProcessing ? .disabled : .normal,
                        height: 46
                    ) {
                        startScreenshotFlow()
                    }
                }

                if !screenshotStatusText.isEmpty {
                    HStack(spacing: 8) {
                        if isScreenshotProcessing {
                            ProgressView()
                                .controlSize(.small)
                                .tint(V2Color.primaryAction)
                        }
                        Text(screenshotStatusText)
                            .font(V2Typography.label)
                            .foregroundStyle(isScreenshotProcessing ? V2Color.textSecondary : V2Color.feedbackWrongBorder)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func loadScreenshot(_ item: PhotosPickerItem?) {
        screenshotStatusText = ""
        guard let item else {
            selectedScreenshot = nil
            return
        }
        Task {
            do {
                guard let data = try await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data) else {
                    throw ImageOCRError.invalidImage
                }
                await MainActor.run {
                    selectedScreenshot = image
                }
            } catch {
                await MainActor.run {
                    selectedScreenshot = nil
                    screenshotStatusText = "无法读取这张图片，请重新选择。"
                }
            }
        }
    }

    private func startScreenshotFlow() {
        guard let selectedScreenshot, !isScreenshotProcessing else {
            return
        }
        isScreenshotProcessing = true
        screenshotStatusText = "正在识别截图"
        validationMessage = ""

        Task {
            do {
                let response = try await onScreenshotFlow(selectedScreenshot) { progress in
                    Task { @MainActor in
                        screenshotStatusText = progress.message ?? "正在整理截图"
                    }
                }
                await MainActor.run {
                    isScreenshotProcessing = false
                    guard response.status == "completed", response.review?.units?.isEmpty == false else {
                        screenshotStatusText = response.error?.message
                            ?? response.message
                            ?? "没有生成可用的复习卡，请换一张更清晰的截图。"
                        return
                    }
                    screenshotStatusText = "复习卡已生成"
                    onScreenshotCompleted(response)
                }
            } catch {
                await MainActor.run {
                    isScreenshotProcessing = false
                    screenshotStatusText = error.localizedDescription.isEmpty
                        ? "截图处理失败，请稍后重试。"
                        : error.localizedDescription
                }
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
