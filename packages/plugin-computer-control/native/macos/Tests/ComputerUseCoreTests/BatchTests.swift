import CoreGraphics
import Testing
@testable import ComputerUseCore

@Suite struct BatchTests {
    private let steps: [ActionRequest] = [
        .pressKey(KeyChord(flags: [], key: .named(0x24)), repeat: 1),
        .typeText(target: nil, text: "a"),
        .typeText(target: nil, text: "b"),
    ]

    @Test func runsEveryStepWhileEachIsDelivered() {
        var ran: [ActionRequest] = []
        let results = Batch.run(steps, waitedOut: { false }) { ran.append($0); return .delivered(.ax) }
        #expect(ran == steps)
        #expect(results == Array(repeating: .delivered(.ax), count: 3))
    }

    @Test func stopsAtTheFirstStepThatIsNotDelivered() {
        var ran = 0
        let results = Batch.run(steps, waitedOut: { false }) { _ in
            ran += 1
            return ran == 2 ? .blocked("screen_changed") : .delivered(.input)
        }
        #expect(ran == 2)
        #expect(results == [.delivered(.input), .blocked("screen_changed")])
    }

    @Test func stopsWhenTheUserPausedBetweenSteps() {
        var checks = 0
        var ran = 0
        let results = Batch.run(steps, waitedOut: { checks += 1; return checks == 2 }) { _ in ran += 1; return .delivered(.ax) }
        #expect(ran == 1)
        #expect(results.count == 2)
        #expect(results.last?.code == "user_intervened")
    }
}

@Suite struct CaptureSizeTests {
    @Test func scalesTheBudgetedSizeLikeTheTypeScriptSide() {
        // `scaledSize(imageBudget(w, h), scale)` in src/contract/image.ts.
        #expect(ImageBudget.fit(width: 2880, height: 1800, scale: 1) == (1389, 868))
        #expect(ImageBudget.fit(width: 2880, height: 1800, scale: 0.5) == (695, 434))
        #expect(ImageBudget.fit(width: 4, height: 2, scale: 0.1) == (1, 1))
    }
}

@Suite struct ZoomRegionTests {
    // A 1000×500 pt window at (100, 50) shown as a 500×250 image.
    private let frame = CoordinateFrame(window: CGRect(x: 100, y: 50, width: 1000, height: 500), imageWidth: 500, imageHeight: 250)

    @Test func mapsARegionOfTheImageToTheScreen() {
        #expect(frame.screenRect(region: [10, 20, 110, 70]) == CGRect(x: 120, y: 90, width: 200, height: 100))
        #expect(frame.screenRect(region: [0, 0, 500, 250]) == frame.window)
    }

    @Test func refusesARegionThatLeavesTheImage() {
        #expect(frame.screenRect(region: [400, 200, 501, 250]) == nil)
        #expect(frame.screenRect(region: [10, 10, 10, 20]) == nil)
        #expect(frame.screenRect(region: [10, 10, 20]) == nil)
    }
}
