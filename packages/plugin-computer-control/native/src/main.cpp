#include "desktop.hpp"
#include "input-guard.hpp"
#include <iostream>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <unordered_map>
#include <io.h>
#include <fcntl.h>

namespace moxxy {
std::atomic<uint64_t> focus_epoch{0};
HANDLE stop_event = nullptr;
std::atomic<bool> lease_active{false};
std::atomic<DWORD> stop_exit_code{2};
std::atomic<HWND> control_window{nullptr};
std::mutex identity_mutex;
std::unordered_map<HWND,uint64_t> identity_generations;
uint64_t next_generation = 1;
uint64_t window_generation(HWND window) {
  std::lock_guard guard(identity_mutex);
  if (auto found=identity_generations.find(window); found!=identity_generations.end()) return found->second;
  if (identity_generations.size() >= 4096) identity_generations.clear();
  auto generation=next_generation++; identity_generations.emplace(window,generation); return generation;
}
}
namespace {
void CALLBACK window_destroyed(HWINEVENTHOOK, DWORD, HWND hwnd, LONG object, LONG child, DWORD, DWORD) {
  if (object != OBJID_WINDOW || child != CHILDID_SELF) return;
  std::lock_guard guard(moxxy::identity_mutex);
  if (auto found=moxxy::identity_generations.find(hwnd); found!=moxxy::identity_generations.end()) found->second=moxxy::next_generation++;
}
void CALLBACK focus_changed(HWINEVENTHOOK, DWORD, HWND window, LONG, LONG, DWORD, DWORD) {
  ++moxxy::focus_epoch;
  moxxy::approval_focus_changed(window);
}
LRESULT CALLBACK indicator_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  return DefWindowProcW(hwnd,message,wparam,lparam);
}
}

