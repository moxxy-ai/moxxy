import AppKit
import CoreGraphics
import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct KeyCodeTests {
    @Test func mapsNeutralKeyNamesToLayoutIndependentKeys() {
        #expect(KeyCodes.named["enter"] == 0x24)
        #expect(KeyCodes.named["backspace"] == 0x33)
        #expect(KeyCodes.named["forward_delete"] == 0x75)
        #expect(KeyCodes.named["page_down"] == 0x79)
        #expect(KeyCodes.named["f5"] == 0x60)
        #expect(KeyCodes.named["numpad_3"] == 0x55)
        #expect(KeyCodes.named["numpad_enter"] == 0x4C)
    }

    @Test func fallsBackToTheUSLayoutForCharacters() {
        #expect(KeyCodes.ansi("c") == KeyCodes.Stroke(code: 0x08, shift: false))
        #expect(KeyCodes.ansi("C") == KeyCodes.Stroke(code: 0x08, shift: true))
        #expect(KeyCodes.ansi("1") == KeyCodes.Stroke(code: 0x12, shift: false))
        #expect(KeyCodes.ansi("!") == KeyCodes.Stroke(code: 0x12, shift: true))
        #expect(KeyCodes.ansi("ą") == nil)
    }
}

@Suite struct KeyChordTests {
    private func chord(_ modifiers: [String], _ key: String?) -> JSONValue {
        .object(["modifiers": .array(modifiers.map(JSONValue.string)), "key": key.map(JSONValue.string) ?? .null])
    }

    @Test func readsTheChordTheHostParsed() throws {
        let copy = try KeyChord.parse(chord(["shift", "meta"], "z"))
        #expect(copy.flags == [.maskShift, .maskCommand])
        #expect(copy.key == .character("z"))
        #expect(try KeyChord.parse(chord([], "enter")).key == .named(0x24))
        #expect(try KeyChord.parse(chord(["shift"], nil)).key == nil)
    }

    @Test func knowsWhichChordsNeedTheMenuBar() {
        #expect(KeyChord(flags: .maskCommand, key: .character("a")).isSelectAll)
        #expect(!KeyChord(flags: [.maskCommand, .maskShift], key: .character("a")).isSelectAll)
        #expect(KeyChord(flags: .maskCommand, key: .character("c")).needsMenuBar)
        #expect(!KeyChord(flags: .maskControl, key: .character("a")).needsMenuBar)
        #expect(!KeyChord(flags: [], key: .named(0x33)).needsMenuBar)
    }

    @Test func refusesKeysItCannotPress() {
        #expect(throws: HelperError.self) { try KeyChord.parse(chord(["hyper"], "a")) }
        #expect(throws: HelperError.self) { try KeyChord.parse(chord([], "menu")) }
        #expect(throws: HelperError.self) { try KeyChord.parse(.string("super+c")) }
    }
}

@Suite struct TextLocatorTests {
    @Test func findsTheOnlyMatchInUTF16Offsets() {
        #expect(TextLocator.find("two", in: "one two three") == .success(NSRange(location: 4, length: 3)))
        #expect(TextLocator.find("ab", in: "😀ab") == .success(NSRange(location: 2, length: 2)))
    }

    @Test func usesPrefixAndSuffixToPickBetweenRepeats() {
        #expect(TextLocator.find("hi", in: "hi there hi") == .failure(.ambiguous(2)))
        #expect(TextLocator.find("hi", in: "hi there hi", prefix: "there ") == .success(NSRange(location: 9, length: 2)))
        #expect(TextLocator.find("hi", in: "hi there hi", suffix: " there") == .success(NSRange(location: 0, length: 2)))
        #expect(TextLocator.find("bye", in: "hi there") == .failure(.notFound))
    }
}

