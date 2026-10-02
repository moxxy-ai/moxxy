import Darwin
import Dispatch

/// Calls `onExit` once the parent process exits, so a helper never outlives the host that drives it.
public final class ParentWatch: Sendable {
    private let source: DispatchSourceProcess

    /// `nil` when the parent is already gone: the caller must exit instead of waiting forever.
    public init?(pid: pid_t, queue: DispatchQueue, onExit: @escaping @Sendable () -> Void) {
        guard pid > 1, kill(pid, 0) == 0 || errno == EPERM else { return nil }
        source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: queue)
        source.setEventHandler(handler: onExit)
        source.resume()
        // The parent may have exited between the check and the registration.
        if kill(pid, 0) != 0 && errno == ESRCH {
            source.cancel()
            return nil
        }
    }

    deinit { source.cancel() }
}
