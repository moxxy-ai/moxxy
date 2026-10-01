import ApplicationServices

/// Reads one window's accessibility tree into plain snapshots, keeping the live elements aside.
public final class AXReader {
    /// A slow app must not stall the helper: every AX call on its elements gives up after this.
    static let messagingTimeout: Float = 1.0
    static let maxNodes = 4000
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

    private func read(_ element: AXUIElement, depth: Int) -> NodeSnapshot {
        let handle = elements.count
        elements.append(element)
        let role: String = Self.attribute(element, kAXRoleAttribute) ?? "AXUnknown"
        let subrole: String? = Self.attribute(element, kAXSubroleAttribute)
        let secure = subrole == (kAXSecureTextFieldSubrole as String)
        var children: [NodeSnapshot] = []
        if depth < Self.maxDepth {
            let kids: [AXUIElement] = Self.attribute(element, kAXChildrenAttribute) ?? []
            for kid in kids where elements.count < Self.maxNodes { children.append(read(kid, depth: depth + 1)) }
        }
        return NodeSnapshot(
            role: role,
            roleDescription: Self.attribute(element, kAXRoleDescriptionAttribute),
            title: Self.attribute(element, kAXTitleAttribute),
            description: Self.attribute(element, kAXDescriptionAttribute),
            placeholder: Self.attribute(element, kAXPlaceholderValueAttribute),
            identifier: Self.attribute(element, kAXIdentifierAttribute),
            // Password fields are never read, not even to be dropped later.
            value: secure ? nil : Self.valueText(element),
            secure: secure,
            enabled: Self.attribute(element, kAXEnabledAttribute) ?? true,
            focused: Self.attribute(element, kAXFocusedAttribute) ?? false,
            selected: Self.attribute(element, kAXSelectedAttribute) ?? false,
            expanded: Self.attribute(element, kAXExpandedAttribute),
            actions: Self.actions(element),
            handle: handle,
            children: children,
            frame: Self.frame(element)
        )
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
