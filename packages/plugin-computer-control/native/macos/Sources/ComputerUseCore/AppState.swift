import AppKit
import ApplicationServices

/// What the helper remembers about one app between requests: its index registry and the live
/// elements behind the last indices it handed out (used by the action executor).
final class TargetState {
    var registry = IndexRegistry()
    var elements: [Int: AXUIElement] = [:]
    /// Screen frames of those elements when they were observed.
    var frames: [Int: CGRect] = [:]
    /// Maps the last screenshot's pixels to the screen; `nil` until a screenshot was taken.
    var frame: CoordinateFrame?
    /// The last screenshot's pixels, compared around a point before acting on it.
    var pixels: PixelBuffer?
    /// The observed window, for the cursor overlay; `nil` until an observation found one.
    var window: WindowCandidate?
    /// The observed app's process; keys still reach an app that has no window open.
    var pid: pid_t?
    /// The observed window's accessibility element, for settling between the steps of a batch.
    var root: AXUIElement?
    /// Actions need indices from an observation made by this helper.
    var observed = false
    /// Set by the action executor; the next observation settles as after an action.
    var lastAction: Date?
    /// The last gesture that went to the app softly (background input, or an accessibility press that changed nothing); asked again, it goes through the screen.
    var lastSoft: String?
    /// When the last action's input went out, where the executor knows it.
    var sent: Date?
    /// What the elements said at the last observation, until an action is done; see `Executor.look`.
    var said: [String]?
    /// What each index read as, to find its element again when the app replaced it.
    var signs: [Int: (sign: ElementSign, nth: Int)] = [:]
    /// The last element found again, followed by what contains it, nearest first.
    var revived: [AXUIElement] = []
    /// When the window was last read and pictured.
    var observedAt: Date?
    /// The last action's effect was seen in the window before it returned.
    var reacted = false
    /// Listens to the app since before the action being done; see `Methods.act`.
    var heard: Settler?
    /// Where the last pointer gesture in the window went, on screen; see `KeyAim`.
    var lastClick: CGPoint?
    /// Accessibility actions its elements keep declining.
    let declines = DeclineMemory()
    var recentlyActed: Bool { lastAction.map { Date().timeIntervalSince($0) < SettlePolicy.afterAction.maximum } ?? false }
}

/// Per-app state for this helper's lifetime. Touched only from the serial request queue.
public final class Targets: @unchecked Sendable {
    private var states: [String: TargetState] = [:]
    /// The latest full-screen screenshot, which `zoom` without an app refers to.
    var screen: ScreenShot?
    /// Told about every observed window, so the human's preview shows what the model works in.
    var preview: PreviewStream?

    /// Keeps the apps worked in awake for accessibility until the helper leaves.
    public let wake: AccessibilityWake

    public init(wake: AccessibilityWake = .system) { self.wake = wake }

    func state(for app: String) -> TargetState {
        if let state = states[app] { return state }
        let state = TargetState()
        states[app] = state
        return state
    }
}

enum AppLauncher {
    static let launchTimeout: TimeInterval = 10
    static let windowTimeout: TimeInterval = 5

    /// The running app for a bundle identifier, launched in the background (never activated) when needed.
    static func running(_ bundleId: String) throws -> NSRunningApplication {
        if let app = runningApp(bundleId) { return app }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            throw HelperError(code: "app_not_found", message: "No application with identifier \(bundleId)")
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        let opened = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, _ in opened.signal() }
        _ = opened.wait(timeout: .now() + launchTimeout)
        let deadline = Date().addingTimeInterval(launchTimeout)
        while Date() < deadline {
            if let app = runningApp(bundleId), app.isFinishedLaunching { return app }
            Thread.sleep(forTimeInterval: 0.05)
        }
        throw HelperError(code: "timeout", message: "\(bundleId) did not finish launching")
    }

    static func runningApp(_ bundleId: String) -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first { !$0.isTerminated }
    }

    enum WindowWait { case window(AXUIElement), none, exited }

    /// A freshly launched app may need a moment to open its first window; an app that is quitting never will.
    static func window(of app: NSRunningApplication) -> WindowWait {
        let element = AXReader.application(app.processIdentifier)
        let deadline = Date().addingTimeInterval(windowTimeout)
        repeat {
            if let window = AXReader.targetWindow(of: element) { return .window(window) }
            if kill(app.processIdentifier, 0) != 0 && errno == ESRCH { return .exited }
            Thread.sleep(forTimeInterval: 0.05)
        } while Date() < deadline
        return .none
    }
}

