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

    func testSingleCardRecallJourneyRevealsRatesAndReturnsToUsableHome() {
        let app = launch(arguments: [
            "-OmoLibraryFixture", "single",
            "-OmoAssessmentFixture", "success"
        ])

        let mascot = app.buttons["哦莫 记忆伙伴"]
        XCTAssertTrue(mascot.waitForExistence(timeout: 3))
        mascot.tap()

        let scratch = app.otherElements["被遮住的承重语义"]
        XCTAssertTrue(scratch.waitForExistence(timeout: 3))
        for y in [0.25, 0.75] {
            let leading = scratch.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: y))
            let trailing = scratch.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: y))
            leading.press(forDuration: 0.05, thenDragTo: trailing)
        }

        let rating = app.sliders["memory-rating-slider"]
        XCTAssertTrue(rating.waitForExistence(timeout: 3))
        let start = rating.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.18))
        let remembered = rating.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.18))
        start.press(forDuration: 0.1, thenDragTo: remembered)

        XCTAssertTrue(rating.waitForNonExistence(timeout: 4))
        XCTAssertTrue(app.buttons["打开知识库"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["上传新的知识截屏"].exists)
        XCTAssertFalse(app.otherElements["被遮住的承重语义"].exists)
        attachScreenshot("09-recall-complete-home", app: app)
    }

    func testEmptyUserCanVisitEveryAvailableSurfaceAndAlwaysReturnHome() {
        let app = launch(arguments: ["-OmoLibraryFixture", "empty"])

        app.buttons["打开菜单"].tap()
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Settings"].exists)
        app.buttons["Profile"].tap()
        XCTAssertTrue(app.staticTexts["我的"].waitForExistence(timeout: 3))
        app.buttons["返回首页"].tap()

        XCTAssertTrue(app.buttons["打开菜单"].waitForExistence(timeout: 3))
        app.buttons["打开菜单"].tap()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 3))
        app.buttons["完成"].tap()

        XCTAssertTrue(app.buttons["打开知识库"].waitForExistence(timeout: 3))
        app.buttons["打开知识库"].tap()
        XCTAssertTrue(app.buttons["返回首页"].waitForExistence(timeout: 3))
        app.buttons["返回首页"].tap()

        let upload = app.buttons["上传第一张知识截屏"]
        XCTAssertTrue(upload.waitForExistence(timeout: 3))
        upload.tap()
        let cancel = app.buttons.matching(
            NSPredicate(format: "label IN %@", ["Cancel", "取消"])
        ).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()

        XCTAssertTrue(app.buttons["打开菜单"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        attachScreenshot("10-empty-journey-returned-home", app: app)
    }

    func testProcessingUserCanNavigateAndCancelAnotherUploadWithoutLosingTask() {
        let app = launch(arguments: [
            "-OmoLibraryFixture", "empty",
            "-OmoScreenshotJobFixture", "active"
        ])

        XCTAssertTrue(app.staticTexts["正在整理知识卡"].waitForExistence(timeout: 3))
        app.buttons["打开知识库"].tap()
        XCTAssertTrue(app.staticTexts["第一张知识卡正在整理"].waitForExistence(timeout: 3))
        app.buttons["返回首页"].tap()

        let upload = app.buttons["上传第一张知识截屏"]
        XCTAssertTrue(upload.waitForExistence(timeout: 3))
        upload.tap()
        let cancel = app.buttons.matching(
            NSPredicate(format: "label IN %@", ["Cancel", "取消"])
        ).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()

        XCTAssertTrue(app.staticTexts["正在整理知识卡"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["打开菜单"].exists)
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        attachScreenshot("11-processing-journey-returned-home", app: app)
    }

    #if OMO_STAGING_UI
    func testRealStagingFirstScreenshotSurvivesRelaunchAndCompletesRecall() {
        let app = XCUIApplication()
        app.launchArguments = ["-OmoSkipLaunch"]
        app.launchEnvironment["OMO_API_BASE_URL"] = "https://omo-api-staging-staging.up.railway.app"
        app.launch()

        let upload = app.buttons["上传第一张知识截屏"]
        XCTAssertTrue(upload.waitForExistence(timeout: 15))
        upload.tap()

        let firstPhoto = app.images.matching(
            NSPredicate(format: "identifier == %@", "PXGGridLayout-Info")
        ).firstMatch
        XCTAssertTrue(firstPhoto.waitForExistence(timeout: 10))
        firstPhoto.tap()
        let add = app.buttons.matching(
            NSPredicate(format: "label IN %@", ["Add", "添加"])
        ).firstMatch
        if add.waitForExistence(timeout: 2) { add.tap() }

        let consent = app.buttons["同意并生成"]
        XCTAssertTrue(consent.waitForExistence(timeout: 10))
        consent.tap()

        XCTAssertTrue(app.buttons["打开菜单"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)
        XCTAssertTrue(app.staticTexts["正在整理知识卡"].waitForExistence(timeout: 10))
        attachScreenshot("12-staging-upload-accepted", app: app)

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["打开菜单"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["打开知识库"].exists)
        XCTAssertTrue(app.buttons["上传第一张知识截屏"].exists)

        waitForStagingResult(app: app, timeout: 180)
        if app.buttons["整理失败，点此重试"].exists {
            app.buttons["整理失败，点此重试"].tap()
            waitForStagingResult(app: app, timeout: 180)
        }

        let mascot = app.buttons["哦莫 记忆伙伴"]
        XCTAssertTrue(mascot.exists, "真实 staging 截图任务未生成可复习卡")
        mascot.tap()
        revealCurrentCard(in: app)

        let rating = app.sliders["memory-rating-slider"]
        XCTAssertTrue(rating.waitForExistence(timeout: 5))
        let start = rating.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.18))
        let remembered = rating.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.18))
        start.press(forDuration: 0.1, thenDragTo: remembered)
        XCTAssertTrue(rating.waitForNonExistence(timeout: 15))

        XCTAssertTrue(app.buttons["打开知识库"].waitForExistence(timeout: 5))
        app.buttons["打开知识库"].tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "卡片")).firstMatch
                .waitForExistence(timeout: 10)
        )
        attachScreenshot("13-staging-recall-complete-library", app: app)
    }

    private func waitForStagingResult(app: XCUIApplication, timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if app.buttons["哦莫 记忆伙伴"].exists
                || app.buttons["整理失败，点此重试"].exists {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
    }

    private func revealCurrentCard(in app: XCUIApplication) {
        let scratch = app.otherElements["被遮住的承重语义"]
        XCTAssertTrue(scratch.waitForExistence(timeout: 5))
        for y in [0.25, 0.75] {
            let leading = scratch.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: y))
            let trailing = scratch.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: y))
            leading.press(forDuration: 0.05, thenDragTo: trailing)
        }
    }
    #endif

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

private extension XCUIElement {
    func waitForNonExistence(timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "exists == false")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: self)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
}
