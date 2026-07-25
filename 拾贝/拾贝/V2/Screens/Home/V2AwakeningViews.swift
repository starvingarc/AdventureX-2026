import SwiftUI
import UIKit

struct V2AwakeningHomeView: View {
    let response: V2AwakeningSessionResponse?
    let hasReviewableContent: Bool
    let isLoading: Bool
    @Binding var selectedTab: V2HomeTab
    let showsUnreadNotificationBadge: Bool
    let onOpenNotifications: () -> Void
    let onOpenProfile: () -> Void
    let screenshotCardCount: Int
    let screenshotPoolCounts: [V2MemoryPool: Int]
    let onDrawScreenshot: (V2MemoryPool) -> Void
    let onContinuousScreenshotDraw: (V2MemoryPool) -> Void
    let onDraw: () -> Void
    let onAddContent: () -> Void
    @Environment(\.accessibilityReduceMotion)
    private var reduceMotion
    @State private var isMascotReacting = false

    var body: some View {
        GeometryReader { geometry in
            let bottomNavScale = min(1, geometry.size.width / 357)

            ZStack(alignment: .top) {
                V2Color.pageGreenBackground
                    .ignoresSafeArea()

                backgroundDecorations(in: geometry.size)

                VStack(spacing: 0) {
                    V2TopChrome {
                        HStack {
                            V2CircleIconButton(
                                kind: .notification,
                                showsUnreadBadge: showsUnreadNotificationBadge,
                                action: onOpenNotifications
                            )
                            Spacer()
                            V2CircleIconButton(kind: .profile, action: onOpenProfile)
                        }
                        .frame(height: V2Layout.topBarHeight)
                    }

                    homeContent
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.bottom, 112 * bottomNavScale)
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
        }
    }

    @ViewBuilder
    private var homeContent: some View {
        if !hasReviewableContent && response?.hasActiveCard != true {
            VStack(spacing: 18) {
                Spacer()
                Image("V2HomeEmptyStateIllustration")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: 210, height: 320)
                    .accessibilityHidden(true)
                Text("还没有可以唤醒的记忆")
                    .font(V2Typography.sectionTitle)
                    .foregroundStyle(V2Color.textPrimary)
                Text("先添加一张截图或一段内容")
                    .font(V2Typography.bodySmall)
                    .foregroundStyle(V2Color.textMuted)
                V2PrimaryActionButton(title: "添加内容", action: onAddContent)
                    .v2PageColumn()
                Spacer()
            }
        } else {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    Text("今天，唤醒一点记忆")
                        .font(.system(size: 25, weight: .bold))
                        .foregroundStyle(V2Color.textPrimary)
                        .padding(.top, 26)

                    Text(homeSubtitle)
                        .font(V2Typography.bodySmall)
                        .foregroundStyle(V2Color.textSecondary.opacity(0.76))
                        .padding(.top, 9)

                    Button {
                        reactMascot()
                    } label: {
                        V2RecallMascotView(
                            state: isMascotReacting ? .reacting : .idle,
                            reduceMotion: reduceMotion
                        )
                        .frame(width: 102, height: 102)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Recallo 毛球")
                    .accessibilityHint("轻点查看毛球回应")
                    .animation(
                        reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.7),
                        value: isMascotReacting
                    )
                    .padding(.top, 8)

                    V2MemoryCardStack(
                        pool: preferredPool,
                        count: screenshotCardCount > 0 ? screenshotCardCount : (canDraw ? 1 : 0),
                        isActive: !isLoading && (screenshotCardCount > 0 || canDraw),
                        reduceMotion: reduceMotion,
                        onDraw: {
                            V2AwakeningHaptics.selection()
                            if screenshotCardCount > 0 {
                                drawScreenshotMemory()
                            } else {
                                onDraw()
                            }
                        }
                    )
                    .frame(width: 280, height: 344)
                    .padding(.top, 4)

                    V2PrimaryActionButton(
                        title: actionTitle,
                        tone: isLoading || (screenshotCardCount == 0 && !canDraw) ? .disabled : .normal
                    ) {
                        V2AwakeningHaptics.selection()
                        if screenshotCardCount > 0 {
                            drawScreenshotMemory()
                        } else {
                            onDraw()
                        }
                    }
                    .v2PageColumn()
                    .accessibilityHint("每次只呈现一张，完成后由你决定是否继续")

                    Text(screenshotCardCount > 0
                         ? "\(screenshotCardCount) 张旧内容在等你，一次只看一张"
                         : "一张就好，随时可以停下")
                        .font(V2Typography.caption)
                        .foregroundStyle(V2Color.textMuted)
                        .padding(.top, 13)

                    Button("添加新的内容", action: onAddContent)
                        .font(V2Typography.bodySmallEmphasis)
                        .foregroundStyle(V2Color.textSecondary)
                        .padding(.top, 14)
                        .padding(.bottom, 28)
                }
            }
        }
    }

    private var canDraw: Bool {
        response?.hasActiveCard == true || (response?.availableCount ?? 0) > 0
    }

    private var actionTitle: String {
        if isLoading { return "正在准备" }
        return response?.hasActiveCard == true ? "继续这张" : "召回一张"
    }

    private var preferredPool: V2MemoryPool {
        V2MemoryPool.allCases.first {
            screenshotPoolCounts[$0, default: 0] > 0
        } ?? .due
    }

    private func drawScreenshotMemory() {
        guard screenshotCardCount > 0 else { return }
        // 预取多张只为让检查点能显示下一张；界面始终一次呈现一张。
        if screenshotCardCount > 1 {
            onContinuousScreenshotDraw(preferredPool)
        } else {
            onDrawScreenshot(preferredPool)
        }
    }

    private var homeSubtitle: String {
        if screenshotCardCount > 0 {
            return "从自己的过去，召回一段正在消失的记忆"
        }
        if response?.hasActiveCard == true {
            return "这张记忆还在等你"
        }
        let count = response?.availableCount ?? 0
        return count > 0 ? "有 \(count) 张记忆等待唤醒" : "暂时没有需要唤醒的记忆"
    }

    private func reactMascot() {
        V2AwakeningHaptics.selection()
        guard !reduceMotion, !isMascotReacting else { return }
        isMascotReacting = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 340_000_000)
            withAnimation(.easeOut(duration: 0.12)) {
                isMascotReacting = false
            }
        }
    }

    private func backgroundDecorations(in size: CGSize) -> some View {
        ZStack {
            Image("V2BgDecoLeftHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 148)
                .opacity(0.48)
                .position(x: 45, y: size.height * 0.58)

            Image("V2BgDecoRightHillPlant")
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .frame(width: 148)
                .opacity(0.48)
                .position(x: size.width - 38, y: size.height * 0.55)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

struct V2AwakeningFlowView: View {
    let response: V2AwakeningSessionResponse
    let shouldAnimateReveal: Bool
    let isSubmitting: Bool
    let onBack: () -> Void
    let onAnswer: (String) -> Void
    let onComplete: () -> Void
    let onSource: () -> Void

    @Environment(\.accessibilityReduceMotion)
    private var reduceMotion
    @State private var isRevealed = false
    @State private var selectedOptionId: String?

    var body: some View {
        V2FlowScreen(title: "唤醒记忆", onBack: onBack) {
            ZStack(alignment: .top) {
                if isRevealed {
                    questionContent
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.96).combined(with: .opacity))
                } else {
                    V2AwakeningCardBack()
                        .offset(y: 94)
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 760, alignment: .top)
            .overlay(alignment: .bottom) {
                if let feedback = response.feedback {
                    V2AnswerFeedbackPanel(
                        text: feedback.explanation,
                        isCorrect: feedback.result == "correct",
                        onContinue: onComplete,
                        onClose: onComplete,
                        onSource: onSource,
                        actionTitle: "完成"
                    )
                    .padding(.bottom, V2AwakeningLayout.feedbackBottomLift)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(20)
                }
            }
        }
        .task(id: response.awakeningSession?.id) {
            selectedOptionId = response.feedback?.selectedOptionId
            guard shouldAnimateReveal, !reduceMotion else {
                isRevealed = true
                return
            }
            isRevealed = false
            V2AwakeningHaptics.selection()
            try? await Task.sleep(nanoseconds: 480_000_000)
            withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                isRevealed = true
            }
            V2AwakeningHaptics.cardLanded()
        }
        .onChange(of: isSubmitting) { _, submitting in
            if !submitting, response.feedback == nil {
                selectedOptionId = nil
            }
        }
    }

    @ViewBuilder
    private var questionContent: some View {
        if let session = response.awakeningSession, let card = response.card {
            VStack(spacing: 0) {
                Text(session.lifecycleTitle)
                    .font(V2Typography.label)
                    .foregroundStyle(V2Color.textSecondary.opacity(0.72))
                    .padding(.top, 18)

                awakeningQuestionCard(card: card)
                    .offset(y: 36)

                if isSubmitting {
                    ProgressView()
                        .tint(V2Color.primary)
                        .padding(.top, 52)
                        .accessibilityLabel("正在保存答案")
                }
            }
        }
    }

    private func awakeningQuestionCard(card: V2AwakeningCard) -> some View {
        let question = card.reviewQuestion(feedback: response.feedback)

        return VStack(alignment: .leading, spacing: 0) {
            Text(question.prompt)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(hex: 0x1F1B12))
                .lineSpacing(6)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 23)

            VStack(spacing: 12) {
                ForEach(card.question.options.indices, id: \.self) { index in
                    let option = card.question.options[index]
                    V2QuestionOptionCard(
                        letter: optionLetter(index),
                        title: option.text,
                        state: optionState(optionId: option.id)
                    ) {
                        guard selectedOptionId == nil, !isSubmitting else { return }
                        selectedOptionId = option.id
                        V2AwakeningHaptics.selection()
                        onAnswer(option.id)
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.top, 25)
        .padding(.horizontal, 27)
        .padding(.bottom, 27)
        .frame(width: 321, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: V2Radius.medium, style: .continuous)
                .fill(Color(hex: 0xFFFCF4))
                .v2Shadow()
        )
    }

    private func optionState(optionId: String) -> V2QuestionOptionState {
        guard let feedback = response.feedback else { return .normal }
        if optionId == feedback.correctOptionId { return .correct }
        if optionId == feedback.selectedOptionId { return .wrong }
        return .normal
    }

    private func optionLetter(_ index: Int) -> String {
        let letters = ["A", "B", "C", "D"]
        return letters.indices.contains(index) ? letters[index] : ""
    }
}

private enum V2AwakeningLayout {
    static let feedbackBottomLift: CGFloat = 72
}

struct V2AwakeningCompletionView: View {
    let response: V2AwakeningSessionResponse
    let isLoading: Bool
    let onNext: () -> Void
    let onExit: () -> Void

    var body: some View {
        ZStack {
            V2Color.pageGreenBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(V2Color.surfaceCream)
                        .v2Shadow()
                        .frame(width: 286, height: 350)

                    VStack(spacing: 18) {
                        Image(systemName: resultIsCorrect ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath.circle.fill")
                            .font(.system(size: 58, weight: .regular))
                            .foregroundStyle(resultIsCorrect ? V2Color.primary : Color(hex: 0xED765C))

                        Text(session?.completionMessage ?? "这段记忆已经保存")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(V2Color.textPrimary)
                            .multilineTextAlignment(.center)

                        Text(statusTransition)
                            .font(V2Typography.bodySmallEmphasis)
                            .foregroundStyle(V2Color.textSecondary)

                        Text("来自 \(response.card?.sourceAgeDays ?? 0) 天前")
                            .font(V2Typography.bodySmall)
                            .foregroundStyle(V2Color.textMuted)

                        if let chapterTitle = response.card?.chapterTitle, !chapterTitle.isEmpty {
                            Text(chapterTitle)
                                .font(V2Typography.caption)
                                .foregroundStyle(V2Color.textMuted.opacity(0.82))
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: 220)
                        }
                    }
                    .padding(.horizontal, 24)
                }

                Spacer()

                VStack(spacing: 12) {
                    V2PrimaryActionButton(
                        title: isLoading ? "正在准备" : "再抽一张",
                        tone: isLoading ? .disabled : .normal
                    ) {
                        V2AwakeningHaptics.selection()
                        onNext()
                    }

                    Button(action: onExit) {
                        Text("先到这里")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(V2Color.textPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(V2Color.surfaceCream.opacity(0.78))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .stroke(V2Color.primary.opacity(0.28), lineWidth: 1)
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                }
                .v2PageColumn()
                .padding(.bottom, 34)
            }
        }
    }

    private var session: V2AwakeningSession? {
        response.awakeningSession
    }

    private var resultIsCorrect: Bool {
        session?.answer?.result == "correct"
    }

    private var statusTransition: String {
        resultIsCorrect ? "待唤醒 → 已稳固" : "待唤醒 → 需加固"
    }
}


enum V2RecallPresentationPhase: String, Codable, CaseIterable {
    case home
    case summoning
    case recall
    case scratching
    case revealed
    case assessing
    case checkpoint
    case stowing
    case paused
}

enum V2RecallMascotState: String, Codable, CaseIterable {
    case idle
    case reacting
    case turning
    case rummaging
    case carrying
    case watching
    case acknowledging
    case thinking
    case sleeping
    case farewell
}

enum V2RecallScenePalette: String, Codable, CaseIterable {
    case creamReady
    case mistProcessing
    case coralRecall
    case lavenderPaused
    case sageLibrary
    case navyNight
}

struct V2RecallMascotView: View {
    let state: V2RecallMascotState
    let reduceMotion: Bool
    @State private var idlePulse = false

    var body: some View {
        ZStack {
            if state == .sleeping {
                Text("Z  z")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(V2Color.textMuted)
                    .offset(x: 38, y: -34)
            }

            if state == .carrying || state == .rummaging || state == .farewell {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(V2Color.surfaceCream)
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(V2Color.primary.opacity(0.46), lineWidth: 1)
                    )
                    .frame(width: state == .carrying ? 42 : 54, height: state == .carrying ? 30 : 38)
                    .rotationEffect(.degrees(state == .carrying ? -5 : 3))
                    .offset(x: state == .carrying ? -1 : 34, y: state == .carrying ? 30 : 32)
            }

            Image(assetName)
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
                .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                .scaleEffect(scale)
                .rotationEffect(.degrees(rotation))
                .offset(offset)
                .opacity(state == .sleeping ? 0.82 : 1)

            if state == .farewell {
                Image(systemName: "hand.wave.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(V2Color.primary)
                    .offset(x: 36, y: -2)
            }
        }
        .scaleEffect(reduceMotion ? 1 : idlePulse ? 1.025 : 1)
        .animation(
            reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.72),
            value: state
        )
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 0.34),
            value: idlePulse
        )
        .task(id: "\(state.rawValue)-\(reduceMotion)") {
            idlePulse = false
            guard state == .idle,
                  !reduceMotion,
                  !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                guard !Task.isCancelled else { return }
                idlePulse = true
                try? await Task.sleep(nanoseconds: 360_000_000)
                idlePulse = false
            }
        }
        .accessibilityHidden(true)
    }

    private var assetName: String {
        switch state {
        case .idle, .reacting, .watching, .sleeping:
            return "RecalloMascotIdle"
        case .turning, .rummaging, .farewell:
            return "RecalloMascotTilt"
        case .carrying:
            return "RecalloMascotHop"
        case .acknowledging:
            return "RecalloMascotSuccess"
        case .thinking:
            return "RecalloMascotThinking"
        }
    }

    private var scale: CGFloat {
        switch state {
        case .reacting: return 1.06
        case .rummaging: return 0.96
        case .carrying, .acknowledging: return 1.04
        case .sleeping: return 0.9
        default: return 1
        }
    }

    private var rotation: Double {
        switch state {
        case .turning: return -7
        case .rummaging: return 8
        case .thinking: return -3
        case .sleeping: return 8
        case .farewell: return -9
        default: return 0
        }
    }

    private var offset: CGSize {
        switch state {
        case .carrying: return CGSize(width: 0, height: -7)
        case .rummaging: return CGSize(width: 15, height: 8)
        case .sleeping: return CGSize(width: 0, height: 11)
        default: return .zero
        }
    }

    private var mirrored: Bool {
        state == .turning || state == .farewell
    }
}

