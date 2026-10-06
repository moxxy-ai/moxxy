#include "preview.hpp"

#include <algorithm>

#include "desktop.hpp"
#include "jpeg.hpp"
#include "wire.hpp"

namespace moxxy {

namespace {
constexpr int max_edge = 960, quality = 60;
}  // namespace

double preview_fps(double requested) { return std::clamp(requested, 1.0, 5.0); }

void PreviewStream::start(double fps) {
  stop();
  { std::lock_guard lock(mutex_); running_ = true; }
  thread_ = std::thread([this, fps] { run(fps); });
}

void PreviewStream::stop() {
  { std::lock_guard lock(mutex_); running_ = false; }
  stopped_.notify_all();
  if (thread_.joinable()) thread_.join();
}

void PreviewStream::run(double fps) {
  OwnInput own;
  HeldInput held;
  const auto desktop = Desktop::open(own, held);
  long sequence = 0;
  const auto send = [&](Json::Object fields) {
    fields["seq"] = sequence++;
    emit_(wire::event("preview_frame", std::move(fields)));
  };
  if (!desktop) { send({{"error", "There is no display to capture"}}); return; }
  Pixels shown;
  Window failing = 0, reported = 0;
  double failing_since = 0, last_sent = 0;
  std::unique_lock lock(mutex_);
  while (running_) {
    lock.unlock();
    const double started = now();
    const Window window = window_;
    if (window) {
      if (auto picture = desktop->capture(window)) {
        failing = reported = 0;
        const double scale = std::min(1.0, double(max_edge) / std::max(picture->pixels.width, picture->pixels.height));
        const auto small = moxxy::scale(picture->pixels, std::max(1, int(picture->pixels.width * scale)), std::max(1, int(picture->pixels.height * scale)));
        if (small.width != shown.width || small.height != shown.height || small.rgb != shown.rgb) {
          send({{"image", image_json(small, quality)}});
          shown = small;
          last_sent = started;
        } else if (started - last_sent >= 1) {
          // An unchanged window still says it is being watched, once a second.
          send({});
          last_sent = started;
        }
      } else {
        if (failing != window) { failing = window; failing_since = started; }
        // A window can miss a picture while it is mapped, moved or redrawn, so it is tried again on every
        // tick; only one that stays out of reach for a second is reported, once, until it shows again.
        if (reported != window && started - failing_since >= 1) {
          reported = window;
          shown = {};
          send({{"error", "The window cannot be captured"}});
        }
      }
    }
    lock.lock();
    // A stop ends the wait for the next picture at once.
    stopped_.wait_for(lock, std::chrono::duration<double>(std::max(0.0, started + 1 / fps - now())), [&] { return !running_; });
  }
}

}  // namespace moxxy
