import AppKit
import ApplicationServices
import Foundation

extension Methods {
    /// One step on a granted app, then its fresh state, so the model rarely needs a separate observation.
    static func act(_ params: JSONValue, targets: Targets, cursor: AgentCursor?, input: InputSessions) throws -> JSONValue {
        guard let step = params["action"] else { throw HelperError.invalidParams("action is required") }
        let app = try grantedApp(params)
        let request = try ActionRequest.parse(step)
        let state = targets.state(for: app)
        guard state.observed else { return .object(["result": ActionResult.blocked("no_state").json]) }
        // A step that waited out a pause acts on nothing: the app may have changed while the user had it.
        let began = Date()
        state.sent = nil
        state.reacted = false
        let heard = state.pid.map(Settler.listen)
        defer { heard?.stop() }
        Timing.mark("act: begin")
        let result = input.gate?.waitWhilePaused() == true
            ? ActionResult.blocked("user_intervened", hint: "The user paused Computer Use and resumed it; nothing was done. Look at the fresh state before the next action.")
            : Executor(state: state, cursor: cursor, input: input).perform(request)
        Timing.mark("act: performed \(result.method.map { "\($0)" } ?? result.code ?? "-")")
        if result.outcome == .delivered { state.lastAction = state.sent ?? began }
        heard?.forget(before: Settler.uptime(of: state.sent ?? began))
        state.heard = heard
        defer { state.heard = nil }
        var until: [String] = []
        if case let .array(labels)? = params["until"] { until = labels.compactMap(\.stringValue) }
        let ready = result.outcome == .delivered && !until.isEmpty ? state.pid.flatMap { awaited(until, pid: $0) } : nil
        Timing.mark(ready == nil ? "act: no effect awaited" : "act: effect shows")
        // A host that judges the action by its elements asks for no picture: the capture is the slowest part of a look.
        let picture = params["screenshot"]?.boolValue ?? true
        let fresh = try appState(.object(["app": .string(app), "screenshot": .bool(picture)]), targets: targets, cursor: cursor, ready: ready)
        return .object(["result": result.json, "state": fresh])
    }

    /// The target app, which must be in the request's `allowed` list: the host checks grants first and the
    /// helper refuses on its own as well.
    static func grantedApp(_ params: JSONValue) throws -> String {
        guard let app = params["app"]?.stringValue, !app.isEmpty else { throw HelperError.invalidParams("app is required") }
        guard allowedApps(params).contains(app) else {
            throw HelperError(code: "app_not_allowed", message: "\(app) is not granted in this conversation")
        }
        return app
    }

    static func allowedApps(_ params: JSONValue) -> Set<String> {
        guard case let .array(allowed)? = params["allowed"] else { return [] }
        return Set(allowed.compactMap(\.stringValue))
    }
}

/// Runs one step against the elements of the last observation, accessibility first.
struct Executor {
    let state: TargetState
    let cursor: AgentCursor?
    let input: InputSessions
    private var pointer: PointerSession { input.pointer }
    /// The process Moxxy runs in; real input never goes to its windows.
    private var host: pid_t { input.host }

    /// A gesture asked for twice in a row did not do its job the first time, so it is not sent the same way again:
    /// a background gesture always, an accessibility press only when it left the window as it was (some toolkits
    /// accept the press and do nothing).
    func perform(_ request: ActionRequest) -> ActionResult {
        let key = RepeatKey.of(request) { point in
            guard let frame = state.frame, let screen = onImage(point, frame) else { return nil }
            return FrameHit.index(at: screen, in: state.frames)
        }
        // A press that left the window as it was is not sent the same way again.
        let pressedInVain = state.pressed.map { $0.key == key && !differs(since: $0) } == true
        state.pressed = nil
        let before = isClick(request) ? seenBefore() : nil
        // What the window said at the observation is true only until something is done to it.
        let said = before?.said ?? state.said
        state.said = nil
        let result = run(request, retried: state.lastSoft == key || pressedInVain, seen: before)
        state.lastSoft = result.method == .background ? key : nil
        if result.method == .ax, let window = state.window, let said { state.pressed = (key, window, before?.pixels, said) }
        return result
    }

    private func isClick(_ request: ActionRequest) -> Bool {
        if case .click = request { return true }
        return false
    }

    private typealias Look = (window: WindowCandidate, pixels: PixelBuffer, said: [String])

