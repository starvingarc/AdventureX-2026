import SwiftUI
import UIKit

struct RecallKnowledgeCardStack: View {
    let cards: [MemoryCard]
    let currentIndex: Int
    @Binding var coverage: Double
    let removalProgress: CGFloat
    let isScratchEnabled: Bool
    let allowsContext: Bool

    private var visibleCards: ArraySlice<MemoryCard> {
        let end = min(cards.count, currentIndex + RecallCardMetrics.visibleLayerCount)
        return cards[currentIndex..<end]
    }

    var body: some View {
        ZStack {
            ForEach(Array(visibleCards.enumerated()).reversed(), id: \.element.id) { depth, card in
                if depth == 0 {
                    RecallKnowledgeCardView(
                        card: card,
                        coverage: $coverage,
                        isScratchEnabled: isScratchEnabled,
                        allowsContext: allowsContext
                    )
                    .offset(x: removalProgress * 330, y: -removalProgress * 38)
                    .rotationEffect(.degrees(Double(removalProgress) * 8))
                    .opacity(1 - removalProgress)
                    .zIndex(10)
                } else {
                    backingCard(card, depth: depth)
                }
            }
        }
        .frame(
            width: RecallHomeMetrics.cardStackFrame.width,
            height: RecallHomeMetrics.cardStackFrame.height
        )
    }

    private func backingCard(_ card: MemoryCard, depth: Int) -> some View {
        let spread = CGFloat(depth)
        return RoundedRectangle(
            cornerRadius: RecallCardMetrics.cornerRadius,
            style: .continuous
        )
        .fill(depth == 1 ? RecallPalette.tealSoft : RecallPalette.card)
        .overlay(
            RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius)
                .stroke(RecallPalette.teal, lineWidth: 1)
        )
        .shadow(
            color: rarityColor(card.rarity).opacity(depth == 1 ? 0.55 : 0.12),
            radius: depth == 1 ? 13 : 4
        )
        .shadow(color: Color.black.opacity(0.16), radius: 3, x: 2, y: 4)
        .rotationEffect(.degrees(Double(depth) * 1.7))
        .offset(x: spread * 5, y: -spread * 7)
        .accessibilityHidden(true)
    }

    private func rarityColor(_ rarity: String) -> Color {
        switch rarity {
        case "SSR": RecallPalette.coral
        case "SR": Color(red: 0.49, green: 0.72, blue: 0.80)
        default: RecallPalette.teal
        }
    }
}

private struct RecallKnowledgeCardView: View {
    let card: MemoryCard
    @Binding var coverage: Double
    let isScratchEnabled: Bool
    let allowsContext: Bool

    @State private var showsContext = false

    private var segments: RecallKnowledgeSegments {
        precondition(card.knowledgeSegments != nil, "Recall deck contains an invalid card")
        return card.knowledgeSegments!
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(
                cornerRadius: RecallCardMetrics.cornerRadius,
                style: .continuous
            )
            .fill(RecallPalette.card)
            .overlay(
                RoundedRectangle(cornerRadius: RecallCardMetrics.cornerRadius)
                    .stroke(RecallPalette.teal, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.22), radius: 4, x: 3, y: 5)

            knowledgeContent

            if allowsContext {
                Button { showsContext = true } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(RecallPalette.teal)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("查看完整知识上下文")
                .accessibilityHint("展开解释与来源，不改变当前刮开进度")
            }
        }
        .sheet(isPresented: $showsContext) {
            RecallContextView(card: card)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .accessibilityElement(children: .contain)
    }

    private var knowledgeContent: some View {
        ViewThatFits(in: .vertical) {
            knowledgeFlow(fontSize: 16)
            knowledgeFlow(fontSize: 15)
            knowledgeFlow(fontSize: 14)
        }
        .frame(
            width: RecallHomeMetrics.cardStackFrame.width
                - RecallCardMetrics.contentInset * 2,
            height: RecallHomeMetrics.cardStackFrame.height
                - RecallCardMetrics.contentInset * 2,
            alignment: .center
        )
        .padding(RecallCardMetrics.contentInset)
    }

