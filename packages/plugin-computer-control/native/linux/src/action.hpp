#pragma once
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "json.hpp"
#include "keys.hpp"

namespace moxxy {

/// Where a step points: an element index from the last state, or a pixel of the last screenshot.
struct Target {
  std::optional<int> element;
  double x = 0, y = 0;
};

/// One step of `act`, already validated by the TypeScript contract; checked again here.
struct ActionRequest {
  enum Kind { click, type_text, press_key, scroll, drag, set_value, secondary, unknown } kind = unknown;
  /// Absent for typing into whatever has keyboard focus.
  std::optional<Target> target;
  /// 1 left, 2 middle, 3 right: the X button numbers.
  unsigned button = 1;
  int count = 1;
  /// Keysyms of the modifiers held during a click or drag.
  std::vector<unsigned long> held;
  std::string text;
  Chord chord;
  std::string direction;
  double pages = 1;
  std::vector<std::pair<double, double>> path;
  double duration = 0;

  /// Throws `HelperError`.
  static ActionRequest parse(const Json& step);
  /// Names what the step does, so a second try at the same thing is recognised.
  std::string signature() const;
};

/// `actionResultSchema` in `src/contract/outcome.ts`: `delivered` means sent, never verified.
struct ActionResult {
  std::string outcome;
  std::string code;
  std::string hint;
  std::string method;

  static ActionResult delivered(std::string method) { return {"delivered", "", "", std::move(method)}; }
  static ActionResult blocked(std::string code, std::string hint = "") { return {"blocked", std::move(code), std::move(hint), ""}; }
  static ActionResult unsupported(std::string hint = "") { return {"unsupported", "unsupported_action", std::move(hint), ""}; }
  static ActionResult ineffective(std::string hint) { return {"ineffective", "", std::move(hint), ""}; }
  Json json() const;
};

}  // namespace moxxy