@Suite struct TypingTests {
    @Test func splitsTextIntoEventSizedChunksWithoutBreakingCharacters() {
        #expect(Typing.chunks("abc", limit: 2) == ["ab", "c"])
        #expect(Typing.chunks("a😀b", limit: 2) == ["a", "😀", "b"])
        #expect(Typing.chunks("", limit: 20) == [])
    }
}

@Suite struct KeyboardRequestTests {
    @Test func readsTextAndKeySteps() throws {
        #expect(try ActionRequest.parse(.object(["action": .string("type_text"), "text": .string("hi")])) == .typeText(target: nil, text: "hi"))
        #expect(try ActionRequest.parse(.object(["action": .string("type_text"), "element_index": .number(2), "text": .string("hi")]))
            == .typeText(target: .element(2), text: "hi"))
        let key = try ActionRequest.parse(.object([
            "action": .string("press_key"), "key": .string("Return"), "repeat": .number(2),
            "chord": .object(["modifiers": .array([]), "key": .string("enter")]),
        ]))
        #expect(key == .pressKey(KeyChord(flags: [], key: .named(0x24)), repeat: 2))
        #expect(try ActionRequest.parse(.object(["action": .string("paste"), "text": .string("x"), "format": .string("html")]))
            == .paste(target: nil, text: "x", format: .html))
        #expect(try ActionRequest.parse(.object([
            "action": .string("select_text"), "element_index": .number(1), "text": .string("two"), "selection_type": .string("cursor_after"),
        ])) == .selectText(element: 1, text: "two", prefix: nil, suffix: nil, placement: .cursorAfter))
    }
}

@Suite struct HoldKeyTests {
    private let shiftDown = KeyChord(flags: .maskShift, key: .named(0x7D))

    @Test func readsAHoldWithItsDurationInSeconds() throws {
        let hold = try ActionRequest.parse(.object([
            "action": .string("hold_key"), "key": .string("shift+Down"), "duration_s": .number(0.5),
            "chord": .object(["modifiers": .array([.string("shift")]), "key": .string("down")]),
        ]))
        #expect(hold == .holdKey(shiftDown, duration: 0.5))
        for duration in [JSONValue.number(0), .number(101), .null] {
            #expect(throws: HelperError.self) {
                try ActionRequest.parse(.object(["action": .string("hold_key"), "duration_s": duration, "chord": .object(["modifiers": .array([.string("shift")])])]))
            }
        }
    }

    @Test func pressesModifiersBeforeTheKeyAndReleasesInReverse() {
        let script = KeyScript.hold(shiftDown, stroke: KeyCodes.Stroke(code: 0x7D, shift: false))
        #expect(script.press == [KeyEvent(code: 0x38, down: true, flags: .maskShift), KeyEvent(code: 0x7D, down: true, flags: .maskShift)])
        #expect(script.release == [KeyEvent(code: 0x7D, down: false, flags: .maskShift), KeyEvent(code: 0x38, down: false, flags: [])])
    }

    @Test func holdsAModifierAloneAndAddsShiftTheLayoutNeeds() {
        let shift = KeyScript.hold(KeyChord(flags: .maskShift, key: nil), stroke: nil)
        #expect(shift.press == [KeyEvent(code: 0x38, down: true, flags: .maskShift)])
        #expect(shift.release == [KeyEvent(code: 0x38, down: false, flags: [])])
        let capital = KeyScript.hold(KeyChord(flags: .maskControl, key: .character("A")), stroke: KeyCodes.Stroke(code: 0x00, shift: true))
        #expect(capital.press == [
            KeyEvent(code: 0x3B, down: true, flags: .maskControl), KeyEvent(code: 0x38, down: true, flags: [.maskControl, .maskShift]),
            KeyEvent(code: 0x00, down: true, flags: [.maskControl, .maskShift]),
        ])
        #expect(capital.release.last == KeyEvent(code: 0x3B, down: false, flags: []))
    }

    @Test func releasesHeldKeysOnceWhenStoppedMidHold() async throws {
        let posted = Posted()
        let keys = KeySession { event, pid in posted.append(event, pid) }
        let script = KeyScript.hold(KeyChord(flags: .maskShift, key: nil), stroke: nil)
        let holding = Task.detached { keys.hold(script, pid: 42, for: 2) }
        try await Task.sleep(for: .milliseconds(100))
        keys.release()
        #expect(posted.events == [KeyEvent(code: 0x38, down: true, flags: .maskShift), KeyEvent(code: 0x38, down: false, flags: [])])
        // The wait ends with the release instead of running out the duration.
        let stopped = ContinuousClock.now
        await holding.value
        #expect(ContinuousClock.now - stopped < .milliseconds(500))
        #expect(posted.events.count == 2)
        #expect(posted.pids == [42, 42])
    }
}

