#include "desktop.hpp"
#include "input-guard.hpp"
#include "text-actions.hpp"
#include <dwmapi.h>
#include <functional>

namespace moxxy {
namespace {
constexpr int element_limit = 500, visit_limit = 2500;
uint64_t creation_time(DWORD pid) {
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
  FILETIME created{}, exited{}, kernel{}, user{};
  require(process.value && GetProcessTimes(process.value, &created, &exited, &kernel, &user),
    "target-unavailable", "Cannot identify target process");
  return (static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}
bool protected_element(IUIAutomationElement* node) {
  BOOL value = TRUE;
  check_hresult(node->get_CurrentIsPassword(&value));
  return value;
}
Rect element_bounds(IUIAutomationElement* node) {
  RECT value; check_hresult(node->get_CurrentBoundingRectangle(&value)); return rect_from(value);
}
struct OwnedString { BSTR value=nullptr; ~OwnedString() { SysFreeString(value); } };
/// Cuts at `limit` without splitting a surrogate pair.
std::wstring clipped(const wchar_t* value, size_t length, size_t limit) {
  length=std::min(length,limit);
  if (length && value[length-1]>=0xD800 && value[length-1]<=0xDBFF) --length;
  return length ? std::wstring(value,length) : std::wstring();
}
std::optional<std::wstring> element_value(IUIAutomationElement* node) {
  com_ptr<IUIAutomationValuePattern> pattern;
  if (FAILED(node->GetCurrentPatternAs(UIA_ValuePatternId,IID_PPV_ARGS(pattern.put()))) || !pattern) return std::nullopt;
  OwnedString text;
  if (FAILED(pattern->get_CurrentValue(&text.value))) return std::nullopt;
  return clipped(text.value,SysStringLen(text.value),2000);
}
/// UI Automation's own identity for an element, stable while the element lives.
std::wstring runtime_key(IUIAutomationElement* node) {
  SAFEARRAY* raw=nullptr;
  if (FAILED(node->GetRuntimeId(&raw)) || !raw) return {};
  std::wstring key=L"r";
  LONG low=0, high=-1;
  SafeArrayGetLBound(raw,1,&low); SafeArrayGetUBound(raw,1,&high);
  for (LONG i=low;i<=high && key.size()<400;++i) {
    int part=0;
    if (SUCCEEDED(SafeArrayGetElement(raw,&i,&part))) key+=L"."+std::to_wstring(part);
  }
  SafeArrayDestroy(raw);
  return key.size()>1 ? key : std::wstring();
}
const wchar_t* role_name(CONTROLTYPEID type) {
  static constexpr const wchar_t* names[]={L"Button",L"Calendar",L"CheckBox",L"ComboBox",L"Edit",L"Hyperlink",L"Image",L"ListItem",L"List",
    L"Menu",L"MenuBar",L"MenuItem",L"ProgressBar",L"RadioButton",L"ScrollBar",L"Slider",L"Spinner",L"StatusBar",L"Tab",L"TabItem",L"Text",
    L"ToolBar",L"ToolTip",L"Tree",L"TreeItem",L"Custom",L"Group",L"Thumb",L"DataGrid",L"DataItem",L"Document",L"SplitButton",L"Window",
    L"Pane",L"Header",L"HeaderItem",L"Table",L"TitleBar",L"Separator",L"SemanticZoom",L"AppBar"};
  const auto index=type-UIA_ButtonControlTypeId;
  return index>=0 && index<static_cast<int>(std::size(names)) ? names[index] : L"Control";
}
Json outcome(const wchar_t* kind, const wchar_t* method=nullptr) {
  Json result; result.Insert(L"outcome",string_value(kind));
  if (method) result.Insert(L"method",string_value(method));
  return result;
}
Json refused(const Refusal& refusal) {
  auto result=outcome(refusal.outcome);
  result.Insert(L"code",string_value(refusal.code));
  if (!refusal.hint.empty()) result.Insert(L"hint",string_value(refusal.hint.substr(0,900)));
  return result;
}
/// A low-level refusal becomes the action's result; anything else is a failed request.
Refusal refusal_for(const Error& error) {
  const auto& code=error.code;
  const auto detail=std::wstring(to_hstring(error.what()));
  if (code=="needs-observation") return {L"blocked",L"user_intervened",L"The user paused, resumed or switched windows; nothing more was sent. Look at the fresh state before the next action."};
  if (code=="user-input-active") return {L"blocked",L"user_intervened",L"The user is holding a key or a mouse button; nothing was sent."};
  if (code=="target-obscured") return {L"blocked",L"hit_test_mismatch",L""};
  if (code=="invalid-point" || code=="point_outside_frame") return {L"blocked",L"point_outside_frame",L""};
  if (code=="stale-window" || code=="stale-element" || code=="focus-changed" || code=="text-not-found") return {L"blocked",L"stale_state",detail};
  if (code=="action-pending") return {L"blocked",L"target_blocked",L"An earlier action is still waiting for a dialog to close; handle that dialog first."};
  if (code=="unsupported" || code=="read-only" || code=="value-rejected" || code=="protected-element" || code=="foreground-required" || code=="clipboard-busy")
    return {L"unsupported",L"unsupported_action",detail};
  if (code=="uncertain-result") return {L"ineffective",L"timeout",detail};
  throw error;
}
double decimal(const Json& object, std::wstring_view key, double minimum, double maximum) {
  double value=object.GetNamedNumber(key);
  require(std::isfinite(value) && value>=minimum && value<=maximum,"invalid-input","Number outside supported range");
  return value;
}
std::wstring button_of(const Json& step) {
  auto button=step.HasKey(L"mouse_button") ? text(step,L"mouse_button") : std::wstring(L"left");
  require(button==L"left" || button==L"right" || button==L"middle","invalid-input","Unknown mouse button");
  return button;
}
Point center(const Element& element) { return {element.bounds.x+element.bounds.width/2,element.bounds.y+element.bounds.height/2}; }
std::set<std::wstring> allowed_apps(const Json& params) {
  std::set<std::wstring> result;
  if (!params.HasKey(L"allowed")) return result;
  auto list=params.GetNamedArray(L"allowed");
  require(list.Size()<=64,"invalid-input","Too many granted apps");
  for (const auto& item:list) result.insert(std::wstring(item.GetString()));
  return result;
}
Json image_json(const std::string& base64, int width, int height) {
  Json image; image.Insert(L"mediaType",string_value(L"image/jpeg"));
  image.Insert(L"base64",string_value(to_hstring(base64)));
  image.Insert(L"width",numeric(width)); image.Insert(L"height",numeric(height));
  return image;
}
/// JPEG that fits one protocol frame: a busy picture is encoded again at a lower quality.
std::string jpeg(const Pixels& pixels, int width, int height) {
  try { return encode_pixels(pixels,width,height,true,80); }
  catch (const Error& error) { if (error.code!="capture-limit") throw; }
  return encode_pixels(pixels,width,height,true,50);
}
}
Rect window_bounds(HWND hwnd) {
  RECT rect;
  if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect))))
    require(GetWindowRect(hwnd, &rect), "target-unavailable", "Cannot read window bounds");
  auto result = rect_from(rect);
  require(result.width > 0 && result.height > 0, "target-unavailable", "Window has no visible bounds");
  return result;
}
Desktop::Desktop() : lease(CreateMutexW(nullptr, FALSE, L"Local\\Moxxy.ComputerControl.Desktop")) {
  require(lease.value != nullptr, "control-unavailable", "Cannot create desktop lease");
  check_hresult(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(automation.put())));
}
Desktop::~Desktop() { release_input(); if (owns_lease) ReleaseMutex(lease.value); }
void Desktop::acquire() {
  check_active_desktop();
  if (owns_lease) return;
  auto result = WaitForSingleObject(lease.value, 0);
  require(result == WAIT_OBJECT_0 || result == WAIT_ABANDONED, "control-busy", "Another Moxxy turn owns desktop control");
  owns_lease = true;
  lease_active = true;
  publish_guard_state(ControlState::recovering);
}
std::vector<WindowRow> Desktop::inventory() {
  std::vector<HWND> handles;
  EnumWindows([](HWND hwnd, LPARAM ptr) -> BOOL {
    wchar_t name[256]{}; GetClassNameW(hwnd, name, 256);
    if (std::wstring_view(name)!=L"MoxxyComputerControlPanel" && IsWindowVisible(hwnd) && (GetWindowTextLengthW(hwnd) > 0 || GetWindow(hwnd,GW_OWNER) || std::wstring_view(name) == L"#32768"))
      reinterpret_cast<std::vector<HWND>*>(ptr)->push_back(hwnd);
    return reinterpret_cast<std::vector<HWND>*>(ptr)->size() < 256;
  }, reinterpret_cast<LPARAM>(&handles));
  std::set<std::wstring> live_ids;
  std::map<DWORD,std::wstring> apps;
  std::vector<WindowRow> rows;
  for (auto hwnd : handles) {
    try {
      DWORD pid; GetWindowThreadProcessId(hwnd, &pid);
      if (pid == GetCurrentProcessId()) continue;
      BOOL cloaked=FALSE;
      if (SUCCEEDED(DwmGetWindowAttribute(hwnd,DWMWA_CLOAKED,&cloaked,sizeof(cloaked))) && cloaked) continue;
      if (!apps.contains(pid)) apps.emplace(pid,process_app_id(pid));
      const auto& app=apps.at(pid);
      // Elevated and system processes cannot be identified, so they are not targets.
      if (app.empty()) continue;
      com_ptr<IUIAutomationElement> root;
      check_hresult(automation->ElementFromHandle(hwnd, root.put()));
      auto created = creation_time(pid);
      wchar_t title[1025]{}; GetWindowTextW(hwnd, title, 1025);
      wchar_t name[256]{}; GetClassNameW(hwnd, name, 256);
      auto generation = window_generation(hwnd);
      std::wstring id;
      for (const auto& [known_id, known] : windows) {
        if (known.hwnd != hwnd || known.pid != pid || known.created != created || known.generation != generation) continue;
        BOOL same = FALSE;
        if (SUCCEEDED(automation->CompareElements(known.root.get(), root.get(), &same)) && same) { id=known_id; break; }
      }
      if (id.empty()) {
        id=identifier(); windows.emplace(id, Window{hwnd,pid,created,generation,std::move(root)});
      }
      live_ids.insert(id);
      rows.push_back(WindowRow{id,hwnd,pid,title,name,app,IsIconic(hwnd)!=FALSE});
    } catch (...) { /* Inaccessible, elevated or closing windows are not actionable targets. */ }
  }
  std::erase_if(windows, [&](const auto& item) { return !live_ids.contains(item.first); });
  return rows;
}
Window& Desktop::live_window(AppTarget& target) {
  const Refusal gone{L"blocked",L"stale_state",L"The window is closed or was replaced; observe the app again."};
  auto found=windows.find(target.window_id);
  if (found==windows.end()) throw gone;
  auto& window=found->second;
  DWORD pid=0; GetWindowThreadProcessId(window.hwnd,&pid);
  if (!IsWindow(window.hwnd) || !IsWindowVisible(window.hwnd) || pid!=window.pid || window_generation(window.hwnd)!=window.generation) throw gone;
  return window;
}
bool Desktop::belongs_to_window(IUIAutomationElement* node, const Window& window) {
  com_ptr<IUIAutomationTreeWalker> walker;
  check_hresult(automation->get_RawViewWalker(walker.put()));
  com_ptr<IUIAutomationElement> current; current.copy_from(node);
  for (unsigned depth=0;current && depth<64;++depth) {
    UIA_HWND native=nullptr;
    check_hresult(current->get_CurrentNativeWindowHandle(&native));
    if (native) {
      auto hwnd=reinterpret_cast<HWND>(native);
      DWORD pid=0; GetWindowThreadProcessId(hwnd,&pid);
      // GA_ROOT deliberately excludes the owner: an owned dialog is a separate target.
      return IsWindow(hwnd) && pid==window.pid && GetAncestor(hwnd,GA_ROOT)==window.hwnd;
    }
    BOOL same=FALSE; check_hresult(automation->CompareElements(current.get(),window.root.get(),&same));
    if (same) return true;
    com_ptr<IUIAutomationElement> parent;
    check_hresult(walker->GetParentElement(current.get(),parent.put())); current=std::move(parent);
  }
  return false;
}
Element& Desktop::live(AppTarget& target, Window& window, int index) {
  auto found=target.elements.find(index);
  if (found==target.elements.end()) throw Refusal{L"blocked",L"stale_state",L"No element has that index in the latest state of this app."};
  auto& element=found->second;
  BOOL enabled=FALSE;
  try {
    if (!belongs_to_window(element.node.get(),window) || !(element.bounds==element_bounds(element.node.get())))
      throw Refusal{L"blocked",L"stale_state",L"The element moved or changed since the latest state."};
    check_hresult(element.node->get_CurrentIsEnabled(&enabled));
  } catch (const hresult_error&) {
    throw Refusal{L"blocked",L"stale_state",L"The element is gone."};
  }
  if (!enabled) throw Refusal{L"unsupported",L"unsupported_action",L"The element is disabled."};
  return element;
}
Point Desktop::screen_point(const AppTarget& target, double x, double y) {
  if (!target.pictured) throw Refusal{L"blocked",L"no_state",L"Observe the app with a screenshot before using coordinates."};
  if (x<0 || y<0 || x>=target.image_width || y>=target.image_height) throw Refusal{L"blocked",L"point_outside_frame",L""};
  return image_point(static_cast<int>(x),static_cast<int>(y),target.image_width,target.image_height,target.bounds);
}
Point Desktop::aim(AppTarget& target, Window& window, const Json& step) {
  if (step.HasKey(L"element_index")) return center(live(target,window,number(step,L"element_index",0,10'000'000)));
  return screen_point(target,decimal(step,L"x",0,100'000),decimal(step,L"y",0,100'000));
}
void Desktop::bring_forward(Window& window) {
  if (has_target_focus(window.hwnd)) { SetWindowPos(window.hwnd,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE); return; }
  if (IsIconic(window.hwnd)) ShowWindowAsync(window.hwnd,SW_RESTORE);
  SetForegroundWindow(window.hwnd);
  // Windows may refuse a background process; the target's own accessibility focus is the second way in.
  if (!has_target_focus(window.hwnd)) { input_may_have_run=true; window.root->SetFocus(); }
  for (int i=0;i<10 && !has_target_focus(window.hwnd);++i)
    require(WaitForSingleObject(stop_event,50)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
  // An app started in the background can hold the focus and still sit under another window.
  SetWindowPos(window.hwnd,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
}
void Desktop::settle(HWND window, int budget) {
  // Quiet means the same place, foreground window and focused control for three looks in a row.
  const auto look=[&] {
    std::wstring seen;
    try { auto bounds=window_bounds(window); seen=std::to_wstring(bounds.x)+L","+std::to_wstring(bounds.y)+L","+std::to_wstring(bounds.width)+L","+std::to_wstring(bounds.height); } catch (...) {}
    seen+=L"|"+std::to_wstring(reinterpret_cast<uintptr_t>(GetForegroundWindow()))+L"|";
    com_ptr<IUIAutomationElement> focused;
    if (SUCCEEDED(automation->GetFocusedElement(focused.put())) && focused) seen+=runtime_key(focused.get());
    return seen;
  };
  const auto until=GetTickCount64()+budget;
  auto last=look();
  for (int quiet=0;quiet<3 && GetTickCount64()<until;) {
    require(WaitForSingleObject(stop_event,50)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
    auto now=look();
    quiet=now==last ? quiet+1 : 0;
    last=std::move(now);
  }
}
void Desktop::physically(Window& window, Point point, const std::function<void()>& input) {
  bring_forward(window);
  show_cursor(window.hwnd,point,L"moving");
  show_cursor(window.hwnd,point,L"executing");
  try { input(); }
  catch (...) { show_cursor(window.hwnd,point,L"failed"); throw; }
  show_cursor(window.hwnd,point,L"delivered");
}
void Desktop::refuse_protected_focus() {
  com_ptr<IUIAutomationElement> focused;
  if (FAILED(automation->GetFocusedElement(focused.put())) || !focused) return;
  BOOL secret=FALSE;
  if (SUCCEEDED(focused->get_CurrentIsPassword(&secret)) && secret)
    throw Refusal{L"unsupported",L"unsupported_action",L"Password fields are not typed into; ask the user to fill this one in."};
}
Json Desktop::list_apps(const Json& params) {
  const auto query=params.HasKey(L"query") ? lower(text(params,L"query",256)) : std::wstring();
  const auto limit=params.HasKey(L"limit") ? number(params,L"limit",1,200) : 50;
  struct Row { std::wstring id, name; std::vector<WindowRow> windows; };
  std::vector<Row> rows;
  const auto row_for=[&](const std::wstring& id) -> Row* {
    for (auto& row:rows) if (row.id==id) return &row;
    return nullptr;
  };
  for (auto& window:inventory()) {
    auto row=row_for(window.app);
    if (!row) {
      auto installed=catalog.find(window.app);
      rows.push_back(Row{window.app,installed ? installed->name : base_name(window.app),{}});
      row=&rows.back();
    }
    if (window.class_name!=L"#32768" && row->windows.size()<64) row->windows.push_back(window);
  }
  // Running apps first, then everything else that can be started.
  for (const auto& app:catalog.all()) if (!row_for(app.id)) rows.push_back(Row{app.id,app.name,{}});
  JsonArray output;
  bool truncated=false;
  for (const auto& row:rows) {
    if (!query.empty() && lower(row.name).find(query)==std::wstring::npos && lower(row.id).find(query)==std::wstring::npos) continue;
    if (output.Size()>=static_cast<unsigned>(limit)) { truncated=true; break; }
    Json entry; entry.Insert(L"id",string_value(row.id)); entry.Insert(L"name",string_value(row.name));
    entry.Insert(L"running",boolean(!row.windows.empty()));
    if (!row.windows.empty()) {
      JsonArray list;
      for (const auto& window:row.windows) {
        Json item; item.Insert(L"id",string_value(window.id)); item.Insert(L"title",string_value(window.title));
        list.Append(item);
      }
      entry.Insert(L"windows",list);
    }
    output.Append(entry);
  }
  Json result; result.Insert(L"apps",output); result.Insert(L"truncated",boolean(truncated)); return result;
}
Json Desktop::resolve_apps(const Json& params) {
  auto names=params.GetNamedArray(L"names");
  require(names.Size()<=32,"invalid-input","names must be a list of up to 32 names");
  std::vector<std::pair<std::wstring,std::wstring>> known;
  const auto add=[&](const std::wstring& id, const std::wstring& name) {
    for (const auto& item:known) if (item.first==id) return;
    known.emplace_back(id,name);
  };
  for (const auto& app:catalog.all()) add(app.id,app.name);
  for (const auto& window:inventory()) add(window.app,base_name(window.app));
  JsonArray output;
  for (const auto& value:names) {
    const auto request=std::wstring(value.GetString());
    require(request.size()<=512,"invalid-input","App name too long");
    const auto wanted=lower(request);
    std::vector<std::pair<std::wstring,std::wstring>> matches;
    for (const auto& item:known)
      if (lower(item.first)==wanted || lower(item.second)==wanted || lower(base_name(item.first))==wanted || lower(base_name(item.first))+L".exe"==wanted)
        matches.push_back(item);
    Json entry; entry.Insert(L"request",string_value(request));
    if (matches.empty()) entry.Insert(L"status",string_value(L"not_found"));
    else if (matches.size()==1) {
      entry.Insert(L"status",string_value(L"resolved"));
      entry.Insert(L"id",string_value(matches[0].first)); entry.Insert(L"name",string_value(matches[0].second));
    } else {
      entry.Insert(L"status",string_value(L"ambiguous"));
      JsonArray candidates;
      for (size_t i=0;i<matches.size() && i<16;++i) {
        Json item; item.Insert(L"id",string_value(matches[i].first)); item.Insert(L"name",string_value(matches[i].second));
        candidates.Append(item);
      }
      entry.Insert(L"candidates",candidates);
    }
    output.Append(entry);
  }
  Json result; result.Insert(L"apps",output); return result;
}
Json Desktop::app_state(const std::wstring& app, const std::optional<std::wstring>& wanted, bool screenshot, int settle_budget) {
  acquire();
  auto rows=inventory();
  std::vector<WindowRow> own;
  for (const auto& row:rows) if (row.app==app) own.push_back(row);
  const auto installed=catalog.find(app);
  bool launched=false;
  if (own.empty()) {
    require(installed!=nullptr,"app_not_found","No running or installed application has this id");
    Handle process(catalog.launch(*installed));
    launched=true;
    const DWORD started=process.value ? GetProcessId(process.value) : 0;
    const auto until=GetTickCount64()+8000;
    do {
      require(WaitForSingleObject(stop_event,100)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
      rows=inventory();
      for (const auto& row:rows) if (row.app==app || (started && row.pid==started)) own.push_back(row);
    } while (own.empty() && GetTickCount64()<until);
  }
  auto& target=targets[app];
  target.id=app; target.name=installed ? installed->name : base_name(app);
  target.observed=true; target.pictured=false; target.elements.clear();
  Json tree; tree.Insert(L"app",string_value(target.name));
  Json result;
  if (own.empty()) {
    target.hwnd=nullptr; target.window_id.clear();
    tree.Insert(L"elements",JsonArray());
    result.Insert(L"tree",tree);
    result.Insert(L"screenshotUnavailable",string_value(target.name+L" has no open window"));
    return result;
  }
  const WindowRow* chosen=nullptr;
  if (wanted) {
    for (const auto& row:own) if (row.id==*wanted) chosen=&row;
    require(chosen!=nullptr,"stale_state","That window is not open any more; list the app's windows again");
  } else {
    // An open menu is what the user would be looking at; then the window in front, then the first one shown.
    for (const auto& row:own) if (!chosen && row.class_name==L"#32768") chosen=&row;
    const auto front=GetForegroundWindow();
    for (const auto& row:own) if (!chosen && row.hwnd==front) chosen=&row;
    for (const auto& row:own) if (!chosen && !row.minimized) chosen=&row;
    if (!chosen) chosen=&own.front();
  }
  WindowRow picked=*chosen;
  if (IsIconic(picked.hwnd)) {
    ShowWindowAsync(picked.hwnd,SW_SHOWNOACTIVATE);
    for (int i=0;i<40 && IsIconic(picked.hwnd);++i)
      require(WaitForSingleObject(stop_event,50)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
  }
  settle(picked.hwnd,launched ? 1500 : settle_budget);
  // A window disabled by its own dialog is not the place to work: the dialog is. It is looked for
  // after the wait, because a dialog opened by the last action shows up a moment later.
  for (int depth=0;depth<8;++depth) {
    const auto dialog=blocking_window(picked.hwnd);
    if (!dialog) break;
    bool listed=false;
    for (const auto& row:inventory()) if (row.hwnd==dialog) { picked=row; listed=true; }
    if (!listed) break;
    settle(picked.hwnd,300);
  }
  auto& window=windows.at(picked.id);
  target.window_id=picked.id; target.hwnd=window.hwnd; target.bounds=window_bounds(window.hwnd);
  publish_guard_state(has_target_focus(window.hwnd) ? ControlState::foreground : ControlState::background,window.hwnd);
  preview_target(window.hwnd);

  struct Seen { std::wstring key, title; const wchar_t* role; int depth; Element element; std::optional<std::wstring> value; std::vector<const wchar_t*> states; JsonArray actions; };
  std::vector<Seen> seen;
  std::set<std::wstring> keys;
  bool truncated=false;
  unsigned visited=0;
  std::wstring focus_key;
  {
    com_ptr<IUIAutomationElement> focused;
    if (SUCCEEDED(automation->GetFocusedElement(focused.put())) && focused) focus_key=runtime_key(focused.get());
  }
  com_ptr<IUIAutomationTreeWalker> walker;
  check_hresult(automation->get_ControlViewWalker(walker.put()));
  std::function<void(com_ptr<IUIAutomationElement>, const std::wstring&, int, int)> walk;
  walk=[&](com_ptr<IUIAutomationElement> node, const std::wstring& parent, int depth, int level) {
    if (!node) return;
    if (seen.size()>=element_limit || level>40 || visited>=visit_limit) { truncated=true; return; }
    ++visited;
    std::wstring own_key=parent;
    int child_depth=depth;
    bool secret=false;
    try {
      // UIA may nest owned dialog roots below a parent window. Do not publish
      // those controls under the parent's identity, including virtual descendants.
      UIA_HWND native=nullptr; check_hresult(node->get_CurrentNativeWindowHandle(&native));
      if (native && GetAncestor(reinterpret_cast<HWND>(native),GA_ROOT)!=window.hwnd) return;
      CONTROLTYPEID type; check_hresult(node->get_CurrentControlType(&type));
      // Parts of other controls the model never needs.
      if (type==UIA_ScrollBarControlTypeId || type==UIA_ThumbControlTypeId) return;
      auto rect=element_bounds(node.get());
      secret=protected_element(node.get());
      std::wstring label;
      OwnedString name;
      if (!secret && SUCCEEDED(node->get_CurrentName(&name.value)) && name.value) label=clipped(name.value,SysStringLen(name.value),512);
      auto value=secret ? std::nullopt : element_value(node.get());
      auto accessibility=secret ? AccessibilityState{} : accessibility_state(node.get());
      // Containers that only lay things out are listed only when they carry a name, a value or an action.
      const bool plain=(type==UIA_PaneControlTypeId || type==UIA_GroupControlTypeId || type==UIA_CustomControlTypeId) &&
        label.empty() && !value && !accessibility.actions && !secret;
      if (!plain && rect.width>0 && rect.height>0) {
        auto key=runtime_key(node.get());
        if (key.empty()) key=(parent.size()<400 ? parent : std::wstring(L"p"))+L"/"+role_name(type)+L"#"+std::to_wstring(seen.size());
        while (keys.contains(key)) key+=L"~";
        keys.insert(key);
        Seen entry{key,label,role_name(type),depth,Element{node,rect,secret},value,{},JsonArray()};
        BOOL enabled=FALSE; check_hresult(node->get_CurrentIsEnabled(&enabled));
        if (!focus_key.empty() && key==focus_key) entry.states.push_back(L"focused");
        if (accessibility.selected==1) entry.states.push_back(L"selected");
        if (accessibility.toggle==ToggleState_On) entry.states.push_back(L"checked");
        if (accessibility.expanded==ExpandCollapseState_Expanded) entry.states.push_back(L"expanded");
        if (accessibility.expanded==ExpandCollapseState_Collapsed) entry.states.push_back(L"collapsed");
        if (!enabled) entry.states.push_back(L"disabled");
        // A click already invokes; the list holds what a click does not do.
        auto offered=accessibility_actions(accessibility);
        for (const auto& action:offered) if (action.GetString()!=L"invoke") entry.actions.Append(action);
        seen.push_back(std::move(entry));
        own_key=key; child_depth=depth+1;
      }
    } catch (const hresult_error&) { return; /* The element went away while it was read. */ }
      catch (const Error&) { return; /* A name too long to hold safely: the element is left out. */ }
    if (secret) return;
    com_ptr<IUIAutomationElement> child;
    if (FAILED(walker->GetFirstChildElement(node.get(),child.put()))) return;
    while (child) {
      if (seen.size()>=element_limit || visited>=visit_limit) { truncated=true; break; }
      walk(child,own_key,child_depth,level+1);
      com_ptr<IUIAutomationElement> next;
      if (FAILED(walker->GetNextSiblingElement(child.get(),next.put()))) break;
      child=std::move(next);
    }
  };
  walk(window.root,L"",0,0);

  // Keys that are gone give up their index; it is never handed out again.
  std::erase_if(target.indices,[&](const auto& item) { return !windows.contains(item.first); });
  auto& indices=target.indices[picked.id];
  std::erase_if(indices,[&](const auto& item) { return !keys.contains(item.first); });
  if (screenshot) {
    try {
      auto pixels=capture_window_pixels(window.hwnd);
      auto [width,height]=image_budget(pixels.width,pixels.height);
      result.Insert(L"screenshot",image_json(jpeg(pixels,width,height),width,height));
      target.pictured=true; target.image_width=width; target.image_height=height;
    } catch (const Error& error) {
      if (error.code=="cancelled") throw;
      result.Insert(L"screenshotUnavailable",string_value(to_hstring(error.what())));
    } catch (...) {
      result.Insert(L"screenshotUnavailable",string_value(L"The window could not be captured"));
    }
  }
  JsonArray elements;
  for (auto& entry:seen) {
    auto known=indices.find(entry.key);
    const int index=known!=indices.end() ? known->second : target.next_index++;
    indices[entry.key]=index;
    target.elements.emplace(index,entry.element);
    Json item; item.Insert(L"key",string_value(entry.key)); item.Insert(L"index",numeric(index));
    item.Insert(L"depth",numeric(std::min(entry.depth,64))); item.Insert(L"role",string_value(entry.role));
    if (!entry.title.empty()) item.Insert(L"title",string_value(entry.title));
    if (entry.element.secure) item.Insert(L"secure",boolean(true));
    else if (entry.value) item.Insert(L"value",string_value(*entry.value));
    if (!entry.states.empty()) {
      JsonArray states; for (auto state:entry.states) states.Append(string_value(state));
      item.Insert(L"states",states);
    }
    if (entry.actions.Size()) item.Insert(L"actions",entry.actions);
    if (target.pictured && target.bounds.width>0 && target.bounds.height>0) {
      const double sx=static_cast<double>(target.image_width)/target.bounds.width, sy=static_cast<double>(target.image_height)/target.bounds.height;
      Json frame;
      frame.Insert(L"x",JsonValue::CreateNumberValue(std::round((entry.element.bounds.x-target.bounds.x)*sx)));
      frame.Insert(L"y",JsonValue::CreateNumberValue(std::round((entry.element.bounds.y-target.bounds.y)*sy)));
      frame.Insert(L"width",JsonValue::CreateNumberValue(std::round(entry.element.bounds.width*sx)));
      frame.Insert(L"height",JsonValue::CreateNumberValue(std::round(entry.element.bounds.height*sy)));
      item.Insert(L"frame",frame);
    }
    elements.Append(item);
  }
  if (!picked.title.empty()) tree.Insert(L"window",string_value(picked.title));
  tree.Insert(L"elements",elements);
  if (truncated) tree.Insert(L"truncated",boolean(true));
  result.Insert(L"tree",tree);
  return result;
}
Json Desktop::scroll(AppTarget& target, Window& window, const Json& step) {
  const auto direction=text(step,L"direction");
  require(direction==L"up" || direction==L"down" || direction==L"left" || direction==L"right","invalid-input","Unknown scroll direction");
  const double pages=step.HasKey(L"pages") ? decimal(step,L"pages",0.1,50) : 1;
  const bool vertical=direction==L"up" || direction==L"down", forward=direction==L"down" || direction==L"right";
  const auto point=aim(target,window,step);
  com_ptr<IUIAutomationElement> start;
  if (step.HasKey(L"element_index")) start=live(target,window,number(step,L"element_index",0,10'000'000)).node;
  else automation->ElementFromPoint(POINT{point.x,point.y},start.put());
  int extent=vertical ? target.bounds.height : target.bounds.width;
  try {
    com_ptr<IUIAutomationTreeWalker> walker;
    check_hresult(automation->get_ControlViewWalker(walker.put()));
    auto current=start;
    for (int depth=0;current && depth<12 && belongs_to_window(current.get(),window);++depth) {
      com_ptr<IUIAutomationScrollPattern> pattern;
      BOOL able=FALSE;
      if (SUCCEEDED(current->GetCurrentPatternAs(UIA_ScrollPatternId,IID_PPV_ARGS(pattern.put()))) && pattern &&
          SUCCEEDED(vertical ? pattern->get_CurrentVerticallyScrollable(&able) : pattern->get_CurrentHorizontallyScrollable(&able)) && able) {
        // The scrolling container moves by itself, in the background; whole pages or small steps.
        const bool whole=pages>=0.75;
        const auto amount=forward ? (whole ? ScrollAmount_LargeIncrement : ScrollAmount_SmallIncrement) : (whole ? ScrollAmount_LargeDecrement : ScrollAmount_SmallDecrement);
        const int times=std::clamp(static_cast<int>(std::lround(whole ? pages : pages*8)),1,50);
        show_cursor(window.hwnd,point,L"executing");
        input_may_have_run=true;
        for (int i=0;i<times;++i)
          check_hresult(vertical ? pattern->Scroll(ScrollAmount_NoAmount,amount) : pattern->Scroll(amount,ScrollAmount_NoAmount));
        show_cursor(window.hwnd,point,L"delivered");
        return outcome(L"delivered",L"ax");
      }
      auto size=element_bounds(current.get());
      if (depth==0 && size.width>0 && size.height>0) extent=vertical ? size.height : size.width;
      com_ptr<IUIAutomationElement> parent;
      if (FAILED(walker->GetParentElement(current.get(),parent.put()))) break;
      current=std::move(parent);
    }
  } catch (const hresult_error&) { /* No scrolling container answered; the wheel is next. */ }
  // One wheel notch moves roughly 120 pixels of content.
  const int notches=std::clamp(static_cast<int>(std::lround(pages*extent/120.0)),1,60);
  const int delta=120*notches*(direction==L"up" || direction==L"right" ? 1 : -1);
  physically(window,point,[&] { scroll_at(window.hwnd,point,vertical ? 0 : delta,vertical ? delta : 0); });
  return outcome(L"delivered",L"input");
}
Json Desktop::perform(AppTarget& target, Window& window, const Json& step) {
  const auto action=text(step,L"action",64);
  const auto budget=[](double extra) { operation_deadline=GetTickCount64()+step_budget+static_cast<ULONGLONG>(extra); };
  const bool aimed=step.HasKey(L"element_index") || step.HasKey(L"x");
  // Typing and pasting may first click the place the text goes to.
  const auto focus_target=[&] {
    if (!aimed) { bring_forward(window); return; }
    if (step.HasKey(L"element_index") && live(target,window,number(step,L"element_index",0,10'000'000)).secure)
      throw Refusal{L"unsupported",L"unsupported_action",L"Password fields are not typed into; ask the user to fill this one in."};
    const auto point=aim(target,window,step);
    if (step.HasKey(L"element_index")) {
      // Accessibility focus first: it needs no pointer and works when the element is partly covered.
      auto& element=live(target,window,number(step,L"element_index",0,10'000'000));
      bring_forward(window);
      check_focus(window.hwnd);
      try {
        input_may_have_run=true;
        com_ptr<IUIAutomationElement> focused;
        BOOL same=FALSE;
        if (SUCCEEDED(element.node->SetFocus()) && SUCCEEDED(automation->GetFocusedElement(focused.put())) && focused &&
            SUCCEEDED(automation->CompareElements(focused.get(),element.node.get(),&same)) && same) {
          show_cursor(window.hwnd,point,L"executing");
          return;
        }
      } catch (const hresult_error&) { /* The element does not take focus that way; a click does. */ }
    }
    physically(window,point,[&] { click_point(window.hwnd,point,L"left",1,{}); });
    require(WaitForSingleObject(stop_event,80)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
  };
  if (action==L"wait") {
    const auto wait=static_cast<DWORD>(decimal(step,L"duration_s",0,10)*1000);
    budget(wait);
    require(WaitForSingleObject(stop_event,wait)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
    return outcome(L"delivered");
  }
  if (action==L"click") {
    const auto button=button_of(step);
    const auto count=step.HasKey(L"click_count") ? number(step,L"click_count",1,3) : 1;
    const auto held=parse_held(step);
    const auto point=aim(target,window,step);
    physically(window,point,[&] { click_point(window.hwnd,point,button,count,held); });
    return outcome(L"delivered",L"input");
  }
  if (action==L"type_text") {
    const auto value=text(step,L"text",20'000);
    focus_target();
    refuse_protected_focus();
    budget(value.size()*25.0);
    type_text(window.hwnd,value,[&] { refuse_protected_focus(); });
    return outcome(L"delivered",L"input");
  }
  if (action==L"paste") {
    const auto value=text(step,L"text",100'000);
    focus_target();
    refuse_protected_focus();
    const auto before=clipboard_text();
    if (!before && clipboard_has_content())
      throw Refusal{L"unsupported",L"unsupported_action",L"The clipboard holds something that is not text and could not be put back; use computer_type_text."};
    set_clipboard_text(value);
    struct PutBack {
      const std::optional<std::wstring>& before;
      ~PutBack() { try { if (before) set_clipboard_text(*before); else clear_clipboard(); } catch (...) { /* The clipboard is busy; the pasted text stays on it. */ } }
    } put_back{before};
    Chord paste; paste.modifiers.push_back(VK_CONTROL); paste.key='V';
    press_chord(window.hwnd,paste,1);
    // The application reads the clipboard after it sees the keys.
    require(WaitForSingleObject(stop_event,300)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
    return outcome(L"delivered",L"input");
  }
  if (action==L"press_key") {
    const auto chord=parse_chord(step.GetNamedObject(L"chord"));
    const auto repeat=step.HasKey(L"repeat") ? number(step,L"repeat",1,100) : 1;
    bring_forward(window);
    budget(repeat*60.0);
    press_chord(window.hwnd,chord,repeat);
    return outcome(L"delivered",L"input");
  }
  if (action==L"hold_key") {
    const auto chord=parse_chord(step.GetNamedObject(L"chord"));
    const auto held=static_cast<int>(decimal(step,L"duration_s",0.001,100)*1000);
    bring_forward(window);
    budget(held);
    hold_chord(window.hwnd,chord,held);
    return outcome(L"delivered",L"input");
  }
  if (action==L"scroll") return scroll(target,window,step);
  if (action==L"drag") {
    auto raw=step.GetNamedArray(L"path");
    require(raw.Size()>=2 && raw.Size()<=20,"invalid-input","A drag needs 2 to 20 points");
    std::vector<Point> path;
    for (const auto& item:raw) {
      auto pair=item.GetArray();
      require(pair.Size()==2,"invalid-input","A drag point is [x, y]");
      path.push_back(screen_point(target,pair.GetNumberAt(0),pair.GetNumberAt(1)));
    }
    const auto duration=step.HasKey(L"duration_ms") ? number(step,L"duration_ms",0,10'000) : 300;
    const auto button=button_of(step);
    const auto held=parse_held(step);
    budget(duration);
    physically(window,path.front(),[&] { drag_path(window.hwnd,path,button,duration,held); });
    show_cursor(window.hwnd,path.back(),L"delivered");
    return outcome(L"delivered",L"input");
  }
  if (action==L"mouse") {
    const auto phase=text(step,L"event");
    const auto point=screen_point(target,decimal(step,L"x",0,100'000),decimal(step,L"y",0,100'000));
    if (phase==L"down") {
      if (pointer_held()) throw Refusal{L"unsupported",L"unsupported_action",L"A mouse button is already down; release it with event up first."};
      const auto button=button_of(step);
      const auto held=parse_held(step);
      physically(window,point,[&] { pointer_down(window.hwnd,point,button,held); });
      return outcome(L"delivered",L"input");
    }
    require(phase==L"move" || phase==L"up","invalid-input","Unknown mouse event");
    if (!pointer_held()) throw Refusal{L"unsupported",L"unsupported_action",L"Hover is not supported: press first with event down."};
    show_cursor(window.hwnd,point,L"executing");
    if (phase==L"move") pointer_move(window.hwnd,point); else pointer_up(window.hwnd,point);
    show_cursor(window.hwnd,point,L"delivered");
    return outcome(L"delivered",L"input");
  }
  // Everything below acts on one listed element through UI Automation.
  auto& element=live(target,window,number(step,L"element_index",0,10'000'000));
  const auto point=center(element);
  if (element.secure) throw Refusal{L"unsupported",L"unsupported_action",L"Password fields are not changed by the agent; ask the user to fill this one in."};
  if (action==L"set_value") {
    const auto value=text(step,L"value",100'000);
    show_cursor(window.hwnd,point,L"executing");
    com_ptr<IUIAutomationValuePattern> pattern;
    if (SUCCEEDED(element.node->GetCurrentPatternAs(UIA_ValuePatternId,IID_PPV_ARGS(pattern.put()))) && pattern) {
      BOOL readonly=TRUE; check_hresult(pattern->get_CurrentIsReadOnly(&readonly));
      if (readonly) throw Refusal{L"unsupported",L"unsupported_action",L"The element is read-only."};
      UIA_HWND native=nullptr; check_hresult(element.node->get_CurrentNativeWindowHandle(&native));
      auto hwnd=reinterpret_cast<HWND>(native);
      wchar_t klass[256]{}; if (hwnd) GetClassNameW(hwnd,klass,256);
      input_may_have_run=true;
      if (!has_target_focus(window.hwnd) && (std::wstring_view(klass)==L"Edit" || std::wstring_view(klass)==L"EDIT")) {
        // The system's EDIT proxy may bring the application forward during SetValue;
        // WM_SETTEXT reaches a standard EDIT directly and leaves the user's window in front.
        DWORD_PTR accepted=0;
        require(SendMessageTimeoutW(hwnd,WM_SETTEXT,0,reinterpret_cast<LPARAM>(value.c_str()),SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&accepted)!=0,
          "uncertain-result","The app did not answer in time; observe before any further action");
        require(accepted!=0,"value-rejected","The field rejected the new value");
      } else {
        OwnedString argument; argument.value=SysAllocStringLen(value.data(),static_cast<UINT>(value.size()));
        require(argument.value!=nullptr,"native-error","Cannot allocate control value");
        check_hresult(pattern->SetValue(argument.value));
      }
    } else {
      com_ptr<IUIAutomationRangeValuePattern> range;
      if (FAILED(element.node->GetCurrentPatternAs(UIA_RangeValuePatternId,IID_PPV_ARGS(range.put()))) || !range)
        throw Refusal{L"unsupported",L"unsupported_action",L"The element has no value to set."};
      wchar_t* end=nullptr;
      const double number_value=wcstod(value.c_str(),&end);
      if (value.empty() || !end || *end || !std::isfinite(number_value)) throw Refusal{L"unsupported",L"unsupported_action",L"This element takes a number."};
      input_may_have_run=true;
      check_hresult(range->SetValue(number_value));
    }
    show_cursor(window.hwnd,point,L"delivered");
    return outcome(L"delivered",L"ax");
  }
  if (action==L"select_text") {
    const auto wanted=text(step,L"text",20'000);
    const auto prefix=step.HasKey(L"prefix") ? text(step,L"prefix",1000) : std::wstring();
    const auto suffix=step.HasKey(L"suffix") ? text(step,L"suffix",1000) : std::wstring();
    const auto kind=step.HasKey(L"selection_type") ? text(step,L"selection_type") : std::wstring(L"text");
    require(kind==L"text" || kind==L"cursor_before" || kind==L"cursor_after","invalid-input","Unknown selection type");
    const auto full=control_text(element.node.get(),window.hwnd);
    const auto context=full.find(prefix+wanted+suffix);
    if (context==std::wstring::npos) throw Refusal{L"ineffective",L"stale_state",L"That text is not in the element now; look at its current value."};
    const auto offset=context+prefix.size();
    // The selection is made by match number, counted the way the control searches: left to right, no overlaps.
    int occurrence=0;
    for (size_t from=0;;) {
      const auto at=full.find(wanted,from);
      ++occurrence;
      if (at==std::wstring::npos || at>=offset) break;
      from=at+wanted.size();
    }
    bring_forward(window);
    show_cursor(window.hwnd,point,L"executing");
    select_control_text(element.node.get(),window.hwnd,wanted,occurrence,
      kind==L"cursor_before" ? TextPlacement::cursor_before : kind==L"cursor_after" ? TextPlacement::cursor_after : TextPlacement::text);
    show_cursor(window.hwnd,point,L"delivered");
    return outcome(L"delivered",L"ax");
  }
  if (action==L"perform_secondary_action") {
    const auto name=text(step,L"secondary_action",64);
    const auto state=accessibility_state(element.node.get());
    bool offered=false;
    for (const auto& item:accessibility_actions(state)) if (item.GetString()==name) offered=true;
    // Only actions the element offers; a guessed one is never tried.
    if (!offered) throw Refusal{L"unsupported",L"unsupported_action",L""};
    bring_forward(window);
    check_focus(window.hwnd);
    show_cursor(window.hwnd,point,L"executing");
    input_may_have_run=true;
    auto receipt=actions.start(element.node,window.hwnd,state,name);
    if (text(receipt,L"status")==L"failed") {
      show_cursor(window.hwnd,point,L"failed");
      throw Refusal{L"ineffective",L"unsupported_action",L"The element refused that action."};
    }
    // "pending" is a provider that waits for its own dialog to close: the action did go out.
    show_cursor(window.hwnd,point,L"delivered");
    return outcome(L"delivered",L"ax");
  }
  throw Refusal{L"unsupported",L"unsupported_action",L""};
}
Json Desktop::act(const std::wstring& app, const Json& step) {
  try {
    auto found=targets.find(app);
    if (found==targets.end() || !found->second.observed || !found->second.hwnd) throw Refusal{L"blocked",L"no_state",L""};
    auto& target=found->second;
    auto& window=live_window(target);
    // A paused turn waits here; having waited, it acts on nothing, because the app may have changed.
    wait_for_access(window.hwnd,false);
    if (!IsWindowEnabled(window.hwnd) && blocking_window(window.hwnd)) throw Refusal{L"blocked",L"target_blocked",L""};
    if (!(target.bounds==window_bounds(window.hwnd))) throw Refusal{L"blocked",L"stale_state",L"The window moved or was resized since the latest state."};
    return perform(target,window,step);
  } catch (const Refusal& refusal) {
    return refused(refusal);
  } catch (const Error& error) {
    if (error.code=="cancelled" || error.code=="invalid-input" || error.code=="invalid_key") throw;
    return refused(refusal_for(error));
  } catch (const hresult_error&) {
    return refused(Refusal{L"blocked",L"stale_state",L"The app stopped answering for that element; observe it again."});
  }
}
Json Desktop::state_after(const std::wstring& app) {
  operation_deadline=GetTickCount64()+step_budget;
  auto found=targets.find(app);
  std::optional<std::wstring> keep;
  // The model keeps working in the window it chose, unless that window is gone or a dialog now covers it.
  if (found!=targets.end() && found->second.hwnd && IsWindow(found->second.hwnd) && IsWindowVisible(found->second.hwnd) &&
      IsWindowEnabled(found->second.hwnd) && windows.contains(found->second.window_id)) {
    wchar_t name[256]{}; GetClassNameW(found->second.hwnd,name,256);
    if (std::wstring_view(name)!=L"#32768") keep=found->second.window_id;
  }
  try { return app_state(app,keep,true,900); }
  catch (const Error& error) {
    if (error.code!="stale_state") throw;
    return app_state(app,std::nullopt,true,900);
  }
}
Pixels Desktop::visible_screen(Rect display, const std::set<std::wstring>& allowed) {
  auto pixels=capture_screen_pixels(display);
  struct Region { HRGN value; ~Region() { DeleteObject(value); } };
  Region keep{CreateRectRgn(0,0,0,0)}, covered{CreateRectRgn(0,0,0,0)};
  std::map<DWORD,std::wstring> apps;
  // Front to back: what a window in front covers is not shown, whoever is behind it.
  for (HWND hwnd=GetTopWindow(nullptr);hwnd;hwnd=GetWindow(hwnd,GW_HWNDNEXT)) {
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || (GetWindowLongPtrW(hwnd,GWL_EXSTYLE)&WS_EX_TRANSPARENT)) continue;
    BOOL cloaked=FALSE;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd,DWMWA_CLOAKED,&cloaked,sizeof(cloaked))) && cloaked) continue;
    DWORD pid=0; GetWindowThreadProcessId(hwnd,&pid);
    if (pid==GetCurrentProcessId()) continue;
    RECT rect{};
    if (FAILED(DwmGetWindowAttribute(hwnd,DWMWA_EXTENDED_FRAME_BOUNDS,&rect,sizeof(rect))) && !GetWindowRect(hwnd,&rect)) continue;
    if (rect.right<=rect.left || rect.bottom<=rect.top) continue;
    if (!apps.contains(pid)) apps.emplace(pid,process_app_id(pid));
    Region area{CreateRectRgn(rect.left-display.x,rect.top-display.y,rect.right-display.x,rect.bottom-display.y)};
    if (allowed.contains(apps.at(pid))) {
      Region shown{CreateRectRgn(0,0,0,0)};
      CombineRgn(shown.value,area.value,covered.value,RGN_DIFF);
      CombineRgn(keep.value,keep.value,shown.value,RGN_OR);
    }
    CombineRgn(covered.value,covered.value,area.value,RGN_OR);
  }
  keep_only(pixels,keep.value);
  return pixels;
}
Json Desktop::screenshot(const Json& params) {
  const auto allowed=allowed_apps(params);
  require(!allowed.empty(),"app_not_allowed","No app is granted in this conversation");
  const double scale=params.HasKey(L"scale") ? decimal(params,L"scale",0.1,1) : 1;
  acquire();
  const Rect display{0,0,GetSystemMetrics(SM_CXSCREEN),GetSystemMetrics(SM_CYSCREEN)};
  auto pixels=visible_screen(display,allowed);
  auto [full_width,full_height]=image_budget(pixels.width,pixels.height);
  const int width=std::max(1,static_cast<int>(std::lround(full_width*scale))), height=std::max(1,static_cast<int>(std::lround(full_height*scale)));
  screen=Screen{display,width,height};
  return image_json(jpeg(pixels,width,height),width,height);
}
Json Desktop::zoom(const Json& params) {
  const auto allowed=allowed_apps(params);
  require(!allowed.empty(),"app_not_allowed","No app is granted in this conversation");
  auto raw=params.GetNamedArray(L"region");
  require(raw.Size()==4,"invalid-input","region is [x0, y0, x1, y1]");
  const double x0=raw.GetNumberAt(0), y0=raw.GetNumberAt(1), x1=raw.GetNumberAt(2), y1=raw.GetNumberAt(3);
  require(x0>=0 && y0>=0 && x1>x0 && y1>y0,"invalid-input","region is [x0, y0, x1, y1] with x1 > x0 and y1 > y0");
  const double scale=params.HasKey(L"scale") ? decimal(params,L"scale",0.1,1) : 1;
  acquire();
  Pixels pixels;
  int frame_width=0, frame_height=0;
  if (params.HasKey(L"app")) {
    const auto app=text(params,L"app",512);
    require(allowed.contains(app),"app_not_allowed","That app is not granted in this conversation");
    auto found=targets.find(app);
    require(found!=targets.end() && found->second.pictured && found->second.hwnd,"no_state","There is no screenshot of that app to zoom into yet");
    auto& target=found->second;
    require(IsWindow(target.hwnd) && target.bounds==window_bounds(target.hwnd),"stale_state","The window moved since its screenshot");
    frame_width=target.image_width; frame_height=target.image_height;
    pixels=capture_window_pixels(target.hwnd);
  } else {
    require(screen.has_value(),"no_state","There is no full-screen screenshot to zoom into yet");
    frame_width=screen->width; frame_height=screen->height;
    pixels=visible_screen(screen->bounds,allowed);
  }
  require(x1<=frame_width && y1<=frame_height,"point_outside_frame","The region is not inside the latest screenshot");
  // The region is given in screenshot pixels; the crop is taken from the full-size picture.
  const double sx=static_cast<double>(pixels.width)/frame_width, sy=static_cast<double>(pixels.height)/frame_height;
  Rect region{static_cast<int>(x0*sx),static_cast<int>(y0*sy),0,0};
  region.width=std::clamp(static_cast<int>(std::ceil((x1-x0)*sx)),1,pixels.width-region.x);
  region.height=std::clamp(static_cast<int>(std::ceil((y1-y0)*sy)),1,pixels.height-region.y);
  auto cropped=crop_pixels(pixels,region);
  auto [full_width,full_height]=image_budget(cropped.width,cropped.height);
  const int width=std::max(1,static_cast<int>(std::lround(full_width*scale))), height=std::max(1,static_cast<int>(std::lround(full_height*scale)));
  return image_json(jpeg(cropped,width,height),width,height);
}
Json Desktop::approval(const Json& params) {
  // The host names the app the pending tool call works on; its window is the one this helper last observed.
  const auto wanted=lower(text(params,L"windowId",512));
  AppTarget* target=nullptr;
  for (auto& [id,candidate]:targets) if (lower(id)==wanted || lower(candidate.name)==wanted) target=&candidate;
  require(target!=nullptr && target->hwnd,"no_state","That app has not been observed in this turn");
  Window* window=nullptr;
  try { window=&live_window(*target); } catch (const Refusal&) { throw Error("stale_state","The window is closed or was replaced"); }
  acquire();
  auto focus_target=window->root;
  const bool begin=text(params,L"stage")==L"begin";
  if (begin) {
    approval_control.reset();
    com_ptr<IUIAutomationElement> focused;
    check_hresult(automation->GetFocusedElement(focused.put()));
    // Capture the actual focus before the permission dialog takes it.
    if (focused && has_target_focus(window->hwnd) && belongs_to_window(focused.get(),*window) && !protected_element(focused.get()))
      approval_control=Element{focused,element_bounds(focused.get()),false};
  } else if (approval_control) {
    try {
      if (belongs_to_window(approval_control->node.get(),*window) && approval_control->bounds==element_bounds(approval_control->node.get()))
        focus_target=approval_control->node;
    } catch (const hresult_error&) { /* The control is gone; the window itself gets the focus. */ }
  }
  std::string reason;
  const bool restored=approval_focus(window->hwnd,window->root.get(),focus_target.get(),params,reason);
  if (!begin) approval_control.reset();
  Json result; result.Insert(L"restored",boolean(restored));
  result.Insert(L"reason",string_value(to_hstring(reason)));
  return result;
}
Windows::Data::Json::IJsonValue Desktop::execute(const std::wstring& method, const Json& params) {
  if (method == L"status") {
    fields(params, {});
    bool active = true; try { check_active_desktop(); } catch (...) { active = false; }
    // Windows has no per-app consent for accessibility or capture; both are available to a desktop process.
    Json permissions; permissions.Insert(L"accessibility", boolean(true)); permissions.Insert(L"screenRecording", boolean(true));
    JsonArray limits;
    if (!active) limits.Append(string_value(L"Windows is locked or shows a secure desktop; unlock it first."));
    limits.Append(string_value(L"Windows that run as administrator, UAC prompts and the sign-in screen cannot be operated."));
    Json result; result.Insert(L"ready", boolean(active)); result.Insert(L"permissions", permissions);
    result.Insert(L"limitations", limits); return result;
  }
  if (method == L"permissions.request") {
    fields(params, {L"kind"});
    Json result; result.Insert(L"opened", boolean(false)); return result;
  }
  if (method == L"maintenance") {
    fields(params,{}); acquire();
    // Installer maintenance owns the lease, not interactive computer input.
    // Its explicit update dialog controls cancellation; hide the input panel.
    lease_active=false; publish_guard_state(ControlState::idle);
    Json result; result.Insert(L"maintenanceReady",boolean(true)); return result;
  }
  if (method == L"preview.start") {
    fields(params, {L"fps"});
    start_preview(params.HasKey(L"fps") ? static_cast<int>(std::lround(decimal(params,L"fps",0.1,60))) : 2);
    Json result; result.Insert(L"started", boolean(true)); return result;
  }
  if (method == L"preview.stop") {
    fields(params, {});
    stop_preview();
    Json result; result.Insert(L"stopped", boolean(true)); return result;
  }
  if (method == L"list_apps") { fields(params, {L"query", L"limit"}); check_active_desktop(); return list_apps(params); }
  if (method == L"resolve_apps") { fields(params, {L"names"}); check_active_desktop(); return resolve_apps(params); }
  if (method == L"approval_focus") { fields(params,{L"windowId",L"stage",L"callId",L"hostPid",L"approved"}); return approval(params); }
  if (method == L"screenshot") { fields(params, {L"scale", L"allowed"}); return screenshot(params); }
  if (method == L"zoom") { fields(params, {L"region", L"app", L"scale", L"allowed"}); return zoom(params); }
  if (method == L"get_app_state") {
    fields(params, {L"app", L"window_id", L"screenshot"});
    const auto app=text(params,L"app",512);
    acquire();
    // Looking is allowed again as soon as the user resumes; the pause itself changes nothing here.
    try { wait_for_access(nullptr,false); } catch (const Error& error) { if (error.code!="needs-observation") throw; }
    std::optional<std::wstring> wanted;
    if (params.HasKey(L"window_id")) wanted=text(params,L"window_id");
    return app_state(app,wanted,params.HasKey(L"screenshot") && params.GetNamedBoolean(L"screenshot"),600);
  }
  if (method == L"act" || method == L"batch") {
    fields(params, {L"app", L"action", L"actions", L"allowed"});
    const auto app=text(params,L"app",512);
    require(allowed_apps(params).contains(app),"app_not_allowed","That app is not granted in this conversation");
    acquire();
    Json result;
    bool looked=targets.contains(app) && targets.at(app).observed;
    if (method == L"act") {
      result.Insert(L"result",act(app,params.GetNamedObject(L"action")));
    } else {
      auto steps=params.GetNamedArray(L"actions");
      require(steps.Size()>=1 && steps.Size()<=50,"invalid-input","A batch has 1 to 50 actions");
      JsonArray results;
      for (const auto& step:steps) {
        operation_deadline=GetTickCount64()+step_budget;
        auto done=act(app,step.GetObject());
        results.Append(done);
        // The batch stops at the first step that did not go out.
        if (text(done,L"outcome")!=L"delivered") break;
        require(WaitForSingleObject(stop_event,120)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
      }
      result.Insert(L"results",results);
    }
    if (looked) result.Insert(L"state",state_after(app));
    return result;
  }
  throw Error("unsupported_action", "Unknown Computer Use operation");
}
}
