import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct SettleClockTests {
    // Binary-exact times keep the arithmetic out of the assertions.
    let policy = SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0)

    @Test func waitsTheMinimumAfterAnActionEvenWhenNothingHappens() {
        let clock = SettleClock(start: 0, policy: policy)
        #expect(!clock.isSettled(now: 0.9, busy: false))
        #expect(clock.isSettled(now: 1.0, busy: false))
    }

    @Test func returnsAtOnceWhenNothingWasDone() {
        let clock = SettleClock(start: 0, policy: SettlePolicy(minimum: 0, quiet: 0.25, maximum: 5.0))
        #expect(clock.isSettled(now: 0, busy: false))
    }

    @Test func waitsForAQuietPeriodAfterTheLastChange() {
        var clock = SettleClock(start: 0, policy: policy)
        clock.record(at: 0.875)
        #expect(!clock.isSettled(now: 1.0, busy: false))
        #expect(clock.isSettled(now: 1.125, busy: false))
    }

    @Test func keepsWaitingWhileTheAppShowsItIsBusy() {
        let clock = SettleClock(start: 0, policy: policy)
        #expect(!clock.isSettled(now: 3.0, busy: true))
        #expect(clock.isSettled(now: 3.0, busy: false))
    }

    @Test func neverWaitsPastTheMaximum() {
        var clock = SettleClock(start: 0, policy: policy)
        clock.record(at: 4.9)
        #expect(clock.isSettled(now: 5.0, busy: true))
    }

    @Test func nextCheckComesNoLaterThanTheNextDecisionPoint() {
        var clock = SettleClock(start: 0, policy: policy)
        #expect(clock.nextCheck(now: 0, busy: false) == 1.0)
        clock.record(at: 1.125)
        #expect(clock.nextCheck(now: 1.25, busy: false) == 1.375)
        #expect(clock.nextCheck(now: 1.25, busy: true) == 1.5)
        #expect(clock.nextCheck(now: 4.875, busy: true) == 5.0)
    }
}

@Suite struct BusyProbeTests {
    private func node(_ role: String, children: [NodeSnapshot] = []) -> NodeSnapshot {
        NodeSnapshot(role: role, roleDescription: nil, title: nil, description: nil, placeholder: nil, identifier: nil, value: nil,
                     secure: false, enabled: true, focused: false, selected: false, expanded: nil, actions: [], handle: 0, children: children)
    }

    @Test func seesASpinnerAnywhereInTheWindow() {
        #expect(BusyProbe.isBusy(node("AXWindow", children: [node("AXGroup", children: [node("AXBusyIndicator")])])))
        #expect(!BusyProbe.isBusy(node("AXWindow", children: [node("AXButton"), node("AXProgressIndicator")])))
    }
}

@Suite struct WebContentTests {
    private func node(_ role: String, children: [NodeSnapshot] = []) -> NodeSnapshot {
        NodeSnapshot(role: role, roleDescription: nil, title: nil, description: nil, placeholder: nil, identifier: nil, value: nil,
                     secure: false, enabled: true, focused: false, selected: false, expanded: nil, actions: [], handle: 0, children: children)
    }

    @Test func keepsReadingWhileThePageLoadsWithoutTakingTheScreen() {
        var reads = 0, raised = 0
        let page = WebContent.awaited(first: 0, loaded: { $0 >= 3 }, again: { reads += 1; return reads }, pause: {}, bringForward: { raised += 1 })
        #expect(page == 3)
        #expect(raised == 0)
    }

    @Test func bringsTheWindowForwardOnceWhenThePageNeverShowsInTheBackground() {
        var reads = 0, raised = 0
        _ = WebContent.awaited(first: 0, loaded: { _ in false }, again: { reads += 1; return reads }, pause: {}, bringForward: { raised += 1 })
        #expect(raised == 1)
        #expect(reads == 2 * (WebContent.wait.attempts - 1))
        var woken = 0
        let page = WebContent.awaited(first: 0, loaded: { $0 == -1 }, again: { woken > 0 ? -1 : 0 }, pause: {}, bringForward: { woken += 1 })
        #expect(page == -1)
    }

    @Test func waitsOnlyForAPageThatIsMissingNotForAWindowWithoutOne() {
        let toolbar = node("AXToolbar", children: [node("AXTextField")])
        #expect(WebContent.isPending(node("AXWindow", children: [node("AXTabGroup"), toolbar])))
        #expect(WebContent.isPending(node("AXWindow", children: [node("AXScrollArea", children: [node("AXWebArea")]), toolbar])))
        // The start page is native: nothing to wait for.
        #expect(!WebContent.isPending(node("AXWindow", children: [node("AXTabGroup", children: [node("AXScrollArea", children: [node("AXButton")])]), toolbar])))
        #expect(!WebContent.isPending(node("AXWindow", children: [node("AXScrollArea", children: [node("AXWebArea", children: [node("AXHeading")])]), toolbar])))
    }

    @Test func aPageCountsAsLoadedOnceItsWebAreaHasContent() {
        let toolbar = node("AXToolbar", children: [node("AXTextField")])
        #expect(!WebContent.isLoaded(node("AXWindow", children: [node("AXTabGroup"), toolbar])))
        #expect(!WebContent.isLoaded(node("AXWindow", children: [node("AXScrollArea", children: [node("AXWebArea")]), toolbar])))
        #expect(WebContent.isLoaded(node("AXWindow", children: [node("AXScrollArea", children: [node("AXWebArea", children: [node("AXHeading")])]), toolbar])))
    }
}

/// Browsers and Electron apps build their full accessibility tree only once a client asks for it.
@Suite struct AccessibilityWakeTests {
    final class Fake: @unchecked Sendable {
        var values: [String: Bool] = [:]
        var writes: [String] = []
        func key(_ pid: pid_t, _ name: String) -> String { "\(pid) \(name)" }
        lazy var wake = AccessibilityWake(
            read: { [unowned self] pid, name in self.values[self.key(pid, name)] },
            write: { [unowned self] pid, name, on in
                self.values[self.key(pid, name)] = on
                self.writes.append("\(pid) \(name) \(on)")
            })
    }

    @Test func turnsBothSwitchesOnOncePerApp() {
        let fake = Fake()
        #expect(fake.wake.wake(7))
        #expect(!fake.wake.wake(7))
        #expect(fake.writes == ["7 AXEnhancedUserInterface true", "7 AXManualAccessibility true"])
    }

    @Test func leavesAnAppThatWasAlreadyAwakeAndPutsBackOnlyWhatItChanged() {
        let fake = Fake()
        fake.values["7 AXEnhancedUserInterface"] = true
        #expect(fake.wake.wake(7))
        #expect(fake.wake.wake(9))
        fake.writes = []
        fake.wake.restore()
        #expect(fake.writes.sorted() == ["7 AXManualAccessibility false", "9 AXEnhancedUserInterface false", "9 AXManualAccessibility false"])
        fake.writes = []
        fake.wake.restore()
        #expect(fake.writes.isEmpty)
    }
}
