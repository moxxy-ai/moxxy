#include "accessibility.hpp"

#include <algorithm>
#include <cstring>
#include <gio/gio.h>
#include <set>

#include "desktop.hpp"
#include "text.hpp"

namespace moxxy {

namespace {

constexpr size_t max_nodes = 4000, max_children = 400, max_text = 10'000;
constexpr int max_depth = 64;

/// Roles whose text is their content; for everything else the name already says it.
const std::set<std::string> textual{"text", "entry", "terminal", "paragraph", "document text", "spin button", "combo box"};
const std::set<std::string> checkable{"check box", "radio button", "toggle button", "check menu item", "radio menu item", "switch"};

std::string take(gchar* text) {
  if (!text) return {};
  std::string owned = clean_utf8(text);
  g_free(text);
  return owned;
}

/// A call that failed leaves an error behind; it is dropped, the caller sees the empty answer.
struct Failure {
  GError* error = nullptr;
  ~Failure() { g_clear_error(&error); }
  operator GError**() { return &error; }
  bool timed_out() const { return error && (g_error_matches(error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT) || std::strstr(error->message, "imeout") || std::strstr(error->message, "NoReply")); }
};

bool has(GArray* interfaces, const char* name) {
  if (!interfaces) return false;
  for (guint index = 0; index < interfaces->len; index++) if (!std::strcmp(g_array_index(interfaces, gchar*, index), name)) return true;
  return false;
}

std::string number_text(double value) {
  char buffer[32];
  g_ascii_formatd(buffer, sizeof buffer, "%.6g", value);
  return buffer;
}

struct Reader {
  Handles& handles;
  Rect origin;
  size_t nodes = 0;

