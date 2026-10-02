#include "text.hpp"

#include <cstdio>
#include <vector>

namespace moxxy {

namespace {

/// Length in bytes of the well-formed character at `at`, or 0.
size_t character(std::string_view text, size_t at) {
  const auto byte = [&](size_t index) { return static_cast<unsigned char>(text[index]); };
  const unsigned char lead = byte(at);
  if (lead < 0x80) return 1;
  const size_t length = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC2 ? 2 : 0;
  if (length == 0 || lead > 0xF4 || at + length > text.size()) return 0;
  for (size_t index = 1; index < length; index++) if ((byte(at + index) & 0xC0) != 0x80) return 0;
  const unsigned char second = byte(at + 1);
  if (lead == 0xE0 && second < 0xA0) return 0;  // overlong
  if (lead == 0xED && second > 0x9F) return 0;  // surrogate
  if (lead == 0xF0 && second < 0x90) return 0;  // overlong
  if (lead == 0xF4 && second > 0x8F) return 0;  // past U+10FFFF
  return length;
}

}  // namespace

bool valid_utf8(std::string_view text) {
  for (size_t at = 0; at < text.size();) {
    const size_t length = character(text, at);
    if (length == 0) return false;
    at += length;
  }
  return true;
}

std::string clean_utf8(std::string_view text) {
  if (valid_utf8(text)) return std::string(text);
  std::string out;
  for (size_t at = 0; at < text.size();) {
    const size_t length = character(text, at);
    if (length == 0) { out += "\xEF\xBF\xBD"; at++; }
    else { out.append(text.substr(at, length)); at += length; }
  }
  return out;
}

size_t utf16_length(std::string_view text) {
  size_t units = 0;
  for (size_t at = 0; at < text.size();) {
    const size_t length = character(text, at);
    units += length == 4 ? 2 : 1;
    at += length == 0 ? 1 : length;
  }
  return units;
}

std::string fit(std::string_view text, size_t units, bool from_end) {
  if (utf16_length(text) <= units) return std::string(text);
  std::vector<std::pair<size_t, size_t>> characters;  // offset, bytes
  for (size_t at = 0; at < text.size();) {
    const size_t length = character(text, at);
    characters.emplace_back(at, length == 0 ? 1 : length);
    at += characters.back().second;
  }
  size_t used = 0;
  size_t kept = 0;
  for (; kept < characters.size(); kept++) {
    const auto& [offset, bytes] = characters[from_end ? characters.size() - 1 - kept : kept];
    const size_t size = bytes == 4 ? 2 : 1;
    if (used + size > units) break;
    used += size;
  }
  if (kept == 0) return {};
  if (!from_end) return std::string(text.substr(0, characters[kept - 1].first + characters[kept - 1].second));
  return std::string(text.substr(characters[characters.size() - kept].first));
}

std::string wire_key(std::string_view key) {
  constexpr size_t limit = 512;
  if (utf16_length(key) <= limit) return std::string(key);
  // A key that is too long keeps its readable end behind a hash of the whole path.
  uint64_t hash = 14695981039346656037ull;
  for (const char c : key) hash = (hash ^ static_cast<unsigned char>(c)) * 1099511628211ull;
  char head[32];
  const int written = std::snprintf(head, sizeof head, "~%llx/", static_cast<unsigned long long>(hash));
  return std::string(head, written) + fit(key, limit - written, true);
}

std::string base64(const uint8_t* bytes, size_t length) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((length + 2) / 3 * 4);
  for (size_t at = 0; at < length; at += 3) {
    const unsigned a = bytes[at], b = at + 1 < length ? bytes[at + 1] : 0, c = at + 2 < length ? bytes[at + 2] : 0;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b >> 4)];
    out += at + 1 < length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=';
    out += at + 2 < length ? alphabet[c & 63] : '=';
  }
  return out;
}

std::string lower(std::string_view text) {
  std::string out(text);
  for (char& c : out) if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  return out;
}

}  // namespace moxxy
