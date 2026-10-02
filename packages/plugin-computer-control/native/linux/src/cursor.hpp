#pragma once
#include <functional>
#include <mutex>
#include <string>

#include "desktop.hpp"
#include "json.hpp"

namespace moxxy {

/// The agent's cursor: a dot drawn above the windows that shows where the agent acts. Clicks pass through
/// it, and every move is reported to the host as a fraction of the target window.
class AgentCursor {
 public:
  AgentCursor(Desktop& desktop, std::function<void(const std::string&)> emit);
  /// The window positions are reported against.
  void attach(const Rect& window);
  /// Glides to a screen point and reports the phase.
  void move(double x, double y);
  void phase(const std::string& phase);
  /// Takes the dot off the screen so a picture of the screen never shows it; the host keeps its last place.
  void lift();
  /// The user took over: the cursor is gone for the host as well, until `reveal`.
  void hide();
  void reveal();

 private:
  void place(double x, double y);
  void report(const std::string& phase);

  Desktop& desktop_;
  std::function<void(const std::string&)> emit_;
  std::mutex mutex_;
  Window window_ = 0;
  bool shown_ = false;
  bool known_ = false;
  bool away_ = false;
  double x_ = 0, y_ = 0;
  Rect target_;
};

}  // namespace moxxy
