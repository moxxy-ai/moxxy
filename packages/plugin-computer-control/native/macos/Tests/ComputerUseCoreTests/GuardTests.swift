import CoreGraphics
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct UserInputTests {
    private let ours = KeyboardInput.marker

    @Test func tellsOurOwnEventsFromTheUsersByTheirMarker() {
        #expect(UserInput.classify(type: .leftMouseDown, keyCode: 0, userData: ours) == .ours)
        #expect(UserInput.classify(type: .keyDown, keyCode: 53, userData: ours) == .ours)
        #expect(UserInput.classify(type: .leftMouseDown, keyCode: 0, userData: 0) == .activity)
        #expect(UserInput.classify(type: .mouseMoved, keyCode: 0, userData: 0) == .activity)
        #expect(UserInput.classify(type: .scrollWheel, keyCode: 0, userData: 0) == .activity)
        #expect(UserInput.classify(type: .keyDown, keyCode: 0, userData: 0) == .activity)
    }

    @Test func treatsTheUsersEscapeAsStop() {
        #expect(UserInput.classify(type: .keyDown, keyCode: 53, userData: 0) == .escape)
        // Releasing Escape is not a second stop.
        #expect(UserInput.classify(type: .keyUp, keyCode: 53, userData: 0) == .activity)
    }

    @Test func ignoresTheTapsOwnNotices() {
        #expect(UserInput.classify(type: .tapDisabledByTimeout, keyCode: 0, userData: 0) == .ignored)
        #expect(UserInput.classify(type: .tapDisabledByUserInput, keyCode: 0, userData: 0) == .ignored)
    }
}

@Suite struct QuietWaitTests {
    @Test func goesOnceTheUserHasBeenStillForAMoment() {
        #expect(QuietWait.next(sinceInput: 0.4, attempt: 0) == .go)
        #expect(QuietWait.next(sinceInput: 30, attempt: 5) == .go)
    }

    @Test func waitsForTheRestOfTheMomentUpToSixTimes() {
        #expect(QuietWait.next(sinceInput: 0.1, attempt: 0) == .wait(0.3))
        #expect(QuietWait.next(sinceInput: 0, attempt: 5) == .wait(0.4))
        #expect(QuietWait.next(sinceInput: 0, attempt: 6) == .refuse)
    }
}

@Suite struct ControlGateTests {
    private final class States: @unchecked Sendable {
        private let lock = NSLock()
        private var log: [String] = []
        func append(_ state: String) { lock.withLock { log.append(state) } }
        var all: [String] { lock.withLock { log } }
    }

    @Test func letsActionsThroughWhileNotPaused() {
        let states = States()
        let gate = ControlGate { states.append($0) }
        #expect(gate.waitWhilePaused() == false)
        #expect(states.all.isEmpty)
    }

    @Test func holdsAnActionWhilePausedAndReportsTheWait() async throws {
        let states = States()
        let gate = ControlGate { states.append($0) }
        gate.pause()
        let waited = Task.detached { gate.waitWhilePaused() }
        try await Task.sleep(for: .milliseconds(150))
        #expect(states.all == ["paused_by_user"])
        gate.resume()
        #expect(await waited.value == true)
        #expect(states.all == ["paused_by_user", "recovering"])
        #expect(gate.waitWhilePaused() == false)
    }
}
