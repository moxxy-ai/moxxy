#include "desktop.hpp"
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
void CALLBACK focus_changed(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD) {
  ++moxxy::focus_epoch;
}
LRESULT CALLBACK indicator_proc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_CREATE) {
    CreateWindowW(L"BUTTON", L"Stop Computer Use", WS_CHILD|WS_VISIBLE, 10, 8, 230, 32, hwnd,
      reinterpret_cast<HMENU>(1), GetModuleHandleW(nullptr), nullptr);
    SetTimer(hwnd, 1, 100, nullptr); return 0;
  }
  if (message == WM_TIMER) { ShowWindow(hwnd, moxxy::lease_active ? SW_SHOWNOACTIVATE : SW_HIDE); return 0; }
  if (message == WM_CLOSE || (message == WM_COMMAND && LOWORD(wparam) == 1)) {
    moxxy::stop_exit_code = 20; SetEvent(moxxy::stop_event); return 0;
  }
  return DefWindowProcW(hwnd,message,wparam,lparam);
}
}

int main(int argc, char** argv) {
  using namespace moxxy;
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
    std::atomic<ULONGLONG> deadline{0};
    // EOF, parent death, or a blocked UIA call all terminate the lease holder.
    std::thread([&] {
      HANDLE handles[] = {parent.value, stop.value};
      for (;;) {
        DWORD result = WaitForMultipleObjects(2, handles, FALSE, 50);
        auto until = deadline.load();
        if (result != WAIT_TIMEOUT || (until && GetTickCount64() > until)) {
          SetEvent(stop.value); release_input(); ExitProcess(stop_exit_code.load());
        }
      }
    }).detach();
    std::mutex mutex;
    std::condition_variable ready;
    std::deque<std::string> frames;
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    std::thread([&] {
      std::string line;
      char c;
      while (std::cin.get(c)) {
        if (c == '\n') {
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
      auto indicator=CreateWindowExW(WS_EX_TOPMOST|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW,klass.lpszClassName,
        L"Moxxy controls your computer",WS_CAPTION|WS_SYSMENU,GetSystemMetrics(SM_CXSCREEN)-290,10,270,90,
        nullptr,nullptr,klass.hInstance,nullptr);
      if (!indicator) { SetEvent(stop.value); return; }
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
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    init_apartment(apartment_type::multi_threaded);
    Desktop desktop;
    for (;;) {
      std::string line;
      { std::unique_lock lock(mutex); ready.wait(lock, [&] { return !frames.empty(); });
        line = std::move(frames.front()); frames.pop_front(); }
      deadline = GetTickCount64() + 12000;
      Json response; response.Insert(L"version", numeric(protocol_version));
      std::wstring id = L"invalid";
      try {
        Json request = Json::Parse(to_hstring(line));
        fields(request, {L"version", L"id", L"method", L"params"});
        id = text(request, L"id"); require(!id.empty(), "invalid-input", "Missing request ID");
        require(number(request, L"version", 1, 1) == protocol_version, "protocol-mismatch", "Update Computer Use extension");
        auto result = desktop.execute(text(request, L"method"), request.GetNamedObject(L"params"));
        response.Insert(L"ok", moxxy::boolean(true)); response.Insert(L"result", result);
      } catch (const Error& error) {
        Json detail; detail.Insert(L"code", string_value(to_hstring(error.code)));
        detail.Insert(L"message", string_value(to_hstring(error.what())));
        response.Insert(L"ok", moxxy::boolean(false)); response.Insert(L"error", detail);
      } catch (...) {
        Json detail; detail.Insert(L"code", string_value(L"native-error"));
        detail.Insert(L"message", string_value(L"Native operation failed or target became unavailable; observe again."));
        response.Insert(L"ok", moxxy::boolean(false)); response.Insert(L"error", detail);
      }
      response.Insert(L"id", string_value(id));
      auto wire = to_string(response.Stringify());
      require(wire.size() <= frame_limit, "output-limit", "Response exceeds protocol limit");
      std::cout << wire << '\n' << std::flush;
      deadline = 0;
    }
  } catch (...) { return 1; }
}
