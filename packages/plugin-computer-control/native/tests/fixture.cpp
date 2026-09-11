#include "common.hpp"
#include <fstream>
#include <filesystem>
#include <windowsx.h>

using namespace moxxy;
namespace {
HWND edit = nullptr;
std::filesystem::path report_path;
int left = 0, right = 0, middle = 0, double_clicks = 0, wheel_x = 0, wheel_y = 0, drags = 0, saves = 0;
bool dragging = false;
POINT drag_start{};
void report() {
  wchar_t value[4097]{}; if (edit) GetWindowTextW(edit, value, 4097);
  Json result; result.Insert(L"text", string_value(value));
  result.Insert(L"left", numeric(left)); result.Insert(L"right", numeric(right)); result.Insert(L"middle", numeric(middle));
  result.Insert(L"doubleClicks", numeric(double_clicks)); result.Insert(L"scrollX", numeric(wheel_x)); result.Insert(L"scrollY", numeric(wheel_y));
  result.Insert(L"drags", numeric(drags)); result.Insert(L"saves", numeric(saves));
  std::ofstream output(report_path, std::ios::binary | std::ios::trunc);
  output << to_string(result.Stringify());
}
LRESULT CALLBACK canvas_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_PAINT: {
      PAINTSTRUCT paint; HDC dc = BeginPaint(hwnd, &paint);
      RECT area; GetClientRect(hwnd, &area);
      HBRUSH brush = CreateSolidBrush(RGB(255,0,255)); FillRect(dc,&area,brush); DeleteObject(brush);
      SetBkMode(dc,TRANSPARENT); TextOutW(dc,15,15,L"Canvas: drag / click / scroll",28); EndPaint(hwnd,&paint); return 0;
    }
    case WM_LBUTTONDOWN: ++left; dragging = true; drag_start = {GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)}; SetFocus(hwnd); break;
    case WM_LBUTTONUP: if (dragging && (abs(GET_X_LPARAM(lparam)-drag_start.x)>20 || abs(GET_Y_LPARAM(lparam)-drag_start.y)>20)) ++drags; dragging=false; break;
    case WM_RBUTTONDOWN: ++right; break;
    case WM_MBUTTONDOWN: ++middle; break;
    case WM_LBUTTONDBLCLK: ++double_clicks; break;
    case WM_MOUSEWHEEL: wheel_y += GET_WHEEL_DELTA_WPARAM(wparam); break;
    case WM_MOUSEHWHEEL: wheel_x += GET_WHEEL_DELTA_WPARAM(wparam); break;
    default: return DefWindowProcW(hwnd,message,wparam,lparam);
  }
  report(); return 0;
}
LRESULT CALLBACK window_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CREATE:
      CreateWindowW(L"STATIC",L"Public text",WS_CHILD|WS_VISIBLE,20,15,140,22,hwnd,nullptr,nullptr,nullptr);
      edit = CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_MULTILINE|ES_AUTOVSCROLL,20,40,500,100,hwnd,reinterpret_cast<HMENU>(101),nullptr,nullptr);
      CreateWindowW(L"EDIT",L"fixture-secret",WS_CHILD|WS_VISIBLE|ES_PASSWORD,20,160,250,25,hwnd,reinterpret_cast<HMENU>(102),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Save",WS_CHILD|WS_VISIBLE|WS_TABSTOP,20,205,120,35,hwnd,reinterpret_cast<HMENU>(103),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Open modal",WS_CHILD|WS_VISIBLE|WS_TABSTOP,155,205,130,35,hwnd,reinterpret_cast<HMENU>(104),nullptr,nullptr);
      CreateWindowW(L"MoxxyTestCanvas",L"Canvas",WS_CHILD|WS_VISIBLE|WS_TABSTOP,20,270,500,170,hwnd,nullptr,nullptr,nullptr);
      SetTimer(hwnd,1,1500,nullptr); SetFocus(edit); report(); return 0;
    case WM_TIMER:
      KillTimer(hwnd,1); CreateWindowW(L"BUTTON",L"Delayed button",WS_CHILD|WS_VISIBLE,320,205,160,35,hwnd,nullptr,nullptr,nullptr); return 0;
    case WM_COMMAND:
      if (LOWORD(wparam)==103) ++saves;
      if (LOWORD(wparam)==104) MessageBoxW(hwnd,L"Close this modal using OK",L"Moxxy test modal",MB_OK);
      report(); return 0;
    case WM_DESTROY: report(); PostQuitMessage(0); return 0;
    default: return DefWindowProcW(hwnd,message,wparam,lparam);
  }
}
}
int wmain(int argc, wchar_t** argv) {
  if (argc!=2) return 2;
  init_apartment(apartment_type::single_threaded);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  report_path=argv[1];
  WNDCLASSW canvas_class{}; canvas_class.style=CS_DBLCLKS; canvas_class.lpfnWndProc=canvas_proc;
  canvas_class.hInstance=GetModuleHandleW(nullptr); canvas_class.lpszClassName=L"MoxxyTestCanvas";
  RegisterClassW(&canvas_class);
  WNDCLASSW window_class{}; window_class.lpfnWndProc=window_proc; window_class.hInstance=GetModuleHandleW(nullptr);
  window_class.lpszClassName=L"MoxxyComputerFixture"; window_class.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);
  RegisterClassW(&window_class);
  auto hwnd=CreateWindowW(window_class.lpszClassName,L"Moxxy Computer Use Test",WS_OVERLAPPEDWINDOW|WS_VISIBLE,100,100,600,540,nullptr,nullptr,window_class.hInstance,nullptr);
  if (!hwnd) return 3;
  MSG message;
  while (GetMessageW(&message,nullptr,0,0)>0) { TranslateMessage(&message); DispatchMessageW(&message); }
  return 0;
}
