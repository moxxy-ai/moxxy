#include "check.hpp"
#include "tree.hpp"

using namespace moxxy;

namespace {
Node node(std::string role, std::string name = "", std::vector<Node> children = {}) {
  Node made;
  made.role = std::move(role);
  made.name = std::move(name);
  made.children = std::move(children);
  return made;
}
}  // namespace

TEST(tree_lists_controls_and_skips_bare_layout) {
  auto press = node("push button", "Press");
  press.actions = {"click"};
  const auto built = build_tree(node("frame", "Fixture", {node("filler", "", {node("panel", "", {press, node("scroll bar"), node("label", "Hello")})})}), 100);
  CHECK(built.elements.size() == 3);
  CHECK(built.elements[0].role == "frame" && built.elements[0].depth == 0);
  CHECK(built.elements[1].role == "push button" && built.elements[1].depth == 1 && *built.elements[1].title == "Press");
  // The click tool covers a control's own press; it is not listed as an extra action.
  CHECK(built.elements[1].actions.empty());
  CHECK(built.elements[2].role == "label" && *built.elements[2].title == "Hello");
  CHECK(!built.truncated);
}

TEST(tree_keeps_a_layout_container_that_says_something) {
  auto named = node("panel", "Settings", {node("label", "x")});
  auto focused = node("panel");
  focused.focused = true;
  const auto built = build_tree(node("frame", "w", {named, focused}), 100);
  CHECK(built.elements.size() == 4);
  CHECK(built.elements[1].role == "panel" && built.elements[2].depth == 2);
  CHECK(built.elements[3].states == std::vector<std::string>{"focused"});
}

TEST(tree_reports_values_states_and_extra_actions) {
  auto field = node("text", "Name");
  field.value = "";
  auto secret = node("password text", "Secret");
  secret.secure = true;
  secret.value = "hunter2";
  auto box = node("check box", "Agree");
  box.checked = true;
  box.enabled = false;
  auto row = node("table row", "Folder");
  row.expanded = false;
  row.selected = true;
  row.actions = {"click", "expand or contract"};
  const auto built = build_tree(node("frame", "w", {field, secret, box, row}), 100);
  CHECK(built.elements[1].value.has_value() && built.elements[1].value->empty());
  CHECK(built.elements[2].secure && !built.elements[2].value.has_value());
  CHECK((built.elements[3].states == std::vector<std::string>{"checked", "disabled"}));
  CHECK((built.elements[4].states == std::vector<std::string>{"selected", "collapsed"}));
  CHECK(built.elements[4].actions == std::vector<std::string>{"expand or contract"});
}

TEST(tree_keys_tell_siblings_apart_and_survive_value_changes) {
  auto first = node("text");
  first.value = "one";
  auto second = node("text");
  const auto before = build_tree(node("frame", "w", {first, second, node("push button", "OK"), node("push button", "OK")}), 100);
  CHECK(before.elements[1].key == "frame:w/text:#1");
  CHECK(before.elements[2].key == "frame:w/text:#2");
  CHECK(before.elements[3].key == "frame:w/push button:OK");
  CHECK(before.elements[4].key == "frame:w/push button:OK~2");
  first.value = "changed";
  const auto after = build_tree(node("frame", "w", {first, second}), 100);
  CHECK(after.elements[1].key == before.elements[1].key);
  auto identified = node("push button", "Renamed");
  identified.identifier = "save";
  CHECK(build_tree(node("frame", "w", {identified}), 100).elements[1].key == "frame:w/push button:save");
}

TEST(tree_stops_at_the_limit_and_says_so) {
  std::vector<Node> many(10, node("label", "x"));
  const auto built = build_tree(node("frame", "w", many), 4);
  CHECK(built.elements.size() == 4);
  CHECK(built.truncated);
}

TEST(tree_trims_what_a_web_page_repeats) {
  auto link = node("link", "Docs", {node("static", "Docs")});
  link.actions = {"jump", "showContextMenu"};
  auto page = node("document web", "Site", {node("section", "", {link}), node("section", "", {})});
  const auto built = build_tree(node("frame", "w", {page}), 100);
  CHECK(built.elements.size() == 3);
  CHECK(built.elements[2].role == "link" && built.elements[2].actions.empty());
}

TEST(indices_stay_with_their_keys_and_are_never_reused) {
  IndexRegistry registry;
  CHECK((registry.assign({"a", "b", "c"}) == std::vector<int>{0, 1, 2}));
  CHECK((registry.assign({"c", "a", "d"}) == std::vector<int>{2, 0, 3}));
  // "b" left; its index is not handed to another element, even to "b" coming back.
  CHECK((registry.assign({"b", "d"}) == std::vector<int>{4, 3}));
}

TEST(the_element_under_a_point_is_the_smallest_one_containing_it) {
  const std::map<int, Rect> frames{{0, {0, 0, 500, 400}}, {1, {10, 10, 100, 40}}, {2, {20, 15, 30, 20}}};
  CHECK(element_at(25, 20, frames) == 2);
  CHECK(element_at(90, 30, frames) == 1);
  CHECK(element_at(400, 300, frames) == 0);
  CHECK(!element_at(600, 300, frames).has_value());
}

TEST(elements_are_written_in_the_contract_shape) {
  Element element{"frame:w/push button:OK", 1, "push button", std::string("OK"), std::nullopt, std::nullopt, false, {"focused"}, {"menu"}, 7, Rect{110, 220, 50, 20}};
  const ImageFrame frame{400, 300, Rect{100, 200, 800, 600}};
  const auto json = element_json(element, 3, frame);
  CHECK(json.find("index")->integer() == 3);
  CHECK(*json.find("key")->string() == "frame:w/push button:OK");
  CHECK(*json.find("frame")->find("x")->number() == 5);
  CHECK(*json.find("frame")->find("width")->number() == 25);
  CHECK(json.find("value") == nullptr && json.find("secure") == nullptr);
  CHECK(json.find("states")->array()->size() == 1);
}

TEST(a_label_that_repeats_its_button_is_not_listed) {
  Node label;
  label.role = "label";
  label.name = "Save";
  Node other = label;
  other.name = "Shortcut: Ctrl+S";
  Node button;
  button.role = "push button";
  button.name = "Save";
  button.children = {label, other};
  const auto built = build_tree(button, 100);
  CHECK(built.elements.size() == 2);
  CHECK(built.elements[1].title == std::optional<std::string>("Shortcut: Ctrl+S"));
}

TEST(toolkit_actions_that_need_a_parameter_are_not_offered) {
  Node field;
  field.role = "text";
  field.value = "";
  field.actions = {"clipboard.copy", "menu.popup", "activate", "expand or collapse"};
  const auto built = build_tree(field, 100);
  CHECK(built.elements[0].actions == std::vector<std::string>{"expand or collapse"});
}
