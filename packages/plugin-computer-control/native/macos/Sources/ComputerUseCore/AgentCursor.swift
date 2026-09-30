import AppKit

/// The request queue's handle on the overlay: every change runs on the main thread and is reported to the host.
public final class AgentCursor: @unchecked Sendable {
    private let emit: @Sendable (Data) -> Void
    /// Touched only on the main thread.
    private var overlay: CursorOverlay?
    /// Where the cursor is in the target window; kept across targets like a real pointer. Request queue only.
    private var fraction = CGPoint(x: 0.5, y: 0.5)

    public init(emit: @escaping @Sendable (Data) -> Void) { self.emit = emit }

    /// Shows the cursor over the window being worked in. A window on another Space or minimised gets
    /// no overlay (it would float over something else), but its position still goes to the PiP.
    func attach(to window: WindowCandidate) {
        let id = WindowDirectory.onScreenWindowID(for: window)
        let fraction = fraction
        onMain { overlay in
            if let id { overlay.show(above: id, frame: window.frame, at: fraction) } else { overlay.hide() }
        }
        emit(CursorEvent.frame(phase: .idle, at: fraction))
    }

    private func onMain(_ body: @MainActor (CursorOverlay) -> Void) {
        DispatchQueue.main.sync {
            MainActor.assumeIsolated {
                let overlay = self.overlay ?? CursorOverlay()
                self.overlay = overlay
                body(overlay)
            }
        }
    }
}

enum WindowDirectory {
    /// The window-server number behind an accessibility window, when it is on the current screen.
    static func onScreenWindowID(for target: WindowCandidate) -> CGWindowID? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        let candidates = list.map { info in
            WindowCandidate(
                pid: (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1,
                frame: (info[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0) } ?? .null,
                title: info[kCGWindowName as String] as? String
            )
        }
        guard let index = WindowMatch.best(for: target, in: candidates) else { return nil }
        return (list[index][kCGWindowNumber as String] as? NSNumber)?.uint32Value
    }
}