private struct V2MemoryCardStack: View {
    let pool: V2MemoryPool
    let count: Int
    let isActive: Bool
    let reduceMotion: Bool
    let onDraw: () -> Void
    @GestureState private var dragTranslation = CGSize.zero
    @State private var stackSettle: CGFloat = 0

    var body: some View {
        ZStack {
            card(rotation: -5, x: -20, y: 13 + stackSettle * 2, opacity: 0.72)
            card(rotation: 5, x: 20, y: 7 + stackSettle * 2, opacity: 0.84)

            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(V2Color.surfaceCream)
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(V2Color.borderSoftGreen, lineWidth: 1)
                )
                .v2Shadow()
                .frame(width: 238, height: 318)
                .overlay {
                    VStack(spacing: 14) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 35, weight: .medium))
                            .foregroundStyle(V2Color.primary)
                        Text("记忆卡")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(V2Color.textPrimary)
                        Text(isActive ? "向上拖动，召回一张" : "今天没有待召回内容")
                            .font(V2Typography.caption)
                            .foregroundStyle(V2Color.textMuted)
                    }
                }
                .opacity(isActive ? 1 : 0.72)
        }
        .scaleEffect(isDragging && !reduceMotion ? 0.97 : 1)
        .rotation3DEffect(
            .degrees(reduceMotion ? 0 : dragTilt),
            axis: (x: 0, y: 1, z: 0),
            perspective: 0.45
        )
        .offset(y: reduceMotion ? 0 : -min(upwardProgress * 6, 6))
        .animation(
            reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.76),
            value: dragTranslation
        )
        .animation(
            reduceMotion ? nil : .spring(response: 0.38, dampingFraction: 0.72),
            value: stackSettle
        )
        .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .gesture(
            DragGesture(minimumDistance: 0)
                .updating($dragTranslation) { value, state, _ in
                    guard isActive else { return }
                    state = value.translation
                }
                .onEnded { value in
                    guard isActive, -value.translation.height >= 28 else { return }
                    onDraw()
                }
        )
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.45)
                .onEnded { _ in
                    guard isActive else { return }
                    onDraw()
                }
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(count) 张待召回记忆卡")
        .accessibilityHint(isActive ? "向上拖动二十八点、长按，或使用召回操作" : "当前没有可召回卡片")
        .accessibilityAction(named: "召回一张") {
            guard isActive else { return }
            onDraw()
        }
        .accessibilityIdentifier("v2.memory-card-stack")
        .onChange(of: pool) { _, _ in
            guard isActive else { return }
            if reduceMotion {
                stackSettle = 0
            } else {
                stackSettle = 1
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 180_000_000)
                    stackSettle = 0
                }
            }
        }
    }

    private var isDragging: Bool {
        abs(dragTranslation.width) > 0.5 || abs(dragTranslation.height) > 0.5
    }

    private var upwardProgress: CGFloat {
        min(1, max(0, -dragTranslation.height / 28))
    }

    private var dragTilt: Double {
        let normalized = max(-1, min(1, dragTranslation.width / 80))
        return Double(normalized) * 4
    }

    private func card(
        rotation: Double,
        x: CGFloat,
        y: CGFloat,
        opacity: Double
    ) -> some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(V2Color.surfaceCream.opacity(opacity))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(V2Color.borderSoftGreen.opacity(0.82), lineWidth: 1)
            )
            .frame(width: 238, height: 318)
            .rotationEffect(.degrees(rotation))
            .offset(x: x, y: y)
    }
}

private struct V2AwakeningCardBack: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(V2Color.surfaceCream)
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(V2Color.borderSoftGreen, lineWidth: 1)
            )
            .v2Shadow()
            .frame(width: 252, height: 360)
            .overlay {
                VStack(spacing: 16) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 42, weight: .medium))
                        .foregroundStyle(V2Color.primary)
                    Text("正在唤醒")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(V2Color.textPrimary)
                }
            }
            .accessibilityLabel("正在揭晓记忆卡")
    }
}

private enum V2AwakeningHaptics {
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }

    static func cardLanded() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.7)
    }
}
