import AppKit
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
        case .click(.point, _, _, _), .typeText(.point?, _), .paste(.point?, _, _), .notYetSupported:
            return .unsupported("unsupported_action")
        case let .typeText(.element(index)?, text):
            return onElement(index) { element in type(text, into: element) }
        case let .typeText(nil, text):
            return onFocused { element in type(text, into: element) }
        case let .pressKey(chord, count):
            guard let pid = state.window?.pid else { return noWindow }
            if chord.isSelectAll { return onFocused(selectAll) }
            if chord.needsMenuBar, !isFrontmost(pid) {
                return .blocked("not_frontmost", hint: "Command shortcuts reach an app only while it is in front. Use an element action or menu item from the app state instead.")
            }
            return keyboard { for _ in 0..<count { try KeyboardInput.press(chord, pid: pid) } }
        case let .paste(.element(index)?, text, format):
            return onElement(index) { element in paste(text, format, into: element) }
        case let .paste(nil, text, format):
            return onFocused { element in paste(text, format, into: element) }
        case let .selectText(index, text, prefix, suffix, placement):
            return onElement(index) { element in select(text, prefix: prefix, suffix: suffix, placement: placement, in: element) }
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

    private var noWindow: ActionResult { .unsupported("unsupported_action", hint: "The app has no open window to send keys to.") }

    /// Runs `body` on the element that has keyboard focus in the app.
    private func onFocused(_ body: (AXUIElement) -> ActionResult) -> ActionResult {
        guard let pid = state.window?.pid else { return noWindow }
        guard let element: AXUIElement = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute) else {
            return .unsupported("unsupported_action", hint: "Nothing in the app has keyboard focus; click a text field first, or pass element_index.")
        }
        AXUIElementSetMessagingTimeout(element, AXReader.messagingTimeout)
        return body(element)
    }

    /// Focusing a text field selects all of it, so an element that already has focus keeps its caret.
    private func focus(_ element: AXUIElement) -> ActionResult? {
        if AXReader.attribute(element, kAXFocusedAttribute) == true { return nil }
        let outcome = result(AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue))
        return outcome.outcome == .delivered ? nil : outcome
    }

    private func isFrontmost(_ pid: pid_t) -> Bool { NSRunningApplication(processIdentifier: pid)?.isActive ?? false }

    /// Inserts at the caret, replacing any selection; `nil` when the element does not take text this way.
    private func insertAtCaret(_ text: String, _ element: AXUIElement) -> ActionResult? {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success, settable.boolValue else { return nil }
        let inserted = result(AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString))
        return inserted.outcome == .unsupported ? nil : inserted
    }

    private func selectAll(_ element: AXUIElement) -> ActionResult {
        // The character count works for password fields too, whose value is never read.
        let length: Int? = AXReader.attribute(element, kAXNumberOfCharactersAttribute)
        guard let length = length ?? AXReader.valueText(element).map({ ($0 as NSString).length }) else {
            return .unsupported("unsupported_action", hint: "The focused element has no text to select.")
        }
        var range = CFRange(location: 0, length: length)
        guard let value = AXValueCreate(.cfRange, &range) else { return .blocked("helper_failed") }
        return result(AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, value))
    }

    /// Accessibility inserts at the caret (replacing a selection); keyboard events are the fallback.
    private func type(_ text: String, into element: AXUIElement) -> ActionResult {
        if let refused = focus(element) { return refused }
        if let inserted = insertAtCaret(text, element) { return inserted }
        guard let pid = state.window?.pid else { return noWindow }
        let chunks = Typing.chunks(text)
        var sent = 0
        for chunk in chunks {
            // Stop as soon as focus leaves the element: the rest would land somewhere else.
            let focused: AXUIElement? = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute)
            guard let focused, CFEqual(focused, element) else {
                return .blocked("target_blocked", hint: "Keyboard focus left the field after \(sent) of \(text.count) characters; observe again before typing the rest.")
            }
            KeyboardInput.type(chunk, pid: pid)
            sent += chunk.count
        }
        return .delivered(.input)
    }

    /// Plain text and Markdown are inserted like typing, so the clipboard is never touched; rich text needs
    /// the clipboard and Command-V, which only an app in front handles.
    private func paste(_ text: String, _ format: PasteFormat, into element: AXUIElement) -> ActionResult {
        if let refused = focus(element) { return refused }
        if format != .html, let inserted = insertAtCaret(text, element) { return inserted }
        guard let pid = state.window?.pid else { return noWindow }
        guard isFrontmost(pid) else {
            return .blocked("not_frontmost", hint: "Pasting rich text uses Command-V, which reaches an app only while it is in front. Paste it as text, or ask the user to bring the app forward.")
        }
        return keyboard { try Clipboard.paste(text, format: format, pid: pid) }
    }

    private func select(_ text: String, prefix: String?, suffix: String?, placement: TextPlacement, in element: AXUIElement) -> ActionResult {
        // Password fields are never read, so there is nothing to search.
        if AXReader.attribute(element, kAXSubroleAttribute) == (kAXSecureTextFieldSubrole as String) {
            return .unsupported("unsupported_action", hint: "Text in a password field cannot be selected by content.")
        }
        guard let value = AXReader.valueText(element) else {
            return .unsupported("unsupported_action", hint: "This element has no text to select.")
        }
        let range: NSRange
        switch TextLocator.find(text, in: value, prefix: prefix, suffix: suffix) {
        case let .success(found): range = found
        case .failure(.notFound): return .unsupported("unsupported_action", hint: "That text is not in this element; copy it exactly from the app state.")
        case let .failure(.ambiguous(count)):
            return .unsupported("unsupported_action", hint: "That text appears \(count) times; add prefix or suffix text to pick one.")
        }
        if let refused = focus(element) { return refused }
        var target = switch placement {
        case .text: CFRange(location: range.location, length: range.length)
        case .cursorBefore: CFRange(location: range.location, length: 0)
        case .cursorAfter: CFRange(location: NSMaxRange(range), length: 0)
        }
        guard let value = AXValueCreate(.cfRange, &target) else { return .blocked("helper_failed") }
        return result(AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, value))
    }

    /// Keyboard events have no answer to check: delivered means posted.
    private func keyboard(_ send: () throws -> Void) -> ActionResult {
        do {
            try send()
            return .delivered(.input)
        } catch let error as HelperError {
            return .blocked(error.code, hint: error.message)
        } catch {
            return .blocked("helper_failed")
        }
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
