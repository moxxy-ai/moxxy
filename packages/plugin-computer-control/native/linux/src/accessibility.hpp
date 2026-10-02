#pragma once
#include <atspi/atspi.h>
#include <memory>
#include <string>
#include <sys/types.h>
#include <vector>

#include "action.hpp"
#include "geometry.hpp"
#include "settle.hpp"
#include "tree.hpp"

namespace moxxy {

/// One element of a snapshot that actions can still reach.
struct Live {
  AtspiAccessible* object;
  std::string role;
  /// Every action it offers, in the order AT-SPI numbers them.
  std::vector<std::string> actions;
  bool editable;
  bool has_value;
};

/// The live elements behind one snapshot; `Node::handle` is a position in it.
class Handles {
 public:
  Handles() = default;
  Handles(Handles&& other) noexcept : live_(std::move(other.live_)) { other.live_.clear(); }
  Handles& operator=(Handles&& other) noexcept;
  ~Handles() { clear(); }
  int add(Live live);
  const Live& at(int handle) const { return live_.at(static_cast<size_t>(handle)); }
  void clear();

 private:
  std::vector<Live> live_;
};

/// The accessibility bus (AT-SPI). Used from the request thread only.
class Accessibility {
 public:
  /// `nullptr` when the session has no accessibility bus.
  static std::unique_ptr<Accessibility> open();
  /// Puts back the session's accessibility switch; safe from any thread.
  void restore();

  /// The application a process registered, or `nullptr`; the caller owns the reference.
  AtspiAccessible* application(pid_t pid);
  /// The app's window with that title, else its active one, else its first; the caller owns the reference.
  AtspiAccessible* window(AtspiAccessible* app, const std::string& title);
  /// Everything in a window. Frames are screen pixels: AT-SPI places elements inside the window at `origin`.
  Node snapshot(AtspiAccessible* window, const Rect& origin, Handles& handles);
  /// Waits until the app has stopped changing, woken by its accessibility events.
  void settle(AtspiAccessible* app, SettlePolicy policy);

  static bool alive(AtspiAccessible* element);
  static bool focused(AtspiAccessible* element);
  /// Where the element is now, in screen pixels.
  static std::optional<Rect> frame(AtspiAccessible* element, const Rect& origin);
  /// Runs the element's action with that name.
  static ActionResult act(const Live& live, const std::string& action);
  static bool focus(AtspiAccessible* element);
  /// Inserts at the caret, replacing a selection; `false` when the field did not take it.
  static bool insert(AtspiAccessible* element, const std::string& text);
  static ActionResult set_value(const Live& live, const std::string& text);

 private:
  bool was_enabled_ = true;
  bool switched_ = false;
};

}  // namespace moxxy
