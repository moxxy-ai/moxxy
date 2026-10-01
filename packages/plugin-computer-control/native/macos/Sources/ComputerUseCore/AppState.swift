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

    public init() {}

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
        Settler.settle(pid: running.processIdentifier, window: window, policy: launched || state.recentlyActed ? .afterAction : .observeOnly)
        let reader = AXReader()
        let root = reader.snapshot(window)
        let built = TreeBuilder.build(root, limit: treeLimit)
        let indices = state.registry.assign(built.elements.map(\.key))
        state.elements = Dictionary(uniqueKeysWithValues: zip(indices, built.elements.map { reader.elements[$0.handle] }))
        state.frames = Dictionary(uniqueKeysWithValues: zip(indices, built.elements.map(\.frame)).compactMap { index, frame in frame.map { (index, $0) } })
        state.window = root.frame.map { WindowCandidate(pid: running.processIdentifier, frame: $0, title: root.title) }
        state.root = window
        if let window = state.window { cursor?.attach(to: window) }
        targets.preview?.target(state.window)
        var result: [String: JSONValue] = [:]
        state.frame = nil
        state.pixels = nil
        if params["screenshot"]?.boolValue == true {
            switch capture(pid: running.processIdentifier, root: root) {
            case let .success(image):
                state.frame = image.frame
                state.pixels = image.pixels
                result["screenshot"] = .object([
                    "mediaType": .string("image/jpeg"), "base64": .string(image.jpeg.base64EncodedString()),
                    "width": .number(Double(image.frame.imageWidth)), "height": .number(Double(image.frame.imageHeight)),
                ])
            case let .failure(reason):
                result["screenshotUnavailable"] = .string(reason.message)
            }
        }
        var tree: [String: JSONValue] = [
            "app": .string(name),
            "elements": .array(zip(indices, built.elements).map { json($1, index: $0, frame: state.frame) }),
        ]
        if let title = root.title { tree["window"] = .string(title) }
        if built.truncated { tree["truncated"] = .bool(true) }
        result["tree"] = .object(tree)
        return .object(result)
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
            "key": .string(String(element.key.prefix(512))), "index": .number(Double(index)),
            "depth": .number(Double(min(element.depth, 64))), "role": .string(String(element.role.prefix(128))),
        ]
        if let title = element.title { fields["title"] = .string(String(title.prefix(10_000))) }
        if let description = element.description { fields["description"] = .string(String(description.prefix(10_000))) }
        if let value = element.value { fields["value"] = .string(String(value.prefix(10_000))) }
        if element.secure { fields["secure"] = .bool(true) }
        if !element.states.isEmpty { fields["states"] = .array(element.states.map(JSONValue.string)) }
        if !element.actions.isEmpty { fields["actions"] = .array(element.actions.prefix(32).map { .string(String($0.prefix(64))) }) }
        if let screen = element.frame, let rect = frame?.imageRect(of: screen) {
            fields["frame"] = .object(["x": .number(rect.minX), "y": .number(rect.minY), "width": .number(rect.width), "height": .number(rect.height)])
        }
        return .object(fields)
    }
}
