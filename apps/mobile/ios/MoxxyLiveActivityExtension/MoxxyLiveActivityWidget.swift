import ActivityKit
import SwiftUI
import WidgetKit

@main
struct MoxxyLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    MoxxyLiveActivityWidget()
  }
}

struct MoxxyLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MoxxyActivityAttributes.self) { context in
      MoxxyLiveActivityLockScreenView(context: context)
        .activityBackgroundTint(MoxxyLiveActivityStyle.background)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          MoxxyIslandTitle(context: context)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(statusLabel(for: context.state))
            .font(.caption.bold())
            .foregroundStyle(MoxxyLiveActivityStyle.accent)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            MoxxyProgressRail(progress: context.state.progress)
            Text(activityDetail(for: context.state))
              .font(.caption)
              .lineLimit(1)
              .truncationMode(.tail)
              .foregroundStyle(.white.opacity(0.82))
          }
        }
      } compactLeading: {
        Image(systemName: iconName(for: context.state.phase))
          .foregroundStyle(MoxxyLiveActivityStyle.accent)
      } compactTrailing: {
        Text(compactStatusLabel(for: context.state))
          .font(.caption2.bold())
          .foregroundStyle(MoxxyLiveActivityStyle.accent)
          .lineLimit(1)
          .minimumScaleFactor(0.72)
      } minimal: {
        Image(systemName: iconName(for: context.state.phase))
          .foregroundStyle(MoxxyLiveActivityStyle.accent)
      }
      .widgetURL(URL(string: "moxxy-mobile://chat"))
      .keylineTint(MoxxyLiveActivityStyle.accent)
    }
  }
}

private struct MoxxyLiveActivityLockScreenView: View {
  let context: ActivityViewContext<MoxxyActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .center, spacing: 12) {
        ZStack {
          RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(MoxxyLiveActivityStyle.accent.opacity(0.18))
          Image(systemName: iconName(for: context.state.phase))
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(MoxxyLiveActivityStyle.accent)
        }
        .frame(width: 44, height: 44)

        VStack(alignment: .leading, spacing: 3) {
          Text(activityTitle(for: context))
            .font(.headline.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
          Text(activityDetail(for: context.state))
            .font(.subheadline)
            .foregroundStyle(.white.opacity(0.72))
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(0.86)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .layoutPriority(1)

        Spacer(minLength: 8)

        Text(statusLabel(for: context.state))
          .font(.caption.weight(.bold))
          .foregroundStyle(statusColor(for: context.state.phase))
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(statusColor(for: context.state.phase).opacity(0.16), in: Capsule())
      }

      MoxxyProgressRail(progress: context.state.progress)

      HStack(spacing: 8) {
        Label(activitySubtitle(for: context), systemImage: "folder")
        Spacer(minLength: 10)
        if context.state.subagentCount > 0 {
          Label("\(context.state.subagentCount)", systemImage: "person.3")
        }
        if context.state.pendingCount > 0 {
          Label("\(context.state.pendingCount) pending", systemImage: "checkmark.circle")
        }
      }
      .font(.caption2.weight(.medium))
      .foregroundStyle(.white.opacity(0.64))
      .lineLimit(1)
    }
    .padding(16)
  }
}

private struct MoxxyIslandTitle: View {
  let context: ActivityViewContext<MoxxyActivityAttributes>

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: iconName(for: context.state.phase))
        .foregroundStyle(MoxxyLiveActivityStyle.accent)
      VStack(alignment: .leading, spacing: 1) {
        Text(activityTitle(for: context))
          .font(.caption.bold())
          .lineLimit(1)
          .truncationMode(.tail)
        Text(activityDetail(for: context.state))
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .layoutPriority(1)
    }
  }
}

private struct MoxxyProgressRail: View {
  let progress: Double

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule()
          .fill(.white.opacity(0.16))
        Capsule()
          .fill(
            LinearGradient(
              colors: [MoxxyLiveActivityStyle.accent, MoxxyLiveActivityStyle.warmAccent],
              startPoint: .leading,
              endPoint: .trailing
            )
          )
          .frame(width: max(8, proxy.size.width * min(max(progress, 0), 1)))
      }
    }
    .frame(height: 7)
  }
}

private enum MoxxyLiveActivityStyle {
  static let background = Color(red: 0.055, green: 0.058, blue: 0.078)
  static let accent = Color(red: 0.92, green: 0.18, blue: 0.55)
  static let warmAccent = Color(red: 1.0, green: 0.55, blue: 0.16)
}

private func statusLabel(for state: MoxxyActivityAttributes.ContentState) -> String {
  switch state.phase {
  case "waiting":
    return "Action"
  case "completed":
    return "Done"
  case "failed":
    return "Failed"
  case "tool":
    return state.currentTool ?? "Tool"
  case "subagents":
    return "Agents"
  default:
    return "Live"
  }
}

private func compactStatusLabel(for state: MoxxyActivityAttributes.ContentState) -> String {
  switch state.phase {
  case "waiting":
    return "Ask"
  case "completed":
    return "Done"
  case "failed":
    return "!"
  case "tool":
    return state.currentTool ?? "Tool"
  case "subagents":
    return "AI"
  default:
    return "Live"
  }
}

private func statusColor(for phase: String) -> Color {
  switch phase {
  case "completed":
    return .green
  case "failed":
    return .red
  case "waiting":
    return .orange
  default:
    return MoxxyLiveActivityStyle.accent
  }
}

private func iconName(for phase: String) -> String {
  switch phase {
  case "waiting":
    return "checkmark.circle"
  case "completed":
    return "sparkles"
  case "failed":
    return "exclamationmark.triangle"
  case "tool":
    return "wrench.and.screwdriver"
  case "subagents":
    return "person.3"
  default:
    return "bolt"
  }
}

private func activityTitle(for context: ActivityViewContext<MoxxyActivityAttributes>) -> String {
  if let title = context.state.title, !title.isEmpty {
    return title
  }
  return context.attributes.title
}

private func activitySubtitle(for context: ActivityViewContext<MoxxyActivityAttributes>) -> String {
  if let subtitle = context.state.subtitle, !subtitle.isEmpty {
    return subtitle
  }
  return context.attributes.subtitle
}

private func activityDetail(for state: MoxxyActivityAttributes.ContentState) -> String {
  let detail = state.detail.trimmingCharacters(in: .whitespacesAndNewlines)
  guard detail.count > 48 else {
    return detail
  }
  return "\(detail.prefix(47))…"
}
