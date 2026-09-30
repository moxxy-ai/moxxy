import ApplicationServices
import Foundation

/// How long to let an app settle: at least `minimum` after an action, then until no change for
/// `quiet` seconds and no busy indicator, never past `maximum` (Codex: about 1 s, up to 5 s).
public struct SettlePolicy: Sendable, Equatable {
    public let minimum: Double
    public let quiet: Double
    public let maximum: Double

    public static let afterAction = SettlePolicy(minimum: 1.0, quiet: 0.3, maximum: 5.0)
    public static let observeOnly = SettlePolicy(minimum: 0, quiet: 0.3, maximum: 5.0)
}

/// The settle decision as a pure function of time, so it is tested without an app.
public struct SettleClock: Sendable {
    static let busyPoll = 0.25

    private let start: Double
    private let policy: SettlePolicy
    private var lastChange: Double?

    public init(start: Double, policy: SettlePolicy) {
        self.start = start
        self.policy = policy
    }

    public mutating func record(at time: Double) {
        lastChange = max(lastChange ?? time, time)
    }

    public func isSettled(now: Double, busy: Bool) -> Bool {
        if now - start >= policy.maximum { return true }
        if busy || now < start + policy.minimum { return false }
        guard let lastChange else { return true }
        return now - lastChange >= policy.quiet
    }

    /// When the decision can next change; a change notification may wake the waiter earlier.
    public func nextCheck(now: Double, busy: Bool) -> Double {
        let limit = start + policy.maximum
        if busy { return min(now + Self.busyPoll, limit) }
        return min(max(start + policy.minimum, (lastChange ?? now) + policy.quiet), limit)
    }
}

public enum BusyProbe {
    /// Spinners mean content is still arriving; a determinate progress bar may be a finished state.
    public static func isBusy(_ node: NodeSnapshot) -> Bool {
        node.role == "AXBusyIndicator" || node.children.contains(where: isBusy)
    }

    static func isBusy(window: AXUIElement) -> Bool {
        if AXReader.attribute(window, "AXElementBusy") == true { return true }
        return spinnerBelow(window, depth: 0)
    }

    /// A role-only walk: far cheaper than a full snapshot, repeated while waiting.
    private static func spinnerBelow(_ element: AXUIElement, depth: Int) -> Bool {
        guard depth < 32 else { return false }
        let children: [AXUIElement] = AXReader.attribute(element, kAXChildrenAttribute) ?? []
        return children.contains { child in
            AXReader.attribute(child, kAXRoleAttribute) == "AXBusyIndicator" || spinnerBelow(child, depth: depth + 1)
        }
    }
}

/// Waits for an app to settle, woken early by its accessibility notifications.
final class Settler: @unchecked Sendable {
    static let notifications = [
        kAXValueChangedNotification, kAXUIElementDestroyedNotification, kAXCreatedNotification, kAXLayoutChangedNotification,
        kAXFocusedUIElementChangedNotification, kAXWindowCreatedNotification, kAXTitleChangedNotification,
        kAXSelectedChildrenChangedNotification, kAXRowCountChangedNotification, "AXElementBusyChanged", "AXLoadComplete",
    ]

    private let lock = NSLock()
    private var changes: [Double] = []
    private let wake = DispatchSemaphore(value: 0)

    static func settle(pid: pid_t, window: AXUIElement, policy: SettlePolicy) {
        let settler = Settler()
        let subscription = settler.observe(pid)
        defer { subscription.map(settler.stop) }
        settler.wait(window: window, policy: policy)
    }

    private func now() -> Double { ProcessInfo.processInfo.systemUptime }

    fileprivate func changed() {
        lock.lock()
        changes.append(now())
        lock.unlock()
        wake.signal()
    }

    private func wait(window: AXUIElement, policy: SettlePolicy) {
        var clock = SettleClock(start: now(), policy: policy)
        while true {
            lock.lock()
            let recent = changes
            changes.removeAll()
            lock.unlock()
            for time in recent { clock.record(at: time) }
            let busy = BusyProbe.isBusy(window: window)
            let current = now()
            if clock.isSettled(now: current, busy: busy) { return }
            _ = wake.wait(timeout: .now() + max(0.01, clock.nextCheck(now: current, busy: busy) - current))
        }
    }

    private struct Subscription {
        let observer: AXObserver
        let app: AXUIElement
        let context: UnsafeMutableRawPointer
    }

    /// Notifications arrive on the main run loop, which AppKit keeps running.
    private func observe(_ pid: pid_t) -> Subscription? {
        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, _, refcon in
            guard let refcon else { return }
            Unmanaged<Settler>.fromOpaque(refcon).takeUnretainedValue().changed()
        }
        guard AXObserverCreate(pid, callback, &created) == .success, let observer = created else { return nil }
        let app = AXReader.application(pid)
        // Retained until the main loop can no longer call back (see `stop`).
        let context = Unmanaged.passRetained(self).toOpaque()
        for name in Self.notifications { _ = AXObserverAddNotification(observer, app, name as CFString, context) }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        return Subscription(observer: observer, app: app, context: context)
    }

    private func stop(_ subscription: Subscription) {
        for name in Self.notifications { _ = AXObserverRemoveNotification(subscription.observer, subscription.app, name as CFString) }
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(subscription.observer), .defaultMode)
        // A callback already running on the main thread finishes before this block runs.
        let context = UInt(bitPattern: subscription.context)
        DispatchQueue.main.async {
            guard let pointer = UnsafeMutableRawPointer(bitPattern: context) else { return }
            Unmanaged<Settler>.fromOpaque(pointer).release()
        }
    }
}