  Node read(AtspiAccessible* object, int depth) {
    Node node;
    nodes++;
    node.role = take(atspi_accessible_get_role_name(object, Failure()));
    if (node.role.empty()) node.role = "unknown";
    node.name = take(atspi_accessible_get_name(object, Failure()));
    node.description = take(atspi_accessible_get_description(object, Failure()));
    bool visible = true;
    if (AtspiStateSet* states = atspi_accessible_get_state_set(object)) {
      const auto is = [&](AtspiStateType state) { return atspi_state_set_contains(states, state) == TRUE; };
      node.enabled = is(ATSPI_STATE_SENSITIVE) || is(ATSPI_STATE_ENABLED);
      node.focused = is(ATSPI_STATE_FOCUSED);
      node.selected = is(ATSPI_STATE_SELECTED);
      if (is(ATSPI_STATE_CHECKABLE) || checkable.contains(node.role)) node.checked = is(ATSPI_STATE_CHECKED) || is(ATSPI_STATE_PRESSED);
      if (is(ATSPI_STATE_EXPANDABLE)) node.expanded = is(ATSPI_STATE_EXPANDED);
      visible = is(ATSPI_STATE_VISIBLE) || depth == 0;
      g_object_unref(states);
    }
    node.secure = node.role == "password text";
    GArray* interfaces = atspi_accessible_get_interfaces(object);
    Live live{object, node.role, {}, has(interfaces, "EditableText"), has(interfaces, "Value")};
    if (has(interfaces, "Component")) node.frame = Accessibility::frame(object, origin);
    if (has(interfaces, "Action")) {
      AtspiAction* action = ATSPI_ACTION(object);
      const int count = std::min(atspi_action_get_n_actions(action, Failure()), 16);
      for (int index = 0; index < count; index++) live.actions.push_back(take(atspi_action_get_action_name(action, index, Failure())));
      node.actions = live.actions;
    }
    if (!node.secure && has(interfaces, "Text") && (textual.contains(node.role) || node.name.empty())) {
      AtspiText* text = ATSPI_TEXT(object);
      const int length = atspi_text_get_character_count(text, Failure());
      node.value = length > 0 ? take(atspi_text_get_text(text, 0, std::min<int>(length, max_text), Failure())) : std::string();
    } else if (!node.secure && live.has_value) {
      Failure failure;
      const double value = atspi_value_get_current_value(ATSPI_VALUE(object), failure);
      if (!failure.error) node.value = number_text(value);
    }
    if (interfaces) g_array_free(interfaces, TRUE);
    g_object_ref(object);
    node.handle = handles.add(std::move(live));
    // What is not shown (a closed menu, a hidden page of a stack) is not part of the window.
    if (!visible || depth >= max_depth) return node;
    const int count = std::min<int>(atspi_accessible_get_child_count(object, Failure()), max_children);
    for (int index = 0; index < count && nodes < max_nodes; index++) {
      AtspiAccessible* child = atspi_accessible_get_child_at_index(object, index, Failure());
      if (!child) continue;
      Node read_child = read(child, depth + 1);
      g_object_unref(child);
      if (read_child.handle >= 0) node.children.push_back(std::move(read_child));
    }
    return node;
  }
};

bool shows(AtspiAccessible* object, AtspiStateType state) {
  atspi_accessible_clear_cache(object);
  AtspiStateSet* states = atspi_accessible_get_state_set(object);
  if (!states) return false;
  const bool set = atspi_state_set_contains(states, state) == TRUE;
  g_object_unref(states);
  return set;
}

GVariant* status_call(const char* method, GVariant* arguments, const GVariantType* reply) {
  GDBusConnection* bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  if (!bus) return nullptr;
  GVariant* answer = g_dbus_connection_call_sync(bus, "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", method, arguments, reply,
                                                 G_DBUS_CALL_FLAGS_NONE, 2000, nullptr, nullptr);
  g_object_unref(bus);
  return answer;
}

struct Changes {
  AtspiApplication* app;
  std::vector<double> times;
};

void on_change(AtspiEvent* event, void* data) {
  auto* changes = static_cast<Changes*>(data);
  if (event->source && ATSPI_OBJECT(event->source)->app == changes->app) changes->times.push_back(now());
}

gboolean on_deadline(gpointer data) {
  *static_cast<bool*>(data) = true;
  return G_SOURCE_REMOVE;
}

const char* const change_events[] = {"object:children-changed", "object:state-changed", "object:text-changed", "object:property-change",
                                     "object:visible-data-changed", "object:selection-changed", "window:create", "window:activate"};

}  // namespace

Handles& Handles::operator=(Handles&& other) noexcept {
  if (this != &other) { clear(); live_ = std::move(other.live_); other.live_.clear(); }
  return *this;
}

int Handles::add(Live live) {
  live_.push_back(std::move(live));
  return static_cast<int>(live_.size()) - 1;
}

void Handles::clear() {
  for (auto& live : live_) g_object_unref(live.object);
  live_.clear();
}

std::unique_ptr<Accessibility> Accessibility::open() {
  auto accessibility = std::unique_ptr<Accessibility>(new Accessibility());
  // Toolkits build their accessibility tree only while the session says someone is listening.
  if (GVariant* answer = status_call("Get", g_variant_new("(ss)", "org.a11y.Status", "IsEnabled"), G_VARIANT_TYPE("(v)"))) {
    GVariant* value = nullptr;
    g_variant_get(answer, "(v)", &value);
    accessibility->was_enabled_ = g_variant_get_boolean(value);
    g_variant_unref(value);
    g_variant_unref(answer);
  } else {
    return nullptr;
  }
  if (!accessibility->was_enabled_) {
    if (GVariant* answer = status_call("Set", g_variant_new("(ssv)", "org.a11y.Status", "IsEnabled", g_variant_new_boolean(TRUE)), nullptr)) {
      accessibility->switched_ = true;
      g_variant_unref(answer);
    }
  }
  if (atspi_init() > 1) return nullptr;
  // An app that hangs must not hang the helper: two seconds for a call, ten for an app that is starting.
  atspi_set_timeout(2000, 10000);
  return accessibility;
}

void Accessibility::restore() {
  if (!switched_) return;
  switched_ = false;
  if (GVariant* answer = status_call("Set", g_variant_new("(ssv)", "org.a11y.Status", "IsEnabled", g_variant_new_boolean(FALSE)), nullptr)) g_variant_unref(answer);
}

AtspiAccessible* Accessibility::application(pid_t pid) {
  AtspiAccessible* desktop = atspi_get_desktop(0);
  if (!desktop) return nullptr;
  AtspiAccessible* found = nullptr;
  // The library keeps what it read and updates it from events, which this helper only reads while it waits
  // for an app to settle. What it kept is dropped before every look, so each look reads the app itself.
  atspi_accessible_clear_cache(desktop);
  const int count = atspi_accessible_get_child_count(desktop, Failure());
  for (int index = 0; index < count && !found; index++) {
    AtspiAccessible* app = atspi_accessible_get_child_at_index(desktop, index, Failure());
    if (!app) continue;
    if (static_cast<pid_t>(atspi_accessible_get_process_id(app, Failure())) == pid && atspi_accessible_get_child_count(app, Failure()) > 0) found = app;
    else g_object_unref(app);
  }
  g_object_unref(desktop);
  return found;
}

AtspiAccessible* Accessibility::window(AtspiAccessible* app, const std::string& title) {
  std::vector<AtspiAccessible*> windows;
  const int count = std::min(atspi_accessible_get_child_count(app, Failure()), 64);
  for (int index = 0; index < count; index++) {
    if (AtspiAccessible* child = atspi_accessible_get_child_at_index(app, index, Failure())) windows.push_back(child);
  }
  const auto pick = [&](const auto& matches) -> AtspiAccessible* {
    const auto found = std::find_if(windows.begin(), windows.end(), matches);
    return found == windows.end() ? nullptr : *found;
  };
  AtspiAccessible* chosen = pick([&](AtspiAccessible* candidate) { return !title.empty() && take(atspi_accessible_get_name(candidate, Failure())) == title; });
  if (!chosen) chosen = pick([](AtspiAccessible* candidate) { return shows(candidate, ATSPI_STATE_ACTIVE); });
  if (!chosen) chosen = pick([](AtspiAccessible* candidate) { return shows(candidate, ATSPI_STATE_SHOWING); });
  if (!chosen && !windows.empty()) chosen = windows.front();
  for (auto* candidate : windows) if (candidate != chosen) g_object_unref(candidate);
  return chosen;
}

Node Accessibility::snapshot(AtspiAccessible* window, const Rect& origin, Handles& handles) {
  atspi_accessible_clear_cache(window);
  Reader reader{handles, origin};
  return reader.read(window, 0);
}

void Accessibility::settle(AtspiAccessible* app, SettlePolicy policy) {
  Changes changes{ATSPI_OBJECT(app)->app, {}};
  AtspiEventListener* listener = atspi_event_listener_new(on_change, &changes, nullptr);
  for (const auto* event : change_events) atspi_event_listener_register(listener, event, nullptr);
  SettleClock clock(now(), policy);
  while (true) {
    while (g_main_context_iteration(nullptr, FALSE)) {}
    for (const auto time : changes.times) clock.record(time);
    changes.times.clear();
    const double current = now();
    if (clock.settled(current)) break;
    // Sleeps until an event arrives or the decision can change, whichever is first.
    bool due = false;
    const guint timer = g_timeout_add(static_cast<guint>(std::max(0.01, clock.next_check(current) - current) * 1000), on_deadline, &due);
    g_main_context_iteration(nullptr, TRUE);
    if (!due) g_source_remove(timer);
  }
  for (const auto* event : change_events) atspi_event_listener_deregister(listener, event, nullptr);
  g_object_unref(listener);
  atspi_accessible_clear_cache(app);
}

bool Accessibility::alive(AtspiAccessible* element) {
  Failure failure;
  atspi_accessible_clear_cache(element);
  atspi_accessible_get_role(element, failure);
  return !failure.error;
}

bool Accessibility::focused(AtspiAccessible* element) { return shows(element, ATSPI_STATE_FOCUSED); }

std::optional<Rect> Accessibility::frame(AtspiAccessible* element, const Rect& origin) {
  AtspiComponent* component = atspi_accessible_get_component_iface(element);
  if (!component) return std::nullopt;
  Failure failure;
  // Toolkits disagree on where the screen starts; inside the window they agree.
  AtspiRect* extents = atspi_component_get_extents(component, ATSPI_COORD_TYPE_WINDOW, failure);
  g_object_unref(component);
  if (!extents) return std::nullopt;
  const Rect rect{origin.x + extents->x, origin.y + extents->y, double(extents->width), double(extents->height)};
  g_free(extents);
  return rect.width > 0 && rect.height > 0 ? std::optional(rect) : std::nullopt;
}

ActionResult Accessibility::act(const Live& live, const std::string& action) {
  const auto found = std::find_if(live.actions.begin(), live.actions.end(), [&](const std::string& name) { return lower(name) == lower(action); });
  if (found == live.actions.end()) return ActionResult::unsupported();
  Failure failure;
  const bool done = atspi_action_do_action(ATSPI_ACTION(live.object), static_cast<int>(found - live.actions.begin()), failure);
  // A press that opens a modal dialog answers only when the dialog closes: no answer in time still means it was sent.
  if (done || failure.timed_out()) return ActionResult::delivered("ax");
  return failure.error ? ActionResult::blocked("stale_state") : ActionResult::unsupported();
}

bool Accessibility::focus(AtspiAccessible* element) {
  AtspiComponent* component = atspi_accessible_get_component_iface(element);
  if (!component) return false;
  const bool taken = atspi_component_grab_focus(component, Failure());
  g_object_unref(component);
  return taken;
}

bool Accessibility::insert(AtspiAccessible* element, const std::string& text) {
  AtspiText* field = ATSPI_TEXT(element);
  AtspiEditableText* editable = ATSPI_EDITABLE_TEXT(element);
  int caret = atspi_text_get_caret_offset(field, Failure());
  if (atspi_text_get_n_selections(field, Failure()) > 0) {
    if (AtspiRange* range = atspi_text_get_selection(field, 0, Failure())) {
      if (range->end_offset > range->start_offset) {
        atspi_editable_text_delete_text(editable, range->start_offset, range->end_offset, Failure());
        caret = range->start_offset;
      }
      g_free(range);
    }
  }
  const int cleared = atspi_text_get_character_count(field, Failure());
  if (caret < 0 || caret > cleared) caret = cleared;
  Failure failure;
  if (!atspi_editable_text_insert_text(editable, caret, text.c_str(), static_cast<int>(text.size()), failure)) return false;
  // Some toolkits accept the text and drop it; the character count says whether it landed.
  const int after = atspi_text_get_character_count(field, Failure());
  if (after == cleared) return false;
  atspi_text_set_caret_offset(field, caret + static_cast<int>(codepoints(text).size()), Failure());
  return true;
}

ActionResult Accessibility::set_value(const Live& live, const std::string& text) {
  if (live.has_value) {
    // Sliders and spin buttons hold numbers; the model always sends text.
    char* end = nullptr;
    const double number = g_ascii_strtod(text.c_str(), &end);
    if (text.empty() || end != text.c_str() + text.size()) return ActionResult::unsupported("This element holds a number; send the value as digits.");
    Failure failure;
    return atspi_value_set_current_value(ATSPI_VALUE(live.object), number, failure) ? ActionResult::delivered("ax") : ActionResult::unsupported();
  }
  if (live.editable) {
    Failure failure;
    return atspi_editable_text_set_text_contents(ATSPI_EDITABLE_TEXT(live.object), text.c_str(), failure) ? ActionResult::delivered("ax") : ActionResult::unsupported();
  }
  return ActionResult::unsupported();
}

}  // namespace moxxy
