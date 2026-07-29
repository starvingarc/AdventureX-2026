import SwiftUI
import UIKit

struct RecallRatingSlider: View {
    let isEnabled: Bool
    let onCommit: (MemoryAssessment) -> Void
    let onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position = RecallRatingScale.cancelPosition
    @State private var activeAssessment: MemoryAssessment?

    var body: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width, RecallRatingMetrics.trackWidth)
            let travel = width - RecallRatingMetrics.knobSize.width

            ZStack(alignment: .topLeading) {
                track(width: width, travel: travel)
                labels(width: width, travel: travel)
                knob(travel: travel)
            }
            .frame(width: width, height: RecallRatingMetrics.totalHeight)
            .frame(maxWidth: .infinity, alignment: .center)
            .contentShape(Rectangle())
            .gesture(dragGesture(travel: travel))
            .allowsHitTesting(isEnabled)
            .opacity(isEnabled ? 1 : 0.72)
        }
        .frame(width: RecallRatingMetrics.trackWidth, height: RecallRatingMetrics.totalHeight)
        .accessibilityRepresentation {
            Slider(
                value: .constant(Double(accessibilitySelectionIndex)),
                in: 0...3,
                step: 1
            )
            .accessibilityIdentifier("memory-rating-slider")
            .accessibilityLabel("记忆状态")
            .accessibilityValue(accessibilityValue)
            .accessibilityHint("调整到忘记了、没记清或记住了，然后确认")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment:
                    updateAccessibilitySelection(Double(accessibilitySelectionIndex + 1))
                case .decrement:
                    updateAccessibilitySelection(Double(accessibilitySelectionIndex - 1))
                @unknown default:
                    break
                }
            }
            .accessibilityAction(named: "确认当前记忆状态", confirmAccessibilityValue)
        }
    }

    private func track(width: CGFloat, travel: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Capsule().fill(RecallPalette.card)

            LinearGradient(
                colors: [RecallPalette.card, RecallPalette.teal.opacity(0.8)],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: max(RecallRatingMetrics.knobSize.width, knobCenter(travel: travel)))
            .clipShape(Capsule())

            ForEach(RecallRatingScale.nodes, id: \.assessment) { node in
                Circle()
                    .fill(RecallPalette.teal)
                    .frame(
                        width: RecallRatingMetrics.nodeDiameter,
                        height: RecallRatingMetrics.nodeDiameter
                    )
                    .position(
                        x: nodeCenter(for: node.assessment, travel: travel),
                        y: RecallRatingMetrics.trackHeight / 2
                    )
            }
        }
        .frame(width: width, height: RecallRatingMetrics.trackHeight)
        .overlay(Capsule().stroke(RecallPalette.teal, lineWidth: 1))
        .shadow(color: RecallPalette.ink.opacity(0.2), radius: 4, y: 4)
        .offset(y: 1.75)
    }

    private func labels(width: CGFloat, travel: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(RecallRatingScale.nodes, id: \.assessment) { node in
                Text(node.assessment.sliderTitle)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(RecallPalette.teal)
                    .frame(width: 48)
                    .position(
                        x: nodeCenter(for: node.assessment, travel: travel),
                        y: RecallRatingMetrics.labelTop + 8
                    )
            }
        }
        .frame(width: width, height: RecallRatingMetrics.totalHeight)
        .allowsHitTesting(false)
    }

    private func knob(travel: CGFloat) -> some View {
        ZStack {
            Capsule()
                .fill(RecallPalette.drawer)
                .overlay(Capsule().stroke(RecallPalette.teal, lineWidth: 1))
                .shadow(color: RecallPalette.ink.opacity(0.27), radius: 5, y: 3)

            Image(systemName: "arrow.right")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(RecallPalette.teal)
        }
        .frame(width: RecallRatingMetrics.knobSize.width, height: RecallRatingMetrics.knobSize.height)
        .offset(x: CGFloat(position) * travel)
    }

    private func dragGesture(travel: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard isEnabled, travel > 0 else { return }
                let rawPosition = Double(
                    min(
                        max(value.location.x - RecallRatingMetrics.knobSize.width / 2, 0),
                        travel
                    ) / travel
                )
                position = rawPosition
                let nextAssessment = RecallRatingScale.nearestAssessment(at: rawPosition)
                if nextAssessment != activeAssessment {
                    activeAssessment = nextAssessment
                    if nextAssessment != nil {
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
                }
            }
            .onEnded { _ in
                guard isEnabled else { return }
                guard let assessment = activeAssessment else {
                    settle(on: nil)
                    onCancel()
                    return
                }
                settle(on: assessment)
                onCommit(assessment)
            }
    }

    private func settle(on assessment: MemoryAssessment?) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.26, dampingFraction: 0.82)) {
            activeAssessment = assessment
            position = RecallRatingScale.position(for: assessment)
        }
    }

    private func knobCenter(travel: CGFloat) -> CGFloat {
        RecallRatingMetrics.knobSize.width / 2 + CGFloat(position) * travel
    }

    private func nodeCenter(for assessment: MemoryAssessment, travel: CGFloat) -> CGFloat {
        RecallRatingMetrics.knobSize.width / 2
            + CGFloat(RecallRatingScale.position(for: assessment)) * travel
    }

    private var accessibilityValue: String {
        activeAssessment?.sliderTitle ?? "未选择"
    }

    private var accessibilitySelectionIndex: Int {
        let values: [MemoryAssessment?] = [nil, .forgot, .fuzzy, .remembered]
        return values.firstIndex(where: { $0 == activeAssessment }) ?? 0
    }

    private func updateAccessibilitySelection(_ rawIndex: Double) {
        let values: [MemoryAssessment?] = [nil, .forgot, .fuzzy, .remembered]
        let index = min(values.count - 1, max(0, Int(rawIndex.rounded())))
        let next = values[index]
        if next != activeAssessment {
            UISelectionFeedbackGenerator().selectionChanged()
        }
        settle(on: next)
    }

    private func confirmAccessibilityValue() {
        guard isEnabled else { return }
        guard let activeAssessment else {
            onCancel()
            return
        }
        onCommit(activeAssessment)
    }
}

private extension MemoryAssessment {
    var sliderTitle: String {
        switch self {
        case .forgot: "忘记了"
        case .fuzzy: "没记清"
        case .remembered: "记住了"
        }
    }
}
