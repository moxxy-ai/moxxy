import Foundation

/// Any JSON value, kept Sendable so frames can cross from the reader thread to the request queue.
public enum JSONValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    public subscript(key: String) -> JSONValue? {
        guard case let .object(fields) = self else { return nil }
        return fields[key]
    }

    public var stringValue: String? { if case let .string(value) = self { value } else { nil } }
    public var boolValue: Bool? { if case let .bool(value) = self { value } else { nil } }
    public var intValue: Int? {
        guard case let .number(value) = self, value.rounded() == value, abs(value) <= 9_007_199_254_740_991 else { return nil }
        return Int(value)
    }
}

/// A refusal the TypeScript side maps to a known error code and its hint.
public struct HelperError: Error, Equatable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public static func invalidParams(_ message: String) -> HelperError { HelperError(code: "invalid_params", message: message) }
}

/// Why the stream itself can no longer be trusted; the helper stops instead of guessing.
public enum ProtocolFault: Error, Equatable, Sendable {
    case frameTooLarge
    case truncatedFrame
    case malformedFrame
    case versionMismatch(Int)
}

public enum ControlCommand: String, Sendable, Equatable {
    /// `takeover` pauses, hides the agent cursor and lets go of held keys and buttons.
    case pause, resume, stop, takeover
}

public enum Incoming: Equatable, Sendable {
    case request(id: String, method: String, params: JSONValue)
    case control(ControlCommand)
}

/// Splits a byte stream into newline-terminated frames without decoding text until a frame is complete.
public struct LineDecoder {
    private let limit: Int
    private var pending = Data()

    public init(limit: Int) { self.limit = limit }

    public mutating func push(_ bytes: Data) throws(ProtocolFault) -> [Data] {
        var frames: [Data] = []
        var rest = bytes[...]
        while !rest.isEmpty {
            let newline = rest.firstIndex(of: 0x0A)
            let part = rest[rest.startIndex..<(newline ?? rest.endIndex)]
            if pending.count + part.count > limit { throw .frameTooLarge }
            pending.append(contentsOf: part)
            guard let newline else { break }
            frames.append(pending)
            pending = Data()
            rest = rest[rest.index(after: newline)...]
        }
        return frames
    }

    public func finish() throws(ProtocolFault) {
        if !pending.isEmpty { throw .truncatedFrame }
    }
}

/// The JSON-lines envelope shared with `src/helper/protocol.ts`.
public enum Wire {
    public static let version = 5
    public static let maxFrameBytes = 3_000_000

    public static func decode(_ frame: Data) throws(ProtocolFault) -> Incoming {
        guard String(data: frame, encoding: .utf8) != nil,
              let value = try? JSONDecoder().decode(JSONValue.self, from: frame),
              case let .object(fields) = value,
              let version = fields["version"]?.intValue
        else { throw .malformedFrame }
        guard version == Self.version else { throw .versionMismatch(version) }
        if let control = fields["control"] {
            guard fields.count == 2, let command = control.stringValue.flatMap(ControlCommand.init(rawValue:)) else { throw .malformedFrame }
            return .control(command)
        }
        guard let id = fields["id"]?.stringValue, (1...160).contains(id.count),
              let method = fields["method"]?.stringValue, !method.isEmpty
        else { throw .malformedFrame }
        return .request(id: id, method: method, params: fields["params"] ?? .null)
    }

    public static func success(id: String, result: JSONValue) -> Data {
        encode(["version": .number(Double(version)), "id": .string(id), "ok": .bool(true), "result": result])
    }

    public static func failure(id: String, error: HelperError) -> Data {
        let details: JSONValue = .object(["code": .string(String(error.code.prefix(80))), "message": .string(String(error.message.prefix(2048)))])
        return encode(["version": .number(Double(version)), "id": .string(id), "ok": .bool(false), "error": details])
    }

    /// A frame the helper sends on its own, outside any request.
    public static func event(_ name: String, _ fields: [String: JSONValue]) -> Data {
        encode(fields.merging(["version": .number(Double(version)), "event": .string(name)]) { _, envelope in envelope })
    }

    private static func encode(_ fields: [String: JSONValue]) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        // Encoding a JSONValue tree cannot fail: every case maps to a JSON primitive.
        var data = (try? encoder.encode(JSONValue.object(fields))) ?? Data("{}".utf8)
        data.append(0x0A)
        return data
    }
}

/// Decoded input from stdin: a request or control frame, or the fault that ends the session.
public enum Inbound: Equatable, Sendable {
    case incoming(Incoming)
    case fatal(ProtocolFault)
}

/// Turns stdin bytes into frames; after the first fault it ignores everything else.
public struct ProtocolSession {
    private var decoder = LineDecoder(limit: Wire.maxFrameBytes)
    private var failed = false

    public init() {}

    public mutating func receive(_ bytes: Data) -> [Inbound] {
        guard !failed else { return [] }
        var inbound: [Inbound] = []
        do {
            for frame in try decoder.push(bytes) { inbound.append(.incoming(try Wire.decode(frame))) }
        } catch {
            failed = true
            inbound.append(.fatal(error))
        }
        return inbound
    }

    public mutating func finish() -> Inbound? {
        guard !failed else { return nil }
        do { try decoder.finish() } catch {
            failed = true
            return .fatal(error)
        }
        return nil
    }
}
