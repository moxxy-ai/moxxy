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
}
