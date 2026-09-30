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
    /// `target == nil` types into whatever has keyboard focus in the app.
    case typeText(target: ActionTarget?, text: String)
    case pressKey(KeyChord, repeat: Int)
    case paste(target: ActionTarget?, text: String, format: PasteFormat)
    case selectText(element: Int, text: String, prefix: String?, suffix: String?, placement: TextPlacement)
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
        case "type_text":
            return .typeText(target: try optionalTarget(step), text: try text(step))
        case "press_key":
            guard let chord = step["chord"], let count = step["repeat"]?.intValue, (1...100).contains(count) else {
                throw HelperError.invalidParams("press_key needs chord and repeat")
            }
            return .pressKey(try KeyChord.parse(chord), repeat: count)
        case "paste":
            guard let format = step["format"]?.stringValue.flatMap(PasteFormat.init(rawValue:)) else { throw HelperError.invalidParams("paste needs format") }
            return .paste(target: try optionalTarget(step), text: try text(step), format: format)
        case "select_text":
            let placement = try step["selection_type"].map { raw in
                guard let placement = raw.stringValue.flatMap(TextPlacement.init(rawValue:)) else { throw HelperError.invalidParams("unknown selection_type") }
                return placement
            } ?? .text
            return .selectText(element: try index(step), text: try text(step), prefix: step["prefix"]?.stringValue,
                               suffix: step["suffix"]?.stringValue, placement: placement)
        default:
            return .notYetSupported(action)
        }
    }

    private static func text(_ step: JSONValue) throws -> String {
        guard let text = step["text"]?.stringValue, !text.isEmpty else { throw HelperError.invalidParams("text is required") }
        return text
    }

    private static func optionalTarget(_ step: JSONValue) throws -> ActionTarget? {
        step["element_index"] == nil && step["x"] == nil ? nil : try target(step)
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

public enum PasteFormat: String, Sendable { case text, md, html }

/// `actionResultSchema` in `src/contract/outcome.ts`: `delivered` means sent, never verified.
public struct ActionResult: Equatable, Sendable {
    public enum Outcome: String, Sendable { case delivered, ineffective, unsupported, blocked }
    public enum Method: String, Sendable { case ax, input }

    public let outcome: Outcome
    public let code: String?
    public let method: Method?
    /// Replaces the code's generic hint when the helper knows the specific next step.
    public var hint: String?

    public static func delivered(_ method: Method) -> ActionResult { ActionResult(outcome: .delivered, code: nil, method: method) }
    public static func blocked(_ code: String, hint: String? = nil) -> ActionResult { ActionResult(outcome: .blocked, code: code, method: nil, hint: hint) }
    public static func unsupported(_ code: String, hint: String? = nil) -> ActionResult {
        ActionResult(outcome: .unsupported, code: code, method: nil, hint: hint)
    }

    public var json: JSONValue {
        var fields: [String: JSONValue] = ["outcome": .string(outcome.rawValue)]
        if let code { fields["code"] = .string(code) }
        if let hint { fields["hint"] = .string(String(hint.prefix(1000))) }
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
