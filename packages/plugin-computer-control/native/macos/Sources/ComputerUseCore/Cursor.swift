import CoreGraphics
import Foundation

/// Where an action is in its life (`computerCursorPhaseSchema` in the SDK).
public enum CursorPhase: String, Sendable {
    case idle, moving, executing, delivered, failed
}

/// Maps between screen rects (top-left origin on the primary display, as AX and CGWindowList report them)
/// and the overlay panel, which AppKit places from the primary display's bottom-left.
public enum OverlayGeometry {
    public static func panelRect(window: CGRect, primaryHeight: CGFloat, margin: CGFloat) -> CGRect {
        CGRect(x: window.minX, y: primaryHeight - window.maxY, width: window.width, height: window.height)
            .insetBy(dx: -margin, dy: -margin)
    }

    /// A screen point as a fraction of the window, clamped to it; the centre of a window with no size.
    public static func fraction(of point: CGPoint, in window: CGRect) -> CGPoint {
        guard window.width > 0, window.height > 0 else { return CGPoint(x: 0.5, y: 0.5) }
        let clamp = { (value: CGFloat) in min(max(value, 0), 1) }
        return CGPoint(x: clamp((point.x - window.minX) / window.width), y: clamp((point.y - window.minY) / window.height))
    }

    public static func viewPoint(_ fraction: CGPoint, windowSize: CGSize, margin: CGFloat) -> CGPoint {
        CGPoint(x: margin + fraction.x * windowSize.width, y: margin + (1 - fraction.y) * windowSize.height)
    }

    public static func viewRect(_ rect: CGRect, window: CGRect, margin: CGFloat) -> CGRect {
        CGRect(x: margin + rect.minX - window.minX, y: margin + window.maxY - rect.maxY, width: rect.width, height: rect.height)
    }
}

/// How the cursor travels: an arc whose time grows with distance, like Codex's spring-timed glide,
/// straight for short hops, and no travel at all under Reduce Motion.
public enum CursorMotion {
    public static let minimumDuration = 0.18
    public static let maximumDuration = 0.5
    static let secondsPerPoint = 0.0006
    static let straightBelow: CGFloat = 40
    static let arcRatio: CGFloat = 0.15
    public static let maximumArc: CGFloat = 60

    public static func duration(distance: CGFloat, reduceMotion: Bool) -> Double {
        if reduceMotion { return 0 }
        return min(max(minimumDuration, minimumDuration + Double(distance) * secondsPerPoint), maximumDuration)
    }

    public struct Path: Sendable, Equatable {
        public let start: CGPoint
        public let control: CGPoint
        public let end: CGPoint

        /// The quadratic Bézier point at `t` in 0...1.
        public func point(at t: CGFloat) -> CGPoint {
            let u = 1 - t
            return CGPoint(x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
                           y: u * u * start.y + 2 * u * t * control.y + t * t * end.y)
        }
    }

    public static func path(from start: CGPoint, to end: CGPoint) -> Path {
        let middle = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
        let dx = end.x - start.x
        let dy = end.y - start.y
        let distance = (dx * dx + dy * dy).squareRoot()
        guard distance >= straightBelow else { return Path(start: start, control: middle, end: end) }
        // Bow to the left of the direction of travel, like a hand sweeping across.
        let bow = min(distance * arcRatio, maximumArc)
        return Path(start: start, control: CGPoint(x: middle.x - dy / distance * bow, y: middle.y + dx / distance * bow), end: end)
    }
}

/// The uncorrelated `cursor` frame of the shared protocol (`cursorEventSchemaFor` in `src/backend/rpc.ts`).
public enum CursorEvent {
    /// `phase == nil` means the cursor is hidden.
    public static func frame(phase: CursorPhase?, at fraction: CGPoint) -> Data {
        let cursor: JSONValue = phase.map {
            .object(["phase": .string($0.rawValue), "x": .number(Double(fraction.x)), "y": .number(Double(fraction.y))])
        } ?? .null
        return Wire.event("cursor", ["cursor": cursor])
    }
}
