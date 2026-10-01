#pragma once
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <functional>
#include <string>
#include <thread>

#include <X11/Xlib.h>

namespace moxxy {

/// The live picture for the human: JPEG frames of the window in use, on a thread and a display
/// connection of its own. Nothing here reaches the model.
class PreviewStream {
 public:
  explicit PreviewStream(std::function<void(const std::string&)> emit) : emit_(std::move(emit)) {}
  ~PreviewStream() { stop(); }
  /// The window to show; 0 for none.
  void target(Window window) { window_ = window; }
  void start(double fps);
  void stop();

 private:
  void run(double fps);

  std::function<void(const std::string&)> emit_;
  std::atomic<Window> window_{0};
  std::mutex mutex_;
  std::condition_variable stopped_;
  bool running_ = false;
  std::thread thread_;
};

/// Pictures a second the preview may ask for: each one is a whole JPEG.
double preview_fps(double requested);

}  // namespace moxxy
