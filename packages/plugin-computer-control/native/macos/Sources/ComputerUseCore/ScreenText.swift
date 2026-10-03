import CoreGraphics
import Foundation
import Vision

/// Text read from a window's pixels, for a control whose accessibility name differs from what it shows (a web
/// toolkit's "Title, Heading" over the words "Add title").
enum ScreenText {
    struct Line {
        let text: String
        /// Vision's box: fractions of the image, from its bottom left.
        let box: CGRect
    }

    static let languages = ["en-US", "pl-PL"]

    static func recognize(_ image: CGImage) throws -> [Line] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        let supported = (try? request.supportedRecognitionLanguages()) ?? []
        request.recognitionLanguages = languages.filter(supported.contains)
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { observation in
            observation.topCandidates(1).first.map { Line(text: $0.string, box: observation.boundingBox) }
        }
    }

    /// Where a box of an image of `area` lies on screen.
    static func screenRect(of box: CGRect, in area: CGRect) -> CGRect {
        CGRect(x: area.minX + box.minX * area.width, y: area.minY + (1 - box.maxY) * area.height,
               width: box.width * area.width, height: box.height * area.height)
    }
}

extension Methods {
    /// The lines of text in the app's window, placed in the pixels of its latest screenshot.
    static func readText(_ params: JSONValue, targets: Targets) throws -> JSONValue {
        let app = try grantedApp(params)
        try requireScreenRecording()
        let state = targets.state(for: app)
        guard let frame = state.frame, let window = state.window else {
            throw HelperError(code: "no_state", message: "There is no screenshot of \(app) to read yet")
        }
        guard let root = state.root, let now = AXReader.frame(root), WindowMatch.same(now, window.frame) else {
            throw HelperError(code: "stale_state", message: "The window moved since its screenshot")
        }
        let image = try WindowCapture.capture(window, region: frame.window, scale: 1)
        let lines: [JSONValue] = try ScreenText.recognize(image).compactMap { line in
            guard let rect = frame.imageRect(of: ScreenText.screenRect(of: line.box, in: frame.window)) else { return nil }
            return .object([
                "text": .string(line.text), "x": .number(rect.minX), "y": .number(rect.minY),
                "width": .number(rect.width), "height": .number(rect.height),
            ])
        }
        return .object(["lines": .array(lines)])
    }
}
