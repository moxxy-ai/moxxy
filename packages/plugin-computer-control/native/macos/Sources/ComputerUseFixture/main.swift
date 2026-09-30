import AppKit

// A deterministic window for integration tests: known controls, one secure field, nested plain groups
// that the tree must flatten, and a button whose effect is visible in the tree.

@MainActor
final class Controller: NSObject {
    let status = NSTextField(labelWithString: "Ready")
    private var presses = 0

    @objc func press() {
        presses += 1
        status.stringValue = "Pressed \(presses)"
    }
}

@MainActor
func control<T: NSView>(_ view: T, _ identifier: String) -> T {
    view.identifier = NSUserInterfaceItemIdentifier(identifier)
    return view
}

@MainActor
func makeWindow(_ controller: Controller) -> NSWindow {
    let name = control(NSTextField(string: "hello"), "name")
    name.placeholderString = "Name"
    let secret = control(NSSecureTextField(string: "hunter2"), "secret")
    let press = control(NSButton(title: "Press", target: controller, action: #selector(Controller.press)), "press")
    let remember = control(NSButton(checkboxWithTitle: "Remember", target: nil, action: nil), "remember")
    remember.state = .on
    let size = control(NSPopUpButton(frame: .zero, pullsDown: false), "size")
    size.addItems(withTitles: ["Small", "Large"])
    let disabled = control(NSButton(title: "Disabled", target: nil, action: nil), "disabled")
    disabled.isEnabled = false
    // Increment and decrement are secondary accessibility actions.
    let count = control(NSStepper(), "count")
    count.maxValue = 1000

    // Plain containers without titles or actions: the tree must not list them.
    let inner = NSStackView(views: [press, remember, size, disabled, count])
    inner.orientation = .horizontal
    // Content that finishes loading after launch, behind a spinner: settling must wait for it.
    let spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.isIndeterminate = true
    spinner.startAnimation(nil)
    let loading = NSStackView(views: [spinner])
    let outer = NSStackView(views: [name, secret, inner, control(controller.status, "status"), loading])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
        spinner.stopAnimation(nil)
        loading.removeView(spinner)
        loading.addView(control(NSTextField(labelWithString: "Loaded"), "loaded"), in: .leading)
    }
    outer.orientation = .vertical
    outer.alignment = .leading
    outer.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)

    let window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 460, height: 220), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.title = "Moxxy Fixture"
    window.contentView = outer
    return window
}

/// Like every real app: Command shortcuts such as Select All and Paste live in the Edit menu.
@MainActor
func makeMenu() -> NSMenu {
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    let menu = NSMenu()
    menu.addItem(NSMenuItem(title: "Moxxy Fixture", action: nil, keyEquivalent: ""))
    let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
    editItem.submenu = edit
    menu.addItem(editItem)
    return menu
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
application.mainMenu = makeMenu()
let controller = Controller()
let window = makeWindow(controller)
// Shown without activating: the helper must work while another app stays in front.
window.orderFront(nil)
application.run()
