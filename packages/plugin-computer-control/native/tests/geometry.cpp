#include "geometry.hpp"
#include <iostream>
#include <stdexcept>

int main() {
  const moxxy::Rect source{-1920, -200, 1920, 1080};
  const auto point = moxxy::image_point(640, 360, 1280, 720, source);
  if (point.x != -960 || point.y != 340) throw std::runtime_error("DPI mapping failed");
  for (const auto x : {-1, 1280}) {
    bool rejected = false;
    try { moxxy::image_point(x, 0, 1280, 720, source); }
    catch (const std::exception&) { rejected = true; }
    if (!rejected) throw std::runtime_error("Out of bounds accepted");
  }
  std::cout << "geometry passed\n";
}
