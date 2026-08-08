import CoreGraphics

struct KnowledgeLibraryPage<ID: Hashable & Sendable>: Equatable, Sendable {
    struct Placement: Equatable, Sendable {
        let id: ID
        let column: Int
        let y: CGFloat
        let height: CGFloat
        let sourceIndex: Int
    }

    let placements: [Placement]

    var readingOrder: [ID] {
        placements
            .sorted { $0.sourceIndex < $1.sourceIndex }
            .map(\.id)
    }
}

struct KnowledgeLibraryPaginator<ID: Hashable & Sendable> {
    func pages(
        itemHeights: [(ID, CGFloat)],
        availableHeight: CGFloat,
        verticalSpacing: CGFloat,
        columnCount: Int = 2
    ) -> [KnowledgeLibraryPage<ID>] {
        guard !itemHeights.isEmpty else { return [] }
        let usableHeight = max(0, availableHeight)
        let spacing = max(0, verticalSpacing)
        var result: [KnowledgeLibraryPage<ID>] = []
        var placements: [KnowledgeLibraryPage<ID>.Placement] = []
        let resolvedColumnCount = max(1, columnCount)
        var columnHeights = Array(repeating: CGFloat.zero, count: resolvedColumnCount)

        func completedPage() -> KnowledgeLibraryPage<ID>? {
            guard !placements.isEmpty else { return nil }
            return KnowledgeLibraryPage(placements: placements)
        }

        func resetPage() {
            placements = []
            columnHeights = Array(repeating: CGFloat.zero, count: resolvedColumnCount)
        }

        for (sourceIndex, element) in itemHeights.enumerated() {
            let (id, rawHeight) = element
            let height = max(0, rawHeight)

            if !placements.isEmpty, columnHeights.max() ?? 0 > usableHeight {
                if let page = completedPage() { result.append(page) }
                resetPage()
            }

            var column = columnHeights.indices.min {
                columnHeights[$0] < columnHeights[$1]
            } ?? 0
            var y = columnHeights[column] == 0 ? 0 : columnHeights[column] + spacing
            let wouldOverflow = y + height > usableHeight

            if wouldOverflow, !placements.isEmpty {
                if let page = completedPage() { result.append(page) }
                resetPage()
                column = 0
                y = 0
            }

            placements.append(
                .init(
                    id: id,
                    column: column,
                    y: y,
                    height: height,
                    sourceIndex: sourceIndex
                )
            )
            columnHeights[column] = y + height
        }

        if let page = completedPage() { result.append(page) }
        return result
    }
}
