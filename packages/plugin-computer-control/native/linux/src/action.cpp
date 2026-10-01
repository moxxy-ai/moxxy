#include "action.hpp"

#include "text.hpp"
#include "wire.hpp"

namespace moxxy {

namespace {

const std::string* text_of(const Json& step, const char* name) {
  const auto* field = step.find(name);
  return field ? field->string() : nullptr;
}

std::optional<long> whole(const Json& step, const char* name) {
  const auto* field = step.find(name);
  return field ? field->integer() : std::nullopt;
}

std::optional<double> number(const Json& step, const char* name) {
  const auto* field = step.find(name);
  return field && field->number() ? std::optional(*field->number()) : std::nullopt;
}

int index_of(const Json& step) {
  const auto index = whole(step, "element_index");
  if (!index || *index < 0) throw HelperError::invalid_params("element_index is required");
  return static_cast<int>(*index);
}

Target target_of(const Json& step) {
  if (step.find("element_index")) return {index_of(step), 0, 0};
  const auto x = number(step, "x"), y = number(step, "y");
  if (!x || !y || *x < 0 || *y < 0) throw HelperError::invalid_params("give element_index, or x and y");
  return {std::nullopt, *x, *y};
}

unsigned button_of(const Json& step) {
  const auto* name = text_of(step, "mouse_button");
  if (name && *name == "left") return 1;
  if (name && *name == "middle") return 2;
  if (name && *name == "right") return 3;
  throw HelperError::invalid_params("mouse_button is required");
}

std::vector<unsigned long> held_of(const Json& step) {
  const auto* held = step.find("held");
  if (!held) return {};
  return parse_chord(Json::Object{{"modifiers", *held}, {"key", nullptr}}).modifiers;
}

}  // namespace

ActionRequest ActionRequest::parse(const Json& step) {
  const auto* action = text_of(step, "action");
  if (!action) throw HelperError::invalid_params("action is required");
  ActionRequest request;
  if (*action == "click") {
    const auto count = whole(step, "click_count");
    if (!count || *count < 1 || *count > 3) throw HelperError::invalid_params("click needs click_count");
    request.kind = click;
    request.target = target_of(step);
    request.button = button_of(step);
    request.count = static_cast<int>(*count);
    request.held = held_of(step);
  } else if (*action == "type_text") {
    const auto* text = text_of(step, "text");
    if (!text || text->empty()) throw HelperError::invalid_params("text is required");
    request.kind = type_text;
    if (step.find("element_index") || step.find("x")) request.target = target_of(step);
    request.text = *text;
  } else if (*action == "press_key") {
    const auto* chord = step.find("chord");
    const auto count = whole(step, "repeat");
    if (!chord || !count || *count < 1 || *count > 100) throw HelperError::invalid_params("press_key needs chord and repeat");
    request.kind = press_key;
    request.chord = parse_chord(*chord);
    request.count = static_cast<int>(*count);
  } else if (*action == "scroll") {
    const auto* direction = text_of(step, "direction");
    const auto pages = number(step, "pages");
    const bool known = direction && (*direction == "up" || *direction == "down" || *direction == "left" || *direction == "right");
    if (!known || !pages || *pages <= 0 || *pages > 50) throw HelperError::invalid_params("scroll needs direction and pages");
    request.kind = scroll;
    request.target = target_of(step);
    request.direction = *direction;
    request.pages = *pages;
  } else if (*action == "drag") {
    const auto* path = step.find("path");
    if (!path || !path->array() || path->array()->size() < 2 || path->array()->size() > 20) throw HelperError::invalid_params("drag needs 2 to 20 points");
    for (const auto& point : *path->array()) {
      const auto* pair = point.array();
      if (!pair || pair->size() != 2 || !(*pair)[0].number() || !(*pair)[1].number() || *(*pair)[0].number() < 0 || *(*pair)[1].number() < 0) {
        throw HelperError::invalid_params("drag points are [x, y] pixels");
      }
      request.path.emplace_back(*(*pair)[0].number(), *(*pair)[1].number());
    }
    const auto milliseconds = whole(step, "duration_ms").value_or(0);
    if (milliseconds < 0 || milliseconds > 10'000) throw HelperError::invalid_params("duration_ms must be 0 to 10000");
    request.kind = drag;
    request.button = button_of(step);
    request.duration = milliseconds / 1000.0;
    request.held = held_of(step);
  } else if (*action == "set_value") {
    const auto* value = text_of(step, "value");
    if (!value) throw HelperError::invalid_params("set_value needs value");
    request.kind = set_value;
    request.target = Target{index_of(step), 0, 0};
    request.text = *value;
  } else if (*action == "perform_secondary_action") {
    const auto* name = text_of(step, "secondary_action");
    if (!name || name->empty()) throw HelperError::invalid_params("perform_secondary_action needs secondary_action");
    request.kind = secondary;
    request.target = Target{index_of(step), 0, 0};
    request.text = *name;
  }
  return request;
}

std::string ActionRequest::signature() const {
  std::string text = std::to_string(kind) + " " + std::to_string(button) + " " + std::to_string(count) + " " + this->text + " " + direction;
  if (target) text += target->element ? " #" + std::to_string(*target->element) : " @" + std::to_string(target->x) + "," + std::to_string(target->y);
  for (const auto modifier : held) text += " +" + std::to_string(modifier);
  for (const auto& [x, y] : path) text += " " + std::to_string(x) + "," + std::to_string(y);
  return text;
}

Json ActionResult::json() const {
  Json::Object fields{{"outcome", outcome}};
  if (!code.empty()) fields["code"] = code;
  if (!hint.empty()) fields["hint"] = fit(hint, 1000);
  if (!method.empty()) fields["method"] = method;
  return fields;
}

}  // namespace moxxy
