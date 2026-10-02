import Foundation

/// Where a request's time goes, written to the file named by `MOXXY_COMPUTER_TIMING`; off without it.
enum Timing {
    private static let path = ProcessInfo.processInfo.environment["MOXXY_COMPUTER_TIMING"]
    nonisolated(unsafe) private static var last = ProcessInfo.processInfo.systemUptime

    /// Appends the time since the mark before it.
    static func mark(_ label: @autoclosure () -> String) {
        guard let path else { return }
        let now = ProcessInfo.processInfo.systemUptime
        let line = Data(String(format: "%6.0f ms  %@\n", (now - last) * 1000, label()).utf8)
        last = now
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(line)
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: path, contents: line)
        }
    }
}
