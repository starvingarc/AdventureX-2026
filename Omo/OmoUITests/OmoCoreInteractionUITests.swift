import XCTest

final class OmoCoreInteractionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testEmptyHomeLibraryAndUploadAreBothReachable() {
        let app = launch(arguments: ["-OmoLibraryFixture", "empty"])

        XCTAssertTrue(app.buttons["打开知识库"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        attachScreenshot("01-empty-home", app: app)
        app.buttons["打开知识库"].tap()

        XCTAssertTrue(app.buttons["返回首页"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        attachScreenshot("02-empty-library", app: app)
    }

    func testProcessingScreenshotKeepsHomeAndLibraryEntriesAvailable() {
        let app = launch(arguments: [
            "-OmoLibraryFixture", "empty",
            "-OmoScreenshotJobFixture", "active"
        ])

        XCTAssertTrue(app.buttons["打开菜单"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        XCTAssertTrue(app.staticTexts["正在整理知识卡"].exists)
        attachScreenshot("03-processing-home", app: app)

        app.buttons["打开知识库"].tap()
        XCTAssertTrue(app.staticTexts["第一张知识卡正在整理"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        attachScreenshot("04-processing-library", app: app)
    }

    func testFailedScreenshotKeepsRecoveryAndNavigationAvailable() {
        let app = launch(arguments: [
            "-OmoLibraryFixture", "empty",
            "-OmoScreenshotJobFixture", "failed"
        ])

        XCTAssertTrue(app.buttons["整理失败，点此重试"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        attachScreenshot("05-failed-home", app: app)

        app.buttons["打开知识库"].tap()
        XCTAssertTrue(app.buttons["重试"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["返回首页"].exists)
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        attachScreenshot("06-failed-library", app: app)
    }

    func testRecallRoundKeepsScratchAndPersistentHomeActionsReachable() {
        let app = launch(arguments: ["-OmoLibraryFixture", "many"])

        let mascot = app.buttons["哦莫 记忆伙伴"]
        XCTAssertTrue(mascot.waitForExistence(timeout: 3))
        mascot.tap()

        XCTAssertTrue(app.otherElements["被遮住的承重语义"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        attachScreenshot("07-recall-scratch", app: app)
    }

    func testRevealedRecallShowsRatingWithoutHidingPersistentActions() {
        let app = launch(arguments: [
            "-OmoLibraryFixture", "many",
            "-OmoRecallRevealed"
        ])

        let mascot = app.buttons["哦莫 记忆伙伴"]
        XCTAssertTrue(mascot.waitForExistence(timeout: 3))
        mascot.tap()

        XCTAssertTrue(app.sliders["memory-rating-slider"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        attachScreenshot("08-recall-rating", app: app)
    }

    private func launch(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-OmoSkipLaunch", "-OmoUseFixtures"] + arguments
        app.launchEnvironment["OMO_API_BASE_URL"] = "http://127.0.0.1:5174"
        app.launch()
        return app
    }

    private func attachScreenshot(_ name: String, app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
