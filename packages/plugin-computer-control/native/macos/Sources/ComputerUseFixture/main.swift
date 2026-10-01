import AppKit

// A deterministic window for integration tests: known controls, one secure field, nested plain groups
// that the tree must flatten, a button whose effect is visible in the tree, one that does nothing, one
// that moves the layout, and two canvases without accessibility (a pad and a timeline with clips).

@MainActor
final class Controller: NSObject {
    let status = NSTextField(labelWithString: "Ready")
    private var presses = 0

    @objc func press() {
        presses += 1
        status.stringValue = "Pressed \(presses)"
    }

    /// Deliberately does nothing: an agent must notice that and stop repeating it.
    @objc func dud() {}

    private var stubbornClicks = 0
    @objc func stubborn() {
        stubbornClicks += 1
        status.stringValue = "Stubborn \(stubbornClicks)"
    }

    weak var window: NSWindow?
    @objc func showWindow() { window?.makeKeyAndOrderFront(nil) }
    @objc func hideWindow() { window?.orderOut(nil) }

    /// Pushes everything below it down, like a banner that appears in a real app.
    var spacer: NSView?
    @objc func shift() { spacer?.isHidden.toggle() }

    /// A real save dialog, as a sheet, so the helper's save-dialog protection meets the system panel.
    @objc func save(_ sender: NSButton) {
        guard let window = sender.window else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "Untitled.txt"
        panel.beginSheetModal(for: window) { [status] response in
            MainActor.assumeIsolated { status.stringValue = response == .OK ? "Saved" : "Not saved" }
        }
    }
}

/// Accepts an accessibility press and does nothing, as buttons of some toolkits (Qt) do; only a real click works.
final class StubbornButton: NSButton {
    override func accessibilityPerformPress() -> Bool { true }
}

/// Reports how long the last key was held, from the events' own timestamps.
@MainActor
final class KeyLog {
    let label = NSTextField(labelWithString: "No keys")
    private var downAt: [UInt16: TimeInterval] = [:]

    func record(_ event: NSEvent) {
        let down = switch event.type {
        case .keyDown: true
        case .keyUp: false
        // A modifier reports one event per change: down when nothing was recorded for it yet.
        default: downAt[event.keyCode] == nil
        }
        if down {
            if downAt[event.keyCode] == nil { downAt[event.keyCode] = event.timestamp }
        } else if let start = downAt.removeValue(forKey: event.keyCode) {
            label.stringValue = String(format: "Held key %d for %.1f s", event.keyCode, event.timestamp - start)
        }
    }
}

/// A canvas without accessibility actions, like a video timeline: only real mouse input reaches it.
/// Its description reports what arrived, so tests can read it from the tree.
@MainActor
final class Pad: NSView {
    private var log = "idle"

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Pad idle")
    }

    required init?(coder: NSCoder) { nil }

    override var intrinsicContentSize: NSSize { NSSize(width: 160, height: 60) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemTeal.setFill()
        bounds.fill()
    }

    private func report(_ text: String) {
        log = text
        setAccessibilityLabel("Pad \(log)")
    }

    private func held(_ event: NSEvent) -> String { event.modifierFlags.contains(.shift) ? " shift" : "" }
    private var drags = 0

    override func mouseDown(with event: NSEvent) { drags = 0; report("down \(event.clickCount)\(held(event))") }
    override func mouseDragged(with event: NSEvent) { drags += 1; report("dragging \(drags)") }
    override func mouseUp(with event: NSEvent) { report("up \(event.clickCount) after \(drags) moves\(held(event))") }
    override func rightMouseDown(with event: NSEvent) { report("right down") }

    private var wheel = 0.0
    override func scrollWheel(with event: NSEvent) { wheel += event.scrollingDeltaY; report("wheel \(Int(wheel))") }
}

