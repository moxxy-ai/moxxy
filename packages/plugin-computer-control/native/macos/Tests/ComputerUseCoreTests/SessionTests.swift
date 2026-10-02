import Foundation
import Testing
@testable import ComputerUseCore

private func line(_ text: String) -> Data { Data(text.utf8) }

private func replyObject(_ data: Data) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: data.dropLast()) as? [String: Any])
}

private let echo = Dispatcher(handlers: [
    "echo": { params in params },
    "refuse": { _ in throw HelperError(code: "tier_insufficient", message: "read only") },
    "crash": { _ in throw CocoaError(.fileNoSuchFile) },
])

@Suite struct DispatcherTests {
    @Test func answersWithTheHandlerResult() throws {
        let reply = try replyObject(echo.handle(id: "1", method: "echo", params: .object(["a": .number(1)])))
        #expect(reply["ok"] as? Bool == true)
        #expect((reply["result"] as? [String: Any])?["a"] as? Int == 1)
    }

    @Test func keepsTheCodeOfARefusal() throws {
        let reply = try replyObject(echo.handle(id: "2", method: "refuse", params: .null))
        #expect(reply["error"] as? [String: String] == ["code": "tier_insufficient", "message": "read only"])
    }

    @Test func reportsAnUnexpectedFailureWithoutItsDetails() throws {
        let reply = try replyObject(echo.handle(id: "3", method: "crash", params: .null))
        #expect((reply["error"] as? [String: String])?["code"] == "helper_failed")
    }

    @Test func refusesAnUnknownMethod() throws {
        let reply = try replyObject(echo.handle(id: "4", method: "teleport", params: .null))
        #expect((reply["error"] as? [String: String])?["code"] == "unsupported_action")
    }
}

@Suite struct ProtocolSessionTests {
    @Test func decodesFramesInOrderIncludingControl() {
        var session = ProtocolSession()
        let frames = session.receive(line(
            "{\"version\":5,\"id\":\"a\",\"method\":\"echo\",\"params\":1}\n{\"version\":5,\"control\":\"resume\"}\n{\"version\":5,\"id\":\"b\",\"method\":\"echo\",\"params\":2}\n"
        ))
        #expect(frames == [
            .incoming(.request(id: "a", method: "echo", params: .number(1))),
            .incoming(.control(.resume)),
            .incoming(.request(id: "b", method: "echo", params: .number(2))),
        ])
    }

    @Test func stopsAtTheFirstProtocolFault() {
        var session = ProtocolSession()
        let frames = session.receive(line("{\"version\":3,\"id\":\"a\",\"method\":\"echo\",\"params\":1}\n{\"version\":5,\"id\":\"b\",\"method\":\"echo\",\"params\":2}\n"))
        #expect(frames == [.fatal(.versionMismatch(3))])
        #expect(session.receive(line("{\"version\":5,\"id\":\"c\",\"method\":\"echo\",\"params\":3}\n")) == [])
    }

    @Test func reportsATruncatedFinalFrame() {
        var session = ProtocolSession()
        _ = session.receive(line("{\"version\":5"))
        #expect(session.finish() == .fatal(.truncatedFrame))
        var clean = ProtocolSession()
        #expect(clean.finish() == nil)
    }
}

@Suite struct StandardMethodsTests {
    let dispatcher = Methods.standard(permissions: SystemPermissions())

    @Test func statusReportsTheRealPermissionsAndWhatIsMissing() throws {
        let reply = try replyObject(dispatcher.handle(id: "s", method: "status", params: .object([:])))
        let result = try #require(reply["result"] as? [String: Any])
        let permissions = try #require(result["permissions"] as? [String: Bool])
        let accessibility = try #require(permissions["accessibility"])
        let screenRecording = try #require(permissions["screenRecording"])
        #expect(result["ready"] as? Bool == (accessibility && screenRecording))
        let limitations = try #require(result["limitations"] as? [String])
        #expect(limitations.count == [accessibility, screenRecording].filter { !$0 }.count)
    }

    @Test func refusesAnUnknownPermissionKind() throws {
        let reply = try replyObject(dispatcher.handle(id: "p", method: "permissions.request", params: .object(["kind": .string("camera")])))
        #expect((reply["error"] as? [String: String])?["code"] == "invalid_params")
    }
}

@Suite struct ParentWatchTests {
    @Test(.timeLimit(.minutes(1))) func firesWhenTheParentExits() async throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["0.3"]
        try child.run()
        let (exits, signal) = AsyncStream<Void>.makeStream()
        let watch = try #require(ParentWatch(pid: child.processIdentifier, queue: .global()) { signal.yield() })
        var iterator = exits.makeAsyncIterator()
        #expect(await iterator.next() != nil)
        withExtendedLifetime(watch) {}
    }

    @Test func refusesAParentThatIsAlreadyGone() throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try child.run()
        child.waitUntilExit()
        #expect(ParentWatch(pid: child.processIdentifier, queue: .global()) {} == nil)
    }
}
