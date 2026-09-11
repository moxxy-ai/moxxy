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
void click_point(HWND window, Point point, const std::wstring& button, int count) {
  no_user_modifiers();
  DWORD press = button == L"right" ? MOUSEEVENTF_RIGHTDOWN : button == L"middle" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
  DWORD lift = button == L"right" ? MOUSEEVENTF_RIGHTUP : button == L"middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
  for (int i = 0; i < count; ++i) {
    Release release; move(window, point); check_focus(window); down(mouse(press), mouse(lift));
  }
}
void type_text(HWND window, const std::wstring& value, const std::function<void()>& validate_focus) {
  no_user_modifiers();
  for (wchar_t code_unit : value) {
    Release release; check_focus(window); validate_focus();
    if (code_unit == L'\n') down(key(VK_RETURN, false), key(VK_RETURN, true));
    else if (code_unit != L'\r') down(key(0, false, code_unit), key(0, true, code_unit));
  }
}
void key_press(HWND window, const Json& params) {
  auto name = text(params, L"key", 16);
  const std::map<std::wstring, WORD> names = {
    {L"enter", VK_RETURN}, {L"tab", VK_TAB}, {L"escape", VK_ESCAPE}, {L"space", VK_SPACE},
    {L"backspace", VK_BACK}, {L"delete", VK_DELETE}, {L"home", VK_HOME}, {L"end", VK_END},
    {L"pageup", VK_PRIOR}, {L"pagedown", VK_NEXT}, {L"left", VK_LEFT}, {L"right", VK_RIGHT}, {L"up", VK_UP}, {L"down", VK_DOWN},
  };
  WORD code = 0;
  if (name.size() == 1 && ((name[0] >= L'a' && name[0] <= L'z') || (name[0] >= L'0' && name[0] <= L'9'))) code = static_cast<WORD>(towupper(name[0]));
  else if (auto it = names.find(name); it != names.end()) code = it->second;
  else for (int i=1; i<=12; ++i) if (name == L"f"+std::to_wstring(i)) code = static_cast<WORD>(VK_F1+i-1);
  require(code != 0, "invalid-key", "Unsupported Windows key");
  const std::map<std::wstring, WORD> modifier_codes{{L"windows",VK_LWIN},{L"control",VK_CONTROL},{L"alt",VK_MENU},{L"shift",VK_SHIFT}};
  std::set<WORD> modifiers;
  auto array = params.GetNamedArray(L"modifiers"); require(array.Size() <= 4, "invalid-input", "Too many modifiers");
  for (const auto& item : array) {
    auto it = modifier_codes.find(std::wstring(item.GetString()));
    require(it != modifier_codes.end(), "invalid-key", "Unsupported Windows modifier (Cmd/Option are macOS-only)");
    modifiers.insert(it->second);
  }
  no_user_modifiers(); Release release; check_focus(window);
  for (auto modifier : modifiers) down(key(modifier, false), key(modifier, true));
  check_focus(window); down(key(code, false), key(code, true));
}
void scroll_at(HWND window, Point point, int dx, int dy) {
  no_user_modifiers(); move(window, point); check_focus(window);
  if (dx) send(mouse(MOUSEEVENTF_HWHEEL, static_cast<DWORD>(dx)));
  if (dy) { check_focus(window); send(mouse(MOUSEEVENTF_WHEEL, static_cast<DWORD>(dy))); }
}
void drag_to(HWND window, Point from, Point to, int duration) {
  no_user_modifiers(); Release release; move(window, from);
  down(mouse(MOUSEEVENTF_LEFTDOWN), mouse(MOUSEEVENTF_LEFTUP));
  for (int step = 1; step <= 20; ++step) {
    require(WaitForSingleObject(stop_event, duration/20) == WAIT_TIMEOUT, "cancelled", "Drag cancelled");
    move(window, {from.x+(to.x-from.x)*step/20, from.y+(to.y-from.y)*step/20});
  }
}
Json clipboard(const Json& params) {
  auto action = text(params, L"action");
  require(action == L"read" || action == L"write", "invalid-input", "Unsupported clipboard action");
  std::wstring value;
  if (action == L"write") value = text(params, L"text", 64000);
  else require(!params.HasKey(L"text"), "invalid-input", "Read must not include text");
  // Win32 requires an owner HWND for EmptyClipboard + SetClipboardData.
  require(OpenClipboard(control_window.load()), "clipboard-busy", "Clipboard unavailable");
  struct Close { ~Close() { CloseClipboard(); } } close;
  if (action == L"read") {
    auto memory = GetClipboardData(CF_UNICODETEXT);
    require(memory != nullptr, "clipboard-format", "Clipboard does not contain text");
    auto capacity = GlobalSize(memory)/sizeof(wchar_t);
    require(capacity > 0 && capacity <= 64001, "output-limit", "Clipboard text too large");
    auto buffer = static_cast<const wchar_t*>(GlobalLock(memory)); require(buffer != nullptr, "native-error", "Cannot read clipboard");
    auto length = wcsnlen_s(buffer, capacity); value.assign(buffer, length); GlobalUnlock(memory);
  } else {
    auto memory = GlobalAlloc(GMEM_MOVEABLE, (value.size()+1)*sizeof(wchar_t));
    require(memory != nullptr, "native-error", "Cannot allocate clipboard data");
    auto buffer = GlobalLock(memory);
    if (!buffer) { GlobalFree(memory); throw Error("native-error", "Cannot lock clipboard data"); }
    memcpy(buffer, value.c_str(), (value.size()+1)*sizeof(wchar_t)); GlobalUnlock(memory);
    if (!EmptyClipboard() || !SetClipboardData(CF_UNICODETEXT, memory)) { GlobalFree(memory); throw Error("native-error", "Cannot write clipboard"); }
  }
  Json result; result.Insert(L"text", string_value(value)); return result;
}
}