int main(int argc, char** argv) {
  using namespace moxxy;
  if (argc>1 && std::string(argv[1])=="--input-guard") return run_input_guard(argc,argv);
  try {
    require(argc == 3 && std::string(argv[1]) == "--parent", "invalid-input", "Parent PID required");
    size_t consumed = 0;
    auto parent_pid = std::stoul(argv[2], &consumed);
    require(consumed == strlen(argv[2]) && parent_pid > 0 && parent_pid <= MAXDWORD, "invalid-input", "Invalid parent PID");
    Handle parent(OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(parent_pid)));
    require(parent.value != nullptr, "parent-unavailable", "Cannot monitor parent process");
    Handle stop(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    require(stop.value != nullptr, "native-error", "Cannot create cancellation event");
    stop_event = stop.value;
    // EOF, parent death, or a blocked UIA call all terminate the lease holder.
    std::thread([&] {
      HANDLE handles[] = {parent.value, stop.value};
      for (;;) {
        DWORD result = WaitForMultipleObjects(2, handles, FALSE, 50);
        auto until = operation_deadline.load();
        if (result != WAIT_TIMEOUT || (until && GetTickCount64() > until)) {
          SetEvent(stop.value); release_input(); ExitProcess(guard_stopped_by_user() ? 20 : stop_exit_code.load());
        }
      }
    }).detach();
    std::mutex mutex;
    std::condition_variable ready;
    std::deque<std::string> frames;
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    std::thread([&] {
      init_apartment(apartment_type::multi_threaded);
      std::string line;
      char c;
      while (std::cin.get(c)) {
        if (c == '\n') {
          try {
            auto command=Json::Parse(to_hstring(line));
            if (command.HasKey(L"control")) {
              fields(command,{L"version",L"control"});
              number(command,L"version",protocol_version,protocol_version);
              auto action=text(command,L"control");
              if (action==L"pause") guard_control(ControlCommand::pause);
              else if (action==L"resume") guard_control(ControlCommand::resume);
              else if (action==L"stop") guard_control(ControlCommand::stop);
              else throw Error("invalid-input","Unknown control command");
              line.clear(); continue;
            }
          } catch (...) { SetEvent(stop.value); return; }
          std::lock_guard guard(mutex);
          if (frames.size() >= 8) break;
          frames.push_back(std::move(line)); line.clear(); ready.notify_one();
        } else {
          line.push_back(c);
          if (line.size() > frame_limit) break;
        }
      }
      SetEvent(stop.value);
    }).detach();
    Handle hooks_ready(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    std::thread([&] {
      WNDCLASSW klass{}; klass.lpfnWndProc=indicator_proc; klass.hInstance=GetModuleHandleW(nullptr);
      klass.lpszClassName=L"MoxxyComputerControlIndicator"; RegisterClassW(&klass);
      // Clipboard ownership and focus hooks stay in the worker; visible controls
      // live in the independent guardian, not this message-only window.
      auto indicator=CreateWindowExW(0,klass.lpszClassName,L"Moxxy clipboard owner",0,0,0,0,0,
        HWND_MESSAGE,nullptr,klass.hInstance,nullptr);
      if (!indicator) { SetEvent(stop.value); return; }
      control_window = indicator;
      auto hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr,
        focus_changed, 0, 0, WINEVENT_OUTOFCONTEXT);
      if (!hook) { SetEvent(stop.value); return; }
      auto destroy_hook=SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY, nullptr, window_destroyed, 0, 0, WINEVENT_OUTOFCONTEXT);
      if (!destroy_hook) { SetEvent(stop.value); return; }
      SetEvent(hooks_ready.value);
      MSG message;
      while (GetMessageW(&message, nullptr, 0, 0) > 0) DispatchMessageW(&message);
      UnhookWinEvent(hook);
      UnhookWinEvent(destroy_hook);
    }).detach();
    require(WaitForSingleObject(hooks_ready.value, 2000) == WAIT_OBJECT_0, "native-error", "Focus monitor unavailable");
    start_input_guard(parent.value,stop.value);
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    init_apartment(apartment_type::multi_threaded);
    Desktop desktop;
    for (;;) {
      std::string line;
      { std::unique_lock lock(mutex); ready.wait(lock, [&] { return !frames.empty(); });
        line = std::move(frames.front()); frames.pop_front(); }
      operation_deadline = GetTickCount64() + 12000;
      input_may_have_run=false;
      Json response; response.Insert(L"version", numeric(protocol_version));
      std::wstring id = L"invalid";
      try {
        Json request = Json::Parse(to_hstring(line));
        fields(request, {L"version", L"id", L"method", L"params"});
        id = text(request, L"id"); require(!id.empty(), "invalid-input", "Missing request ID");
        request_id=id;
        require(number(request, L"version", protocol_version, protocol_version) == protocol_version, "protocol-mismatch", "Update Computer Use extension");
        auto result = desktop.execute(text(request, L"method"), request.GetNamedObject(L"params"));
        response.Insert(L"ok", moxxy::boolean(true)); response.Insert(L"result", result);
      } catch (const Error& error) {
        if (error.code == "needs-observation") {
          Json result; result.Insert(L"status",string_value(L"needs_observation"));
          result.Insert(L"delivered",moxxy::boolean(false)); result.Insert(L"verificationRequired",moxxy::boolean(true));
          result.Insert(L"effect",string_value(input_may_have_run ? L"possible" : L"none"));
          response.Insert(L"ok",moxxy::boolean(true)); response.Insert(L"result",result);
        } else {
        Json detail; detail.Insert(L"code", string_value(to_hstring(error.code)));
        detail.Insert(L"message", string_value(to_hstring(error.what())));
        response.Insert(L"ok", moxxy::boolean(false)); response.Insert(L"error", detail);
        }
      } catch (...) {
        Json detail; detail.Insert(L"code", string_value(L"native-error"));
        detail.Insert(L"message", string_value(L"Native operation failed or target became unavailable; observe again."));
        response.Insert(L"ok", moxxy::boolean(false)); response.Insert(L"error", detail);
      }
      response.Insert(L"id", string_value(id));
      auto wire = to_string(response.Stringify());
      require(wire.size() <= frame_limit, "output-limit", "Response exceeds protocol limit");
      std::cout << wire << '\n' << std::flush;
      operation_deadline = 0;
      publish_guard_state(ControlState::idle);
    }
  } catch (...) { return 1; }
}
