import XCTest
@testable import Omo

final class KnowledgeLibraryPaginationTests: XCTestCase {
    func testPaginatorFillsShorterColumnWithoutReordering() {
        let pages = KnowledgeLibraryPaginator<String>().pages(
            itemHeights: [("a", 120), ("b", 180), ("c", 100), ("d", 80)],
            availableHeight: 300,
            verticalSpacing: 18
        )

        XCTAssertEqual(pages.count, 1)
        XCTAssertEqual(pages[0].readingOrder, ["a", "b", "c", "d"])
        XCTAssertEqual(pages[0].placements.map(\.column), [0, 1, 0, 1])
        XCTAssertEqual(pages[0].placements.map(\.y), [0, 0, 138, 198])
    }

    func testPaginatorStartsNewPageBeforeEitherColumnOverflows() {
        let pages = KnowledgeLibraryPaginator<String>().pages(
            itemHeights: [("a", 180), ("b", 190), ("c", 130), ("d", 120)],
            availableHeight: 300,
            verticalSpacing: 18
        )

        XCTAssertEqual(pages.count, 2)
        XCTAssertEqual(pages[0].readingOrder, ["a", "b"])
        XCTAssertEqual(pages[1].readingOrder, ["c", "d"])
    }

    func testSingleOversizedCardStillGetsItsOwnPage() {
        let pages = KnowledgeLibraryPaginator<String>().pages(
            itemHeights: [("large", 420), ("small", 90)],
            availableHeight: 300,
            verticalSpacing: 18
        )

        XCTAssertEqual(pages.count, 2)
        XCTAssertEqual(pages[0].readingOrder, ["large"])
        XCTAssertEqual(pages[0].placements[0].height, 420)
        XCTAssertEqual(pages[1].readingOrder, ["small"])
    }

    func testLargerMeasuredHeightsProduceMorePages() {
        let paginator = KnowledgeLibraryPaginator<String>()
        let compact = paginator.pages(
            itemHeights: [("a", 80), ("b", 80), ("c", 80), ("d", 80), ("e", 80)],
            availableHeight: 300,
            verticalSpacing: 18
        )
        let accessibility = paginator.pages(
            itemHeights: [("a", 180), ("b", 180), ("c", 180), ("d", 180), ("e", 180)],
            availableHeight: 300,
            verticalSpacing: 18
        )

        XCTAssertGreaterThan(accessibility.count, compact.count)
        XCTAssertEqual(accessibility.flatMap(\.readingOrder), ["a", "b", "c", "d", "e"])
    }

    func testEmptyInputProducesNoPages() {
        XCTAssertTrue(
            KnowledgeLibraryPaginator<String>().pages(
                itemHeights: [],
                availableHeight: 300,
                verticalSpacing: 18
            ).isEmpty
        )
    }
}
