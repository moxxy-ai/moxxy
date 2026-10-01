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
inline constexpr int protocol_version = 5;
inline constexpr size_t frame_limit = 3'000'000;
/// How long one step may run before the watchdog ends the helper.
inline constexpr ULONGLONG step_budget = 20'000;
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
extern std::atomic<ULONGLONG> focus_monitor_tick;
extern std::atomic<bool> focus_monitor_alive;
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
bool approval_focus(HWND window, IUIAutomationElement* root, IUIAutomationElement* focused, const Json& params, std::string& reason);
/// One protocol frame on stdout; responses, state changes and preview frames come from different threads.
void write_frame(const Json& frame);
/// A key or character with the modifiers held around it, already mapped to virtual keys.
struct Chord { std::vector<WORD> modifiers; WORD key = 0; wchar_t character = 0; };
Chord parse_chord(const Json& chord);
std::vector<WORD> parse_held(const Json& step);
void click_point(HWND window, Point point, const std::wstring& button, int count, const std::vector<WORD>& held);
void type_text(HWND window, const std::wstring& value, const std::function<void()>& validate_focus);
void press_chord(HWND window, const Chord& chord, int repeat);
void hold_chord(HWND window, const Chord& chord, int milliseconds);
void scroll_at(HWND window, Point point, int dx, int dy);
void drag_path(HWND window, const std::vector<Point>& path, const std::wstring& button, int duration, const std::vector<WORD>& held);
bool pointer_held();
void pointer_down(HWND window, Point point, const std::wstring& button, const std::vector<WORD>& held);
void pointer_move(HWND window, Point point);
void pointer_up(HWND window, Point point);
/// The clipboard's text, or nothing when it holds no text.
std::optional<std::wstring> clipboard_text();
bool clipboard_has_content();
void set_clipboard_text(const std::wstring& value);
void clear_clipboard();
struct Pixels { std::vector<uint8_t> bgra; int width = 0; int height = 0; };
/// The window's own pixels through Windows Graphics Capture, whatever covers it on screen.
Pixels capture_window_pixels(HWND window);
/// What is visible on screen inside `bounds`.
Pixels capture_screen_pixels(Rect bounds);
Pixels crop_pixels(const Pixels& source, Rect region);
/// Blacks out everything outside `keep`, a region in the picture's own coordinates.
void keep_only(Pixels& pixels, HRGN keep);
/// Base64 of the pixels scaled to `width` x `height`.
std::string encode_pixels(const Pixels& source, int width, int height, bool jpeg, int quality);
/// Largest size with the same aspect inside the vision limits (see `imageBudget` in src/contract/image.ts).
std::pair<int,int> image_budget(int width, int height);
/// The agent cursor: a click-through marker next to the point being acted on, never part of a capture.
void create_cursor_overlay();
void show_cursor(HWND target, Point screen, const wchar_t* phase);
void hide_cursor();
/// The live picture for the human; frames go out as `preview_frame` events.
void start_preview(int fps);
void stop_preview();
void preview_target(HWND window);
Rect window_bounds(HWND window);
}
