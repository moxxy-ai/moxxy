#include "desktop.hpp"
#include "input-guard.hpp"
#include "text-actions.hpp"
#include <dwmapi.h>
#include <functional>

namespace moxxy {
namespace {
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
std::optional<ValueState> element_value(IUIAutomationElement* node) {
  com_ptr<IUIAutomationValuePattern> pattern;
  if (FAILED(node->GetCurrentPatternAs(UIA_ValuePatternId,IID_PPV_ARGS(pattern.put()))) || !pattern) return std::nullopt;
  struct OwnedString { BSTR value=nullptr; ~OwnedString() { SysFreeString(value); } } text;
  check_hresult(pattern->get_CurrentValue(&text.value));
  auto length=SysStringLen(text.value);
  require(length<=64000,"observation-limit","Control value exceeds observation safety limit; use the image path");
  BOOL readonly=TRUE; check_hresult(pattern->get_CurrentIsReadOnly(&readonly));
  return ValueState{length ? std::wstring(text.value,length) : std::wstring(), readonly!=FALSE};
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
Window& Desktop::target(const Json& params, bool allow_minimized) {
  auto id = text(params, L"windowId");
  auto found = windows.find(id);
  require(found != windows.end(), "stale-window", "List windows again; window reference is unknown");
  auto& window = found->second;
  DWORD pid = 0; GetWindowThreadProcessId(window.hwnd, &pid);
  require(IsWindow(window.hwnd) && pid == window.pid && creation_time(pid) == window.created && window_generation(window.hwnd) == window.generation,
    "stale-window", "Window or process no longer exists");
  com_ptr<IUIAutomationElement> current;
  check_hresult(automation->ElementFromHandle(window.hwnd, current.put()));
  BOOL same = FALSE; check_hresult(automation->CompareElements(window.root.get(), current.get(), &same));
  require(same, "stale-window", "Window identity changed; list windows again");
  require((allow_minimized || !IsIconic(window.hwnd)) && IsWindowVisible(window.hwnd), "target-unavailable", "Restore the window first");
  acquire();
  publish_guard_state(has_target_focus(window.hwnd) ? ControlState::foreground : ControlState::background,window.hwnd);
  return window;
}
JsonArray Desktop::list_windows() {
  std::vector<HWND> handles;
  EnumWindows([](HWND hwnd, LPARAM ptr) -> BOOL {
    wchar_t name[256]{}; GetClassNameW(hwnd, name, 256);
    if (std::wstring_view(name)!=L"MoxxyComputerControlPanel" && IsWindowVisible(hwnd) && (GetWindowTextLengthW(hwnd) > 0 || std::wstring_view(name) == L"#32768"))
      reinterpret_cast<std::vector<HWND>*>(ptr)->push_back(hwnd);
    return reinterpret_cast<std::vector<HWND>*>(ptr)->size() < 256;
  }, reinterpret_cast<LPARAM>(&handles));
  std::set<std::wstring> live;
  JsonArray result;
  for (auto hwnd : handles) {
    try {
      DWORD pid; GetWindowThreadProcessId(hwnd, &pid);
      if (pid == GetCurrentProcessId()) continue;
      com_ptr<IUIAutomationElement> root;
      check_hresult(automation->ElementFromHandle(hwnd, root.put()));
      auto created = creation_time(pid);
      bool minimized=IsIconic(hwnd)!=FALSE;
      wchar_t title[2049]{}; GetWindowTextW(hwnd, title, 2049);
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
      live.insert(id);
      Json entry; entry.Insert(L"windowId", string_value(id)); entry.Insert(L"pid", numeric(pid));
      entry.Insert(L"title", string_value(title));
      entry.Insert(L"bounds",minimized ? Windows::Data::Json::IJsonValue(JsonValue::CreateNullValue()) : rect_json(window_bounds(hwnd)));
      entry.Insert(L"state",string_value(minimized ? L"minimized" : L"normal"));
      auto owner=GetWindow(hwnd,GW_OWNER);
      entry.Insert(L"kind",string_value(std::wstring_view(name)==L"#32768" ? L"menu" : owner && !IsWindowEnabled(owner) ? L"modal" : L"normal"));
      entry.Insert(L"className", string_value(name));
      result.Append(entry);
    } catch (...) { /* Inaccessible/elevated/closing windows are not actionable targets. */ }
  }
  std::erase_if(windows, [&](const auto& item) { return !live.contains(item.first); });
  if (!windows.contains(observed_window)) { elements.clear(); observation_id.clear(); }
  if (!windows.contains(captured_window)) capture_id.clear();
  return result;
}
Json Desktop::observe(const Json& params, Window& window) {
  const auto limit = number(params, L"maxNodes", 1, 256);
  auto root=window.root;
  if (params.HasKey(L"root")) {
    auto reference=params.GetNamedObject(L"root"); fields(reference,{L"observationId",L"elementId"});
    reference.Insert(L"windowId",params.GetNamedValue(L"windowId"));
    root=element(reference,window,false).node;
  }
  std::wstring name_filter;
  std::optional<int> type_filter;
  if (params.HasKey(L"filter")) {
    auto filter=params.GetNamedObject(L"filter"); fields(filter,{L"nameIncludes",L"controlType"});
    if (filter.HasKey(L"nameIncludes")) name_filter=text(filter,L"nameIncludes",256);
    if (filter.HasKey(L"controlType")) type_filter=number(filter,L"controlType",50000,60000);
    std::transform(name_filter.begin(),name_filter.end(),name_filter.begin(),[](wchar_t c){return static_cast<wchar_t>(towlower(c));});
  }
  elements.clear(); observation_id = identifier(); observed_window = text(params, L"windowId");
  observed_bounds = window_bounds(window.hwnd); observed_epoch = focus_epoch.load();
  JsonArray output;
  bool truncated = false;
  unsigned visited=0;
  std::wstring focused_id;
  com_ptr<IUIAutomationElement> focused;
  automation->GetFocusedElement(focused.put());
  observed_focus = focused;
  com_ptr<IUIAutomationTreeWalker> walker;
  check_hresult(automation->get_ControlViewWalker(walker.put()));
  std::function<void(com_ptr<IUIAutomationElement>, std::wstring, int)> walk;
  walk = [&](com_ptr<IUIAutomationElement> node, std::wstring parent, int depth) {
    if (!node) return;
    if (output.Size() >= static_cast<unsigned>(limit) || depth > 24 || visited>=1024) { truncated = true; return; }
    ++visited;
    auto rect = element_bounds(node.get());
    auto id = identifier();
    bool secret = protected_element(node.get());
    BOOL enabled = FALSE; check_hresult(node->get_CurrentIsEnabled(&enabled));
    CONTROLTYPEID control; check_hresult(node->get_CurrentControlType(&control));
    BSTR name = nullptr;
    std::wstring label;
    if (!secret && SUCCEEDED(node->get_CurrentName(&name)) && name) {
      label.assign(name, std::min<size_t>(SysStringLen(name), 512)); SysFreeString(name);
    }
    auto normalized=label;
    std::transform(normalized.begin(),normalized.end(),normalized.begin(),[](wchar_t c){return static_cast<wchar_t>(towlower(c));});
    bool matches=(!type_filter || control==*type_filter) && (name_filter.empty() || normalized.find(name_filter)!=std::wstring::npos);
    if (matches && rect.width > 0 && rect.height > 0) {
      auto value=secret ? std::nullopt : element_value(node.get());
      auto accessibility=secret ? AccessibilityState{} : accessibility_state(node.get());
      elements.emplace(id, Element{node, rect, value, accessibility});
      Json entry; entry.Insert(L"elementId", string_value(id));
      entry.Insert(L"parentId", parent.empty() ? JsonValue::CreateNullValue() : string_value(parent));
      entry.Insert(L"name", string_value(label)); entry.Insert(L"controlType", numeric(control));
      entry.Insert(L"bounds", rect_json(rect)); entry.Insert(L"enabled", boolean(enabled)); entry.Insert(L"protected", boolean(secret));
      entry.Insert(L"actions",accessibility_actions(accessibility)); entry.Insert(L"controlState",accessibility_properties(accessibility));
      if (value) {
        auto length=std::min<size_t>(512,value->text.size());
        if (length && value->text[length-1]>=0xD800 && value->text[length-1]<=0xDBFF) --length;
        entry.Insert(L"value",string_value(std::wstring_view(value->text).substr(0,length)));
      }
      output.Append(entry);
      BOOL same = FALSE;
      if (focused && SUCCEEDED(automation->CompareElements(node.get(), focused.get(), &same)) && same) focused_id = id;
      parent = id;
    }
    if (secret) return;
    com_ptr<IUIAutomationElement> child;
    check_hresult(walker->GetFirstChildElement(node.get(), child.put()));
    while (child) {
      if (output.Size() >= static_cast<unsigned>(limit) || visited>=1024) { truncated = true; break; }
      walk(child, parent, depth + 1);
      com_ptr<IUIAutomationElement> next;
      check_hresult(walker->GetNextSiblingElement(child.get(), next.put())); child = std::move(next);
    }
  };
  walk(root, L"", 0);
  require(observed_bounds == window_bounds(window.hwnd),
    "stale-observation", "Window changed while observing; observe again");
  Json result; result.Insert(L"windowId", string_value(observed_window)); result.Insert(L"observationId", string_value(observation_id));
  result.Insert(L"bounds", rect_json(observed_bounds)); result.Insert(L"elements", output);
  result.Insert(L"focusedElementId", focused_id.empty() ? JsonValue::CreateNullValue() : string_value(focused_id));
  result.Insert(L"truncated", boolean(truncated)); return result;
}
void Desktop::fresh_observation(const Json& params, Window& window, bool needs_focus) {
  require(text(params, L"windowId") == observed_window && text(params, L"observationId") == observation_id &&
    !observation_id.empty(),
    "unknown-observation", "Reference is not the latest observation for this window. Call computer_observe with windowId and omit root (or set root:null); use only IDs returned by that call. Do not change focus to repair an unknown ID");
  require(observed_bounds == window_bounds(window.hwnd),
    "stale-observation", "Window geometry changed. Call computer_observe again without root before acting");
  if (!needs_focus) return;
  check_focus(window.hwnd);
  require(observed_epoch == focus_epoch.load(), "focus-changed", "Focus changed; observe again");
  com_ptr<IUIAutomationElement> focused;
  check_hresult(automation->GetFocusedElement(focused.put()));
  BOOL same = FALSE;
  require(observed_focus && focused, "focus-changed", "Focused control is unavailable; observe again");
  check_hresult(automation->CompareElements(observed_focus.get(), focused.get(), &same));
  require(same, "focus-changed", "Focused control changed; observe again");
}
Element& Desktop::element(const Json& params, Window& window, bool needs_focus) {
  fresh_observation(params, window, needs_focus);
  auto found = elements.find(text(params, L"elementId"));
  require(found != elements.end(), "stale-element", "Element reference is not in the current observation");
  auto& element = found->second;
  require(element.bounds == element_bounds(element.node.get()), "stale-element", "Element moved; observe again");
  BOOL enabled = FALSE; check_hresult(element.node->get_CurrentIsEnabled(&enabled));
  require(enabled && !protected_element(element.node.get()), "protected-element", "Element disabled or protected");
  require(element.value==element_value(element.node.get()),"stale-element","Control value or editability changed; observe again before acting");
  require(element.accessibility==accessibility_state(element.node.get()),"stale-element","Control selection, toggle, expansion or supported actions changed; observe again");
  return element;
}
Point Desktop::point(const Json& params, const Json& coordinates, Window& window) {
  check_focus(window.hwnd);
  require(text(params, L"captureId") == capture_id && !capture_id.empty() && text(params, L"windowId") == captured_window &&
    captured_window_bounds == window_bounds(window.hwnd) && captured_epoch == focus_epoch.load(),
    "stale-capture", "Capture window again after geometry or focus changes");
  return image_point(number(coordinates, L"x", 0, 3840), number(coordinates, L"y", 0, 3840),
    captured_width, captured_height, captured_bounds);
}
Json Desktop::open(const Json& params) {
  auto app_id=text(params,L"appId");
  const auto& app=catalog.get(app_id);
  auto mode=text(params,L"instance"); require(mode==L"new" || mode==L"reuse","invalid-input","Unknown instance mode");
  auto timeout=number(params,L"timeoutMs",500,8000);
  acquire(); wait_for_access(nullptr,false);
  std::set<std::wstring> before;
  JsonArray existing;
  for (const auto& item:list_windows()) {
    auto row=item.GetObject(); before.insert(text(row,L"windowId"));
    if (catalog.matches(app,static_cast<DWORD>(row.GetNamedNumber(L"pid")))) existing.Append(row);
  }
  auto result=[&](const wchar_t* status,bool launched,const JsonArray& windows) {
    Json value; value.Insert(L"appId",string_value(app_id)); value.Insert(L"status",string_value(status));
    value.Insert(L"launched",boolean(launched)); value.Insert(L"windows",windows); return value;
  };
  if (mode==L"reuse" && existing.Size()) return result(existing.Size()==1 ? L"existing" : L"ambiguous",false,existing);
  Handle launched(catalog.launch(app));
  DWORD launched_pid=launched.value ? GetProcessId(launched.value) : 0;
  auto until=GetTickCount64()+timeout;
  JsonArray candidates;
  do {
    check_active_desktop();
    candidates.Clear();
    for (const auto& item:list_windows()) {
      auto row=item.GetObject(); auto id=text(row,L"windowId");
      if (mode==L"new" && before.contains(id)) continue;
      auto pid=static_cast<DWORD>(row.GetNamedNumber(L"pid"));
      bool launch_alive=launched.value && WaitForSingleObject(launched.value,0)==WAIT_TIMEOUT;
      if ((launch_alive && launched_pid==pid) || catalog.matches(app,pid)) candidates.Append(row);
    }
    if (candidates.Size()) return result(candidates.Size()==1 ? L"opened" : L"ambiguous",true,candidates);
    require(WaitForSingleObject(stop_event,100)==WAIT_TIMEOUT,"cancelled","Application wait cancelled");
  } while (GetTickCount64()<until);
  return result(L"no_window",true,candidates);
}
Windows::Data::Json::IJsonValue Desktop::execute(const std::wstring& method, const Json& params) {
  if (method == L"status") {
    fields(params, {});
    Json result; result.Insert(L"platform", string_value(L"win32")); result.Insert(L"architecture", string_value(L"x64"));
    result.Insert(L"protocolVersion", numeric(protocol_version));
    bool active = true; try { check_active_desktop(); } catch (...) { active = false; }
    result.Insert(L"ready", boolean(active));
    JsonArray limits; limits.Append(string_value(L"No UAC, secure desktop, elevated apps or Windows ARM64"));
    limits.Append(string_value(L"Observe after every action; input delivery is not task success"));
    result.Insert(L"limitations", limits); return result;
  }
  if (method == L"windows" || method == L"apps") { fields(params, {}); check_active_desktop(); return list_windows(); }
  if (method == L"maintenance") {
    fields(params,{}); acquire();
    // Installer maintenance owns the lease, not interactive computer input.
    // Its explicit update dialog controls cancellation; hide the input panel.
    lease_active=false; publish_guard_state(ControlState::idle);
    Json result; result.Insert(L"maintenanceReady",boolean(true)); return result;
  }
  if (method == L"app_catalog") { fields(params,{L"query",L"maxResults"}); check_active_desktop(); return catalog.list(params); }
  if (method == L"open") { fields(params,{L"appId",L"instance",L"timeoutMs"}); return open(params); }
  if (method == L"action_status") {
    fields(params,{L"actionId",L"waitMs"});
    return actions.status(text(params,L"actionId"),number(params,L"waitMs",0,1000));
  }
  // Validate shape before acquiring a lease or executing any native operation.
  if (method == L"focus" || method == L"restore") fields(params, {L"windowId"});
  else if (method == L"observe") fields(params, {L"windowId", L"maxNodes", L"root", L"filter"});
  else if (method == L"screenshot") fields(params, {L"windowId", L"maxDim", L"format", L"quality", L"allowVisibleFallback", L"region"});
  else if (method == L"click") fields(params, {L"windowId", L"captureId", L"x", L"y", L"observationId", L"elementId", L"button", L"count"});
  else if (method == L"type" || method == L"set_value") fields(params, {L"windowId", L"observationId", L"elementId", L"text"});
  else if (method == L"type_window") fields(params,{L"windowId",L"observationId",L"text"});
  else if (method == L"read_text") fields(params, {L"windowId", L"observationId", L"elementId", L"maxChars"});
  else if (method == L"select_text") fields(params, {L"windowId", L"observationId", L"elementId", L"text", L"occurrence"});
  else if (method == L"action") fields(params,{L"windowId",L"observationId",L"elementId",L"action"});
  else if (method == L"key") fields(params, {L"windowId", L"observationId", L"key", L"modifiers"});
  else if (method == L"scroll") fields(params, {L"windowId", L"captureId", L"x", L"y", L"deltaX", L"deltaY"});
  else if (method == L"drag") fields(params, {L"windowId", L"captureId", L"from", L"to", L"durationMs"});
  else if (method == L"clipboard") fields(params, {L"windowId", L"action", L"text"});
  else throw Error("unsupported", "Unknown Computer Use operation");
  auto& window = target(params,method==L"restore");
  wait_for_access(window.hwnd,false);
  if (method == L"restore") {
    if (IsIconic(window.hwnd)) {
      input_may_have_run=true;
      require(ShowWindowAsync(window.hwnd,SW_RESTORE),"restore-denied","Window restore could not be requested");
      auto deadline=GetTickCount64()+2000;
      while (IsIconic(window.hwnd) && GetTickCount64()<deadline) {
        require(WaitForSingleObject(stop_event,50)==WAIT_TIMEOUT,"cancelled","Restore cancelled");
        target(params,true);
      }
      require(!IsIconic(window.hwnd),"uncertain-result","Restore not confirmed; list windows again before continuing");
    }
  } else if (method == L"focus") {
    if (!has_target_focus(window.hwnd)) SetForegroundWindow(window.hwnd);
    // Explicit focus requests may use the target's accessibility implementation.
    // Do this once, never from the background/read path or the waiting loop.
    if (!has_target_focus(window.hwnd)) {
      input_may_have_run=true;
      window.root->SetFocus();
      target(params);
    }
    check_focus(window.hwnd); observation_id.clear(); capture_id.clear();
  } else if (method == L"observe") return observe(params, window);
  else if (method == L"screenshot") {
    auto format = text(params, L"format");
    require(format == L"png" || format == L"jpeg", "invalid-input", "Unsupported image format");
    auto epoch = focus_epoch.load();
    auto bounds_before = window_bounds(window.hwnd);
    std::optional<Rect> crop;
    if (params.HasKey(L"region")) {
      auto region=params.GetNamedObject(L"region"); fields(region,{L"x",L"y",L"width",L"height"});
      crop=Rect{number(region,L"x",0,32768),number(region,L"y",0,32768),number(region,L"width",1,32768),number(region,L"height",1,32768)};
    }
    auto capture = capture_window(window.hwnd, number(params, L"maxDim", 256, 3840), format == L"jpeg",
      number(params, L"quality", 40, 100), params.GetNamedBoolean(L"allowVisibleFallback"), crop);
    require(bounds_before == window_bounds(window.hwnd), "stale-capture", "Window changed during capture");
    captured_window_bounds = bounds_before;
    captured_bounds = capture.source; captured_width = capture.width; captured_height = capture.height;
    capture_id = identifier(); captured_window = text(params, L"windowId"); captured_epoch = epoch;
    Json result; result.Insert(L"windowId", string_value(captured_window)); result.Insert(L"captureId", string_value(capture_id));
    result.Insert(L"source", rect_json(capture.source)); result.Insert(L"width", numeric(capture.width)); result.Insert(L"height", numeric(capture.height));
    result.Insert(L"mediaType", string_value(capture.media_type)); result.Insert(L"base64", string_value(to_hstring(capture.base64)));
    result.Insert(L"mode", string_value(capture.fallback ? L"visible-desktop" : L"window")); return result;
  } else if (method == L"click") {
    auto button = text(params, L"button"); auto count = number(params, L"count", 1, 3);
    require(button == L"left" || button == L"right" || button == L"middle", "invalid-input", "Unknown mouse button");
    if (params.HasKey(L"elementId")) {
      require(!params.HasKey(L"captureId") && !params.HasKey(L"x") && !params.HasKey(L"y"), "invalid-input", "Ambiguous click target");
      auto& value = element(params, window);
      // Some InvokePattern providers block until a modal closes. A verified
      // physical click keeps the protocol available to observe that modal.
      click_point(window.hwnd, {value.bounds.x+value.bounds.width/2, value.bounds.y+value.bounds.height/2}, button, count);
    } else {
      require(!params.HasKey(L"observationId"), "invalid-input", "Ambiguous click reference");
      click_point(window.hwnd, point(params, params, window), button, count);
    }
  } else if (method == L"type" || method == L"set_value") {
    auto value = text(params, L"text", 4000);
    auto& control = element(params, window, method != L"set_value");
    if (method == L"set_value") {
      com_ptr<IUIAutomationValuePattern> pattern;
      check_hresult(control.node->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(pattern.put())));
      BOOL readonly = TRUE; check_hresult(pattern->get_CurrentIsReadOnly(&readonly));
      require(!readonly, "read-only", "Control is read-only");
      if (!has_target_focus(window.hwnd)) {
        // The system UIA EDIT proxy may focus the application during SetValue.
        // WM_SETTEXT targets a standard EDIT directly without using global input.
        UIA_HWND native = nullptr; check_hresult(control.node->get_CurrentNativeWindowHandle(&native));
        auto hwnd = reinterpret_cast<HWND>(native);
        wchar_t klass[256]{}; GetClassNameW(hwnd,klass,256);
        DWORD pid = 0; GetWindowThreadProcessId(hwnd,&pid);
        require(std::wstring_view(klass)==L"Edit" || std::wstring_view(klass)==L"EDIT", "foreground-required", "This control has no verified background value operation");
        require(pid==window.pid && GetAncestor(hwnd,GA_ROOT)==window.hwnd, "stale-element", "Native edit no longer belongs to target");
        auto style=GetWindowLongPtrW(hwnd,GWL_STYLE);
        require(IsWindowEnabled(hwnd) && !(style & (ES_READONLY|ES_PASSWORD)), "protected-element", "Edit is read-only or protected");
        DWORD_PTR result = 0;
        input_may_have_run=true;
        require(SendMessageTimeoutW(hwnd,WM_SETTEXT,0,reinterpret_cast<LPARAM>(value.c_str()),SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&result)!=0,
          "uncertain-result", "Background value request timed out; observe before any further action");
        require(result!=0, "value-rejected", "The edit rejected the new value");
        observation_id.clear(); capture_id.clear();
        Json delivered; delivered.Insert(L"delivered",boolean(true)); delivered.Insert(L"verificationRequired",boolean(true)); return delivered;
      }
      BSTR argument = SysAllocStringLen(value.data(), static_cast<UINT>(value.size()));
      require(argument != nullptr, "native-error", "Cannot allocate control value");
      input_may_have_run=true;
      auto result = pattern->SetValue(argument); SysFreeString(argument); check_hresult(result);
    } else {
      com_ptr<IUIAutomationElement> focused; check_hresult(automation->GetFocusedElement(focused.put()));
      BOOL same = FALSE; check_hresult(automation->CompareElements(focused.get(), control.node.get(), &same));
      require(same, "focus-changed", "Target control is not focused; click and observe it first");
      type_text(window.hwnd, value, [&] { fresh_observation(params, window); });
    }
  } else if (method == L"type_window") {
    auto value=text(params,L"text",4000);
    auto validate=[&] {
      fresh_observation(params,window);
      require(observed_focus && !protected_element(observed_focus.get()),"protected-element","Focused control is protected or cannot be identified");
    };
    validate();
    type_text(window.hwnd,value,validate);
  } else if (method == L"action") {
    auto name=text(params,L"action");
    auto& control=element(params,window);
    input_may_have_run=true;
    auto receipt=actions.start(control.node,window.hwnd,control.accessibility,name);
    observation_id.clear(); capture_id.clear(); return receipt;
  } else if (method == L"read_text") {
    auto limit=number(params,L"maxChars",1,16000);
    auto& control=element(params,window,false);
    return read_control_text(control.node.get(),window.hwnd,limit);
  } else if (method == L"select_text") {
    auto query=text(params,L"text",4000); require(!query.empty(),"invalid-input","Selection text must not be empty");
    auto occurrence=number(params,L"occurrence",1,100);
    auto& control=element(params,window);
    require(control.value.has_value(),"unsupported","This text control has no verifiable value snapshot; selection was not performed");
    select_control_text(control.node.get(),window.hwnd,query,occurrence);
  } else if (method == L"key") { fresh_observation(params, window); key_press(window.hwnd, params); }
  else if (method == L"scroll") scroll_at(window.hwnd, point(params, params, window), number(params, L"deltaX", -1200, 1200), number(params, L"deltaY", -1200, 1200));
  else if (method == L"drag") {
    auto from = params.GetNamedObject(L"from"), to = params.GetNamedObject(L"to");
    fields(from, {L"x", L"y"}); fields(to, {L"x", L"y"});
    drag_to(window.hwnd, point(params, from, window), point(params, to, window), number(params, L"durationMs", 100, 2000));
  } else if (method == L"clipboard") { check_focus(window.hwnd); return clipboard(params); }
  observation_id.clear(); capture_id.clear();
  Json result; result.Insert(L"delivered", boolean(true)); result.Insert(L"verificationRequired", boolean(true)); return result;
}
}