    private func look() -> Look? {
        guard let window = state.window, let pixels = try? WindowCapture.capture(window).pixels else { return nil }
        return (window, pixels, state.said ?? content())
    }

    /// How long the picture and words of an observation stand for the window as it is.
    private static let freshFor: TimeInterval = 2

    /// The window before a click as the observation just before it showed it; a new look is taken only where
    /// one is needed (see `physically`), not for every click.
    private func seenBefore() -> Look? {
        guard let window = state.window, let pixels = state.pixels, let said = state.said,
              let at = state.observedAt, Date().timeIntervalSince(at) < Self.freshFor else { return nil }
        return (window, pixels, said)
    }

    private func changed(since before: Look) -> Bool {
        let changed = differs(since: before)
        if changed { state.reacted = true }
        return changed
    }

    /// Whether the window's words or picture changed since `before`; the words first, which need no waiting.
    private func differs(since before: Look) -> Bool {
        content() != before.said || redrawn(before.window, since: before.pixels)
    }

    /// The same for an earlier press, whose picture is there only when its observation had one.
    private func differs(since pressed: (key: String, window: WindowCandidate, pixels: PixelBuffer?, said: [String])) -> Bool {
        content() != pressed.said || pressed.pixels.map { redrawn(pressed.window, since: $0) } == true
    }

