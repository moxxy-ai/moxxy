import CoreGraphics
import Foundation

/// One on-screen window as the window server lists it (front to back), in global top-left points.
public struct ScreenWindow: Equatable, Sendable {
    public let id: CGWindowID
    public let pid: pid_t
    public let layer: Int
    public let frame: CGRect
    public let alpha: Double
    public let owner: String
}

public enum HitTest {
    /// The window a real click at `point` lands on. `pid` is the app accessibility finds there: it follows
    /// real shapes, while window rectangles do not (the Dock's window spans the whole screen). An app with
    /// no window at the point (Finder's desktop) counts as the desktop; `nil` means nothing is there.
    public static func owner(at point: CGPoint, in windows: [ScreenWindow], pid: pid_t?, name: String = "another app") -> ScreenWindow? {
        guard let pid else { return nil }
        return windows.first { $0.pid == pid && $0.alpha > 0 && $0.frame.contains(point) }
            ?? ScreenWindow(id: 0, pid: pid, layer: -1, frame: .zero, alpha: 1, owner: name)
    }
}

/// Checks made right before real input: the point must be on a display and land on the target app.
public enum PointerGate {
    /// Desktop windows sit below every normal window level.
    static func isDesktop(_ window: ScreenWindow?) -> Bool { window.map { $0.layer < 0 } ?? true }

    /// `nil` when the input may go; `host` is the process Moxxy runs in (the helper's parent).
    public static func check(_ point: CGPoint, displays: [CGRect], under: ScreenWindow?, target: pid_t, host: pid_t) -> ActionResult? {
        guard displays.contains(where: { $0.contains(point) }) else {
            return .blocked("point_outside_frame", hint: "That point is off every display; aim inside the window in the latest screenshot.")
        }
        if isDesktop(under) {
            return .blocked("hit_test_mismatch", hint: "The click would land on the desktop, whose icons can open apps outside the grant. Observe the app again and aim inside its window.")
        }
        guard let under else { return nil }
        if under.owner == "Dock" {
            return .blocked("hit_test_mismatch", hint: "The Dock is at that point and could open apps outside the grant. Observe the app again and aim inside its window.")
        }
        if under.pid == host { return .blocked("own_window") }
        if under.pid != target {
            return .blocked("hit_test_mismatch", hint: "\(under.owner) covers that point, so the click would go to it. Observe the app again, or ask the user to move the window in the way.")
        }
        return nil
    }
}

public struct PatchRect: Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
}

/// RGBA pixels of a screenshot, kept to compare the target before a click by coordinates.
public struct PixelBuffer: Equatable, Sendable {
    public let width: Int
    public let height: Int
    public var bytes: [UInt8]
}

/// The area around a click by coordinates must look as it did in the screenshot the model aimed at.
public enum PixelPatch {
    public static let size = 9

    /// Whether every pixel is black: what a capture of a GPU-drawn window on another Space looks like.
    public static func isBlank(_ buffer: PixelBuffer) -> Bool {
        stride(from: 0, to: buffer.bytes.count - 3, by: 4).allSatisfy { buffer.bytes[$0] < 8 && buffer.bytes[$0 + 1] < 8 && buffer.bytes[$0 + 2] < 8 }
    }
    /// A channel may drift this much (colour conversion) and still count as the same pixel.
    static let channelTolerance = 24
    /// More differing pixels than a blinking caret covers count as the window having been redrawn.
    static let redrawnPixels = 64

    /// Whether two captures of a window differ enough to say a gesture did something.
    public static func changed(_ before: PixelBuffer, _ after: PixelBuffer) -> Bool {
        guard before.width == after.width, before.height == after.height, before.bytes.count == after.bytes.count else { return true }
        var differing = 0
        for pixel in stride(from: 0, to: before.bytes.count - 3, by: 4) {
            guard (0..<3).contains(where: { abs(Int(before.bytes[pixel + $0]) - Int(after.bytes[pixel + $0])) > channelTolerance }) else { continue }
            differing += 1
            if differing > redrawnPixels { return true }
        }
        return false
    }

