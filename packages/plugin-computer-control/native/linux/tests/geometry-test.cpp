#include "check.hpp"
#include "geometry.hpp"

using namespace moxxy;

TEST(image_budget_matches_the_typescript_contract) {
  CHECK((image_budget(800, 600) == std::pair{800, 600}));
  // Values computed by imageBudget in src/contract/image.ts.
  CHECK((image_budget(1920, 1080) == std::pair{1456, 819}));
  CHECK((image_budget(1080, 1920) == std::pair{819, 1456}));
  CHECK((image_budget(3000, 400) == std::pair{1568, 209}));
}

TEST(a_picture_point_maps_to_the_screen_and_back) {
  const ImageFrame frame{400, 300, Rect{100, 200, 800, 600}};
  const auto point = frame.to_screen(200, 150);
  CHECK(point.has_value() && point->first == 500 && point->second == 500);
  CHECK(!frame.to_screen(400, 10).has_value());
  CHECK(!frame.to_screen(-1, 10).has_value());
  const auto rect = frame.image_rect(Rect{300, 400, 80, 60});
  CHECK(rect.x == 100 && rect.y == 100 && rect.width == 40 && rect.height == 30);
}

TEST(the_cursor_position_is_a_fraction_of_the_window) {
  const Rect window{100, 100, 400, 200};
  CHECK((fraction_of(300, 150, window) == std::pair{0.5, 0.25}));
  CHECK((fraction_of(0, 900, window) == std::pair{0.0, 1.0}));
  CHECK((fraction_of(5, 5, Rect{0, 0, 0, 0}) == std::pair{0.5, 0.5}));
}

TEST(real_pointer_input_waits_for_a_quiet_moment) {
  CHECK(quiet_wait(0.5, 0).kind == QuietDecision::go);
  CHECK(quiet_wait(0.1, 0).kind == QuietDecision::wait);
  CHECK(quiet_wait(0.1, 6).kind == QuietDecision::refuse);
}

TEST(a_scroll_of_pages_becomes_wheel_clicks) {
  CHECK(wheel_clicks(1, 500) == 10);
  CHECK(wheel_clicks(0.1, 100) == 1);
  CHECK(wheel_clicks(50, 2000) == 200);
}

TEST(a_patch_of_pixels_tells_whether_the_target_changed) {
  Pixels before{20, 20, std::vector<uint8_t>(20 * 20 * 3, 100)};
  Pixels after = before;
  CHECK(!patch_changed(before, after, 10, 10));
  after.rgb[(10 * 20 + 10) * 3] = 250;
  CHECK(patch_changed(before, after, 10, 10));
  CHECK(!patch_changed(before, after, 1, 1));
  CHECK(patch_changed(before, Pixels{10, 10, std::vector<uint8_t>(300, 100)}, 5, 5));
}

TEST(a_picture_is_scaled_to_the_asked_size) {
  Pixels source{4, 2, {}};
  for (int index = 0; index < 8; index++) { const uint8_t shade = index < 4 ? 0 : 200; source.rgb.insert(source.rgb.end(), {shade, shade, shade}); }
  const auto half = scale(source, 2, 1);
  CHECK(half.width == 2 && half.height == 1 && half.rgb.size() == 6);
  CHECK(half.rgb[0] == 100 && half.rgb[3] == 100);
  CHECK(scale(source, 4, 2).rgb == source.rgb);
}
