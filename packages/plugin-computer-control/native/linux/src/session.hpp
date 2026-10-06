#pragma once
#include <map>
#include <memory>
#include <optional>
#include <string>

#include "accessibility.hpp"
#include "apps.hpp"
#include "cursor.hpp"
#include "desktop.hpp"
#include "guard.hpp"
#include "json.hpp"
#include "preview.hpp"

namespace moxxy {

/// What the helper remembers about one app between requests.
struct TargetState {
  IndexRegistry registry;
  Handles handles;
  /// The element behind each index of the last observation.
  std::map<int, int> elements;
  /// Screen frames of those elements when they were observed.
  std::map<int, Rect> frames;
  /// The element that had keyboard focus then.
  std::optional<int> focused;
  /// Maps the last screenshot's pixels to the screen.
  std::optional<ImageFrame> frame;
  std::optional<Pixels> pixels;
  /// The observed window; 0 when the app had none.
  Window window = 0;
  Rect window_frame;
  /// Actions need indices from an observation made by this helper.
  bool observed = false;
  double last_action = -1e9;
  /// A click that went through accessibility and changed nothing to see; asked again, it becomes a real click.
  std::string last_soft;
};

/// Everything a request can touch. Used from the request thread only.
struct Session {
  std::unique_ptr<Desktop> desktop;
  std::unique_ptr<Accessibility> accessibility;
  std::unique_ptr<AgentCursor> cursor;
  ControlGate* gate = nullptr;
  UserActivity* activity = nullptr;
  PreviewStream* preview = nullptr;
  /// The process Moxxy runs in; real input never goes to its windows.
  pid_t host = 0;
  std::map<std::string, TargetState> targets;

  /// Throws `HelperError`.
  Json handle(const std::string& method, const Json& params);

 private:
  Json status();
  Json list_apps(const Json& params);
  Json resolve_apps(const Json& params);
  Json app_state(const std::string& app, bool screenshot);
  Json act(const Json& params);
  Json zoom(const Json& params);
};

}  // namespace moxxy
