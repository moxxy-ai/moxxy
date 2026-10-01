import CoreGraphics
import Foundation

/// macOS virtual key codes for the neutral key names of `src/contract/keys.ts`.
public enum KeyCodes {
    public static let named: [String: CGKeyCode] = {
        var keys: [String: CGKeyCode] = [
            "enter": 0x24, "tab": 0x30, "escape": 0x35, "backspace": 0x33, "forward_delete": 0x75, "space": 0x31,
            "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C, "home": 0x73, "end": 0x77, "page_up": 0x74, "page_down": 0x79,
            // A Mac keyboard has Help where a PC keyboard has Insert.
            "insert": 0x72, "help": 0x72, "caps_lock": 0x39,
            "numpad_enter": 0x4C, "numpad_add": 0x45, "numpad_subtract": 0x4E, "numpad_multiply": 0x43,
            "numpad_divide": 0x4B, "numpad_decimal": 0x41, "numpad_equal": 0x51,
        ]
        let functions: [CGKeyCode] = [0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F,
                                      0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A]
        for (offset, code) in functions.enumerated() { keys["f\(offset + 1)"] = code }
        let numpad: [CGKeyCode] = [0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5B, 0x5C]
        for (digit, code) in numpad.enumerated() { keys["numpad_\(digit)"] = code }
        return keys
    }()

    /// Pressed on their own when a chord holds only modifiers.
    static let modifiers: [String: (code: CGKeyCode, flag: CGEventFlags)] = [
        "ctrl": (0x3B, .maskControl), "alt": (0x3A, .maskAlternate), "shift": (0x38, .maskShift), "meta": (0x37, .maskCommand),
    ]

    /// Flags for modifier names from the host's parser ("ctrl", "alt", "shift", "meta").
    static func flags(_ names: [JSONValue]) throws -> CGEventFlags {
        try names.reduce(into: CGEventFlags()) { flags, name in
            guard let modifier = name.stringValue.flatMap({ modifiers[$0] }) else { throw HelperError(code: "invalid_key", message: "Unknown modifier") }
            flags.insert(modifier.flag)
        }
    }

    public struct Stroke: Equatable, Sendable {
        public let code: CGKeyCode
        public let shift: Bool
    }

