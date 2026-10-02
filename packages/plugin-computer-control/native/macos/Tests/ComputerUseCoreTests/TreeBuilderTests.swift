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

    // Safari lists its toolbar after the page: on a long page the cut must fall on the page, not on the toolbar.
    @Test func cutsALongPageAndKeepsTheWindowsOwnControls() {
        let page = node("AXWebArea", "Article", children: (0..<10).map { node("AXLink", "Link \($0)") })
        let browser = node("AXWindow", "Browser", children: [page, node("AXToolbar", children: [node("AXButton", "Back")])])
        let tree = TreeBuilder.build(browser, limit: 6)
        #expect(tree.truncated)
        #expect(tree.elements.map(\.title) == ["Browser", "Article", "Link 0", "Link 1", nil, "Back"])
        // The same holds while reading: the page may not use up every node the reader takes.
        #expect(AXReader.cap(onPage: true) < AXReader.cap(onPage: false))
    }

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

@Suite struct WebContentTreeTests {
    // WebKit answers "not expanded" and an empty value for every element, and names custom actions on three lines.
    private let custom = "Name:Remove from Toolbar\nTarget:0x0\nSelector:(null)"

    @Test func leavesOutStatesAndValuesThatSayNothing() {
        let page = node("AXWindow", "Page", children: [
            node("AXHeading", "Example Domain", value: "", expanded: false),
            node("AXStaticText", value: "This domain", expanded: false),
            node("AXTextField", "Search", value: "", expanded: false),
            node("AXPopUpButton", "Size", value: "Small", expanded: false),
        ])
        let elements = TreeBuilder.build(page, limit: 100).elements
        #expect(elements.map(\.states) == [[], [], [], [], ["collapsed"]])
        #expect(elements.map(\.value) == [nil, nil, nil, "", "Small"])
    }

    @Test func showsACustomActionByItsNameAndFindsItAgain() {
        let button = node("AXButton", "Share", actions: ["AXPress", "AXShowMenu", custom])
        #expect(TreeBuilder.explicitActions(button) == ["AXShowMenu", "Remove from Toolbar"])
        #expect(TreeBuilder.action(named: "Remove from Toolbar", in: button.actions) == custom)
        #expect(TreeBuilder.action(named: "AXShowMenu", in: button.actions) == "AXShowMenu")
        #expect(TreeBuilder.action(named: "AXDelete", in: button.actions) == nil)
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

@Suite struct StrayFocusTests {
    @Test func aFocusedFieldOutsideTheWindowIsListedWithIt() {
        // Finder edits a file name in a field that hangs off the application, not the window.
        let rename = node("AXTextField", value: "untitled folder", roleDescription: "text field", focused: true)
        let listed = TreeBuilder.build(window.adopting(rename), limit: 100).elements
        #expect(listed.contains { $0.value == "untitled folder" && $0.states.contains("focused") })
        #expect(TreeBuilder.build(window.adopting(nil), limit: 100).elements.count == TreeBuilder.build(window, limit: 100).elements.count)
    }
}

/// The contract counts UTF-16 units and wants every key unique; a deep web page breaks both when text is cut naively.
@Suite struct WireLimitTests {
    private func element(_ key: String, title: String? = nil) -> TreeElement {
        TreeElement(key: key, depth: 90, role: "link", title: title, description: nil, value: nil, secure: false,
                    states: [], actions: [], handle: 0, frame: nil)
    }
    private func key(_ element: TreeElement) -> String { Methods.json(element, index: 0, frame: nil)["key"]?.stringValue ?? "" }

    @Test func keepsLongKeysApartAndInsideTheLimit() {
        let path = String(repeating: "group:#1/", count: 80)
        let first = key(element(path + "link:Film 🔥 jeden")), second = key(element(path + "link:Film 🔥 dwa"))
        #expect(first != second)
        #expect(first.utf16.count <= 512 && second.utf16.count <= 512)
        #expect(first.hasSuffix("link:Film 🔥 jeden"))
        #expect(key(element("window/button:Press")) == "window/button:Press")
        #expect(key(element(path + "link:Film 🔥 jeden")) == first)
    }

    @Test func countsTextInUTF16UnitsWithoutSplittingACharacter() {
        let cut = String(repeating: "🔥", count: 6000).fitting(10_000)
        #expect(cut.utf16.count == 10_000)
        #expect(cut.allSatisfy { $0 == "🔥" })
        #expect("zażółć".fitting(3) == "zaż")
        let title = Methods.json(element("k", title: String(repeating: "🇵🇱", count: 4000)), index: 0, frame: nil)["title"]?.stringValue ?? ""
        #expect(title.utf16.count <= 10_000 && !title.isEmpty)
    }
}

/// A web page repeats itself through accessibility: every element offers a context menu, links wrap a
/// link that wraps their own words, and empty groups pad the tree. None of it helps the model.
@Suite struct WebTreeTests {
    private func web(_ role: String, _ title: String? = nil, description: String? = nil, value: String? = nil,
                     actions: [String] = ["AXShowMenu"], children: [NodeSnapshot] = []) -> NodeSnapshot {
        NodeSnapshot(role: role, roleDescription: nil, title: title, description: description, placeholder: nil, identifier: nil,
                     value: value, secure: false, enabled: true, focused: false, selected: false, expanded: nil,
                     actions: actions, handle: 0, children: children)
    }

    private func page(_ children: [NodeSnapshot]) -> [TreeElement] {
        let window = web("AXWindow", "Page", actions: [], children: [
            web("AXPopUpButton", "Zoom", actions: ["AXPress", "AXShowMenu"]),
            web("AXWebArea", description: "Page", children: children),
        ])
        return TreeBuilder.build(window, limit: 100).elements
    }

    @Test func leavesOutTheContextMenuEveryWebElementOffersAndTheEmptyGroupsItKeptAlive() {
        let elements = page([web("AXGroup"), web("AXGroup", children: [web("AXButton", "Search", actions: ["AXPress", "AXShowMenu"])])])
        #expect(elements.map(\.role) == ["window", "popupbutton", "webarea", "button"])
        #expect(elements[3].actions == [])
        // Outside the page a menu is still something the model can open.
        #expect(elements[1].actions == ["AXShowMenu"])
    }

    @Test func showsALinkOnceInsteadOfThreeTimes() {
        let link = web("AXLink", description: "Shorts", children: [web("AXLink", "Shorts", children: [web("AXStaticText", value: " Shorts")])])
        let elements = page([link])
        #expect(elements.map(\.role) == ["window", "popupbutton", "webarea", "link"])
        #expect(elements[3].description == "Shorts")
    }

    @Test func keepsWhatSaysSomethingNew() {
        let link = web("AXLink", "Video", children: [web("AXStaticText", value: "4 hours ago"), web("AXLink", "Channel")])
        let elements = page([link, web("AXHeading", "Latest", description: "Latest")])
        #expect(elements.map(\.role) == ["window", "popupbutton", "webarea", "link", "statictext", "link", "heading"])
        #expect(elements[6].description == nil)
    }
}
