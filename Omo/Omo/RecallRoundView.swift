import SwiftUI
import UIKit

struct RecallRoundView: View {
    let cards: [MemoryCard]
    let onAssess: (MemoryCard, MemoryAssessment) async throws -> Void
    let onComplete: () -> Void
    let onOpenLibrary: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var state: RecallRoundState
    @State private var summonProgress: CGFloat = 0
    @State private var removalProgress: CGFloat = 0
    @State private var errorMessage = ""

    init(
        cards: [MemoryCard],
        onAssess: @escaping (MemoryCard, MemoryAssessment) async throws -> Void,
        onComplete: @escaping () -> Void,
        onOpenLibrary: @escaping () -> Void
    ) {
        self.cards = cards
        self.onAssess = onAssess
        self.onComplete = onComplete
        self.onOpenLibrary = onOpenLibrary
        var initialState = RecallRoundState(cardCount: cards.count)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-OmoRecallRevealed") {
            initialState.updateCoverage(1)
        }
        #endif
        _state = State(initialValue: initialState)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let card = currentCard {
                RecallCardStack(
                    cards: cards,
                    currentIndex: state.currentIndex,
                    coverage: coverageBinding,
                    removalProgress: removalProgress,
                    isScratchEnabled: state.canScratch,
                    onOpenContext: onOpenLibrary
                )
                .id(card.id)
                .scaleEffect(reduceMotion ? 1 : 0.9 + summonProgress * 0.1)
                .rotationEffect(.degrees(reduceMotion ? 0 : Double(1 - summonProgress) * -7))
                .offset(y: reduceMotion ? 0 : (1 - summonProgress) * 190)
                .opacity(reduceMotion ? 1 : 0.45 + summonProgress * 0.55)
                .position(x: RecallHomeMetrics.cardStackFrame.midX, y: RecallHomeMetrics.cardStackFrame.midY)

                if state.showsRating {
                    RecallRatingSlider(
                        isEnabled: !isSubmitting,
                        onCommit: submit,
                        onCancel: { UISelectionFeedbackGenerator().selectionChanged() }
                    )
                    .id("rating-\(card.id)")
                    .position(x: RecallHomeMetrics.ratingFrame.midX, y: RecallHomeMetrics.ratingFrame.midY)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .opacity(1 - removalProgress)
                }

                if isSubmitting {
                    ProgressView()
                        .tint(RecallPalette.teal)
                        .frame(width: 44, height: 44)
                        .position(x: RecallHomeMetrics.ratingFrame.midX, y: RecallHomeMetrics.ratingFrame.midY)
                        .accessibilityLabel("正在保存记忆状态")
                }

                if !errorMessage.isEmpty {
                    Button(action: retry) {
                        Label("保存失败，点此重试", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(RecallPalette.error)
                            .frame(width: RecallHomeMetrics.errorFrame.width, height: RecallHomeMetrics.errorFrame.height)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .position(x: RecallHomeMetrics.errorFrame.midX, y: RecallHomeMetrics.errorFrame.midY)
                }
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: state.showsRating)
        .task(id: state.currentIndex) { await summonCurrentCard() }
    }

    private var currentCard: MemoryCard? {
        guard cards.indices.contains(state.currentIndex) else { return nil }
        return cards[state.currentIndex]
    }

    private var isSubmitting: Bool {
        if case .submitting = state.phase { return true }
        return false
    }

    private var coverageBinding: Binding<Double> {
        Binding(get: { state.coverage }, set: { state.updateCoverage($0) })
    }

    @MainActor
    private func summonCurrentCard() async {
        guard currentCard != nil else {
            onComplete()
            return
        }
        summonProgress = reduceMotion ? 1 : 0
        withAnimation(reduceMotion ? .none : .spring(response: 0.62, dampingFraction: 0.82)) {
            summonProgress = 1
        }
        if !reduceMotion {
            try? await Task.sleep(for: .milliseconds(620))
        }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func submit(_ assessment: MemoryAssessment) {
        guard let card = currentCard, !isSubmitting else { return }
        state.beginSubmission(assessment)
        errorMessage = ""
        Task {
            do {
                try await onAssess(card, assessment)
                await advance()
            } catch {
                state.failSubmission()
                errorMessage = error.localizedDescription
            }
        }
    }

    private func retry() {
        guard let card = currentCard, let assessment = state.retryAssessment() else { return }
        errorMessage = ""
        Task {
            do {
                try await onAssess(card, assessment)
                await advance()
            } catch {
                state.failSubmission()
                errorMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func advance() async {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if reduceMotion {
            state.finishSubmission()
        } else {
            withAnimation(.easeIn(duration: 0.28)) { removalProgress = 1 }
            try? await Task.sleep(for: .milliseconds(280))
            state.finishSubmission()
            removalProgress = 0
        }
        if state.isComplete { onComplete() }
    }
}

private struct RecallCardStack: View {
    let cards: [MemoryCard]
    let currentIndex: Int
    @Binding var coverage: Double
    let removalProgress: CGFloat
    let isScratchEnabled: Bool
    let onOpenContext: () -> Void

    private var visibleCards: ArraySlice<MemoryCard> {
        let end = min(cards.count, currentIndex + RecallCardMetrics.visibleLayerCount)
        return cards[currentIndex..<end]
    }

    var body: some View {
        ZStack {
            ForEach(Array(visibleCards.enumerated()).reversed(), id: \.element.id) { depth, card in
                if depth == 0 {
                    activeCard(card)
                        .offset(x: removalProgress * 330, y: -removalProgress * 38)
                        .rotationEffect(.degrees(Double(removalProgress) * 8))
                        .opacity(1 - removalProgress)
                        .zIndex(10)
                } else {
                    backingCard(card, depth: depth)
                }
            }
        }
        .frame(width: RecallHomeMetrics.cardStackFrame.width, height: RecallHomeMetrics.cardStackFrame.height)
    }

    private func backingCard(_ card: MemoryCard, depth: Int) -> some View {
        let spread = CGFloat(depth)
        return RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius, style: .continuous)
            .fill(depth == 1 ? RecallPalette.tealSoft : RecallPalette.card)
            .overlay(RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius).stroke(RecallPalette.teal, lineWidth: 1))
            .shadow(color: rarityColor(card.rarity).opacity(depth == 1 ? 0.55 : 0.12), radius: depth == 1 ? 13 : 4)
            .shadow(color: Color.black.opacity(0.16), radius: 3, x: 2, y: 4)
            .rotationEffect(.degrees(Double(depth) * 1.7))
            .offset(x: spread * 5, y: -spread * 7)
            .accessibilityHidden(true)
    }

    private func activeCard(_ card: MemoryCard) -> some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius, style: .continuous)
                .fill(RecallPalette.card)
                .overlay(RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius).stroke(RecallPalette.teal, lineWidth: 1))
                .shadow(color: Color.black.opacity(0.22), radius: 4, x: 3, y: 5)

            VStack(alignment: .leading, spacing: 12) {
                Text(card.recallCue)
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(RecallPalette.ink)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                ScratchAnswerView(
                    answer: card.answer,
                    coverage: $coverage,
                    isEnabled: isScratchEnabled
                )
            }
            .padding(RecallCardMetrics.contentInset)

            Button(action: onOpenContext) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(RecallPalette.teal)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("查看完整知识")
        }
        .accessibilityElement(children: .contain)
    }

    private func rarityColor(_ rarity: String) -> Color {
        switch rarity {
        case "SSR": RecallPalette.coral
        case "SR": Color(red: 0.49, green: 0.72, blue: 0.80)
        default: RecallPalette.teal
        }
    }
}

