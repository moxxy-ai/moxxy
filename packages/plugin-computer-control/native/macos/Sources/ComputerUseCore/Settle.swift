import ApplicationServices
import Foundation

/// How long to let an app settle: at least `minimum` after an action (`reacted` once the app has shown a change),
/// then until no change for `quiet` seconds and no busy indicator, never past `maximum` (Codex: about 1 s, up to 5 s).
public struct SettlePolicy: Sendable, Equatable {
    public let minimum: Double
    public let quiet: Double
    public let maximum: Double
    /// The minimum once a change notification has arrived: the app is reacting, so its quiet says it is done.
    public let reacted: Double
    /// How long nothing but a spinner may move before the wait ends: some spinners never stop.
    public let still: Double

    public init(minimum: Double, quiet: Double, maximum: Double, reacted: Double? = nil, still: Double? = nil) {
        self.minimum = minimum
        self.quiet = quiet
        self.maximum = maximum
        self.reacted = reacted ?? minimum
        self.still = still ?? maximum
    }

    public static let afterAction = SettlePolicy(minimum: 1.0, quiet: 0.3, maximum: 5.0, reacted: 0.4, still: 1.5)
    public static let observeOnly = SettlePolicy(minimum: 0, quiet: 0.3, maximum: 5.0, still: 1.5)
}

/// The settle decision as a pure function of time, so it is tested without an app.
public struct SettleClock: Sendable {
    static let busyPoll = 0.25
    /// How long after a reading of the window its own notifications may still arrive.
    static let echo = 0.1

    private let start: Double
    private let policy: SettlePolicy
    /// The policy's minimum less the time already spent, and never less than one quiet spell of listening.
    private let minimum: Double
    /// What is left of the reacted minimum, which counts from the action.
    private let afterReaction: Double
    private var lastChange: Double?
    private var reading: ClosedRange<Double>?

    /// `waited` is the time since the action went out; `reacted` says its effect was already seen in the window.
    public init(start: Double, policy: SettlePolicy, waited: Double = 0, reacted: Bool = false) {
        self.start = start
        self.policy = policy
        self.minimum = min(policy.minimum, max(policy.quiet, (reacted ? policy.reacted : policy.minimum) - waited))
        self.afterReaction = max(0, policy.reacted - waited)
    }

    public mutating func record(at time: Double) {
        if let reading, reading.contains(time) { return }
        lastChange = max(lastChange ?? time, time)
    }

    /// The window was read for a busy indicator: what it sends because of that is not a change.
    public mutating func read(from: Double, to: Double) {
        reading = from...(to + Self.echo)
    }

    /// When the app has had its time and has been still for `quiet`, or the wait is over anyway.
    private var quietAt: Double {
        min(max(start + (lastChange == nil ? minimum : min(minimum, afterReaction)), (lastChange ?? start) + policy.quiet), start + policy.maximum)
    }

    /// Whether the window may be read for a busy indicator. Reading it makes some apps send notifications
    /// themselves (System Settings destroys the elements it made to answer), which must not count as a change.
    public func isQuiet(now: Double) -> Bool {
        now >= (lastChange == nil ? start + minimum : quietAt)
    }

    public func isSettled(now: Double, busy: Bool) -> Bool {
        if now - start >= policy.maximum { return true }
        guard isQuiet(now: now) else { return false }
        return !busy || now >= (lastChange ?? start) + policy.still
    }

    /// When the decision can next change; a change notification may wake the waiter earlier.
    public func nextCheck(now: Double, busy: Bool) -> Double {
        let limit = start + policy.maximum
        if busy { return min(now + Self.busyPoll, limit) }
        return lastChange == nil ? min(start + minimum, limit) : quietAt
    }
}

/// A browser builds a page's accessibility tree only after the first client asks, so the first
/// look at a fresh tab can come back without the page.
public enum WebContent {
    static let wait = (attempts: 8, pause: 0.4)

    /// Reads again while the page is not there. A page that never shows in a background window gets its
    /// window brought forward once (a hidden browser tab can keep its content from accessibility), then the same wait.
    public static func awaited<Page>(first: Page, loaded: (Page) -> Bool, again: () -> Page, pause: () -> Void, bringForward: () -> Void) -> Page {
        var page = first
        for round in 0..<2 {
            for _ in 1..<wait.attempts where !loaded(page) {
                pause()
                page = again()
            }
            if loaded(page) || round == 1 { break }
            bringForward()
        }
        return page
    }

    /// A page that should be there and is not: an empty web area, or a tab group with nothing in it.
    /// A window that shows no page at all (the start page) has nothing to wait for.
    public static func isPending(_ node: NodeSnapshot) -> Bool { !isLoaded(node) && hasHole(node) }

