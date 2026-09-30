import Testing
@testable import ComputerUseCore

private func node(_ role: String, _ title: String? = nil, identifier: String? = nil, value: String? = nil, secure: Bool = false,
                  roleDescription: String? = nil, actions: [String] = [], enabled: Bool = true, focused: Bool = false,
                  expanded: Bool? = nil, placeholder: String? = nil, children: [NodeSnapshot] = []) -> NodeSnapshot {
    NodeSnapshot(role: role, roleDescription: roleDescription, title: title, description: nil, placeholder: placeholder,
                 identifier: identifier, value: value, secure: secure, enabled: enabled, focused: focused, selected: false,
                 expanded: expanded, actions: actions, handle: 0, children: children)
}

private let window = node("AXWindow", "Moxxy Fixture", children: [
    node("AXGroup", children: [
        node("AXTextField", identifier: "name", value: "hello", roleDescription: "text field", focused: true, placeholder: "Name"),
        node("AXTextField", identifier: "secret", secure: true, roleDescription: "secure text field"),
        node("AXGroup", children: [
            node("AXButton", "Press", identifier: "press", roleDescription: "button", actions: ["AXPress"]),
            node("AXCheckBox", "Remember", value: "1", roleDescription: "check box", actions: ["AXPress"]),
            node("AXPopUpButton", value: "Small", roleDescription: "pop up button", actions: ["AXPress", "AXShowMenu"]),
            node("AXButton", "Disabled", roleDescription: "button", enabled: false),
        ]),
        node("AXStaticText", value: "Ready", roleDescription: "text"),
        node("AXScrollBar", roleDescription: "scroll bar", children: [node("AXValueIndicator")]),
    ]),
])

@Suite struct TreeBuilderTests {
    let elements = TreeBuilder.build(window, limit: 100).elements

    @Test func flattensPlainContainersAndDropsScrollBars() {
        #expect(elements.map(\.role) == ["window", "text field", "secure text field", "button", "check box", "pop up button", "button", "text"])
        #expect(elements.map(\.depth) == [0, 1, 1, 1, 1, 1, 1, 1])
    }

    @Test func readsTitlesValuesAndStates() {
        #expect(elements[1].value == "hello")
        #expect(elements[1].states == ["focused"])
        #expect(elements[1].description == "placeholder: Name")
        #expect(elements[4].states == ["checked"])
        #expect(elements[4].value == nil)
        #expect(elements[6].states == ["disabled"])
        #expect(elements[7].title == "Ready")
        #expect(elements[7].value == nil)
    }

    @Test func marksSecureFieldsWithoutAValue() {
        #expect(elements[2].secure)
        #expect(elements[2].value == nil)
    }

    @Test func listsOnlyActionsBeyondAPlainPress() {
        #expect(elements[3].actions == [])
        #expect(elements[5].actions == ["AXShowMenu"])
    }

    @Test func derivesKeysFromIdentifiersTitlesOrPosition() {
        #expect(elements.map(\.key) == [
            "window:Moxxy Fixture",
            "window:Moxxy Fixture/text field:name",
            "window:Moxxy Fixture/secure text field:secret",
            "window:Moxxy Fixture/button:press",
            "window:Moxxy Fixture/check box:Remember",
            "window:Moxxy Fixture/pop up button:#1",
            "window:Moxxy Fixture/button:Disabled",
            "window:Moxxy Fixture/text:#1",
        ])
    }

    @Test func keepsKeysUniqueWhenSiblingsLookAlike() {
        let twins = node("AXWindow", "W", children: [node("AXButton", "OK", actions: ["AXPress"]), node("AXButton", "OK", actions: ["AXPress"])])
        #expect(TreeBuilder.build(twins, limit: 10).elements.map(\.key) == ["window:W", "window:W/button:OK", "window:W/button:OK~2"])
    }

    @Test func truncatesAtTheLimit() {
        let tree = TreeBuilder.build(window, limit: 3)
        #expect(tree.elements.count == 3)
        #expect(tree.truncated)
        #expect(!TreeBuilder.build(window, limit: 100).truncated)
    }
}

@Suite struct IndexRegistryTests {
    @Test func keepsAnIndexWhileItsKeyLivesAndNeverReusesOne() {
        var registry = IndexRegistry()
        #expect(registry.assign(["a", "b", "c"]) == [0, 1, 2])
        #expect(registry.assign(["a", "c", "d"]) == [0, 2, 3])
        #expect(registry.assign(["b", "a"]) == [4, 0])
    }
}
