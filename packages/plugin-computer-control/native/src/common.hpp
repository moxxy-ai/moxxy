#pragma once
#include <windows.h>
#include <ole2.h>
#include <UIAutomation.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <atomic>
#include <string>
#include <vector>
#include <set>
#include <cmath>
#include <functional>
#include <optional>
#include "geometry.hpp"

namespace moxxy {
namespace Windows = winrt::Windows;
using namespace winrt;
using namespace Windows::Data::Json;
using Json = JsonObject;
inline constexpr int protocol_version = 4;
inline constexpr size_t frame_limit = 3'000'000;
struct Error : std::runtime_error {
  std::string code;
  Error(std::string c, const char* message) : std::runtime_error(message), code(std::move(c)) {}
};
inline void require(bool condition, const char* code, const char* message) {
  if (!condition) throw Error(code, message);
}
inline void fields(const Json& object, std::initializer_list<std::wstring_view> allowed) {
  for (const auto& pair : object) {
    bool found = false;
    for (const auto name : allowed) if (pair.Key() == name) found = true;
    require(found, "invalid-input", "Unknown parameter");
  }
}
inline std::wstring text(const Json& object, std::wstring_view key, size_t maximum = 160) {
  auto value = object.GetNamedString(key);
  require(value.size() <= maximum, "invalid-input", "Text exceeds limit");
  require(std::wstring_view(value).find(L'\0') == std::wstring_view::npos, "invalid-input", "NUL is not allowed");
  return std::wstring(value);
}
inline int number(const Json& object, std::wstring_view key, int minimum, int maximum) {
  double value = object.GetNamedNumber(key);
  require(std::isfinite(value) && value >= minimum && value <= maximum && std::floor(value) == value,
    "invalid-input", "Number outside supported range");
  return static_cast<int>(value);
}
inline auto string_value(std::wstring_view value) {
  // param::hstring aborts on unterminated slices; an owning hstring copies the exact range.
  return JsonValue::CreateStringValue(winrt::hstring(value));
}
inline auto numeric(int value) { return JsonValue::CreateNumberValue(value); }
inline auto boolean(bool value) { return JsonValue::CreateBooleanValue(value); }
inline Json rect_json(Rect r) {
  Json result;
  result.Insert(L"x", numeric(r.x)); result.Insert(L"y", numeric(r.y));
  result.Insert(L"width", numeric(r.width)); result.Insert(L"height", numeric(r.height));
  return result;
}
inline Rect rect_from(RECT r) { return {r.left, r.top, r.right-r.left, r.bottom-r.top}; }
inline std::wstring identifier() {
  GUID value; check_hresult(CoCreateGuid(&value));
  wchar_t buffer[40]; StringFromGUID2(value, buffer, 40); return buffer;
}
struct Handle {
  HANDLE value = nullptr;
  explicit Handle(HANDLE h = nullptr) : value(h) {}
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};
extern std::atomic<uint64_t> focus_epoch;
extern HANDLE stop_event;
extern std::atomic<bool> lease_active;
extern std::atomic<DWORD> stop_exit_code;
extern std::atomic<HWND> control_window;
extern std::atomic<ULONGLONG> operation_deadline;
extern std::atomic<bool> input_may_have_run;
enum class ControlState { idle, background, foreground, waiting_for_focus, paused_by_user, recovering, stopped, failed };
extern std::atomic<ControlState> control_state;
extern std::wstring request_id;
void emit_control_state(ControlState state);
void wait_for_access(HWND window, bool needs_focus);
uint64_t window_generation(HWND window);
void release_input() noexcept;
void check_active_desktop();
void check_focus(HWND window);
bool has_target_focus(HWND window);
HWND blocking_window(HWND window);
void approval_focus_changed(HWND window);
bool approval_focus(HWND window, IUIAutomationElement* root, const Json& params);
void click_point(HWND window, Point point, const std::wstring& button, int count);
void type_text(HWND window, const std::wstring& value, const std::function<void()>& validate_focus);
void key_press(HWND window, const Json& params);
void scroll_at(HWND window, Point point, int dx, int dy);
void drag_to(HWND window, Point from, Point to, int duration);
Json clipboard(const Json& params);
struct Capture { Rect source; int width; int height; std::string base64; std::wstring media_type; bool fallback; };
Capture capture_window(HWND window, int max_dim, bool jpeg, int quality, bool allow_fallback, std::optional<Rect> crop);
Rect window_bounds(HWND window);
}
