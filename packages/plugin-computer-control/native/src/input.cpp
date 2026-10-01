#include "common.hpp"
#include "input-guard.hpp"
#include <map>

namespace moxxy {
namespace {
INPUT mouse(DWORD flags, DWORD data = 0) { INPUT input{}; input.type = INPUT_MOUSE; input.mi.dwFlags = flags; input.mi.mouseData = data; return input; }
INPUT key(WORD vk, bool up, WORD scan = 0) {
  INPUT input{}; input.type = INPUT_KEYBOARD; input.ki.wVk = vk; input.ki.wScan = scan;
  input.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (scan ? KEYEVENTF_UNICODE : 0);
  return input;
}
void send(INPUT input) {
  guarded_input(input);
}
void down(INPUT input, INPUT release) {
  guarded_input(input,release);
}
struct Release { ~Release() { release_input(); } };
void move(HWND window, Point point) {
  check_focus(window);
  POINT screen{point.x, point.y};
  require(GetAncestor(WindowFromPoint(screen), GA_ROOT) == window, "target-obscured", "Point is covered by another window");
  int x = GetSystemMetrics(SM_XVIRTUALSCREEN), y = GetSystemMetrics(SM_YVIRTUALSCREEN);
  int width = GetSystemMetrics(SM_CXVIRTUALSCREEN), height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  require(width > 1 && height > 1 && point.x >= x && point.y >= y && point.x < x+width && point.y < y+height,
    "invalid-point", "Point is outside the active desktop");
  INPUT input = mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);
  input.mi.dx = static_cast<LONG>(static_cast<int64_t>(point.x-x)*65535/(width-1));
  input.mi.dy = static_cast<LONG>(static_cast<int64_t>(point.y-y)*65535/(height-1)); send(input);
}
DWORD press_flag(const std::wstring& button) {
  return button == L"right" ? MOUSEEVENTF_RIGHTDOWN : button == L"middle" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
}
DWORD lift_flag(const std::wstring& button) {
  return button == L"right" ? MOUSEEVENTF_RIGHTUP : button == L"middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
}
void hold(const std::vector<WORD>& modifiers) {
  for (auto modifier : modifiers) down(key(modifier, false), key(modifier, true));
}
/// Puts the user's pointer back where it was once the agent's input is done.
struct PointerReturn {
  POINT saved{}; bool known;
  PointerReturn() : known(GetCursorPos(&saved) != FALSE) {}
  // A release takes its position from the pointer at the moment Windows handles it, so the pointer
  // stays where the agent acted until the app has had the last event.
  ~PointerReturn() { if (known) { Sleep(40); SetCursorPos(saved.x, saved.y); } }
};
bool held_button = false;
const std::map<std::wstring, WORD> modifier_codes{{L"ctrl",VK_CONTROL},{L"alt",VK_MENU},{L"shift",VK_SHIFT},{L"meta",VK_LWIN}};
const std::map<std::wstring, WORD> key_codes{
  {L"enter",VK_RETURN},{L"tab",VK_TAB},{L"escape",VK_ESCAPE},{L"space",VK_SPACE},{L"backspace",VK_BACK},
  {L"forward_delete",VK_DELETE},{L"insert",VK_INSERT},{L"home",VK_HOME},{L"end",VK_END},{L"page_up",VK_PRIOR},
  {L"page_down",VK_NEXT},{L"left",VK_LEFT},{L"right",VK_RIGHT},{L"up",VK_UP},{L"down",VK_DOWN},
  {L"caps_lock",VK_CAPITAL},{L"help",VK_HELP},{L"menu",VK_APPS},{L"numpad_enter",VK_RETURN},{L"numpad_add",VK_ADD},
  {L"numpad_subtract",VK_SUBTRACT},{L"numpad_multiply",VK_MULTIPLY},{L"numpad_divide",VK_DIVIDE},{L"numpad_decimal",VK_DECIMAL},
};
void add_modifier(std::vector<WORD>& modifiers, WORD code) {
  if (std::find(modifiers.begin(), modifiers.end(), code) == modifiers.end()) modifiers.push_back(code);
}
std::vector<WORD> modifier_list(const JsonArray& names) {
  require(names.Size() <= 4, "invalid_key", "Too many modifiers");
  std::vector<WORD> result;
  for (const auto& item : names) {
    auto found = modifier_codes.find(std::wstring(item.GetString()));
    require(found != modifier_codes.end(), "invalid_key", "Unknown modifier");
    add_modifier(result, found->second);
  }
  return result;
}
void no_user_modifiers() {
  for (const auto vk : {VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN, VK_LBUTTON, VK_RBUTTON, VK_MBUTTON})
    require((GetAsyncKeyState(vk) & 0x8000) == 0, "user-input-active", "Release keyboard modifiers and mouse buttons before automation");
}
}
void release_input() noexcept {
  guarded_release();
}
void check_active_desktop() {
  require(WaitForSingleObject(stop_event, 0) != WAIT_OBJECT_0, "cancelled", "Computer Use stopped");
  HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  require(desktop != nullptr, "desktop-unavailable", "No interactive desktop; unlock Windows first");
  wchar_t name[128]{}; DWORD size = 0;
  BOOL ok = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &size);
  CloseDesktop(desktop);
  require(ok && _wcsicmp(name, L"Default") == 0, "secure-desktop", "Secure desktop and UAC cannot be automated");
}
bool has_target_focus(HWND window) {
  if (!IsWindow(window) || IsIconic(window)) return false;
  auto foreground = GetForegroundWindow();
  if (foreground == window) return true;
  // Native popup menus receive input while their owner remains foreground.
  wchar_t name[256]{}; GetClassNameW(window, name, 256);
  if (std::wstring_view(name) != L"#32768" || !foreground) return false;
  auto thread = GetWindowThreadProcessId(window, nullptr);
  if (!thread || thread != GetWindowThreadProcessId(foreground, nullptr)) return false;
  GUITHREADINFO info{}; info.cbSize = sizeof(info);
  return GetGUIThreadInfo(thread, &info) && (info.flags & GUI_INMENUMODE) &&
    info.hwndMenuOwner && GetAncestor(info.hwndMenuOwner, GA_ROOT) == foreground;
}
void check_focus(HWND window) {
  wait_for_access(window,true);
}
Chord parse_chord(const Json& chord) {
  Chord result;
  result.modifiers = modifier_list(chord.GetNamedArray(L"modifiers"));
  auto value = chord.GetNamedValue(L"key");
  if (value.ValueType() == JsonValueType::Null) return result;
  auto name = std::wstring(value.GetString());
  require(!name.empty() && name.size() <= 32, "invalid_key", "Unknown key");
  if (auto found = key_codes.find(name); found != key_codes.end()) { result.key = found->second; return result; }
  if (name.size() > 1 && name[0] == L'f') {
    for (int i = 1; i <= 24; ++i) if (name == L"f" + std::to_wstring(i)) { result.key = static_cast<WORD>(VK_F1 + i - 1); return result; }
  }
  if (name.rfind(L"numpad_", 0) == 0 && name.size() == 8 && name[7] >= L'0' && name[7] <= L'9') {
    result.key = static_cast<WORD>(VK_NUMPAD0 + (name[7] - L'0')); return result;
  }
  require(name.size() == 1, "invalid_key", "There is no such key on a Windows keyboard");
  auto mapped = VkKeyScanW(name[0]);
  if (mapped == -1) {
    // A character the layout cannot produce is sent as text; it cannot take part in a shortcut.
    require(result.modifiers.empty(), "invalid_key", "This character is not a key on the current keyboard layout");
    result.character = name[0]; return result;
  }
  result.key = static_cast<WORD>(LOBYTE(mapped));
  auto shift_state = HIBYTE(mapped);
  if (shift_state & 1) add_modifier(result.modifiers, VK_SHIFT);
  if (shift_state & 2) add_modifier(result.modifiers, VK_CONTROL);
  if (shift_state & 4) add_modifier(result.modifiers, VK_MENU);
  return result;
}
std::vector<WORD> parse_held(const Json& step) {
  return step.HasKey(L"held") ? modifier_list(step.GetNamedArray(L"held")) : std::vector<WORD>{};
}
void click_point(HWND window, Point point, const std::wstring& button, int count, const std::vector<WORD>& held) {
  no_user_modifiers();
  PointerReturn back;
  for (int i = 0; i < count; ++i) {
    Release release; hold(held); move(window, point); check_focus(window); down(mouse(press_flag(button)), mouse(lift_flag(button)));
  }
}
void type_text(HWND window, const std::wstring& value, const std::function<void()>& validate_focus) {
  no_user_modifiers();
  size_t typed = 0;
  for (wchar_t code_unit : value) {
    Release release; check_focus(window);
    // Reading the focused control is a cross-process call; once per word is enough to notice a change.
    if (typed++ % 16 == 0) validate_focus();
    if (code_unit == L'\n') down(key(VK_RETURN, false), key(VK_RETURN, true));
    else if (code_unit != L'\r') down(key(0, false, code_unit), key(0, true, code_unit));
  }
}
void press_chord(HWND window, const Chord& chord, int repeat) {
  no_user_modifiers();
  for (int i = 0; i < repeat; ++i) {
    Release release; check_focus(window); hold(chord.modifiers); check_focus(window);
    if (chord.character) down(key(0, false, chord.character), key(0, true, chord.character));
    else if (chord.key) down(key(chord.key, false), key(chord.key, true));
  }
}
void hold_chord(HWND window, const Chord& chord, int milliseconds) {
  no_user_modifiers(); Release release; check_focus(window); hold(chord.modifiers);
  if (chord.key) down(key(chord.key, false), key(chord.key, true));
  require(WaitForSingleObject(stop_event, milliseconds) == WAIT_TIMEOUT, "cancelled", "Key hold cancelled");
}
void scroll_at(HWND window, Point point, int dx, int dy) {
  no_user_modifiers(); PointerReturn back; move(window, point); check_focus(window);
  if (dx) send(mouse(MOUSEEVENTF_HWHEEL, static_cast<DWORD>(dx)));
  if (dy) { check_focus(window); send(mouse(MOUSEEVENTF_WHEEL, static_cast<DWORD>(dy))); }
}
void drag_path(HWND window, const std::vector<Point>& path, const std::wstring& button, int duration, const std::vector<WORD>& held) {
  require(path.size() >= 2, "invalid-input", "A drag needs at least two points");
  no_user_modifiers(); PointerReturn back; Release release; hold(held); move(window, path.front());
  down(mouse(press_flag(button)), mouse(lift_flag(button)));
  const int segments = static_cast<int>(path.size()) - 1;
  const int steps = std::max(4, 20 / segments);
  // Applications need to see the pointer travel; an instant jump is often not a drag.
  const int pause = std::max(5, duration / (segments * steps));
  for (int segment = 0; segment < segments; ++segment) {
    const auto from = path[segment], to = path[segment + 1];
    for (int step = 1; step <= steps; ++step) {
      require(WaitForSingleObject(stop_event, pause) == WAIT_TIMEOUT, "cancelled", "Drag cancelled");
      move(window, {from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps});
    }
  }
}
bool pointer_held() { return held_button; }
void pointer_down(HWND window, Point point, const std::wstring& button, const std::vector<WORD>& held) {
  no_user_modifiers();
  try {
    hold(held); move(window, point); check_focus(window); down(mouse(press_flag(button)), mouse(lift_flag(button)));
  } catch (...) { release_input(); throw; }
  held_button = true;
}
void pointer_move(HWND window, Point point) {
  try { move(window, point); } catch (...) { held_button = false; release_input(); throw; }
}
void pointer_up(HWND window, Point point) {
  struct Lift { ~Lift() { held_button = false; release_input(); } } lift;
  move(window, point);
}
std::optional<std::wstring> clipboard_text() {
  require(OpenClipboard(control_window.load()), "clipboard-busy", "Clipboard unavailable");
  struct Close { ~Close() { CloseClipboard(); } } close;
  auto memory = GetClipboardData(CF_UNICODETEXT);
  if (!memory) return std::nullopt;
  auto capacity = GlobalSize(memory) / sizeof(wchar_t);
  auto buffer = static_cast<const wchar_t*>(GlobalLock(memory));
  require(buffer != nullptr, "native-error", "Cannot read clipboard");
  std::wstring value(buffer, wcsnlen_s(buffer, capacity)); GlobalUnlock(memory);
  return value;
}
bool clipboard_has_content() { return CountClipboardFormats() > 0; }
void set_clipboard_text(const std::wstring& value) {
  // Win32 requires an owner HWND for EmptyClipboard + SetClipboardData.
  require(OpenClipboard(control_window.load()), "clipboard-busy", "Clipboard unavailable");
  struct Close { ~Close() { CloseClipboard(); } } close;
  auto memory = GlobalAlloc(GMEM_MOVEABLE, (value.size() + 1) * sizeof(wchar_t));
  require(memory != nullptr, "native-error", "Cannot allocate clipboard data");
  auto buffer = GlobalLock(memory);
  if (!buffer) { GlobalFree(memory); throw Error("native-error", "Cannot lock clipboard data"); }
  memcpy(buffer, value.c_str(), (value.size() + 1) * sizeof(wchar_t)); GlobalUnlock(memory);
  if (!EmptyClipboard() || !SetClipboardData(CF_UNICODETEXT, memory)) { GlobalFree(memory); throw Error("native-error", "Cannot write clipboard"); }
}
void clear_clipboard() {
  if (!OpenClipboard(control_window.load())) return;
  EmptyClipboard(); CloseClipboard();
}
}