extension Methods {
    static let treeLimit = 1000

    static func appState(_ params: JSONValue, targets: Targets, cursor: AgentCursor?) throws -> JSONValue {
        guard let bundleId = params["app"]?.stringValue, !bundleId.isEmpty else { throw HelperError.invalidParams("app is required") }
        Timing.mark("state: begin")
        guard AXIsProcessTrusted() else {
            throw HelperError(code: "permissions_not_granted", message: "Accessibility is not allowed for this app")
        }
        var launched = AppLauncher.runningApp(bundleId) == nil
        var running = try AppLauncher.running(bundleId)
        var found = AppLauncher.window(of: running)
        if case .exited = found {
            // It was quitting when we found it; start it again once.
            launched = true
            running = try AppLauncher.running(bundleId)
            found = AppLauncher.window(of: running)
        }
        let name = running.localizedName ?? bundleId
        Timing.mark("state: app found")
        let wantsPage = params["web"]?.boolValue == true
        let woken = targets.wake.wake(running.processIdentifier) && LateTree.fills(bundle: running.bundleURL, browser: wantsPage)
        let state = targets.state(for: bundleId)
        state.observed = true
        state.pid = running.processIdentifier
        guard case let .window(window) = found else {
            state.elements = [:]
            state.window = nil
            state.root = nil
            return .object([
                "tree": .object(["app": .string(name), "elements": .array([])]),
                "screenshotUnavailable": .string("\(name) has no open window; press_key still reaches it, e.g. super+n for a new one"),
            ])
        }
        // A fresh launch is still loading, like the app right after an action.
        Timing.mark("state: window found")
        let acted = state.recentlyActed
        var reader = AXReader()
        // An app asked for its tree before (by anyone) already has the page in it and needs no time to build it.
        if woken, !launched, !WebContent.isLoaded(reader.snapshot(window)) { launched = true }
        // The read that finds the window quiet and not busy is the state: no second read after the wait.
        var settled: NodeSnapshot?
        Settler.settle(pid: running.processIdentifier, policy: launched || acted ? .afterAction : .observeOnly,
                       waited: acted ? state.lastAction.map { Date().timeIntervalSince($0) } ?? 0 : 0, reacted: acted && state.reacted,
                       heard: state.heard) {
            reader = AXReader()
            let read = reader.snapshot(window)
            settled = read
            return AXReader.attribute(window, "AXElementBusy") == true || BusyProbe.isBusy(read)
        }
        var root = settled ?? reader.snapshot(window)
        Timing.mark("state: settled and read")
        if wantsPage {
            let pid = running.processIdentifier
            root = WebContent.awaited(first: root, loaded: { !WebContent.isPending($0) }, again: {
                reader = AXReader()
                return reader.snapshot(window)
            }, pause: { Thread.sleep(forTimeInterval: WebContent.wait.pause) }, bringForward: {
                _ = Foreground.bring(pid: pid, window: root.frame.map { WindowCandidate(pid: pid, frame: $0, title: root.title) })
            })
        }
        Timing.mark("state: page awaited")
        let pagePending = WebContent.isPending(root)
        root = root.adopting(reader.strayFocus(of: AXReader.application(running.processIdentifier), besides: window))
        let built = TreeBuilder.build(root, limit: treeLimit)
        let indices = state.registry.assign(built.elements.map(\.key))
        state.elements = Dictionary(uniqueKeysWithValues: zip(indices, built.elements.map { reader.elements[$0.handle] }))
        state.signs = Dictionary(uniqueKeysWithValues: zip(indices, Revive.signs(built.elements)))
        state.frames = Dictionary(uniqueKeysWithValues: zip(indices, built.elements.map(\.frame)).compactMap { index, frame in frame.map { (index, $0) } })
        state.window = root.frame.map { WindowCandidate(pid: running.processIdentifier, frame: $0, title: root.title) }
        state.root = window
        if let window = state.window { cursor?.attach(to: window) }
        targets.preview?.target(state.window)
        state.said = Executor.said(built.elements)
        state.observedAt = Date()
        Timing.mark("state: tree built")
        var result: [String: JSONValue] = [:]
        state.frame = nil
        state.pixels = nil
        if params["screenshot"]?.boolValue == true {
            switch visibleCapture(pid: running.processIdentifier, root: root, window: state.window) {
            case let .success(image):
                state.frame = image.frame
                state.pixels = image.pixels
                result["screenshot"] = .object([
                    "mediaType": .string("image/jpeg"), "base64": .string(image.jpeg.base64EncodedString()),
                    "width": .number(Double(image.frame.imageWidth)), "height": .number(Double(image.frame.imageHeight)),
                ])
            case let .failure(reason):
                result["screenshotUnavailable"] = .string(reason.message.fitting(500))
            }
        }
        var tree: [String: JSONValue] = [
            "app": .string(name),
            "elements": .array(zip(indices, built.elements).map { json($1, index: $0, frame: state.frame) }),
        ]
        if let title = root.title { tree["window"] = .string(title.fitting(1024)) }
        if built.truncated { tree["truncated"] = .bool(true) }
        result["tree"] = .object(tree)
        if wantsPage, pagePending { result["contentPending"] = .bool(true) }
        if FilePanel.identifiers.contains(root.identifier ?? "") { result["filePanel"] = .bool(true) }
        Timing.mark("state: captured")
        return .object(result)
    }

