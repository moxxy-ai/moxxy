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

extension NodeSnapshot {
    /// This window with one more element listed under it (see `AXReader.strayFocus`).
    public func adopting(_ stray: NodeSnapshot?) -> NodeSnapshot {
        guard let stray else { return self }
        var copy = self
        copy.children.append(stray)
        return copy
    }
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

        /// `said` is what the nearest listed ancestor already shows as its name.
        func visit(_ node: NodeSnapshot, depth: Int, parentKey: String?, siblings: inout [String: Int], web: Bool, said: [String]) {
            guard !hidden.contains(node.role) else { return }
            if isPlain(node, web: web) || (web && repeats(node, said)) {
                for child in node.children { visit(child, depth: depth, parentKey: parentKey, siblings: &siblings, web: web, said: said) }
                return
            }
            guard output.count < limit else { truncated = true; return }
            let role = roleName(node)
            let key = uniqueKey(parentKey, role: role, node: node, siblings: &siblings)
            let listed = element(node, key: key, role: role, depth: depth, web: web)
            output.append(listed)
            var children: [String: Int] = [:]
            let inside = web || node.role == "AXWebArea"
            for child in node.children {
                visit(child, depth: depth + 1, parentKey: key, siblings: &children, web: inside, said: [listed.title, listed.description].compactMap { $0 })
            }
        }

        var roots: [String: Int] = [:]
        visit(root, depth: 0, parentKey: nil, siblings: &roots, web: false, said: [])
        return (output, truncated)
    }

    static func isPlain(_ node: NodeSnapshot, web: Bool = false) -> Bool {
        structural.contains(node.role) && nonEmpty(node.title) == nil && nonEmpty(node.description) == nil
            && nonEmpty(node.value) == nil && explicitActions(node, web: web).isEmpty && !node.focused && !node.selected
    }

    /// On a web page a link wraps a link that wraps its own words. A node that only says what its
    /// parent already shows adds a line and nothing else; its children are listed under the parent.
    static func repeats(_ node: NodeSnapshot, _ said: [String]) -> Bool {
        guard ["AXStaticText", "AXLink", "AXGroup"].contains(node.role), !node.focused, !node.selected, explicitActions(node, web: true).isEmpty else { return false }
        let trimmed = { (text: String) in text.trimmingCharacters(in: .whitespacesAndNewlines) }
        let own = [node.title, node.description, node.value].compactMap(nonEmpty).map(trimmed)
        return !own.isEmpty && own.allSatisfy(said.map(trimmed).contains)
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
        // A title can be a whole paragraph on a web page; its start is enough to tell siblings apart.
        let discriminator = (nonEmpty(node.identifier) ?? nonEmpty(node.title))?.fitting(64) ?? "#\(ordinal)"
        let base = (parent.map { $0 + "/" } ?? "") + "\(role):\(discriminator)"
        let seen = (siblings[base] ?? 0) + 1
        siblings[base] = seen
        return seen == 1 ? base : "\(base)~\(seen)"
    }

    static func element(_ node: NodeSnapshot, key: String, role: String, depth: Int, web: Bool = false) -> TreeElement {
        let isText = node.role == "AXStaticText"
        let isToggle = toggles.contains(node.role)
        var states: [String] = []
        if node.focused { states.append("focused") }
        if node.selected { states.append("selected") }
        if isToggle && node.value == "1" { states.append("checked") }
        if let expanded = node.expanded, expanded || disclosing.contains(node.role) { states.append(expanded ? "expanded" : "collapsed") }
        if !node.enabled { states.append("disabled") }
        let placeholder = nonEmpty(node.placeholder).map { "placeholder: \($0)" }
        let title = nonEmpty(node.title) ?? (isText ? nonEmpty(node.value) : nil)
        return TreeElement(
            key: key, depth: depth, role: role,
            // Static text carries its words in the value; show them as the title.
            title: title,
            // A description that repeats the title says nothing.
            description: (nonEmpty(node.description) ?? placeholder).flatMap { $0 == title ? nil : $0 },
            value: node.secure || isText || isToggle ? nil : (entries.contains(node.role) ? node.value : nonEmpty(node.value)),
            secure: node.secure, states: states, actions: explicitActions(node, web: web), handle: node.handle, frame: node.frame
        )
    }

    /// Every element of a web page offers its context menu; a right click opens it, so it is not listed there.
    static func explicitActions(_ node: NodeSnapshot, web: Bool = false) -> [String] {
        node.actions.filter { !implicitActions.contains($0) && !(web && $0 == "AXShowMenu") }.map(actionLabel)
    }

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

extension String {
    /// The longest run of whole characters within `units` UTF-16 code units, which is what the contract counts.
    func fitting(_ units: Int, fromEnd: Bool = false) -> String {
        guard utf16.count > units else { return self }
        var used = 0
        var kept: [Character] = []
        for character in (fromEnd ? Array(reversed()) : Array(self)) {
            let size = character.utf16.count
            if used + size > units { break }
            used += size
            kept.append(character)
        }
        return String(fromEnd ? kept.reversed() : kept)
    }
}

/// An element key as the contract takes it: at most 512 units and still unique on a deep page.
enum WireKey {
    static let limit = 512

    /// A key that is too long keeps its readable end behind a hash of the whole path.
    static func of(_ key: String) -> String {
        guard key.utf16.count > limit else { return key }
        let hash = key.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        let head = "~" + String(hash, radix: 16) + "/"
        return head + key.fitting(limit - head.utf16.count, fromEnd: true)
    }
}
