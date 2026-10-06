#pragma once
#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

namespace moxxy {

struct Rect {
  double x = 0, y = 0, width = 0, height = 0;
  bool contains(double px, double py) const { return px >= x && py >= y && px < x + width && py < y + height; }
  bool operator==(const Rect&) const = default;
};

/// Largest size with the same aspect that fits the vision limits (`imageBudget` in `src/contract/image.ts`).
std::pair<int, int> image_budget(int width, int height);

/// How a picture maps onto the screen: `bounds` is the screen rectangle it shows.
struct ImageFrame {
  int width = 0;
  int height = 0;
  Rect bounds;
  /// A pixel of the picture as a screen point; `nullopt` outside the picture.
  std::optional<std::pair<double, double>> to_screen(double x, double y) const;
  /// A screen rectangle in the picture's pixels.
  Rect image_rect(const Rect& screen) const;
};

/// A screen point as a fraction of the window, clamped to it; the centre of a window with no size.
std::pair<double, double> fraction_of(double x, double y, const Rect& window);

/// Real pointer input waits for a moment in which the user is not using the mouse or keyboard:
/// up to six waits of 400 ms, so the two hands never fight over the pointer.
struct QuietDecision {
  enum Kind { go, wait, refuse } kind;
  double seconds = 0;
};
QuietDecision quiet_wait(double seconds_since_input, int attempt);

/// Wheel clicks for a scroll of `pages` over content `extent` pixels long (one click moves about 50).
int wheel_clicks(double pages, double extent);

/// A picture as rows of RGB bytes.
struct Pixels {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> rgb;
};

/// Whether the 9×9 pixels around a point differ between two pictures of the same window.
bool patch_changed(const Pixels& before, const Pixels& after, int x, int y);
/// The picture at another size, each new pixel the average of the ones it covers.
Pixels scale(const Pixels& source, int width, int height);

}  // namespace moxxy
