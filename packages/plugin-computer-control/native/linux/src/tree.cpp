#include "tree.hpp"

#include <algorithm>
#include <set>

#include "text.hpp"

namespace moxxy {

namespace {

/// Containers that only lay things out; listed only when they carry a name, value or action.
const std::set<std::string> structural{"filler", "panel", "scroll pane", "split pane", "section", "layered pane", "viewport",
                                       "redundant object", "unknown", "root pane", "glass pane", "option pane", "grouping"};
/// Parts of other controls the model never needs.
const std::set<std::string> hidden{"scroll bar", "separator"};
/// Actions a plain click stands for; the click tool covers them.
const std::vector<std::string> implicit_actions{"click", "press", "activate", "jump"};
/// Roles whose press does the same wherever inside them the click lands.
const std::set<std::string> pressable_roles{"push button", "check box", "radio button", "toggle button", "menu item", "check menu item",
                                            "radio menu item", "menu", "link", "page tab", "combo box", "push button menu"};
/// Fields that show their content even when it is empty.
const std::set<std::string> entries{"text", "entry", "password text", "combo box", "spin button", "terminal"};
/// Roles that only carry words: a button's own label, a link's own text.
const std::set<std::string> echoes{"static", "link", "section", "label"};

bool implicit(const std::string& action) {
  return std::find(implicit_actions.begin(), implicit_actions.end(), lower(action)) != implicit_actions.end();
}

/// Every element of a web page offers its context menu and its scrolling; a click and the scroll tool cover those.
std::vector<std::string> explicit_actions(const Node& node, bool web) {
  std::vector<std::string> kept;
  for (const auto& action : node.actions) {
    // GTK 4 lists its named actions ("clipboard.copy", "win.close"); they take a parameter nobody can give here.
    if (action.empty() || implicit(action) || action.find('.') != std::string::npos) continue;
    const auto name = lower(action);
    if (web && (name == "showcontextmenu" || name.starts_with("scroll"))) continue;
    kept.push_back(action);
  }
  return kept;
}

bool is_plain(const Node& node, bool web) {
  return structural.contains(node.role) && node.name.empty() && node.description.empty() && (!node.value || node.value->empty())
      && explicit_actions(node, web).empty() && !node.focused && !node.selected;
}

/// A button wraps its label and a link its own words. A node that only says what its parent already shows adds a line and nothing else.
bool repeats(const Node& node, const std::vector<std::string>& said) {
  if (!echoes.contains(node.role) || node.focused || node.selected || !explicit_actions(node, true).empty()) return false;
  std::vector<std::string> own;
  for (const auto* text : {&node.name, &node.description}) if (!text->empty()) own.push_back(*text);
  if (node.value && !node.value->empty()) own.push_back(*node.value);
  return !own.empty() && std::all_of(own.begin(), own.end(), [&](const std::string& text) { return std::find(said.begin(), said.end(), text) != said.end(); });
}

/// Identity survives value changes: identifier, else a name, else position among same-role siblings.
std::string unique_key(const std::string* parent, const Node& node, std::map<std::string, int>& siblings) {
  const int ordinal = ++siblings["#" + node.role];
  const auto& named = !node.identifier.empty() ? node.identifier : node.name;
  // A name can be a whole paragraph; its start is enough to tell siblings apart.
  const auto discriminator = named.empty() ? "#" + std::to_string(ordinal) : fit(named, 64);
  const auto base = (parent ? *parent + "/" : std::string()) + node.role + ":" + discriminator;
  const int seen = ++siblings[base];
  return seen == 1 ? base : base + "~" + std::to_string(seen);
}

Element element(const Node& node, std::string key, int depth, bool web) {
  std::vector<std::string> states;
  if (node.focused) states.emplace_back("focused");
  if (node.selected) states.emplace_back("selected");
  if (node.checked.value_or(false)) states.emplace_back("checked");
  if (node.expanded) states.emplace_back(*node.expanded ? "expanded" : "collapsed");
  if (!node.enabled) states.emplace_back("disabled");
  const auto title = node.name.empty() ? std::nullopt : std::optional(node.name);
  // A description that repeats the title says nothing.
  const auto description = node.description.empty() || node.description == node.name ? std::nullopt : std::optional(node.description);
  std::optional<std::string> value;
  if (!node.secure && node.value && (entries.contains(node.role) || (!node.value->empty() && *node.value != node.name))) value = node.value;
  return {std::move(key), depth, node.role, title, description, value, node.secure, std::move(states), explicit_actions(node, web), node.handle, node.frame};
}

struct Builder {
  size_t limit;
  BuiltTree built;

