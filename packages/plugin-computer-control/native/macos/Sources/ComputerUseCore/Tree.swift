import CoreGraphics

/// One accessibility element as read from the system, before pruning. `handle` points into the
/// reader's element table so actions can reach the live element later.
public struct NodeSnapshot: Sendable, Equatable {
    public var role: String
    public var roleDescription: String?
    public var title: String?
    public var description: String?
    public var placeholder: String?
    public var identifier: String?
    /// Never read for secure fields.
    public var value: String?
    public var secure: Bool
    public var enabled: Bool
    public var focused: Bool
    public var selected: Bool
    public var expanded: Bool?
    public var actions: [String]
    public var handle: Int
    public var children: [NodeSnapshot]
    /// Global screen points, top-left origin.
    public var frame: CGRect? = nil
}

/// An element as the model sees it (see `appTreeSchema` in `src/contract/tree.ts`), minus its index.
public struct TreeElement: Sendable, Equatable {
    public let key: String
    public let depth: Int
    public let role: String
    public let title: String?
    public let description: String?
    public let value: String?
    public let secure: Bool
    public let states: [String]
    public let actions: [String]
    public let handle: Int
    public let frame: CGRect?
}

public enum TreeBuilder {
    /// Containers that only lay things out; listed only when they carry a name, value or action.
    static let structural: Set<String> = ["AXGroup", "AXSplitGroup", "AXScrollArea", "AXLayoutArea", "AXLayoutItem", "AXUnknown", "AXGenericElement"]
    /// Parts of other controls the model never needs.
    static let hidden: Set<String> = ["AXScrollBar", "AXValueIndicator", "AXGrowArea"]
    /// Actions every clickable element has; the click tools cover them.
    static let implicitActions: Set<String> = ["AXPress", "AXScrollToVisible", "AXShowDefaultUI", "AXShowAlternateUI"]
    static let toggles: Set<String> = ["AXCheckBox", "AXRadioButton", "AXSwitch"]
    /// Web content answers "not expanded" and an empty value for everything; only these roles mean it.
    static let disclosing: Set<String> = ["AXDisclosureTriangle", "AXRow", "AXOutline", "AXPopUpButton", "AXComboBox", "AXMenuButton", "AXButton", "AXCell"]
    static let entries: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

    public static func build(_ root: NodeSnapshot, limit: Int) -> (elements: [TreeElement], truncated: Bool) {
        var output: [TreeElement] = []
        var truncated = false

        func visit(_ node: NodeSnapshot, depth: Int, parentKey: String?, siblings: inout [String: Int]) {
            guard !hidden.contains(node.role) else { return }
            if isPlain(node) {
                for child in node.children { visit(child, depth: depth, parentKey: parentKey, siblings: &siblings) }
                return
            }
            guard output.count < limit else { truncated = true; return }
            let role = roleName(node)
            let key = uniqueKey(parentKey, role: role, node: node, siblings: &siblings)
            output.append(element(node, key: key, role: role, depth: depth))
            var children: [String: Int] = [:]
            for child in node.children { visit(child, depth: depth + 1, parentKey: key, siblings: &children) }
        }

        var roots: [String: Int] = [:]
        visit(root, depth: 0, parentKey: nil, siblings: &roots)
        return (output, truncated)
    }

    static func isPlain(_ node: NodeSnapshot) -> Bool {
        structural.contains(node.role) && nonEmpty(node.title) == nil && nonEmpty(node.description) == nil
            && nonEmpty(node.value) == nil && explicitActions(node).isEmpty && !node.focused && !node.selected
    }

    static func roleName(_ node: NodeSnapshot) -> String {
        if let description = nonEmpty(node.roleDescription) { return description.lowercased() }
        let bare = node.role.hasPrefix("AX") ? String(node.role.dropFirst(2)) : node.role
        return bare.lowercased()
    }

    /// Identity survives value changes: identifier, else a real title, else position among same-role siblings.
    static func uniqueKey(_ parent: String?, role: String, node: NodeSnapshot, siblings: inout [String: Int]) -> String {
        let ordinal = (siblings["#" + role] ?? 0) + 1
        siblings["#" + role] = ordinal
        let discriminator = nonEmpty(node.identifier) ?? nonEmpty(node.title) ?? "#\(ordinal)"
        let base = (parent.map { $0 + "/" } ?? "") + "\(role):\(discriminator)"
        let seen = (siblings[base] ?? 0) + 1
        siblings[base] = seen
        return seen == 1 ? base : "\(base)~\(seen)"
    }

    static func element(_ node: NodeSnapshot, key: String, role: String, depth: Int) -> TreeElement {
        let isText = node.role == "AXStaticText"
        let isToggle = toggles.contains(node.role)
        var states: [String] = []
        if node.focused { states.append("focused") }
        if node.selected { states.append("selected") }
        if isToggle && node.value == "1" { states.append("checked") }
        if let expanded = node.expanded, expanded || disclosing.contains(node.role) { states.append(expanded ? "expanded" : "collapsed") }
        if !node.enabled { states.append("disabled") }
        let placeholder = nonEmpty(node.placeholder).map { "placeholder: \($0)" }
        return TreeElement(
            key: key, depth: depth, role: role,
            // Static text carries its words in the value; show them as the title.
            title: nonEmpty(node.title) ?? (isText ? nonEmpty(node.value) : nil),
            description: nonEmpty(node.description) ?? placeholder,
            value: node.secure || isText || isToggle ? nil : (entries.contains(node.role) ? node.value : nonEmpty(node.value)),
            secure: node.secure, states: states, actions: explicitActions(node), handle: node.handle, frame: node.frame
        )
    }

    static func explicitActions(_ node: NodeSnapshot) -> [String] { node.actions.filter { !implicitActions.contains($0) }.map(actionLabel) }

    /// A custom action arrives as "Name:…\nTarget:…\nSelector:…"; the tree shows its name only.
    static func actionLabel(_ raw: String) -> String {
        guard raw.hasPrefix("Name:"), let line = raw.split(separator: "\n").first else { return raw }
        return String(line.dropFirst("Name:".count))
    }

    /// The action of an element that the tree showed under `name`.
    static func action(named name: String, in actions: [String]) -> String? {
        actions.first { $0 == name || actionLabel($0) == name }
    }

    static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}

/// Element indices for one target: an index lives as long as its key and is never handed to another element.
public struct IndexRegistry: Sendable {
    private var indices: [String: Int] = [:]
    private var next = 0

    public init() {}

    public mutating func assign(_ keys: [String]) -> [Int] {
        var current: [String: Int] = [:]
        let assigned = keys.map { key -> Int in
            if let index = indices[key] { current[key] = index; return index }
            let index = next
            next += 1
            current[key] = index
            return index
        }
        indices = current
        return assigned
    }
}
