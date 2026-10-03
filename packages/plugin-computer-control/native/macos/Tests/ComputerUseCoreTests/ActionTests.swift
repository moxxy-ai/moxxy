import ApplicationServices
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct ActionRequestTests {
    private func parse(_ fields: [String: JSONValue]) throws -> ActionRequest { try ActionRequest.parse(.object(fields)) }

    @Test func readsAClickOnAnElementOrAPoint() throws {
        #expect(try parse(["action": .string("click"), "element_index": .number(3), "mouse_button": .string("left"), "click_count": .number(1)])
            == .click(target: .element(3), button: .left, count: 1, modifiers: []))
        #expect(try parse(["action": .string("click"), "x": .number(10.5), "y": .number(20), "mouse_button": .string("right"), "click_count": .number(2),
                           "modifiers": .string("shift"), "held": .array([.string("shift")])])
            == .click(target: .point(CGPoint(x: 10.5, y: 20)), button: .right, count: 2, modifiers: .maskShift))
    }

    @Test func readsElementActions() throws {
        #expect(try parse(["action": .string("set_value"), "element_index": .number(1), "value": .string("world")]) == .setValue(element: 1, value: "world"))
        #expect(try parse(["action": .string("perform_secondary_action"), "element_index": .number(2), "secondary_action": .string("AXIncrement")])
            == .secondary(element: 2, name: "AXIncrement"))
    }

    @Test func refusesMalformedStepsAndNamesTheOnesNotYetDone() throws {
        #expect(throws: HelperError.self) { try parse(["action": .string("click"), "mouse_button": .string("left"), "click_count": .number(1)]) }
        #expect(throws: HelperError.self) { try parse(["action": .string("click"), "element_index": .number(-1), "mouse_button": .string("left"), "click_count": .number(1)]) }
        #expect(throws: HelperError.self) { try parse(["action": .string("set_value"), "element_index": .number(1)]) }
        #expect(throws: HelperError.self) { try ActionRequest.parse(.string("click")) }
        #expect(try parse(["action": .string("teleport")]) == .notYetSupported("teleport"))
    }
}

@Suite struct AXLadderTests {
    @Test func pressesThroughAccessibilityOnlyWhenTheElementOffersIt() {
        #expect(AXLadder.click(button: .left, count: 1, modifiers: false, actions: ["AXPress"]) == .axAction("AXPress"))
        #expect(AXLadder.click(button: .right, count: 1, modifiers: false, actions: ["AXPress", "AXShowMenu"]) == .axAction("AXShowMenu"))
        #expect(AXLadder.click(button: .left, count: 1, modifiers: false, actions: []) == .physical)
        // A plain click on the text, picture or cell of a list row selects the row: that needs no pointer,
        // and works for a row scrolled out of view.
        #expect(AXLadder.selectsRow(role: "AXStaticText", button: .left, count: 1, modifiers: false))
        #expect(AXLadder.selectsRow(role: "AXCell", button: .left, count: 1, modifiers: false))
        #expect(!AXLadder.selectsRow(role: "AXButton", button: .left, count: 1, modifiers: false))
        #expect(!AXLadder.selectsRow(role: "AXTextField", button: .left, count: 1, modifiers: false))
        #expect(!AXLadder.selectsRow(role: "AXStaticText", button: .left, count: 2, modifiers: false))
        #expect(!AXLadder.selectsRow(role: "AXStaticText", button: .right, count: 1, modifiers: false))
        #expect(!AXLadder.selectsRow(role: "AXStaticText", button: .left, count: 1, modifiers: true))
        // A source list (Finder's sidebar) opens a place on one click; selecting its row would only highlight it.
        // The cell says so itself. A file row's cell does not: there one click selects.
        // Finder with no window open is observed through its desktop, which is no window to bring forward:
        // the app alone comes forward, as for an app with nothing open.
        #expect(Foreground.comesForward(rootRole: "AXWindow"))
        #expect(!Foreground.comesForward(rootRole: "AXScrollArea"))
        #expect(AXLadder.opensRow(cellActions: ["AXOpen"]))
        #expect(!AXLadder.opensRow(cellActions: []))
        // The user watches the cursor travel to a row they can see; a row found again off screen is gone before a glide ends.
        #expect(AXLadder.cursorTravels(toRowFoundAgain: false))
        #expect(!AXLadder.cursorTravels(toRowFoundAgain: true))
        #expect(AXLadder.click(button: .left, count: 2, modifiers: false, actions: ["AXPress"]) == .physical)
        #expect(AXLadder.click(button: .left, count: 1, modifiers: true, actions: ["AXPress"]) == .physical)
        #expect(AXLadder.click(button: .middle, count: 1, modifiers: false, actions: ["AXPress"]) == .physical)
    }

