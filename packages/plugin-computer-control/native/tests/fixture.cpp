#include "common.hpp"
#include <fstream>
#include <filesystem>
#include <windowsx.h>
#include <shellapi.h>

using namespace moxxy;
namespace {
HWND edit = nullptr;
WNDPROC edit_default = nullptr;
std::filesystem::path report_path;
int left = 0, right = 0, middle = 0, double_clicks = 0, wheel_x = 0, wheel_y = 0, drags = 0, saves = 0;
bool dragging = false;
bool recreating = false;
POINT drag_start{};
HWND create_fixture_window();
LRESULT CALLBACK edit_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  // A bare Win32 EDIT does not implement the application-level Ctrl+A shortcut.
  if (message == WM_KEYDOWN && wparam == 'A' && (GetKeyState(VK_CONTROL)&0x8000)) {
    SendMessageW(hwnd, EM_SETSEL, 0, -1); return 0;
  }
  return CallWindowProcW(edit_default, hwnd, message, wparam, lparam);
}
void report() {
  wchar_t value[4097]{}; if (edit) GetWindowTextW(edit, value, 4097);
  Json result; result.Insert(L"text", string_value(value));
  result.Insert(L"left", numeric(left)); result.Insert(L"right", numeric(right)); result.Insert(L"middle", numeric(middle));
  result.Insert(L"doubleClicks", numeric(double_clicks)); result.Insert(L"scrollX", numeric(wheel_x)); result.Insert(L"scrollY", numeric(wheel_y));
  result.Insert(L"drags", numeric(drags)); result.Insert(L"saves", numeric(saves));
  result.Insert(L"leftDown", moxxy::boolean((GetAsyncKeyState(VK_LBUTTON)&0x8000)!=0));
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
      edit_default = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(edit, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(edit_proc)));
      CreateWindowW(L"EDIT",L"fixture-secret",WS_CHILD|WS_VISIBLE|ES_PASSWORD,20,160,250,25,hwnd,reinterpret_cast<HMENU>(102),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Save",WS_CHILD|WS_VISIBLE|WS_TABSTOP,20,205,120,35,hwnd,reinterpret_cast<HMENU>(103),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Open modal",WS_CHILD|WS_VISIBLE|WS_TABSTOP,155,205,130,35,hwnd,reinterpret_cast<HMENU>(104),nullptr,nullptr);
      CreateWindowW(L"MoxxyTestCanvas",L"Canvas",WS_CHILD|WS_VISIBLE|WS_TABSTOP,20,270,500,170,hwnd,nullptr,nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Move later",WS_CHILD|WS_VISIBLE,20,450,150,30,hwnd,reinterpret_cast<HMENU>(105),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Focus later",WS_CHILD|WS_VISIBLE,185,450,150,30,hwnd,reinterpret_cast<HMENU>(106),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Recreate later",WS_CHILD|WS_VISIBLE,350,450,150,30,hwnd,reinterpret_cast<HMENU>(107),nullptr,nullptr);
      SetTimer(hwnd,1,1500,nullptr); SetTimer(hwnd,2,100,nullptr); SetFocus(edit); report(); return 0;
    case WM_TIMER:
      if (wparam==2) { report(); return 0; }
      if (wparam==3) { KillTimer(hwnd,3); SetWindowPos(hwnd,nullptr,250,160,0,0,SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE); return 0; }
      if (wparam==4) { KillTimer(hwnd,4); SetFocus(GetDlgItem(hwnd,102)); return 0; }
      if (wparam==5) {
        KillTimer(hwnd,5); recreating=true; DestroyWindow(hwnd); create_fixture_window(); recreating=false; return 0;
      }
      KillTimer(hwnd,1); CreateWindowW(L"BUTTON",L"Delayed button",WS_CHILD|WS_VISIBLE,320,205,160,35,hwnd,nullptr,nullptr,nullptr); return 0;
    case WM_COMMAND:
      if (LOWORD(wparam)==103) ++saves;
      if (LOWORD(wparam)==104) MessageBoxW(hwnd,L"Close this modal using OK",L"Moxxy test modal",MB_OK);
      if (LOWORD(wparam)==105) SetTimer(hwnd,3,3000,nullptr);
      if (LOWORD(wparam)==106) SetTimer(hwnd,4,3000,nullptr);
      if (LOWORD(wparam)==107) SetTimer(hwnd,5,3000,nullptr);
      report(); return 0;
    case WM_DESTROY: report(); if (!recreating) PostQuitMessage(0); return 0;
    default: return DefWindowProcW(hwnd,message,wparam,lparam);
  }
}
HWND create_fixture_window() {
  return CreateWindowW(L"MoxxyComputerFixture",L"Moxxy Computer Use Test",WS_OVERLAPPEDWINDOW|WS_VISIBLE,
    100,100,600,560,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
}
}
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv || argc!=2) { if (argv) LocalFree(argv); return 2; }
  report_path=argv[1]; LocalFree(argv);
  init_apartment(apartment_type::single_threaded);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  WNDCLASSW canvas_class{}; canvas_class.style=CS_DBLCLKS; canvas_class.lpfnWndProc=canvas_proc;
  canvas_class.hInstance=GetModuleHandleW(nullptr); canvas_class.lpszClassName=L"MoxxyTestCanvas";
  RegisterClassW(&canvas_class);
  WNDCLASSW window_class{}; window_class.lpfnWndProc=window_proc; window_class.hInstance=GetModuleHandleW(nullptr);
  window_class.lpszClassName=L"MoxxyComputerFixture"; window_class.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);
  RegisterClassW(&window_class);
  auto hwnd=create_fixture_window();
  if (!hwnd) return 3;
  MSG message;
  while (GetMessageW(&message,nullptr,0,0)>0) { TranslateMessage(&message); DispatchMessageW(&message); }
  return 0;
}
