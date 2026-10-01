import CoreGraphics
import Foundation

/// What one event seen by the guard means. Our own events carry `KeyboardInput.marker`.
public enum UserInput {
    public enum Kind: Equatable, Sendable { case ours, escape, activity, ignored }

    static let escapeKeyCode: Int64 = 53

    public static func classify(type: CGEventType, keyCode: Int64, userData: Int64) -> Kind {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput, .null: return .ignored
        default: break
        }
        if userData == KeyboardInput.marker { return .ours }
        if type == .keyDown, keyCode == escapeKeyCode { return .escape }
        return .activity
    }
}

/// Real pointer input waits for a moment in which the user is not using the mouse or keyboard
/// (as Claude does: up to six waits of 400 ms), so the two hands never fight over the pointer.
public enum QuietWait {
    public enum Decision: Equatable, Sendable { case go, wait(TimeInterval), refuse }

    static let moment: TimeInterval = 0.4
    static let attempts = 6

    public static func next(sinceInput: TimeInterval, attempt: Int) -> Decision {
        if sinceInput >= moment { return .go }
        guard attempt < attempts else { return .refuse }
        return .wait(((moment - sinceInput) * 1000).rounded() / 1000)
    }
}

/// Pause and resume from the host's controls. An action that arrives while paused waits for the user
/// and then asks for a fresh observation, because the app may have changed meanwhile.
public final class ControlGate: @unchecked Sendable {
    private let emit: @Sendable (String) -> Void
    private let condition = NSCondition()
    /// Guarded by `condition`.
    private var paused = false

    /// `emit` reports a `control_state` for the request that is waiting.
    public init(emit: @escaping @Sendable (String) -> Void) { self.emit = emit }

    public func pause() {
        condition.withLock { paused = true }
    }

    public func resume() {
        condition.withLock {
            paused = false
            condition.broadcast()
        }
    }

    var isPaused: Bool { condition.withLock { paused } }

    /// `true` when the action had to wait; the caller must not act on its old observation.
    func waitWhilePaused() -> Bool {
        condition.lock()
        guard paused else { condition.unlock(); return false }
        condition.unlock()
        emit("paused_by_user")
        condition.lock()
        while paused { condition.wait() }
        condition.unlock()
        emit("recovering")
        return true
    }
}

/// Accessibility actions an element keeps declining: after three declines it is skipped for five seconds,
/// so each step goes straight to the next method instead of asking again.
public final class DeclineMemory: @unchecked Sendable {
    static let limit = 3
    static let pause: TimeInterval = 5

    private let lock = NSLock()
    /// Guarded by `lock`.
    private var entries: [String: (count: Int, until: Date?)] = [:]

    public init() {}

    func skips(_ key: String, at now: Date = Date()) -> Bool {
        lock.withLock {
            guard let until = entries[key]?.until else { return false }
            if now < until { return true }
            entries[key] = nil
            return false
        }
    }

    func declined(_ key: String, at now: Date = Date()) {
        lock.withLock {
            let count = (entries[key]?.count ?? 0) + 1
            entries[key] = (count, count >= Self.limit ? now.addingTimeInterval(Self.pause) : nil)
        }
    }

    func worked(_ key: String) { lock.withLock { entries[key] = nil } }
}
