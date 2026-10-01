#include "geometry.hpp"

#include <algorithm>
#include <cmath>

namespace moxxy {

namespace {
constexpr int px_per_tile = 28, max_edge = 1568, max_tiles = 1568;

bool fits(int width, int height) {
  const int tiles = static_cast<int>(std::ceil(width / double(px_per_tile)) * std::ceil(height / double(px_per_tile)));
  return width <= max_edge && height <= max_edge && tiles <= max_tiles;
}
}  // namespace

std::pair<int, int> image_budget(int width, int height) {
  if (fits(width, height)) return {width, height};
  if (height > width) { const auto [longer, shorter] = image_budget(height, width); return {shorter, longer}; }
  const double aspect = double(width) / height;
  const auto height_for = [&](int w) { return std::max(1, static_cast<int>(std::lround(w / aspect))); };
  // Binary search the widest width that fits; `low` always fits, `high` never does.
  int low = 1, high = width;
  while (high - low > 1) {
    const int middle = (low + high) / 2;
    if (fits(middle, height_for(middle))) low = middle; else high = middle;
  }
  return {low, height_for(low)};
}

std::optional<std::pair<double, double>> ImageFrame::to_screen(double x, double y) const {
  if (x < 0 || y < 0 || x >= width || y >= height) return std::nullopt;
  return std::pair{bounds.x + x * bounds.width / width, bounds.y + y * bounds.height / height};
}

Rect ImageFrame::image_rect(const Rect& screen) const {
  const double sx = bounds.width > 0 ? width / bounds.width : 1, sy = bounds.height > 0 ? height / bounds.height : 1;
  return {(screen.x - bounds.x) * sx, (screen.y - bounds.y) * sy, screen.width * sx, screen.height * sy};
}

std::pair<double, double> fraction_of(double x, double y, const Rect& window) {
  if (window.width <= 0 || window.height <= 0) return {0.5, 0.5};
  return {std::clamp((x - window.x) / window.width, 0.0, 1.0), std::clamp((y - window.y) / window.height, 0.0, 1.0)};
}

QuietDecision quiet_wait(double seconds_since_input, int attempt) {
  constexpr double moment = 0.4;
  constexpr int attempts = 6;
  if (seconds_since_input >= moment) return {QuietDecision::go};
  if (attempt >= attempts) return {QuietDecision::refuse};
  return {QuietDecision::wait, moment - seconds_since_input};
}

int wheel_clicks(double pages, double extent) {
  return std::clamp(static_cast<int>(std::lround(pages * extent / 50)), 1, 200);
}

bool patch_changed(const Pixels& before, const Pixels& after, int x, int y) {
  if (before.width != after.width || before.height != after.height) return true;
  constexpr int reach = 4, tolerance = 24;
  for (int row = std::max(0, y - reach); row <= std::min(before.height - 1, y + reach); row++) {
    for (int column = std::max(0, x - reach); column <= std::min(before.width - 1, x + reach); column++) {
      const size_t at = (size_t(row) * before.width + column) * 3;
      for (int channel = 0; channel < 3; channel++) if (std::abs(before.rgb[at + channel] - after.rgb[at + channel]) > tolerance) return true;
    }
  }
  return false;
}

Pixels scale(const Pixels& source, int width, int height) {
  if (width == source.width && height == source.height) return source;
  Pixels out{width, height, std::vector<uint8_t>(size_t(width) * height * 3)};
  for (int y = 0; y < height; y++) {
    const int top = y * source.height / height, bottom = std::max(top + 1, (y + 1) * source.height / height);
    for (int x = 0; x < width; x++) {
      const int left = x * source.width / width, right = std::max(left + 1, (x + 1) * source.width / width);
      unsigned sum[3] = {0, 0, 0};
      for (int row = top; row < bottom; row++) {
        const uint8_t* pixel = &source.rgb[(size_t(row) * source.width + left) * 3];
        for (int column = left; column < right; column++, pixel += 3) { sum[0] += pixel[0]; sum[1] += pixel[1]; sum[2] += pixel[2]; }
      }
      const unsigned count = unsigned(bottom - top) * unsigned(right - left);
      uint8_t* target = &out.rgb[(size_t(y) * width + x) * 3];
      for (int channel = 0; channel < 3; channel++) target[channel] = static_cast<uint8_t>(sum[channel] / count);
    }
  }
  return out;
}

}  // namespace moxxy
