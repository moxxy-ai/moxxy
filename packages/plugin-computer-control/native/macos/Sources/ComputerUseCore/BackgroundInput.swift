import CoreGraphics
import Darwin
import Foundation

/// One window of an app as the window server knows it; `origin` is its top-left corner on screen.
public struct WindowAddress: Equatable, Sendable {
    public let pid: pid_t
    public let id: CGWindowID
    public let origin: CGPoint
}

/// Where a pointer gesture is sent.
public enum PointerRoute: Equatable, Sendable {
    /// Straight to a window of an app that stays in the background; the user's pointer does not move.
    case window(WindowAddress)
    /// Through the screen like a hand on the mouse: the app comes forward and the pointer moves, then returns.
    case screen

    /// `repeated` means the model asked for this same gesture last time and it went to the window.
    public static func choose(available: Bool, window: WindowAddress?, button: MouseButton, repeated: Bool) -> PointerRoute {
        guard available, button == .left, !repeated, let window else { return .screen }
        return .window(window)
    }
}

/// What a mouse event must carry to reach a window that is not under the pointer. The field numbers and the
/// focus record are undocumented; the same recipe is used by open-computer-use, Cua Driver and yabai (all MIT).
public enum WindowEvent {
    public enum Field {
        public static let gesturePhase: UInt32 = 0
        public static let clickState: UInt32 = 1
        public static let buttonNumber: UInt32 = 3
        public static let subtype: UInt32 = 7
        public static let targetPID: UInt32 = 40
        public static let windowNumber: UInt32 = 51
        public static let clickGroup: UInt32 = 58
        public static let windowUnderPointer: UInt32 = 91
        public static let handlingWindowUnderPointer: UInt32 = 92
    }

    public struct Stamp: Equatable, Sendable {
        public let fields: [UInt32: Int64]
        /// The point inside the window, from its top-left corner.
        public let location: CGPoint
    }

    /// A point no window covers, where the primer press lands.
    public static let primer = CGPoint(x: -1, y: -1)
    static let afterPrimer: TimeInterval = 0.1

    public static func stamp(_ step: MouseStep, to window: WindowAddress, group: Int64) -> Stamp {
        let primed = step.point == primer
        let phase: Int64 = switch step.type {
        case .mouseMoved: 2
        case .leftMouseDown where primed: 1
        case .leftMouseUp where primed: 2
        default: 3
        }
        let id = Int64(window.id)
        return Stamp(
            fields: [
                Field.gesturePhase: phase, Field.clickState: Int64(step.clickState), Field.buttonNumber: 0, Field.subtype: 3,
                Field.targetPID: Int64(window.pid), Field.windowNumber: id, Field.clickGroup: group,
                Field.windowUnderPointer: id, Field.handlingWindowUnderPointer: id,
            ],
            location: primed ? primer : CGPoint(x: step.point.x - window.origin.x, y: step.point.y - window.origin.y)
        )
    }

    /// Browser engines take a click in a background window only after a press and release that hit nothing.
    public static func withPrimer(_ steps: [MouseStep]) -> [MouseStep] {
        guard let press = steps.firstIndex(where: { $0.type == .leftMouseDown }) else { return steps }
        let first = steps[press]
        var primed = steps
        primed[press] = MouseStep(type: first.type, point: first.point, button: first.button, clickState: first.clickState, delay: first.delay + afterPrimer)
        primed.insert(contentsOf: [
            MouseStep(type: .leftMouseDown, point: primer, button: .left, clickState: 1, delay: 0.015),
            MouseStep(type: .leftMouseUp, point: primer, button: .left, clickState: 1, delay: 0.001),
        ], at: press)
        return primed
    }

    /// Tells an app that one of its windows gained or lost focus, without changing which app is in front.
    public static func focusRecord(window: CGWindowID, focused: Bool) -> [UInt8] {
        var record = [UInt8](repeating: 0, count: 0xF8)
        record[0x04] = 0xF8
        record[0x08] = 0x0D
        for byte in 0..<4 { record[0x3C + byte] = UInt8(truncatingIfNeeded: window >> (8 * UInt32(byte))) }
        record[0x8A] = focused ? 1 : 2
        return record
    }
}

/// The private window-server calls behind the window route, looked up at run time. A system without them
/// reports `available == false` and every gesture goes through the screen. All undocumented ABI stays in this type.
final class WindowServerLink: @unchecked Sendable {
    static let shared = WindowServerLink()

    private typealias Post = @convention(c) (pid_t, UnsafeMutableRawPointer?) -> Void
    private typealias SetField = @convention(c) (UnsafeMutableRawPointer?, UInt32, Int64) -> Void
    private typealias SetLocation = @convention(c) (UnsafeMutableRawPointer?, Double, Double) -> Void
    private typealias PostRecord = @convention(c) (UnsafeRawPointer?, UnsafePointer<UInt8>?) -> Int32
    private typealias ProcessFor = @convention(c) (pid_t, UnsafeMutableRawPointer?) -> Int32

    private let post: Post?
    private let setField: SetField?
    private let setLocation: SetLocation?
    private let postRecord: PostRecord?
    private let processFor: ProcessFor?

    private init() {
        let skyLight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
        let services = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY)
        post = Self.symbol(skyLight, "SLEventPostToPid")
        setField = Self.symbol(skyLight, "SLEventSetIntegerValueField")
        setLocation = Self.symbol(skyLight, "CGEventSetWindowLocation")
        postRecord = Self.symbol(skyLight, "SLPSPostEventRecordTo")
        processFor = Self.symbol(services, "GetProcessForPID")
    }

    var available: Bool { post != nil && setField != nil && setLocation != nil && postRecord != nil && processFor != nil }

    func send(_ event: CGEvent, stamp: WindowEvent.Stamp, to pid: pid_t) {
        guard let post, let setField, let setLocation else { return }
        let raw = Unmanaged.passUnretained(event).toOpaque()
        for (field, value) in stamp.fields { setField(raw, field, value) }
        setLocation(raw, stamp.location.x, stamp.location.y)
        post(pid, raw)
    }

    /// `false` when the system refused, in which case the app keeps the focus state it had.
    @discardableResult func focus(_ window: WindowAddress, _ focused: Bool) -> Bool {
        guard let postRecord, let processFor else { return false }
        var process = [UInt8](repeating: 0, count: 8)
        guard process.withUnsafeMutableBytes({ processFor(window.pid, $0.baseAddress) }) == 0 else { return false }
        let record = WindowEvent.focusRecord(window: window.id, focused: focused)
        let status = process.withUnsafeBytes { serial in record.withUnsafeBufferPointer { postRecord(serial.baseAddress, $0.baseAddress) } }
        Thread.sleep(forTimeInterval: 0.04)
        return status == 0
    }

    private static func symbol<T>(_ handle: UnsafeMutableRawPointer?, _ name: String) -> T? {
        guard let handle, let pointer = dlsym(handle, name) else { return nil }
        return unsafeBitCast(pointer, to: T.self)
    }
}
