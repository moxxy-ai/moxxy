#include <X11/keysym.h>

#include "action.hpp"
#include "check.hpp"
#include "wire.hpp"

using namespace moxxy;

namespace {
Json step(const char* text) { return *Json::parse(text); }
}  // namespace

TEST(a_click_names_its_target_button_count_and_held_keys) {
  const auto click = ActionRequest::parse(step(R"({"action":"click","element_index":4,"mouse_button":"right","click_count":2,"held":["shift"]})"));
  CHECK(click.kind == ActionRequest::click && click.target->element == 4 && click.button == 3 && click.count == 2);
  CHECK(click.held == std::vector<unsigned long>{XK_Shift_L});
  const auto point = ActionRequest::parse(step(R"({"action":"click","x":10,"y":20.5,"mouse_button":"left","click_count":1})"));
  CHECK(!point.target->element && point.target->x == 10 && point.target->y == 20.5);
  CHECK_THROWS(ActionRequest::parse(step(R"({"action":"click","mouse_button":"left","click_count":1})")));
  CHECK_THROWS(ActionRequest::parse(step(R"({"action":"click","element_index":1,"mouse_button":"left","click_count":9})")));
}

TEST(typing_may_have_no_target_and_keys_carry_a_chord) {
  const auto typed = ActionRequest::parse(step(R"({"action":"type_text","text":"hi"})"));
  CHECK(typed.kind == ActionRequest::type_text && !typed.target && typed.text == "hi");
  CHECK_THROWS(ActionRequest::parse(step(R"({"action":"type_text","text":""})")));
  const auto key = ActionRequest::parse(step(R"({"action":"press_key","chord":{"modifiers":["ctrl"],"key":"a"},"repeat":3})"));
  CHECK(key.kind == ActionRequest::press_key && key.count == 3 && key.chord.key == 'a');
  CHECK_THROWS(ActionRequest::parse(step(R"({"action":"press_key","chord":{"modifiers":[],"key":"a"},"repeat":0})")));
}

TEST(scroll_drag_value_and_named_actions_are_parsed) {
  const auto scroll = ActionRequest::parse(step(R"({"action":"scroll","x":5,"y":6,"direction":"down","pages":2})"));
  CHECK(scroll.kind == ActionRequest::scroll && scroll.direction == "down" && scroll.pages == 2);
  const auto drag = ActionRequest::parse(step(R"({"action":"drag","path":[[1,2],[30,40]],"duration_ms":500,"mouse_button":"left"})"));
  CHECK(drag.kind == ActionRequest::drag && drag.path.size() == 2 && drag.path[1].second == 40 && drag.duration == 0.5);
  CHECK_THROWS(ActionRequest::parse(step(R"({"action":"drag","path":[[1,2]],"mouse_button":"left"})")));
  const auto value = ActionRequest::parse(step(R"({"action":"set_value","element_index":2,"value":"7"})"));
  CHECK(value.kind == ActionRequest::set_value && value.text == "7");
  const auto named = ActionRequest::parse(step(R"({"action":"perform_secondary_action","element_index":2,"secondary_action":"expand"})"));
  CHECK(named.kind == ActionRequest::secondary && named.text == "expand");
  CHECK(ActionRequest::parse(step(R"({"action":"teleport"})")).kind == ActionRequest::unknown);
}

TEST(the_same_step_has_the_same_signature) {
  const auto first = ActionRequest::parse(step(R"({"action":"click","element_index":4,"mouse_button":"left","click_count":1})"));
  const auto second = ActionRequest::parse(step(R"({"action":"click","element_index":5,"mouse_button":"left","click_count":1})"));
  CHECK(first.signature() == first.signature());
  CHECK(first.signature() != second.signature());
}

TEST(a_result_is_written_in_the_contract_shape) {
  CHECK(ActionResult::delivered("ax").json().dump() == R"({"method":"ax","outcome":"delivered"})");
  CHECK(ActionResult::blocked("stale_state").json().dump() == R"({"code":"stale_state","outcome":"blocked"})");
  CHECK(ActionResult::unsupported("why").json().dump() == R"({"code":"unsupported_action","hint":"why","outcome":"unsupported"})");
}
