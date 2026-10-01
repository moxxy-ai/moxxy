import AppKit
import ApplicationServices
import CoreGraphics

/// The TCC permissions Computer Use needs, read from the system for the process macOS holds responsible
/// (Moxxy.app for the desktop, the terminal for the CLI).
public struct SystemPermissions: Sendable {
    public enum Kind: String, Sendable { case accessibility, screenRecording = "screen_recording" }

    public init() {}

    public func granted(_ kind: Kind) -> Bool {
        switch kind {
        case .accessibility: AXIsProcessTrusted()
        case .screenRecording: CGPreflightScreenCaptureAccess()
        }
    }

    /// Shows the system prompt where one exists and opens the matching System Settings pane.
    public func request(_ kind: Kind) -> Bool {
        switch kind {
        case .accessibility:
            // The value of kAXTrustedCheckOptionPrompt; the global itself is not concurrency-safe in Swift 6.
            _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        case .screenRecording:
            _ = CGRequestScreenCaptureAccess()
        }
        let pane = kind == .accessibility ? "Privacy_Accessibility" : "Privacy_ScreenCapture"
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else { return false }
        return NSWorkspace.shared.open(url)
    }
}

public enum Methods {
    /// `cursor` is `nil` where no overlay may be drawn (unit tests); `host` is the process Moxxy runs in.
    public static func standard(permissions: SystemPermissions, targets: Targets = Targets(), cursor: AgentCursor? = nil,
                                input: InputSessions = InputSessions(), preview: PreviewStream? = nil) -> Dispatcher {
        targets.preview = preview
        return Dispatcher(handlers: [
            "status": { _ in status(permissions) },
            "list_apps": listApps,
            "resolve_apps": resolveApps,
            "get_app_state": { params in try appState(params, targets: targets, cursor: cursor) },
            "act": { params in try act(params, targets: targets, cursor: cursor, input: input) },
            "batch": { params in try batch(params, targets: targets, cursor: cursor, input: input) },
            "screenshot": { params in try screenshot(params, targets: targets, host: input.host) },
            "zoom": { params in try zoom(params, targets: targets, host: input.host) },
            "preview.start": { params in
                guard let preview else { throw HelperError(code: "unsupported_action", message: "This helper has no preview") }
                guard permissions.granted(.screenRecording) else {
                    throw HelperError(code: "permissions_not_granted", message: "Screen Recording is not allowed, so there is no preview")
                }
                var requested: Double?
                if case let .number(fps)? = params["fps"] { requested = fps }
                guard let codec = PreviewPolicy.codec(params["codec"]?.stringValue) else {
                    throw HelperError.invalidParams("codec must be jpeg or h264")
                }
                preview.start(fps: PreviewPolicy.fps(requested), codec: codec)
                return .object(["started": .bool(true)])
            },
            "preview.keyframe": { _ in
                preview?.keyframe()
                return .object(["requested": .bool(true)])
            },
            "preview.stop": { _ in
                preview?.stop()
                return .object(["stopped": .bool(true)])
            },
            "permissions.request": { params in
                guard let raw = params["kind"]?.stringValue, let kind = SystemPermissions.Kind(rawValue: raw) else {
                    throw HelperError.invalidParams("kind must be accessibility or screen_recording")
                }
                return .object(["opened": .bool(permissions.request(kind))])
            },
        ])
    }

    static func status(_ permissions: SystemPermissions) -> JSONValue {
        let accessibility = permissions.granted(.accessibility)
        let screenRecording = permissions.granted(.screenRecording)
        var limitations: [JSONValue] = []
        if !accessibility { limitations.append(.string("Accessibility is not allowed: the helper cannot read or operate app controls.")) }
        if !screenRecording { limitations.append(.string("Screen Recording is not allowed: the helper cannot capture windows.")) }
        return .object([
            "ready": .bool(accessibility && screenRecording),
            "permissions": .object(["accessibility": .bool(accessibility), "screenRecording": .bool(screenRecording)]),
            "limitations": .array(limitations),
        ])
    }
}
