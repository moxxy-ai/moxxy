import AppKit
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct OverlayGeometryTests {
    @Test func turnsAScreenRectIntoAnAppKitFrameWithRoomForTheCursor() {
        // Screen rects have a top-left origin on the primary display; AppKit counts from its bottom.
        let window = CGRect(x: 100, y: 50, width: 400, height: 300)
        #expect(OverlayGeometry.panelRect(window: window, primaryHeight: 900, margin: 0) == CGRect(x: 100, y: 550, width: 400, height: 300))
        #expect(OverlayGeometry.panelRect(window: window, primaryHeight: 900, margin: 24) == CGRect(x: 76, y: 526, width: 448, height: 348))
        // A display above the primary one has negative screen y.
        #expect(OverlayGeometry.panelRect(window: CGRect(x: 0, y: -1000, width: 200, height: 100), primaryHeight: 900, margin: 0)
            == CGRect(x: 0, y: 1800, width: 200, height: 100))
    }

    @Test func describesAScreenPointAsAFractionOfTheWindowWithinIt() {
        let window = CGRect(x: 100, y: 50, width: 400, height: 200)
        #expect(OverlayGeometry.fraction(of: CGPoint(x: 200, y: 100), in: window) == CGPoint(x: 0.25, y: 0.25))
        #expect(OverlayGeometry.fraction(of: CGPoint(x: 0, y: 1000), in: window) == CGPoint(x: 0, y: 1))
        #expect(OverlayGeometry.fraction(of: CGPoint(x: 5, y: 5), in: .zero) == CGPoint(x: 0.5, y: 0.5))
    }

    @Test func placesAFractionInTheOverlayCountingFromItsBottomLeft() {
        let size = CGSize(width: 400, height: 200)
        #expect(OverlayGeometry.viewPoint(CGPoint(x: 0.25, y: 0.25), windowSize: size, margin: 0) == CGPoint(x: 100, y: 150))
        #expect(OverlayGeometry.viewPoint(CGPoint(x: 0, y: 1), windowSize: size, margin: 24) == CGPoint(x: 24, y: 24))
    }

    @Test func placesAScreenRectInTheOverlay() {
        let window = CGRect(x: 100, y: 50, width: 400, height: 200)
        #expect(OverlayGeometry.viewRect(CGRect(x: 110, y: 60, width: 50, height: 20), window: window, margin: 24)
            == CGRect(x: 34, y: 194, width: 50, height: 20))
    }
}

@Suite struct CursorMotionTests {
    @Test func takesLongerForLongerMovesWithinLimits() {
        let short = CursorMotion.duration(distance: 10, reduceMotion: false)
        let long = CursorMotion.duration(distance: 600, reduceMotion: false)
        #expect(short < long)
        #expect(CursorMotion.duration(distance: 0, reduceMotion: false) == CursorMotion.minimumDuration)
        #expect(CursorMotion.duration(distance: 100_000, reduceMotion: false) == CursorMotion.maximumDuration)
    }

    @Test func jumpsWhenTheUserAsksForReducedMotion() {
        #expect(CursorMotion.duration(distance: 600, reduceMotion: true) == 0)
    }

    @Test func goesStraightForShortHopsAndArcsOnLongOnes() {
        let hop = CursorMotion.path(from: .zero, to: CGPoint(x: 20, y: 0))
        #expect(hop.control == CGPoint(x: 10, y: 0))
        let long = CursorMotion.path(from: .zero, to: CGPoint(x: 400, y: 0))
        #expect(long.control.x == 200)
        #expect(long.control.y != 0)
        #expect(abs(long.control.y) <= CursorMotion.maximumArc)
        #expect(long.point(at: 0) == .zero)
        #expect(long.point(at: 1) == CGPoint(x: 400, y: 0))
    }
}

@Suite struct CursorEventTests {
    private func decode(_ data: Data) throws -> JSONValue {
        #expect(data.last == 0x0A)
        return try JSONDecoder().decode(JSONValue.self, from: data.dropLast())
    }

