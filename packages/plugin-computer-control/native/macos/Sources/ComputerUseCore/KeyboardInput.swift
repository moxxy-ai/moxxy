import AppKit
import Carbon.HIToolbox

/// Keyboard events posted straight to the target process, so the app works in the background and the
/// user's frontmost app never receives them (verified on the fixture while it was inactive).
enum KeyboardInput {
    /// Marks our own events so the guard (step 7d) can tell them from the user's.
    static let marker: Int64 = 0x6D6F7878 // "moxx"

    static func press(_ chord: KeyChord, pid: pid_t) throws {
        guard let key = chord.key else {
            for (code, flag) in KeyCodes.modifiers.values where chord.flags.contains(flag) {
                post(code, down: true, flags: chord.flags, pid: pid)
                post(code, down: false, flags: [], pid: pid)
            }
            return
        }
        switch key {
        case let .named(code):
            tap(code, flags: chord.flags, pid: pid)
        case let .character(character):
            if let stroke = KeyLayout.stroke(for: character) ?? KeyCodes.ansi(character) {
                // Unmodified characters carry their text, so the layout cannot change what arrives.
                tap(stroke.code, flags: chord.flags.union(stroke.shift ? .maskShift : []), pid: pid,
                    text: chord.flags.isEmpty ? String(character) : nil)
            } else if chord.flags.isEmpty {
                type(String(character), pid: pid)
            } else {
                throw HelperError(code: "invalid_key", message: "No key on this keyboard produces \(character) with modifiers")
            }
        }
    }

    /// Text as Unicode key events, one chunk per event. A single character goes out on the key that types it,
    /// for apps that read the key and not the text.
    static func type(_ chunk: String, pid: pid_t) {
        if chunk.count == 1, let character = chunk.first, let stroke = KeyLayout.stroke(for: character) ?? KeyCodes.ansi(character) {
            return tap(stroke.code, flags: stroke.shift ? .maskShift : [], pid: pid, text: chunk)
        }
        let units = Array(chunk.utf16)
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
            event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            send(event, pid: pid)
        }
    }

    /// A private state per event keeps the user's physical modifier keys out of ours.
    static var source: CGEventSource? { CGEventSource(stateID: .privateState) }

    static func mark(_ event: CGEvent) { event.setIntegerValueField(.eventSourceUserData, value: marker) }

    /// The key that types a chord's key, `nil` for a chord of modifiers alone.
    static func stroke(for chord: KeyChord) throws -> KeyCodes.Stroke? {
        switch chord.key {
        case nil: return nil
        case let .named(code): return KeyCodes.Stroke(code: code, shift: false)
        case let .character(character):
            guard let stroke = KeyLayout.stroke(for: character) ?? KeyCodes.ansi(character) else {
                throw HelperError(code: "invalid_key", message: "No key on this keyboard produces \(character)")
            }
            return stroke
        }
    }

    static func post(_ key: KeyEvent, pid: pid_t) { post(key.code, down: key.down, flags: key.flags, pid: pid) }

    private static func tap(_ code: CGKeyCode, flags: CGEventFlags, pid: pid_t, text: String? = nil) {
        post(code, down: true, flags: flags, pid: pid, text: text)
        post(code, down: false, flags: flags, pid: pid, text: text)
    }

    private static func post(_ code: CGKeyCode, down: Bool, flags: CGEventFlags, pid: pid_t, text: String? = nil) {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        event.flags = flags
        if let text {
            let units = Array(text.utf16)
            event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        }
        send(event, pid: pid)
    }

    private static func send(_ event: CGEvent, pid: pid_t) {
        mark(event)
        switch KeyRoute.choose(target: pid, frontmost: Foreground.isFrontmost(pid) ? pid : nil) {
        case .session: event.post(tap: .cgSessionEventTap)
        case .process: event.postToPid(pid)
        }
    }
}

/// Where a key event goes. An open or save panel of a sandboxed app runs in another process, so keys sent to
/// the app's process never reach it; while the app is in front, the session delivers them to whatever has focus.
public enum KeyRoute: Equatable, Sendable {
    case session, process

    public static func choose(target: pid_t, frontmost: pid_t?) -> KeyRoute { frontmost == target ? .session : .process }
}

/// Keys held across a wait. Whatever is still down goes up when the hold ends, the user stops Computer Use
/// or the helper exits, so no key is left pressed for the user.
public final class KeySession: @unchecked Sendable {
    private let send: @Sendable (KeyEvent, pid_t) -> Void
    private let lock = NSLock()
    /// The key-ups still owed, and the wait a release ends early. Guarded by `lock`.
    private var owed: (pid: pid_t, release: [KeyEvent], wake: DispatchSemaphore)?

