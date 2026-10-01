import CoreGraphics
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct PointerRouteTests {
    private let address = WindowAddress(pid: 10, id: 77, origin: CGPoint(x: 100, y: 50))

    @Test func sendsALeftButtonGestureToTheWindowWhenItCan() {
        #expect(PointerRoute.choose(available: true, window: address, button: .left, repeated: false) == .window(address))
    }

    @Test func goesThroughTheScreenWhenTheWindowCannotBeAddressed() {
        #expect(PointerRoute.choose(available: false, window: address, button: .left, repeated: false) == .screen)
        #expect(PointerRoute.choose(available: true, window: nil, button: .left, repeated: false) == .screen)
    }

    // The window route is only known to carry the left button.
    @Test func goesThroughTheScreenForOtherButtons() {
        #expect(PointerRoute.choose(available: true, window: address, button: .right, repeated: false) == .screen)
        #expect(PointerRoute.choose(available: true, window: address, button: .middle, repeated: false) == .screen)
    }

    // The model asking for the same thing again means the background attempt did not do it.
    @Test func goesThroughTheScreenWhenTheSameGestureIsAskedAgain() {
        #expect(PointerRoute.choose(available: true, window: address, button: .left, repeated: true) == .screen)
    }
}

@Suite struct WindowEventTests {
    private let address = WindowAddress(pid: 10, id: 0x0102_0304, origin: CGPoint(x: 100, y: 50))

    @Test func addressesAnEventToTheWindowInItsOwnCoordinates() {
        let step = MouseStep(type: .leftMouseDown, point: CGPoint(x: 130, y: 90), button: .left, clickState: 2, delay: 0)
        let stamp = WindowEvent.stamp(step, to: address, group: 5)
        #expect(stamp.location == CGPoint(x: 30, y: 40))
        #expect(stamp.fields[WindowEvent.Field.targetPID] == 10)
        #expect(stamp.fields[WindowEvent.Field.windowNumber] == 0x0102_0304)
        #expect(stamp.fields[WindowEvent.Field.windowUnderPointer] == 0x0102_0304)
        #expect(stamp.fields[WindowEvent.Field.clickState] == 2)
        #expect(stamp.fields[WindowEvent.Field.clickGroup] == 5)
    }

    // Browser engines only take a click after a press and release off the window.
    @Test func putsAPrimerPressBeforeTheFirstRealPress() {
        let click = MouseScript.click(at: CGPoint(x: 130, y: 90), button: .left, count: 1)
        let primed = WindowEvent.withPrimer(click)
        #expect(primed.map(\.type) == [.mouseMoved, .leftMouseDown, .leftMouseUp, .leftMouseDown, .leftMouseUp])
        #expect(primed[1].point == WindowEvent.primer && primed[2].point == WindowEvent.primer)
        #expect(primed[3].point == CGPoint(x: 130, y: 90))
        #expect(primed[3].delay >= 0.1)
        #expect(WindowEvent.stamp(primed[1], to: address, group: 1).location == WindowEvent.primer)
    }

    @Test func leavesAGestureWithoutAPressAlone() {
        let move = MouseScript.single(.move, at: CGPoint(x: 1, y: 1), button: .left, held: true)
        #expect(WindowEvent.withPrimer(move) == move)
    }

    @Test func writesTheWindowAndTheFocusIntoTheActivationRecord() {
        let on = WindowEvent.focusRecord(window: 0x0102_0304, focused: true)
        #expect(on.count == 0xF8)
        #expect(Array(on[0x3C...0x3F]) == [0x04, 0x03, 0x02, 0x01])
        #expect(on[0x8A] == 1)
        #expect(WindowEvent.focusRecord(window: 1, focused: false)[0x8A] == 2)
    }
}

@Suite struct VisibleChangeTests {
    private func image(_ fill: UInt8, width: Int = 40, height: Int = 40) -> PixelBuffer {
        PixelBuffer(width: width, height: height, bytes: [UInt8](repeating: fill, count: width * height * 4))
    }

    @Test func seesNoChangeInTheSamePixels() {
        #expect(!PixelPatch.changed(image(100), image(104)))
    }

    // A caret blinking is no sign that a gesture arrived.
    @Test func ignoresAFewPixels() {
        var after = image(100)
        for pixel in 0..<20 { after.bytes[pixel * 4] = 255 }
        #expect(!PixelPatch.changed(image(100), after))
    }

    @Test func seesAnAreaThatWasRedrawn() {
        var after = image(100)
        for pixel in 0..<200 { after.bytes[pixel * 4] = 255 }
        #expect(PixelPatch.changed(image(100), after))
        #expect(PixelPatch.changed(image(100), image(100, width: 20)))
    }
}
