#include "input-guard.hpp"
#include <array>
#include <thread>
#include <memory>

namespace moxxy {
namespace {
constexpr LONG guard_version=1;
constexpr size_t ledger_capacity=16;
struct SharedInput {
  LONG version;
  volatile LONG count;
  INPUT releases[ledger_capacity];
  volatile LONG physical[256];
  volatile LONG paused, resume, visible, state, target_pid;
  volatile LONG64 target;
};
struct Mapping {
  SharedInput* value=nullptr;
  ~Mapping() { if (value) UnmapViewOfFile(value); }
};
struct Guard {
  Handle mapping, mutex, process;
  Mapping view;
};
std::unique_ptr<Guard> guard;
SharedInput* observed=nullptr;
LONG physical(UINT key) {
  return key<256 ? InterlockedCompareExchange(&observed->physical[key],0,0) : 0;
}
bool physically_held(const INPUT& input) {
  if (input.type==INPUT_MOUSE) {
    if (input.mi.dwFlags&MOUSEEVENTF_LEFTUP) return physical(VK_LBUTTON);
    if (input.mi.dwFlags&MOUSEEVENTF_RIGHTUP) return physical(VK_RBUTTON);
    if (input.mi.dwFlags&MOUSEEVENTF_MIDDLEUP) return physical(VK_MBUTTON);
    return false;
  }
  if (input.ki.dwFlags&KEYEVENTF_UNICODE) return false;
  auto key=input.ki.wVk;
  if (key==VK_SHIFT) return physical(VK_SHIFT)||physical(VK_LSHIFT)||physical(VK_RSHIFT);
  if (key==VK_CONTROL) return physical(VK_CONTROL)||physical(VK_LCONTROL)||physical(VK_RCONTROL);
  if (key==VK_MENU) return physical(VK_MENU)||physical(VK_LMENU)||physical(VK_RMENU);
  return physical(key);
}
struct MutexLock {
  HANDLE value;
  explicit MutexLock(HANDLE mutex) : value(mutex) {
    auto result=WaitForSingleObject(value,2000);
    require(result==WAIT_OBJECT_0 || result==WAIT_ABANDONED,"guard-unavailable","Input guardian mutex unavailable");
  }
  ~MutexLock() { ReleaseMutex(value); }
};
void release_ledger(SharedInput& state, HANDLE mutex) {
  MutexLock lock(mutex);
  require(state.version==guard_version && state.count>=0 && state.count<=ledger_capacity,"guard-protocol","Invalid input ledger");
  while (state.count>0) {
    auto& release=state.releases[state.count-1];
    // Do not send key-up for an unrelated physically held user key. Windows
    // cannot express separate held states for a physical and injected key.
    if (!physically_held(release)) SendInput(1,&release,sizeof(INPUT));
    InterlockedDecrement(&state.count);
  }
}
LRESULT CALLBACK keyboard_hook(int code, WPARAM message, LPARAM data) {
  if (code==HC_ACTION && observed) {
    auto event=reinterpret_cast<KBDLLHOOKSTRUCT*>(data);
    if (!(event->flags&LLKHF_INJECTED) && event->vkCode<256)
      InterlockedExchange(&observed->physical[event->vkCode],(event->flags&LLKHF_UP) ? 0 : 1);
  }
  return CallNextHookEx(nullptr,code,message,data);
}
LRESULT CALLBACK mouse_hook(int code, WPARAM message, LPARAM data) {
  if (code==HC_ACTION && observed) {
    auto event=reinterpret_cast<MSLLHOOKSTRUCT*>(data);
    if (!(event->flags&LLMHF_INJECTED)) {
      int key=0; LONG down=0;
      switch(message) {
        case WM_LBUTTONDOWN: key=VK_LBUTTON; down=1; break;
        case WM_LBUTTONUP: key=VK_LBUTTON; break;
        case WM_RBUTTONDOWN: key=VK_RBUTTON; down=1; break;
        case WM_RBUTTONUP: key=VK_RBUTTON; break;
        case WM_MBUTTONDOWN: key=VK_MBUTTON; down=1; break;
        case WM_MBUTTONUP: key=VK_MBUTTON; break;
      }
      if (key) InterlockedExchange(&observed->physical[key],down);
    }
  }
  return CallNextHookEx(nullptr,code,message,data);
}
void map_view(Mapping& view, HANDLE section) {
  view.value=static_cast<SharedInput*>(MapViewOfFile(section,FILE_MAP_ALL_ACCESS,0,0,sizeof(SharedInput)));
  require(view.value!=nullptr,"guard-unavailable","Cannot map private input ledger");
}
Handle* inherited(HANDLE original, Handle& copy) {
  require(DuplicateHandle(GetCurrentProcess(),original,GetCurrentProcess(),&copy.value,0,TRUE,DUPLICATE_SAME_ACCESS),
    "guard-unavailable","Cannot prepare guardian handle");
  return &copy;
}
}
void start_input_guard(HANDLE parent, HANDLE stop) {
  auto instance=std::make_unique<Guard>();
  instance->mapping.value=CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,sizeof(SharedInput),nullptr);
  instance->mutex.value=CreateMutexW(nullptr,FALSE,nullptr);
  require(instance->mapping.value && instance->mutex.value,"guard-unavailable","Cannot create private input ledger");
  map_view(instance->view,instance->mapping.value);
  instance->view.value->version=guard_version;
  Handle ready(CreateEventW(nullptr,TRUE,FALSE,nullptr));
  require(ready.value!=nullptr,"guard-unavailable","Cannot create guardian readiness event");
  std::array<Handle,6> copies;
  HANDLE originals[]={instance->mapping.value,instance->mutex.value,stop,ready.value,GetCurrentProcess(),parent};
  HANDLE handles[6];
  for (size_t i=0;i<copies.size();++i) handles[i]=inherited(originals[i],copies[i])->value;
  SIZE_T size=0; InitializeProcThreadAttributeList(nullptr,1,0,&size);
  std::vector<unsigned char> storage(size);
  auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  require(InitializeProcThreadAttributeList(attributes,1,0,&size),"guard-unavailable","Cannot initialize guardian attributes");
  struct Attributes { LPPROC_THREAD_ATTRIBUTE_LIST value; ~Attributes() { DeleteProcThreadAttributeList(value); } } cleanup{attributes};
  require(UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,sizeof(handles),nullptr,nullptr),
    "guard-unavailable","Cannot restrict guardian handle inheritance");
  std::wstring executable(32768,L'\0');
  auto length=GetModuleFileNameW(nullptr,executable.data(),static_cast<DWORD>(executable.size()));
  require(length>0 && length<executable.size(),"guard-unavailable","Cannot identify bundled guardian executable");
  executable.resize(length);
  auto command=L"\""+executable+L"\" --input-guard";
  for (auto handle:handles) command+=L" "+std::to_wstring(reinterpret_cast<uintptr_t>(handle));
  STARTUPINFOEXW startup{}; startup.StartupInfo.cb=sizeof(startup); startup.lpAttributeList=attributes;
  PROCESS_INFORMATION process{};
  require(CreateProcessW(executable.c_str(),command.data(),nullptr,nullptr,TRUE,EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,
    nullptr,nullptr,&startup.StartupInfo,&process),"guard-unavailable","Cannot start input guardian");
  instance->process.value=process.hProcess; Handle thread(process.hThread);
  HANDLE waiting[]={ready.value,instance->process.value};
  if (WaitForMultipleObjects(2,waiting,FALSE,3000)!=WAIT_OBJECT_0) {
    SetEvent(stop);
    throw Error("guard-unavailable","Input guardian did not become ready");
  }
  observed=instance->view.value;
  guard=std::move(instance);
}
void guarded_input(INPUT input, std::optional<INPUT> release) {
  require(guard && WaitForSingleObject(guard->process.value,0)==WAIT_TIMEOUT,"guard-unavailable","Input guardian exited; input is disabled");
  MutexLock lock(guard->mutex.value);
  require(WaitForSingleObject(stop_event,0)==WAIT_TIMEOUT && WaitForSingleObject(guard->process.value,0)==WAIT_TIMEOUT,
    "cancelled","Input stopped before delivery");
  auto& state=*guard->view.value;
  require(state.version==guard_version && state.count>=0 && state.count<ledger_capacity,"guard-protocol","Invalid input ledger");
  if (release) {
    require(!physically_held(*release),"user-input-active","User is holding this key or button");
    state.releases[state.count]=*release;
    // Interlocked publication orders the complete record before SendInput even
    // if the worker dies without releasing the mutex.
    InterlockedIncrement(&state.count);
  }
  input_may_have_run=true;
  require(SendInput(1,&input,sizeof(INPUT))==1,"input-denied","Windows rejected input; check target privileges");
}
void guarded_release() noexcept {
  if (!guard) return;
  try { release_ledger(*guard->view.value,guard->mutex.value); } catch (...) { /* Guardian repeats cleanup when the worker exits. */ }
}
bool guard_paused() { return observed && InterlockedCompareExchange(&observed->paused,0,0)!=0; }
bool take_guard_resume() { return observed && InterlockedExchange(&observed->resume,0)!=0; }
void guard_control(ControlCommand command) {
  require(observed!=nullptr,"guard-unavailable","Control is not ready");
  if (command==ControlCommand::stop) { stop_exit_code=20; SetEvent(stop_event); return; }
  if (command==ControlCommand::pause) {
    InterlockedExchange(&observed->resume,0); InterlockedExchange(&observed->paused,1);
  } else {
    auto state=static_cast<ControlState>(InterlockedCompareExchange(&observed->state,0,0));
    InterlockedExchange(&observed->paused,0);
    InterlockedExchange(&observed->resume,state==ControlState::paused_by_user || state==ControlState::waiting_for_focus ? 1 : 0);
  }
}
void publish_guard_state(ControlState state, HWND target) {
  if (!observed) return;
  if (target) {
    DWORD pid=0; GetWindowThreadProcessId(target,&pid);
    InterlockedExchange(&observed->target_pid,pid);
    InterlockedExchange64(&observed->target,reinterpret_cast<LONG64>(target));
    InterlockedExchange(&observed->visible,1);
  }
  InterlockedExchange(&observed->state,static_cast<LONG>(state));
}
int run_input_guard(int argc, char** argv) {
  try {
    require(argc==8,"guard-protocol","Invalid guardian arguments");
    std::array<Handle,6> handles;
    for (int i=0;i<6;++i) {
      size_t consumed=0; auto value=std::stoull(argv[i+2],&consumed);
      require(consumed==strlen(argv[i+2]) && value>0 && value<=UINTPTR_MAX,"guard-protocol","Invalid guardian handle");
      handles[i].value=reinterpret_cast<HANDLE>(static_cast<uintptr_t>(value));
      DWORD flags=0; require(GetHandleInformation(handles[i].value,&flags),"guard-protocol","Unavailable guardian handle");
    }
    Mapping mapping; map_view(mapping,handles[0].value); observed=mapping.value;
    stop_event=handles[2].value;
    require(observed->version==guard_version,"guard-protocol","Input ledger version mismatch");
    for (int key=0;key<256;++key) InterlockedExchange(&observed->physical[key],(GetAsyncKeyState(key)&0x8000) ? 1 : 0);
    auto keyboard=SetWindowsHookExW(WH_KEYBOARD_LL,keyboard_hook,GetModuleHandleW(nullptr),0);
    auto mouse=SetWindowsHookExW(WH_MOUSE_LL,mouse_hook,GetModuleHandleW(nullptr),0);
    require(keyboard && mouse,"guard-unavailable","Cannot distinguish physical input from agent input");
    PanelModel model{
      [] {
        auto target=reinterpret_cast<HWND>(InterlockedCompareExchange64(&observed->target,0,0));
        wchar_t title[256]{}; GetWindowTextW(target,title,256);
        auto state=static_cast<ControlState>(InterlockedCompareExchange(&observed->state,0,0));
        if (static_cast<int>(state)<0 || static_cast<int>(state)>7) state=ControlState::failed;
        return PanelSnapshot{InterlockedCompareExchange(&observed->visible,0,0)!=0,guard_paused() ? ControlState::paused_by_user : state,title};
      },
      [](ControlCommand command) {
        if (command==ControlCommand::resume) {
          auto target=reinterpret_cast<HWND>(InterlockedCompareExchange64(&observed->target,0,0));
          DWORD pid=0; GetWindowThreadProcessId(target,&pid);
          if (IsWindow(target) && pid==static_cast<DWORD>(InterlockedCompareExchange(&observed->target_pid,0,0))) SetForegroundWindow(target);
        }
        guard_control(command);
      }
    };
    auto panel=create_control_panel(model);
    std::thread([&] {
      HANDLE monitored[]={handles[2].value,handles[4].value,handles[5].value};
      WaitForMultipleObjects(3,monitored,FALSE,INFINITE);
      SetEvent(handles[2].value);
      try { release_ledger(*observed,handles[1].value); } catch (...) {}
      ExitProcess(0);
    }).detach();
    SetEvent(handles[3].value);
    MSG message;
    while (GetMessageW(&message,nullptr,0,0)>0) {
      if (!IsDialogMessageW(panel,&message)) { TranslateMessage(&message); DispatchMessageW(&message); }
    }
    UnhookWindowsHookEx(keyboard); UnhookWindowsHookEx(mouse);
  } catch (...) { return 1; }
  return 0;
}
}
