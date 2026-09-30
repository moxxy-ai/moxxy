import ApplicationServices
import Foundation

extension Methods {
    /// One step on a granted app, then its fresh state, so the model rarely needs a separate observation.
    static func act(_ params: JSONValue, targets: Targets, cursor: AgentCursor?) throws -> JSONValue {
        guard let app = params["app"]?.stringValue, !app.isEmpty, let step = params["action"] else {
            throw HelperError.invalidParams("app and action are required")
        }
        // The host checks grants first; the helper refuses on its own as well.
        guard case let .array(allowed)? = params["allowed"], allowed.contains(.string(app)) else {
            throw HelperError(code: "app_not_allowed", message: "\(app) is not granted in this conversation")
        }
        let request = try ActionRequest.parse(step)
        let state = targets.state(for: app)
        guard state.observed else { return .object(["result": ActionResult.blocked("no_state").json]) }
        let result = Executor(state: state, cursor: cursor).perform(request)
        if result.outcome == .delivered { state.lastAction = Date() }
        let fresh = try appState(.object(["app": .string(app), "screenshot": .bool(true)]), targets: targets, cursor: cursor)
        return .object(["result": result.json, "state": fresh])
    }
}

/// Runs one step against the elements of the last observation, accessibility first.
struct Executor {
    let state: TargetState
    let cursor: AgentCursor?

    func perform(_ request: ActionRequest) -> ActionResult {
        switch request {
        case let .click(.element(index), button, count, modifiers):
            return onElement(index) { element in
                switch AXLadder.click(button: button, count: count, modifiers: modifiers, actions: AXReader.actions(element)) {
                case let .axAction(name): return press(element, name)
                // Physical input arrives with the input gates (step 7c).
                case .physical: return .unsupported("unsupported_action")
                }
            }
        case .click(.point, _, _, _), .notYetSupported:
            return .unsupported("unsupported_action")
        case let .setValue(index, value):
            return onElement(index) { element in setValue(element, value) }
        case let .secondary(index, name):
            return onElement(index) { element in
                // Only actions the element offers; a guessed one is never tried.
                AXReader.actions(element).contains(name) ? press(element, name) : .unsupported("unsupported_action")
            }
        }
    }

    /// Resolves an index to its live element and runs `body` with the cursor on it.
    private func onElement(_ index: Int, _ body: (AXUIElement) -> ActionResult) -> ActionResult {
        guard let element = state.elements[index] else { return .blocked("stale_state") }
        AXUIElementSetMessagingTimeout(element, AXReader.messagingTimeout)
        var role: CFTypeRef?
        let alive = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        if case let .refused(code) = AXLadder.outcome(alive) { return .blocked(code) }
        let frame = AXReader.frame(element)
        guard let cursor else { return body(element) }
        return cursor.act(at: frame.map { CGPoint(x: $0.midX, y: $0.midY) }, outline: frame, in: state.window) { body(element) }
    }

    private func press(_ element: AXUIElement, _ name: String) -> ActionResult {
        result(AXUIElementPerformAction(element, name as CFString))
    }

    private func result(_ error: AXError) -> ActionResult {
        switch AXLadder.outcome(error) {
        case .done: .delivered(.ax)
        // Physical input arrives with the input gates (step 7c).
        case .fallBack: .unsupported("unsupported_action")
        case let .refused(code): .blocked(code)
        }
    }

    private func setValue(_ element: AXUIElement, _ text: String) -> ActionResult {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else {
            return .unsupported("unsupported_action")
        }
        // Sliders and steppers hold numbers; the model always sends text.
        let value: CFTypeRef
        if AXReader.attribute(element, kAXValueAttribute) as NSNumber? != nil {
            guard let number = Double(text) else { return .unsupported("unsupported_action") }
            value = NSNumber(value: number)
        } else {
            value = text as CFString
        }
        return result(AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value))
    }
}
