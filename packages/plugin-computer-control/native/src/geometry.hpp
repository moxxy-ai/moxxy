#pragma once
#include <algorithm>
#include <cstdint>
#include <stdexcept>

namespace moxxy {
struct Rect {
  int x, y, width, height;
  bool operator==(const Rect&) const = default;
};
struct Point { int x, y; };
inline Point image_point(int x, int y, int width, int height, Rect source) {
  if (width <= 0 || height <= 0 || source.width <= 0 || source.height <= 0 ||
      x < 0 || y < 0 || x >= width || y >= height) throw std::runtime_error("Point outside capture");
  return { source.x + static_cast<int>(static_cast<int64_t>(x) * source.width / width),
           source.y + static_cast<int>(static_cast<int64_t>(y) * source.height / height) };
}
}