    private static let unshifted: [Character: CGKeyCode] = [
        "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09,
        "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
        "4": 0x15, "6": 0x16, "5": 0x17, "=": 0x18, "9": 0x19, "7": 0x1A, "-": 0x1B, "8": 0x1C, "0": 0x1D, "]": 0x1E,
        "o": 0x1F, "u": 0x20, "[": 0x21, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "'": 0x27, "k": 0x28, ";": 0x29,
        "\\": 0x2A, ",": 0x2B, "/": 0x2C, "n": 0x2D, "m": 0x2E, ".": 0x2F, "`": 0x32,
    ]
    private static let shifted: [Character: Character] = [
        "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
        "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "~": "`",
    ]

    /// The US-layout key for a character; used when the current layout has no key for it.
    public static func ansi(_ character: Character) -> Stroke? {
        if let code = unshifted[character] { return Stroke(code: code, shift: false) }
        if let base = shifted[character], let code = unshifted[base] { return Stroke(code: code, shift: true) }
        let lower = Character(character.lowercased())
        if character.isUppercase, lower != character, let code = unshifted[lower] { return Stroke(code: code, shift: true) }
        return nil
    }
}

/// A chord as the host's xdotool parser produced it: `{modifiers, key}`.
public struct KeyChord: Equatable, Sendable {
    public enum Key: Equatable, Sendable {
        case named(CGKeyCode)
        case character(Character)
    }

    public let flags: CGEventFlags
    /// `nil` when the chord only holds modifiers.
    public let key: Key?

    public init(flags: CGEventFlags, key: Key?) {
        self.flags = flags
        self.key = key
    }

    /// Command-A has an accessibility equivalent: select the whole text of the focused element.
    public var isSelectAll: Bool { flags == .maskCommand && key == .character("a") }

    /// Command shortcuts are menu key equivalents; an app handles them only while it is in front
    /// (its menu items are disabled in the background).
    public var needsMenuBar: Bool { flags.contains(.maskCommand) }

    /// Return and Enter press a dialog's default button.
    public var confirms: Bool { flags.isEmpty && (key == .named(0x24) || key == .named(0x4C)) }

    public static func parse(_ value: JSONValue) throws -> KeyChord {
        guard case let .array(names)? = value["modifiers"] else { throw HelperError.invalidParams("chord needs modifiers") }
        let flags = try KeyCodes.flags(names)
        guard let raw = value["key"] else { throw HelperError.invalidParams("chord needs key") }
        if raw == .null { return KeyChord(flags: flags, key: nil) }
        guard let name = raw.stringValue else { throw HelperError.invalidParams("chord key must be text") }
        if let code = KeyCodes.named[name] { return KeyChord(flags: flags, key: .named(code)) }
        guard name.count == 1, let character = name.first else {
            throw HelperError(code: "invalid_key", message: "There is no \(name) key on a Mac keyboard")
        }
        return KeyChord(flags: flags, key: .character(character))
    }
}

/// One key going down or up, with the modifier flags in force at that moment.
public struct KeyEvent: Equatable, Sendable {
    public let code: CGKeyCode
    public let down: Bool
    public let flags: CGEventFlags
}

/// The key events behind holding a chord, the way a hand does it.
public enum KeyScript {
    /// The order a hand presses modifiers in; release goes the other way.
    static let modifierOrder = ["ctrl", "alt", "shift", "meta"].compactMap { KeyCodes.modifiers[$0] }

    /// Modifiers first, each adding its flag, then the key; `stroke` is the chord's key in the current layout
    /// and may need Shift. Release undoes the press in reverse.
    public static func hold(_ chord: KeyChord, stroke: KeyCodes.Stroke?) -> (press: [KeyEvent], release: [KeyEvent]) {
        let wanted = chord.flags.union(stroke?.shift == true ? .maskShift : [])
        var flags = CGEventFlags()
        var press: [KeyEvent] = []
        var release: [KeyEvent] = []
        for modifier in modifierOrder where wanted.contains(modifier.flag) {
            flags.insert(modifier.flag)
            press.append(KeyEvent(code: modifier.code, down: true, flags: flags))
            var after = flags
            after.remove(modifier.flag)
            release.insert(KeyEvent(code: modifier.code, down: false, flags: after), at: 0)
        }
        if let stroke {
            press.append(KeyEvent(code: stroke.code, down: true, flags: flags))
            release.insert(KeyEvent(code: stroke.code, down: false, flags: flags), at: 0)
        }
        return (press, release)
    }
}

public enum TextPlacement: String, Sendable {
    case text, cursorBefore = "cursor_before", cursorAfter = "cursor_after"
}

/// Finds the text to select in an element's value, in the UTF-16 offsets accessibility ranges use.
public enum TextLocator {
    public enum Failure: Error, Equatable { case notFound, ambiguous(Int) }

    public static func find(_ text: String, in value: String, prefix: String? = nil, suffix: String? = nil) -> Result<NSRange, Failure> {
        let haystack = value as NSString
        var matches: [NSRange] = []
        var from = 0
        while from < haystack.length {
            let found = haystack.range(of: text, options: .literal, range: NSRange(location: from, length: haystack.length - from))
            guard found.location != NSNotFound else { break }
            let before = haystack.substring(to: found.location)
            let after = haystack.substring(from: NSMaxRange(found))
            if before.hasSuffix(prefix ?? ""), after.hasPrefix(suffix ?? "") { matches.append(found) }
            from = found.location + 1
        }
        guard let only = matches.first else { return .failure(.notFound) }
        return matches.count == 1 ? .success(only) : .failure(.ambiguous(matches.count))
    }
}

public enum Typing {
    /// One keyboard event carries at most 20 UTF-16 units; characters are never split.
    public static let unitsPerEvent = 20

    /// Roles that never hold text. Typing "into" one would only move keyboard focus away from where the
    /// user of the app is typing (a file name being edited, for one).
    public static func takesNoText(role: String) -> Bool {
        ["AXImage", "AXButton", "AXStaticText", "AXCheckBox", "AXRadioButton", "AXMenuItem", "AXMenuButton", "AXPopUpButton"].contains(role)
    }

    public static func chunks(_ text: String, limit: Int = unitsPerEvent) -> [String] {
        var chunks: [String] = []
        var current = ""
        for character in text {
            if !current.isEmpty, current.utf16.count + character.utf16.count > limit {
                chunks.append(current)
                current = ""
            }
            current.append(character)
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }
}
