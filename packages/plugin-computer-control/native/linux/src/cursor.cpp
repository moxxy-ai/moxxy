#include "cursor.hpp"

#include <X11/Xutil.h>
#include <X11/extensions/Xfixes.h>
#include <X11/extensions/shape.h>
#include <algorithm>
#include <cmath>
#include <thread>

#include "wire.hpp"

namespace moxxy {

namespace {
constexpr int size = 22;
constexpr unsigned long tint = 0xD62A00;
constexpr double minimum_glide = 0.18, maximum_glide = 0.5, seconds_per_pixel = 0.0006;
}  // namespace

AgentCursor::AgentCursor(Desktop& desktop, std::function<void(const std::string&)> emit) : desktop_(desktop), emit_(std::move(emit)) {
  Display* display = desktop_.display();
  XSetWindowAttributes attributes{};
  attributes.override_redirect = True;
  attributes.background_pixel = tint;
  attributes.border_pixel = 0xFFFFFF;
  window_ = XCreateWindow(display, desktop_.root(), 0, 0, size, size, 0, CopyFromParent, InputOutput, CopyFromParent,
                          CWOverrideRedirect | CWBackPixel | CWBorderPixel, &attributes);
  const Pixmap mask = XCreatePixmap(display, window_, size, size, 1);
  const GC context = XCreateGC(display, mask, 0, nullptr);
  XSetForeground(display, context, 0);
  XFillRectangle(display, mask, context, 0, 0, size, size);
  XSetForeground(display, context, 1);
  XFillArc(display, mask, context, 0, 0, size - 1, size - 1, 0, 360 * 64);
  XShapeCombineMask(display, window_, ShapeBounding, 0, 0, mask, ShapeSet);
  XFreeGC(display, context);
  XFreePixmap(display, mask);
  // No input shape at all: every click and move goes to the window underneath.
  const XserverRegion nothing = XFixesCreateRegion(display, nullptr, 0);
  XFixesSetWindowShapeRegion(display, window_, ShapeInput, 0, 0, nothing);
  XFixesDestroyRegion(display, nothing);
  desktop_.ignore(window_);
}

void AgentCursor::attach(const Rect& window) {
  std::lock_guard lock(mutex_);
  target_ = window;
  if (known_ || away_) return;
  // Before its first move it waits in the middle of the window.
  known_ = true;
  x_ = window.x + window.width / 2;
  y_ = window.y + window.height / 2;
  report("idle");
}

void AgentCursor::place(double x, double y) {
  x_ = x;
  y_ = y;
  XMoveWindow(desktop_.display(), window_, static_cast<int>(x) - size / 2, static_cast<int>(y) - size / 2);
  if (!shown_) { XMapRaised(desktop_.display(), window_); shown_ = true; }
  XFlush(desktop_.display());
}

void AgentCursor::report(const std::string& phase) {
  const auto [x, y] = fraction_of(x_, y_, target_);
  emit_(wire::event("cursor", {{"cursor", Json::Object{{"phase", phase}, {"x", x}, {"y", y}}}}));
}

void AgentCursor::move(double x, double y) {
  std::lock_guard lock(mutex_);
  if (away_) return;
  // The first time it appears where it is needed; afterwards it travels there, longer for a longer way.
  const double from_x = known_ ? x_ : x, from_y = known_ ? y_ : y;
  const double distance = std::hypot(x - from_x, y - from_y);
  const double duration = distance < 1 ? 0 : std::clamp(minimum_glide + distance * seconds_per_pixel, minimum_glide, maximum_glide);
  known_ = true;
  x_ = x;
  y_ = y;
  report("moving");
  const double start = now();
  while (duration > 0) {
    const double t = std::min(1.0, (now() - start) / duration);
    // Ease out: fast at first, slow into the target.
    const double eased = 1 - (1 - t) * (1 - t);
    place(from_x + (x - from_x) * eased, from_y + (y - from_y) * eased);
    if (t >= 1) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(12));
  }
  place(x, y);
}

void AgentCursor::phase(const std::string& phase) {
  std::lock_guard lock(mutex_);
  if (known_ && !away_) report(phase);
}

void AgentCursor::lift() {
  std::lock_guard lock(mutex_);
  if (!shown_) return;
  XUnmapWindow(desktop_.display(), window_);
  XFlush(desktop_.display());
  shown_ = false;
}

void AgentCursor::hide() {
  lift();
  std::lock_guard lock(mutex_);
  away_ = true;
  if (known_) emit_(wire::event("cursor", {{"cursor", nullptr}}));
}

void AgentCursor::reveal() {
  std::lock_guard lock(mutex_);
  if (!away_) return;
  away_ = false;
  if (known_) report("idle");
}

}  // namespace moxxy
