import SwiftUI
import UIKit
import Pow

private enum V2ScreenshotSummonVisualStage: Equatable {
    case compress
    case rise
    case orbit
    case settle
    case cue
}

private struct V2PendingScreenshotAssessment: Equatable {
    let assessment: V2MemoryAssessment
    let attemptId: String
}


private struct V2ScratchRevealCanvas: View {
    let hiddenText: String
    let reduceMotion: Bool
    @Binding var paths: [[CGPoint]]
    @Binding var coveredCells: Set<String>
    @Binding var coverage: CGFloat
    @Binding var isDrawing: Bool
    let onScratchStart: () -> Void
    let onReveal: () -> Void

    private let gridColumns = 12
    private let gridRows = 7
    private let brushDiameter: CGFloat = 26

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Text(hiddenText)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(V2Color.primary)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 17)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

                Canvas { context, size in
                    let layer = Path(
                        roundedRect: CGRect(origin: .zero, size: size),
                        cornerRadius: 16
                    )
                    context.fill(layer, with: .color(V2Color.uploadButtonFill))
                    context.blendMode = .destinationOut
                    for points in paths where points.count > 1 {
                        var stroke = Path()
                        stroke.move(to: points[0])
                        for point in points.dropFirst() {
                            stroke.addLine(to: point)
                        }
                        context.stroke(
                            stroke,
                            with: .color(.black),
                            style: StrokeStyle(
                                lineWidth: brushDiameter,
                                lineCap: .round,
                                lineJoin: .round
                            )
                        )
                    }
                }
                .drawingGroup()

                if coverage < 0.18 {
                    HStack(spacing: 8) {
                        Image(systemName: "hand.draw.fill")
                        Text("像刮开旧照片一样，找回这句话")
                            .font(V2Typography.bodySmallEmphasis)
                    }
                    .foregroundStyle(V2Color.textSecondary)
                    .padding(.horizontal, 18)
                    .allowsHitTesting(false)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { value in
                        if !isDrawing {
                            isDrawing = true
                            paths.append([])
                            onScratchStart()
                        }
                        paths[paths.count - 1].append(value.location)
                        markCoveredCells(at: value.location, size: geometry.size)
                    }
                    .onEnded { _ in
                        isDrawing = false
                        if coverage >= 0.45 {
                            onReveal()
                        }
                    }
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("被铅笔涂层遮住的语义")
            .accessibilityValue("\(Int(coverage * 100))% 已刮开")
            .accessibilityHint("上下滑动调整揭示进度，或使用完整揭示操作")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment:
                    adjustCoveredCells(by: 0.15)
                case .decrement:
                    adjustCoveredCells(by: -0.15)
                @unknown default:
                    break
                }
            }
            .accessibilityAction(named: "完整揭示") {
                onReveal()
            }
        }
        .frame(minHeight: 86)
    }

    private func markCoveredCells(at point: CGPoint, size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let column = min(gridColumns - 1, max(0, Int(point.x / size.width * CGFloat(gridColumns))))
        let row = min(gridRows - 1, max(0, Int(point.y / size.height * CGFloat(gridRows))))
        let radiusColumns = max(
            0,
            Int(((brushDiameter / 2) / max(1, size.width / CGFloat(gridColumns))).rounded())
        )
        let radiusRows = max(
            0,
            Int(((brushDiameter / 2) / max(1, size.height / CGFloat(gridRows))).rounded())
        )
        for x in max(0, column - radiusColumns)...min(gridColumns - 1, column + radiusColumns) {
            for y in max(0, row - radiusRows)...min(gridRows - 1, row + radiusRows) {
                coveredCells.insert("\(x):\(y)")
            }
        }
        coverage = min(1, CGFloat(coveredCells.count) / CGFloat(gridColumns * gridRows))
        if coverage >= 0.45 {
            onReveal()
        }
    }

    private func adjustCoveredCells(by delta: CGFloat) {
        let totalCells = gridColumns * gridRows
        let targetCoverage = min(1, max(0, coverage + delta))
        let targetCount = Int((targetCoverage * CGFloat(totalCells)).rounded())
        let allCells = (0..<gridRows).flatMap { row in
            (0..<gridColumns).map { column in "\(column):\(row)" }
        }
        if targetCount > coveredCells.count {
            for cell in allCells where !coveredCells.contains(cell) {
                coveredCells.insert(cell)
                if coveredCells.count >= targetCount { break }
            }
        } else if targetCount < coveredCells.count {
            for cell in coveredCells.sorted().reversed() {
                coveredCells.remove(cell)
                if coveredCells.count <= targetCount { break }
            }
        }
        coverage = min(1, CGFloat(coveredCells.count) / CGFloat(totalCells))
        onScratchStart()
        if coverage >= 0.45 { onReveal() }
    }
}

struct V2ScreenshotAwakeningFlowView: View {
    let session: V2ScreenshotDrawSession
    let onAssessment: (String, V2MemoryAssessment, String) async throws -> CaptureMemoryCardAssessmentResponse
    let onClose: () -> Void