    /// A GPU-drawn window on another Space is captured as plain black, or not at all. The app then comes forward
    /// (never while the user types) and is captured again, because a black image is no observation.
    static func visibleCapture(pid: pid_t, root: NodeSnapshot, window: WindowCandidate?) -> Result<WindowImage, HelperError> {
        let first = capture(pid: pid, root: root)
        let unusable = switch first {
        case let .success(image): PixelPatch.isBlank(image.pixels)
        case let .failure(error): error.code != "permissions_not_granted"
        }
        guard unusable, let window, WindowDirectory.onScreenWindowID(for: window) == nil, case .broughtForward = Foreground.bring(window) else { return first }
        Thread.sleep(forTimeInterval: 0.6)
        return capture(pid: pid, root: root)
    }

    static func capture(pid: pid_t, root: NodeSnapshot) -> Result<WindowImage, HelperError> {
        guard CGPreflightScreenCaptureAccess() else {
            return .failure(HelperError(code: "permissions_not_granted", message: "Screen Recording is not allowed, so there is no window image"))
        }
        guard let frame = root.frame, frame.width >= 1, frame.height >= 1 else {
            return .failure(HelperError(code: "helper_failed", message: "The window has no size on screen"))
        }
        do {
            return .success(try WindowCapture.capture(WindowCandidate(pid: pid, frame: frame, title: root.title)))
        } catch let error as HelperError {
            return .failure(error)
        } catch {
            return .failure(HelperError(code: "helper_failed", message: "The window could not be captured"))
        }
    }

    static func json(_ element: TreeElement, index: Int, frame: CoordinateFrame?) -> JSONValue {
        var fields: [String: JSONValue] = [
            "key": .string(WireKey.of(element.key)), "index": .number(Double(index)),
            "depth": .number(Double(min(element.depth, 64))), "role": .string(element.role.fitting(128)),
        ]
        if let title = element.title { fields["title"] = .string(title.fitting(10_000)) }
        if let description = element.description { fields["description"] = .string(description.fitting(10_000)) }
        if let value = element.value { fields["value"] = .string(value.fitting(10_000)) }
        if element.secure { fields["secure"] = .bool(true) }
        if !element.states.isEmpty { fields["states"] = .array(element.states.map(JSONValue.string)) }
        if !element.actions.isEmpty { fields["actions"] = .array(element.actions.prefix(32).map { .string($0.fitting(64)) }) }
        if let screen = element.frame, let rect = frame?.imageRect(of: screen) {
            fields["frame"] = .object(["x": .number(rect.minX), "y": .number(rect.minY), "width": .number(rect.width), "height": .number(rect.height)])
        }
        return .object(fields)
    }
}