    private static let containers: Set<String> = ["AXGroup", "AXScrollArea", "AXSplitGroup"]

    /// Only containers below: Safari first answers with a tab's empty shell, and the page comes seconds later.
    private static func isHollow(_ node: NodeSnapshot) -> Bool {
        node.children.allSatisfy { containers.contains($0.role) && isHollow($0) }
    }

    private static func hasHole(_ node: NodeSnapshot) -> Bool {
        (node.role == "AXWebArea" && node.children.isEmpty) || (node.role == "AXTabGroup" && isHollow(node)) || node.children.contains(where: hasHole)
    }

    public static func isLoaded(_ node: NodeSnapshot) -> Bool {
        (node.role == "AXWebArea" && !node.children.isEmpty) || node.children.contains(where: isLoaded)
    }
}

/// Apps that build their accessibility tree only once asked (see `AccessibilityWake`): browsers and Electron apps.
/// Only they need time after the first request; a native app's tree is already there.
public enum LateTree {
    public static func fills(bundle: URL?, browser: Bool, exists: (String) -> Bool = FileManager.default.fileExists(atPath:)) -> Bool {
        guard let bundle else { return true }
        return browser || exists(bundle.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path)
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
    private var subscription: Subscription?

    /// `busy` reads the window and says whether it shows a busy indicator; it is asked only once the app is quiet,
    /// so the caller can keep what it read as the settled state.
    /// `heard` is a listener started before the action, so the app's reaction to it is not missed.
    static func settle(pid: pid_t, policy: SettlePolicy, waited: Double = 0, reacted: Bool = false, heard: Settler? = nil, busy: () -> Bool) {
        let settler = heard ?? listen(pid)
        defer { if heard == nil { settler.stop() } }
        settler.wait(policy: policy, waited: waited, reacted: reacted, probe: busy)
    }

    static func listen(_ pid: pid_t) -> Settler {
        let settler = Settler()
        settler.subscription = settler.observe(pid)
        return settler
    }

    func stop() {
        subscription.map(stop)
        subscription = nil
    }

    /// Forgets what the app sent before `time`: reading it before an action makes some apps send changes.
    func forget(before time: Double) {
        lock.withLock { changes.removeAll { $0 < time } }
    }

    static func uptime(of date: Date) -> Double { ProcessInfo.processInfo.systemUptime - Date().timeIntervalSince(date) }

    private func now() -> Double { ProcessInfo.processInfo.systemUptime }

    fileprivate func changed() {
        lock.lock()
        changes.append(now())
        lock.unlock()
        wake.signal()
    }

    private func wait(policy: SettlePolicy, waited: Double, reacted: Bool, probe: () -> Bool) {
        var clock = SettleClock(start: now(), policy: policy, waited: waited, reacted: reacted)
        var busy = false
        while true {
            lock.lock()
            let recent = changes
            changes.removeAll()
            lock.unlock()
            for time in recent { clock.record(at: time) }
            let before = now()
            if clock.isQuiet(now: before) {
                busy = probe()
                clock.read(from: before, to: now())
            }
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

/// Browsers and Electron apps build their full accessibility tree only for a client that asks for it
/// (Codex does the same: `enableEnhancedUserInterface`, `enableElectronAccessibility`). Without it a page
/// in a background window can come back with no content at all. What was switched on is put back on exit.
public final class AccessibilityWake: @unchecked Sendable {
    static let enhanced = "AXEnhancedUserInterface"
    static let manual = "AXManualAccessibility"

    private let read: (pid_t, String) -> Bool?
    private let write: (pid_t, String, Bool) -> Void
    private let lock = NSLock()
    /// Per woken app, the switches that were off before.
    private var changed: [pid_t: [String]] = [:]

    public init(read: @escaping (pid_t, String) -> Bool?, write: @escaping (pid_t, String, Bool) -> Void) {
        self.read = read
        self.write = write
    }

    public static let system = AccessibilityWake(
        read: { pid, name in AXReader.attribute(AXReader.application(pid), name) },
        write: { pid, name, on in
            _ = AXUIElementSetAttributeValue(AXReader.application(pid), name as CFString, on ? kCFBooleanTrue : kCFBooleanFalse)
        })

    /// Returns whether this call woke the app, in which case its tree needs a moment to fill.
    @discardableResult
    public func wake(_ pid: pid_t) -> Bool {
        lock.withLock {
            guard changed[pid] == nil else { return false }
            let off = [Self.enhanced, Self.manual].filter { read(pid, $0) != true }
            off.forEach { write(pid, $0, true) }
            changed[pid] = off
            return true
        }
    }

    public func restore() {
        lock.withLock {
            for (pid, names) in changed { names.forEach { write(pid, $0, false) } }
            changed = [:]
        }
    }
}
