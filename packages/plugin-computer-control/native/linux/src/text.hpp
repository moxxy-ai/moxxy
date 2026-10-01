#pragma once
#include <cstdint>
#include <string>
#include <string_view>

namespace moxxy {

/// Whether the bytes are well-formed UTF-8 (no overlong forms, no surrogates).
bool valid_utf8(std::string_view text);
/// Text from an application made safe to send: bytes that are not UTF-8 become U+FFFD.
std::string clean_utf8(std::string_view text);
/// Length in UTF-16 code units, which is what the contract's limits count.
size_t utf16_length(std::string_view text);
/// The longest run of whole characters within `units` UTF-16 code units, from the start or from the end.
std::string fit(std::string_view text, size_t units, bool from_end = false);
/// An element key as the contract takes it: at most 512 units and still unique on a deep tree.
std::string wire_key(std::string_view key);
std::string base64(const uint8_t* bytes, size_t length);
std::string lower(std::string_view text);

}  // namespace moxxy
