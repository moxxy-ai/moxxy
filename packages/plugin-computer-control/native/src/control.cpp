#include "common.hpp"
#include "input-guard.hpp"
#include "approval-focus.hpp"
#include <iostream>
#include <mutex>

namespace moxxy {
std::atomic<ULONGLONG> operation_deadline{0};
std::atomic<bool> input_may_have_run{false};
std::atomic<ControlState> control_state{ControlState::idle};
std::wstring request_id;

namespace {
std::mutex approval_mutex;
ApprovalFocus approval_state;
HWND approval_window=nullptr;
Rect approval_bounds{};
uint64_t approval_generation=0;
DWORD approval_host=0;
std::wstring approval_call;
}

void approval_focus_changed(HWND window) {
  DWORD pid=0; GetWindowThreadProcessId(window,&pid);
  std::lock_guard lock(approval_mutex);
  approval_state.changed(reinterpret_cast<uintptr_t>(window),pid);
}

bool approval_focus(HWND window, const Json& params) {
  check_active_desktop();
  auto foreground=GetForegroundWindow();
  DWORD pid=0; GetWindowThreadProcessId(foreground,&pid);
  const auto stage=text(params,L"stage");
  const auto call=text(params,L"callId");
  const auto host=static_cast<DWORD>(number(params,L"hostPid",1,2147483647));
  const bool approved=params.GetNamedBoolean(L"approved");
  std::lock_guard lock(approval_mutex);
  if (stage==L"begin") {
    require(!approved,"invalid-input","An approval must begin undecided");
    approval_window=window; approval_bounds=window_bounds(window);
    approval_generation=window_generation(window); approval_call=call; approval_host=host;
    approval_state.begin(reinterpret_cast<uintptr_t>(window),host,reinterpret_cast<uintptr_t>(foreground));
    return false;
  }
  require(stage==L"finish" && call==approval_call && window==approval_window && host==approval_host,
    "invalid-input","Approval focus identity mismatch");
  const bool unchanged=IsWindowEnabled(window) && !IsIconic(window) &&
    window_generation(window)==approval_generation && window_bounds(window)==approval_bounds &&
    !guard_paused() && !guard_stopped_by_user();
  const bool restore=approval_state.finish(reinterpret_cast<uintptr_t>(foreground),pid,approved,unchanged);
  approval_call.clear();
  if (!restore) return false;
  if (GetForegroundWindow()!=foreground) return false;
  // A single OS-governed activation, never keyboard tricks or attaching input
  // queues (which resets the user's key state). Windows may still refuse it.
  return foreground==window || SetForegroundWindow(window)!=FALSE;
}

HWND blocking_window(HWND window) {
  if (!window || IsWindowEnabled(window)) return nullptr;
  struct Search { HWND owner, result=nullptr; DWORD pid=0; unsigned depth=0; } search{window};
  GetWindowThreadProcessId(window,&search.pid);
  EnumWindows([](HWND candidate, LPARAM data) -> BOOL {
    auto& search=*reinterpret_cast<Search*>(data);
    DWORD pid=0; GetWindowThreadProcessId(candidate,&pid);
    if (pid!=search.pid || !IsWindowVisible(candidate) || IsIconic(candidate)) return TRUE;
    auto owner=GetWindow(candidate,GW_OWNER);
    for (unsigned depth=1;owner && depth<=32;++depth,owner=GetWindow(owner,GW_OWNER)) {
      if (owner!=search.owner) continue;
      if (depth>search.depth) { search.result=candidate; search.depth=depth; }
      break;
    }
    return TRUE;
  },reinterpret_cast<LPARAM>(&search));
  return search.result;
}

void emit_control_state(ControlState state) {
  control_state = state;
  publish_guard_state(state);
  static constexpr const wchar_t* names[] = {L"idle",L"background",L"foreground",L"waiting_for_focus",L"paused_by_user",L"recovering",L"stopped",L"failed"};
  Json event; event.Insert(L"version",numeric(protocol_version)); event.Insert(L"id",string_value(request_id));
  event.Insert(L"event",string_value(L"control_state")); event.Insert(L"state",string_value(names[static_cast<int>(state)]));
  std::cout << to_string(event.Stringify()) << '\n' << std::flush;
}

void wait_for_access(HWND window, bool needs_focus) {
  check_active_desktop();
  if (needs_focus && window && !IsWindowEnabled(window))
    throw Error("needs-observation","Target is disabled; observe it to discover its blocking dialog");
  if (!guard_paused() && (!needs_focus || has_target_focus(window))) return;
  // Never hold an injected key/button during an unbounded human wait.
  release_input();
  auto until=operation_deadline.exchange(0);
  auto now=GetTickCount64();
  struct Budget {
    ULONGLONG remaining;
    ~Budget() { operation_deadline=GetTickCount64()+remaining; }
  } budget{until > now ? until-now : 1};
  DWORD pid=0; auto thread=GetWindowThreadProcessId(window,&pid);
  auto generation=window_generation(window);
  ControlState previous=ControlState::idle;
  for (;;) {
    check_active_desktop();
    DWORD current_pid=0;
    require(!window || (IsWindow(window) && GetWindowThreadProcessId(window,&current_pid)==thread && current_pid==pid && window_generation(window)==generation),
      "stale-window", "Target disappeared while waiting; list windows again");
    if (needs_focus && window && !IsWindowEnabled(window))
      throw Error("needs-observation","Target became disabled by a dialog while waiting; observe again");
    // Resume is an explicit user action, never an automatic focus-stealing loop.
    if (take_guard_resume()) {
      if (needs_focus && !has_target_focus(window)) SetForegroundWindow(window);
    }
    if (!guard_paused() && (!needs_focus || has_target_focus(window))) break;
    auto state=guard_paused() ? ControlState::paused_by_user : ControlState::waiting_for_focus;
    if (state != previous) { emit_control_state(state); previous=state; }
    require(WaitForSingleObject(stop_event,50)==WAIT_TIMEOUT,"cancelled","Computer Use stopped");
  }
  emit_control_state(needs_focus ? ControlState::foreground : ControlState::background);
  // Even a zero-input interruption invalidates the assumptions of this request.
  throw Error("needs-observation","Control resumed; observe the target before choosing the next action");
}
}
