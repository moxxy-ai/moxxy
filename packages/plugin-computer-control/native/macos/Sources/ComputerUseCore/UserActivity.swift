import AppKit

/// The user's own mouse and keyboard, seen through a listen-only event tap: it never delays, changes or
/// swallows their input (Claude grabs Escape as a global shortcut instead). The user's Escape stops Computer Use.
public final class UserActivity: @unchecked Sendable {
    private let onEscape: @Sendable () -> Void
    private let lock = NSLock()
    /// When the user last touched the mouse or keyboard. Guarded by `lock`.
    private var last = Date.distantPast
    private var tap: CFMachPort?
    public private(set) var watching = false

    public init(onEscape: @escaping @Sendable () -> Void) { self.onEscape = onEscape }

    /// Starts watching on a thread of its own; `false` when the system refuses a tap (no Input Monitoring).
    @discardableResult
    public func start() -> Bool {
        let mask = [CGEventType.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                    .otherMouseDown, .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
            .reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask,
                                          callback: { _, type, event, info in
                                              if let info { Unmanaged<UserActivity>.fromOpaque(info).takeUnretainedValue().saw(type, event) }
                                              return Unmanaged.passUnretained(event)
                                          }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        else { return false }
        self.tap = tap
        let thread = Thread { [self] in
            guard let tap = self.tap else { return }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            CFRunLoopRun()
        }
        thread.name = "ai.moxxy.computer.user-activity"
        thread.start()
        watching = true
        return true
    }

    /// Seconds since the user last used the mouse or keyboard. Without a tap only their typing is known.
    func secondsSinceInput() -> TimeInterval {
        guard watching else { return CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown) }
        return lock.withLock { Date().timeIntervalSince(last) }
    }

    private func saw(_ type: CGEventType, _ event: CGEvent) {
        switch UserInput.classify(type: type, keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                                  userData: event.getIntegerValueField(.eventSourceUserData)) {
        case .ignored:
            // The system switches a slow tap off; switch it back on.
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .ours:
            break
        case .escape:
            lock.withLock { last = Date() }
            onEscape()
        case .activity:
            lock.withLock { last = Date() }
        }
    }
}

/// Everything real input shares across requests: the pointer and keys Moxxy holds, the host's pause
/// control, the user's own activity and the host process real input never goes to.
public struct InputSessions: Sendable {
    public let pointer: PointerSession
    public let keys: KeySession
    public let gate: ControlGate?
    public let activity: UserActivity?
    public let host: pid_t

    public init(pointer: PointerSession = PointerSession(), keys: KeySession = KeySession(), gate: ControlGate? = nil,
                activity: UserActivity? = nil, host: pid_t = getppid()) {
        self.pointer = pointer
        self.keys = keys
        self.gate = gate
        self.activity = activity
        self.host = host
    }

    /// No button or key Moxxy pressed stays down for the user.
    public func release() {
        pointer.release()
        keys.release()
    }
}