    public convenience init() { self.init { KeyboardInput.post($0, pid: $1) } }

    init(send: @escaping @Sendable (KeyEvent, pid_t) -> Void) { self.send = send }

    func hold(_ script: (press: [KeyEvent], release: [KeyEvent]), pid: pid_t, for duration: TimeInterval) {
        let wake = DispatchSemaphore(value: 0)
        lock.withLock { owed = (pid, script.release, wake) }
        for event in script.press { send(event, pid) }
        _ = wake.wait(timeout: .now() + duration)
        release()
    }

    public func release() {
        guard let (pid, events, wake) = lock.withLock({ () -> (pid_t, [KeyEvent], DispatchSemaphore)? in
            defer { owed = nil }
            return owed
        }) else { return }
        for event in events { send(event, pid) }
        wake.signal()
    }
}

/// The key that types a character in the user's current keyboard layout.
enum KeyLayout {
    static func stroke(for character: Character) -> KeyCodes.Stroke? {
        DispatchQueue.main.sync {
            // Text Input Sources must be asked on the main thread.
            MainActor.assumeIsolated { strokes()[character] }
        }
    }

    @MainActor
    private static func strokes() -> [Character: KeyCodes.Stroke] {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
        else { return [:] }
        let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue() as Data
        var map: [Character: KeyCodes.Stroke] = [:]
        data.withUnsafeBytes { raw in
            guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
            for shift in [false, true] {
                for code in CGKeyCode(0)..<CGKeyCode(128) {
                    var dead: UInt32 = 0
                    var length = 0
                    var chars = [UniChar](repeating: 0, count: 4)
                    let state = UInt32(shift ? (shiftKey >> 8) & 0xFF : 0)
                    guard UCKeyTranslate(layout, code, UInt16(kUCKeyActionDown), state, UInt32(LMGetKbdType()),
                                         OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, chars.count, &length, &chars) == noErr,
                          length == 1, let character = String(utf16CodeUnits: chars, count: length).first
                    else { continue }
                    if map[character] == nil { map[character] = KeyCodes.Stroke(code: code, shift: shift) }
                }
            }
        }
        return map
    }
}

/// Paste goes through the clipboard; the user's clipboard comes back afterwards unless they copied meanwhile.
enum Clipboard {
    /// How long the app gets to read the clipboard after Command-V.
    static let readWindow: TimeInterval = 0.5

    static func paste(_ text: String, format: PasteFormat, pid: pid_t) throws {
        let saved = DispatchQueue.main.sync { MainActor.assumeIsolated { snapshot(.general) } }
        let written = DispatchQueue.main.sync { MainActor.assumeIsolated { write(text, format: format, to: .general) } }
        try KeyboardInput.press(KeyChord(flags: .maskCommand, key: .character("v")), pid: pid)
        Thread.sleep(forTimeInterval: readWindow)
        DispatchQueue.main.sync { MainActor.assumeIsolated { restore(saved, to: .general, ifStill: written) } }
    }

    @MainActor
    static func snapshot(_ board: NSPasteboard) -> [[NSPasteboard.PasteboardType: Data]] {
        (board.pasteboardItems ?? []).map { item in
            Dictionary(item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }, uniquingKeysWith: { first, _ in first })
        }
    }

    /// Returns the change count after writing, to notice a copy made by the user before restoring.
    @MainActor
    static func write(_ text: String, format: PasteFormat, to board: NSPasteboard) -> Int {
        board.clearContents()
        let item = NSPasteboardItem()
        switch format {
        case .text:
            item.setString(text, forType: .string)
        case .md:
            item.setString(text, forType: .string)
            item.setString(text, forType: NSPasteboard.PasteboardType("net.daringfireball.markdown"))
        case .html:
            item.setString(text, forType: .html)
            let plain = NSAttributedString(html: Data(text.utf8), documentAttributes: nil)?.string
            item.setString(plain ?? text, forType: .string)
        }
        // Clipboard history tools skip transient items (nspasteboard.org convention).
        item.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        board.writeObjects([item])
        return board.changeCount
    }

    /// Puts the user's items back, unless the clipboard changed since `written` (the user copied meanwhile).
    @MainActor
    static func restore(_ items: [[NSPasteboard.PasteboardType: Data]], to board: NSPasteboard, ifStill written: Int) {
        guard board.changeCount == written else { return }
        board.clearContents()
        guard !items.isEmpty else { return }
        board.writeObjects(items.map { saved in
            let item = NSPasteboardItem()
            for (type, data) in saved { item.setData(data, forType: type) }
            return item
        })
    }
}

/// The system's open and save panels, by the identifier of their window or sheet.
public enum FilePanel {
    public static let identifiers: Set<String> = ["open-panel", "save-panel"]
}