    @Environment(\.accessibilityReduceMotion)
    private var reduceMotion
    @Environment(\.scenePhase)
    private var scenePhase
    @Environment(\.colorScheme)
    private var colorScheme
    @State private var currentIndex = 0
    @State private var phase = V2RecallPresentationPhase.summoning
    @State private var phaseBeforePause = V2RecallPresentationPhase.recall
    @State private var summonStage = V2ScreenshotSummonVisualStage.compress
    @State private var isRevealed = false
    @State private var revealProgress: CGFloat = 0
    @State private var isRevealDragging = false
    @State private var assessment: V2MemoryAssessment?
    @State private var masteryBefore = V2MemoryMasteryStage.sealed
    @State private var masteryAfter = V2MemoryMasteryStage.sealed
    @State private var currentSchedule: ImageFlowReviewSchedule?
    @State private var presentationReviewCycleKey = ""
    @State private var pendingAssessment: V2PendingScreenshotAssessment?
    @State private var variantFeedback = ""
    @State private var assessmentError = ""
    @State private var assessmentTask: Task<Void, Never>?
    @State private var fuzzyBreathActive = false
    @State private var scratchPaths: [[CGPoint]] = []
    @State private var coveredScratchCells: Set<String> = []
    @AppStorage("recallo.v06.currentCardID") private var persistedCardID = ""
    @AppStorage("recallo.v06.currentIndex") private var persistedCurrentIndex = 0
    @AppStorage("recallo.v06.phase") private var persistedPhase = V2RecallPresentationPhase.home.rawValue
    @AppStorage("recallo.v06.revealCoverage") private var persistedRevealCoverage = 0.0
    @AppStorage("recallo.v06.isRevealed") private var persistedIsRevealed = false
    @AppStorage("recallo.v06.scratchPaths") private var persistedScratchPaths = ""
    @AppStorage("recallo.v06.coveredCells") private var persistedCoveredCells = ""
    @AppStorage("recallo.v06.assessedReviewCycles") private var persistedAssessedReviewCycles = ""
    @AppStorage("recallo.v06.presentationReviewCycleKey") private var persistedPresentationReviewCycleKey = ""
    @AppStorage("recallo.v06.assessment") private var persistedAssessment = ""
    @AppStorage("recallo.v06.masteryBefore") private var persistedMasteryBefore = 0
    @AppStorage("recallo.v06.masteryAfter") private var persistedMasteryAfter = 0
    @AppStorage("recallo.v06.scheduleNextReviewAt") private var persistedScheduleNextReviewAt = ""
    @AppStorage("recallo.v06.scheduleIntervalDays") private var persistedScheduleIntervalDays = 0
    @AppStorage("recallo.v06.scheduleState") private var persistedScheduleState = ""
    @AppStorage("recallo.v06.scheduleStatus") private var persistedScheduleStatus = ""

    private var currentCard: V2CapturedMemoryCard {
        session.cards[min(currentIndex, session.cards.count - 1)]
    }

    var body: some View {
        ZStack {
            sceneBackgroundColor
                .ignoresSafeArea()

            if phase == .summoning {
                summonTransition
                    .transition(.opacity)
            } else if phase == .stowing {
                stowingLanding
                    .transition(.opacity)
            } else if phase == .paused {
                pausedLanding
                    .transition(.opacity)
            } else {
                VStack(spacing: 0) {
                    topBar
                    ScrollView(showsIndicators: false) {
                        if phase == .checkpoint {
                            archiveLanding
                        } else if phase == .assessing {
                            feedbackLanding
                        } else if currentCard.card.state == .formal {
                            formalCard
                        } else {
                            fragmentCard
                        }
                    }
                }
            }
        }
        .interactiveDismissDisabled(phase == .assessing)
        .task(id: summonTaskID) {
            guard phase == .summoning else { return }
            currentSchedule = currentCard.schedule
            if presentationReviewCycleKey.isEmpty {
                presentationReviewCycleKey = currentCard.reviewCycleKey(scheduleOverride: currentSchedule)
            }
            summonStage = .compress
            if reduceMotion {
                try? await Task.sleep(nanoseconds: 180_000_000)
                guard !Task.isCancelled, phase == .summoning else { return }
                withAnimation(.easeOut(duration: 0.18)) {
                    phase = .recall
                }
                return
            }

            let timings: [UInt64] = currentIndex == 0
                ? [120_000_000, 360_000_000, 470_000_000, 300_000_000, 200_000_000]
                : [80_000_000, 180_000_000, 180_000_000, 140_000_000, 120_000_000]
            guard await advanceSummon(after: timings[0], to: .rise) else { return }
            guard await advanceSummon(after: timings[1], to: .orbit) else { return }
            guard await advanceSummon(after: timings[2], to: .settle) else { return }
            guard await advanceSummon(after: timings[3], to: .cue) else { return }
            try? await Task.sleep(nanoseconds: timings[4])
            guard !Task.isCancelled, phase == .summoning else { return }
            withAnimation(.easeOut(duration: 0.18)) {
                phase = .recall
            }
        }
        .onAppear {
            restorePersistedState()
        }
        .onDisappear {
            assessmentTask?.cancel()
            persistPresentationState()
        }
        .onChange(of: phase) { _, _ in
            persistPresentationState()
        }
        .onChange(of: revealProgress) { _, _ in
            persistPresentationState()
        }
        .onChange(of: isRevealed) { _, _ in
            persistPresentationState()
        }
        .onChange(of: scenePhase) { _, newScenePhase in
            switch newScenePhase {
            case .active:
                if phase == .paused {
                    phase = phaseBeforePause
                }
            case .inactive:
                persistPresentationState()
            case .background:
                guard phase != .assessing, phase != .stowing else {
                    persistPresentationState()
                    return
                }
                phaseBeforePause = stablePhase(for: phase)
                phase = .paused
            @unknown default:
                persistPresentationState()
            }
        }
    }

    private var summonTaskID: String {
        "\(currentIndex)-\(phase == .summoning ? "summoning" : "other")"
    }