  /// `said` is what the nearest listed ancestor already shows as its name.
  void visit(const Node& node, int depth, const std::string* parent, std::map<std::string, int>& siblings, bool web, const std::vector<std::string>& said) {
    if (hidden.contains(node.role)) return;
    if (is_plain(node, web) || repeats(node, said)) {
      for (const auto& child : node.children) visit(child, depth, parent, siblings, web, said);
      return;
    }
    if (built.elements.size() >= limit) { built.truncated = true; return; }
    const auto key = unique_key(parent, node, siblings);
    built.elements.push_back(element(node, key, depth, web));
    std::vector<std::string> shown;
    if (!node.name.empty()) shown.push_back(node.name);
    if (!node.description.empty()) shown.push_back(node.description);
    std::map<std::string, int> children;
    const bool inside = web || node.role == "document web";
    for (const auto& child : node.children) visit(child, depth + 1, &key, children, inside, shown);
  }
};

}  // namespace

BuiltTree build_tree(const Node& root, size_t limit) {
  Builder builder{limit, {}};
  std::map<std::string, int> roots;
  builder.visit(root, 0, nullptr, roots, false, {});
  return std::move(builder.built);
}

bool pressable(const std::string& role) { return pressable_roles.contains(role); }

std::optional<std::string> press_action(const std::vector<std::string>& actions) {
  for (const auto& wanted : implicit_actions) {
    const auto found = std::find_if(actions.begin(), actions.end(), [&](const std::string& action) { return lower(action) == wanted; });
    if (found != actions.end()) return *found;
  }
  return std::nullopt;
}

std::vector<int> IndexRegistry::assign(const std::vector<std::string>& keys) {
  std::map<std::string, int> current;
  std::vector<int> assigned;
  for (const auto& key : keys) {
    const auto known = indices_.find(key);
    const int index = known != indices_.end() ? known->second : next_++;
    current[key] = index;
    assigned.push_back(index);
  }
  indices_ = std::move(current);
  return assigned;
}

std::optional<int> element_at(double x, double y, const std::map<int, Rect>& frames) {
  std::optional<int> best;
  double smallest = 0;
  for (const auto& [index, frame] : frames) {
    if (!frame.contains(x, y)) continue;
    const double area = frame.width * frame.height;
    if (!best || area < smallest) { best = index; smallest = area; }
  }
  return best;
}

Json element_json(const Element& element, int index, const std::optional<ImageFrame>& frame) {
  Json::Object fields{{"key", wire_key(element.key)}, {"index", index}, {"depth", std::min(element.depth, 64)}, {"role", fit(element.role, 128)}};
  if (element.title) fields["title"] = fit(*element.title, 10'000);
  if (element.description) fields["description"] = fit(*element.description, 10'000);
  if (element.value) fields["value"] = fit(*element.value, 10'000);
  if (element.secure) fields["secure"] = true;
  if (!element.states.empty()) fields["states"] = Json::Array(element.states.begin(), element.states.end());
  if (!element.actions.empty()) {
    Json::Array actions;
    for (const auto& action : element.actions) { if (actions.size() == 32) break; actions.emplace_back(fit(action, 64)); }
    fields["actions"] = std::move(actions);
  }
  if (element.frame && frame) {
    const auto rect = frame->image_rect(*element.frame);
    fields["frame"] = Json::Object{{"x", rect.x}, {"y", rect.y}, {"width", rect.width}, {"height", rect.height}};
  }
  return fields;
}

}  // namespace moxxy
