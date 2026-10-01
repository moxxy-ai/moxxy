#include "json.hpp"

#include <charconv>
#include <cmath>
#include <cstdio>

namespace moxxy {

const Json* Json::find(const std::string& key) const {
  const auto* fields = object();
  if (!fields) return nullptr;
  const auto found = fields->find(key);
  return found == fields->end() ? nullptr : &found->second;
}

std::optional<long> Json::integer() const {
  const auto* value = number();
  if (!value || std::floor(*value) != *value || std::fabs(*value) > 9007199254740991.0) return std::nullopt;
  return static_cast<long>(*value);
}

namespace {

constexpr int max_depth = 128;

void append_utf8(std::string& out, unsigned code) {
  if (code < 0x80) out += static_cast<char>(code);
  else if (code < 0x800) { out += static_cast<char>(0xC0 | (code >> 6)); out += static_cast<char>(0x80 | (code & 0x3F)); }
  else if (code < 0x10000) {
    out += static_cast<char>(0xE0 | (code >> 12)); out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (code >> 18)); out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F)); out += static_cast<char>(0x80 | (code & 0x3F));
  }
}

struct Parser {
  std::string_view text;
  size_t at = 0;
  bool failed = false;

  void skip() { while (at < text.size() && (text[at] == ' ' || text[at] == '\t' || text[at] == '\n' || text[at] == '\r')) at++; }
  bool take(char expected) { if (at < text.size() && text[at] == expected) { at++; return true; } return false; }
  bool word(std::string_view expected) { if (text.substr(at, expected.size()) == expected) { at += expected.size(); return true; } return false; }
  Json fail() { failed = true; return Json(); }

  std::optional<unsigned> hex4() {
    if (at + 4 > text.size()) return std::nullopt;
    unsigned value = 0;
    const auto [end, error] = std::from_chars(text.data() + at, text.data() + at + 4, value, 16);
    if (error != std::errc() || end != text.data() + at + 4) return std::nullopt;
    at += 4;
    return value;
  }

  std::optional<std::string> string() {
    if (!take('"')) return std::nullopt;
    std::string out;
    while (at < text.size()) {
      const char c = text[at++];
      if (c == '"') return out;
      if (static_cast<unsigned char>(c) < 0x20) return std::nullopt;
      if (c != '\\') { out += c; continue; }
      if (at >= text.size()) return std::nullopt;
      switch (text[at++]) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          auto code = hex4();
          if (!code) return std::nullopt;
          // A pair of surrogates is one character; a lone one is not text.
          if (*code >= 0xD800 && *code <= 0xDBFF) {
            if (!word("\\u")) return std::nullopt;
            const auto low = hex4();
            if (!low || *low < 0xDC00 || *low > 0xDFFF) return std::nullopt;
            code = 0x10000 + ((*code - 0xD800) << 10) + (*low - 0xDC00);
          } else if (*code >= 0xDC00 && *code <= 0xDFFF) return std::nullopt;
          append_utf8(out, *code);
          break;
        }
        default: return std::nullopt;
      }
    }
    return std::nullopt;
  }

  Json value(int depth) {
    if (depth > max_depth) return fail();
    skip();
    if (at >= text.size()) return fail();
    const char c = text[at];
    if (c == '{') {
      at++;
      Json::Object fields;
      skip();
      if (take('}')) return fields;
      while (true) {
        skip();
        auto key = string();
        if (!key) return fail();
        skip();
        if (!take(':')) return fail();
        fields[std::move(*key)] = value(depth + 1);
        if (failed) return Json();
        skip();
        if (take('}')) return fields;
        if (!take(',')) return fail();
      }
    }
    if (c == '[') {
      at++;
      Json::Array items;
      skip();
      if (take(']')) return items;
      while (true) {
        items.push_back(value(depth + 1));
        if (failed) return Json();
        skip();
        if (take(']')) return items;
        if (!take(',')) return fail();
      }
    }
    if (c == '"') { auto parsed = string(); return parsed ? Json(std::move(*parsed)) : fail(); }
    if (word("true")) return true;
    if (word("false")) return false;
    if (word("null")) return nullptr;
    const size_t start = at;
    if (take('-')) {}
    while (at < text.size() && (std::isdigit(static_cast<unsigned char>(text[at])) || text[at] == '.' || text[at] == 'e' || text[at] == 'E' || text[at] == '+' || text[at] == '-')) at++;
    double number = 0;
    const auto [end, error] = std::from_chars(text.data() + start, text.data() + at, number);
    if (error != std::errc() || end != text.data() + at || at == start) return fail();
    return number;
  }
};

void write_string(std::string& out, const std::string& text) {
  out += '"';
  for (const char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) { char buffer[8]; std::snprintf(buffer, sizeof buffer, "\\u%04x", c); out += buffer; }
        else out += c;
    }
  }
  out += '"';
}

void write(std::string& out, const Json& json) {
  if (json.is_null()) { out += "null"; return; }
  if (const auto* value = json.boolean()) { out += *value ? "true" : "false"; return; }
  if (const auto* value = json.number()) {
    if (!std::isfinite(*value)) { out += "null"; return; }
    char buffer[32];
    const auto [end, error] = std::to_chars(buffer, buffer + sizeof buffer, *value);
    out.append(buffer, error == std::errc() ? end : buffer);
    return;
  }
  if (const auto* value = json.string()) { write_string(out, *value); return; }
  if (const auto* items = json.array()) {
    out += '[';
    for (size_t index = 0; index < items->size(); index++) { if (index) out += ','; write(out, (*items)[index]); }
    out += ']';
    return;
  }
  out += '{';
  bool first = true;
  for (const auto& [key, value] : *json.object()) {
    if (!first) out += ',';
    first = false;
    write_string(out, key);
    out += ':';
    write(out, value);
  }
  out += '}';
}

}  // namespace

std::optional<Json> Json::parse(std::string_view text) {
  Parser parser{text};
  Json value = parser.value(0);
  parser.skip();
  if (parser.failed || parser.at != text.size()) return std::nullopt;
  return value;
}

std::string Json::dump() const {
  std::string out;
  write(out, *this);
  return out;
}

}  // namespace moxxy
