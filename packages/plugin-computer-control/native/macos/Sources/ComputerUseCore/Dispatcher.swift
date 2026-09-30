import Foundation

/// Routes one request to its handler and always answers with an envelope; handlers run one at a time.
public struct Dispatcher: Sendable {
    public typealias Handler = @Sendable (JSONValue) throws -> JSONValue

    private let handlers: [String: Handler]

    public init(handlers: [String: Handler]) { self.handlers = handlers }

    public func handle(id: String, method: String, params: JSONValue) -> Data {
        guard let handler = handlers[method] else {
            return Wire.failure(id: id, error: HelperError(code: "unsupported_action", message: "Unknown method \(method)"))
        }
        do {
            return Wire.success(id: id, result: try handler(params))
        } catch let error as HelperError {
            return Wire.failure(id: id, error: error)
        } catch {
            // Never echo system error text: it can carry application content.
            return Wire.failure(id: id, error: HelperError(code: "helper_failed", message: "The helper failed while handling \(method)"))
        }
    }
}
