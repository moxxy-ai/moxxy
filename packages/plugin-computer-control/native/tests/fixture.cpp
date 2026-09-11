#include "common.hpp"
#include <fstream>
#include <filesystem>
#include <windowsx.h>
#include <shellapi.h>
#include <commctrl.h>

using namespace moxxy;
namespace {
HWND edit = nullptr;
WNDPROC edit_default = nullptr;
std::filesystem::path report_path;
int left = 0, right = 0, middle = 0, double_clicks = 0, wheel_x = 0, wheel_y = 0, drags = 0, saves = 0, menu_picks = 0;
bool dragging = false;
bool recreating = false;
std::wstring canvas_text;
std::string panel_failure;
POINT drag_start{};
HWND create_fixture_window();
int test_control_panel(DWORD pid) {
  try {
    init_apartment(apartment_type::multi_threaded);
    com_ptr<IUIAutomation> automation;
    check_hresult(CoCreateInstance(CLSID_CUIAutomation,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(automation.put())));
    com_ptr<IUIAutomationElement> desktop,panel;
    check_hresult(automation->GetRootElement(desktop.put()));
    VARIANT process{}; process.vt=VT_I4; process.lVal=pid;
    com_ptr<IUIAutomationCondition> condition;
    check_hresult(automation->CreatePropertyCondition(UIA_ProcessIdPropertyId,process,condition.put()));
    auto deadline=GetTickCount64()+3000;
    do {
      check_hresult(desktop->FindFirst(TreeScope_Children,condition.get(),panel.put()));
      if (panel) break;
      Sleep(25);
    } while (GetTickCount64()<deadline);
    require(panel!=nullptr,"panel-test","Independent guardian panel not found");
    auto find=[&](const wchar_t* name) {
      VARIANT value{}; value.vt=VT_BSTR; value.bstrVal=SysAllocString(name);
      com_ptr<IUIAutomationCondition> named;
      auto hr=automation->CreatePropertyCondition(UIA_NamePropertyId,value,named.put()); VariantClear(&value); check_hresult(hr);
      com_ptr<IUIAutomationElement> item; check_hresult(panel->FindFirst(TreeScope_Descendants,named.get(),item.put()));
      return item;
    };
    auto invoke=[&](const wchar_t* name) {
      auto button=find(name); require(button!=nullptr,"panel-test","Accessible control button is missing");
      com_ptr<IUIAutomationInvokePattern> action;
      check_hresult(button->GetCurrentPatternAs(UIA_InvokePatternId,IID_PPV_ARGS(action.put())));
      check_hresult(action->Invoke());
    };
    auto wait_paused=[&](bool expected) {
      auto deadline=GetTickCount64()+3000;
      do {
        if ((find(L"Paused by you")!=nullptr)==expected) return;
        Sleep(25);
      } while (GetTickCount64()<deadline);
      throw Error("panel-test",expected ? "Panel pause did not change visible state" : "Panel resume left control paused");
    };
    invoke(L"Pause"); wait_paused(true);
    invoke(L"Resume"); wait_paused(false);
    Handle guardian(OpenProcess(SYNCHRONIZE,FALSE,pid));
    require(guardian.value!=nullptr,"panel-test","Guardian process missing before Stop");
    try { invoke(L"Stop"); } catch (...) { /* UIA provider can disappear during Stop. */ }
    require(WaitForSingleObject(guardian.value,3000)==WAIT_OBJECT_0,"panel-test","Panel Stop did not terminate control");
    return 0;
  } catch (const Error& error) { panel_failure=error.what(); return 1; }
    catch (const hresult_error& error) { panel_failure=to_string(error.message()); return 1; }
    catch (...) { panel_failure="Unknown panel probe failure"; return 1; }
}
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
  result.Insert(L"canvasText",string_value(canvas_text));
  DWORD selection_start=0,selection_end=0;
  if (edit) SendMessageW(edit,EM_GETSEL,reinterpret_cast<WPARAM>(&selection_start),reinterpret_cast<LPARAM>(&selection_end));
  result.Insert(L"selectionStart",numeric(selection_start)); result.Insert(L"selectionEnd",numeric(selection_end));
  auto root=edit ? GetAncestor(edit,GA_ROOT) : nullptr;
  result.Insert(L"checked",moxxy::boolean(root && SendDlgItemMessageW(root,201,BM_GETCHECK,0,0)==BST_CHECKED));
  result.Insert(L"selectedItem",numeric(root ? SendDlgItemMessageW(root,202,LB_GETCURSEL,0,0) : -1));
  auto tree=root ? GetDlgItem(root,203) : nullptr;
  auto branch=tree ? TreeView_GetRoot(tree) : nullptr;
  result.Insert(L"expanded",moxxy::boolean(branch && (TreeView_GetItemState(tree,branch,TVIS_EXPANDED)&TVIS_EXPANDED)));
  result.Insert(L"left", numeric(left)); result.Insert(L"right", numeric(right)); result.Insert(L"middle", numeric(middle));
  result.Insert(L"doubleClicks", numeric(double_clicks)); result.Insert(L"scrollX", numeric(wheel_x)); result.Insert(L"scrollY", numeric(wheel_y));
  result.Insert(L"drags", numeric(drags)); result.Insert(L"saves", numeric(saves));
  result.Insert(L"leftDown", moxxy::boolean((GetAsyncKeyState(VK_LBUTTON)&0x8000)!=0));
  result.Insert(L"menuPicks", numeric(menu_picks));
  result.Insert(L"foreground", moxxy::boolean(edit && GetForegroundWindow()==GetAncestor(edit,GA_ROOT)));
  std::ofstream output(report_path, std::ios::binary | std::ios::trunc);
  output << to_string(result.Stringify());
}
LRESULT CALLBACK canvas_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_CHAR: if (canvas_text.size()<4000) canvas_text.push_back(static_cast<wchar_t>(wparam)); break;
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
      CreateWindowW(L"BUTTON",L"Context menu",WS_CHILD|WS_VISIBLE,20,488,150,28,hwnd,reinterpret_cast<HMENU>(108),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Value later",WS_CHILD|WS_VISIBLE,185,488,150,28,hwnd,reinterpret_cast<HMENU>(109),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Minimize",WS_CHILD|WS_VISIBLE,350,488,150,28,hwnd,reinterpret_cast<HMENU>(110),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Rename later",WS_CHILD|WS_VISIBLE,560,450,240,30,hwnd,reinterpret_cast<HMENU>(111),nullptr,nullptr);
      CreateWindowW(L"BUTTON",L"Enable test option",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_AUTOCHECKBOX,560,40,240,30,hwnd,reinterpret_cast<HMENU>(201),nullptr,nullptr);
      {
        auto list=CreateWindowW(L"LISTBOX",L"Test choices",WS_CHILD|WS_VISIBLE|WS_TABSTOP|LBS_NOTIFY,560,100,240,90,hwnd,reinterpret_cast<HMENU>(202),nullptr,nullptr);
        SendMessageW(list,LB_ADDSTRING,0,reinterpret_cast<LPARAM>(L"First choice"));
        SendMessageW(list,LB_ADDSTRING,0,reinterpret_cast<LPARAM>(L"Second choice"));
        auto tree=CreateWindowW(WC_TREEVIEWW,L"Test tree",WS_CHILD|WS_VISIBLE|WS_TABSTOP|TVS_HASBUTTONS|TVS_HASLINES,560,230,240,180,hwnd,reinterpret_cast<HMENU>(203),nullptr,nullptr);
        TVINSERTSTRUCTW item{}; item.hParent=TVI_ROOT; item.hInsertAfter=TVI_LAST; item.item.mask=TVIF_TEXT;
        item.item.pszText=const_cast<wchar_t*>(L"Test branch");
        auto branch=TreeView_InsertItem(tree,&item);
        item.hParent=branch; item.item.pszText=const_cast<wchar_t*>(L"Test leaf"); TreeView_InsertItem(tree,&item);
      }
      SetTimer(hwnd,1,1500,nullptr); SetTimer(hwnd,2,100,nullptr); SetFocus(edit); report(); return 0;
    case WM_TIMER:
      if (wparam==2) { report(); return 0; }
      if (wparam==3) { KillTimer(hwnd,3); SetWindowPos(hwnd,nullptr,250,160,0,0,SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE); return 0; }
      if (wparam==4) { KillTimer(hwnd,4); SetFocus(GetDlgItem(hwnd,102)); return 0; }
      if (wparam==6) { KillTimer(hwnd,6); SetWindowTextW(edit,L"Changed by application"); return 0; }
      if (wparam==7) { KillTimer(hwnd,7); SetWindowTextW(GetDlgItem(hwnd,103),L"Different action"); return 0; }
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
      if (LOWORD(wparam)==109) SetTimer(hwnd,6,3000,nullptr);
      if (LOWORD(wparam)==110) ShowWindow(hwnd,SW_MINIMIZE);
      if (LOWORD(wparam)==111) SetTimer(hwnd,7,3000,nullptr);
      if (LOWORD(wparam)==108) {
        HMENU menu=CreatePopupMenu(); AppendMenuW(menu,MF_STRING,180,L"Choose test action");
        POINT point{40,260}; ClientToScreen(hwnd,&point);
        auto command=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_LEFTALIGN,point.x,point.y,0,hwnd,nullptr);
        if (command==180) ++menu_picks; DestroyMenu(menu);
      }
      report(); return 0;
    case WM_DESTROY:
      // Last-resort test cleanup, after assertions: never leave the test's drag
      // held on a developer desktop when a deliberately failing crash test exits.
      if (dragging) {
        INPUT release{}; release.type=INPUT_MOUSE; release.mi.dwFlags=MOUSEEVENTF_LEFTUP;
        SendInput(1,&release,sizeof(release)); dragging=false;
      }
      report(); if (!recreating) PostQuitMessage(0); return 0;
    default: return DefWindowProcW(hwnd,message,wparam,lparam);
  }
}
HWND create_fixture_window() {
  return CreateWindowW(L"MoxxyComputerFixture",L"Moxxy Computer Use Test",WS_OVERLAPPEDWINDOW|WS_VISIBLE,
    100,100,850,560,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
}
}
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argv && argc==3 && std::wstring_view(argv[1])==L"--panel-test") { LocalFree(argv); return 2; }
  if (argv && argc==4 && std::wstring_view(argv[1])==L"--panel-test") {
    wchar_t* end=nullptr; auto pid=wcstoul(argv[2],&end,10);
    if (!pid || !end || *end) { LocalFree(argv); return 2; }
    report_path=argv[3]; LocalFree(argv);
    auto result=test_control_panel(pid);
    std::ofstream output(report_path); output << (result==0 ? "passed" : "failed: "+panel_failure);
    return result;
  }
  if (!argv || argc!=2) { if (argv) LocalFree(argv); return 2; }
  report_path=argv[1]; LocalFree(argv);
  init_apartment(apartment_type::single_threaded);
  INITCOMMONCONTROLSEX controls{sizeof(controls),ICC_TREEVIEW_CLASSES}; InitCommonControlsEx(&controls);
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