    @Test func encodesTheSharedCursorEvent() throws {
        let shown = try decode(CursorEvent.frame(phase: .moving, at: CGPoint(x: 0.25, y: 1)))
        #expect(shown == .object([
            "version": .number(5), "event": .string("cursor"),
            "cursor": .object(["phase": .string("moving"), "x": .number(0.25), "y": .number(1)]),
        ]))
        let hidden = try decode(CursorEvent.frame(phase: nil, at: .zero))
        #expect(hidden["cursor"] == .null)
    }
}

@MainActor @Suite(.serialized) struct CursorOverlayTests {
    private func windowInfo() -> [[String: Any]] {
        (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
    }

    private func number(_ info: [String: Any]) -> Int { (info[kCGWindowNumber as String] as? Int) ?? -1 }

    /// A maximised window starts right under the menu bar; the overlay's margin must still reach above it,
    /// or the whole panel slides down and the pointer is drawn below its target.
    @Test func coversAWindowThatTouchesTheMenuBarWithoutSlidingDown() throws {
        _ = NSApplication.shared
        let screen = try #require(NSScreen.screens.first)
        let top = screen.frame.height - screen.visibleFrame.maxY
        let window = CGRect(x: 0, y: top, width: screen.frame.width, height: 400)
        let overlay = CursorOverlay()
        overlay.show(above: 0, frame: window, at: CGPoint(x: 0.5, y: 0.5))
        defer { overlay.hide() }
        let expected = OverlayGeometry.panelRect(window: window, primaryHeight: screen.frame.height, margin: CursorOverlay.margin)
        #expect(try #require(overlay.panel).frame == expected)
    }

    @Test func sitsJustAboveTheTargetWindowClickThroughAndOutOfCaptures() async throws {
        _ = NSApplication.shared
        let target = NSWindow(contentRect: NSRect(x: 300, y: 300, width: 320, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        target.isReleasedWhenClosed = false
        target.orderFrontRegardless()
        defer { target.orderOut(nil) }
        let primaryHeight = try #require(NSScreen.screens.first).frame.height
        let screenFrame = CGRect(x: target.frame.minX, y: primaryHeight - target.frame.maxY, width: target.frame.width, height: target.frame.height)

        let overlay = CursorOverlay()
        overlay.show(above: CGWindowID(target.windowNumber), frame: screenFrame, at: CGPoint(x: 0.5, y: 0.5))
        defer { overlay.hide() }
        let panel = try #require(overlay.panel)
        #expect(panel.ignoresMouseEvents)
        #expect(panel.sharingType == .none)
        #expect(!panel.canBecomeKey)

        var order: [Int] = []
        for _ in 0..<20 {
            order = windowInfo().map(number)
            if order.contains(panel.windowNumber) { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let above = try #require(order.firstIndex(of: panel.windowNumber))
        let below = try #require(order.firstIndex(of: target.windowNumber))
        #expect(above + 1 == below)
        let info = try #require(windowInfo().first { number($0) == panel.windowNumber })
        #expect(info[kCGWindowSharingState as String] as? Int == 0)

        overlay.hide()
        #expect(!panel.isVisible)
    }

    @Test func glidesToTheTargetPointMarksPressesAndFramesTheElement() throws {
        _ = NSApplication.shared
        let overlay = CursorOverlay()
        let window = CGRect(x: 100, y: 50, width: 400, height: 200)
        overlay.show(above: 0, frame: window, at: CGPoint(x: 0, y: 0))
        defer { overlay.hide() }
        let margin = CursorOverlay.margin
        #expect(overlay.pointer.position == CGPoint(x: margin, y: margin + 200))

        let glide = overlay.move(to: CGPoint(x: 1, y: 1))
        #expect(overlay.pointer.position == CGPoint(x: margin + 400, y: margin))
        #expect(glide == CursorMotion.duration(distance: hypot(400, 200), reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion))
        #expect(overlay.move(to: CGPoint(x: 0.5, y: 0.5), animated: false) == 0)

        overlay.press()
        #expect(overlay.ring.position == overlay.pointer.position)
        #expect(overlay.ring.animation(forKey: "press") != nil)

        overlay.outline(CGRect(x: 110, y: 60, width: 50, height: 20))
        let outlined = try #require(overlay.outlineLayer.path).boundingBox
        #expect(outlined == CGRect(x: margin + 10 - 3, y: margin + 170 - 3, width: 56, height: 26))
        overlay.outline(nil)
        #expect(overlay.outlineLayer.path == nil)
    }
}
