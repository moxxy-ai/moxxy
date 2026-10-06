#include "common.hpp"
#include <mutex>

namespace moxxy {
namespace {
constexpr int size = 26;
constexpr COLORREF transparent = RGB(255, 0, 255), fill = RGB(255, 83, 28), outline = RGB(255, 255, 255);
// 0x11 is WDA_EXCLUDEFROMCAPTURE; older SDK headers do not name it.
constexpr DWORD exclude_from_capture = 0x11;
std::atomic<HWND> overlay{nullptr};

LRESULT CALLBACK cursor_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message != WM_PAINT) return DefWindowProcW(hwnd, message, wparam, lparam);
  PAINTSTRUCT paint; HDC dc = BeginPaint(hwnd, &paint);
  RECT area; GetClientRect(hwnd, &area);
  HBRUSH clear = CreateSolidBrush(transparent); FillRect(dc, &area, clear); DeleteObject(clear);
  // An arrow whose tip is the window's top-left corner.
  POINT arrow[] = {{0, 0}, {0, 20}, {6, 15}, {11, 24}, {15, 22}, {10, 13}, {17, 13}};
  HBRUSH brush = CreateSolidBrush(fill); HPEN pen = CreatePen(PS_SOLID, 2, outline);
  auto old_brush = SelectObject(dc, brush); auto old_pen = SelectObject(dc, pen);
  Polygon(dc, arrow, static_cast<int>(std::size(arrow)));
  SelectObject(dc, old_brush); SelectObject(dc, old_pen); DeleteObject(brush); DeleteObject(pen);
  EndPaint(hwnd, &paint); return 0;
}
void emit_cursor(Windows::Data::Json::IJsonValue cursor) {
  Json event; event.Insert(L"version", numeric(protocol_version));
  event.Insert(L"event", string_value(L"cursor")); event.Insert(L"cursor", cursor);
  write_frame(event);
}
}
void create_cursor_overlay() {
  WNDCLASSW klass{}; klass.lpfnWndProc = cursor_proc; klass.hInstance = GetModuleHandleW(nullptr);
  klass.lpszClassName = L"MoxxyComputerCursor"; RegisterClassW(&klass);
  // Layered and transparent: the marker never takes a click or the focus.
  auto window = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
    klass.lpszClassName, L"", WS_POPUP, 0, 0, size, size, nullptr, nullptr, klass.hInstance, nullptr);
  if (!window) return;
  SetLayeredWindowAttributes(window, transparent, 0, LWA_COLORKEY);
  SetWindowDisplayAffinity(window, exclude_from_capture);
  overlay = window;
}
void show_cursor(HWND target, Point screen, const wchar_t* phase) {
  RECT rect{};
  if (target && GetWindowRect(target, &rect) && rect.right > rect.left && rect.bottom > rect.top) {
    Json cursor; cursor.Insert(L"phase", string_value(phase));
    const auto fraction = [](int value, int low, int high) { return std::clamp(static_cast<double>(value - low) / (high - low), 0.0, 1.0); };
    cursor.Insert(L"x", JsonValue::CreateNumberValue(fraction(screen.x, rect.left, rect.right)));
    cursor.Insert(L"y", JsonValue::CreateNumberValue(fraction(screen.y, rect.top, rect.bottom)));
    emit_cursor(cursor);
  }
  // One pixel off the point: a hit test at the point itself never finds the marker.
  if (auto window = overlay.load())
    SetWindowPos(window, HWND_TOPMOST, screen.x + 1, screen.y + 1, size, size, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS);
}
void hide_cursor() {
  if (auto window = overlay.load()) ShowWindowAsync(window, SW_HIDE);
  emit_cursor(JsonValue::CreateNullValue());
}
}
