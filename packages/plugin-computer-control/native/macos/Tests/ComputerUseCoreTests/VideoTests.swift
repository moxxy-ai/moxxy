import CoreMedia
import CoreVideo
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct H264StreamTests {
    @Test func turnsLengthPrefixedUnitsIntoStartCodesWithParameterSetsOnlyOnKeyFrames() {
        let sps = Data([0x67, 0x64, 0x00, 0x1f, 0xac])
        let pps = Data([0x68, 0xee, 0x3c, 0x80])
        let slice = Data([0x65, 0x88, 0x84])
        let other = Data([0x41, 0x9a])
        var avcc = Data([0, 0, 0, 3]) + slice
        avcc += Data([0, 0, 0, 2]) + other
        let start = Data([0, 0, 0, 1])
        var units = Data()
        for unit in [slice, other] { units += start; units += unit }
        var keyFrame = Data()
        for unit in [sps, pps] { keyFrame += start; keyFrame += unit }
        keyFrame += units
        #expect(H264.annexB(avcc: avcc, lengthSize: 4, parameterSets: [sps, pps], key: true) == keyFrame)
        #expect(H264.annexB(avcc: avcc, lengthSize: 4, parameterSets: [sps, pps], key: false) == units)
    }

    @Test func refusesABufferWhoseLengthsDoNotAddUp() {
        #expect(H264.annexB(avcc: Data([0, 0, 0, 9, 0x65]), lengthSize: 4, parameterSets: [], key: false) == nil)
        #expect(H264.annexB(avcc: Data([0, 0]), lengthSize: 4, parameterSets: [], key: false) == nil)
        #expect(H264.annexB(avcc: Data(), lengthSize: 4, parameterSets: [], key: false) == nil)
    }

    @Test func namesTheCodecFromTheSequenceParameterSet() {
        #expect(H264.codec(sps: Data([0x67, 0x64, 0x00, 0x1f, 0xac])) == "avc1.64001f")
        #expect(H264.codec(sps: Data([0x67, 0x42, 0xc0, 0x0d])) == "avc1.42c00d")
        #expect(H264.codec(sps: Data([0x67, 0x42])) == nil)
    }

    @Test func readsTheCodecTheViewerAskedFor() {
        #expect(PreviewPolicy.codec(nil) == .jpeg)
        #expect(PreviewPolicy.codec("jpeg") == .jpeg)
        #expect(PreviewPolicy.codec("h264") == .h264)
        #expect(PreviewPolicy.codec("vp9") == nil)
    }
}

@Suite struct VideoEncoderTests {
    private func picture(width: Int, height: Int, shade: UInt8) throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        let attributes = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
        CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attributes, &buffer)
        let made = try #require(buffer)
        CVPixelBufferLockBaseAddress(made, [])
        memset(CVPixelBufferGetBaseAddress(made), Int32(shade), CVPixelBufferGetDataSize(made))
        CVPixelBufferUnlockBaseAddress(made, [])
        return made
    }

    /// The real system encoder: a key frame first, deltas after it, and a key frame again on request.
    @Test func encodesAKeyFrameFirstThenDeltasAndAKeyFrameOnRequest() throws {
        let chunks = Chunks()
        let encoder = try VideoEncoder(width: 320, height: 200, fps: 5) { chunks.add($0) }
        for index in 0..<4 {
            try encoder.encode(try picture(width: 320, height: 200, shade: UInt8(40 * index)), at: CMTime(value: CMTimeValue(index), timescale: 5), key: index == 3)
        }
        encoder.finish()
        let all = chunks.all
        #expect(all.count == 4)
        #expect(all.map(\.key) == [true, false, false, true])
        let first = try #require(all.first)
        #expect(first.data.prefix(4) == Data([0, 0, 0, 1]))
        // A key frame starts with the sequence parameter set, so a decoder can start from it alone.
        #expect(first.data[first.data.startIndex + 4] & 0x1f == 7)
        #expect(first.codec.range(of: "^avc1\\.[0-9a-f]{6}$", options: .regularExpression) != nil)
        #expect(all[1].data.count < first.data.count)
        #expect(all.map(\.timestamp) == [0, 200_000, 400_000, 600_000])
    }
}

private final class Chunks: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [VideoChunk] = []
    func add(_ chunk: VideoChunk) { lock.withLock { stored.append(chunk) } }
    var all: [VideoChunk] { lock.withLock { stored } }
}
