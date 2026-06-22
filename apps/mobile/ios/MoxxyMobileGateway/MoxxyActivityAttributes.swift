import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct MoxxyActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var phase: String
    var detail: String
    var currentTool: String?
    var progress: Double
    var pendingCount: Int
    var subagentCount: Int
    var updatedAt: Date
  }

  var sessionId: String
  var workspaceId: String
  var title: String
  var subtitle: String
}
