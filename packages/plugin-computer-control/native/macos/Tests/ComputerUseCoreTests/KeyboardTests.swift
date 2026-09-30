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