    @Test func fallsBackOnlyWhenAccessibilityDeclinesAndRefusesEverythingUnknown() {
        #expect(AXLadder.outcome(.success) == .done)
        #expect(AXLadder.outcome(.actionUnsupported) == .fallBack)
        #expect(AXLadder.outcome(.attributeUnsupported) == .fallBack)
        #expect(AXLadder.outcome(.invalidUIElement) == .refused("stale_state"))
        // The app did not answer in time; the action may or may not have happened, so it is never repeated.
        #expect(AXLadder.outcome(.cannotComplete) == .refused("timeout"))
        #expect(AXLadder.outcome(.apiDisabled) == .refused("permissions_not_granted"))
        #expect(AXLadder.outcome(.failure) == .refused("helper_failed"))
        #expect(AXLadder.outcome(.illegalArgument) == .refused("helper_failed"))
    }
}

@Suite struct ActionResultTests {
    @Test func encodesTheSharedActionResult() {
        #expect(ActionResult.delivered(.ax).json == .object(["outcome": .string("delivered"), "method": .string("ax")]))
        #expect(ActionResult.blocked("stale_state").json == .object(["outcome": .string("blocked"), "code": .string("stale_state")]))
        #expect(ActionResult.unsupported("unsupported_action").json == .object(["outcome": .string("unsupported"), "code": .string("unsupported_action")]))
    }

    // The click went through; the host must still hear that its page has not come yet.
    @Test func aFollowedLinkWhosePageIsNotThereYetStaysDelivered() {
        #expect(ActionResult.stillLoading(.delivered(.background)).json
            == .object(["outcome": .string("delivered"), "code": .string("page_loading"), "method": .string("background")]))
    }
}

@Suite struct RepeatKeyTests {
    private let frames: [Int: CGRect] = [7: CGRect(x: 100, y: 100, width: 80, height: 30), 9: CGRect(x: 300, y: 100, width: 80, height: 30)]
    private func key(_ request: ActionRequest) -> String { RepeatKey.of(request) { FrameHit.index(at: $0, in: frames) } }
    private func click(_ target: ActionTarget) -> ActionRequest { .click(target: target, button: .left, count: 1, modifiers: []) }

    @Test func aClickOnTheSameControlIsTheSameAttemptHoweverItWasAimed() {
        #expect(key(click(.element(7))) == key(click(.point(CGPoint(x: 120, y: 110)))))
        #expect(key(click(.point(CGPoint(x: 120, y: 110)))) == key(click(.point(CGPoint(x: 123, y: 112)))))
        #expect(key(click(.element(7))) != key(click(.element(9))))
        #expect(key(click(.element(7))) != key(.click(target: .element(7), button: .right, count: 1, modifiers: [])))
    }

    @Test func aPointOnNoControlAndOtherActionsRepeatOnlyWhenIdentical() {
        #expect(key(click(.point(CGPoint(x: 10, y: 10)))) == key(click(.point(CGPoint(x: 10, y: 10)))))
        #expect(key(click(.point(CGPoint(x: 10, y: 10)))) != key(click(.point(CGPoint(x: 11, y: 10)))))
        #expect(key(.setValue(element: 7, value: "a")) != key(.setValue(element: 7, value: "b")))
    }
}

/// An app can replace the elements it handed out (a list does so for rows it does not show).
@Suite struct ReviveTests {
    private func element(_ role: String, _ title: String?, _ description: String? = nil) -> TreeElement {
        TreeElement(key: UUID().uuidString, depth: 1, role: role, title: title, description: description, value: nil, secure: false, states: [], actions: [], handle: 0, frame: nil)
    }

    @Test func namesAnElementByWhatItReadsAndWhichOfItsKindItIs() {
        let signs = Revive.signs([element("text", "General"), element("button", "General"), element("text", "Sound"), element("text", "General")])
        #expect(signs.map(\.nth) == [0, 0, 0, 1])
        #expect(signs[0].sign == ElementSign(role: "text", title: "General", description: nil))
        #expect(signs[0].sign == signs[3].sign)
        #expect(signs[0].sign != signs[1].sign)
    }
}