/// A video-editor track without accessibility: clips are only pixels. Dragging a clip's body moves it,
/// dragging its right edge trims it, a click selects it; positions snap to 10 points. The description
/// reports the result so tests can read it, but offers no action.
@MainActor
final class Timeline: NSView {
    private struct Clip { let name: String; var start: CGFloat; var length: CGFloat; let color: NSColor }
    private enum Grab { case move(Int, CGFloat), trim(Int) }
    private var clips = [Clip(name: "A", start: 20, length: 80, color: .systemOrange), Clip(name: "B", start: 140, length: 60, color: .systemPurple)]
    private var selected: Int?
    private var grab: Grab?

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        report()
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { NSSize(width: 420, height: 44) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.darkGray.setFill()
        bounds.fill()
        for (index, clip) in clips.enumerated() {
            clip.color.setFill()
            let box = NSRect(x: clip.start, y: 6, width: clip.length, height: bounds.height - 12)
            box.fill()
            guard index == selected else { continue }
            NSColor.white.setStroke()
            NSBezierPath(rect: box.insetBy(dx: 1, dy: 1)).stroke()
        }
    }

    private func report() {
        let list = clips.map { "\($0.name) \(Int($0.start))+\(Int($0.length))" }.joined(separator: " ")
        setAccessibilityLabel("Timeline \(list) selected \(selected.map { clips[$0].name } ?? "none")")
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        let x = convert(event.locationInWindow, from: nil).x
        grab = nil
        selected = clips.lastIndex { x >= $0.start && x <= $0.start + $0.length }
        if let selected {
            let clip = clips[selected]
            grab = clip.start + clip.length - x <= 8 ? .trim(selected) : .move(selected, x - clip.start)
        }
        report()
    }

    override func mouseDragged(with event: NSEvent) {
        let x = convert(event.locationInWindow, from: nil).x
        switch grab {
        case let .move(index, offset): clips[index].start = min(max(0, x - offset), bounds.width - clips[index].length)
        case let .trim(index): clips[index].length = min(max(10, x - clips[index].start), bounds.width - clips[index].start)
        case nil: return
        }
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        let snap = { (value: CGFloat) in (value / 10).rounded() * 10 }
        for index in clips.indices {
            clips[index].start = snap(clips[index].start)
            clips[index].length = max(10, snap(clips[index].length))
        }
        grab = nil
        report()
    }
}

/// Tall striped content, top first, for the scroll area.
final class Page: NSView {
    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        for row in 0..<Int(bounds.height / 20) {
            (row.isMultiple(of: 2) ? NSColor.white : NSColor.lightGray).setFill()
            NSRect(x: 0, y: CGFloat(row) * 20, width: bounds.width, height: 20).fill()
        }
    }
}

@MainActor
func control<T: NSView>(_ view: T, _ identifier: String) -> T {
    view.identifier = NSUserInterfaceItemIdentifier(identifier)
    return view
}

