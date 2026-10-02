#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "json.hpp"

namespace moxxy {

/// One chord as the host parsed it (`parseKeyCombo` in `src/contract/keys.ts`), in X keysyms.
struct Chord {
  std::vector<unsigned long> modifiers;
  std::optional<unsigned long> key;
};

/// Throws `HelperError` for a chord the host should never send.
Chord parse_chord(const Json& chord);
/// The keysym of a neutral key name ("enter", "page_down", "numpad_3", "f5") or of a single character.
std::optional<unsigned long> keysym_for(const std::string& key);
unsigned long keysym_for_codepoint(char32_t code);
std::vector<char32_t> codepoints(std::string_view text);

}  // namespace moxxy
