import CoreGraphics
import Testing
@testable import ComputerUseCore

@Suite struct PreviewPolicyTests {
    @Test func keepsTheRateBetweenOneAndFiveWithTwoAsDefault() {
        #expect(PreviewPolicy.fps(nil) == 2)
        #expect(PreviewPolicy.fps(4) == 4)
        #expect(PreviewPolicy.fps(0) == 1)
        #expect(PreviewPolicy.fps(60) == 5)
        #expect(PreviewPolicy.fps(2.6) == 3)
    }

    @Test func fitsTheLongerEdgeAndKeepsEvenSidesForVideoLater() {
        let retina = PreviewPolicy.size(points: CGSize(width: 1440, height: 900), pixelScale: 2)
        #expect(retina.width == 960)
        #expect(retina.height == 600)
        let tall = PreviewPolicy.size(points: CGSize(width: 400, height: 1001), pixelScale: 2)
        #expect(tall.height == 960)
        #expect(tall.width == 382)
        let odd = PreviewPolicy.size(points: CGSize(width: 301, height: 199), pixelScale: 1)
        #expect(odd.width == 300)
        #expect(odd.height == 198)
        let tiny = PreviewPolicy.size(points: CGSize(width: 1, height: 1), pixelScale: 1)
        #expect(tiny.width == 2)
        #expect(tiny.height == 2)
    }

    @Test func restartsOnlyWhenTheWindowIsAnotherOneOrChangedSize() {
        let window = WindowCandidate(pid: 1, frame: CGRect(x: 0, y: 0, width: 800, height: 600), title: "A")
        let moved = WindowCandidate(pid: 1, frame: CGRect(x: 40, y: 90, width: 800, height: 600), title: "A")
        let resized = WindowCandidate(pid: 1, frame: CGRect(x: 0, y: 0, width: 900, height: 600), title: "A")
        let other = WindowCandidate(pid: 2, frame: CGRect(x: 0, y: 0, width: 800, height: 600), title: "A")
        #expect(!PreviewPolicy.needsRestart(from: window, to: moved))
        #expect(PreviewPolicy.needsRestart(from: window, to: resized))
        #expect(PreviewPolicy.needsRestart(from: window, to: other))
        #expect(PreviewPolicy.needsRestart(from: nil, to: window))
        #expect(!PreviewPolicy.needsRestart(from: nil, to: nil))
    }
}
