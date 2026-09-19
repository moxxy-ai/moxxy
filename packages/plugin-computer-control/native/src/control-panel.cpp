#include "control-panel.hpp"
#include <windowsx.h>

namespace moxxy {
namespace {
constexpr COLORREF background=RGB(14,21,25), foreground=RGB(226,233,237), orange=RGB(255,83,28);
struct Panel {
  PanelModel& model;
  HWND window=nullptr;
  HFONT font=nullptr, heading=nullptr;
  HBRUSH brush=CreateSolidBrush(background);
  bool shown=false;
  std::wstring app, state;
  ~Panel() { DeleteObject(font); DeleteObject(heading); DeleteObject(brush); }
  int px(int value) const { return MulDiv(value,GetDpiForWindow(window),96); }
  void layout() {
    auto old_font=font, old_heading=heading;
    font=CreateFontW(-px(13),0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
    heading=CreateFontW(-px(15),0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
    for (int id=1;id<=6;++id) {
      auto child=GetDlgItem(window,id);
      SendMessageW(child,WM_SETFONT,reinterpret_cast<WPARAM>(id==4 ? heading : font),TRUE);
    }
    for (int id=1;id<=3;++id) SetWindowPos(GetDlgItem(window,id),nullptr,px(14+(id-1)*98),px(104),px(90),px(32),SWP_NOACTIVATE|SWP_NOZORDER);
    SetWindowPos(GetDlgItem(window,4),nullptr,px(38),px(12),px(270),px(22),SWP_NOACTIVATE|SWP_NOZORDER);
    SetWindowPos(GetDlgItem(window,5),nullptr,px(14),px(42),px(290),px(22),SWP_NOACTIVATE|SWP_NOZORDER);
    SetWindowPos(GetDlgItem(window,6),nullptr,px(14),px(70),px(290),px(22),SWP_NOACTIVATE|SWP_NOZORDER);
    auto region=CreateRoundRectRgn(0,0,px(318)+1,px(150)+1,px(18),px(18));
    if (!SetWindowRgn(window,region,TRUE)) DeleteObject(region);
    DeleteObject(old_font); DeleteObject(old_heading);
  }
  void update() {
    auto snapshot=model.read();
    if (snapshot.visible!=shown) {
      shown=snapshot.visible; ShowWindow(window,shown ? SW_SHOWNOACTIVATE : SW_HIDE);
      if (shown) {
        // Optional keyboard equivalents; native buttons remain accessible when
        // another application has already reserved a shortcut.
        RegisterHotKey(window,1,MOD_CONTROL|MOD_ALT|MOD_NOREPEAT,VK_F11);
        RegisterHotKey(window,2,MOD_CONTROL|MOD_ALT|MOD_NOREPEAT,VK_F10);
        RegisterHotKey(window,3,MOD_CONTROL|MOD_ALT|MOD_NOREPEAT,VK_F12);
      } else for (int id=1;id<=3;++id) UnregisterHotKey(window,id);
    }
    static const wchar_t* labels[]={L"Ready",L"Working in background",L"Controlling application",L"Waiting for target window",L"Paused by you",L"Checking application",L"Stopped",L"Control unavailable"};
    auto label=labels[static_cast<int>(snapshot.state)];
    if (state!=label) { state=label; SetWindowTextW(GetDlgItem(window,6),state.c_str()); }
    if (app!=snapshot.application) { app=snapshot.application; SetWindowTextW(GetDlgItem(window,5),app.c_str()); }
  }
};
LRESULT CALLBACK panel_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  auto panel=reinterpret_cast<Panel*>(GetWindowLongPtrW(hwnd,GWLP_USERDATA));
  if (message==WM_NCCREATE) {
    panel=static_cast<Panel*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
    panel->window=hwnd; SetWindowLongPtrW(hwnd,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(panel));
  }
  if (!panel) return DefWindowProcW(hwnd,message,wparam,lparam);
  switch(message) {
    case WM_CREATE:
      for (int id=1;id<=3;++id) CreateWindowW(L"BUTTON",id==1 ? L"Pause" : id==2 ? L"Resume" : L"Stop",
        WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_OWNERDRAW,0,0,0,0,hwnd,reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),GetModuleHandleW(nullptr),nullptr);
      for (int id=4;id<=6;++id) CreateWindowW(L"STATIC",id==4 ? L"Moxxy · Computer Use" : L"",
        WS_CHILD|WS_VISIBLE|SS_ENDELLIPSIS|SS_NOPREFIX,0,0,0,0,hwnd,reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),GetModuleHandleW(nullptr),nullptr);
      panel->layout(); SetTimer(hwnd,1,100,nullptr); return 0;
    case WM_TIMER: panel->update(); return 0;
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;
    case WM_NCHITTEST: {
      POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)}; ScreenToClient(hwnd,&point);
      return point.y<panel->px(38) ? HTCAPTION : HTCLIENT;
    }
    case WM_COMMAND:
    case WM_HOTKEY: {
      auto id=message==WM_HOTKEY ? static_cast<int>(wparam) : LOWORD(wparam);
      if (id>=1 && id<=3) panel->model.command(id==1 ? ControlCommand::pause : id==2 ? ControlCommand::resume : ControlCommand::stop);
      return 0;
    }
    case WM_CLOSE: panel->model.command(ControlCommand::stop); return 0;
    case WM_DPICHANGED: {
      auto area=reinterpret_cast<RECT*>(lparam);
      SetWindowPos(hwnd,nullptr,area->left,area->top,panel->px(318),panel->px(150),SWP_NOACTIVATE|SWP_NOZORDER);
      panel->layout(); return 0;
    }
    case WM_CTLCOLORSTATIC:
      SetTextColor(reinterpret_cast<HDC>(wparam),foreground); SetBkColor(reinterpret_cast<HDC>(wparam),background);
      return reinterpret_cast<LRESULT>(panel->brush);
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
      PAINTSTRUCT paint; auto dc=BeginPaint(hwnd,&paint); RECT area; GetClientRect(hwnd,&area); FillRect(dc,&area,panel->brush);
      auto accent=CreateSolidBrush(orange); auto previous=SelectObject(dc,accent);
      Ellipse(dc,panel->px(14),panel->px(15),panel->px(29),panel->px(30));
      SelectObject(dc,previous); DeleteObject(accent); EndPaint(hwnd,&paint); return 0;
    }
    case WM_DRAWITEM: {
      auto item=reinterpret_cast<DRAWITEMSTRUCT*>(lparam);
      if (item->CtlID<1 || item->CtlID>3) break;
      auto brush=CreateSolidBrush(item->CtlID==3 ? orange : RGB(34,44,50));
      FillRect(item->hDC,&item->rcItem,brush); DeleteObject(brush);
      wchar_t label[32]{}; GetWindowTextW(item->hwndItem,label,32);
      SetBkMode(item->hDC,TRANSPARENT); SetTextColor(item->hDC,foreground); auto previous=SelectObject(item->hDC,panel->font);
      DrawTextW(item->hDC,label,-1,&item->rcItem,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX);
      if (item->itemState&ODS_FOCUS) DrawFocusRect(item->hDC,&item->rcItem);
      SelectObject(item->hDC,previous); return TRUE;
    }
    case WM_NCDESTROY:
      for (int id=1;id<=3;++id) UnregisterHotKey(hwnd,id);
      delete panel; return 0;
  }
  return DefWindowProcW(hwnd,message,wparam,lparam);
}
}
HWND create_control_panel(PanelModel& model) {
  WNDCLASSW klass{}; klass.lpfnWndProc=panel_proc; klass.hInstance=GetModuleHandleW(nullptr);
  klass.lpszClassName=L"MoxxyComputerControlPanel"; klass.hCursor=LoadCursorW(nullptr,IDC_ARROW);
  RegisterClassW(&klass);
  MONITORINFO monitor{}; monitor.cbSize=sizeof(monitor);
  GetMonitorInfoW(MonitorFromPoint({0,0},MONITOR_DEFAULTTOPRIMARY),&monitor);
  auto panel=new Panel{model};
  // WM_NCDESTROY owns the allocation after WM_NCCREATE, including creation failure.
  auto hwnd=CreateWindowExW(WS_EX_TOPMOST|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW,klass.lpszClassName,L"Moxxy Computer Use",
    WS_POPUP,monitor.rcWork.right-338,monitor.rcWork.top+20,318,150,nullptr,nullptr,klass.hInstance,panel);
  require(hwnd!=nullptr,"panel-unavailable","Cannot create independent control panel");
  SetWindowPos(hwnd,nullptr,monitor.rcWork.right-panel->px(338),monitor.rcWork.top+panel->px(20),panel->px(318),panel->px(150),SWP_NOACTIVATE|SWP_NOZORDER);
  return hwnd;
}
}
