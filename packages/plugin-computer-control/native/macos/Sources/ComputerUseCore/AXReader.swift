import ApplicationServices

/// Reads one window's accessibility tree into plain snapshots, keeping the live elements aside.
public final class AXReader {
    /// A slow app must not stall the helper: every AX call on its elements gives up after this.
    static let messagingTimeout: Float = 1.0
    static let maxNodes = 4000
    /// What a web page may take of them: a browser lists its toolbar after the page, and it must still be read.
    static let pageNodes = 3500

    static func cap(onPage: Bool) -> Int { onPage ? pageNodes : maxNodes }
    static let maxDepth = 64

    private(set) var elements: [AXUIElement] = []

    public init() {}

    static func application(_ pid: pid_t) -> AXUIElement {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, messagingTimeout)
        return app
    }

    /// The focused window, else the main window, else the first one; `nil` when the app has none.
    static func targetWindow(of app: AXUIElement) -> AXUIElement? {
        if let focused: AXUIElement = attribute(app, kAXFocusedWindowAttribute) { return focused }
        if let main: AXUIElement = attribute(app, kAXMainWindowAttribute) { return main }
        let windows: [AXUIElement]? = attribute(app, kAXWindowsAttribute)
        return windows?.first
    }

    func snapshot(_ root: AXUIElement) -> NodeSnapshot {
        read(root, depth: 0)
    }

    /// The element with keyboard focus when it is not part of the window just read and belongs to no other
    /// window: Finder edits a file name in a field that hangs off the application itself.
    func strayFocus(of app: AXUIElement, besides window: AXUIElement) -> NodeSnapshot? {
        guard let focused: AXUIElement = Self.attribute(app, kAXFocusedUIElementAttribute),
              !elements.contains(where: { CFEqual($0, focused) }) else { return nil }
        if let owner: AXUIElement = Self.attribute(focused, kAXWindowAttribute), !CFEqual(owner, window) { return nil }
        return read(focused, depth: Self.maxDepth)
    }

    /// Everything a snapshot needs of one element except its value and actions, asked for in one message:
    /// a window of 500 elements is thousands of messages when each attribute is asked for on its own.
    private static let batch: [String] = [
        kAXRoleAttribute, kAXSubroleAttribute, kAXChildrenAttribute, kAXRoleDescriptionAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
        kAXPlaceholderValueAttribute, kAXIdentifierAttribute, kAXEnabledAttribute, kAXFocusedAttribute, kAXSelectedAttribute, kAXExpandedAttribute,
        kAXPositionAttribute, kAXSizeAttribute,
    ]

    /// The values of `names`, in order; `nil` for an attribute the element does not have, and for all of them
    /// when the element does not answer.
    static func attributes(_ element: AXUIElement, _ names: [String]) -> [CFTypeRef?] {
        var values: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(element, names as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values) == .success,
              let found = values as? [CFTypeRef], found.count == names.count else { return names.map { _ in nil } }
        return found.map { value in
            // A missing attribute comes back as an error value in its place.
            if CFGetTypeID(value) == AXValueGetTypeID(), AXValueGetType(value as! AXValue) == .axError { return nil }
            return CFGetTypeID(value) == CFNullGetTypeID() ? nil : value
        }
    }

    private static func rect(_ position: CFTypeRef?, _ size: CFTypeRef?) -> CGRect? {
        var origin = CGPoint.zero
        var extent = CGSize.zero
        guard let position, let size, CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID(),
              AXValueGetValue(position as! AXValue, .cgPoint, &origin), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
        return CGRect(origin: origin, size: extent)
    }

    private func read(_ element: AXUIElement, depth: Int, onPage: Bool = false) -> NodeSnapshot {
        let handle = elements.count
        elements.append(element)
        let found = Self.attributes(element, Self.batch)
        let subrole = found[1] as? String
        let secure = subrole == (kAXSecureTextFieldSubrole as String)
        var children: [NodeSnapshot] = []
        if depth < Self.maxDepth {
            let kids = found[2] as? [AXUIElement] ?? []
            let inside = onPage || found[0] as? String == "AXWebArea"
            for kid in kids where elements.count < Self.cap(onPage: inside) { children.append(read(kid, depth: depth + 1, onPage: inside)) }
        }
        return NodeSnapshot(
            role: found[0] as? String ?? "AXUnknown",
            roleDescription: found[3] as? String,
            title: found[4] as? String,
            description: found[5] as? String,
            placeholder: found[6] as? String,
            identifier: found[7] as? String,
            // Password fields are never read, not even to be dropped later.
            value: secure ? nil : Self.valueText(element),
            secure: secure,
            enabled: found[8] as? Bool ?? true,
            focused: found[9] as? Bool ?? false,
            selected: found[10] as? Bool ?? false,
            expanded: found[11] as? Bool,
            actions: Self.actions(element),
            handle: handle,
            children: children,
            frame: Self.rect(found[12], found[13])
        )
    }

    /// The `nth` live element under `root` that reads as `sign`, found without reading past it: a list keeps
    /// the rows it does not show only until the reader moves on.
    /// Returned with what contains it, nearest first: such a row's content does not name its parent either.
    static func find(_ sign: ElementSign, nth: Int, under root: AXUIElement) -> [AXUIElement]? {
        var left = nth
        var visited = 0
        func search(_ element: AXUIElement, depth: Int) -> [AXUIElement]? {
            visited += 1
            guard visited <= maxNodes, depth <= maxDepth else { return nil }
            let found = attributes(element, [kAXChildrenAttribute, kAXRoleDescriptionAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXRoleAttribute, kAXValueAttribute])
            let role = (found[1] as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() }
            let reads = { (text: CFTypeRef?) -> String? in (text as? String).flatMap { $0.isEmpty ? nil : $0 } }
            if !TreeBuilder.hidden.contains(found[4] as? String ?? ""), role == nil || role == sign.role,
               // A static text is listed under its value.
               reads(found[2]) == sign.title || (sign.title != nil && reads(found[5]) == sign.title), reads(found[3]) == sign.description {
                if left == 0 { return [element] }
                left -= 1
            }
            for kid in found[0] as? [AXUIElement] ?? [] {
                if let match = search(kid, depth: depth + 1) { return match + [element] }
            }
            return nil
        }
        return search(root, depth: 0)
    }

    static func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value else { return nil }
        return value as? T
    }

    static func frame(_ element: AXUIElement) -> CGRect? {
        var position = CGPoint.zero
        var size = CGSize.zero
        guard let positionValue = axValue(element, kAXPositionAttribute), AXValueGetValue(positionValue, .cgPoint, &position),
              let sizeValue = axValue(element, kAXSizeAttribute), AXValueGetValue(sizeValue, .cgSize, &size)
        else { return nil }
        return CGRect(origin: position, size: size)
    }

    /// How big a scroll area's content is: AppKit reports it directly, others through their content element.
    static func contentSize(of area: AXUIElement) -> CGSize? {
        var size = CGSize.zero
        if let value = axValue(area, "AXContentSize"), AXValueGetValue(value, .cgSize, &size) { return size }
        let contents: [AXUIElement]? = attribute(area, kAXContentsAttribute)
        return contents?.first.flatMap(frame)?.size
    }

    private static func axValue(_ element: AXUIElement, _ name: String) -> AXValue? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value,
              CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        return (value as! AXValue)
    }

    static func valueText(_ element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success, let value else { return nil }
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    /// The app's own element at a screen point, whatever window covers it.
    static func element(at point: CGPoint, pid: pid_t?) -> AXUIElement? {
        guard let pid else { return nil }
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(application(pid), Float(point.x), Float(point.y), &element) == .success, let element else { return nil }
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        return element
    }

    static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]

    /// Whether typed text would land in this element rather than somewhere else in the app.
    static func takesText(_ element: AXUIElement) -> Bool {
        if let role: String = attribute(element, kAXRoleAttribute), textRoles.contains(role) { return true }
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable) == .success && settable.boolValue
    }

    /// The element and its containers up to the window, nearest first.
    static func identifier(_ element: AXUIElement) -> String? { attribute(element, "AXIdentifier") }

    /// The first element at most `depth` levels below `element` with this identifier.
    static func descendant(of element: AXUIElement, identifier: String, depth: Int = 4) -> AXUIElement? {
        guard depth > 0 else { return nil }
        for child in (attribute(element, kAXChildrenAttribute) as [AXUIElement]?) ?? [] {
            if self.identifier(child) == identifier { return child }
            if let found = descendant(of: child, identifier: identifier, depth: depth - 1) { return found }
        }
        return nil
    }

    static func lineage(_ element: AXUIElement, limit: Int = 12) -> [AXUIElement] {
        var chain = [element]
        while chain.count < limit, let parent: AXUIElement = attribute(chain[chain.count - 1], kAXParentAttribute) {
            if attribute(parent, kAXRoleAttribute) == (kAXApplicationRole as String) { break }
            chain.append(parent)
        }
        return chain
    }

    /// The scroll area an element sits in, whose size is one page of scrolling.
    static func scrollArea(around element: AXUIElement) -> AXUIElement? {
        lineage(element).first { attribute($0, kAXRoleAttribute) == (kAXScrollAreaRole as String) }
    }

    static func actions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success, let names = names as? [String] else { return [] }
        return names
    }
}
