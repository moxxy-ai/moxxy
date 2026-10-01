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
        withoutAnimation {
            outlineLayer.path = rect.map {
                CGPath(roundedRect: OverlayGeometry.viewRect($0, window: window, margin: Self.margin).insetBy(dx: -3, dy: -3),
                       cornerWidth: 4, cornerHeight: 4, transform: nil)
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
        let panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
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
        outlineLayer.fillColor = nil
        outlineLayer.strokeColor = Self.tint
        outlineLayer.lineWidth = 2
        ring.path = CGPath(ellipseIn: CGRect(x: -14, y: -14, width: 28, height: 28), transform: nil)
        ring.fillColor = nil
        ring.strokeColor = Self.tint
        ring.lineWidth = 2
        ring.opacity = 0
        pointer.path = Self.arrow
        pointer.fillColor = Self.tint
        pointer.strokeColor = CGColor(gray: 1, alpha: 1)
        pointer.lineWidth = 1.5
        pointer.lineJoin = .round
        pointer.shadowOpacity = 0.35
        pointer.shadowRadius = 2
        pointer.shadowOffset = CGSize(width: 0, height: -1)
        pointer.opacity = 0
        for layer in [outlineLayer, ring, pointer] { root.addSublayer(layer) }
        return panel
    }

    /// An arrow with its tip, the hot spot, at the layer's origin (AppKit's y grows upwards).
    private static let arrow: CGPath = {
        let path = CGMutablePath()
        path.addLines(between: [
            CGPoint(x: 0, y: 0), CGPoint(x: 0, y: -18), CGPoint(x: 4.5, y: -14), CGPoint(x: 8, y: -21),
            CGPoint(x: 11, y: -19.6), CGPoint(x: 7.6, y: -12.6), CGPoint(x: 13.4, y: -12.6),
        ])
        path.closeSubpath()
        return path
    }()

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
