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

    /// Glides to `point` (screen) in `window`, then reports the phases around `body`: moving, executing,
    /// then delivered or failed. Without a window there is nothing to draw over, so it only runs `body`.
    func act(at point: CGPoint?, outline: CGRect?, in window: WindowCandidate?, _ body: () -> ActionResult) -> ActionResult {
        guard let window else { return body() }
        let from = fraction
        if let point { fraction = OverlayGeometry.fraction(of: point, in: window.frame) }
        let to = fraction
        let id = WindowDirectory.onScreenWindowID(for: window)
        emit(CursorEvent.frame(phase: .moving, at: to))
        let glide = onMain { overlay -> Double in
            guard let id else { overlay.hide(); return 0 }
            overlay.show(above: id, frame: window.frame, at: from)
            overlay.outline(outline)
            return overlay.move(to: to)
        }
        if glide > 0 { Thread.sleep(forTimeInterval: glide) }
        emit(CursorEvent.frame(phase: .executing, at: to))
        let result = body()
        let delivered = result.outcome == .delivered
        onMain { overlay in
            if delivered { overlay.press() }
            overlay.outline(nil)
        }
        emit(CursorEvent.frame(phase: delivered ? .delivered : .failed, at: to))
        return result
    }

    private func onMain<T: Sendable>(_ body: @MainActor (CursorOverlay) -> T) -> T {
        DispatchQueue.main.sync {
            MainActor.assumeIsolated {
                let overlay = self.overlay ?? CursorOverlay()
                self.overlay = overlay
                return body(overlay)
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
