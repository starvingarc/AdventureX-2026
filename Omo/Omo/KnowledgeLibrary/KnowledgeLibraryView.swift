import SwiftUI
import UIKit

struct KnowledgeLibraryView: View {
    let cards: [MemoryCard]
    let screenshotJobs: [ScreenshotJob]
    let onBack: () -> Void
    let onAdd: () -> Void
    let onRetryJob: (ScreenshotJob) -> Void
    let onOpenCard: (MemoryCard) -> Void

    @StateObject private var model: KnowledgeLibraryViewModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appliedInitialQuery = false

    @MainActor
    init(
        cards: [MemoryCard],
        screenshotJobs: [ScreenshotJob] = [],
        onBack: @escaping () -> Void,
        onAdd: @escaping () -> Void,
        onRetryJob: @escaping (ScreenshotJob) -> Void = { _ in },
        onOpenCard: @escaping (MemoryCard) -> Void
    ) {
        self.init(
            cards: cards,
            screenshotJobs: screenshotJobs,
            searcher: KnowledgeLibraryDependencies.makeSearcher(),
            speechTranscriber: KnowledgeLibraryDependencies.makeSpeechTranscriber(),
            onBack: onBack,
            onAdd: onAdd,
            onRetryJob: onRetryJob,
            onOpenCard: onOpenCard
        )
    }

    @MainActor
    init(
        cards: [MemoryCard],
        screenshotJobs: [ScreenshotJob] = [],
        searcher: any KnowledgeLibrarySearching,
        speechTranscriber: any KnowledgeLibrarySpeechTranscribing,
        onBack: @escaping () -> Void,
        onAdd: @escaping () -> Void,
        onRetryJob: @escaping (ScreenshotJob) -> Void = { _ in },
        onOpenCard: @escaping (MemoryCard) -> Void
    ) {
        self.cards = cards
        self.screenshotJobs = screenshotJobs
        self.onBack = onBack
        self.onAdd = onAdd
        self.onRetryJob = onRetryJob
        self.onOpenCard = onOpenCard
        _model = StateObject(
            wrappedValue: KnowledgeLibraryViewModel(
                cards: cards,
                searcher: searcher,
                speechTranscriber: speechTranscriber
            )
        )
    }

