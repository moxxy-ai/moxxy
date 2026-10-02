import CoreGraphics
import Testing
@testable import ComputerUseCore

@Suite struct ImageBudgetTests {
    // Expected values come from `imageBudget` in src/contract/image.ts; both sides must agree.
    @Test(arguments: [
        (1000, 800, 1000, 800), (2880, 1800, 1389, 868), (1800, 2880, 868, 1389), (20000, 10, 1568, 1),
        (3024, 1964, 1372, 891), (920, 440, 920, 440), (5120, 2880, 1456, 819), (1568, 1568, 1092, 1092),
    ])
    func matchesTheTypeScriptBudget(width: Int, height: Int, expectedWidth: Int, expectedHeight: Int) {
        let size = ImageBudget.fit(width: width, height: height)
        #expect(size.width == expectedWidth)
        #expect(size.height == expectedHeight)
    }
}

@Suite struct WindowMatchTests {
    let target = WindowCandidate(pid: 42, frame: CGRect(x: 200, y: 120, width: 460, height: 220), title: "Moxxy Fixture")

    @Test func picksTheSameProcessWindowWithTheSameFrame() {
        let candidates = [
            WindowCandidate(pid: 7, frame: target.frame, title: "Moxxy Fixture"),
            WindowCandidate(pid: 42, frame: CGRect(x: 0, y: 0, width: 800, height: 600), title: "Other"),
            WindowCandidate(pid: 42, frame: CGRect(x: 200.5, y: 119.5, width: 460, height: 220), title: "Moxxy Fixture"),
        ]
        #expect(WindowMatch.best(for: target, in: candidates) == 2)
    }

    @Test func prefersTheTitleWhenFramesTie() {
        let candidates = [
            WindowCandidate(pid: 42, frame: target.frame, title: "Inspector"),
            WindowCandidate(pid: 42, frame: target.frame, title: "Moxxy Fixture"),
        ]
        #expect(WindowMatch.best(for: target, in: candidates) == 1)
    }

    @Test func findsNothingWhenNoFrameMatches() {
        let candidates = [WindowCandidate(pid: 42, frame: CGRect(x: 0, y: 0, width: 10, height: 10), title: "Moxxy Fixture")]
        #expect(WindowMatch.best(for: target, in: candidates) == nil)
    }
}

@Suite struct CoordinateFrameTests {
    let frame = CoordinateFrame(window: CGRect(x: -1440, y: 100, width: 720, height: 450), imageWidth: 1440, imageHeight: 900)

    @Test func mapsAnElementIntoImagePixels() {
        let rect = frame.imageRect(of: CGRect(x: -1340, y: 150, width: 100, height: 20))
        #expect(rect == CGRect(x: 200, y: 100, width: 200, height: 40))
    }

    @Test func mapsAnImagePointBackToTheScreen() {
        #expect(frame.screenPoint(x: 720, y: 450) == CGPoint(x: -1080, y: 325))
    }

    @Test func clipsElementsToTheWindow() {
        #expect(frame.imageRect(of: CGRect(x: -1500, y: 90, width: 100, height: 40)) == CGRect(x: 0, y: 0, width: 80, height: 60))
        #expect(frame.imageRect(of: CGRect(x: 0, y: 0, width: 10, height: 10)) == nil)
    }
}

@Suite struct CaptureRouteTests {
    private let displays = [CGRect(x: 0, y: 0, width: 2056, height: 1329), CGRect(x: 2056, y: 0, width: 1920, height: 1080)]

    // A window's own surface can be larger than its frame, which scales its picture; the display shows it where clicks land.
    @Test func capturesAWindowOnScreenThroughItsDisplay() {
        let window = CGRect(x: 0, y: 39, width: 2056, height: 1198)
        #expect(CaptureRoute.choose(window: window, onScreen: true, displays: displays) == .display(0, area: window))
        let second = CGRect(x: 2156, y: 100, width: 800, height: 600)
        #expect(CaptureRoute.choose(window: second, onScreen: true, displays: displays) == .display(1, area: CGRect(x: 100, y: 100, width: 800, height: 600)))
    }

    @Test func capturesTheWindowAloneWhenTheDisplayCannotShowAllOfIt() {
        #expect(CaptureRoute.choose(window: CGRect(x: 0, y: 39, width: 2056, height: 1198), onScreen: false, displays: displays) == .window)
        #expect(CaptureRoute.choose(window: CGRect(x: 1800, y: 100, width: 800, height: 600), onScreen: true, displays: displays) == .window)
        #expect(CaptureRoute.choose(window: CGRect(x: 100, y: 1000, width: 800, height: 600), onScreen: true, displays: displays) == .window)
    }
}

@Suite struct AttemptsTests {
    private final class Counter: @unchecked Sendable { var value = 0 }

    // The system's window list can miss a window for a moment.
    @Test func asksAgainUntilThereIsAnAnswer() async {
        let asked = Counter()
        let found = await Attempts.first(4, pause: 0) { () -> String? in
            asked.value += 1
            return asked.value == 3 ? "window" : nil
        }
        #expect(found == "window")
        #expect(asked.value == 3)
    }

    @Test func givesUpAfterTheLastAttempt() async {
        let asked = Counter()
        let found = await Attempts.first(4, pause: 0) { () -> String? in
            asked.value += 1
            return nil
        }
        #expect(found == nil)
        #expect(asked.value == 4)
    }
}
