import AppKit
import ComputerUseCore
import Foundation

/// Exit codes the TypeScript transport understands: 20 means the user stopped Computer Use.
enum ExitCode {
    static let normal: Int32 = 0
    static let usage: Int32 = 64
    static let protocolFault: Int32 = 65
    static let userStopped: Int32 = 20
}

/// One writer for stdout so responses and later events never interleave mid-line.
final class Output: @unchecked Sendable {
    private let lock = NSLock()

    func write(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
    }
}

final class CurrentRequest: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    var id: String? {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

func fail(_ message: String, code: Int32) -> Never {
    // Diagnostics only; never application content.
    FileHandle.standardError.write(Data("moxxy-computer: \(message)\n".utf8))
    exit(code)
}

func parentPid(_ arguments: [String]) -> pid_t {
    guard let flag = arguments.firstIndex(of: "--parent"), flag + 1 < arguments.count, let pid = pid_t(arguments[flag + 1]) else {
        fail("usage: moxxy-computer --parent <pid>", code: ExitCode.usage)
    }
    return pid
}

let parent = parentPid(CommandLine.arguments)
let output = Output()
/// The request being handled, for `control_state` frames while it waits.
let current = CurrentRequest()
let gate = ControlGate { state in
    guard let id = current.id else { return }
    output.write(Wire.event("control_state", ["id": .string(id), "state": .string(state)]))
}
// The user's Escape stops Computer Use like the Stop button.
let activity = UserActivity { leave(ExitCode.userStopped) }
activity.start()
let input = InputSessions(gate: gate, activity: activity, host: parent)

/// A mouse button or key the model left down is never left pressed for the user.
func leave(_ code: Int32) -> Never {
    input.release()
    exit(code)
}

guard let watch = ParentWatch(pid: parent, queue: .main, onExit: { leave(ExitCode.normal) }) else { exit(ExitCode.normal) }

let cursor = AgentCursor(emit: output.write)
let preview = PreviewStream(emit: output.write)
let dispatcher = Methods.standard(permissions: SystemPermissions(), cursor: cursor, input: input, preview: preview)
// Requests run one at a time off the main thread; the reader stays free for pause and stop.
let requests = DispatchQueue(label: "ai.moxxy.computer.requests")

let reader = Thread {
    var session = ProtocolSession()
    while true {
        let bytes = FileHandle.standardInput.availableData
        let inbound = bytes.isEmpty ? [session.finish()].compactMap { $0 } : session.receive(bytes)
        for item in inbound {
            switch item {
            case let .incoming(.request(id, method, params)):
                requests.async {
                    current.id = id
                    output.write(dispatcher.handle(id: id, method: method, params: params))
                    current.id = nil
                }
            case .incoming(.control(.stop)):
                leave(ExitCode.userStopped)
            case .incoming(.control(.pause)):
                gate.pause()
                cursor.dim(true)
            case .incoming(.control(.takeover)):
                gate.pause()
                cursor.hide()
                input.release()
            case .incoming(.control(.resume)):
                cursor.reveal()
                gate.resume()
                cursor.dim(false)
            case let .fatal(fault):
                fail("protocol fault \(fault)", code: ExitCode.protocolFault)
            }
        }
        // End of input is the graceful shutdown signal: finish queued work, then leave.
        if bytes.isEmpty { requests.async { leave(ExitCode.normal) }; return }
    }
}
reader.start()

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
withExtendedLifetime(watch) { application.run() }
