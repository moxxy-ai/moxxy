import ActivityKit
import Foundation
import React
import UserNotifications

@objc(MoxxyLiveActivity)
class MoxxyLiveActivity: NSObject {
  private var activeActivityId: String?

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(isAvailable:rejecter:)
  func isAvailable(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.1, *) else {
      resolve(false)
      return
    }
    resolve(ActivityAuthorizationInfo().areActivitiesEnabled)
  }

  @objc(startOrUpdate:resolver:rejecter:)
  func startOrUpdate(
    _ snapshot: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.1, *) else {
      resolve(["active": false])
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      resolve(["active": false])
      return
    }
    guard let payload = LiveActivityPayload(snapshot: snapshot) else {
      reject("invalid_snapshot", "Invalid Moxxy live activity snapshot.", nil)
      return
    }

    Task {
      do {
        let activity = try await self.activity(for: payload)
        await activity.update(using: payload.contentState)
        self.activeActivityId = activity.id
        resolve([
          "active": true,
          "activityId": activity.id,
          "pushToken": NSNull(),
        ])
      } catch {
        reject("activity_start_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(end:resolver:rejecter:)
  func end(
    _ snapshot: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.1, *) else {
      resolve(nil)
      return
    }
    guard let payload = LiveActivityPayload(snapshot: snapshot) else {
      resolve(nil)
      return
    }

    Task {
      let activities = self.activities(forSessionId: payload.attributes.sessionId)
      for activity in activities {
        await activity.end(
          using: payload.contentState,
          dismissalPolicy: .after(Date().addingTimeInterval(20))
        )
      }
      if let activeActivityId, activities.contains(where: { $0.id == activeActivityId }) {
        self.activeActivityId = nil
      }
      resolve(nil)
    }
  }

  @objc(requestNotificationAuthorization:rejecter:)
  func requestNotificationAuthorization(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
        resolve(["granted": true])
        return
      }
      center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        if let error {
          reject("notification_permission_failed", error.localizedDescription, error)
          return
        }
        resolve(["granted": granted])
      }
    }
  }

  @objc(notifyCompletion:resolver:rejecter:)
  func notifyCompletion(
    _ notification: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let title = notification["title"] as? String ?? "Moxxy"
    let body = notification["body"] as? String ?? "Task updated."
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let request = UNNotificationRequest(
      identifier: "moxxy-live-\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request) { error in
      if let error {
        reject("notification_failed", error.localizedDescription, error)
        return
      }
      resolve(nil)
    }
  }

  @available(iOS 16.1, *)
  private func activity(
    for payload: LiveActivityPayload
  ) async throws -> Activity<MoxxyActivityAttributes> {
    if let existing = preferredActivity(from: activities(forSessionId: payload.attributes.sessionId)) {
      await endDuplicateActivities(
        keeping: existing.id,
        forSessionId: payload.attributes.sessionId,
        contentState: payload.contentState
      )
      return existing
    }
    if let activeActivityId,
       let active = Activity<MoxxyActivityAttributes>.activities.first(where: { $0.id == activeActivityId }) {
      await active.end(dismissalPolicy: .immediate)
      self.activeActivityId = nil
    }
    let activity = try Activity.request(
      attributes: payload.attributes,
      contentState: payload.contentState,
      pushType: nil
    )
    await endDuplicateActivities(
      keeping: activity.id,
      forSessionId: payload.attributes.sessionId,
      contentState: payload.contentState
    )
    return activity
  }

  @available(iOS 16.1, *)
  private func activities(forSessionId sessionId: String) -> [Activity<MoxxyActivityAttributes>] {
    Activity<MoxxyActivityAttributes>.activities.filter { activity in
      activity.attributes.sessionId == sessionId
    }
  }

  @available(iOS 16.1, *)
  private func preferredActivity(
    from activities: [Activity<MoxxyActivityAttributes>]
  ) -> Activity<MoxxyActivityAttributes>? {
    if let activeActivityId,
       let active = activities.first(where: { $0.id == activeActivityId }) {
      return active
    }
    return activities.first
  }

  @available(iOS 16.1, *)
  private func endDuplicateActivities(
    keeping activityId: String,
    forSessionId sessionId: String,
    contentState: MoxxyActivityAttributes.ContentState
  ) async {
    for activity in activities(forSessionId: sessionId) where activity.id != activityId {
      await activity.end(using: contentState, dismissalPolicy: .immediate)
    }
  }
}

@available(iOS 16.1, *)
private struct LiveActivityPayload {
  let attributes: MoxxyActivityAttributes
  let contentState: MoxxyActivityAttributes.ContentState

  init?(snapshot: NSDictionary) {
    guard
      let sessionId = snapshot["sessionId"] as? String,
      let workspaceId = snapshot["workspaceId"] as? String,
      let title = snapshot["title"] as? String,
      let subtitle = snapshot["subtitle"] as? String,
      let phase = snapshot["phase"] as? String,
      let detail = snapshot["detail"] as? String
    else {
      return nil
    }

    let progress = min(max(snapshot["progress"] as? Double ?? 0, 0), 1)
    let pendingCount = snapshot["pendingCount"] as? Int ?? 0
    let subagentCount = snapshot["subagentCount"] as? Int ?? 0
    let currentTool = snapshot["currentTool"] as? String

    attributes = MoxxyActivityAttributes(
      sessionId: sessionId,
      workspaceId: workspaceId,
      title: title,
      subtitle: subtitle
    )
    contentState = MoxxyActivityAttributes.ContentState(
      workspaceId: workspaceId,
      title: title,
      subtitle: subtitle,
      phase: phase,
      detail: detail,
      currentTool: currentTool,
      progress: progress,
      pendingCount: pendingCount,
      subagentCount: subagentCount,
      updatedAt: Date()
    )
  }
}
