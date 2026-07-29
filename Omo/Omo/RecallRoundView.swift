import SwiftUI
import UIKit

struct RecallRoundView: View {
    let cards: [MemoryCard]
    let onAssess: (MemoryCard, MemoryAssessment) async throws -> Void
    let onComplete: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var state: RecallRoundState
    @State private var summonProgress: CGFloat = 0
    @State private var removalProgress: CGFloat = 0
    @State private var errorMessage = ""

    init(
        cards: [MemoryCard],
        onAssess: @escaping (MemoryCard, MemoryAssessment) async throws -> Void,
        onComplete: @escaping () -> Void
    ) {
        self.cards = cards
        self.onAssess = onAssess
        self.onComplete = onComplete
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
                RecallKnowledgeCardStack(
                    cards: cards,
                    currentIndex: state.currentIndex,
                    coverage: coverageBinding,
                    removalProgress: removalProgress,
                    isScratchEnabled: state.canScratch
                )
                .id(card.id)
                .scaleEffect(reduceMotion ? 1 : 0.9 + summonProgress * 0.1)
                .rotationEffect(.degrees(reduceMotion ? 0 : Double(1 - summonProgress) * -7))
                .offset(y: reduceMotion ? 0 : (1 - summonProgress) * 190)
                .opacity(reduceMotion ? 1 : 0.45 + summonProgress * 0.55)
                .position(
                    x: RecallHomeMetrics.cardStackFrame.midX,
                    y: RecallHomeMetrics.cardStackFrame.midY
                )

                if state.showsRating {
                    RecallRatingSlider(
                        isEnabled: !isSubmitting,
                        onCommit: submit,
                        onCancel: { UISelectionFeedbackGenerator().selectionChanged() }
                    )
                    .id("rating-\(card.id)")
                    .position(
                        x: RecallHomeMetrics.ratingFrame.midX,
                        y: RecallHomeMetrics.ratingFrame.midY
                    )
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .opacity(1 - removalProgress)
                }

                if isSubmitting {
                    ProgressView()
                        .tint(RecallPalette.teal)
                        .frame(width: 44, height: 44)
                        .position(
                            x: RecallHomeMetrics.ratingFrame.midX,
                            y: RecallHomeMetrics.ratingFrame.midY
                        )
                        .accessibilityLabel("正在保存记忆状态")
                }

                if !errorMessage.isEmpty {
                    Button(action: retry) {
                        Label("保存失败，点此重试", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(RecallPalette.error)
                            .frame(
                                width: RecallHomeMetrics.errorFrame.width,
                                height: RecallHomeMetrics.errorFrame.height
                            )
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .position(
                        x: RecallHomeMetrics.errorFrame.midX,
                        y: RecallHomeMetrics.errorFrame.midY
                    )
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
        guard let card = currentCard,
              let assessment = state.retryAssessment() else { return }
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
