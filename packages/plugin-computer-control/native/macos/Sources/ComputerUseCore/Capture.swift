import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Vision input limits shared with `IMAGE_LIMITS` in src/contract/image.ts.
public enum ImageBudget {
    static let pxPerTile = 28
    static let maxEdge = 1568
    static let maxTiles = 1568

    static func tiles(_ width: Int, _ height: Int) -> Int {
        ((width + pxPerTile - 1) / pxPerTile) * ((height + pxPerTile - 1) / pxPerTile)
    }

    static func fits(_ width: Int, _ height: Int) -> Bool {
        width <= maxEdge && height <= maxEdge && tiles(width, height) <= maxTiles
    }

    /// Largest size with the same aspect that fits; the same binary search as the TypeScript side.
    public static func fit(width: Int, height: Int) -> (width: Int, height: Int) {
        if fits(width, height) { return (width, height) }
        if height > width {
            let turned = fit(width: height, height: width)
            return (turned.height, turned.width)
        }
        let aspect = Double(width) / Double(height)
        let heightFor = { (w: Int) in max(1, Int((Double(w) / aspect).rounded(.toNearestOrAwayFromZero))) }
        var low = 1
        var high = width
        while high - low > 1 {
            let middle = (low + high) / 2
            if fits(middle, heightFor(middle)) { low = middle } else { high = middle }
        }
        return (low, heightFor(low))
    }
}

/// How the window image maps onto the screen: `window` is in global points (top-left origin), the image in pixels.
public struct CoordinateFrame: Sendable, Equatable {
    public let window: CGRect
    public let imageWidth: Int
    public let imageHeight: Int

    var scaleX: Double { Double(imageWidth) / window.width }
    var scaleY: Double { Double(imageHeight) / window.height }

    /// An element's screen rectangle in image pixels, clipped to the window; `nil` when it lies outside.
    public func imageRect(of element: CGRect) -> CGRect? {
        let visible = element.intersection(window)
        guard !visible.isNull, visible.width > 0, visible.height > 0 else { return nil }
        return CGRect(
            x: ((visible.minX - window.minX) * scaleX).rounded(), y: ((visible.minY - window.minY) * scaleY).rounded(),
            width: (visible.width * scaleX).rounded(), height: (visible.height * scaleY).rounded()
        )
    }

    public func screenPoint(x: Double, y: Double) -> CGPoint {
        CGPoint(x: window.minX + x / scaleX, y: window.minY + y / scaleY)
    }
}

public struct WindowCandidate: Sendable, Equatable {
    public let pid: pid_t
    public let frame: CGRect
    public let title: String?
}

/// Finds the capturable window behind an accessibility window without private window-number APIs.
public enum WindowMatch {
    static let tolerance: CGFloat = 2

    public static func best(for target: WindowCandidate, in candidates: [WindowCandidate]) -> Int? {
        let matching = candidates.indices.filter { index in
            let candidate = candidates[index]
            return candidate.pid == target.pid
                && abs(candidate.frame.minX - target.frame.minX) <= tolerance && abs(candidate.frame.minY - target.frame.minY) <= tolerance
                && abs(candidate.frame.width - target.frame.width) <= tolerance && abs(candidate.frame.height - target.frame.height) <= tolerance
        }
        return matching.first { candidates[$0].title == target.title } ?? matching.first
    }
}

/// A finished capture: JPEG pixels and the frame that maps them back to the screen.
public struct WindowImage: Sendable {
    public let jpeg: Data
    public let frame: CoordinateFrame
}

/// Runs async work from the serial request queue, which must stay synchronous for the protocol.
final class Blocking<T: Sendable>: @unchecked Sendable {
    private var result: Result<T, Error>?
    private let done = DispatchSemaphore(value: 0)

    static func run(timeout: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) throws -> T {
        let box = Blocking<T>()
        Task.detached {
            do { box.result = .success(try await operation()) } catch { box.result = .failure(error) }
            box.done.signal()
        }
        guard box.done.wait(timeout: .now() + timeout) == .success, let result = box.result else {
            throw HelperError(code: "timeout", message: "The system did not answer in time")
        }
        return try result.get()
    }
}

enum WindowCapture {
    static let timeout: TimeInterval = 5
    static let jpegQuality = 0.8

    static func capture(_ target: WindowCandidate) throws -> WindowImage {
        try Blocking<WindowImage>.run(timeout: timeout) {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            let windows = content.windows
            let candidates = windows.map { WindowCandidate(pid: $0.owningApplication?.processID ?? -1, frame: $0.frame, title: $0.title) }
            guard let match = WindowMatch.best(for: target, in: candidates) else {
                throw HelperError(code: "helper_failed", message: "The window is not capturable")
            }
            let filter = SCContentFilter(desktopIndependentWindow: windows[match])
            let scale = Double(filter.pointPixelScale)
            let size = ImageBudget.fit(width: Int((target.frame.width * scale).rounded()), height: Int((target.frame.height * scale).rounded()))
            let configuration = SCStreamConfiguration()
            configuration.width = size.width
            configuration.height = size.height
            configuration.showsCursor = false
            configuration.ignoreShadowsSingleWindow = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            return WindowImage(jpeg: try jpeg(image), frame: CoordinateFrame(window: target.frame, imageWidth: image.width, imageHeight: image.height))
        }
    }

    static func jpeg(_ image: CGImage) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw HelperError(code: "helper_failed", message: "JPEG encoding is unavailable")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw HelperError(code: "helper_failed", message: "JPEG encoding failed") }
        return data as Data
    }
}
