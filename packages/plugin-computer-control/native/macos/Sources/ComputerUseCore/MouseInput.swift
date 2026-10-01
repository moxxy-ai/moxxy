import AppKit
import ApplicationServices

/// What the window server shows right now, in global top-left points.
enum ScreenLayout {
    static func windows() -> [ScreenWindow] {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        return list.compactMap { info in
            guard let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary, let frame = CGRect(dictionaryRepresentation: bounds)
            else { return nil }
            return ScreenWindow(
                id: id,
                pid: (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1,
                layer: (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
                frame: frame,
                alpha: (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1,
                owner: info[kCGWindowOwnerName as String] as? String ?? "another app"
            )
        }
    }

    /// The window a real click at `point` would reach, found through accessibility hit-testing.
    static func owner(at point: CGPoint) -> ScreenWindow? {
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &element) == .success, let element else {
            return nil
        }
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else { return nil }
        return HitTest.owner(at: point, in: windows(), pid: pid, name: NSRunningApplication(processIdentifier: pid)?.localizedName ?? "another app")
    }

    static func displays() -> [CGRect] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
        return ids.prefix(Int(count)).map(CGDisplayBounds)
    }
}

/// Real pointer input. The user's pointer goes back where it was after every gesture, except while
/// the model holds a button down across `mouse` steps.
public final class PointerSession: @unchecked Sendable {
    /// Lets the app finish handling the release before the pointer leaves.
    static let settleBeforeRestore: TimeInterval = 0.05

    private let lock = NSLock()
    /// Set between a `mouse` down and its up. Guarded by `lock`.
    private var held: (button: MouseButton, restore: CGPoint)?

    public init() {}

    var holding: MouseButton? { lock.withLock { held?.button } }

    /// Posts `steps`, then puts the pointer back unless `keepDown` stays pressed for a later `mouse` step.
    func perform(_ steps: [MouseStep], flags: CGEventFlags, keepDown: MouseButton? = nil) {
        let start = startLocation()
        for step in steps {
            if step.delay > 0 { Thread.sleep(forTimeInterval: step.delay) }
            post(step, flags: flags)
        }
        lock.withLock { held = keepDown.map { ($0, start) } }
        if keepDown == nil { restore(start) }
    }

    /// Wheel events at `point`; the pointer goes there because apps scroll whatever is under it.
    func scroll(_ steps: [(dy: Int32, dx: Int32)], at point: CGPoint) {
        let start = startLocation()
        post(MouseStep(type: .mouseMoved, point: point, button: .left, clickState: 0, delay: 0), flags: [])
        for step in steps {
            guard let event = CGEvent(scrollWheelEvent2Source: KeyboardInput.source, units: .pixel, wheelCount: 2, wheel1: step.dy, wheel2: step.dx, wheel3: 0) else { continue }
            event.location = point
            KeyboardInput.mark(event)
            event.post(tap: .cghidEventTap)
            // Apps that animate scrolling drop wheel events that arrive all at once.
            Thread.sleep(forTimeInterval: 0.01)
        }
        if holding == nil { restore(start) }
    }

    /// Lets go of a button the model left down (end of turn, stop, helper exit) and returns the pointer.
    public func release() {
        guard let (button, start) = lock.withLock({ held }) else { return }
        let kind = MouseScript.types(button)
        post(MouseStep(type: kind.up, point: currentLocation(), button: kind.button, clickState: 1, delay: 0), flags: [])
        lock.withLock { held = nil }
        restore(start)
    }

    /// Where the pointer goes back to: where the user left it, even across a held gesture.
    private func startLocation() -> CGPoint { lock.withLock { held?.restore } ?? currentLocation() }

    private func restore(_ location: CGPoint) {
        Thread.sleep(forTimeInterval: Self.settleBeforeRestore)
        CGWarpMouseCursorPosition(location)
        // Warping detaches the pointer from the mouse for a moment; reattach at once so the user keeps control.
        CGAssociateMouseAndMouseCursorPosition(1)
    }

    private func currentLocation() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

    private func post(_ step: MouseStep, flags: CGEventFlags) {
        guard let event = CGEvent(mouseEventSource: KeyboardInput.source, mouseType: step.type, mouseCursorPosition: step.point, mouseButton: step.button) else { return }
        event.flags = flags
        if step.clickState > 0 { event.setIntegerValueField(.mouseEventClickState, value: Int64(step.clickState)) }
        KeyboardInput.mark(event)
        event.post(tap: .cghidEventTap)
    }
}

/// Real input goes to whatever is under the pointer, so the target app must be in front first.
enum Foreground {
    enum Outcome { case alreadyFront, broughtForward, refused(ActionResult) }

    static let deadline: TimeInterval = 2

    /// A fresh lookup: `NSWorkspace.frontmostApplication` goes stale in this helper, whose main thread never idles like an app's.
    static func isFrontmost(_ pid: pid_t) -> Bool { NSRunningApplication(processIdentifier: pid)?.isActive ?? false }

    static func bring(_ window: WindowCandidate) -> Outcome {
        if isFrontmost(window.pid), WindowDirectory.onScreenWindowID(for: window) != nil { return .alreadyFront }
        let sinceKey = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
        if ActivationGate.userIsTyping(secondsSinceKeyDown: sinceKey) {
            return .refused(.blocked("user_intervened", hint: "The user is typing right now; bringing the app forward would send their keys into it. Nothing was done; retry after a pause in their typing."))
        }
        let app = AXReader.application(window.pid)
        AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        if let element = AXReader.targetWindow(of: app) { AXUIElementPerformAction(element, kAXRaiseAction as CFString) }
        // Switching to the app's Space animates; the window counts once the window server shows it here.
        let until = Date().addingTimeInterval(deadline)
        while Date() < until {
            if isFrontmost(window.pid), WindowDirectory.onScreenWindowID(for: window) != nil { return .broughtForward }
            Thread.sleep(forTimeInterval: 0.02)
        }
        return .refused(.blocked("not_frontmost", hint: "The app did not come to the front on this screen (its window may be on another Space or minimised). Ask the user to bring it here, or use element actions, which work in the background."))
    }
}