    private func run(_ request: ActionRequest, retried: Bool, seen: Look?) -> ActionResult {
        let physically = { (screen: CGPoint, point: CGPoint?, others: [CGPoint], button: MouseButton, send: (CGPoint, PointerRoute) -> Void) in
            self.physically(at: screen, aimedAt: point, alsoOn: others, button: button, retried: retried, seen: seen, send)
        }
        switch request {
        case let .click(.element(index), button, count, modifiers):
            return live(index) { element in
                if let refused = guardSave(confirmedBy: element) { return refused }
                if !retried, case let .axAction(name) = AXLadder.click(button: button, count: count, modifiers: !modifiers.isEmpty, actions: AXReader.actions(element)),
                   let pressed = attempt(on: element, { tryPress(element, name) }) {
                    return pressed
                }
                if !retried, AXLadder.selectsRow(role: AXReader.attribute(element, kAXRoleAttribute) ?? "", button: button, count: count, modifiers: !modifiers.isEmpty) {
                    let foundAgain = state.revived.first.map { CFEqual($0, element) } == true
                    let selected = AXLadder.cursorTravels(toRowFoundAgain: foundAgain)
                        ? attempt(on: element, { selectRow(around: element) })
                        : selectRow(around: element)
                    if let selected { return selected }
                }
                guard let frame = AXReader.frame(element) else { return .unsupported("unsupported_action", hint: "The element has no place on screen to click.") }
                return physically(CGPoint(x: frame.midX, y: frame.midY), nil, [], button) { pointer.perform(MouseScript.click(at: $0, button: button, count: count), flags: modifiers, route: $1) }
            }
        case let .click(.point(point), button, count, modifiers):
            return aimed(point) { screen in
                let hits = elements(at: screen)
                for element in hits { if let refused = guardSave(confirmedBy: element) { return refused } }
                // A control under the point is pressed through accessibility, in the background.
                for element in retried ? [] : hits {
                    if case let .axAction(name) = AXLadder.pointClick(role: AXReader.attribute(element, kAXRoleAttribute) ?? "", actions: AXReader.actions(element),
                                                                       button: button, count: count, modifiers: !modifiers.isEmpty),
                       let pressed = attempt(at: screen, outline: AXReader.frame(element), { tryPress(element, name) }) {
                        return pressed
                    }
                }
                return physically(screen, point, [], button) { pointer.perform(MouseScript.click(at: $0, button: button, count: count), flags: modifiers, route: $1) }
            }
        case .notYetSupported:
            return .unsupported("unsupported_action")
        case let .typeText(.element(index)?, text):
            return onElement(index) { element in
                if Typing.takesNoText(role: AXReader.attribute(element, kAXRoleAttribute) ?? "") {
                    return .unsupported("unsupported_action", hint: "This element holds no text. To type into whatever has keyboard focus (a name being edited, a cell), call computer_type_text without element_index.")
                }
                return type(text, into: element)
            }
        case let .typeText(.point(point)?, text):
            return aimed(point) { screen in onText(at: screen) { element in type(text, into: element) } }
        case let .typeText(nil, text):
            return onFocused { element in type(text, into: element) }
        case let .pressKey(chord, count):
            guard let pid = state.pid else { return noWindow }
            if chord.isSelectAll { return onFocused(selectAll) }
            if chord.confirms, let focused: AXUIElement = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute),
               let refused = guardSave(confirmedBy: focused, byReturn: true) {
                return refused
            }
            let press = { keyboard { pointForKeys(pid); for _ in 0..<count { try KeyboardInput.press(chord, pid: pid) } } }
            return chord.needsMenuBar || focusIsElsewhere(pid) ? inFront(press) : press()
        case let .holdKey(chord, duration):
            guard let pid = state.pid else { return noWindow }
            let hold = { keyboard { pointForKeys(pid); return input.keys.hold(KeyScript.hold(chord, stroke: try KeyboardInput.stroke(for: chord)), pid: pid, for: duration) } }
            return chord.needsMenuBar || focusIsElsewhere(pid) ? inFront(hold) : hold()
        case let .paste(.element(index)?, text, format):
            return onElement(index) { element in paste(text, format, into: element) }
        case let .paste(.point(point)?, text, format):
            return aimed(point) { screen in onText(at: screen) { element in paste(text, format, into: element) } }
        case let .paste(nil, text, format):
            return onFocused { element in paste(text, format, into: element) }
        case let .selectText(index, text, prefix, suffix, placement):
            return onElement(index) { element in select(text, prefix: prefix, suffix: suffix, placement: placement, in: element) }
        case let .setValue(index, value):
            return onElement(index) { element in setValue(element, value) }
        case let .secondary(index, name):
            return onElement(index) { element in
                // Only actions the element offers; a guessed one is never tried.
                guard let action = TreeBuilder.action(named: name, in: AXReader.actions(element)) else { return .unsupported("unsupported_action") }
                if let refused = guardSave(confirmedBy: element) { return refused }
                return tryPress(element, action) ?? .unsupported("unsupported_action")
            }
        case let .scroll(.element(index), direction, pages):
            return live(index) { element in
                if let scrolled = scrollInBackground(from: element, direction, pages) { return scrolled }
                guard let frame = AXReader.frame(element) else { return .unsupported("unsupported_action", hint: "The element has no place on screen to scroll.") }
                let viewport = AXReader.scrollArea(around: element).flatMap(AXReader.frame)?.size ?? frame.size
                return physically(CGPoint(x: frame.midX, y: frame.midY), nil, [], .left) { pointer.scroll(ScrollPlan.wheel(direction, pages: pages, viewport: viewport), at: $0, route: $1) }
            }
        case let .scroll(.point(point), direction, pages):
            return aimed(point) { screen in
                let element = AXReader.element(at: screen, pid: state.window?.pid)
                if let element, let scrolled = scrollInBackground(from: element, direction, pages) { return scrolled }
                let viewport = element.flatMap(AXReader.scrollArea(around:)).flatMap(AXReader.frame)?.size ?? state.frame?.window.size ?? .zero
                return physically(screen, point, [], .left) { pointer.scroll(ScrollPlan.wheel(direction, pages: pages, viewport: viewport), at: $0, route: $1) }
            }
        case let .drag(path, button, duration, modifiers):
            guard let frame = state.frame else { return .blocked("no_state", hint: "Observe the app with a screenshot before dragging.") }
            let screens = path.compactMap { onImage($0, frame) }
            guard screens.count == path.count, let grab = path.first, let drop = screens.last else { return .blocked("point_outside_frame") }
            return aimed(grab) { start in
                physically(start, grab, [drop], button) { pointer.perform(MouseScript.drag(screens, button: button, duration: duration), flags: modifiers, route: $1) }
            }
        case let .mouse(phase, point, button, modifiers):
            return mouse(phase, point, button, modifiers)
        }
    }

    /// A gesture spelled out step by step: down aims like a click, moves and the release follow the hand.
    private func mouse(_ phase: MousePhase, _ point: CGPoint, _ button: MouseButton, _ modifiers: CGEventFlags) -> ActionResult {
        let held = pointer.holding
        switch phase {
        case .down:
            if held != nil { return .unsupported("unsupported_action", hint: "A mouse button is already down; release it with event up first.") }
            return aimed(point) { screen in
                // A press held across steps follows the hand, so it always goes through the screen.
                physically(at: screen, aimedAt: point, button: button, retried: true) { at, _ in
                    pointer.perform(MouseScript.single(.down, at: at, button: button, held: false), flags: modifiers, keepDown: button)
                }
            }
        case .move, .up:
            guard let held else {
                return .unsupported("unsupported_action", hint: "Hover is not supported: the pointer returns to the user after every action. Press first with event down.")
            }
            guard let screen = state.frame.flatMap({ onImage(point, $0) }) else { return .blocked("point_outside_frame") }
            let keep: MouseButton? = phase == .move ? held : nil
            let steps = MouseScript.single(phase, at: screen, button: held, held: true)
            if phase == .up, let window = state.window,
               let refused = PointerGate.check(screen, displays: ScreenLayout.displays(), under: ScreenLayout.owner(at: screen), target: window.pid, host: host) {
                return refused
            }
            if let busy = waitForQuiet() { return busy }
            return withCursor(at: screen, outline: nil) {
                pointer.perform(steps, flags: modifiers, keepDown: keep)
                return .delivered(.input)
            }
        }
    }

    // MARK: Aiming

    /// A screenshot pixel on the screen, when it lies inside the image.
    private func onImage(_ point: CGPoint, _ frame: CoordinateFrame) -> CGPoint? {
        guard point.x < Double(frame.imageWidth), point.y < Double(frame.imageHeight) else { return nil }
        return frame.screenPoint(x: point.x, y: point.y)
    }

    private enum Aim { case at(CGPoint), refused(ActionResult) }

    /// Checks a screenshot point still shows what the model aimed at: same window place and size, same pixels around it.
    private func aim(_ point: CGPoint) -> Aim {
        guard let frame = state.frame, let pixels = state.pixels, let window = state.window else {
            return .refused(.blocked("no_state", hint: "Observe the app with a screenshot before acting by coordinates."))
        }
        guard let screen = onImage(point, frame),
              let patch = PixelPatch.rect(aroundX: Int(point.x), y: Int(point.y), width: frame.imageWidth, height: frame.imageHeight)
        else { return .refused(.blocked("point_outside_frame")) }
        guard let live = AXReader.targetWindow(of: AXReader.application(window.pid)).flatMap(AXReader.frame), WindowMatch.same(live, frame.window) else {
            return .refused(.blocked("stale_state", hint: "The window moved, changed size or was replaced since the screenshot; aim again in the fresh state."))
        }
        let now: WindowImage
        do {
            now = try WindowCapture.capture(WindowCandidate(pid: window.pid, frame: live, title: window.title))
        } catch let error as HelperError {
            return .refused(.blocked(error.code, hint: error.message))
        } catch {
            return .refused(.blocked("helper_failed"))
        }
        guard now.pixels.width == pixels.width, now.pixels.height == pixels.height,
              PixelPatch.same(PixelPatch.pixels(pixels, in: patch), PixelPatch.pixels(now.pixels, in: patch))
        else { return .refused(.blocked("screen_changed")) }
        return .at(screen)
    }

    private func aimed(_ point: CGPoint, _ body: (CGPoint) -> ActionResult) -> ActionResult {
        switch aim(point) {
        case let .refused(result): result
        case let .at(screen): body(screen)
        }
    }

    /// Pointer input at `screen`. It first goes to the window in the background; when that changes nothing that
    /// can be seen, real input follows: the app comes forward (never while the user types), the point must land
    /// on it, and the user's pointer goes back afterwards. `aimedAt` is checked again when coming forward
    /// changed the window.
    private func physically(at screen: CGPoint, aimedAt point: CGPoint? = nil, alsoOn others: [CGPoint] = [], button: MouseButton, retried: Bool, seen: Look? = nil,
                            _ send: (CGPoint, PointerRoute) -> Void) -> ActionResult {
        guard let window = state.window else { return noWindow }
        if pointer.holding != nil {
            return .unsupported("unsupported_action", hint: "A mouse button is still down from computer_mouse; release it with event up first.")
        }
        state.lastClick = screen
        let route = PointerRoute.choose(available: WindowServerLink.shared.available, window: WindowDirectory.address(of: window), button: button, repeated: retried,
                                        selfDrawn: SelfDrawn.window(window.frame, elements: state.frames.values))
        if case .window = route, let before = seen ?? look() {
            _ = withCursor(at: screen, outline: nil) {
                state.sent = Date()
                send(screen, route)
                return .delivered(.background)
            }
            if changed(since: before) { return .delivered(.background) }
        }
        if let busy = waitForQuiet() { return busy }
        switch Foreground.bring(window) {
        case let .refused(result): return result
        case .broughtForward:
            // An app in front can look different (focus rings, accent colours); the model must see that first.
            if let point, case let .refused(result) = aim(point) { return result }
            Foreground.awaitOnTop(at: screen, pid: window.pid)
        case .alreadyFront: break
        }
        let displays = ScreenLayout.displays()
        for target in [screen] + others {
            if let refused = PointerGate.check(target, displays: displays, under: ScreenLayout.owner(at: target), target: window.pid, host: host) { return refused }
        }
        // A second try through the screen is the last method there is: when even that changes nothing, say so.
        let before = retried ? look() : nil
        let result = withCursor(at: screen, outline: nil) {
            state.sent = Date()
            send(screen, .screen)
            return .delivered(.input)
        }
        if let before, !changed(since: before) {
            return .ineffective(hint: "A real click changed nothing either; this control does nothing here. Try another element, a keyboard shortcut or a menu.")
        }
        return result
    }

    /// How long a window gets to show the effect of a gesture sent to it in the background.
    private static let redrawDeadline: TimeInterval = 0.6

    /// What the window's elements say, for an effect that shows in accessibility and not in the picture.
    private func content() -> [String] {
        guard let root = state.root else { return [] }
        return Self.said(TreeBuilder.build(AXReader().snapshot(root), limit: Methods.treeLimit).elements)
    }

    static func said(_ elements: [TreeElement]) -> [String] {
        elements.map { [$0.key, $0.title ?? "", $0.description ?? "", $0.value ?? "", $0.states.joined(separator: ",")].joined(separator: "\u{1F}") }
    }

    private func redrawn(_ window: WindowCandidate, since before: PixelBuffer) -> Bool {
        let until = Date().addingTimeInterval(Self.redrawDeadline)
        repeat {
            Thread.sleep(forTimeInterval: 0.05)
            if let now = try? WindowCapture.capture(window).pixels, PixelPatch.changed(before, now) { return true }
        } while Date() < until
        return false
    }

    /// Real pointer input waits for a moment in which the user is not using the mouse or keyboard.
    private func waitForQuiet() -> ActionResult? {
        guard let activity = input.activity else { return nil }
        for attempt in 0... {
            switch QuietWait.next(sinceInput: activity.secondsSinceInput(), attempt: attempt) {
            case .go: return nil
            case let .wait(seconds): Thread.sleep(forTimeInterval: seconds)
            case .refuse:
                return .blocked("user_intervened", hint: "The user is using the mouse or keyboard right now, and real input would fight them. Nothing was done; retry after a pause, or use element actions, which work in the background.")
            }
        }
        return nil
    }

    // MARK: Elements

    /// Resolves an index to its live element.
    private func live(_ index: Int, _ body: (AXUIElement) -> ActionResult) -> ActionResult {
        guard var element = state.elements[index] else { return .blocked("stale_state") }
        AXUIElementSetMessagingTimeout(element, AXReader.messagingTimeout)
        var role: CFTypeRef?
        var alive = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        // A list hands out the rows it does not show only for the moment it is read: find the element again.
        if alive == .invalidUIElement, let again = revived(index) {
            element = again
            alive = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        }
        if case let .refused(code) = AXLadder.outcome(alive) { return .blocked(code) }
        return body(element)
    }

    /// The element that now sits where the observed one did, by its key.
    private func revived(_ index: Int) -> AXUIElement? {
        guard let wanted = state.signs[index], wanted.sign.title != nil || wanted.sign.description != nil, let root = state.root,
              let chain = AXReader.find(wanted.sign, nth: wanted.nth, under: root), let element = chain.first else { return nil }
        state.revived = chain
        AXUIElementSetMessagingTimeout(element, AXReader.messagingTimeout)
        state.elements[index] = element
        return element
    }

    /// Resolves an index and runs `body` with the cursor on the element.
    private func onElement(_ index: Int, _ body: (AXUIElement) -> ActionResult) -> ActionResult {
        live(index) { element in withCursor(on: element) { body(element) } }
    }

    private func withCursor(on element: AXUIElement, _ body: () -> ActionResult) -> ActionResult {
        let frame = AXReader.frame(element)
        return withCursor(at: frame.map { CGPoint(x: $0.midX, y: $0.midY) }, outline: frame, body)
    }

    private func attempt(on element: AXUIElement, _ body: () -> ActionResult?) -> ActionResult? {
        let frame = AXReader.frame(element)
        return attempt(at: frame.map { CGPoint(x: $0.midX, y: $0.midY) }, outline: frame, body)
    }

    /// The cursor glides to `point` and reports the phases around `body`; `nil` from `body` (fall back to real
    /// input) is reported as failed and handed back so the caller can try the next method.
    private func attempt(at point: CGPoint?, outline: CGRect?, _ body: () -> ActionResult?) -> ActionResult? {
        guard let cursor else { return body() }
        var outcome: ActionResult?
        _ = cursor.act(at: point, outline: outline, in: state.window) {
            outcome = body()
            return outcome ?? .unsupported("unsupported_action")
        }
        return outcome
    }

    private func withCursor(at point: CGPoint?, outline: CGRect?, _ body: () -> ActionResult) -> ActionResult {
        guard let cursor else { return body() }
        return cursor.act(at: point, outline: outline, in: state.window, body)
    }

    /// What is under a screen point: the system hit test answers for what is visible; for a window on another
    /// Space or under another one, the frames observed with the state still name the element.
    private func elements(at screen: CGPoint) -> [AXUIElement] {
        [AXReader.element(at: screen, pid: state.window?.pid), FrameHit.index(at: screen, in: state.frames).flatMap { state.elements[$0] }].compactMap { $0 }
    }

    /// The text field under a point of the app, for typing and pasting by coordinates.
    private func onText(at screen: CGPoint, _ body: (AXUIElement) -> ActionResult) -> ActionResult {
        guard let element = elements(at: screen).first(where: AXReader.takesText) else {
            return .unsupported("unsupported_action", hint: "There is no text field at that point. On a canvas or a spreadsheet cell, click the point first, then send the text with no target.")
        }
        return withCursor(at: screen, outline: AXReader.frame(element)) { body(element) }
    }

    /// Scrolling without real input: the page action of the element or a container, then the scroll bar of the
    /// scroll area around it. `nil` leaves it to the wheel.
    private func scrollInBackground(from element: AXUIElement, _ direction: ScrollDirection, _ pages: Double) -> ActionResult? {
        for candidate in AXReader.lineage(element) {
            if let plan = ScrollPlan.ax(direction, pages: pages, actions: AXReader.actions(candidate)),
               let done = attempt(on: candidate, { turnPages(candidate, plan) }) {
                return done
            }
        }
        guard let area = AXReader.scrollArea(around: element) else { return nil }
        return attempt(on: area) { moveBar(in: area, direction, pages) }
    }

    /// Some containers list a page action they then decline (AppKit scroll views); that falls through.
    private func turnPages(_ element: AXUIElement, _ plan: ScrollPlan.AXPages) -> ActionResult? {
        for turn in 0..<plan.times {
            guard let result = tryPress(element, plan.action) else { return turn == 0 ? nil : .delivered(.ax) }
            if result.outcome != .delivered { return result }
        }
        return .delivered(.ax)
    }

    private func moveBar(in area: AXUIElement, _ direction: ScrollDirection, _ pages: Double) -> ActionResult? {
        let vertical = direction == .up || direction == .down
        guard let bar: AXUIElement = AXReader.attribute(area, vertical ? kAXVerticalScrollBarAttribute : kAXHorizontalScrollBarAttribute),
              let current: NSNumber = AXReader.attribute(bar, kAXValueAttribute),
              let visible = AXReader.frame(area),
              let content = AXReader.contentSize(of: area),
              let target = ScrollPlan.barValue(from: current.doubleValue, direction, pages: pages,
                                               visible: vertical ? visible.height : visible.width, content: vertical ? content.height : content.width)
        else { return nil }
        if target == current.doubleValue { return .ineffective(hint: "The content is already at its \(direction.rawValue) end; there is nothing more to scroll that way.") }
        switch AXLadder.outcome(AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: target))) {
        case .done: return .delivered(.ax)
        case .fallBack: return nil
        case let .refused(code): return .blocked(code)
        }
    }

    /// An open or save panel of a sandboxed app is drawn by a system process: keys sent to the app's own process
    /// never reach it, so they go through the session with the app in front.
    private func focusIsElsewhere(_ pid: pid_t) -> Bool {
        guard let focused: AXUIElement = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute) else { return false }
        return AXReader.lineage(focused).contains { FilePanel.identifiers.contains(AXReader.attribute($0, kAXIdentifierAttribute) ?? "") }
    }

    /// See `KeyAim`: a canvas app is told the pointer is where the model last clicked, so its keys go there.
    private func pointForKeys(_ pid: pid_t) {
        let focused: AXUIElement? = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute)
        let role: String? = focused.flatMap { AXReader.attribute($0, kAXRoleAttribute) }
        guard let point = KeyAim.pointer(lastClick: state.lastClick, window: state.window?.frame, focusRole: role) else { return }
        pointer.hint(at: point, pid: pid)
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

    /// Inserts at the caret, replacing any selection; `nil` when the element does not take text this way.
    private func insertAtCaret(_ text: String, _ element: AXUIElement) -> ActionResult? {
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success, settable.boolValue else { return nil }
        let before = footprint(element)
        let inserted = result(AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString))
        guard inserted.outcome == .delivered, !text.isEmpty else { return inserted.outcome == .unsupported ? nil : inserted }
        // A web view reports its new value a moment after the call returns.
        let deadline = Date().addingTimeInterval(0.3)
        while !Typing.landed(before: before, after: footprint(element)) {
            guard Date() < deadline else { return nil }
            Thread.sleep(forTimeInterval: 0.02)
        }
        return inserted
    }

    private func footprint(_ element: AXUIElement) -> TextFootprint? {
        let count: Int? = AXReader.attribute(element, kAXNumberOfCharactersAttribute)
        var caret: Int?
        if let range: AXValue = AXReader.attribute(element, kAXSelectedTextRangeAttribute) {
            var found = CFRange()
            if AXValueGetValue(range, .cfRange, &found) { caret = found.location + found.length }
        }
        let value = AXReader.valueText(element) ?? count.map(String.init)
        return value == nil && caret == nil ? nil : TextFootprint(value: value, caret: caret)
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
        if let refused = guardSave(writing: text, into: element) { return refused }
        if let refused = focus(element) { return refused }
        if let inserted = insertAtCaret(text, element) { return inserted }
        guard let pid = state.window?.pid else { return noWindow }
        if focusIsElsewhere(pid), case let .refused(result) = Foreground.bring(pid: pid, window: state.frontable) { return result }
        let intoText = AXReader.takesText(element)
        let inPage = AXReader.inPage(element)
        guard Typing.sendsKeys(intoText: intoText, inPage: inPage) else {
            return .unsupported("unsupported_action", hint: "Keyboard focus on this page is not in a text field, so typed letters would act as the page's shortcuts. Nothing was typed; click the text field first, or use set_value on it.")
        }
        let chunks = Typing.chunks(text, limit: Typing.unitsPerEvent(intoText: intoText, inPage: inPage))
        pointForKeys(pid)
        var sent = 0
        for chunk in chunks {
            // Stop as soon as focus leaves the element: the rest would land somewhere else.
            let focused: AXUIElement? = AXReader.attribute(AXReader.application(pid), kAXFocusedUIElementAttribute)
            guard Typing.holdsFocus(appFocusIsTheElement: focused.map { CFEqual($0, element) }, elementSaysFocused: AXReader.attribute(element, kAXFocusedAttribute) == true) else {
                return .blocked("target_blocked", hint: "Keyboard focus left the field after \(sent) of \(text.count) characters; observe again before typing the rest.")
            }
            KeyboardInput.type(chunk, pid: pid)
            sent += chunk.count
        }
        return .delivered(.input)
    }

    /// Plain text and Markdown are inserted like typing, so the clipboard is never touched; rich text needs
    /// the clipboard and Command-V, so the app comes forward.
    private func paste(_ text: String, _ format: PasteFormat, into element: AXUIElement) -> ActionResult {
        if let refused = guardSave(writing: text, into: element) { return refused }
        if let refused = focus(element) { return refused }
        if format != .html, let inserted = insertAtCaret(text, element) { return inserted }
        guard let pid = state.window?.pid else { return noWindow }
        return inFront { keyboard { try Clipboard.paste(text, format: format, pid: pid) } }
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

    // MARK: Save dialogs

    private static let home = FileManager.default.homeDirectoryForCurrentUser.path
    private static let protectedHint = "A save dialog would write to a protected place (login items, shell start-up files, keys, git hooks or a file that runs when opened). Nothing was done; choose another name or folder, or ask the user to save it themselves."

    /// Text for a save dialog's name or Go To field, alone and as it would read after insertion at the end.
    private func guardSave(writing text: String, into element: AXUIElement, replacing: Bool = false) -> ActionResult? {
        let field = AXReader.identifier(element)
        let result = replacing ? text : (AXReader.valueText(element) ?? "") + text
        guard SaveGuard.refusesTyping(text, into: field, home: Self.home) || SaveGuard.refusesTyping(result, into: field, home: Self.home) else { return nil }
        return .blocked("protected_path", hint: Self.protectedHint)
    }

    /// Pressing Save, or Return anywhere in the dialog (`byReturn`), checks the name in the dialog and the
    /// folder its Where menu shows.
    private func guardSave(confirmedBy element: AXUIElement, byReturn: Bool = false) -> ActionResult? {
        guard byReturn || AXReader.identifier(element) == SaveGuard.saveButton,
              let panel = AXReader.lineage(element).first(where: { AXReader.identifier($0) == SaveGuard.panel })
        else { return nil }
        let name = AXReader.descendant(of: panel, identifier: SaveGuard.nameField).flatMap(AXReader.valueText)
        let folder = AXReader.descendant(of: panel, identifier: SaveGuard.whereMenu).flatMap(AXReader.valueText)
        return SaveGuard.refusesSaving(name: name, folder: folder, home: Self.home) ? .blocked("protected_path", hint: Self.protectedHint) : nil
    }

    /// Command shortcuts and rich-text paste go through the menu bar, which only the app in front has: the app
    /// comes forward (never while the user types) and stays there.
    private func inFront(_ body: () -> ActionResult) -> ActionResult {
        guard let pid = state.pid else { return noWindow }
        if case let .refused(result) = Foreground.bring(pid: pid, window: state.frontable) { return result }
        return body()
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

    /// `nil` when the element declines the action, so real input may try instead. An action the element
    /// declined three times is not asked again for a while.
    /// Selects the list row the element is in; `nil` when there is none to select, or it is selected already
    /// (a click on a selected row means something else, and goes through the pointer).
    private func selectRow(around element: AXUIElement) -> ActionResult? {
        // An element found again comes with what contains it; it would not name its parent itself.
        let around = state.revived.first.map { CFEqual($0, element) } == true ? state.revived : AXReader.lineage(element, limit: 4)
        if let cell = around.prefix(4).first(where: { AXReader.attribute($0, kAXRoleAttribute) == (kAXCellRole as String) }),
           AXLadder.opensRow(cellActions: AXReader.actions(cell)), let opened = tryPress(cell, "AXOpen") { return opened }
        guard let row = around.prefix(4).first(where: { AXReader.attribute($0, kAXRoleAttribute) == (kAXRowRole as String) }),
              AXReader.attribute(row, kAXSelectedAttribute) == false else { return nil }
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(row, kAXSelectedAttribute as CFString, &settable) == .success, settable.boolValue else { return nil }
        switch AXLadder.outcome(AXUIElementSetAttributeValue(row, kAXSelectedAttribute as CFString, kCFBooleanTrue)) {
        case .done: return .delivered(.ax)
        case .fallBack: return nil
        case let .refused(code): return .blocked(code)
        }
    }

    private func tryPress(_ element: AXUIElement, _ name: String) -> ActionResult? {
        let key = "\(CFHash(element)):\(name)"
        if state.declines.skips(key) { return nil }
        switch AXLadder.outcome(AXUIElementPerformAction(element, name as CFString)) {
        case .done:
            state.declines.worked(key)
            return .delivered(.ax)
        case .fallBack:
            state.declines.declined(key)
            return nil
        case let .refused(code):
            return .blocked(code)
        }
    }

    private func result(_ error: AXError) -> ActionResult {
        switch AXLadder.outcome(error) {
        case .done: .delivered(.ax)
        case .fallBack: .unsupported("unsupported_action")
        case let .refused(code): .blocked(code)
        }
    }

    private func setValue(_ element: AXUIElement, _ text: String) -> ActionResult {
        if let refused = guardSave(writing: text, into: element, replacing: true) { return refused }
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
