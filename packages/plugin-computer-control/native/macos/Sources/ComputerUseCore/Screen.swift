import CoreGraphics
import Foundation
import ScreenCaptureKit

/// The latest full-screen screenshot: how its pixels map to the screen and which apps it showed.
struct ScreenShot {
    let frame: CoordinateFrame
    let apps: Set<String>
}

/// The main display with only granted apps visible (Claude's `captureExcluding`): every other app, Moxxy
/// included, and the menu bar stay out of the image.
enum ScreenCapture {
    static let jpegQuality = 0.75

    static func capture(showing apps: Set<String>, except host: pid_t, region: CGRect?, scale: Double) throws -> (image: CGImage, frame: CoordinateFrame) {
        try Blocking<(image: CGImage, frame: CoordinateFrame)>.run(timeout: WindowCapture.timeout) {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let main = CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == main }) else {
                throw HelperError(code: "helper_failed", message: "The main display is not capturable")
            }
            // Excluding the rest (rather than including the granted apps) keeps windows where they are on screen
            // and works with a source rectangle; the menu bar would show the front app's menus.
            let hidden = content.applications.filter { !apps.contains($0.bundleIdentifier) || $0.processID == host }
            let filter = SCContentFilter(display: display, excludingApplications: hidden, exceptingWindows: [])
            // Without this switch the front app's menus would show, so older systems get no full-screen image.
            guard #available(macOS 14.2, *) else {
                throw HelperError(code: "helper_failed", message: "Full-screen screenshots need macOS 14.2 or later; use computer_get_app_state")
            }
            filter.includeMenuBar = false
            let bounds = CGDisplayBounds(main)
            let area = region ?? bounds
            let source = region.map { $0.offsetBy(dx: -bounds.minX, dy: -bounds.minY) }
            let image = try await WindowCapture.render(filter, size: area.size, source: source, scale: scale)
            return (image, CoordinateFrame(window: area, imageWidth: image.width, imageHeight: image.height))
        }
    }
}

extension Methods {
    static func imageJSON(_ image: CGImage) throws -> JSONValue {
        .object([
            "mediaType": .string("image/jpeg"), "base64": .string(try WindowCapture.jpeg(image, quality: ScreenCapture.jpegQuality).base64EncodedString()),
            "width": .number(Double(image.width)), "height": .number(Double(image.height)),
        ])
    }

    static func scale(_ params: JSONValue) throws -> Double {
        guard let raw = params["scale"] else { return 1 }
        guard case let .number(scale) = raw, scale >= 0.1, scale <= 1 else { throw HelperError.invalidParams("scale must be in [0.1, 1]") }
        return scale
    }

    static func requireScreenRecording() throws {
        guard CGPreflightScreenCaptureAccess() else {
            throw HelperError(code: "permissions_not_granted", message: "Screen Recording is not allowed for this app")
        }
    }

    /// The whole main display with only the granted apps visible.
    static func screenshot(_ params: JSONValue, targets: Targets, host: pid_t) throws -> JSONValue {
        let apps = allowedApps(params)
        guard !apps.isEmpty else { throw HelperError(code: "app_not_allowed", message: "No app is granted in this conversation") }
        let scale = try scale(params)
        try requireScreenRecording()
        let shot = try ScreenCapture.capture(showing: apps, except: host, region: nil, scale: scale)
        targets.screen = ScreenShot(frame: shot.frame, apps: apps)
        return try imageJSON(shot.image)
    }

    /// A region of the app's latest screenshot, or of the latest full-screen one, at a closer look.
    /// Coordinates never move to the zoomed image: the screenshot stays the frame of reference.
    static func zoom(_ params: JSONValue, targets: Targets, host: pid_t) throws -> JSONValue {
        guard case let .array(raw)? = params["region"] else { throw HelperError.invalidParams("region is required") }
        let region = raw.compactMap { value -> Double? in if case let .number(n) = value { n } else { nil } }
        let scale = try scale(params)
        try requireScreenRecording()
        if params["app"] != nil {
            let app = try grantedApp(params)
            let state = targets.state(for: app)
            guard let frame = state.frame, let window = state.window else {
                throw HelperError(code: "no_state", message: "There is no screenshot of \(app) to zoom into yet")
            }
            guard let rect = frame.screenRect(region: region) else {
                throw HelperError(code: "point_outside_frame", message: "The region is not inside the latest screenshot of \(app)")
            }
            // The window moved or changed size since its screenshot: the region no longer shows what the model saw.
            guard let root = state.root, let now = AXReader.frame(root), WindowMatch.same(now, window.frame) else {
                throw HelperError(code: "stale_state", message: "The window moved since its screenshot")
            }
            return try imageJSON(WindowCapture.capture(window, region: rect, scale: scale))
        }
        guard let screen = targets.screen else { throw HelperError(code: "no_state", message: "There is no full-screen screenshot to zoom into yet") }
        guard let rect = screen.frame.screenRect(region: region) else {
            throw HelperError(code: "point_outside_frame", message: "The region is not inside the latest full-screen screenshot")
        }
        // Only apps granted both then and now show.
        let apps = screen.apps.intersection(allowedApps(params))
        guard !apps.isEmpty else { throw HelperError(code: "app_not_allowed", message: "No app is granted in this conversation") }
        return try imageJSON(ScreenCapture.capture(showing: apps, except: host, region: rect, scale: scale).image)
    }
}
