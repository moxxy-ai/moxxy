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

    // Notifications show the app reacting; an app that sends none (a game, Blender) gets the full minimum.
    // A click that took two seconds to confirm has already given the app its time.
    @Test func countsTheTimeTheActionItselfTook() {
        let policy = SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, reacted: 0.5)
        let slow = SettleClock(start: 10, policy: policy, waited: 2)
        #expect(!slow.isSettled(now: 10.125, busy: false))
        #expect(slow.isSettled(now: 10.25, busy: false))
        let quick = SettleClock(start: 10, policy: policy, waited: 0.25)
        #expect(!quick.isSettled(now: 10.5, busy: false))
        #expect(quick.isSettled(now: 10.75, busy: false))
    }

    // A click whose effect was already seen in the window needs no second proof that the app reacted.
    @Test func doesNotWaitForAReactionThatWasAlreadySeen() {
        let policy = SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, reacted: 0.5)
        let seen = SettleClock(start: 10, policy: policy, waited: 0.375, reacted: true)
        #expect(!seen.isSettled(now: 10.125, busy: false))
        #expect(seen.isSettled(now: 10.25, busy: false))
        let unseen = SettleClock(start: 10, policy: policy, waited: 0.375)
        #expect(!unseen.isSettled(now: 10.5, busy: false))
        #expect(unseen.isSettled(now: 10.625, busy: false))
    }

    @Test func aChangeHeardBeforeTheWaitBeganIsTheReaction() {
        let policy = SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, reacted: 0.5)
        var clock = SettleClock(start: 10, policy: policy, waited: 0.375)
        clock.record(at: 9.875)
        #expect(!clock.isSettled(now: 10.0, busy: false))
        #expect(clock.isSettled(now: 10.125, busy: false))
    }

    // Only apps that build their tree on demand need time after being asked for it the first time.
    @Test func knowsWhichAppsFillTheirTreeLate() {
        let electron = URL(fileURLWithPath: "/Applications/Slack.app")
        let has: (String) -> Bool = { $0 == "/Applications/Slack.app/Contents/Frameworks/Electron Framework.framework" }
        #expect(LateTree.fills(bundle: electron, browser: false, exists: has))
        #expect(!LateTree.fills(bundle: URL(fileURLWithPath: "/System/Applications/System Settings.app"), browser: false, exists: has))
        #expect(LateTree.fills(bundle: URL(fileURLWithPath: "/Applications/Safari.app"), browser: true, exists: has))
        #expect(LateTree.fills(bundle: nil, browser: false, exists: has))
    }

    @Test func waitsLessOnceTheAppHasReacted() {
        var clock = SettleClock(start: 0, policy: SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, reacted: 0.5))
        #expect(!clock.isSettled(now: 0.75, busy: false))
        clock.record(at: 0.125)
        #expect(!clock.isSettled(now: 0.375, busy: false))
        #expect(clock.isSettled(now: 0.5, busy: false))
        #expect(clock.nextCheck(now: 0.25, busy: false) == 0.5)
        clock.record(at: 0.375)
        #expect(!clock.isSettled(now: 0.5, busy: false))
        #expect(clock.isSettled(now: 0.625, busy: false))
    }

    // Reading the window makes some apps send notifications of their own, so it is read only once they are quiet.
    @Test func saysWhenTheAppIsQuietEnoughToBeAskedWhetherItIsBusy() {
        var clock = SettleClock(start: 0, policy: policy)
        #expect(!clock.isQuiet(now: 0.5))
        #expect(clock.isQuiet(now: 1.0))
        clock.record(at: 1.0)
        #expect(!clock.isQuiet(now: 1.125))
        #expect(clock.isQuiet(now: 1.25))
        #expect(clock.isQuiet(now: 5.0))
    }

    // The Bluetooth pane of System Settings spins for as long as it is open.
    @Test func stopsWaitingForASpinnerOnceNothingElseChanges() {
        var clock = SettleClock(start: 0, policy: SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, still: 1.0))
        clock.record(at: 0.5)
        #expect(!clock.isSettled(now: 1.25, busy: true))
        #expect(clock.isSettled(now: 1.5, busy: true))
        clock.record(at: 1.5)
        #expect(!clock.isSettled(now: 2.25, busy: true))
        #expect(clock.isSettled(now: 2.5, busy: true))
    }

    @Test func doesNotCountTheNotificationsItsOwnReadingCauses() {
        var clock = SettleClock(start: 0, policy: SettlePolicy(minimum: 1.0, quiet: 0.25, maximum: 5.0, still: 1.0))
        clock.record(at: 0.5)
        clock.read(from: 1.0, to: 1.0625)
        clock.record(at: 1.03125)
        clock.record(at: 1.125)
        #expect(clock.isSettled(now: 1.5, busy: true))
        clock.record(at: 1.375)
        #expect(!clock.isSettled(now: 1.5, busy: true))
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
        // Safari first answers with the tab's empty containers; the page comes seconds later.
        let shell = node("AXTabGroup", children: [node("AXGroup", children: [node("AXGroup", children: [node("AXScrollArea")])])])
        #expect(WebContent.isPending(node("AXWindow", children: [node("AXSplitGroup", children: [shell]), toolbar])))
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