    private func knowledgeFlow(fontSize: CGFloat) -> some View {
        RecallInlineKnowledgeLayout(horizontalSpacing: 0, verticalSpacing: 5) {
            ForEach(Array(inlineUnits(segments.prefix).enumerated()), id: \.offset) { _, unit in
                Text(unit)
                    .font(.system(size: fontSize))
                    .foregroundStyle(RecallPalette.ink)
            }

            ScratchSemanticToken(
                text: segments.semantic,
                fontSize: fontSize,
                coverage: $coverage,
                isEnabled: isScratchEnabled
            )

            ForEach(Array(inlineUnits(segments.suffix).enumerated()), id: \.offset) { _, unit in
                Text(unit)
                    .font(.system(size: fontSize))
                    .foregroundStyle(RecallPalette.ink)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func inlineUnits(_ text: String) -> [String] {
        let punctuation = "：:，,。.；;！？!?、"
        return text.reduce(into: [String]()) { units, character in
            if punctuation.contains(character), !units.isEmpty {
                units[units.count - 1].append(character)
            } else {
                units.append(String(character))
            }
        }
    }
}

private struct RecallInlineKnowledgeLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    private struct Line {
        var entries: [(index: Int, size: CGSize)] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let lines = makeLines(width: proposal.width ?? 218, subviews: subviews)
        return CGSize(
            width: proposal.width ?? lines.map(\.width).max() ?? 0,
            height: lines.map(\.height).reduce(0, +)
                + verticalSpacing * CGFloat(max(0, lines.count - 1))
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let lines = makeLines(width: bounds.width, subviews: subviews)
        var y = bounds.minY
        for line in lines {
            var x = bounds.minX
            for entry in line.entries {
                subviews[entry.index].place(
                    at: CGPoint(x: x, y: y + (line.height - entry.size.height) / 2),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(entry.size)
                )
                x += entry.size.width + horizontalSpacing
            }
            y += line.height + verticalSpacing
        }
    }

    private func makeLines(width: CGFloat, subviews: Subviews) -> [Line] {
        var lines: [Line] = []
        var line = Line()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let proposedWidth = line.entries.isEmpty
                ? size.width
                : line.width + horizontalSpacing + size.width
            if !line.entries.isEmpty, proposedWidth > width {
                lines.append(line)
                line = Line()
            }
            line.entries.append((index, size))
            line.width = line.entries.count == 1
                ? size.width
                : line.width + horizontalSpacing + size.width
            line.height = max(line.height, size.height)
        }
        if !line.entries.isEmpty { lines.append(line) }
        return lines
    }
}

private struct ScratchSemanticToken: View {
    let text: String
    let fontSize: CGFloat
    @Binding var coverage: Double
    let isEnabled: Bool

    @State private var paths: [[CGPoint]] = []
    @State private var coveredCells: Set<Int> = []
    @State private var isDrawing = false
    @State private var didAnnounceReveal = false

    private let columns = 12
    private let rows = 3

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Canvas { context, size in
                    let rendered = context.resolve(
                        Text(text)
                            .font(.system(size: fontSize, weight: .semibold))
                            .foregroundStyle(RecallPalette.coral)
                    )
                    context.draw(
                        rendered,
                        at: CGPoint(x: size.width / 2, y: size.height / 2),
                        anchor: .center
                    )
                }
                .accessibilityHidden(true)

                if coverage < 1 {
                    Canvas { context, size in
                        context.fill(
                            Path(
                                roundedRect: CGRect(origin: .zero, size: size),
                                cornerRadius: size.height / 2
                            ),
                            with: .color(RecallPalette.tealSoft)
                        )
                        context.blendMode = .destinationOut
                        for normalizedPath in paths where normalizedPath.count > 1 {
                            var path = Path()
                            path.move(to: rendered(normalizedPath[0], in: size))
                            for point in normalizedPath.dropFirst() {
                                path.addLine(to: rendered(point, in: size))
                            }
                            context.stroke(
                                path,
                                with: .color(.black),
                                style: StrokeStyle(
                                    lineWidth: RecallCardMetrics.brushDiameter,
                                    lineCap: .round,
                                    lineJoin: .round
                                )
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
        .frame(width: tokenWidth, height: RecallCardMetrics.semanticHeight)
        .allowsHitTesting(isEnabled && coverage < 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            coverage >= 1 ? "承重语义，\(text)" : "被遮住的承重语义"
        )
        .accessibilityValue(
            coverage >= 1 ? "已揭示" : "已刮开 \(Int(coverage * 100))%"
        )
        .accessibilityHint(
            coverage >= 1
                ? "关键词已经完整揭示"
                : "滑动逐步刮开关键词，达到百分之八十后完整显示"
        )
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: adjustCoverage(by: 0.2)
            case .decrement: adjustCoverage(by: -0.2)
            @unknown default: break
            }
        }
        .onAppear(perform: restoreVisualCoverage)
    }

    private var tokenWidth: CGFloat {
        let font = UIFont.systemFont(ofSize: fontSize, weight: .semibold)
        let measured = (text as NSString).size(withAttributes: [.font: font]).width + 16
        return min(150, max(70, measured))
    }

    private func scratchGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
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
        guard size.width > 0, size.height > 0 else { return .zero }
        return CGPoint(
            x: min(1, max(0, point.x / size.width)),
            y: min(1, max(0, point.y / size.height))
        )
    }

    private func rendered(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }

    private func markCells(around point: CGPoint, in size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let column = min(columns - 1, max(0, Int(point.x / size.width * CGFloat(columns))))
        let row = min(rows - 1, max(0, Int(point.y / size.height * CGFloat(rows))))
        let cellWidth = size.width / CGFloat(columns)
        let cellHeight = size.height / CGFloat(rows)
        let radiusColumns = max(
            0,
            Int(((RecallCardMetrics.brushDiameter / 2) / max(1, cellWidth)).rounded())
        )
        let radiusRows = max(
            0,
            Int(((RecallCardMetrics.brushDiameter / 2) / max(1, cellHeight)).rounded())
        )

        for x in max(0, column - radiusColumns)...min(columns - 1, column + radiusColumns) {
            for y in max(0, row - radiusRows)...min(rows - 1, row + radiusRows) {
                coveredCells.insert(y * columns + x)
            }
        }
        updateCoverage()
    }

    private func adjustCoverage(by delta: Double) {
        guard isEnabled, coverage < 1 else { return }
        let totalCells = columns * rows
        let target = min(1, max(0, coverage + delta))
        let targetCount = Int((target * Double(totalCells)).rounded())
        if targetCount > coveredCells.count {
            for cell in 0..<totalCells where !coveredCells.contains(cell) {
                coveredCells.insert(cell)
                if coveredCells.count >= targetCount { break }
            }
        } else if targetCount < coveredCells.count {
            for cell in coveredCells.sorted().reversed() {
                coveredCells.remove(cell)
                if coveredCells.count <= targetCount { break }
            }
        }
        updateCoverage()
    }

    private func updateCoverage() {
        let rawCoverage = Double(coveredCells.count) / Double(columns * rows)
        coverage = rawCoverage >= RecallRoundState.revealThreshold ? 1 : rawCoverage
        if coverage == 1, !didAnnounceReveal {
            didAnnounceReveal = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            UIAccessibility.post(notification: .announcement, argument: "关键词已完整揭示")
        }
    }

    private func restoreVisualCoverage() {
        guard coverage > 0, coverage < 1, paths.isEmpty else { return }
        let endX = min(0.95, max(0.12, coverage))
        paths = [[CGPoint(x: 0.06, y: 0.5), CGPoint(x: endX, y: 0.5)]]
        coveredCells = Set((0..<(columns * rows)).prefix(Int(coverage * Double(columns * rows))))
    }
}

private struct RecallContextView: View {
    let card: MemoryCard
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    Text(weightedKnowledge)
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(RecallPalette.ink)
                        .lineSpacing(7)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(card.explanation)
                        .font(.body)
                        .foregroundStyle(RecallPalette.ink.opacity(0.72))
                        .lineSpacing(6)
                        .fixedSize(horizontal: false, vertical: true)

                    Divider()

                    VStack(alignment: .leading, spacing: 10) {
                        Label(sourceStatusTitle, systemImage: sourceStatusSymbol)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(RecallPalette.teal)

                        Text(card.sourceTitle)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(RecallPalette.ink)

                        if card.sourceIsVerified,
                           let value = card.sourceUrl,
                           let url = URL(string: value) {
                            Link(destination: url) {
                                Label("查看原文", systemImage: "arrow.up.right.square")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(RecallPalette.teal)
                                    .frame(minHeight: 44)
                            }
                        }
                    }
                }
                .padding(24)
            }
            .background(RecallPalette.drawer)
            .navigationTitle("完整上下文")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .foregroundStyle(RecallPalette.teal)
                }
            }
        }
    }

    private var weightedKnowledge: AttributedString {
        var value = AttributedString(card.coreKnowledge)
        value.font = .system(size: 20, weight: .regular)
        value.foregroundColor = RecallPalette.ink
        if let hidden = card.hiddenSemantic,
           let range = value.range(of: hidden) {
            value[range].font = .system(size: 20, weight: .semibold)
            value[range].foregroundColor = RecallPalette.coral
        }
        return value
    }

    private var sourceStatusTitle: String {
        switch card.sourceStatus {
        case "verified": "已找到并核对原始来源"
        case "partial": "来源上下文不完整"
        default: "仅根据截图建立上下文"
        }
    }

    private var sourceStatusSymbol: String {
        switch card.sourceStatus {
        case "verified": "checkmark.seal.fill"
        case "partial": "link.badge.plus"
        default: "photo"
        }
    }
}
