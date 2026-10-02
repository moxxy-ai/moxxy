import CoreGraphics
import CoreVideo
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct PreviewPolicyTests {
    @Test func keepsTheRateBetweenOneAndThirtyWithTwoAsDefault() {
        #expect(PreviewPolicy.fps(nil) == 2)
        #expect(PreviewPolicy.fps(4) == 4)
        #expect(PreviewPolicy.fps(0) == 1)
        #expect(PreviewPolicy.fps(30) == 30)
        #expect(PreviewPolicy.fps(60) == 30)
        #expect(PreviewPolicy.fps(2.6) == 3)
    }

    @Test func fitsTheLongerEdgeAndKeepsEvenSidesForVideoLater() {
        let retina = PreviewPolicy.size(points: CGSize(width: 1440, height: 900), pixelScale: 2)
        #expect(retina.width == 960)
        #expect(retina.height == 600)
        let tall = PreviewPolicy.size(points: CGSize(width: 400, height: 1001), pixelScale: 2)
        #expect(tall.height == 960)
        #expect(tall.width == 382)
        let odd = PreviewPolicy.size(points: CGSize(width: 301, height: 199), pixelScale: 1)
        #expect(odd.width == 300)
        #expect(odd.height == 198)
        let tiny = PreviewPolicy.size(points: CGSize(width: 1, height: 1), pixelScale: 1)
        #expect(tiny.width == 2)
        #expect(tiny.height == 2)
    }

    @Test func restartsOnlyWhenTheWindowIsAnotherOneOrChangedSize() {
        let window = WindowCandidate(pid: 1, frame: CGRect(x: 0, y: 0, width: 800, height: 600), title: "A")
        let moved = WindowCandidate(pid: 1, frame: CGRect(x: 40, y: 90, width: 800, height: 600), title: "A")
        let resized = WindowCandidate(pid: 1, frame: CGRect(x: 0, y: 0, width: 900, height: 600), title: "A")
        let other = WindowCandidate(pid: 2, frame: CGRect(x: 0, y: 0, width: 800, height: 600), title: "A")
        #expect(!PreviewPolicy.needsRestart(from: window, to: moved))
        #expect(PreviewPolicy.needsRestart(from: window, to: resized))
        #expect(PreviewPolicy.needsRestart(from: window, to: other))
        #expect(PreviewPolicy.needsRestart(from: nil, to: window))
        #expect(!PreviewPolicy.needsRestart(from: nil, to: nil))
    }
}

@Suite struct ShownPictureTests {
    private func picture(_ fill: UInt8, width: Int = 64, height: Int = 48, format: OSType = kCVPixelFormatType_32BGRA) -> CVPixelBuffer {
        var made: CVPixelBuffer?
        CVPixelBufferCreate(nil, width, height, format, nil, &made)
        let buffer = made!
        CVPixelBufferLockBaseAddress(buffer, [])
        if CVPixelBufferIsPlanar(buffer) {
            for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
                memset(CVPixelBufferGetBaseAddressOfPlane(buffer, plane), Int32(fill), CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
            }
        } else {
            memset(CVPixelBufferGetBaseAddress(buffer), Int32(fill), CVPixelBufferGetBytesPerRow(buffer) * height)
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        return buffer
    }

    @Test func comparesBothPlanesOfAVideoPicture() {
        let video = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        let shown = ShownPicture()
        #expect(shown.isNew(picture(10, format: video)))
        #expect(!shown.isNew(picture(10, format: video)))
        let tinted = picture(10, format: video)
        CVPixelBufferLockBaseAddress(tinted, [])
        CVPixelBufferGetBaseAddressOfPlane(tinted, 1)!.storeBytes(of: 200, as: UInt8.self)
        CVPixelBufferUnlockBaseAddress(tinted, [])
        #expect(shown.isNew(tinted))
    }

    @Test func tellsARepeatedPictureFromAChangedOne() {
        let shown = ShownPicture()
        #expect(shown.isNew(picture(10)))
        #expect(!shown.isNew(picture(10)))
        #expect(shown.isNew(picture(11)))
        #expect(!shown.isNew(picture(11)))
        #expect(shown.isNew(picture(11, width: 32)))
    }

    @Test func seesOnePixelChange() {
        let shown = ShownPicture()
        _ = shown.isNew(picture(0))
        let other = picture(0)
        CVPixelBufferLockBaseAddress(other, [])
        CVPixelBufferGetBaseAddress(other)!.storeBytes(of: 255, toByteOffset: CVPixelBufferGetBytesPerRow(other) * 47 + 63 * 4, as: UInt8.self)
        CVPixelBufferUnlockBaseAddress(other, [])
        #expect(shown.isNew(other))
    }
}
