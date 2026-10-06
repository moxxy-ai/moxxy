import AppKit
import QuartzCore

/// The agent's own pointer, drawn in a click-through panel ordered just above the target window
/// (Codex: `move(to:aboveWindowID:…)`). Windows in front of the target cover it like they cover the
/// target; the user's real pointer never moves for it.
@MainActor
public final class CursorOverlay {
    /// Room around the window so the pointer is not cut at the window's right and bottom edges.
    static let margin: CGFloat = 24
    /// Moxxy's primary colour (`color.primary` in `@moxxy/design-tokens`).
    static let tint = CGColor(red: 0xD6 / 255, green: 0x2A / 255, blue: 0, alpha: 1)

    private(set) var panel: NSPanel?
    let pointer = CAShapeLayer()
    let ring = CAShapeLayer()
    let outlineLayer = CAShapeLayer()
    private var window: CGRect = .zero

    public init() {}

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// Shows the pointer over `frame` (a screen rect) at `fraction` of it.
    public func show(above windowID: CGWindowID, frame: CGRect, at fraction: CGPoint) {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        let appearing = !panel.isVisible
        window = frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? frame.maxY
        panel.setFrame(OverlayGeometry.panelRect(window: frame, primaryHeight: primaryHeight, margin: Self.margin), display: false)
        withoutAnimation { pointer.position = point(fraction) }
        panel.order(.above, relativeTo: Int(windowID))
        if appearing { fade(pointer, to: 1) }
    }

    /// Glides to a place in the window; returns how long the glide takes so an action can wait for it.
    @discardableResult
    public func move(to fraction: CGPoint, animated: Bool = true) -> Double {
        let start = pointer.position
        let end = point(fraction)
        let distance = hypot(end.x - start.x, end.y - start.y)
        let duration = animated ? CursorMotion.duration(distance: distance, reduceMotion: reduceMotion) : 0
        withoutAnimation { pointer.position = end }
        guard duration > 0 else { return 0 }
        let path = CursorMotion.path(from: start, to: end)
        let curve = CGMutablePath()
        curve.move(to: path.start)
        curve.addQuadCurve(to: path.end, control: path.control)
        let glide = CAKeyframeAnimation(keyPath: "position")
        glide.path = curve
        glide.duration = duration
        glide.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        pointer.add(glide, forKey: "glide")
        return duration
    }

    /// Counts outlines, so a finish scheduled for one action does not clear the outline of the next.
    private var outlined = 0

    /// Once the glide has arrived: the ring for a delivered action, and the outline cleared.
    public func finish(delivered: Bool, after delay: Double) {
        let generation = outlined
        guard delay > 0 else {
            if delivered { press() }
            outline(nil)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            MainActor.assumeIsolated {
                if delivered { self.press() }
                if self.outlined == generation { self.outline(nil) }
            }
        }
    }

    /// A ring at the pointer's tip: the moment an action is delivered.
    public func press() {
        withoutAnimation {
            ring.position = pointer.position
            ring.opacity = 0
        }
        let fadeOut = CABasicAnimation(keyPath: "opacity")
        fadeOut.fromValue = 0.9
        fadeOut.toValue = 0
        let group = CAAnimationGroup()
        group.duration = 0.35
        if reduceMotion {
            group.animations = [fadeOut]
        } else {
            let grow = CABasicAnimation(keyPath: "transform.scale")
            grow.fromValue = 0.4
            grow.toValue = 1.4
            group.animations = [fadeOut, grow]
        }
        ring.add(group, forKey: "press")
    }

    /// Frames the element about to be acted on (a screen rect); `nil` clears it.
    public func outline(_ rect: CGRect?) {
        if rect != nil { outlined += 1 }
        withoutAnimation {
            outlineLayer.path = rect.map {
                CGPath(roundedRect: OverlayGeometry.viewRect($0, window: window, margin: Self.margin).insetBy(dx: -3, dy: -3),
                       cornerWidth: 7, cornerHeight: 7, transform: nil)
            }
        }
    }

    public func dim(_ paused: Bool) { panel?.alphaValue = paused ? 0.35 : 1 }

    public func hide() {
        outline(nil)
        panel?.orderOut(nil)
        pointer.opacity = 0
    }

    private func point(_ fraction: CGPoint) -> CGPoint {
        OverlayGeometry.viewPoint(fraction, windowSize: window.size, margin: Self.margin)
    }

    private func makePanel() -> NSPanel {
        let panel = OverlayPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        // Kept out of screen sharing; captures of the target window never include it anyway.
        panel.sharingType = .none
        // The helper is never the active app, so a panel that hides on deactivation would never show.
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.transient, .ignoresCycle, .fullScreenAuxiliary]
        let view = NSView()
        view.wantsLayer = true
        panel.contentView = view
        guard let root = view.layer else { return panel }
        outlineLayer.fillColor = Self.tint.copy(alpha: 0.08)
        outlineLayer.strokeColor = Self.tint.copy(alpha: 0.9)
        outlineLayer.lineWidth = 1.5
        ring.path = CGPath(ellipseIn: CGRect(x: -15, y: -15, width: 30, height: 30), transform: nil)
        ring.fillColor = Self.tint.copy(alpha: 0.16)
        ring.strokeColor = Self.tint
        ring.lineWidth = 1.5
        ring.opacity = 0
        pointer.path = Self.arrow
        pointer.fillColor = Self.tint
        pointer.strokeColor = CGColor(gray: 1, alpha: 1)
        pointer.lineWidth = 1.4
        pointer.lineJoin = .round
        // A wide, soft shadow lifts the pointer off any page without an outline that reads as a border.
        pointer.shadowColor = CGColor(gray: 0, alpha: 1)
        pointer.shadowOpacity = 0.28
        pointer.shadowRadius = 5
        pointer.shadowOffset = CGSize(width: 0, height: -2.5)
        pointer.opacity = 0
        for layer in [outlineLayer, ring, pointer] { root.addSublayer(layer) }
        return panel
    }

    /// A soft-cornered arrowhead with its tip, the hot spot, at the layer's origin (AppKit's y grows upwards).
    static let arrow: CGPath = roundedPolygon([
        CGPoint(x: 0, y: 0), CGPoint(x: 0.6, y: -19), CGPoint(x: 5.6, y: -14.2), CGPoint(x: 13.8, y: -13.6),
    ], radius: 1.8)

    /// A closed polygon whose corners are arcs; it starts in the middle of an edge so every corner is rounded.
    static func roundedPolygon(_ points: [CGPoint], radius: CGFloat) -> CGPath {
        let path = CGMutablePath()
        guard let first = points.first, let last = points.last else { return path }
        let middle = { (a: CGPoint, b: CGPoint) in CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2) }
        path.move(to: middle(last, first))
        for (index, corner) in points.enumerated() {
            path.addArc(tangent1End: corner, tangent2End: middle(corner, points[(index + 1) % points.count]), radius: radius)
        }
        path.closeSubpath()
        return path
    }

    private func fade(_ layer: CALayer, to opacity: Float) {
        let from = layer.opacity
        withoutAnimation { layer.opacity = opacity }
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = from
        animation.toValue = opacity
        animation.duration = reduceMotion ? 0.1 : 0.2
        layer.add(animation, forKey: "fade")
    }

    private func withoutAnimation(_ change: () -> Void) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        change()
        CATransaction.commit()
    }
}

/// AppKit keeps a window's top under the menu bar. The overlay's margin has to reach above a maximised
/// window, or the whole panel slides down and the pointer is drawn below its target.
final class OverlayPanel: NSPanel {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
