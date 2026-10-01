import CoreGraphics
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct HitTestTests {
    private func window(_ id: CGWindowID, pid: pid_t, _ frame: CGRect, layer: Int = 0, alpha: Double = 1, owner: String = "App") -> ScreenWindow {
        ScreenWindow(id: id, pid: pid, layer: layer, frame: frame, alpha: alpha, owner: owner)
    }

    // Accessibility decides which app is under the point: it follows real shapes, while the Dock's
    // window spans the whole screen although it only draws a strip.
    @Test func namesTheWindowOfTheAppAccessibilityFindsAtThePoint() {
        let windows = [
            window(1, pid: 3, CGRect(x: 0, y: 0, width: 1440, height: 900), layer: 20, owner: "Dock"),
            window(2, pid: 10, CGRect(x: 0, y: 0, width: 50, height: 50), alpha: 0),
            window(3, pid: 10, CGRect(x: 0, y: 0, width: 400, height: 400)),
        ]
        #expect(HitTest.owner(at: CGPoint(x: 10, y: 10), in: windows, pid: 10)?.id == 3)
        #expect(HitTest.owner(at: CGPoint(x: 10, y: 890), in: windows, pid: 3)?.owner == "Dock")
        #expect(HitTest.owner(at: CGPoint(x: 10, y: 10), in: windows, pid: nil) == nil)
    }

    @Test func treatsAnAppWithoutAWindowThereAsTheDesktop() throws {
        let finder = try #require(HitTest.owner(at: CGPoint(x: 700, y: 700), in: [], pid: 4, name: "Finder"))
        #expect(finder.layer < 0)
        #expect(finder.owner == "Finder")
    }
}

@Suite struct PointerGateTests {
    private let screen = [CGRect(x: 0, y: 0, width: 1440, height: 900)]
    private let point = CGPoint(x: 100, y: 100)
    private func under(pid: pid_t, layer: Int = 0, owner: String = "Target") -> ScreenWindow {
        ScreenWindow(id: 7, pid: pid, layer: layer, frame: CGRect(x: 0, y: 0, width: 800, height: 600), alpha: 1, owner: owner)
    }

    @Test func letsThroughAPointOnTheTargetApp() {
        #expect(PointerGate.check(point, displays: screen, under: under(pid: 10), target: 10, host: 5) == nil)
    }

    @Test func refusesAPointOffEveryDisplay() {
        #expect(PointerGate.check(CGPoint(x: 2000, y: 100), displays: screen, under: nil, target: 10, host: 5)?.code == "point_outside_frame")
    }

    @Test func refusesTheDockAndTheDesktopWhichCanLaunchOtherApps() throws {
        let dock = try #require(PointerGate.check(point, displays: screen, under: under(pid: 3, layer: 20, owner: "Dock"), target: 10, host: 5))
        #expect(dock.code == "hit_test_mismatch")
        #expect(dock.hint?.contains("Dock") == true)
        let desktop = try #require(PointerGate.check(point, displays: screen, under: under(pid: 4, layer: -2147483603, owner: "Finder"), target: 10, host: 5))
        #expect(desktop.code == "hit_test_mismatch")
        #expect(desktop.hint?.contains("desktop") == true)
        #expect(PointerGate.check(point, displays: screen, under: nil, target: 10, host: 5)?.hint?.contains("desktop") == true)
    }

    @Test func refusesMoxxysOwnWindowAndNamesAnotherAppInTheWay() throws {
        #expect(PointerGate.check(point, displays: screen, under: under(pid: 5), target: 10, host: 5)?.code == "own_window")
        let covered = try #require(PointerGate.check(point, displays: screen, under: under(pid: 6, owner: "Notes"), target: 10, host: 5))
        #expect(covered.code == "hit_test_mismatch")
        #expect(covered.hint?.contains("Notes") == true)
    }
}

@Suite struct PixelPatchTests {
    private func buffer(width: Int, height: Int, fill: UInt8) -> PixelBuffer {
        PixelBuffer(width: width, height: height, bytes: [UInt8](repeating: fill, count: width * height * 4))
    }

    @Test func centresANineByNinePatchAndClampsItToTheImage() {
        #expect(PixelPatch.rect(aroundX: 50, y: 50, width: 100, height: 100) == PatchRect(x: 46, y: 46, width: 9, height: 9))
        #expect(PixelPatch.rect(aroundX: 1, y: 98, width: 100, height: 100) == PatchRect(x: 0, y: 94, width: 9, height: 6))
        #expect(PixelPatch.rect(aroundX: 100, y: 5, width: 100, height: 100) == nil)
    }

