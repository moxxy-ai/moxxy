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
