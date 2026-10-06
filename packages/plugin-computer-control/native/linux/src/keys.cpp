#include "keys.hpp"

#include <X11/keysym.h>
#include <map>

#include "wire.hpp"

namespace moxxy {

namespace {

const std::map<std::string, unsigned long> named{
    {"enter", XK_Return}, {"tab", XK_Tab}, {"escape", XK_Escape}, {"backspace", XK_BackSpace}, {"forward_delete", XK_Delete},
    {"insert", XK_Insert}, {"space", XK_space}, {"up", XK_Up}, {"down", XK_Down}, {"left", XK_Left}, {"right", XK_Right},
    {"home", XK_Home}, {"end", XK_End}, {"page_up", XK_Prior}, {"page_down", XK_Next}, {"caps_lock", XK_Caps_Lock},
    {"help", XK_Help}, {"menu", XK_Menu}, {"numpad_enter", XK_KP_Enter}, {"numpad_add", XK_KP_Add},
    {"numpad_subtract", XK_KP_Subtract}, {"numpad_multiply", XK_KP_Multiply}, {"numpad_divide", XK_KP_Divide},
    {"numpad_decimal", XK_KP_Decimal}, {"numpad_equal", XK_KP_Equal},
};

const std::map<std::string, unsigned long> modifiers{
    {"ctrl", XK_Control_L}, {"alt", XK_Alt_L}, {"shift", XK_Shift_L}, {"meta", XK_Super_L},
};

}  // namespace

unsigned long keysym_for_codepoint(char32_t code) {
  if (code == U'\n' || code == U'\r') return XK_Return;
  if (code == U'\t') return XK_Tab;
  // Latin-1 characters are their own keysyms; everything else is the code point with the Unicode flag.
  if ((code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF)) return code;
  return 0x01000000ul | code;
}

std::vector<char32_t> codepoints(std::string_view text) {
  std::vector<char32_t> out;
  for (size_t at = 0; at < text.size();) {
    const auto lead = static_cast<unsigned char>(text[at]);
    const size_t length = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
    if (at + length > text.size()) break;
    char32_t code = length == 1 ? lead : lead & (0xFF >> (length + 1));
    for (size_t index = 1; index < length; index++) code = (code << 6) | (static_cast<unsigned char>(text[at + index]) & 0x3F);
    out.push_back(code);
    at += length;
  }
  return out;
}

std::optional<unsigned long> keysym_for(const std::string& key) {
  if (const auto found = named.find(key); found != named.end()) return found->second;
  if (key.starts_with("numpad_") && key.size() == 8 && key[7] >= '0' && key[7] <= '9') return XK_KP_0 + (key[7] - '0');
  if (key.size() >= 2 && key.size() <= 3 && key[0] == 'f') {
    const int number = std::atoi(key.c_str() + 1);
    if (number >= 1 && number <= 24 && std::to_string(number) == key.substr(1)) return XK_F1 + (number - 1);
  }
  const auto points = codepoints(key);
  if (points.size() == 1) return keysym_for_codepoint(points[0]);
  return std::nullopt;
}

Chord parse_chord(const Json& chord) {
  const auto* held = chord.find("modifiers");
  const auto* key = chord.find("key");
  if (!held || !held->array() || !key) throw HelperError::invalid_params("a chord has modifiers and a key");
  Chord parsed;
  for (const auto& name : *held->array()) {
    const auto* text = name.string();
    const auto found = text ? modifiers.find(*text) : modifiers.end();
    if (found == modifiers.end()) throw HelperError::invalid_params("unknown modifier");
    parsed.modifiers.push_back(found->second);
  }
  if (key->is_null()) return parsed;
  const auto symbol = key->string() ? keysym_for(*key->string()) : std::nullopt;
  if (!symbol) throw HelperError{"invalid_key", "unknown key"};
  parsed.key = symbol;
  return parsed;
}

}  // namespace moxxy