    @Test func readsThePatchPixelsRowByRow() {
        var image = buffer(width: 4, height: 3, fill: 0)
        image.bytes[(1 * 4 + 2) * 4] = 200 // red of pixel (2, 1)
        let patch = PixelPatch.pixels(image, in: PatchRect(x: 1, y: 1, width: 2, height: 2))
        #expect(patch.count == 16)
        #expect(patch[4] == 200)
    }

    @Test func toleratesACaretColumnButNotAChangedControl() {
        let before = [UInt8](repeating: 255, count: 81 * 4)
        #expect(PixelPatch.same(before, before))
        var caret = before
        for row in 0..<9 { for channel in 0..<3 { caret[(row * 9 + 4) * 4 + channel] = 0 } }
        #expect(PixelPatch.same(before, caret))
        var changed = before
        for pixel in 0..<30 { changed[pixel * 4] = 0 }
        #expect(!PixelPatch.same(before, changed))
        #expect(!PixelPatch.same(before, [UInt8](before.prefix(40))))
    }
}

@Suite struct MouseScriptTests {
    private let point = CGPoint(x: 10, y: 20)

    @Test func clicksWithRisingClickStatesSoAppsSeeADoubleClick() {
        let steps = MouseScript.click(at: point, button: .left, count: 2)
        #expect(steps.map(\.type) == [.mouseMoved, .leftMouseDown, .leftMouseUp, .leftMouseDown, .leftMouseUp])
        #expect(steps.map(\.clickState) == [0, 1, 1, 2, 2])
        #expect(steps.allSatisfy { $0.point == point })
        #expect(MouseScript.click(at: point, button: .right, count: 1).map(\.type) == [.mouseMoved, .rightMouseDown, .rightMouseUp])
        #expect(MouseScript.click(at: point, button: .middle, count: 1).map(\.button) == [.center, .center, .center])
    }

    @Test func dragsThroughEveryPointAndSpreadsTheDurationOverTheMoves() {
        let path = [CGPoint(x: 0, y: 0), CGPoint(x: 100, y: 0), CGPoint(x: 100, y: 50)]
        let quick = MouseScript.drag(path, button: .left, duration: 0)
        #expect(quick.map(\.type) == [.mouseMoved, .leftMouseDown, .leftMouseDragged, .leftMouseDragged, .leftMouseUp])
        #expect(quick.last?.point == path.last)

        let slow = MouseScript.drag(path, button: .left, duration: 0.5)
        let moves = slow.filter { $0.type == .leftMouseDragged }
        #expect(moves.count > 2)
        #expect(moves.contains { $0.point == CGPoint(x: 100, y: 0) })
        #expect(abs(slow.map(\.delay).reduce(0, +) - 0.5) < 0.001)
        #expect(slow.last?.type == .leftMouseUp)
    }

    @Test func pressesMovesAndReleasesOneStepAtATime() {
        #expect(MouseScript.single(.down, at: point, button: .left, held: false).map(\.type) == [.mouseMoved, .leftMouseDown])
        #expect(MouseScript.single(.move, at: point, button: .left, held: true).map(\.type) == [.leftMouseDragged])
        #expect(MouseScript.single(.move, at: point, button: .left, held: false).map(\.type) == [.mouseMoved])
        #expect(MouseScript.single(.up, at: point, button: .right, held: true).map(\.type) == [.rightMouseDragged, .rightMouseUp])
    }
}

@Suite struct ScrollPlanTests {
    @Test func scrollsWholePagesThroughAccessibilityWhenTheElementOffersIt() {
        let actions = ["AXScrollDownByPage", "AXScrollUpByPage"]
        #expect(ScrollPlan.ax(.down, pages: 2, actions: actions) == ScrollPlan.AXPages(action: "AXScrollDownByPage", times: 2))
        #expect(ScrollPlan.ax(.left, pages: 1, actions: actions) == nil)
        #expect(ScrollPlan.ax(.down, pages: 0.5, actions: actions) == nil)
    }