private struct ScratchAnswerView: View {
    let answer: String
    @Binding var coverage: Double
    let isEnabled: Bool

    @State private var paths: [[CGPoint]] = []
    @State private var coveredCells: Set<Int> = []
    @State private var isDrawing = false
    @State private var didReveal = false

    private let columns = 14
    private let rows = 4

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Canvas { context, size in
                    let text = context.resolve(
                        Text(answer)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(RecallPalette.coral)
                    )
                    context.draw(text, in: CGRect(x: 8, y: 6, width: size.width - 16, height: size.height - 12))
                }
                .accessibilityHidden(true)

                if coverage < 1 {
                    Canvas { context, size in
                        context.fill(
                            Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.height / 2),
                            with: .color(RecallPalette.tealSoft)
                        )
                        context.blendMode = .destinationOut
                        for normalizedPath in paths where normalizedPath.count > 1 {
                            var path = Path()
                            path.move(to: rendered(normalizedPath[0], in: size))
                            for point in normalizedPath.dropFirst() { path.addLine(to: rendered(point, in: size)) }
                            context.stroke(
                                path,
                                with: .color(.black),
                                style: StrokeStyle(lineWidth: RecallCardMetrics.brushDiameter, lineCap: .round, lineJoin: .round)
                            )
                        }
                    }
                    .drawingGroup()
                    .allowsHitTesting(false)
                }
            }
            .contentShape(Capsule())
            .gesture(scratchGesture(in: geometry.size))
        }
        .frame(height: RecallCardMetrics.scratchHeight)
        .allowsHitTesting(isEnabled && coverage < 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(coverage >= 1 ? "答案，\(answer)" : "被遮住的答案")
        .accessibilityValue(coverage >= 1 ? "已揭示" : "已刮开 \(Int(coverage * 100))%")
        .accessibilityHint(coverage >= 1 ? "答案已经完整揭示" : "滑动刮开，达到百分之八十后完整显示")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: setCoverage(coverage + 0.2)
            case .decrement: setCoverage(coverage - 0.2)
            @unknown default: break
            }
        }
    }

    private func scratchGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard isEnabled, coverage < 1 else { return }
                if !isDrawing {
                    isDrawing = true
                    paths.append([])
                }
                paths[paths.count - 1].append(normalized(value.location, in: size))
                markCells(around: value.location, in: size)
            }
            .onEnded { _ in isDrawing = false }
    }

    private func normalized(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: min(1, max(0, point.x / size.width)), y: min(1, max(0, point.y / size.height)))
    }

    private func rendered(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }

    private func markCells(around point: CGPoint, in size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let column = min(columns - 1, max(0, Int(point.x / size.width * CGFloat(columns))))
        let row = min(rows - 1, max(0, Int(point.y / size.height * CGFloat(rows))))
        for x in max(0, column - 1)...min(columns - 1, column + 1) {
            for y in max(0, row - 1)...min(rows - 1, row + 1) {
                coveredCells.insert(y * columns + x)
            }
        }
        setCoverage(Double(coveredCells.count) / Double(columns * rows))
    }

    private func setCoverage(_ value: Double) {
        let next = min(1, max(0, value))
        coverage = next >= RecallRoundState.revealThreshold ? 1 : next
        if coverage == 1, !didReveal {
            didReveal = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            UIAccessibility.post(notification: .announcement, argument: "答案已完整揭示")
        }
    }
}