    private var topBar: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(V2Color.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(V2Color.surfaceCream))
            }
            .accessibilityLabel("退出召回")
            .disabled(phase == .assessing)
            .accessibilityHint(
                phase == .assessing
                    ? "正在保存当前结果，完成后可以退出"
                    : "保留当前进度并返回首页"
            )

            Spacer()

            Text(phase == .checkpoint ? "记忆收藏册" : "唤醒一张记忆")
                .font(V2Typography.sectionTitle)
                .foregroundStyle(V2Color.topTitle)

            Spacer()

            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, V2Layout.pageHorizontalInset)
        .padding(.top, 12)
        .padding(.bottom, 16)
    }

    private var summonTransition: some View {
        VStack(spacing: 28) {
            VStack(spacing: 8) {
                Text(session.pool.title)
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.textMuted)
                Text("正在从你的过去召回")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(V2Color.textPrimary)
            }

            ZStack {
                ForEach(0..<2, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 25, style: .continuous)
                        .fill(V2Color.surfaceCream.opacity(index == 0 ? 0.5 : 0.72))
                        .frame(width: 238, height: 318)
                        .rotationEffect(.degrees(index == 0 ? -6 : 5))
                        .offset(x: index == 0 ? -16 : 18, y: index == 0 ? 17 : 12)
                        .v2Shadow()
                        .opacity(!reduceMotion && summonStage == .rise ? 0.62 : 1)
                        .animation(
                            reduceMotion ? nil : .easeInOut(duration: 0.3),
                            value: summonStage
                        )
                }

                if !reduceMotion && summonStage == .orbit {
                    Image("RecalloParticleGlow")
                        .resizable()
                        .renderingMode(.template)
                        .foregroundStyle(rarityColor.opacity(0.16))
                        .frame(width: 190, height: 190)
                        .transition(.opacity)

                    Ellipse()
                        .trim(from: 0.08, to: 0.84)
                        .stroke(
                            rarityColor.opacity(0.48),
                            style: StrokeStyle(lineWidth: 8, lineCap: .round)
                        )
                        .frame(width: 330, height: 165)
                        .rotationEffect(.degrees(-18))
                        .blur(radius: 2)
                        .transition(.opacity)
                }

                VStack(spacing: 18) {
                    rarityBadge
                    Image(systemName: "sparkles")
                        .font(.system(size: 42, weight: .light))
                        .foregroundStyle(V2Color.primary)
                    Text("一段记忆正在苏醒")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(V2Color.textPrimary)
                    Text(currentCard.masteryStage.title)
                        .font(V2Typography.caption)
                        .foregroundStyle(V2Color.textMuted)
                }
                .frame(width: 238, height: 318)
                .background(
                    RoundedRectangle(cornerRadius: 25, style: .continuous)
                        .fill(V2Color.surfaceCream)
                        .overlay(
                            RoundedRectangle(cornerRadius: 25, style: .continuous)
                                .stroke(rarityColor.opacity(0.56), lineWidth: 1.5)
                        )
                        .v2Shadow()
                )
                .shadow(
                    color: !reduceMotion && summonStage == .orbit
                        ? rarityColor.opacity(0.18)
                        : Color.clear,
                    radius: !reduceMotion && summonStage == .orbit ? 6 : 0,
                    y: !reduceMotion && summonStage == .orbit ? 4 : 0
                )
                .scaleEffect(summonCardScale)
                .offset(summonCardOffset)
                .rotationEffect(.degrees(summonCardRotation))
                .opacity(summonStage == .compress ? 0.86 : 1)
                .animation(
                    reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.8),
                    value: summonStage
                )
                .changeEffect(
                    .shine(duration: 0.35),
                    value: summonStage == .cue,
                    isEnabled: !reduceMotion
                )

                if summonStage == .cue {
                    if !reduceMotion {
                        Circle()
                            .fill(rarityColor.opacity(0.08))
                            .frame(width: 220, height: 220)
                            .blur(radius: 30)
                            .offset(x: 126, y: 128)
                            .transition(.opacity)
                            .accessibilityHidden(true)
                    }
                }

                V2RecallMascotView(state: mascotState, reduceMotion: reduceMotion)
                    .frame(width: 98, height: 98)
                    .offset(x: 126, y: 128)
                    .transition(.scale(scale: 0.88).combined(with: .opacity))
            }
            .frame(height: 350)

            Button("跳过过场") {
                finishSummon()
            }
            .font(V2Typography.bodySmallEmphasis)
            .foregroundStyle(V2Color.textSecondary)
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityHint("直接进入主动回忆")
        }
        .v2PageColumn()
    }

    private var summonCardScale: CGFloat {
        switch summonStage {
        case .compress: 0.94
        case .rise: 0.98
        case .orbit: 1.035
        case .settle, .cue: 1
        }
    }

    private var summonCardOffset: CGSize {
        switch summonStage {
        case .compress: CGSize(width: -2, height: 28)
        case .rise: CGSize(width: 0, height: -22)
        case .orbit: CGSize(width: -8, height: -12)
        case .settle, .cue: .zero
        }
    }

    private var summonCardRotation: Double {
        switch summonStage {
        case .compress: -2
        case .rise: 3
        case .orbit: -3
        case .settle, .cue: 0
        }
    }

    private var formalCard: some View {
        VStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    rarityBadge
                    Spacer()
                    Text(currentCard.masteryStage.title)
                        .font(V2Typography.captionEmphasis)
                        .foregroundStyle(V2Color.primary)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(V2Color.pageGreenBackground.opacity(0.45))
                                .overlay(
                                    Capsule()
                                        .stroke(V2Color.primary.opacity(0.35), lineWidth: 1)
                                )
                        )
                    sourceStatusLabel
                }

                Text("先别看答案")
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.textMuted)

                Text(currentCard.card.recallCue)
                    .font(.system(size: 23, weight: .bold))
                    .foregroundStyle(V2Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if isRevealed {
                    revealedContent
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                } else if currentCard.masteryStage == .sealed || activeRecallVariant == nil {
                    semanticRevealControl
                } else {
                    recallVariantControl
                }
            }
            .padding(22)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(V2Color.surfaceCream)
                    .v2Shadow()
            )

            if isRevealed {
                assessmentButtons
                    .transition(.opacity)
            } else if currentCard.masteryStage == .sealed || activeRecallVariant == nil {
                Button("直接揭晓") {
                    reveal()
                }
                .font(V2Typography.bodySmallEmphasis)
                .foregroundStyle(V2Color.textSecondary)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityHint("不需要拖动即可显示答案")
            }
        }
        .v2PageColumn()
        .rotation3DEffect(
            .degrees(isRevealDragging && !reduceMotion ? Double(revealProgress - 0.5) * 3 : 0),
            axis: (x: 0, y: 1, z: 0),
            perspective: 0.45
        )
        .padding(.bottom, 36)
    }

    private var rarityBadge: some View {
        Text(currentCard.card.rarity?.rawValue ?? "R")
            .font(.system(size: 15, weight: .heavy, design: .rounded))
            .foregroundStyle(rarityColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(rarityColor.opacity(0.14))
            )
            .accessibilityLabel("稀有度 \(currentCard.card.rarity?.rawValue ?? "R")")
    }

    private var sourceStatusLabel: some View {
        Label(sourceStatusTitle, systemImage: sourceStatusSymbol)
            .font(V2Typography.captionEmphasis)
            .foregroundStyle(sourceStatusColor)
            .accessibilityLabel(sourceStatusTitle)
    }

    private var activeRecallVariant: ImageFlowRecallVariant? {
        let variants = currentCard.card.recallVariants ?? []
        if currentCard.masteryStage.rawValue <= V2MemoryMasteryStage.awakened.rawValue {
            return variants.first(where: { $0.type == .trueFalse })
                ?? variants.first(where: { $0.type != .semanticCloze })
        }
        return variants.first(where: { $0.type == .multipleChoice })
            ?? variants.first(where: { $0.type != .semanticCloze })
    }

    @ViewBuilder
    private var recallVariantControl: some View {
        if let variant = activeRecallVariant {
            VStack(alignment: .leading, spacing: 12) {
                Text(variant.type == .trueFalse ? "判断一下" : "选出最准确的一项")
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.textMuted)

                Text(variant.prompt)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(V2Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if variant.type == .trueFalse {
                    HStack(spacing: 10) {
                        variantButton("对") {
                            answerVariant(variant.correctBoolean == true)
                        }
                        variantButton("不对") {
                            answerVariant(variant.correctBoolean == false)
                        }
                    }
                } else {
                    VStack(spacing: 9) {
                        ForEach(variant.options) { option in
                            variantButton(option.text) {
                                answerVariant(option.id == variant.correctOptionId)
                            }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
        }
    }

    private func variantButton(
        _ title: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(V2Typography.bodySmallEmphasis)
                .foregroundStyle(V2Color.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(V2Color.surfaceCream)
                        .overlay(
                            RoundedRectangle(cornerRadius: 13, style: .continuous)
                                .stroke(V2Color.primary.opacity(0.28), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }

    private var semanticRevealControl: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(maskedCoreKnowledge)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(V2Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            V2ScratchRevealCanvas(
                hiddenText: hiddenSemanticText,
                reduceMotion: reduceMotion,
                paths: $scratchPaths,
                coveredCells: $coveredScratchCells,
                coverage: $revealProgress,
                isDrawing: $isRevealDragging,
                onScratchStart: {
                    if phase == .recall {
                        phase = .scratching
                    }
                },
                onReveal: reveal
            )
            .scaleEffect(x: 1, y: isRevealDragging && !reduceMotion ? 1.01 : 1)
            .accessibilityIdentifier("v2.semantic-reveal")

            Text("铅笔笔刷 26pt；刮开 45% 后完整揭示，也可以直接揭晓")
                .font(V2Typography.caption)
                .foregroundStyle(V2Color.textMuted)
        }
    }

    private var maskedCoreKnowledge: String {
        let core = currentCard.card.coreKnowledge
        let hidden = hiddenSemanticText
        guard core.contains(hidden) else { return core }
        return core.replacingOccurrences(
            of: hidden,
            with: String(repeating: "▰", count: min(max(hidden.count, 4), 12))
        )
    }

    private var hiddenSemanticText: String {
        let value = currentCard.card.hiddenSemantic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "这张卡暂时没有可揭示语义" : value
    }

    private var revealedContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Divider()

            if !variantFeedback.isEmpty {
                Text(variantFeedback)
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.primary)
            }

            Text(currentCard.card.coreKnowledge)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(V2Color.primary)
                .fixedSize(horizontal: false, vertical: true)

            Text(currentCard.card.explanation)
                .font(V2Typography.body)
                .foregroundStyle(V2Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if let reason = currentCard.card.rarityReason {
                Text(reason)
                    .font(V2Typography.caption)
                    .foregroundStyle(V2Color.textMuted)
            }

            screenshotPreview
            sourceFooter
        }
    }

    private var screenshotPreview: some View {
        Group {
            if let image = UIImage(data: currentCard.screenshotData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .accessibilityLabel("原始截图")
    }

    @ViewBuilder
    private var sourceFooter: some View {
        if currentCard.card.sourceStatus == .verified,
           let sourceURLString = currentCard.card.sourceUrl,
           let sourceURL = URL(string: sourceURLString) {
            Link(destination: sourceURL) {
                Label(currentCard.card.sourceTitle ?? "查看已核对来源", systemImage: "arrow.up.right.square")
                    .font(V2Typography.bodySmallEmphasis)
                    .foregroundStyle(V2Color.primary)
                    .lineLimit(2)
            }
        } else {
            Label(sourceStatusTitle, systemImage: sourceStatusSymbol)
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textMuted)
        }
    }

    private var assessmentButtons: some View {
        VStack(spacing: 10) {
            Text("刚才想起来了吗？")
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textSecondary)

            HStack(spacing: 8) {
                assessmentButton("记得", assessment: .remembered, color: V2Color.primary)
                assessmentButton("模糊", assessment: .fuzzy, color: Color(hex: 0xD3A34A))
                assessmentButton("忘记", assessment: .forgot, color: V2Color.textSecondary)
            }
        }
    }

    private func assessmentButton(
        _ title: String,
        assessment: V2MemoryAssessment,
        color: Color
    ) -> some View {
        Button {
            completeAssessment(assessment)
        } label: {
            Text(title)
                .font(V2Typography.label)
                .foregroundStyle(color)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(V2Color.surfaceCream)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(color.opacity(0.7), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
        .disabled(phase != .revealed)
        .accessibilityIdentifier("v2.assessment.\(assessment.rawValue)")
    }

    private var feedbackLanding: some View {
        VStack(spacing: 20) {
            ZStack {
                if assessment != .remembered {
                    Image("RecalloParticlePuff")
                        .resizable()
                        .renderingMode(.template)
                        .foregroundStyle(V2Color.textMuted.opacity(0.14))
                        .frame(width: 178, height: 178)
                        .accessibilityHidden(true)
                }

                V2RecallMascotView(state: mascotState, reduceMotion: reduceMotion)
                    .frame(width: 164, height: 164)
                    .offset(y: feedbackMascotOffset)
                    .offset(
                        y: assessment == .forgot && phase == .assessing && !reduceMotion
                            ? 4
                            : 0
                    )
                    .animation(
                        reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.68),
                        value: phase
                    )
                    .changeEffect(
                        .jump(height: 18),
                        value: phase == .assessing,
                        isEnabled: assessment == .remembered && !reduceMotion
                    )
                    .changeEffect(
                        .spray(origin: .center) {
                            Image("RecalloParticleSpark")
                                .resizable()
                                .renderingMode(.template)
                                .foregroundStyle(Color(hex: 0xE8B44C))
                                .frame(width: 10, height: 10)
                        },
                        value: phase == .assessing,
                        isEnabled: assessment == .remembered && !reduceMotion
                    )
            }
            .frame(width: 230, height: 180)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(feedbackMascotAccessibilityLabel)

            Text(feedbackTitle)
                .font(.system(size: 25, weight: .bold))
                .foregroundStyle(V2Color.textPrimary)

            Text(feedbackDetail)
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textSecondary)
                .multilineTextAlignment(.center)

            if phase == .assessing && assessmentError.isEmpty {
                ProgressView()
                    .tint(V2Color.primary)
                    .accessibilityLabel("正在保存复习结果")
            }

            if !assessmentError.isEmpty {
                Text(assessmentError)
                    .font(V2Typography.caption)
                    .foregroundStyle(V2Color.textSecondary)
                    .multilineTextAlignment(.center)

                V2PrimaryActionButton(title: "重试保存") {
                    retryAssessment()
                }
                .accessibilityIdentifier("v2.assessment.retry")
            }
        }
        .v2PageColumn()
        .padding(.top, 34)
        .padding(.bottom, 36)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(
                    V2Color.primary.opacity(
                        assessment == .remembered && phase == .assessing ? 0.25 : 0
                    ),
                    lineWidth: 2
                )
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 0.6),
                    value: phase
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(
                    V2Color.textMuted.opacity(
                        assessment == .fuzzy && phase == .assessing
                            ? (fuzzyBreathActive ? 0.4 : 0.15)
                            : 0
                    ),
                    lineWidth: 1.5
                )
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: 0.8),
                    value: fuzzyBreathActive
                )
        )
        .onChange(of: phase) { _, newPhase in
            if newPhase == .assessing && assessment == .fuzzy {
                fuzzyBreathActive = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    fuzzyBreathActive = false
                }
            }
        }
    }

    private var pausedLanding: some View {
        VStack(spacing: 18) {
            Spacer()
            V2RecallMascotView(state: .sleeping, reduceMotion: reduceMotion)
                .frame(width: 150, height: 150)
            Text("这段回忆先停在这里")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(V2Color.textPrimary)
            Text("回到 App 后会从同一张卡、同一处刮痕继续。")
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textSecondary)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .v2PageColumn()
        .accessibilityElement(children: .contain)
    }

    private var stowingLanding: some View {
        VStack(spacing: 20) {
            Spacer()
            V2RecallMascotView(state: .farewell, reduceMotion: reduceMotion)
                .frame(width: 170, height: 170)
            Text("毛球把记忆收好了")
                .font(.system(size: 25, weight: .bold))
                .foregroundStyle(V2Color.textPrimary)
            Text("下次需要时，它会带着这张卡回来。")
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textSecondary)
            Spacer()
        }
        .v2PageColumn()
        .task {
            try? await Task.sleep(nanoseconds: reduceMotion ? 180_000_000 : 700_000_000)
            guard !Task.isCancelled, phase == .stowing else { return }
            clearPersistedPresentation()
            onClose()
        }
    }

    private var archiveLanding: some View {
        VStack(spacing: 18) {
            ZStack(alignment: .bottomTrailing) {
                if currentIndex + 1 < session.cards.count {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(V2Color.surfaceCream.opacity(0.76))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(V2Color.primary.opacity(0.22), lineWidth: 1)
                        )
                        .frame(height: 92)
                        .offset(x: 12, y: 12)
                        .rotationEffect(.degrees(reduceMotion ? 0 : 3))
                        .accessibilityLabel("下一张记忆卡已准备好")
                }

                HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(V2Color.pageGreenBackground)
                    Image(systemName: session.pool.symbolName)
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(V2Color.primary)
                }
                .frame(width: 76, height: 92)

                VStack(alignment: .leading, spacing: 7) {
                    rarityBadge
                    Text(currentCard.card.hiddenSemantic ?? currentCard.card.coreKnowledge)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(V2Color.textPrimary)
                        .lineLimit(3)
                    Text("已收入个人收藏")
                        .font(V2Typography.caption)
                        .foregroundStyle(V2Color.textMuted)
                }

                Spacer(minLength: 0)
            }
            .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 19, style: .continuous)
                        .fill(V2Color.surfaceCream)
                        .v2Shadow()
                )
            }

            V2RecallMascotView(state: .turning, reduceMotion: reduceMotion)
                .frame(width: 92, height: 92)
                .accessibilityLabel("毛球正在等待你的选择")

            Text("记忆已修复并入册")
                .font(.system(size: 25, weight: .bold))
                .foregroundStyle(V2Color.textPrimary)

            Text(assessment == .remembered
                 ? "你完成了一次主动重建。它会在新的时间窗口再次出现。"
                 : "记忆没有被惩罚或摧毁，系统只会让它更早再次出现。")
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textSecondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 14) {
                HStack(spacing: 4) {
                    ForEach(V2MemoryMasteryStage.allCases, id: \.rawValue) { stage in
                        masteryStep(stage)
                    }
                }

                Text("\(masteryBefore.title) → \(masteryAfter.title) · \(currentSchedule?.displayText ?? "下次复习时间待同步")")
                    .font(V2Typography.captionEmphasis)
                    .foregroundStyle(V2Color.primary)
                    .accessibilityIdentifier("v2.schedule.next-review")
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(V2Color.surfaceCream)
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(V2Color.primary.opacity(0.22), lineWidth: 1)
                    )
            )

            V2PrimaryActionButton(
                title: currentIndex + 1 < session.cards.count ? "继续下一张" : "今天先到这里",
                tone: .normal
            ) {
                if currentIndex + 1 < session.cards.count {
                    advanceToNextCard()
                } else {
                    stowAndClose()
                }
            }
            .accessibilityHint(
                currentIndex + 1 < session.cards.count
                    ? "只取回下一张，完成后仍可停止"
                    : "让毛球把这张卡收好"
            )

            Button("先收好", action: stowAndClose)
                .frame(minWidth: 44, minHeight: 44)
                .font(V2Typography.bodySmallEmphasis)
                .foregroundStyle(V2Color.textSecondary)
        }
        .v2PageColumn()
        .padding(.bottom, 36)
        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
    }

    private func masteryStep(_ stage: V2MemoryMasteryStage) -> some View {
        VStack(spacing: 6) {
            Circle()
                .fill(stage.rawValue <= masteryAfter.rawValue ? V2Color.primary : V2Color.surfaceCream)
                .overlay(
                    Circle()
                        .stroke(
                            stage.rawValue <= masteryAfter.rawValue
                                ? V2Color.primary
                                : V2Color.primary.opacity(0.22),
                            lineWidth: 2
                        )
                )
                .frame(width: 14, height: 14)
            Text(stage.title)
                .font(.system(size: 9, weight: stage == masteryAfter ? .bold : .regular))
                .foregroundStyle(stage.rawValue <= masteryAfter.rawValue ? V2Color.primary : V2Color.textMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private var fragmentCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("记忆碎片 · \(sourceStatusTitle)", systemImage: "sparkles.rectangle.stack")
                .font(V2Typography.bodySmallEmphasis)
                .foregroundStyle(V2Color.textMuted)

            Text(currentCard.card.coreKnowledge)
                .font(.system(size: 23, weight: .bold))
                .foregroundStyle(V2Color.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            screenshotPreview

            Text(currentCard.card.explanation)
                .font(V2Typography.body)
                .foregroundStyle(V2Color.textSecondary)

            Text(currentCard.card.recallCue)
                .font(V2Typography.bodySmall)
                .foregroundStyle(V2Color.textMuted)

            V2PrimaryActionButton(title: "碎片已保存，返回知识库") {
                stowAndClose()
            }
        }
        .padding(22)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(V2Color.surfaceCream)
                .v2Shadow()
        )
        .v2PageColumn()
        .padding(.bottom, 36)
    }

    private var rarityColor: Color {
        switch currentCard.card.rarity {
        case .ssr:
            Color(hex: 0xD9852C)
        case .sr:
            Color(hex: 0x4F87B9)
        default:
            V2Color.textSecondary
        }
    }

    private var sourceStatusTitle: String {
        switch currentCard.card.sourceStatus {
        case .verified: "来源已核对"
        case .partial: "部分来源已核对"
        case .unconfirmed: "来源尚未确认"
        }
    }

    private var sourceStatusSymbol: String {
        switch currentCard.card.sourceStatus {
        case .verified: "checkmark.seal.fill"
        case .partial: "checkmark.seal"
        case .unconfirmed: "questionmark.circle"
        }
    }

    private var sourceStatusColor: Color {
        switch currentCard.card.sourceStatus {
        case .verified: V2Color.primary
        case .partial: Color(hex: 0xD3A34A)
        case .unconfirmed: V2Color.textMuted
        }
    }

    private var scenePalette: V2RecallScenePalette {
        switch phase {
        case .home: return .creamReady
        case .summoning, .assessing: return .mistProcessing
        case .recall, .scratching: return .coralRecall
        case .revealed: return .creamReady
        case .checkpoint, .stowing: return .sageLibrary
        case .paused: return colorScheme == .dark ? .navyNight : .lavenderPaused
        }
    }

    private var sceneBackgroundColor: Color {
        switch scenePalette {
        case .creamReady: return Color(hex: 0xFFF6E8)
        case .mistProcessing: return Color(hex: 0xE9EEF0)
        case .coralRecall: return Color(hex: 0xF7C6B1)
        case .lavenderPaused: return Color(hex: 0xE7E0EF)
        case .sageLibrary: return Color(hex: 0xDCE7D5)
        case .navyNight: return Color(hex: 0x26384D)
        }
    }

    private var mascotState: V2RecallMascotState {
        switch phase {
        case .home: return .idle
        case .summoning:
            switch summonStage {
            case .compress: return .turning
            case .rise, .orbit: return .rummaging
            case .settle, .cue: return .carrying
            }
        case .recall, .scratching: return .watching
        case .revealed: return .acknowledging
        case .assessing:
            switch assessment {
            case .remembered: return .acknowledging
            case .fuzzy: return .turning
            case .forgot: return .thinking
            case nil: return .watching
            }
        case .checkpoint: return .turning
        case .stowing: return .farewell
        case .paused: return .sleeping
        }
    }

    private var feedbackMascotOffset: CGFloat {
        guard !reduceMotion, phase == .assessing, assessment == .remembered else { return 0 }
        return -10
    }

    private var feedbackMascotAccessibilityLabel: String {
        switch assessment {
        case .remembered: "记忆反馈：记得"
        case .fuzzy: "记忆反馈：模糊"
        case .forgot: "记忆反馈：忘记"
        case nil: "记忆反馈：处理中"
        }
    }

    private var feedbackTitle: String {
        if !assessmentError.isEmpty { return "结果还没有保存" }
        switch assessment {
        case .remembered: return "这段记忆更清晰了"
        case .fuzzy: return "已经找到一点轮廓"
        case .forgot: return "没关系，下次再修复"
        case nil: return "正在安排下次召回"
        }
    }

    private var feedbackDetail: String {
        if !assessmentError.isEmpty {
            return "保留当前选择并重试，不会重复记录。"
        }
        switch assessment {
        case .remembered: "毛球记下了这次主动重建。"
        case .fuzzy: "系统会把它安排在更合适的时间再次出现。"
        case .forgot: "记忆不会被惩罚，只会更早回来。"
        case nil: "正在处理这次复习。"
        }
    }

    private func reveal() {
        let animation: Animation? = reduceMotion ? nil : .easeOut(duration: 0.22)
        withAnimation(animation) {
            revealProgress = 1
            isRevealed = true
            phase = .revealed
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func answerVariant(_ isCorrect: Bool) {
        variantFeedback = isCorrect
            ? "回答正确 · 现在检查证据"
            : "这次没有答对 · 不扣分，只会更早复习"
        reveal()
    }

    private func completeAssessment(_ value: V2MemoryAssessment) {
        guard pendingAssessment == nil, phase == .revealed else { return }
        guard !assessedReviewCycles.contains(currentReviewCycleKey) else {
            phase = .checkpoint
            return
        }
        masteryBefore = currentCard.masteryStage
        masteryAfter = currentCard.masteryStage.applying(value)
        assessment = value
        pendingAssessment = V2PendingScreenshotAssessment(
            assessment: value,
            attemptId: "ios-capture-assessment-\(currentReviewCycleKey)"
        )
        assessmentError = ""
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.78)) {
            phase = .assessing
        }
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        submitPendingAssessment(includesReactionDelay: true)
    }

    private func retryAssessment() {
        guard pendingAssessment != nil else { return }
        assessmentError = ""
        submitPendingAssessment(includesReactionDelay: false)
    }

    private func submitPendingAssessment(includesReactionDelay: Bool) {
        guard let pendingAssessment else { return }
        assessmentTask?.cancel()
        assessmentTask = Task {
            if includesReactionDelay {
                try? await Task.sleep(
                    nanoseconds: reduceMotion ? 150_000_000 : 520_000_000
                )
            }
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: reduceMotion ? 0.12 : 0.2)) {
                phase = .assessing
            }
            do {
                let completedReviewCycleKey = currentReviewCycleKey
                let response = try await onAssessment(
                    currentCard.id,
                    pendingAssessment.assessment,
                    pendingAssessment.attemptId
                )
                guard !Task.isCancelled else { return }
                let canonicalAssessment = response.canonicalAssessment(fallback: pendingAssessment.assessment)
                currentSchedule = response.schedule
                assessment = canonicalAssessment
                if let serverMastery = response.mastery {
                    masteryBefore = V2MemoryMasteryStage(rawServerValue: serverMastery.before)
                        ?? currentCard.masteryStage
                    masteryAfter = V2MemoryMasteryStage(rawServerValue: serverMastery.after)
                        ?? currentCard.masteryStage.applying(canonicalAssessment)
                }
                self.pendingAssessment = nil
                withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .easeOut(duration: 0.24)) {
                    var updatedReviewCycles = assessedReviewCycles
                    updatedReviewCycles.insert(completedReviewCycleKey)
                    persistedAssessedReviewCycles = updatedReviewCycles.sorted().suffix(64).joined(separator: ",")
                    phase = .checkpoint
                }
            } catch is CancellationError {
                return
            } catch {
                assessmentError = error.localizedDescription
                withAnimation(.easeOut(duration: 0.18)) {
                    phase = .assessing
                }
            }
        }
    }

    private func advanceToNextCard() {
        guard currentIndex + 1 < session.cards.count else {
            stowAndClose()
            return
        }
        let animation: Animation? = reduceMotion ? nil : .easeOut(duration: 0.18)
        withAnimation(animation) {
            currentIndex += 1
            phase = .summoning
            summonStage = .compress
            isRevealed = false
            revealProgress = 0
            isRevealDragging = false
            assessment = nil
            currentSchedule = session.cards[currentIndex].schedule
            presentationReviewCycleKey = session.cards[currentIndex]
                .reviewCycleKey(scheduleOverride: currentSchedule)
            pendingAssessment = nil
            assessmentError = ""
            variantFeedback = ""
            fuzzyBreathActive = false
            scratchPaths = []
            coveredScratchCells = []
        }
        persistPresentationState()
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private var currentReviewCycleKey: String {
        presentationReviewCycleKey.isEmpty
            ? currentCard.reviewCycleKey(scheduleOverride: currentSchedule)
            : presentationReviewCycleKey
    }

    private var assessedReviewCycles: Set<String> {
        Set(
            persistedAssessedReviewCycles
                .split(separator: ",")
                .map(String.init)
                .filter { !$0.isEmpty }
        )
    }

    private func stowAndClose() {
        assessmentTask?.cancel()
        withAnimation(reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.4, dampingFraction: 0.82)) {
            phase = .stowing
        }
    }

    private func stablePhase(for candidate: V2RecallPresentationPhase) -> V2RecallPresentationPhase {
        switch candidate {
        case .summoning:
            return .recall
        case .assessing:
            return isRevealed ? .revealed : .recall
        case .stowing:
            return .checkpoint
        case .paused:
            return phaseBeforePause
        default:
            return candidate
        }
    }

    private func persistPresentationState() {
        persistedCardID = currentCard.id
        persistedPresentationReviewCycleKey = currentReviewCycleKey
        persistedCurrentIndex = currentIndex
        persistedPhase = stablePhase(for: phase).rawValue
        persistedRevealCoverage = Double(revealProgress)
        persistedIsRevealed = isRevealed
        persistedCoveredCells = coveredScratchCells.sorted().joined(separator: ",")
        persistedScratchPaths = scratchPaths.map { points in
            points.map { point in
                "\(point.x):\(point.y)"
            }.joined(separator: ";")
        }.joined(separator: "|")
        persistedAssessment = assessment?.rawValue ?? ""
        persistedMasteryBefore = masteryBefore.rawValue
        persistedMasteryAfter = masteryAfter.rawValue
        persistedScheduleNextReviewAt = currentSchedule?.nextReviewAt ?? ""
        persistedScheduleIntervalDays = currentSchedule?.intervalDays ?? 0
        persistedScheduleState = currentSchedule?.state ?? ""
        persistedScheduleStatus = currentSchedule?.status ?? ""
    }

    private func restorePersistedState() {
        let restoredIndex = min(max(0, persistedCurrentIndex), session.cards.count - 1)
        let restoredCard = session.cards[restoredIndex]
        guard restoredCard.matchesPersistedPresentation(
            cardID: persistedCardID,
            reviewCycleKey: persistedPresentationReviewCycleKey
        ) else {
            resetPresentationForCurrentCycle()
            return
        }

        currentIndex = restoredIndex
        presentationReviewCycleKey = persistedPresentationReviewCycleKey
        currentSchedule = persistedScheduleNextReviewAt.isEmpty
            ? currentCard.schedule
            : ImageFlowReviewSchedule(
                nextReviewAt: persistedScheduleNextReviewAt,
                intervalDays: persistedScheduleIntervalDays,
                state: persistedScheduleState,
                status: persistedScheduleStatus.isEmpty ? nil : persistedScheduleStatus
            )
        assessment = V2MemoryAssessment(rawValue: persistedAssessment)
        masteryBefore = V2MemoryMasteryStage(rawValue: persistedMasteryBefore) ?? currentCard.masteryStage
        masteryAfter = V2MemoryMasteryStage(rawValue: persistedMasteryAfter) ?? masteryBefore
        revealProgress = CGFloat(persistedRevealCoverage)
        isRevealed = persistedIsRevealed
        coveredScratchCells = Set(
            persistedCoveredCells.split(separator: ",").map(String.init)
        )
        scratchPaths = persistedScratchPaths.split(separator: "|").map { rawPath in
            rawPath.split(separator: ";").compactMap { rawPoint in
                let values = rawPoint.split(separator: ":")
                guard values.count == 2,
                      let x = Double(values[0]),
                      let y = Double(values[1]) else { return nil }
                return CGPoint(x: x, y: y)
            }
        }

        let restoredPhase = V2RecallPresentationPhase(rawValue: persistedPhase) ?? .recall
        if assessedReviewCycles.contains(currentReviewCycleKey) {
            phase = .checkpoint
        } else if isRevealed {
            phase = .revealed
        } else {
            phase = stablePhase(for: restoredPhase)
        }
        phaseBeforePause = phase
    }

    private func resetPresentationForCurrentCycle() {
        currentIndex = 0
        let card = session.cards[0]
        currentSchedule = card.schedule
        presentationReviewCycleKey = card.reviewCycleKey(scheduleOverride: card.schedule)
        phase = .summoning
        phaseBeforePause = .recall
        summonStage = .compress
        isRevealed = false
        revealProgress = 0
        isRevealDragging = false
        assessment = nil
        masteryBefore = card.masteryStage
        masteryAfter = card.masteryStage
        pendingAssessment = nil
        assessmentError = ""
        variantFeedback = ""
        fuzzyBreathActive = false
        scratchPaths = []
        coveredScratchCells = []
    }

    private func clearPersistedPresentation() {
        persistedCardID = ""
        persistedPresentationReviewCycleKey = ""
        persistedCurrentIndex = 0
        persistedPhase = V2RecallPresentationPhase.home.rawValue
        persistedRevealCoverage = 0
        persistedIsRevealed = false
        persistedScratchPaths = ""
        persistedCoveredCells = ""
        persistedAssessment = ""
        persistedMasteryBefore = V2MemoryMasteryStage.sealed.rawValue
        persistedMasteryAfter = V2MemoryMasteryStage.sealed.rawValue
        persistedScheduleNextReviewAt = ""
        persistedScheduleIntervalDays = 0
        persistedScheduleState = ""
        persistedScheduleStatus = ""
    }

    private func finishSummon() {
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .easeOut(duration: 0.18)) {
            phase = .recall
        }
    }

    private func advanceSummon(
        after nanoseconds: UInt64,
        to nextStage: V2ScreenshotSummonVisualStage
    ) async -> Bool {
        try? await Task.sleep(nanoseconds: nanoseconds)
        guard !Task.isCancelled, phase == .summoning else { return false }
        let spring: Animation = nextStage == .cue
            ? .spring(response: 0.28, dampingFraction: 0.68)
            : .spring(response: 0.32, dampingFraction: 0.78)
        withAnimation(spring) {
            summonStage = nextStage
        }
        return true
    }
}
