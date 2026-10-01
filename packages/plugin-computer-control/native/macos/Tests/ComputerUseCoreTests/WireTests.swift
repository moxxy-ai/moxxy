import Foundation
import Testing
@testable import ComputerUseCore

private func object(_ data: Data) throws -> [String: Any] {
    #expect(data.last == 0x0A)
    return try #require(JSONSerialization.jsonObject(with: data.dropLast()) as? [String: Any])
}

private func line(_ text: String) -> Data { Data(text.utf8) }

@Suite struct JSONValueTests {
    @Test func roundTripsEveryKind() throws {
        let value: JSONValue = .object([
            "a": .array([.null, .bool(true), .number(1.5), .string("ż")]),
            "b": .object(["c": .number(3)]),
        ])
        let data = try JSONEncoder().encode(value)
        #expect(try JSONDecoder().decode(JSONValue.self, from: data) == value)
    }

    @Test func readsTypedFields() {
        let value: JSONValue = .object(["n": .number(4), "s": .string("x"), "b": .bool(false)])
        #expect(value["n"]?.intValue == 4)
        #expect(value["s"]?.stringValue == "x")
        #expect(value["b"]?.boolValue == false)
        #expect(value["missing"] == nil)
        #expect(value["s"]?.intValue == nil)
    }
}

@Suite struct LineDecoderTests {
    @Test func splitsFramesAcrossChunks() throws {
        var decoder = LineDecoder(limit: 64)
        #expect(try decoder.push(line("{\"a\":")) == [])
        #expect(try decoder.push(line("1}\n{\"b\":2}\n{\"c\"")) == [line("{\"a\":1}"), line("{\"b\":2}")])
        #expect(try decoder.push(line(":3}\n")) == [line("{\"c\":3}")])
        try decoder.finish()
    }

    @Test func rejectsAnOversizedFrame() {
        var decoder = LineDecoder(limit: 8)
        #expect(throws: ProtocolFault.frameTooLarge) { try decoder.push(line("123456789")) }
    }

    @Test func rejectsATruncatedFrameAtEndOfInput() throws {
        var decoder = LineDecoder(limit: 64)
        _ = try decoder.push(line("{\"a\":1"))
        #expect(throws: ProtocolFault.truncatedFrame) { try decoder.finish() }
    }
}

@Suite struct WireTests {
    @Test func decodesARequest() throws {
        let incoming = try Wire.decode(line("{\"version\":5,\"id\":\"r1\",\"method\":\"status\",\"params\":{\"x\":1}}"))
        #expect(incoming == .request(id: "r1", method: "status", params: .object(["x": .number(1)])))
    }

    @Test func decodesAControlFrame() throws {
        #expect(try Wire.decode(line("{\"version\":5,\"control\":\"pause\"}")) == .control(.pause))
        #expect(try Wire.decode(line("{\"version\":5,\"control\":\"takeover\"}")) == .control(.takeover))
    }

    @Test(arguments: [
        ("{\"version\":4,\"id\":\"r\",\"method\":\"status\",\"params\":{}}", ProtocolFault.versionMismatch(4)),
        ("{\"version\":5,\"method\":\"status\",\"params\":{}}", ProtocolFault.malformedFrame),
        ("{\"version\":5,\"control\":\"explode\"}", ProtocolFault.malformedFrame),
        ("[1,2]", ProtocolFault.malformedFrame),
        ("{not json", ProtocolFault.malformedFrame),
    ])
    func rejects(frame: String, fault: ProtocolFault) {
        #expect(throws: fault) { try Wire.decode(line(frame)) }
    }

    @Test func rejectsInvalidUTF8() {
        #expect(throws: ProtocolFault.malformedFrame) { try Wire.decode(Data([0x7B, 0xFF, 0x7D])) }
    }

    @Test func writesTheSuccessEnvelopeTheTransportExpects() throws {
        let reply = try object(Wire.success(id: "r1", result: .object(["ok": .bool(true)])))
        #expect(reply["version"] as? Int == 5)
        #expect(reply["id"] as? String == "r1")
        #expect(reply["ok"] as? Bool == true)
        #expect((reply["result"] as? [String: Any])?["ok"] as? Bool == true)
        #expect(Set(reply.keys) == ["version", "id", "ok", "result"])
    }

    @Test func writesTheFailureEnvelopeTheTransportExpects() throws {
        let reply = try object(Wire.failure(id: "r1", error: HelperError(code: "tier_insufficient", message: "read only")))
        #expect(reply["ok"] as? Bool == false)
        #expect(reply["error"] as? [String: String] == ["code": "tier_insufficient", "message": "read only"])
        #expect(Set(reply.keys) == ["version", "id", "ok", "error"])
    }

    @Test func capsAnOverlongErrorMessage() throws {
        let reply = try object(Wire.failure(id: "r", error: HelperError(code: "x", message: String(repeating: "m", count: 5000))))
        #expect(((reply["error"] as? [String: String])?["message"]?.count ?? 0) <= 2048)
    }
}
