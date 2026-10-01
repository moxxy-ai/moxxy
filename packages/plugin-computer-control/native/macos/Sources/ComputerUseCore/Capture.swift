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

    /// The budgeted size shrunk by `scale` (in [0.1, 1]); `scaledSize(imageBudget(...))` on the TypeScript side.
    public static func fit(width: Int, height: Int, scale: Double) -> (width: Int, height: Int) {
        let size = fit(width: width, height: height)
        let scaled = { (side: Int) in max(1, Int((Double(side) * scale).rounded(.toNearestOrAwayFromZero))) }
        return (scaled(size.width), scaled(size.height))
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

    /// `[x0, y0, x1, y1]` in image pixels as a screen rectangle; `nil` unless it is a non-empty part of the image.
    public func screenRect(region: [Double]) -> CGRect? {
        guard region.count == 4 else { return nil }
        let (x0, y0, x1, y1) = (region[0], region[1], region[2], region[3])
        guard x0 >= 0, y0 >= 0, x1 > x0, y1 > y0, x1 <= Double(imageWidth), y1 <= Double(imageHeight) else { return nil }
        let origin = screenPoint(x: x0, y: y0)
        let end = screenPoint(x: x1, y: y1)
        return CGRect(x: origin.x, y: origin.y, width: end.x - origin.x, height: end.y - origin.y)
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

    /// Two reports of one window's frame, from different APIs, agree within a couple of points.
    public static func same(_ a: CGRect, _ b: CGRect) -> Bool {
        abs(a.minX - b.minX) <= tolerance && abs(a.minY - b.minY) <= tolerance && abs(a.width - b.width) <= tolerance && abs(a.height - b.height) <= tolerance
    }

    public static func best(for target: WindowCandidate, in candidates: [WindowCandidate]) -> Int? {
        let matching = candidates.indices.filter { candidates[$0].pid == target.pid && same(candidates[$0].frame, target.frame) }
        return matching.first { candidates[$0].title == target.title } ?? matching.first
    }
}

/// A finished capture: JPEG for the model, raw pixels for the check before a click, and the frame
/// that maps both back to the screen.
public struct WindowImage: Sendable {
    public let jpeg: Data
    public let pixels: PixelBuffer
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
            let image = try await render(filter(for: target), size: target.frame.size, source: nil, scale: 1)
            return WindowImage(jpeg: try jpeg(image), pixels: try pixels(image),
                               frame: CoordinateFrame(window: target.frame, imageWidth: image.width, imageHeight: image.height))
        }
    }

    /// `region` (screen points inside the window) at up to its native resolution, for a closer look.
    static func capture(_ target: WindowCandidate, region: CGRect, scale: Double) throws -> CGImage {
        try Blocking<CGImage>.run(timeout: timeout) {
            let local = region.offsetBy(dx: -target.frame.minX, dy: -target.frame.minY)
            return try await render(filter(for: target), size: region.size, source: local, scale: scale)
        }
    }

    static func filter(for target: WindowCandidate) async throws -> SCContentFilter {
        let windows = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false).windows
        let candidates = windows.map { WindowCandidate(pid: $0.owningApplication?.processID ?? -1, frame: $0.frame, title: $0.title) }
        guard let match = WindowMatch.best(for: target, in: candidates) else {
            throw HelperError(code: "helper_failed", message: "The window is not capturable")
        }
        return SCContentFilter(desktopIndependentWindow: windows[match])
    }

    /// `size` points of the filter's content (from `source`, in the content's own points) within the image budget.
    static func render(_ filter: SCContentFilter, size: CGSize, source: CGRect?, scale: Double) async throws -> CGImage {
        let pixelScale = Double(filter.pointPixelScale)
        let pixels = ImageBudget.fit(width: Int((size.width * pixelScale).rounded()), height: Int((size.height * pixelScale).rounded()), scale: scale)
        let configuration = SCStreamConfiguration()
        configuration.width = pixels.width
        configuration.height = pixels.height
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        if let source { configuration.sourceRect = source }
        // What the filter leaves out stays black, never mistaken for content. The property does not retain
        // its color, so it must be the system constant.
        configuration.backgroundColor = CGColor.black
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    }

    /// RGBA in sRGB, so two captures of the same content compare equal whatever the display profile.
    static func pixels(_ image: CGImage) throws -> PixelBuffer {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let drawn = bytes.withUnsafeMutableBytes { raw -> Bool in
            guard let space = CGColorSpace(name: CGColorSpace.sRGB),
                  let context = CGContext(data: raw.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                                          bytesPerRow: image.width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        guard drawn else { throw HelperError(code: "helper_failed", message: "The window pixels could not be read") }
        return PixelBuffer(width: image.width, height: image.height, bytes: bytes)
    }

    static func jpeg(_ image: CGImage, quality: Double = jpegQuality) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw HelperError(code: "helper_failed", message: "JPEG encoding is unavailable")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw HelperError(code: "helper_failed", message: "JPEG encoding failed") }
        return data as Data
    }
}