    /// A `size`-wide square centred on the pixel, cut at the image edge; `nil` outside the image.
    public static func rect(aroundX x: Int, y: Int, width: Int, height: Int) -> PatchRect? {
        guard (0..<width).contains(x), (0..<height).contains(y) else { return nil }
        let left = max(0, x - size / 2)
        let top = max(0, y - size / 2)
        return PatchRect(x: left, y: top, width: min(size, width - left), height: min(size, height - top))
    }

    public static func pixels(_ image: PixelBuffer, in rect: PatchRect) -> [UInt8] {
        var patch: [UInt8] = []
        patch.reserveCapacity(rect.width * rect.height * 4)
        for row in rect.y..<(rect.y + rect.height) {
            let start = (row * image.width + rect.x) * 4
            patch.append(contentsOf: image.bytes[start..<(start + rect.width * 4)])
        }
        return patch
    }

    /// Up to one column of the patch may differ, so a blinking caret does not block a click.
    public static func same(_ before: [UInt8], _ after: [UInt8]) -> Bool {
        guard before.count == after.count, before.count % 4 == 0 else { return false }
        var differing = 0
        for pixel in stride(from: 0, to: before.count, by: 4) {
            let changed = (0..<3).contains { abs(Int(before[pixel + $0]) - Int(after[pixel + $0])) > channelTolerance }
            if changed { differing += 1 }
        }
        return differing <= size
    }
}

/// One mouse event to post; `delay` is waited before posting it.
public struct MouseStep: Equatable, Sendable {
    public let type: CGEventType
    public let point: CGPoint
    public let button: CGMouseButton
    public let clickState: Int
    public let delay: TimeInterval
}

public enum MousePhase: String, Sendable { case down, move, up }

/// The event sequences behind clicks, drags and single mouse steps.
public enum MouseScript {
    /// Slow drags move at about display refresh rate.
    static let stepsPerSecond = 60.0
    /// A segment is never one jump: apps and the window server recognise a drag from small moves.
    static let minimumStepsPerSegment = 10
    /// The press is held this long before the first move, or the gesture reads as a click.
    public static let holdBeforeDrag: TimeInterval = 0.05

    static func types(_ button: MouseButton) -> (down: CGEventType, up: CGEventType, dragged: CGEventType, button: CGMouseButton) {
        switch button {
        case .left: (.leftMouseDown, .leftMouseUp, .leftMouseDragged, .left)
        case .right: (.rightMouseDown, .rightMouseUp, .rightMouseDragged, .right)
        case .middle: (.otherMouseDown, .otherMouseUp, .otherMouseDragged, .center)
        }
    }

    private static func step(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, state: Int = 0, delay: TimeInterval = 0) -> MouseStep {
        MouseStep(type: type, point: point, button: button, clickState: state, delay: delay)
    }

    /// Each press carries its click number, which is how apps tell a double click from two clicks.
    public static func click(at point: CGPoint, button: MouseButton, count: Int) -> [MouseStep] {
        let kind = types(button)
        var steps = [step(.mouseMoved, point, kind.button)]
        for state in 1...max(1, count) {
            steps.append(step(kind.down, point, kind.button, state: state))
            steps.append(step(kind.up, point, kind.button, state: state))
        }
        return steps
    }

    /// Down at the first point, through every point, up at the last; a duration is spread evenly over the moves.
    public static func drag(_ path: [CGPoint], button: MouseButton, duration: TimeInterval) -> [MouseStep] {
        guard let first = path.first, let last = path.last else { return [] }
        let kind = types(button)
        let segments = max(1, path.count - 1)
        let perSegment = max(minimumStepsPerSegment, Int((duration * stepsPerSecond / Double(segments)).rounded(.up)))
        var points: [CGPoint] = []
        for (from, to) in zip(path, path.dropFirst()) {
            for part in 1...perSegment {
                let fraction = Double(part) / Double(perSegment)
                points.append(CGPoint(x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction))
            }
        }
        let delay = duration / Double(points.count)
        return [step(.mouseMoved, first, kind.button), step(kind.down, first, kind.button, state: 1)]
            + points.enumerated().map { index, point in step(kind.dragged, point, kind.button, delay: delay + (index == 0 ? holdBeforeDrag : 0)) }
            + [step(kind.up, last, kind.button, state: 1)]
    }