private struct RecallRatingSlider: View {
    let isEnabled: Bool
    let onCommit: (MemoryAssessment) -> Void
    let onCancel: () -> Void

    @State private var position = RecallRatingScale.cancelPosition
    @State private var activeAssessment: MemoryAssessment?

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let travel = max(1, width - RecallRatingMetrics.knobSize.width)
            ZStack(alignment: .leading) {
                track(width: width, travel: travel)
                labels(width: width, travel: travel)
                knob(travel: travel)
            }
            .frame(height: RecallRatingMetrics.totalHeight)
            .contentShape(Rectangle())
            .gesture(dragGesture(travel: travel))
        }
        .frame(width: RecallHomeMetrics.ratingFrame.width, height: RecallRatingMetrics.totalHeight)
        .opacity(isEnabled ? 1 : 0.62)
        .accessibilityRepresentation {
            Slider(
                value: Binding(
                    get: { RecallRatingScale.position(for: activeAssessment) },
                    set: { value in activeAssessment = RecallRatingScale.nearestAssessment(at: value) }
                ),
                in: 0...1,
                step: 0.01
            )
            .accessibilityLabel("记忆状态")
            .accessibilityValue(activeAssessment?.title ?? "未选择")
        }
    }

    private func track(width: CGFloat, travel: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Capsule().fill(RecallPalette.teal.opacity(0.18))
            Capsule()
                .fill(activeColor)
                .frame(width: RecallRatingMetrics.knobSize.width / 2 + CGFloat(position) * travel)
            ForEach(RecallRatingScale.nodes, id: \.assessment) { node in
                Circle()
                    .fill(node.assessment == activeAssessment ? activeColor : RecallPalette.teal.opacity(0.45))
                    .frame(width: RecallRatingMetrics.nodeDiameter, height: RecallRatingMetrics.nodeDiameter)
                    .position(x: RecallRatingMetrics.knobSize.width / 2 + CGFloat(node.position) * travel, y: RecallRatingMetrics.trackHeight / 2)
            }
        }
        .frame(width: width, height: RecallRatingMetrics.trackHeight)
        .shadow(color: activeColor.opacity(0.28), radius: 5, y: 3)
    }

    private func labels(width: CGFloat, travel: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(RecallRatingScale.nodes, id: \.assessment) { node in
                Text(node.assessment.title)
                    .font(.system(size: 11, weight: node.assessment == activeAssessment ? .bold : .medium))
                    .foregroundStyle(RecallPalette.ink.opacity(node.assessment == activeAssessment ? 1 : 0.62))
                    .position(x: RecallRatingMetrics.knobSize.width / 2 + CGFloat(node.position) * travel, y: 42)
            }
        }
        .frame(width: width, height: RecallRatingMetrics.totalHeight)
    }

    private func knob(travel: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(RecallPalette.drawer)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(activeColor, lineWidth: 2))
            .shadow(color: activeColor.opacity(0.36), radius: 5, y: 3)
            .frame(width: RecallRatingMetrics.knobSize.width, height: RecallRatingMetrics.knobSize.height)
            .offset(x: CGFloat(position) * travel, y: -(RecallRatingMetrics.knobSize.height - RecallRatingMetrics.trackHeight) / 2)
    }

    private func dragGesture(travel: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard isEnabled else { return }
                let next = min(1, max(0, Double((value.location.x - RecallRatingMetrics.knobSize.width / 2) / travel)))
                position = next
                let assessment = RecallRatingScale.nearestAssessment(at: next)
                if assessment != activeAssessment {
                    activeAssessment = assessment
                    UISelectionFeedbackGenerator().selectionChanged()
                }
            }
            .onEnded { _ in
                guard isEnabled else { return }
                guard let assessment = RecallRatingScale.nearestAssessment(at: position) else {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) { position = 0 }
                    activeAssessment = nil
                    onCancel()
                    return
                }
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    position = RecallRatingScale.position(for: assessment)
                }
                onCommit(assessment)
            }
    }

    private var activeColor: Color {
        switch activeAssessment {
        case .forgot: RecallPalette.coral
        case .fuzzy: Color(red: 0.82, green: 0.61, blue: 0.28)
        case .remembered: RecallPalette.teal
        case nil: RecallPalette.tealSoft
        }
    }
}
