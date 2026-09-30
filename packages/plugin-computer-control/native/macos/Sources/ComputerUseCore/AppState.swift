import AppKit
import ApplicationServices

/// What the helper remembers about one app between requests: its index registry and the live
/// elements behind the last indices it handed out (used by the action executor).
final class TargetState {
    var registry = IndexRegistry()
    var elements: [Int: AXUIElement] = [:]
}

/// Per-app state for this helper's lifetime. Touched only from the serial request queue.
public final class Targets: @unchecked Sendable {
    private var states: [String: TargetState] = [:]

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

    static func appState(_ params: JSONValue, targets: Targets) throws -> JSONValue {
        guard let bundleId = params["app"]?.stringValue, !bundleId.isEmpty else { throw HelperError.invalidParams("app is required") }
        guard AXIsProcessTrusted() else {
            throw HelperError(code: "permissions_not_granted", message: "Accessibility is not allowed for this app")
        }
        var running = try AppLauncher.running(bundleId)
        var found = AppLauncher.window(of: running)
        if case .exited = found {
            // It was quitting when we found it; start it again once.
            running = try AppLauncher.running(bundleId)
            found = AppLauncher.window(of: running)
        }
        let name = running.localizedName ?? bundleId
        let state = targets.state(for: bundleId)
        guard case let .window(window) = found else {
            state.elements = [:]
            return .object([
                "tree": .object(["app": .string(name), "elements": .array([])]),
                "screenshotUnavailable": .string("\(name) has no open window"),
            ])
        }
        let reader = AXReader()
        let root = reader.snapshot(window)
        let built = TreeBuilder.build(root, limit: treeLimit)
        let indices = state.registry.assign(built.elements.map(\.key))
        state.elements = Dictionary(uniqueKeysWithValues: zip(indices, built.elements.map { reader.elements[$0.handle] }))
        var tree: [String: JSONValue] = [
            "app": .string(name),
            "elements": .array(zip(indices, built.elements).map { json($1, index: $0) }),
        ]
        if let title = root.title { tree["window"] = .string(title) }
        if built.truncated { tree["truncated"] = .bool(true) }
        var result: [String: JSONValue] = ["tree": .object(tree)]
        if params["screenshot"]?.boolValue == true { result["screenshotUnavailable"] = .string("Window capture is not available yet") }
        return .object(result)
    }

    static func json(_ element: TreeElement, index: Int) -> JSONValue {
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
        return .object(fields)
    }
}