@MainActor
func makeWindow(_ controller: Controller, keys: KeyLog) -> NSWindow {
    let name = control(NSTextField(string: "hello"), "name")
    name.placeholderString = "Name"
    let secret = control(NSSecureTextField(string: "hunter2"), "secret")
    let press = control(NSButton(title: "Press", target: controller, action: #selector(Controller.press)), "press")
    let remember = control(NSButton(checkboxWithTitle: "Remember", target: nil, action: nil), "remember")
    remember.state = .on
    let size = control(NSPopUpButton(frame: .zero, pullsDown: false), "size")
    size.addItems(withTitles: ["Small", "Large"])
    let disabled = control(NSButton(title: "Disabled", target: nil, action: nil), "disabled")
    let save = control(NSButton(title: "Save…", target: controller, action: #selector(Controller.save(_:))), "save")
    disabled.isEnabled = false
    // Increment and decrement are secondary accessibility actions.
    let count = control(NSStepper(), "count")
    count.maxValue = 1000

    // Plain containers without titles or actions: the tree must not list them.
    let inner = NSStackView(views: [press, remember, size, disabled, count, save])
    inner.orientation = .horizontal
    // Content that finishes loading after launch, behind a spinner: settling must wait for it.
    let spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.isIndeterminate = true
    spinner.startAnimation(nil)
    let loading = NSStackView(views: [spinner])
    // A long page that only scrolls: its offset is reported in a label.
    let page = Page(frame: NSRect(x: 0, y: 0, width: 200, height: 3000))
    let scroller = control(NSScrollView(), "list")
    scroller.documentView = page
    scroller.hasVerticalScroller = true
    scroller.translatesAutoresizingMaskIntoConstraints = false
    scroller.widthAnchor.constraint(equalToConstant: 200).isActive = true
    scroller.heightAnchor.constraint(equalToConstant: 80).isActive = true
    let offset = control(NSTextField(labelWithString: "Offset 0"), "offset")
    scroller.contentView.postsBoundsChangedNotifications = true
    NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: scroller.contentView, queue: .main) { _ in
        MainActor.assumeIsolated { offset.stringValue = "Offset \(Int(scroller.contentView.bounds.origin.y))" }
    }
    let pad = control(Pad(), "pad")
    let lower = NSStackView(views: [pad, scroller, offset])
    lower.orientation = .horizontal
    let labels = NSStackView(views: [control(controller.status, "status"), control(keys.label, "keys")])
    labels.orientation = .horizontal
    let dud = control(NSButton(title: "Dud", target: controller, action: #selector(Controller.dud)), "dud")
    let shift = control(NSButton(title: "Shift", target: controller, action: #selector(Controller.shift)), "shift")
    let stubborn = control(StubbornButton(title: "Stubborn", target: controller, action: #selector(Controller.stubborn)), "stubborn")
    let extras = NSStackView(views: [dud, shift, stubborn])
    extras.orientation = .horizontal
    // Hidden until "Shift" is pressed; then it takes room at the top and moves every control down.
    let spacer = NSView()
    spacer.translatesAutoresizingMaskIntoConstraints = false
    spacer.heightAnchor.constraint(equalToConstant: 30).isActive = true
    spacer.widthAnchor.constraint(equalToConstant: 10).isActive = true
    spacer.isHidden = true
    controller.spacer = spacer
    let timeline = control(Timeline(), "timeline")
    let outer = NSStackView(views: [spacer, name, secret, inner, extras, labels, lower, timeline, loading])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
        spinner.stopAnimation(nil)
        loading.removeView(spinner)
        loading.addView(control(NSTextField(labelWithString: "Loaded"), "loaded"), in: .leading)
    }
    outer.orientation = .vertical
    outer.alignment = .leading
    outer.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)

    let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 520, height: 320), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "Moxxy Fixture"
    window.contentView = outer
    return window
}

/// Like every real app: Command shortcuts such as Select All and Paste live in the Edit menu; Command-J
/// presses the button again from the app's own menu.
@MainActor
func makeMenu(_ controller: Controller) -> NSMenu {
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    let own = NSMenu(title: "Moxxy Fixture")
    own.addItem(withTitle: "Press Again", action: #selector(Controller.press), keyEquivalent: "j").target = controller
    // Like a document app with nothing open: the window goes away and the app stays, until New Window.
    own.addItem(withTitle: "New Window", action: #selector(Controller.showWindow), keyEquivalent: "n").target = controller
    own.addItem(withTitle: "Close Window", action: #selector(Controller.hideWindow), keyEquivalent: "w").target = controller
    let menu = NSMenu()
    let ownItem = NSMenuItem(title: "Moxxy Fixture", action: nil, keyEquivalent: "")
    ownItem.submenu = own
    menu.addItem(ownItem)
    let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
    editItem.submenu = edit
    menu.addItem(editItem)
    return menu
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let controller = Controller()
application.mainMenu = makeMenu(controller)
let keys = KeyLog()
NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { event in
    MainActor.assumeIsolated { keys.record(event) }
    return event
}
let window = makeWindow(controller, keys: keys)
controller.window = window
// Shown without activating: the helper must work while another app stays in front.
window.orderFront(nil)
application.run()
