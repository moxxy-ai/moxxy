#pragma once
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace moxxy {

/// Any JSON value. Objects keep their keys sorted, so output is stable.
class Json {
 public:
  using Array = std::vector<Json>;
  using Object = std::map<std::string, Json>;

  Json() : value_(nullptr) {}
  Json(std::nullptr_t) : value_(nullptr) {}
  Json(bool value) : value_(value) {}
  Json(double value) : value_(value) {}
  Json(int value) : value_(static_cast<double>(value)) {}
  Json(long value) : value_(static_cast<double>(value)) {}
  Json(unsigned long value) : value_(static_cast<double>(value)) {}
  Json(const char* value) : value_(std::string(value)) {}
  Json(std::string value) : value_(std::move(value)) {}
  Json(Array value) : value_(std::move(value)) {}
  Json(Object value) : value_(std::move(value)) {}

  bool is_null() const { return std::holds_alternative<std::nullptr_t>(value_); }
  const bool* boolean() const { return std::get_if<bool>(&value_); }
  const double* number() const { return std::get_if<double>(&value_); }
  const std::string* string() const { return std::get_if<std::string>(&value_); }
  const Array* array() const { return std::get_if<Array>(&value_); }
  const Object* object() const { return std::get_if<Object>(&value_); }

  /// A field of an object; `nullptr` when this is no object or has no such field.
  const Json* find(const std::string& key) const;
  /// A whole number that a double holds exactly.
  std::optional<long> integer() const;

  /// One value from the whole text; `nullopt` for anything that is not valid JSON.
  static std::optional<Json> parse(std::string_view text);
  std::string dump() const;

  bool operator==(const Json& other) const { return value_ == other.value_; }

 private:
  std::variant<std::nullptr_t, bool, double, std::string, Array, Object> value_;
};

}  // namespace moxxy
