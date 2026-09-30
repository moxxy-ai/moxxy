import ApplicationServices
import CoreGraphics

public enum MouseButton: String, Sendable {
    case left, right, middle
}

/// Where a step points: an element index from the last state, or a pixel of the last screenshot.
public enum ActionTarget: Equatable, Sendable {
    case element(Int)
    case point(CGPoint)
}

/// One step of `act`/`batch`, already validated by the TypeScript contract; checked again here.
public enum ActionRequest: Equatable, Sendable {
    case click(target: ActionTarget, button: MouseButton, count: Int, modifiers: Bool)
    case setValue(element: Int, value: String)
    case secondary(element: Int, name: String)
    /// A contract action this helper does not perform yet.
    case notYetSupported(String)

    public static func parse(_ step: JSONValue) throws -> ActionRequest {
        guard let action = step["action"]?.stringValue else { throw HelperError.invalidParams("action is required") }
        switch action {
        case "click":
            guard let button = step["mouse_button"]?.stringValue.flatMap(MouseButton.init(rawValue:)),
                  let count = step["click_count"]?.intValue, (1...3).contains(count)
            else { throw HelperError.invalidParams("click needs mouse_button and click_count") }
            return .click(target: try target(step), button: button, count: count, modifiers: step["modifiers"]?.stringValue != nil)
        case "set_value":
            guard let value = step["value"]?.stringValue else { throw HelperError.invalidParams("set_value needs value") }
            return .setValue(element: try index(step), value: value)
        case "perform_secondary_action":
            guard let name = step["secondary_action"]?.stringValue, !name.isEmpty else {
                throw HelperError.invalidParams("perform_secondary_action needs secondary_action")
            }
            return .secondary(element: try index(step), name: name)
        default:
            return .notYetSupported(action)
        }
    }

    private static func index(_ step: JSONValue) throws -> Int {
        guard let index = step["element_index"]?.intValue, index >= 0 else { throw HelperError.invalidParams("element_index is required") }
        return index
    }

    private static func target(_ step: JSONValue) throws -> ActionTarget {
        if step["element_index"] != nil { return .element(try index(step)) }
        guard case let .number(x)? = step["x"], case let .number(y)? = step["y"], x >= 0, y >= 0 else {
            throw HelperError.invalidParams("give element_index, or x and y")
        }
        return .point(CGPoint(x: x, y: y))
    }
}

/// `actionResultSchema` in `src/contract/outcome.ts`: `delivered` means sent, never verified.
public struct ActionResult: Equatable, Sendable {
    public enum Outcome: String, Sendable { case delivered, ineffective, unsupported, blocked }
    public enum Method: String, Sendable { case ax, input }

    public let outcome: Outcome
    public let code: String?
    public let method: Method?

    public static func delivered(_ method: Method) -> ActionResult { ActionResult(outcome: .delivered, code: nil, method: method) }
    public static func blocked(_ code: String) -> ActionResult { ActionResult(outcome: .blocked, code: code, method: nil) }
    public static func unsupported(_ code: String) -> ActionResult { ActionResult(outcome: .unsupported, code: code, method: nil) }

    public var json: JSONValue {
        var fields: [String: JSONValue] = ["outcome": .string(outcome.rawValue)]
        if let code { fields["code"] = .string(code) }
        if let method { fields["method"] = .string(method.rawValue) }
        return .object(fields)
    }
}

/// Accessibility first, physical input only where accessibility has no equivalent (Codex and Claude alike).
public enum AXLadder {
    public enum Step: Equatable, Sendable { case axAction(String), physical }
    public enum Outcome: Equatable, Sendable { case done, fallBack, refused(String) }

    /// Only a plain single click has an accessibility equivalent; anything else is real input.
    public static func click(button: MouseButton, count: Int, modifiers: Bool, actions: [String]) -> Step {
        guard count == 1, !modifiers else { return .physical }
        let wanted = button == .left ? "AXPress" : button == .right ? "AXShowMenu" : nil
        guard let wanted, actions.contains(wanted) else { return .physical }
        return .axAction(wanted)
    }

    /// Fail closed: only an explicit "not supported" may be retried another way.
    public static func outcome(_ error: AXError) -> Outcome {
        switch error {
        case .success: .done
        case .actionUnsupported, .attributeUnsupported: .fallBack
        case .invalidUIElement: .refused("stale_state")
        case .cannotComplete: .refused("timeout")
        case .apiDisabled: .refused("permissions_not_granted")
        default: .refused("helper_failed")
        }
    }
}
