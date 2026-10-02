#pragma once
#include <X11/Xlib.h>
#include <atomic>
#include <chrono>
#include <functional>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <sys/types.h>
#include <vector>

#include "geometry.hpp"

namespace moxxy {

/// One application window as the X server and the window manager describe it.
struct WindowInfo {
  Window id = 0;
  pid_t pid = 0;
  std::string title;
  /// The two parts of WM_CLASS: instance and class.
  std::string instance;
  std::string app_class;
  /// Screen pixels.
  Rect frame;
  bool viewable = false;
};

/// A window captured as a picture, with the screen rectangle it shows.
struct WindowPicture {
  Pixels pixels;
  Rect bounds;
};

/// When this helper last sent input. Synthetic events all come from the same virtual device, whoever
/// sent them, so the watcher of the user's own input takes the ones that follow at once for the helper's.
struct OwnInput {
  std::atomic<double> until{0};
  void mark();
  bool recent() const;
};

/// What the helper holds down, so it can let go when it leaves in the middle of a gesture.
class HeldInput {
 public:
  void key(unsigned keycode, bool down);
  void button(unsigned button, bool down);
  /// Releases everything on a connection of its own; safe from any thread.
  void release_all();

 private:
  std::mutex mutex_;
  std::set<unsigned> keys_;
  std::set<unsigned> buttons_;
};

/// The X11 display: windows, pictures of them and synthetic input. One connection, used from one thread.
class Desktop {
 public:
  /// `nullptr` when there is no X display to connect to.
  static std::unique_ptr<Desktop> open(OwnInput& own, HeldInput& held);
  ~Desktop();

  Display* display() const { return display_; }
  Window root() const { return root_; }
  std::pair<int, int> screen_size() const;
  bool has_input() const { return xtest_; }

  /// Application windows, topmost first.
  std::vector<WindowInfo> windows();
  std::optional<WindowInfo> info(Window window);
  std::optional<Window> active();
  /// Asks the window manager to bring the window forward and waits until it is the active one.
  bool activate(Window window, double seconds);
  /// The window's own pixels, even where another window covers it; `nullopt` when it is not shown.
  std::optional<WindowPicture> capture(Window window);
  /// The process whose window is on top at a screen point (0 when unknown) and whether that window is `target`.
  std::pair<pid_t, bool> owner_at(double x, double y, Window target);
  /// A window drawn above everything that the hit test must look through.
  void ignore(Window window) { ignored_ = window; }

  std::pair<int, int> pointer();
  void move(double x, double y);
  void button(unsigned button, bool down);
  void click(unsigned button, int count);
  void key(unsigned long keysym, bool down);
  void type(const std::vector<char32_t>& text);

  /// Blocks until `done` holds or the time is up, waking on every X event instead of polling.
  bool wait_for(const std::function<bool()>& done, double seconds);
  void sync() { XSync(display_, False); }

 private:
  Desktop(Display* display, OwnInput& own, HeldInput& held);
  Atom atom(const char* name);
  std::optional<std::vector<unsigned long>> cardinals(Window window, Atom property, Atom type);
  std::string text(Window window, Atom property);
  bool descends(Window window, Window ancestor);
  pid_t pid_inside(Window top);
  /// A key and whether it needs Shift, bound for the moment when the layout has no key for the symbol.
  std::pair<unsigned, bool> keycode(unsigned long keysym);
  void restore_scratch();

  Display* display_;
  Window root_;
  OwnInput& own_;
  HeldInput& held_;
  bool xtest_ = false;
  bool composite_ = false;
  std::set<Window> redirected_;
  Window ignored_ = 0;
  unsigned scratch_ = 0;
  bool scratch_bound_ = false;
};

/// Seconds on a clock that never jumps.
double now();

}  // namespace moxxy
