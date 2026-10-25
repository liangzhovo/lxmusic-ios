import XCTest

// Test-only runner. Rotate the simulated DEVICE rather than asking a windowed
// application to change its interface orientation (UIKit rejects that request).
final class OrientationTests: XCTestCase {
    @MainActor
    private func rotate(_ orientation: UIDeviceOrientation, landscape: Bool) {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.skyhc.lxmusic")
        // simctl launch on an already running app does not replace arguments.
        // Relaunch with the requested RNN orientation before rotating hardware;
        // otherwise the previous portrait-only fixture can reject landscape.
        app.terminate()
        app.launchArguments = ["--lx-playback-smoke", "--lx-ui=table"]
        if landscape { app.launchArguments.append("--lx-ui-landscape") }
        app.launch()
        XCUIDevice.shared.orientation = orientation
        let matches = NSPredicate { _, _ in
            let frame = app.frame
            return frame.width > 0 && frame.height > 0 && (frame.width > frame.height) == landscape
        }
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: matches, object: app)], timeout: 15)
        XCTAssertEqual(result, .completed, "Real app viewport did not rotate: \(app.frame)")
        XCTAssertEqual(XCUIDevice.shared.orientation, orientation)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = landscape ? "device-landscape" : "device-portrait"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor func testLandscape() { rotate(.landscapeLeft, landscape: true) }
    @MainActor func testPortrait() { rotate(.portrait, landscape: false) }
}