    /// One step of a gesture the model spells out itself; `held` says whether the button is already down.
    public static func single(_ phase: MousePhase, at point: CGPoint, button: MouseButton, held: Bool) -> [MouseStep] {
        let kind = types(button)
        switch phase {
        case .down: return [step(.mouseMoved, point, kind.button), step(kind.down, point, kind.button, state: 1)]
        case .move: return [step(held ? kind.dragged : .mouseMoved, point, kind.button)]
        case .up: return [step(held ? kind.dragged : .mouseMoved, point, kind.button), step(kind.up, point, kind.button, state: 1)]
        }
    }
}

/// What a synthetic drag must carry on recent macOS: each move its delta (the movement is read from it, not from
/// the position) and the whole press-move-release one event number.
public struct DragMotion: Sendable {
    public struct Fields: Equatable, Sendable {
        public let number: Int64?
        public let dx: Int64?
        public let dy: Int64?
    }

    private var gesture: (number: Int64, last: CGPoint)?

    public init() {}

    /// `nextNumber` is used for a gesture that starts with this event.
    public mutating func fields(for type: CGEventType, at point: CGPoint, nextNumber: Int64) -> Fields {
        switch type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            gesture = (nextNumber, point)
            return Fields(number: nextNumber, dx: nil, dy: nil)
        case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
            guard let current = gesture else { return Fields(number: nil, dx: nil, dy: nil) }
            gesture = (current.number, point)
            return Fields(number: current.number, dx: Int64((point.x - current.last.x).rounded()), dy: Int64((point.y - current.last.y).rounded()))
        case .leftMouseUp, .rightMouseUp, .otherMouseUp:
            defer { gesture = nil }
            return Fields(number: gesture?.number, dx: nil, dy: nil)
        default:
            return Fields(number: nil, dx: nil, dy: nil)
        }
    }
}

public enum ScrollDirection: String, Sendable { case up, down, left, right }

public enum ScrollPlan {
    public struct AXPages: Equatable, Sendable {
        public let action: String
        public let times: Int
    }

    /// Pixels per wheel event; larger jumps are split so apps animate and load content on the way.
    public static let maxStep: Int32 = 120
    /// A page leaves a little of the previous one in view, like Page Down.
    static let pageFraction = 0.9

    /// Whole pages through the element's own scroll action (Codex scrolls this way), when it has one.
    public static func ax(_ direction: ScrollDirection, pages: Double, actions: [String]) -> AXPages? {
        let action = "AXScroll\(direction.rawValue.capitalized)ByPage"
        guard pages == pages.rounded(), pages >= 1, actions.contains(action) else { return nil }
        return AXPages(action: action, times: Int(pages))
    }

    /// The scroll bar value after moving `pages` (bars run from 0 at the top or left to 1); `nil` when
    /// nothing can scroll. Setting it works in the background, unlike the wheel.
    public static func barValue(from current: Double, _ direction: ScrollDirection, pages: Double, visible: Double, content: Double) -> Double? {
        let range = content - visible
        guard range > 0, visible > 0 else { return nil }
        let sign: Double = direction == .up || direction == .left ? -1 : 1
        let moved = min(1, max(0, current + sign * pages * visible * pageFraction / range))
        return (moved * 1_000_000).rounded() / 1_000_000
    }

    /// Wheel deltas in pixels; negative moves the content to show what lies below or to the right.
    public static func wheel(_ direction: ScrollDirection, pages: Double, viewport: CGSize) -> [(dy: Int32, dx: Int32)] {
        let vertical = direction == .up || direction == .down
        let extent = vertical ? viewport.height : viewport.width
        let sign: Double = direction == .up || direction == .left ? 1 : -1
        var remaining = Int32((extent * pageFraction * pages).rounded())
        var steps: [(dy: Int32, dx: Int32)] = []
        while remaining > 0 {
            let amount = Int32(sign) * min(remaining, maxStep)
            steps.append(vertical ? (amount, 0) : (0, amount))
            remaining -= min(remaining, maxStep)
        }
        return steps
    }
}

public enum ActivationGate {
    /// Bringing an app forward while the user types would send their keys into it.
    static let typingPause: TimeInterval = 1.0

    public static func userIsTyping(secondsSinceKeyDown: TimeInterval) -> Bool { secondsSinceKeyDown < typingPause }
}
