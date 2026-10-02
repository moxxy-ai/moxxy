import ApplicationServices
import Foundation

/// Several steps on one app in one request (Claude's `computer_batch`): every step passes its own gates,
/// the first one that is not delivered ends the batch, and the app's state comes back once at the end.
public enum Batch {
    static let limit = 50
    static let pausedHint = "The user paused Computer Use during the batch; the remaining steps were not run. Look at the fresh state before going on."

    /// `waitedOut` is asked before each step and is `true` when the step had to wait for the user.
    static func run(_ steps: [ActionRequest], waitedOut: () -> Bool, perform: (ActionRequest) -> ActionResult) -> [ActionResult] {
        var results: [ActionResult] = []
        for step in steps {
            if waitedOut() {
                results.append(.blocked("user_intervened", hint: pausedHint))
                break
            }
            let result = perform(step)
            results.append(result)
            if result.outcome != .delivered { break }
        }
        return results
    }
}

extension Methods {
    /// Short settling between steps, so a step sees what the one before it opened or focused.
    static let betweenSteps = SettlePolicy(minimum: 0.1, quiet: 0.2, maximum: 2.0)

    static func batch(_ params: JSONValue, targets: Targets, cursor: AgentCursor?, input: InputSessions) throws -> JSONValue {
        let app = try grantedApp(params)
        guard case let .array(raw)? = params["actions"], (1...Batch.limit).contains(raw.count) else {
            throw HelperError.invalidParams("actions must hold 1 to \(Batch.limit) steps")
        }
        // Every step is understood before the first one runs.
        let steps = try raw.map(ActionRequest.parse)
        let state = targets.state(for: app)
        guard state.observed else { return .object(["results": .array([ActionResult.blocked("no_state").json])]) }
        var first = true
        let results = Batch.run(steps, waitedOut: {
            if !first, let root = state.root, let pid = state.window?.pid { Settler.settle(pid: pid, policy: betweenSteps) { BusyProbe.isBusy(window: root) } }
            first = false
            return input.gate?.waitWhilePaused() == true
        }) { step in
            let result = Executor(state: state, cursor: cursor, input: input).perform(step)
            if result.outcome == .delivered { state.lastAction = Date() }
            return result
        }
        let fresh = try appState(.object(["app": .string(app), "screenshot": .bool(true)]), targets: targets, cursor: cursor)
        return .object(["results": .array(results.map(\.json)), "state": fresh])
    }
}
