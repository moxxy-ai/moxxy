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
    /// Deltas and the event number of the drag in progress. Guarded by `lock`.
    private var motion = DragMotion()

    public init() {}

    var holding: MouseButton? { lock.withLock { held?.button } }

    /// Posts `steps`, then puts the pointer back unless `keepDown` stays pressed for a later `mouse` step.
    func perform(_ steps: [MouseStep], flags: CGEventFlags, keepDown: MouseButton? = nil, route: PointerRoute = .screen) {
        if case let .window(address) = route { return deliver(WindowEvent.withPrimer(steps), flags: flags, to: address) }
        let start = startLocation()
        for step in steps {
            if step.delay > 0 { Thread.sleep(forTimeInterval: step.delay) }
            post(step, flags: flags)
        }
        lock.withLock { held = keepDown.map { ($0, start) } }
        if keepDown == nil { restore(start) }
    }

    /// Wheel events at `point`; the pointer goes there because apps scroll whatever is under it.
    func scroll(_ steps: [(dy: Int32, dx: Int32)], at point: CGPoint, route: PointerRoute = .screen) {
        if case let .window(address) = route { return deliverWheel(steps, at: point, to: address) }
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

    /// The whole gesture goes to one window. The app is told its window has focus for as long as the gesture
    /// lasts, which browser engines need; the app in front and the user's pointer are left alone.
    private func deliver(_ steps: [MouseStep], flags: CGEventFlags, to window: WindowAddress) {
        focused(window) {
            let group = Int64(DispatchTime.now().uptimeNanoseconds % 1_000_000_000)
            for step in steps {
                if step.delay > 0 { Thread.sleep(forTimeInterval: step.delay) }
                guard let event = mouseEvent(step, flags: flags) else { continue }
                WindowServerLink.shared.send(event, stamp: WindowEvent.stamp(step, to: window, group: group), to: window.pid)
            }
        }
    }

    private func deliverWheel(_ steps: [(dy: Int32, dx: Int32)], at point: CGPoint, to window: WindowAddress) {
        let place = MouseStep(type: .scrollWheel, point: point, button: .left, clickState: 0, delay: 0)
        focused(window) {
            for step in steps {
                guard let event = CGEvent(scrollWheelEvent2Source: KeyboardInput.source, units: .pixel, wheelCount: 2, wheel1: step.dy, wheel2: step.dx, wheel3: 0) else { continue }
                event.location = point
                KeyboardInput.mark(event)
                WindowServerLink.shared.send(event, stamp: WindowEvent.stamp(place, to: window, group: 0), to: window.pid)
                Thread.sleep(forTimeInterval: 0.01)
            }
        }
    }

    private func focused(_ window: WindowAddress, _ body: () -> Void) {
        let lent = !Foreground.isFrontmost(window.pid) && WindowServerLink.shared.focus(window, true)
        body()
        guard lent else { return }
        // Delivery is asynchronous: the app must take the release before it is told the focus is gone.
        Thread.sleep(forTimeInterval: 0.1)
        WindowServerLink.shared.focus(window, false)
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

    /// Above the system's last press, so the gesture is taken as a new one.
    private static func nextEventNumber() -> Int64 {
        let presses: [CGEventType] = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        return presses.reduce(1) { $0 + Int64(CGEventSource.counterForEventType(.hidSystemState, eventType: $1)) }
    }

    private func currentLocation() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

    /// The system's own button state: toolkits that ask which buttons are down (Qt) take a drag only when it says so.
    private static var source: CGEventSource? { CGEventSource(stateID: .hidSystemState) }

    private func post(_ step: MouseStep, flags: CGEventFlags) {
        mouseEvent(step, flags: flags)?.post(tap: .cghidEventTap)
    }

    private func mouseEvent(_ step: MouseStep, flags: CGEventFlags) -> CGEvent? {
        guard let event = CGEvent(mouseEventSource: Self.source, mouseType: step.type, mouseCursorPosition: step.point, mouseButton: step.button) else { return nil }
        event.flags = flags
        if step.clickState > 0 { event.setIntegerValueField(.mouseEventClickState, value: Int64(step.clickState)) }
        let fields = lock.withLock { motion.fields(for: step.type, at: step.point, nextNumber: Self.nextEventNumber()) }
        if let number = fields.number { event.setIntegerValueField(.mouseEventNumber, value: number) }
        if let dx = fields.dx, let dy = fields.dy {
            event.setIntegerValueField(.mouseEventDeltaX, value: dx)
            event.setIntegerValueField(.mouseEventDeltaY, value: dy)
            event.setDoubleValueField(.mouseEventDeltaX, value: Double(dx))
            event.setDoubleValueField(.mouseEventDeltaY, value: Double(dy))
        }
        KeyboardInput.mark(event)
        return event
    }
}

/// Real input goes to whatever is under the pointer, so the target app must be in front first.
enum Foreground {
    enum Outcome { case alreadyFront, broughtForward, refused(ActionResult) }

    static let deadline: TimeInterval = 2
    /// How long the accessibility request gets before the workspace is asked.
    static let patience: TimeInterval = 0.4

    /// A fresh lookup: `NSWorkspace.frontmostApplication` goes stale in this helper, whose main thread never idles like an app's.
    static func isFrontmost(_ pid: pid_t) -> Bool { NSRunningApplication(processIdentifier: pid)?.isActive ?? false }

    static func bring(_ window: WindowCandidate) -> Outcome { bring(pid: window.pid, window: window) }

    /// Without a window (a document app with nothing open) the app itself comes forward, for its menu shortcuts.
    static func bring(pid: pid_t, window: WindowCandidate?) -> Outcome {
        let isUp = { isFrontmost(pid) && (window.map { WindowDirectory.onScreenWindowID(for: $0) != nil } ?? true) }
        if isUp() { return .alreadyFront }
        let sinceKey = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
        if ActivationGate.userIsTyping(secondsSinceKeyDown: sinceKey) {
            return .refused(.blocked("user_intervened", hint: "The user is typing right now; bringing the app forward would send their keys into it. Nothing was done; retry after a pause in their typing."))
        }
        let app = AXReader.application(pid)
        let workspace = { _ = NSRunningApplication(processIdentifier: pid)?.activate() }
        let accessibility = {
            AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
            if let element = AXReader.targetWindow(of: app) { AXUIElementPerformAction(element, kAXRaiseAction as CFString) }
        }
        // An app with no window ignores the accessibility request, and so does a window in its own full-screen
        // Space; the workspace brings those forward. Switching Space animates, so the wait is on the window server.
        if attempt(window == nil ? [workspace] : [accessibility, workspace], patience: patience, deadline: deadline, isUp: isUp) { return .broughtForward }
        return .refused(.blocked("not_frontmost", hint: "The app did not come to the front on this screen (its window may be on another Space or minimised). Ask the user to bring it here, or use element actions, which work in the background."))
    }

    /// Tries each way in turn until the app is up: every way but the last gets `patience`, all of them `deadline`.
    static func attempt(_ ways: [() -> Void], patience: TimeInterval, deadline: TimeInterval, isUp: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(deadline)
        for (index, way) in ways.enumerated() {
            way()
            let until = index == ways.count - 1 ? end : min(end, Date().addingTimeInterval(patience))
            while Date() < until {
                if isUp() { return true }
                Thread.sleep(forTimeInterval: 0.02)
            }
        }
        return isUp()
    }

    /// An app that just came forward is active before its window is on top everywhere; a hit test made in
    /// that gap still names the window that was in front. Waits until the point belongs to the app.
    static func awaitOnTop(at point: CGPoint, pid: pid_t, within limit: TimeInterval = 0.6) {
        let until = Date().addingTimeInterval(limit)
        while ScreenLayout.owner(at: point)?.pid != pid, Date() < until { Thread.sleep(forTimeInterval: 0.02) }
    }
}
