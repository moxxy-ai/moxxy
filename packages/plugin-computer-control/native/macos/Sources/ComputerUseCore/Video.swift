import CoreMedia
import Foundation
import VideoToolbox

public enum PreviewCodec: String, Sendable { case jpeg, h264 }

/// One encoded picture of the preview, ready for a decoder that takes an Annex B stream.
public struct VideoChunk: Sendable {
    public let data: Data
    /// A key frame decodes without anything before it; it carries the parameter sets.
    public let key: Bool
    /// RFC 6381 name of the stream, e.g. `avc1.4d001f`.
    public let codec: String
    /// Microseconds.
    public let timestamp: Int64
    public let width: Int
    public let height: Int
}

public enum H264 {
    private static let startCode = Data([0, 0, 0, 1])

    /// The encoder writes each unit behind its length; a stream decoder wants start codes instead,
    /// and the parameter sets in front of every key frame.
    public static func annexB(avcc: Data, lengthSize: Int, parameterSets: [Data], key: Bool) -> Data? {
        guard (1...4).contains(lengthSize), !avcc.isEmpty else { return nil }
        var output = Data(capacity: avcc.count + 64)
        if key { for set in parameterSets { output += startCode + set } }
        var offset = avcc.startIndex
        while offset < avcc.endIndex {
            guard avcc.endIndex - offset >= lengthSize else { return nil }
            let length = avcc[offset..<offset + lengthSize].reduce(0) { $0 << 8 | Int($1) }
            offset += lengthSize
            guard length > 0, avcc.endIndex - offset >= length else { return nil }
            output += startCode + avcc[offset..<offset + length]
            offset += length
        }
        return output
    }

    /// Profile, constraints and level are the three bytes after the unit header of the sequence parameter set.
    public static func codec(sps: Data) -> String? {
        guard sps.count >= 4 else { return nil }
        return "avc1." + sps.dropFirst().prefix(3).map { String(format: "%02x", $0) }.joined()
    }
}

/// Compresses the preview with the system encoder, tuned for a live picture: no frame is held back.
public final class VideoEncoder: @unchecked Sendable {
    private let session: VTCompressionSession
    private let width: Int
    private let height: Int
    private let output: @Sendable (VideoChunk) -> Void

    public init(width: Int, height: Int, fps: Int, output: @escaping @Sendable (VideoChunk) -> Void) throws {
        var created: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
            outputCallback: nil, refcon: nil, compressionSessionOut: &created)
        guard status == noErr, let created else {
            throw HelperError(code: "helper_failed", message: "The video encoder could not start")
        }
        session = created
        self.width = width
        self.height = height
        self.output = output
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        // Reordered frames come out late; a live view shows each frame as soon as it exists.
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Main_AutoLevel)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fps as CFNumber)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 10 as CFNumber)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: 600_000 as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    public func encode(_ picture: CVPixelBuffer, at time: CMTime, key: Bool) throws {
        let properties = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        let (width, height, output) = (width, height, output)
        let status = VTCompressionSessionEncodeFrame(
            session, imageBuffer: picture, presentationTimeStamp: time, duration: .invalid,
            frameProperties: properties, infoFlagsOut: nil
        ) { status, _, sample in
            guard status == noErr, let sample, let chunk = Self.chunk(from: sample, width: width, height: height) else { return }
            output(chunk)
        }
        guard status == noErr else { throw HelperError(code: "helper_failed", message: "The video encoder refused a frame") }
    }

    /// Waits for the frames already handed in, then closes the encoder.
    public func finish() {
        VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
        VTCompressionSessionInvalidate(session)
    }

    private static func chunk(from sample: CMSampleBuffer, width: Int, height: Int) -> VideoChunk? {
        guard let format = CMSampleBufferGetFormatDescription(sample), let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
        var count = 0
        var lengthSize: Int32 = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
            parameterSetCountOut: &count, nalUnitHeaderLengthOut: &lengthSize) == noErr else { return nil }
        var sets: [Data] = []
        for index in 0..<count {
            var pointer: UnsafePointer<UInt8>?
            var size = 0
            guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
                parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pointer else { return nil }
            sets.append(Data(bytes: pointer, count: size))
        }
        var avcc = Data(count: CMBlockBufferGetDataLength(block))
        let copied = avcc.withUnsafeMutableBytes { bytes -> OSStatus in
            guard let base = bytes.baseAddress else { return -1 }
            return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: base)
        }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let key = !((attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)
        guard copied == noErr, let sps = sets.first, let codec = H264.codec(sps: sps),
              let data = H264.annexB(avcc: avcc, lengthSize: Int(lengthSize), parameterSets: sets, key: key) else { return nil }
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        return VideoChunk(data: data, key: key, codec: codec, timestamp: Int64((time.seconds * 1_000_000).rounded()), width: width, height: height)
    }
}
