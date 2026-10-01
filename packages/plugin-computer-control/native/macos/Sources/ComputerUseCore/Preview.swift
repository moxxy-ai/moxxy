import CoreImage
import CoreMedia
import Foundation
@preconcurrency import ScreenCaptureKit

/// The live picture for the human is small on purpose: it is watched in a corner, not read.
public enum PreviewPolicy {
    static let maxEdge = 960
    static let jpegQuality = 0.6
    /// How often a running capture says so when nothing on screen changes.
    static let aliveInterval: TimeInterval = 1

    /// What the viewer can show; without a wish it gets still pictures. `nil` for a name this helper does not know.
    public static func codec(_ requested: String?) -> PreviewCodec? {
        guard let requested else { return .jpeg }
        return PreviewCodec(rawValue: requested)
    }

    public static func fps(_ requested: Double?) -> Int {
        guard let requested else { return 2 }
        return min(30, max(1, Int(requested.rounded())))
    }

    /// Pixels for a window of `points`: the longer edge at most `maxEdge`, both sides even (video encoders need that).
    public static func size(points: CGSize, pixelScale: Double) -> (width: Int, height: Int) {
        let width = points.width * pixelScale
        let height = points.height * pixelScale
        let shrink = min(1, Double(maxEdge) / max(width, height, 1))
        let even = { (side: Double) in max(2, Int(side * shrink) / 2 * 2) }
        return (even(width), even(height))
    }

    /// A stream follows its window as it moves; another window or another size needs a new stream.
    public static func needsRestart(from old: WindowCandidate?, to new: WindowCandidate?) -> Bool {
        guard let old, let new else { return (old == nil) != (new == nil) }
        return old.pid != new.pid || old.title != new.title || old.frame.size != new.frame.size
    }
}

/// Remembers the picture last sent, to tell whether the next one differs from it.
final class ShownPicture {
    private var planes: [Data] = []
    private var shape: [Int] = []

    /// True, and remembered, when `picture` is not the one seen last.
    func isNew(_ picture: CVPixelBuffer) -> Bool {
        CVPixelBufferLockBaseAddress(picture, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(picture, .readOnly) }
        // The capture hands out video pictures in two planes (brightness, colour); a plain picture is one block.
        let planar = CVPixelBufferIsPlanar(picture)
        let parts = (0..<(planar ? CVPixelBufferGetPlaneCount(picture) : 1)).map { index in
            planar
                ? (base: CVPixelBufferGetBaseAddressOfPlane(picture, index), rows: CVPixelBufferGetHeightOfPlane(picture, index),
                   stride: CVPixelBufferGetBytesPerRowOfPlane(picture, index), width: CVPixelBufferGetWidthOfPlane(picture, index))
                : (base: CVPixelBufferGetBaseAddress(picture), rows: CVPixelBufferGetHeight(picture),
                   stride: CVPixelBufferGetBytesPerRow(picture), width: CVPixelBufferGetWidth(picture))
        }
        let now = parts.flatMap { [$0.rows, $0.stride, $0.width] }
        let same = now == shape && zip(parts, planes).allSatisfy { part, old in
            old.withUnsafeBytes { bytes in
                guard let was = bytes.baseAddress, let base = part.base, part.width > 0 else { return false }
                // The bytes past the width of a row are padding and may hold anything.
                let used = part.width * (part.stride / part.width)
                return (0..<part.rows).allSatisfy { memcmp(was + $0 * part.stride, base + $0 * part.stride, used) == 0 }
            }
        }
        if same { return false }
        planes = parts.map { part in part.base.map { Data(bytes: $0, count: part.rows * part.stride) } ?? Data() }
        shape = now
        return true
    }
}