    // Scroll bars run from 0 (top or left) to 1; a page moves them by the visible share of what can scroll.
    @Test func movesAScrollBarByPagesWithinItsRange() {
        #expect(ScrollPlan.barValue(from: 0, .down, pages: 1, visible: 100, content: 1100) == 0.09)
        #expect(ScrollPlan.barValue(from: 0.5, .up, pages: 2, visible: 100, content: 1100) == 0.32)
        #expect(ScrollPlan.barValue(from: 0.95, .down, pages: 1, visible: 100, content: 1100) == 1)
        #expect(ScrollPlan.barValue(from: 0.2, .left, pages: 5, visible: 100, content: 1100) == 0)
        #expect(ScrollPlan.barValue(from: 0, .down, pages: 1, visible: 100, content: 100) == nil)
    }

    @Test func turnsPagesIntoWheelStepsInTheRightDirection() {
        let down = ScrollPlan.wheel(.down, pages: 1, viewport: CGSize(width: 400, height: 300))
        #expect(down.reduce(0) { $0 + $1.dy } == -270)
        #expect(down.allSatisfy { $0.dx == 0 && abs($0.dy) <= ScrollPlan.maxStep })
        #expect(ScrollPlan.wheel(.up, pages: 0.5, viewport: CGSize(width: 400, height: 300)).reduce(0) { $0 + $1.dy } == 135)
        #expect(ScrollPlan.wheel(.right, pages: 1, viewport: CGSize(width: 400, height: 300)).reduce(0) { $0 + $1.dx } == -360)
    }
}

@Suite struct PointClickTests {
    @Test func pressesControlsUnderAPointThroughAccessibilityButClicksEverythingElse() {
        #expect(AXLadder.pointClick(role: "AXButton", actions: ["AXPress"], button: .left, count: 1, modifiers: false) == .axAction("AXPress"))
        #expect(AXLadder.pointClick(role: "AXCheckBox", actions: ["AXPress"], button: .left, count: 1, modifiers: false) == .axAction("AXPress"))
        // A text field or a canvas cares where exactly it is clicked.
        #expect(AXLadder.pointClick(role: "AXTextField", actions: ["AXConfirm"], button: .left, count: 1, modifiers: false) == .physical)
        #expect(AXLadder.pointClick(role: "AXGroup", actions: ["AXPress"], button: .left, count: 1, modifiers: false) == .physical)
        #expect(AXLadder.pointClick(role: "AXButton", actions: ["AXPress"], button: .left, count: 2, modifiers: false) == .physical)
    }
}

@Suite struct ActivationGateTests {
    @Test func holdsBackWhileTheUserIsTyping() {
        #expect(ActivationGate.userIsTyping(secondsSinceKeyDown: 0.2))
        #expect(!ActivationGate.userIsTyping(secondsSinceKeyDown: 3))
    }
}

@Suite struct PointerRequestTests {
    private func parse(_ fields: [String: JSONValue]) throws -> ActionRequest { try ActionRequest.parse(.object(fields)) }

    @Test func readsHeldModifiersScrollsDragsAndSingleMouseSteps() throws {
        #expect(try parse(["action": .string("click"), "x": .number(4), "y": .number(5), "mouse_button": .string("left"), "click_count": .number(1),
                           "modifiers": .string("cmd+shift"), "held": .array([.string("shift"), .string("meta")])])
            == .click(target: .point(CGPoint(x: 4, y: 5)), button: .left, count: 1, modifiers: [.maskShift, .maskCommand]))
        #expect(try parse(["action": .string("scroll"), "element_index": .number(3), "direction": .string("down"), "pages": .number(1.5)])
            == .scroll(target: .element(3), direction: .down, pages: 1.5))
        #expect(try parse(["action": .string("drag"), "path": .array([.array([.number(1), .number(2)]), .array([.number(3), .number(4)])]),
                           "duration_ms": .number(250), "mouse_button": .string("left")])
            == .drag(path: [CGPoint(x: 1, y: 2), CGPoint(x: 3, y: 4)], button: .left, duration: 0.25, modifiers: []))
        #expect(try parse(["action": .string("mouse"), "event": .string("down"), "x": .number(7), "y": .number(8), "mouse_button": .string("right")])
            == .mouse(.down, at: CGPoint(x: 7, y: 8), button: .right, modifiers: []))
        #expect(throws: HelperError.self) { try parse(["action": .string("drag"), "path": .array([.array([.number(1), .number(2)])]), "mouse_button": .string("left")]) }
        #expect(throws: HelperError.self) { try parse(["action": .string("click"), "x": .number(4), "y": .number(5), "mouse_button": .string("left"),
                                                       "click_count": .number(1), "held": .array([.string("hyper")])]) }
    }
}