/// Records what a key session would post, at the one boundary these tests replace (the window server).
private final class Posted: @unchecked Sendable {
    private let lock = NSLock()
    private var log: [(KeyEvent, pid_t)] = []
    func append(_ event: KeyEvent, _ pid: pid_t) { lock.withLock { log.append((event, pid)) } }
    var events: [KeyEvent] { lock.withLock { log.map(\.0) } }
    var pids: [pid_t] { lock.withLock { log.map(\.1) } }
}

@MainActor @Suite struct ClipboardTests {
    private let board = NSPasteboard(name: NSPasteboard.Name("ai.moxxy.test.\(UUID().uuidString)"))

    @Test func writesRichTextWithAPlainFallbackMarkedTransient() {
        _ = Clipboard.write("<b>bold</b> text", format: .html, to: board)
        #expect(board.string(forType: .html) == "<b>bold</b> text")
        #expect(board.string(forType: .string) == "bold text")
        #expect(board.types?.contains(NSPasteboard.PasteboardType("org.nspasteboard.TransientType")) == true)
        board.releaseGlobally()
    }

    @Test func givesBackEveryTypeOfTheUsersClipboardUnlessTheyCopiedMeanwhile() {
        board.clearContents()
        let item = NSPasteboardItem()
        item.setString("mine", forType: .string)
        item.setData(Data([1, 2, 3]), forType: NSPasteboard.PasteboardType("com.example.private"))
        board.writeObjects([item])
        let saved = Clipboard.snapshot(board)

        let written = Clipboard.write("agent", format: .text, to: board)
        Clipboard.restore(saved, to: board, ifStill: written)
        #expect(board.string(forType: .string) == "mine")
        #expect(board.data(forType: NSPasteboard.PasteboardType("com.example.private")) == Data([1, 2, 3]))

        let again = Clipboard.write("agent", format: .text, to: board)
        board.clearContents()
        board.setString("copied by the user", forType: .string)
        Clipboard.restore(saved, to: board, ifStill: again)
        #expect(board.string(forType: .string) == "copied by the user")
        board.releaseGlobally()
    }
}

@Suite struct KeyRouteTests {
    // An open or save panel of a sandboxed app lives in another process: keys sent to the app's process never
    // reach it, keys sent to the session go to whatever has key focus.
    @Test func sendsKeysToTheSessionOnlyWhileTheAppIsInFront() {
        #expect(KeyRoute.choose(target: 42, frontmost: 42) == .session)
        #expect(KeyRoute.choose(target: 42, frontmost: 7) == .process)
        #expect(KeyRoute.choose(target: 42, frontmost: nil) == .process)
    }
}

@Suite struct TextTargetTests {
    @Test func picturesButtonsAndLabelsTakeNoText() {
        for role in ["AXImage", "AXButton", "AXStaticText", "AXCheckBox", "AXMenuItem"] { #expect(Typing.takesNoText(role: role)) }
        for role in ["AXTextField", "AXTextArea", "AXComboBox", "AXGroup", "AXWebArea", "AXCell"] { #expect(!Typing.takesNoText(role: role)) }
    }
}