/// Streams the window being worked in to the host, as JPEG frames or as H.264 video. The agent cursor is not in the
/// picture (its overlay is excluded from capture); the host draws it from the cursor events.
public final class PreviewStream: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let emit: @Sendable (Data) -> Void
    /// Owns every field below and receives the frames.
    private let queue = DispatchQueue(label: "ai.moxxy.computer.preview")
    private let context = CIContext()
    private var fps: Int?
    private var codec = PreviewCodec.jpeg
    private var encoder: VideoEncoder?
    /// The newest picture, kept so a key frame can be made for a viewer who joins a still window.
    private var latest: CVPixelBuffer?
    private var wantsKey = false
    private var shown = ShownPicture()
    private var window: WindowCandidate?
    private var stream: SCStream?
    private var alive: DispatchSourceTimer?
    /// Counts restarts, so a stream that finished starting after it was replaced is dropped.
    private var generation = 0
    private var seq = 0

    public init(emit: @escaping @Sendable (Data) -> Void) { self.emit = emit }

    /// Starts capturing, or changes the rate of a running capture. Without an observed window it waits for one.
    public func start(fps: Int, codec: PreviewCodec = .jpeg) {
        queue.async {
            guard self.fps != fps || self.codec != codec else { return }
            self.fps = fps
            self.codec = codec
            self.restart()
        }
    }

    /// A viewer cannot decode from where the stream is (it just joined, or it dropped frames): start it afresh.
    public func keyframe() {
        queue.async {
            guard let encoder = self.encoder else { return }
            guard let latest = self.latest else { self.wantsKey = true; return }
            try? encoder.encode(latest, at: CMClockGetTime(CMClockGetHostTimeClock()), key: true)
        }
    }

    /// Returns once capture is off, so no frame follows the answer to a stop request.
    public func stop() {
        queue.sync {
            self.fps = nil
            self.restart()
        }
    }

    /// The window the model last observed.
    func target(_ window: WindowCandidate?) {
        queue.async {
            let changed = PreviewPolicy.needsRestart(from: self.window, to: window)
            self.window = window
            if changed, self.fps != nil { self.restart() }
        }
    }

    private func restart() {
        generation += 1
        let generation = generation
        alive?.cancel()
        alive = nil
        encoder?.finish()
        encoder = nil
        latest = nil
        wantsKey = false
        shown = ShownPicture()
        if let old = stream {
            stream = nil
            old.stopCapture { _ in }
        }
        guard let fps, let window else { return }
        let codec = codec
        Task {
            do {
                let filter = try await WindowCapture.filter(for: window)
                let size = PreviewPolicy.size(points: window.frame.size, pixelScale: Double(filter.pointPixelScale))
                let configuration = SCStreamConfiguration()
                configuration.width = size.width
                configuration.height = size.height
                configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
                configuration.queueDepth = 3
                configuration.showsCursor = false
                configuration.ignoreShadowsSingleWindow = true
                configuration.backgroundColor = CGColor.black
                let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
                let encoder = codec == .h264 ? try VideoEncoder(width: size.width, height: size.height, fps: fps) { [weak self] chunk in
                    self?.queue.async { self?.send(chunk, generation: generation) }
                } : nil
                try await stream.startCapture()
                self.queue.async {
                    guard self.generation == generation else {
                        stream.stopCapture { _ in }
                        encoder?.finish()
                        return
                    }
                    self.stream = stream
                    self.encoder = encoder
                    self.startAlive()
                }
            } catch {
                self.queue.async {
                    if self.generation == generation { self.report(error: "The window could not be captured for the preview") }
                }
            }
        }
    }

    private func startAlive() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + PreviewPolicy.aliveInterval, repeating: PreviewPolicy.aliveInterval)
        timer.setEventHandler { [weak self] in
            guard let self, self.stream != nil else { return }
            self.emit(Wire.event("preview_frame", ["seq": .number(Double(self.seq))]))
        }
        timer.resume()
        alive = timer
    }

    private func send(_ chunk: VideoChunk, generation: Int) {
        guard generation == self.generation else { return }
        seq += 1
        emit(Wire.event("preview_chunk", [
            "seq": .number(Double(seq)), "key": .bool(chunk.key), "codec": .string(chunk.codec),
            "data": .string(chunk.data.base64EncodedString()), "timestamp": .number(Double(chunk.timestamp)),
            "width": .number(Double(chunk.width)), "height": .number(Double(chunk.height)),
        ]))
    }

    private func report(error: String) {
        alive?.cancel()
        alive = nil
        encoder?.finish()
        encoder = nil
        latest = nil
        stream = nil
        emit(Wire.event("preview_frame", ["seq": .number(Double(seq)), "error": .string(error)]))
    }

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, stream === self.stream, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = (attachments.first?[.status] as? Int).flatMap(SCFrameStatus.init(rawValue:)), status == .complete,
              let buffer = sampleBuffer.imageBuffer
        else { return }
        // A still window keeps producing pictures, each reported as changed all over; only the pixels tell.
        guard shown.isNew(buffer) || wantsKey else { return }
        if let encoder {
            latest = buffer
            let key = wantsKey
            wantsKey = false
            do { try encoder.encode(buffer, at: sampleBuffer.presentationTimeStamp, key: key) }
            catch { report(error: "The preview video could not be encoded") }
            return
        }
        let picture = CIImage(cvPixelBuffer: buffer)
        guard let image = context.createCGImage(picture, from: picture.extent),
              let jpeg = try? WindowCapture.jpeg(image, quality: PreviewPolicy.jpegQuality)
        else { return }
        seq += 1
        emit(Wire.event("preview_frame", [
            "seq": .number(Double(seq)),
            "image": .object([
                "mediaType": .string("image/jpeg"), "base64": .string(jpeg.base64EncodedString()),
                "width": .number(Double(image.width)), "height": .number(Double(image.height)),
            ]),
        ]))
    }

    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard stream === self.stream else { return }
            self.report(error: "The preview capture stopped")
        }
    }
}
