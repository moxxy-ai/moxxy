#include "check.hpp"
#include "keys.hpp"

#include <X11/keysym.h>

using namespace moxxy;

TEST(named_keys_map_to_keysyms) {
  CHECK(keysym_for("enter") == XK_Return);
  CHECK(keysym_for("forward_delete") == XK_Delete);
  CHECK(keysym_for("backspace") == XK_BackSpace);
  CHECK(keysym_for("page_down") == XK_Next);
  CHECK(keysym_for("numpad_7") == XK_KP_7);
  CHECK(keysym_for("numpad_enter") == XK_KP_Enter);
  CHECK(keysym_for("f12") == XK_F12);
  CHECK(keysym_for("a") == XK_a);
  CHECK(keysym_for("+") == XK_plus);
  CHECK(!keysym_for("warp").has_value());
}

TEST(characters_map_to_keysyms_by_code_point) {
  CHECK(keysym_for_codepoint(U'A') == XK_A);
  CHECK(keysym_for_codepoint(U'\n') == XK_Return);
  CHECK(keysym_for_codepoint(U'\t') == XK_Tab);
  CHECK(keysym_for_codepoint(0x00E9) == XK_eacute);
  CHECK(keysym_for_codepoint(0x0142) == 0x01000142);  // ł
  CHECK(keysym_for_codepoint(0x1F600) == 0x0101F600);
}

TEST(text_is_read_as_code_points) {
  CHECK((codepoints("a\xC5\x82\xF0\x9F\x98\x80") == std::vector<char32_t>{U'a', 0x0142, 0x1F600}));
}

TEST(a_chord_names_its_modifiers_and_one_key) {
  const auto chord = parse_chord(*Json::parse(R"({"modifiers":["ctrl","shift"],"key":"tab"})"));
  CHECK((chord.modifiers == std::vector<unsigned long>{XK_Control_L, XK_Shift_L}));
  CHECK(chord.key == XK_Tab);
  const auto bare = parse_chord(*Json::parse(R"({"modifiers":["meta"],"key":null})"));
  CHECK(bare.modifiers == std::vector<unsigned long>{XK_Super_L} && !bare.key.has_value());
  CHECK_THROWS(parse_chord(*Json::parse(R"({"modifiers":["hyper"],"key":"a"})")));
  CHECK_THROWS(parse_chord(*Json::parse(R"({"modifiers":[],"key":"warp"})")));
  CHECK_THROWS(parse_chord(*Json::parse(R"({"key":"a"})")));
}
