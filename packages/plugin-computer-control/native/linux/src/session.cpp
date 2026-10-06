#include "session.hpp"

#include <X11/keysym.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fcntl.h>
#include <fstream>
#include <gio/gdesktopappinfo.h>
#include <thread>
#include <unistd.h>

#include "jpeg.hpp"
#include "text.hpp"
#include "wire.hpp"

namespace moxxy {

namespace {

constexpr size_t tree_limit = 1000;
constexpr double launch_timeout = 10, window_timeout = 5;

void pause(double seconds) { std::this_thread::sleep_for(std::chrono::duration<double>(seconds)); }

std::string file_name(const std::string& path) {
  const auto slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

ProcessFacts facts(const WindowInfo& window) {
  ProcessFacts found{window.instance, window.app_class, {}};
  if (window.pid <= 0) return found;
  const auto directory = "/proc/" + std::to_string(window.pid);
  char target[4096];
  const auto length = readlink((directory + "/exe").c_str(), target, sizeof target - 1);
  if (length > 0) found.programs.push_back(file_name(std::string(target, static_cast<size_t>(length))));
  // A script runs inside an interpreter: its own name is one of the first arguments.
  std::ifstream arguments(directory + "/cmdline", std::ios::binary);
  std::string argument;
  for (int index = 0; index < 3 && std::getline(arguments, argument, '\0'); index++) found.programs.push_back(file_name(argument));
  return found;
}

std::vector<AppRecord> installed() {
  std::vector<AppRecord> apps;
  GList* all = g_app_info_get_all();
  for (GList* item = all; item; item = item->next) {
    GAppInfo* info = G_APP_INFO(item->data);
    const char* id = g_app_info_get_id(info);
    if (id && g_app_info_should_show(info) && G_IS_DESKTOP_APP_INFO(info)) {
      std::string name(id);
      if (name.ends_with(".desktop")) name.resize(name.size() - 8);
      const char* command = g_app_info_get_commandline(info);
      const char* wm_class = g_desktop_app_info_get_startup_wm_class(G_DESKTOP_APP_INFO(info));
      const char* shown = g_app_info_get_display_name(info);
      apps.push_back({clean_utf8(name), clean_utf8(shown ? shown : name.c_str()), catalog::program_of(command ? command : ""), wm_class ? wm_class : "", false});
    }
    g_object_unref(info);
  }
  g_list_free(all);
  return apps;
}

/// Every app with the windows it has open, topmost first.
struct Scan {
  std::vector<AppRecord> apps;
  std::map<std::string, std::vector<WindowInfo>> windows;
};

Scan scan(Desktop& desktop) {
  const auto known = installed();
  Scan found;
  std::vector<AppRecord> running;
  for (const auto& window : desktop.windows()) {
    if (!window.viewable) continue;
    const auto process = facts(window);
    const auto owner = std::find_if(known.begin(), known.end(), [&](const AppRecord& app) { return catalog::owns(app, process); });
    AppRecord record;
    if (owner != known.end()) record = *owner;
    else if (!window.app_class.empty() || !window.instance.empty()) {
      // A program with no desktop file is known by its window class.
      const auto& name = window.app_class.empty() ? window.instance : window.app_class;
      record = {name, name, process.programs.empty() ? "" : process.programs.front(), name, false};
    } else continue;
    record.running = true;
    if (!found.windows.contains(record.id)) running.push_back(record);
    found.windows[record.id].push_back(window);
  }
  found.apps = catalog::merge(std::move(running), known);
  return found;
}

Json reference(const AppRecord& app) { return Json::Object{{"id", fit(app.id, 512)}, {"name", fit(app.name, 512)}}; }

/// Starts an installed app with nothing of this helper's attached: its output must never reach the protocol pipe.
void launch(const std::string& id) {
  GDesktopAppInfo* info = g_desktop_app_info_new((id + ".desktop").c_str());
  if (!info) throw HelperError{"app_not_found", "No application with identifier " + id};
  const int nowhere = open("/dev/null", O_RDWR | O_CLOEXEC);
  GError* error = nullptr;
  const bool started = g_desktop_app_info_launch_uris_as_manager_with_fds(info, nullptr, nullptr, G_SPAWN_SEARCH_PATH, nullptr, nullptr, nullptr, nullptr,
                                                                          nowhere, nowhere, nowhere, &error);
  if (nowhere >= 0) close(nowhere);
  g_object_unref(info);
  if (!started) {
    const std::string reason = error ? error->message : "unknown reason";
    g_clear_error(&error);
    throw HelperError{"helper_failed", id + " could not be started: " + clean_utf8(reason)};
  }
}

bool same_place(const Rect& left, const Rect& right) {
  return std::abs(left.x - right.x) <= 1 && std::abs(left.y - right.y) <= 1 && std::abs(left.width - right.width) <= 1 && std::abs(left.height - right.height) <= 1;
}

std::optional<int> focused_index(const Node&, const BuiltTree& built, const std::vector<int>& indices) {
  for (size_t at = 0; at < built.elements.size(); at++) {
    const auto& states = built.elements[at].states;
    if (std::find(states.begin(), states.end(), "focused") != states.end()) return indices[at];
  }
  return std::nullopt;
}

/// Runs one step against the elements of the last observation, accessibility first.
struct Executor {
  Session& session;
  TargetState& state;
  Desktop& desktop;

  static constexpr const char* no_window = "The app has no open window to act on.";

  ActionResult perform(const ActionRequest& request, bool retried) {
    const auto result = run(request, retried);
    if (session.cursor) session.cursor->phase(result.outcome == "delivered" ? "delivered" : "failed");
    return result;
  }

  const Live* live(int index) const {
    const auto found = state.elements.find(index);
    if (found == state.elements.end()) return nullptr;
    const auto& element = state.handles.at(found->second);
    return Accessibility::alive(element.object) ? &element : nullptr;
  }

  std::optional<Rect> current_origin() const {
    const auto window = desktop.info(state.window);
    return window ? std::optional(window->frame) : std::nullopt;
  }

  std::optional<std::pair<double, double>> centre(const Live& element) const {
    const auto origin = current_origin();
    const auto frame = origin ? Accessibility::frame(element.object, *origin) : std::nullopt;
    return frame ? std::optional(std::pair{frame->x + frame->width / 2, frame->y + frame->height / 2}) : std::nullopt;
  }

  /// A screenshot point on the screen, when it still shows what the model aimed at: the window is where it was
  /// and the pixels around the point are the same.
  std::variant<std::pair<double, double>, ActionResult> aim(double x, double y) {
    if (!state.frame || !state.pixels || !state.window) return ActionResult::blocked("no_state", "Observe the app with a screenshot before acting by coordinates.");
    const auto screen = state.frame->to_screen(x, y);
    if (!screen) return ActionResult::blocked("point_outside_frame");
    const auto current = desktop.capture(state.window);
    if (!current || !same_place(current->bounds, state.frame->bounds)) {
      return ActionResult::blocked("stale_state", "The window moved, changed size or was replaced since the screenshot; aim again in the fresh state.");
    }
    const auto shown = scale(current->pixels, state.pixels->width, state.pixels->height);
    if (patch_changed(*state.pixels, shown, static_cast<int>(x), static_cast<int>(y))) return ActionResult::blocked("screen_changed");
    return *screen;
  }

  std::optional<ActionResult> wait_for_quiet() {
    if (!session.activity) return std::nullopt;
    for (int attempt = 0;; attempt++) {
      const auto decision = quiet_wait(session.activity->seconds_since_input(), attempt);
      if (decision.kind == QuietDecision::go) return std::nullopt;
      if (decision.kind == QuietDecision::refuse) {
        return ActionResult::blocked("user_intervened", "The user is using the mouse or keyboard right now, and real input would fight them. Nothing was done; retry after a pause, or use element actions, which work in the background.");
      }
      pause(decision.seconds);
    }
  }

  /// Keys and real clicks go to whatever is in front, so the app's window comes forward first.
  std::optional<ActionResult> in_front() {
    if (!state.window) return ActionResult::unsupported(no_window);
    if (!desktop.has_input()) return ActionResult::unsupported("This display accepts no synthetic input (the XTEST extension is missing).");
    if (auto busy = wait_for_quiet()) return busy;
    if (!desktop.activate(state.window, 2)) return ActionResult::blocked("not_frontmost", "The window manager did not bring the app's window forward.");
    return std::nullopt;
  }

  /// Real pointer input at screen points: the window comes forward, every point must land on it, and the
  /// user's pointer goes back where it was.
  ActionResult physically(const std::vector<std::pair<double, double>>& points, const std::vector<unsigned long>& held, const std::function<void()>& send) {
    if (auto refused = in_front()) return *refused;
    const auto [width, height] = desktop.screen_size();
    for (const auto& [x, y] : points) {
      if (x < 0 || y < 0 || x >= width || y >= height) return ActionResult::blocked("point_outside_frame", "That point of the window is off the screen; move or scroll the content into view first.");
      // A window that just came forward is restacked a moment later.
      std::pair<pid_t, bool> owner;
      desktop.wait_for([&] { owner = desktop.owner_at(x, y, state.window); return owner.second; }, 0.5);
      if (owner.second) continue;
      return ActionResult::blocked(owner.first == session.host ? "own_window" : "hit_test_mismatch");
    }
    const auto home = desktop.pointer();
    if (session.cursor) { session.cursor->move(points.front().first, points.front().second); session.cursor->phase("executing"); }
    for (const auto modifier : held) desktop.key(modifier, true);
    send();
    for (auto modifier = held.rbegin(); modifier != held.rend(); ++modifier) desktop.key(*modifier, false);
    desktop.sync();
    // The app reads the pointer's place when it handles the event, a moment after it was sent.
    pause(0.05);
    desktop.move(home.first, home.second);
    desktop.sync();
    return ActionResult::delivered("input");
  }

  ActionResult click_at(double x, double y, const ActionRequest& request) {
    return physically({{x, y}}, request.held, [&] {
      desktop.move(x, y);
      pause(0.03);
      desktop.click(request.button, request.count);
    });
  }

  /// A plain click on a control is its own accessibility action, which works while the app is in the background.
  std::optional<ActionResult> press(const Live& element, const ActionRequest& request, bool retried) {
    if (retried || request.count != 1 || request.button != 1 || !request.held.empty() || !pressable(element.role)) return std::nullopt;
    const auto action = press_action(element.actions);
    if (!action) return std::nullopt;
    if (session.cursor) if (const auto point = centre(element)) { session.cursor->move(point->first, point->second); session.cursor->phase("executing"); }
    const auto result = Accessibility::act(element, *action);
    return result.outcome == "unsupported" ? std::nullopt : std::optional(result);
  }

  ActionResult type(const std::string& text, const Live* element) {
    if (element && element->editable) {
      if (session.cursor) if (const auto point = centre(*element)) { session.cursor->move(point->first, point->second); session.cursor->phase("executing"); }
      if (Accessibility::insert(element->object, text)) return ActionResult::delivered("ax");
    }
    if (auto refused = in_front()) return *refused;
    if (element && !Accessibility::focused(element->object) && !Accessibility::focus(element->object)) {
      return ActionResult::unsupported("This element does not take keyboard focus. Click it first, then call computer_type_text without element_index.");
    }
    desktop.type(codepoints(text));
    return ActionResult::delivered("input");
  }

  ActionResult run(const ActionRequest& request, bool retried) {
    switch (request.kind) {
      case ActionRequest::click: {
        if (request.target->element) {
          const auto* element = live(*request.target->element);
          if (!element) return ActionResult::blocked("stale_state");
          if (auto pressed = press(*element, request, retried)) return *pressed;
          const auto point = centre(*element);
          if (!point) return ActionResult::unsupported("The element has no place on screen to click.");
          return click_at(point->first, point->second, request);
        }
        const auto aimed = aim(request.target->x, request.target->y);
        if (const auto* refused = std::get_if<ActionResult>(&aimed)) return *refused;
        const auto [x, y] = std::get<std::pair<double, double>>(aimed);
        if (const auto index = element_at(x, y, state.frames)) {
          if (const auto* element = live(*index)) if (auto pressed = press(*element, request, retried)) return *pressed;
        }
        return click_at(x, y, request);
      }
      case ActionRequest::type_text: {
        if (!request.target) {
          const auto* element = state.focused ? live(*state.focused) : nullptr;
          return type(request.text, element && Accessibility::focused(element->object) ? element : nullptr);
        }
        std::optional<int> index = request.target->element;
        if (!index) {
          const auto aimed = aim(request.target->x, request.target->y);
          if (const auto* refused = std::get_if<ActionResult>(&aimed)) return *refused;
          const auto [x, y] = std::get<std::pair<double, double>>(aimed);
          index = element_at(x, y, state.frames);
        }
        const auto* element = index ? live(*index) : nullptr;
        if (request.target->element && !element) return ActionResult::blocked("stale_state");
        if (!element || !(element->editable || element->role == "terminal")) {
          return ActionResult::unsupported("This element holds no text. To type into whatever has keyboard focus (a name being edited, a cell), click it first and call computer_type_text without element_index.");
        }
        return type(request.text, element);
      }
      case ActionRequest::press_key: {
        if (auto refused = in_front()) return *refused;
        for (int round = 0; round < request.count; round++) {
          for (const auto modifier : request.chord.modifiers) desktop.key(modifier, true);
          if (request.chord.key) { desktop.key(*request.chord.key, true); desktop.key(*request.chord.key, false); }
          for (auto modifier = request.chord.modifiers.rbegin(); modifier != request.chord.modifiers.rend(); ++modifier) desktop.key(*modifier, false);
          desktop.sync();
          if (round + 1 < request.count) pause(0.02);
        }
        return ActionResult::delivered("input");
      }
      case ActionRequest::scroll: {
        std::pair<double, double> point;
        if (request.target->element) {
          const auto* element = live(*request.target->element);
          if (!element) return ActionResult::blocked("stale_state");
          const auto centre_point = centre(*element);
          if (!centre_point) return ActionResult::unsupported("The element has no place on screen to scroll.");
          point = *centre_point;
        } else {
          const auto aimed = aim(request.target->x, request.target->y);
          if (const auto* refused = std::get_if<ActionResult>(&aimed)) return *refused;
          point = std::get<std::pair<double, double>>(aimed);
        }
        const bool vertical = request.direction == "up" || request.direction == "down";
        // The X wheel: buttons 4 and 5 turn it up and down, 6 and 7 left and right.
        const unsigned wheel = request.direction == "up" ? 4 : request.direction == "down" ? 5 : request.direction == "left" ? 6 : 7;
        const int clicks = wheel_clicks(request.pages, vertical ? state.window_frame.height : state.window_frame.width);
        return physically({point}, {}, [&] {
          desktop.move(point.first, point.second);
          pause(0.03);
          for (int click = 0; click < clicks; click++) { desktop.click(wheel, 1); if (click % 5 == 4) pause(0.01); }
        });
      }
      case ActionRequest::drag: {
        if (!state.frame) return ActionResult::blocked("no_state", "Observe the app with a screenshot before dragging.");
        std::vector<std::pair<double, double>> path;
        for (const auto& [x, y] : request.path) {
          const auto screen = state.frame->to_screen(x, y);
          if (!screen) return ActionResult::blocked("point_outside_frame");
          path.push_back(*screen);
        }
        const auto aimed = aim(request.path.front().first, request.path.front().second);
        if (const auto* refused = std::get_if<ActionResult>(&aimed)) return *refused;
        return physically({path.front(), path.back()}, request.held, [&] {
          desktop.move(path.front().first, path.front().second);
          pause(0.05);
          desktop.button(request.button, true);
          pause(0.05);
          // Apps start a drag only after the pointer has travelled, so the way is walked in small steps.
          const int steps = std::max(8, static_cast<int>(request.duration / 0.016));
          for (size_t leg = 1; leg < path.size(); leg++) {
            for (int step = 1; step <= steps; step++) {
              const double t = double(step) / steps;
              desktop.move(path[leg - 1].first + (path[leg].first - path[leg - 1].first) * t, path[leg - 1].second + (path[leg].second - path[leg - 1].second) * t);
              pause(std::max(0.004, request.duration / (steps * double(path.size() - 1))));
            }
          }
          pause(0.05);
          desktop.button(request.button, false);
        });
      }
      case ActionRequest::set_value: {
        const auto* element = live(*request.target->element);
        if (!element) return ActionResult::blocked("stale_state");
        return Accessibility::set_value(*element, request.text);
      }
      case ActionRequest::secondary: {
        const auto* element = live(*request.target->element);
        if (!element) return ActionResult::blocked("stale_state");
        // Only actions the element offers; a guessed one is never tried.
        return Accessibility::act(*element, request.text);
      }
      case ActionRequest::unknown:
        return ActionResult::unsupported();
    }
    return ActionResult::unsupported();
  }
};

std::string required_app(const Json& params) {
  const auto* app = params.find("app");
  if (!app || !app->string() || app->string()->empty()) throw HelperError::invalid_params("app is required");
  return *app->string();
}

/// The target app must be in the request's `allowed` list: the host checks grants first and the helper refuses on its own as well.
std::string granted_app(const Json& params) {
  const auto app = required_app(params);
  const auto* allowed = params.find("allowed");
  const bool granted = allowed && allowed->array() && std::any_of(allowed->array()->begin(), allowed->array()->end(), [&](const Json& id) { return id.string() && *id.string() == app; });
  if (!granted) throw HelperError{"app_not_allowed", app + " is not granted in this conversation"};
  return app;
}

bool wayland_only() {
  const char* wayland = std::getenv("WAYLAND_DISPLAY");
  return wayland && *wayland;
}

}  // namespace

Json Session::handle(const std::string& method, const Json& params) {
  if (method == "status") return status();
  if (method == "permissions.request") return Json::Object{{"opened", false}};
  if (method == "preview.stop") { if (preview) preview->stop(); return Json::Object{{"stopped", true}}; }
  if (method == "preview.keyframe") return Json::Object{{"requested", true}};
  if (!desktop) throw HelperError{"permissions_not_granted", "There is no X11 display to work on"};
  if (method == "list_apps") return list_apps(params);
  if (method == "resolve_apps") return resolve_apps(params);
  if (method == "get_app_state") {
    const auto* screenshot = params.find("screenshot");
    return app_state(required_app(params), screenshot && screenshot->boolean() && *screenshot->boolean());
  }
  if (method == "act") return act(params);
  if (method == "zoom") return zoom(params);
  if (method == "preview.start") {
    if (!preview) throw HelperError{"unsupported_action", "This helper has no preview"};
    const auto* codec = params.find("codec");
    if (codec && !(codec->string() && *codec->string() == "jpeg")) throw HelperError::invalid_params("this helper sends jpeg pictures only");
    const auto* fps = params.find("fps");
    preview->start(preview_fps(fps && fps->number() ? *fps->number() : 2));
    return Json::Object{{"started", true}};
  }
  throw HelperError{"unsupported_action", "Unknown method " + fit(method, 64)};
}

Json Session::status() {
  Json::Array limitations;
  if (!desktop) limitations.emplace_back("There is no X11 display: the helper cannot see or operate windows.");
  else if (!desktop->has_input()) limitations.emplace_back("The display has no XTEST extension: the helper cannot send keys or clicks.");
  if (!accessibility) limitations.emplace_back("The accessibility bus (AT-SPI) is not running: the helper cannot read app controls.");
  const bool wayland = wayland_only();
  if (wayland) limitations.emplace_back("This is a Wayland session, which does not let one app see or operate another. Log in with an X11 (Xorg) session to use Computer Use.");
  const bool screen = desktop != nullptr, tree = accessibility != nullptr;
  return Json::Object{{"ready", screen && tree && !wayland && desktop->has_input()},
                      {"permissions", Json::Object{{"accessibility", tree}, {"screenRecording", screen}}},
                      {"limitations", std::move(limitations)}};
}

Json Session::list_apps(const Json& params) {
  const auto* limit = params.find("limit");
  const long wanted = limit ? limit->integer().value_or(0) : 50;
  if (wanted < 1 || wanted > 200) throw HelperError::invalid_params("limit must be 1 to 200");
  const auto* query = params.find("query");
  const auto page = catalog::page(scan(*desktop).apps, query && query->string() ? *query->string() : "", static_cast<size_t>(wanted));
  Json::Array apps;
  for (const auto& app : page.apps) apps.emplace_back(Json::Object{{"id", fit(app.id, 512)}, {"name", fit(app.name, 512)}, {"running", app.running}});
  return Json::Object{{"apps", std::move(apps)}, {"truncated", page.truncated}};
}

Json Session::resolve_apps(const Json& params) {
  const auto* names = params.find("names");
  if (!names || !names->array() || names->array()->size() > 32) throw HelperError::invalid_params("names must be a list of up to 32 names");
  const auto apps = scan(*desktop).apps;
  Json::Array resolved;
  for (const auto& name : *names->array()) {
    if (!name.string()) throw HelperError::invalid_params("names must be strings");
    const auto found = catalog::resolve(*name.string(), apps);
    Json::Object entry{{"request", *name.string()}};
    if (const auto* app = std::get_if<AppRecord>(&found)) {
      entry["status"] = "resolved";
      entry["id"] = fit(app->id, 512);
      entry["name"] = fit(app->name, 512);
    } else if (const auto* candidates = std::get_if<std::vector<AppRecord>>(&found)) {
      Json::Array list;
      for (const auto& candidate : *candidates) { if (list.size() == 16) break; list.push_back(reference(candidate)); }
      entry["status"] = "ambiguous";
      entry["candidates"] = std::move(list);
    } else {
      entry["status"] = "not_found";
    }
    resolved.emplace_back(std::move(entry));
  }
  return Json::Object{{"apps", std::move(resolved)}};
}

Json Session::app_state(const std::string& app, bool screenshot) {
  if (!accessibility) throw HelperError{"permissions_not_granted", "The accessibility bus (AT-SPI) is not running in this session"};
  auto found = scan(*desktop);
  const auto record = std::find_if(found.apps.begin(), found.apps.end(), [&](const AppRecord& candidate) { return candidate.id == app; });
  if (record == found.apps.end()) throw HelperError{"app_not_found", "No application with identifier " + app};
  const std::string name = record->name;
  bool launched = false;
  if (!found.windows.contains(app)) {
    launch(app);
    launched = true;
    // The window list changes when the app shows its first window; that wakes the wait.
    desktop->wait_for([&] { found = scan(*desktop); return found.windows.contains(app); }, launch_timeout);
  }
  auto& state = targets[app];
  state.observed = true;
  state.handles.clear();
  state.elements.clear();
  state.frames.clear();
  state.focused.reset();
  state.frame.reset();
  state.pixels.reset();
  if (cursor) cursor->lift();
  if (!found.windows.contains(app)) {
    state.window = 0;
    if (preview) preview->target(0);
    return Json::Object{{"tree", Json::Object{{"app", fit(name, 512)}, {"elements", Json::Array{}}}},
                        {"screenshotUnavailable", fit(name + " has no open window" + (launched ? " yet; look again in a moment" : ""), 500)}};
  }
  const WindowInfo window = found.windows[app].front();
  state.window = window.id;
  state.window_frame = window.frame;
  if (cursor) cursor->attach(window.frame);
  if (preview) preview->target(window.id);

  // An app registers on the accessibility bus a moment after its window shows.
  AtspiAccessible* application = nullptr;
  desktop->wait_for([&] { application = accessibility->application(window.pid); return application != nullptr; }, launched ? window_timeout : 0.3);
  BuiltTree built;
  std::string title = window.title;
  std::vector<int> indices;
  if (application) {
    const bool acted = now() - state.last_action < SettlePolicy::after_action().maximum;
    accessibility->settle(application, launched || acted ? SettlePolicy::after_action() : SettlePolicy::observe_only());
    // The window may have moved or been renamed while the app settled.
    const auto current = desktop->info(window.id).value_or(window);
    state.window_frame = current.frame;
    title = current.title;
    if (AtspiAccessible* root = accessibility->window(application, current.title)) {
      const Node tree = accessibility->snapshot(root, current.frame, state.handles);
      built = build_tree(tree, tree_limit);
      std::vector<std::string> keys;
      for (const auto& element : built.elements) keys.push_back(element.key);
      indices = state.registry.assign(keys);
      for (size_t at = 0; at < built.elements.size(); at++) {
        state.elements[indices[at]] = built.elements[at].handle;
        if (built.elements[at].frame) state.frames[indices[at]] = *built.elements[at].frame;
      }
      state.focused = focused_index(tree, built, indices);
      g_object_unref(root);
    }
    g_object_unref(application);
  }

  Json::Object result;
  if (screenshot) {
    if (const auto picture = desktop->capture(window.id)) {
      const auto [width, height] = image_budget(picture->pixels.width, picture->pixels.height);
      state.pixels = scale(picture->pixels, width, height);
      state.frame = ImageFrame{width, height, picture->bounds};
      result["screenshot"] = image_json(*state.pixels, 80);
    } else {
      result["screenshotUnavailable"] = "The window is not shown on this display (minimised or on another workspace), so there is no picture of it";
    }
  }
  Json::Array elements;
  for (size_t at = 0; at < built.elements.size(); at++) elements.push_back(element_json(built.elements[at], indices[at], state.frame));
  Json::Object tree{{"app", fit(name, 512)}, {"elements", std::move(elements)}};
  if (!title.empty()) tree["window"] = fit(title, 1024);
  if (built.truncated) tree["truncated"] = true;
  result["tree"] = std::move(tree);
  return result;
}

Json Session::act(const Json& params) {
  const auto* step = params.find("action");
  if (!step) throw HelperError::invalid_params("action is required");
  const auto app = granted_app(params);
  const auto request = ActionRequest::parse(*step);
  const auto known = targets.find(app);
  if (known == targets.end() || !known->second.observed) return Json::Object{{"result", ActionResult::blocked("no_state").json()}};
  auto& state = known->second;
  // A toolkit can accept a press and do nothing. A click asked for twice in a row, whose first try went through
  // accessibility and left the window looking the same, becomes a real click.
  const auto key = request.signature();
  const bool retried = state.last_soft == key;
  state.last_soft.clear();
  const auto before = request.kind == ActionRequest::click && !retried && state.window ? desktop->capture(state.window) : std::nullopt;
  // A step that waited out a pause acts on nothing: the app may have changed while the user had it.
  const auto result = gate && gate->wait_while_paused()
      ? ActionResult::blocked("user_intervened", "The user paused Computer Use and resumed it; nothing was done. Look at the fresh state before the next action.")
      : Executor{*this, state, *desktop}.perform(request, retried);
  if (result.outcome == "delivered") state.last_action = now();
  auto fresh = app_state(app, true);
  if (result.method == "ax" && before && state.pixels) {
    const auto was = scale(before->pixels, state.pixels->width, state.pixels->height);
    if (was.rgb == state.pixels->rgb) state.last_soft = key;
  }
  return Json::Object{{"result", result.json()}, {"state", std::move(fresh)}};
}

Json Session::zoom(const Json& params) {
  const auto* region = params.find("region");
  if (!region || !region->array() || region->array()->size() != 4) throw HelperError::invalid_params("region is required");
  double edges[4];
  for (size_t at = 0; at < 4; at++) {
    const auto* edge = (*region->array())[at].number();
    if (!edge) throw HelperError::invalid_params("region is four numbers");
    edges[at] = *edge;
  }
  const auto app = granted_app(params);
  const auto known = targets.find(app);
  if (known == targets.end() || !known->second.frame) throw HelperError{"no_state", "There is no screenshot of " + app + " to zoom into yet"};
  const auto& state = known->second;
  const auto& frame = *state.frame;
  if (edges[0] < 0 || edges[1] < 0 || edges[2] > frame.width || edges[3] > frame.height || edges[2] <= edges[0] || edges[3] <= edges[1]) {
    throw HelperError{"point_outside_frame", "The region is not inside the latest screenshot of " + app};
  }
  const auto picture = desktop->capture(state.window);
  // The window moved or changed size since its screenshot: the region no longer shows what the model saw.
  if (!picture || !same_place(picture->bounds, frame.bounds)) throw HelperError{"stale_state", "The window moved since its screenshot"};
  const double sx = double(picture->pixels.width) / frame.width, sy = double(picture->pixels.height) / frame.height;
  const int left = std::clamp(int(edges[0] * sx), 0, picture->pixels.width - 1), top = std::clamp(int(edges[1] * sy), 0, picture->pixels.height - 1);
  const int right = std::clamp(int(std::ceil(edges[2] * sx)), left + 1, picture->pixels.width), bottom = std::clamp(int(std::ceil(edges[3] * sy)), top + 1, picture->pixels.height);
  Pixels crop{right - left, bottom - top, {}};
  crop.rgb.reserve(size_t(crop.width) * crop.height * 3);
  for (int row = top; row < bottom; row++) {
    const auto* start = &picture->pixels.rgb[(size_t(row) * picture->pixels.width + left) * 3];
    crop.rgb.insert(crop.rgb.end(), start, start + size_t(crop.width) * 3);
  }
  const auto [width, height] = image_budget(crop.width, crop.height);
  return image_json(scale(crop, width, height), 90);
}

}  // namespace moxxy