    var body: some View {
        GeometryReader { geometry in
            let scale = KnowledgeLibraryMetrics.scale(for: geometry.size)
            let canvasSize = CGSize(
                width: KnowledgeLibraryMetrics.referenceSize.width * scale,
                height: KnowledgeLibraryMetrics.referenceSize.height * scale
            )
            ZStack {
                RecallPalette.background.ignoresSafeArea()
                referenceCanvas
                    .frame(
                        width: KnowledgeLibraryMetrics.referenceSize.width,
                        height: KnowledgeLibraryMetrics.referenceSize.height,
                        alignment: .topLeading
                    )
                    .scaleEffect(scale)
                    .frame(width: canvasSize.width, height: canvasSize.height)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .ignoresSafeArea()
        .onChange(of: cards) { _, newCards in model.updateCards(newCards) }
        .task {
            guard !appliedInitialQuery, let initialQuery = KnowledgeLibraryDependencies.initialQuery else { return }
            appliedInitialQuery = true
            model.query = initialQuery
            model.submit()
        }
        .onDisappear { model.onDisappear() }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: model.state)
    }

    private var referenceCanvas: some View {
        ZStack(alignment: .topLeading) {
            KnowledgeLibraryPanelShape()
                .fill(RecallPalette.panel)
                .frame(
                    width: KnowledgeLibraryMetrics.panelFrame.width,
                    height: KnowledgeLibraryMetrics.panelFrame.height
                )
                .position(
                    x: KnowledgeLibraryMetrics.panelFrame.midX,
                    y: KnowledgeLibraryMetrics.panelFrame.midY
                )
                .accessibilityHidden(true)

            Button(action: onBack) {
                Image("KnowledgeLibraryBack")
                    .resizable()
                    .frame(
                        width: KnowledgeLibraryMetrics.backFrame.width,
                        height: KnowledgeLibraryMetrics.backFrame.height
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .position(
                x: KnowledgeLibraryMetrics.backFrame.midX,
                y: KnowledgeLibraryMetrics.backFrame.midY
            )
            .accessibilityLabel("返回首页")

            Image("OmoPoseStretch")
                .resizable()
                .scaledToFit()
                .frame(
                    width: KnowledgeLibraryMetrics.mascotFrame.width,
                    height: KnowledgeLibraryMetrics.mascotFrame.height
                )
                .position(
                    x: KnowledgeLibraryMetrics.mascotFrame.midX,
                    y: KnowledgeLibraryMetrics.mascotFrame.midY
                )
                .accessibilityHidden(true)

            KnowledgeLibrarySearchBar(model: model, isDisabled: cards.isEmpty)
                .frame(
                    width: KnowledgeLibraryMetrics.searchFrame.width,
                    height: KnowledgeLibraryMetrics.searchFrame.height
                )
                .position(
                    x: KnowledgeLibraryMetrics.searchFrame.midX,
                    y: KnowledgeLibraryMetrics.searchFrame.midY
                )
                .zIndex(4)

            content
                .frame(
                    width: KnowledgeLibraryMetrics.pagerFrame.width,
                    height: KnowledgeLibraryMetrics.pagerFrame.height
                )
                .position(
                    x: KnowledgeLibraryMetrics.pagerFrame.midX,
                    y: KnowledgeLibraryMetrics.pagerFrame.midY
                )

            Image("FirstLaunchFolder")
                .resizable()
                .scaledToFit()
                .frame(
                    width: KnowledgeLibraryMetrics.folderFrame.width,
                    height: KnowledgeLibraryMetrics.folderFrame.height
                )
                .position(
                    x: KnowledgeLibraryMetrics.folderFrame.midX,
                    y: KnowledgeLibraryMetrics.folderFrame.midY
                )
                .accessibilityHidden(true)

            Button(action: onAdd) {
                Image("FirstLaunchUpload")
                    .resizable()
                    .frame(
                        width: KnowledgeLibraryMetrics.uploadFrame.width,
                        height: KnowledgeLibraryMetrics.uploadFrame.height
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .position(
                x: KnowledgeLibraryMetrics.uploadFrame.midX,
                y: KnowledgeLibraryMetrics.uploadFrame.midY
            )
            .accessibilityLabel("上传新的知识截屏")
            .accessibilityHint("打开截图上传流程")
        }
    }

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .top) {
            Group {
                if cards.isEmpty {
                    KnowledgeLibraryStateView(
                        title: screenshotJobs.contains(where: \.isActive)
                            ? "第一张知识卡正在整理"
                            : "还没有知识卡",
                        message: screenshotJobs.contains(where: \.isActive)
                            ? "你可以继续上传，处理完成后卡片会出现在这里。"
                            : "从相册选择一张有价值的截图，哦莫会替你整理好。",
                        actionTitle: "继续上传截图",
                        action: onAdd
                    )
                } else {
                    libraryCardsContent
                }
            }

            if let failed = screenshotJobs.first(where: { $0.canRetry }) {
                KnowledgeLibraryJobBanner(
                    title: "一张截图整理失败",
                    showsProgress: false,
                    actionTitle: "重试",
                    action: { onRetryJob(failed) }
                )
            } else if !screenshotJobs.filter(\.isActive).isEmpty {
                KnowledgeLibraryJobBanner(
                    title: "正在整理 \(screenshotJobs.filter(\.isActive).count) 张截图",
                    showsProgress: true,
                    actionTitle: nil,
                    action: {}
                )
            }
        }
    }

    @ViewBuilder
    private var libraryCardsContent: some View {
        switch model.state {
        case .all, .results:
            KnowledgeLibraryPager(
                cards: model.visibleCards,
                currentPage: $model.currentPage,
                onOpenCard: onOpenCard
            )
        case .searching:
            VStack(spacing: 14) {
                ProgressView().tint(RecallPalette.teal)
                Text("正在帮你找")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(RecallPalette.teal)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("正在搜索知识库")
        case .noResults:
            KnowledgeLibraryStateView(
                title: "没有找到相关卡片",
                message: "换一种描述，或者先回到全部卡片看看。",
                actionTitle: "查看全部",
                action: model.clearQuery
            )
        case .failed(let message):
            KnowledgeLibraryStateView(
                title: "这次没找到",
                message: message,
                actionTitle: "重试",
                action: model.retry
            )
        }
    }
}

private struct KnowledgeLibraryJobBanner: View {
    let title: String
    let showsProgress: Bool
    let actionTitle: String?
    let action: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if showsProgress {
                ProgressView().tint(RecallPalette.teal)
            }
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(RecallPalette.teal)
                .lineLimit(1)
            if let actionTitle {
                Button(actionTitle, action: action)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(RecallPalette.coral)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, actionTitle == nil ? 14 : 4)
        .frame(minHeight: 44)
        .background(RecallPalette.drawer, in: Capsule())
        .overlay(Capsule().stroke(RecallPalette.teal.opacity(0.45), lineWidth: 1))
        .shadow(color: RecallPalette.ink.opacity(0.12), radius: 4, y: 3)
        .padding(.top, 4)
    }
}

private struct KnowledgeLibrarySearchBar: View {
    @ObservedObject var model: KnowledgeLibraryViewModel
    let isDisabled: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var isFocused: Bool
    @State private var microphonePulse = false
    @ScaledMetric(relativeTo: .body) private var searchFontSize: CGFloat = 14

    private var isSearching: Bool { model.state == .searching }
    private var canSubmit: Bool {
        !isDisabled
            && !isSearching
            && !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(spacing: 5) {
            TextField("描述你想找的知识", text: $model.query)
                .font(.system(size: searchFontSize, weight: .medium))
                .foregroundStyle(RecallPalette.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(false)
                .submitLabel(.search)
                .focused($isFocused)
                .disabled(isDisabled || isSearching)
                .onSubmit { if canSubmit { model.submit() } }
                .accessibilityLabel("知识库搜索")
                .accessibilityHint("描述你想找的知识，然后提交搜索")

            if !model.query.isEmpty && !isSearching {
                Button {
                    model.clearQuery()
                    isFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(RecallPalette.teal.opacity(0.62))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除搜索")
            }

            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                Task { await model.startOrStopVoice() }
            } label: {
                Image("KnowledgeLibraryMicrophone")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(model.speechState == .listening ? RecallPalette.coral : RecallPalette.teal)
                    .frame(width: 32, height: 24)
                    .scaleEffect(model.speechState == .listening && microphonePulse && !reduceMotion ? 1.12 : 1)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isDisabled || isSearching)
            .accessibilityLabel(model.speechState == .listening ? "停止语音输入" : "使用语音输入")
            .accessibilityHint(speechHint)
            .onChange(of: model.speechState) { _, state in
                guard state == .listening, !reduceMotion else {
                    microphonePulse = false
                    return
                }
                withAnimation(.easeInOut(duration: 0.62).repeatForever(autoreverses: true)) {
                    microphonePulse = true
                }
            }

            Button {
                isFocused = false
                model.submit()
            } label: {
                Group {
                    if isSearching {
                        ProgressView()
                            .controlSize(.small)
                            .tint(RecallPalette.teal)
                    } else {
                        Text("帮我找")
                            .font(.system(size: 12, weight: .semibold))
                    }
                }
                .foregroundStyle(RecallPalette.teal)
                .frame(width: 68, height: 44)
                .background(RecallPalette.teal.opacity(canSubmit ? 0.16 : 0.09), in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
            .accessibilityLabel(isSearching ? "正在搜索" : "帮我找")
        }
        .padding(.leading, 18)
        .padding(.trailing, 10)
        .background(RecallPalette.drawer, in: RoundedRectangle(cornerRadius: KnowledgeLibraryMetrics.searchCornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: KnowledgeLibraryMetrics.searchCornerRadius, style: .continuous)
                .stroke(model.speechState == .listening ? RecallPalette.coral : RecallPalette.teal, lineWidth: model.speechState == .listening ? 2 : 1)
        )
        .shadow(color: Color.black.opacity(0.16), radius: 4, x: 2, y: 5)
        .overlay(alignment: .bottomLeading) { speechNotice.offset(y: 31) }
    }

    @ViewBuilder
    private var speechNotice: some View {
        switch model.speechState {
        case .denied:
            Button("请在设置中开启语音权限") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(RecallPalette.error)
            .frame(minHeight: 44)
        case .unavailable:
            Text("语音输入暂时不可用，可以继续打字搜索")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(RecallPalette.error)
                .frame(minHeight: 44)
        case .failed(let message):
            Text(message)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(RecallPalette.error)
                .frame(minHeight: 44)
        case .idle, .listening:
            EmptyView()
        }
    }

    private var speechHint: String {
        switch model.speechState {
        case .denied: "语音权限已关闭，点击后可以前往设置"
        case .unavailable: "当前设备暂时无法使用语音输入"
        case .failed: "上次语音输入失败，可以再次尝试"
        case .idle: "点击后开始把语音转成搜索文字"
        case .listening: "点击后停止监听，已有转写会保留"
        }
    }
}

private struct KnowledgeLibraryPager: View {
    let cards: [MemoryCard]
    @Binding var currentPage: Int
    let onOpenCard: (MemoryCard) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var measuredHeights: [String: CGFloat] = [:]

    var body: some View {
        GeometryReader { geometry in
            let contentWidth = geometry.size.width - 18
            let columnCount = dynamicTypeSize.isAccessibilitySize ? 1 : 2
            let columnWidth = columnCount == 1
                ? contentWidth - 14
                : (contentWidth - KnowledgeLibraryMetrics.columnSpacing) / 2
            let pagerHeight = geometry.size.height - 38
            let pages = makePages(
                availableHeight: pagerHeight,
                columnCount: columnCount
            )

            ZStack(alignment: .bottom) {
                TabView(selection: $currentPage) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { pageIndex, page in
                        pageView(
                            page,
                            cards: cards,
                            columnWidth: columnWidth,
                            pageWidth: contentWidth,
                            pageHeight: pagerHeight
                        )
                        .tag(pageIndex)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(width: contentWidth, height: pagerHeight)
                .position(x: geometry.size.width / 2, y: pagerHeight / 2)

                KnowledgeLibraryPageIndicator(
                    pageCount: pages.count,
                    currentPage: currentPage
                )
                .frame(height: 32)

            }
            .overlay(alignment: .topLeading) {
                measurementLayer(columnWidth: columnWidth)
                    .hidden()
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
            }
            .onChange(of: cards.map(\.id)) { _, _ in
                measuredHeights = [:]
                currentPage = 0
            }
            .onChange(of: dynamicTypeSize) { _, _ in
                measuredHeights = [:]
                currentPage = 0
            }
            .onChange(of: pages.count) { _, count in
                if currentPage >= count { currentPage = max(0, count - 1) }
            }
        }
    }

    private func makePages(
        availableHeight: CGFloat,
        columnCount: Int
    ) -> [KnowledgeLibraryPage<String>] {
        let heights = cards.map { card in
            (card.id, (measuredHeights[card.id] ?? 200) + 8)
        }
        return KnowledgeLibraryPaginator<String>().pages(
            itemHeights: heights,
            availableHeight: availableHeight,
            verticalSpacing: KnowledgeLibraryMetrics.rowSpacing,
            columnCount: columnCount
        )
    }

    private func measurementLayer(columnWidth: CGFloat) -> some View {
        ZStack {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                KnowledgeLibraryCardView(card: card, index: index, action: {})
                    .frame(width: columnWidth)
                    .fixedSize(horizontal: false, vertical: true)
                    .background(
                        GeometryReader { proxy in
                            Color.clear.preference(
                                key: KnowledgeLibraryCardHeightPreferenceKey.self,
                                value: [card.id: proxy.size.height]
                            )
                        }
                    )
            }
        }
        .frame(width: columnWidth)
        .onPreferenceChange(KnowledgeLibraryCardHeightPreferenceKey.self) { values in
            guard values != measuredHeights else { return }
            measuredHeights = values
        }
    }

    private func pageView(
        _ page: KnowledgeLibraryPage<String>,
        cards: [MemoryCard],
        columnWidth: CGFloat,
        pageWidth: CGFloat,
        pageHeight: CGFloat
    ) -> some View {
        let cardsByID = Dictionary(cards.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let contentHeight = max(
            pageHeight,
            page.placements.map { $0.y + $0.height + 10 }.max() ?? pageHeight
        )
        return ScrollView(.vertical) {
            ZStack(alignment: .topLeading) {
                ForEach(page.placements.sorted { $0.sourceIndex < $1.sourceIndex }, id: \.id) { placement in
                    if let card = cardsByID[placement.id] {
                        KnowledgeLibraryCardView(
                            card: card,
                            index: placement.sourceIndex,
                            action: { onOpenCard(card) }
                        )
                        .frame(width: columnWidth)
                        .rotationEffect(.degrees(KnowledgeLibraryMetrics.cardRotationDegrees[placement.sourceIndex % KnowledgeLibraryMetrics.cardRotationDegrees.count]))
                        .offset(
                            x: placement.column == 0 ? 7 : 7 + columnWidth + KnowledgeLibraryMetrics.columnSpacing,
                            y: placement.y + 5
                        )
                    }
                }
            }
            .frame(width: pageWidth, height: contentHeight, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("知识卡第 \(currentPage + 1) 页")
    }
}

private struct KnowledgeLibraryCardView: View {
    let card: MemoryCard
    let index: Int
    let action: () -> Void
    @ScaledMetric(relativeTo: .body) private var cardFontSize: CGFloat = 16

    private var style: CardStyle { CardStyle(index: index) }

    var body: some View {
        Button(action: action) {
            knowledgeText
                .font(.system(size: cardFontSize, weight: .medium, design: .rounded))
                .multilineTextAlignment(.leading)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
                .padding(KnowledgeLibraryMetrics.cardContentInset)
                .background(
                    style.background,
                    in: RoundedRectangle(
                        cornerRadius: KnowledgeLibraryMetrics.cardCornerRadius,
                        style: .continuous
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: KnowledgeLibraryMetrics.cardCornerRadius, style: .continuous)
                        .stroke(style.border, lineWidth: 1)
                )
                .shadow(color: rarityColor.opacity(0.26), radius: 5, x: 2, y: 5)
                .contentShape(RoundedRectangle(cornerRadius: KnowledgeLibraryMetrics.cardCornerRadius))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(card.rarity) 卡片，\(card.coreKnowledge)，来源：\(card.sourceTitle)")
        .accessibilityHint("打开完整知识上下文")
        .accessibilityAddTraits(.isButton)
    }

    private var knowledgeText: Text {
        var value = AttributedString(card.coreKnowledge)
        value.foregroundColor = style.text
        if let semantic = card.knowledgeSegments?.semantic,
           let range = value.range(of: semantic) {
            value[range].font = .system(size: cardFontSize, weight: .bold, design: .rounded)
            value[range].foregroundColor = style.semantic
        }
        return Text(value)
    }

    private var rarityColor: Color {
        switch card.rarity {
        case "SSR": RecallPalette.coral
        case "SR": RecallPalette.tealSoft
        default: RecallPalette.teal
        }
    }

    private struct CardStyle {
        let background: Color
        let text: Color
        let semantic: Color
        let border: Color

        init(index: Int) {
            switch index % 5 {
            case 1:
                background = RecallPalette.teal
                text = RecallPalette.panel
                semantic = Color.white
                border = RecallPalette.teal.opacity(0.75)
            case 4:
                background = RecallPalette.coral
                text = RecallPalette.panel
                semantic = Color.white
                border = RecallPalette.coral.opacity(0.75)
            default:
                background = RecallPalette.card
                text = RecallPalette.ink
                semantic = RecallPalette.coral
                border = Color.white.opacity(0.7)
            }
        }
    }
}

private struct KnowledgeLibraryPageIndicator: View {
    let pageCount: Int
    let currentPage: Int

    private var visibleIndices: [Int] {
        guard pageCount > 0 else { return [] }
        if pageCount <= 7 { return Array(0..<pageCount) }
        let start = min(max(0, currentPage - 2), pageCount - 5)
        return Array(start..<(start + 5))
    }

    var body: some View {
        HStack(spacing: 9) {
            ForEach(visibleIndices, id: \.self) { index in
                Circle()
                    .fill(index == currentPage ? RecallPalette.coral : RecallPalette.teal.opacity(0.35))
                    .frame(width: index == currentPage ? 10 : 7, height: index == currentPage ? 10 : 7)
            }
        }
        .frame(minWidth: 44, minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("第 \(min(currentPage + 1, max(pageCount, 1))) 页，共 \(pageCount) 页")
    }
}

private struct KnowledgeLibraryStateView: View {
    let title: String
    let message: String
    let actionTitle: String
    let action: () -> Void
    @ScaledMetric(relativeTo: .title3) private var titleFontSize: CGFloat = 20
    @ScaledMetric(relativeTo: .body) private var bodyFontSize: CGFloat = 14

    var body: some View {
        VStack(spacing: 14) {
            Text(title)
                .font(.system(size: titleFontSize, weight: .bold, design: .rounded))
                .foregroundStyle(RecallPalette.ink)
            Text(message)
                .font(.system(size: bodyFontSize, weight: .medium))
                .foregroundStyle(RecallPalette.teal)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 250)
            Button(actionTitle, action: action)
                .font(.system(size: bodyFontSize, weight: .bold, design: .rounded))
                .foregroundStyle(RecallPalette.panel)
                .frame(minWidth: 132, minHeight: 44)
                .background(RecallPalette.teal, in: Capsule())
        }
        .padding(24)
    }
}

private struct KnowledgeLibraryCardHeightPreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct KnowledgeLibraryPanelShape: Shape {
    func path(in rect: CGRect) -> Path {
        let x = rect.width / 376
        let y = rect.height / 588
        var path = Path()
        path.move(to: CGPoint(x: 0, y: 94.07 * y))
        path.addCurve(
            to: CGPoint(x: 91.12 * x, y: 0.04 * y),
            control1: CGPoint(x: 0, y: 42.54 * y),
            control2: CGPoint(x: 39.62 * x, y: -1.6 * y)
        )
        path.addCurve(
            to: CGPoint(x: 133.22 * x, y: 5.31 * y),
            control1: CGPoint(x: 108.34 * x, y: 0.59 * y),
            control2: CGPoint(x: 123.86 * x, y: 2.11 * y)
        )
        path.addCurve(
            to: CGPoint(x: 299.75 * x, y: 29.69 * y),
            control1: CGPoint(x: 149.68 * x, y: 10.95 * y),
            control2: CGPoint(x: 266.5 * x, y: 29.69 * y)
        )
        path.addCurve(
            to: CGPoint(x: 376 * x, y: 84.54 * y),
            control1: CGPoint(x: 335.32 * x, y: 29.69 * y),
            control2: CGPoint(x: 376 * x, y: 48.97 * y)
        )
        path.addLine(to: CGPoint(x: 376 * x, y: 513 * y))
        path.addCurve(
            to: CGPoint(x: 301 * x, y: 588 * y),
            control1: CGPoint(x: 376 * x, y: 554.42 * y),
            control2: CGPoint(x: 342.42 * x, y: 588 * y)
        )
        path.addLine(to: CGPoint(x: 75 * x, y: 588 * y))
        path.addCurve(
            to: CGPoint(x: 0, y: 513 * y),
            control1: CGPoint(x: 33.58 * x, y: 588 * y),
            control2: CGPoint(x: 0, y: 554.42 * y)
        )
        path.closeSubpath()
        return path
    }
}
