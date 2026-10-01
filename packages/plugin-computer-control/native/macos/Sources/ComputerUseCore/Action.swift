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
    case click(target: ActionTarget, button: MouseButton, count: Int, modifiers: CGEventFlags)
    case setValue(element: Int, value: String)
    case secondary(element: Int, name: String)
    /// `target == nil` types into whatever has keyboard focus in the app.
    case typeText(target: ActionTarget?, text: String)
    case pressKey(KeyChord, repeat: Int)
    case paste(target: ActionTarget?, text: String, format: PasteFormat)
    case selectText(element: Int, text: String, prefix: String?, suffix: String?, placement: TextPlacement)
    case scroll(target: ActionTarget, direction: ScrollDirection, pages: Double)
    /// `path` is in screenshot pixels.
    case drag(path: [CGPoint], button: MouseButton, duration: TimeInterval, modifiers: CGEventFlags)
    case mouse(MousePhase, at: CGPoint, button: MouseButton, modifiers: CGEventFlags)
    /// A contract action this helper does not perform yet.
    case notYetSupported(String)

    public static func parse(_ step: JSONValue) throws -> ActionRequest {
        guard let action = step["action"]?.stringValue else { throw HelperError.invalidParams("action is required") }
        switch action {
        case "click":
            guard let count = step["click_count"]?.intValue, (1...3).contains(count) else { throw HelperError.invalidParams("click needs click_count") }
            return .click(target: try target(step), button: try button(step), count: count, modifiers: try held(step))
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
        case "scroll":
            guard let direction = step["direction"]?.stringValue.flatMap(ScrollDirection.init(rawValue:)),
                  case let .number(pages)? = step["pages"], pages > 0, pages <= 50
            else { throw HelperError.invalidParams("scroll needs direction and pages") }
            return .scroll(target: try target(step), direction: direction, pages: pages)
        case "drag":
            guard case let .array(raw)? = step["path"], (2...20).contains(raw.count) else { throw HelperError.invalidParams("drag needs 2 to 20 points") }
            let path = try raw.map { point in
                guard case let .array(pair) = point, pair.count == 2, case let .number(x) = pair[0], case let .number(y) = pair[1], x >= 0, y >= 0 else {
                    throw HelperError.invalidParams("drag points are [x, y] pixels")
                }
                return CGPoint(x: x, y: y)
            }
            let milliseconds = step["duration_ms"]?.intValue ?? 0
            guard (0...10_000).contains(milliseconds) else { throw HelperError.invalidParams("duration_ms must be 0 to 10000") }
            return .drag(path: path, button: try button(step), duration: Double(milliseconds) / 1000, modifiers: try held(step))
        case "mouse":
            guard let phase = step["event"]?.stringValue.flatMap(MousePhase.init(rawValue:)), case let .point(point) = try target(step) else {
                throw HelperError.invalidParams("mouse needs event, x and y")
            }
            return .mouse(phase, at: point, button: try button(step), modifiers: try held(step))
        default:
            return .notYetSupported(action)
        }
    }

    private static func button(_ step: JSONValue) throws -> MouseButton {
        guard let button = step["mouse_button"]?.stringValue.flatMap(MouseButton.init(rawValue:)) else { throw HelperError.invalidParams("mouse_button is required") }
        return button
    }

    /// Modifier names the host parsed from `modifiers` ("shift", "meta", ...).
    private static func held(_ step: JSONValue) throws -> CGEventFlags {
        guard case let .array(names)? = step["held"] else { return [] }
        return try KeyCodes.flags(names)
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
    /// Sent and understood, but it cannot change anything (for example scrolling past the end).
    public static func ineffective(hint: String) -> ActionResult { ActionResult(outcome: .ineffective, code: nil, method: nil, hint: hint) }
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

    /// Roles whose press does the same wherever inside them the click lands; anything else (text, canvases,
    /// lists) cares about the exact point and gets a real click.
    static let pressable: Set<String> = [
        "AXButton", "AXCheckBox", "AXRadioButton", "AXMenuItem", "AXMenuBarItem", "AXMenuButton", "AXPopUpButton", "AXLink", "AXDisclosureTriangle", "AXTab",
    ]

    public static func pointClick(role: String, actions: [String], button: MouseButton, count: Int, modifiers: Bool) -> Step {
        pressable.contains(role) ? click(button: button, count: count, modifiers: modifiers, actions: actions) : .physical
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
