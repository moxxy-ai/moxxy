#pragma once
#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <sys/types.h>

#include "desktop.hpp"

namespace moxxy {

/// The host's pause control: an action that arrives while paused waits here until the user resumes.
class ControlGate {
 public:
  /// `emit` reports "paused_by_user" and "recovering" for the request that waits.
  explicit ControlGate(std::function<void(const std::string&)> emit) : emit_(std::move(emit)) {}
  void pause();
  void resume();
  /// `true` when the action had to wait; the caller must not act on its old observation.
  bool wait_while_paused();

 private:
  std::function<void(const std::string&)> emit_;
  std::mutex mutex_;
  std::condition_variable resumed_;
  bool paused_ = false;
};

/// The user's own mouse and keyboard, watched without taking anything from them. Their Escape stops Computer Use.
class UserActivity {
 public:
  UserActivity(OwnInput& own, std::function<void()> on_escape) : own_(own), on_escape_(std::move(on_escape)) {}
  /// Starts watching on a thread of its own; `false` when the display has no raw input events.
  bool start();
  /// Seconds since the user last used the mouse or keyboard; a long time when nobody is watching.
  double seconds_since_input() const;

 private:
  void watch(Display* display, int opcode);

  OwnInput& own_;
  std::function<void()> on_escape_;
  std::atomic<double> last_{-1e9};
};

/// Calls `on_exit` when the process this helper serves is gone. `false` when it is gone already.
bool watch_parent(pid_t parent, std::function<void()> on_exit);

}  // namespace moxxy
