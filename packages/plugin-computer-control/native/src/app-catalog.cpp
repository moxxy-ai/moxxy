#include "app-catalog.hpp"
#include <shlobj.h>
#include <shellapi.h>
#include <propkey.h>
#include <appmodel.h>

namespace moxxy {
namespace {
struct Pidl { PIDLIST_ABSOLUTE value=nullptr; ~Pidl() { CoTaskMemFree(value); } };
struct ShellText { PWSTR value=nullptr; ~ShellText() { CoTaskMemFree(value); } };
std::wstring property(IShellItem2* item, REFPROPERTYKEY key) {
  ShellText value;
  if (FAILED(item->GetString(key,&value.value)) || !value.value) return {};
  auto size=wcsnlen_s(value.value,32769);
  return size<=32768 ? std::wstring(value.value,size) : std::wstring();
}
bool is_executable(const std::wstring& path) {
  auto name=lower(path);
  return name.size()>4 && name.compare(name.size()-4,4,L".exe")==0;
}
}
std::wstring lower(std::wstring value) { for (auto& ch:value) ch=static_cast<wchar_t>(towlower(ch)); return value; }
std::wstring base_name(const std::wstring& path) {
  auto start=path.find_last_of(L"\\/");
  auto name=start==std::wstring::npos ? path : path.substr(start+1);
  if (is_executable(name)) name.resize(name.size()-4);
  return name;
}
std::wstring process_app_id(DWORD pid) {
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid));
  if (!process.value) return {};
  wchar_t id[512]{}; UINT32 size=512;
  if (GetApplicationUserModelId(process.value,&size,id)==ERROR_SUCCESS && size>1) return id;
  wchar_t path[32768]{}; DWORD length=32768;
  if (!QueryFullProcessImageNameW(process.value,0,path,&length) || !length) return {};
  return lower(std::wstring(path,length));
}
void AppCatalog::add(InstalledApp app) {
  if (app.id.empty() || app.id.size()>512 || app.name.empty() || app.name.size()>512) return;
  for (const auto& known:apps) if (known.id==app.id) return;
  apps.push_back(std::move(app));
}
void AppCatalog::load() {
  if (loaded) return;
  loaded=true;
  try {
    Pidl root;
    check_hresult(SHGetKnownFolderIDList(FOLDERID_AppsFolder,KF_FLAG_DEFAULT,nullptr,&root.value));
    com_ptr<IShellItem> folder;
    check_hresult(SHCreateItemFromIDList(root.value,IID_PPV_ARGS(folder.put())));
    com_ptr<IEnumShellItems> enumerator;
    check_hresult(folder->BindToHandler(nullptr,BHID_EnumItems,IID_PPV_ARGS(enumerator.put())));
    for (int count=0;count<2048;++count) {
      check_active_desktop();
      com_ptr<IShellItem> item; ULONG fetched=0;
      auto hr=enumerator->Next(1,item.put(),&fetched); check_hresult(hr);
      if (hr==S_FALSE || !fetched) break;
      auto rich=item.as<IShellItem2>();
      ShellText name; if (FAILED(item->GetDisplayName(SIGDN_NORMALDISPLAY,&name.value)) || !name.value) continue;
      auto size=wcsnlen_s(name.value,513); if (!size || size>512) continue;
      auto executable=property(rich.get(),PKEY_Link_TargetParsingPath);
      auto app_id=property(rich.get(),PKEY_AppUserModel_ID);
      // A shortcut to a document or a web page is not an application.
      if (!executable.empty() && !is_executable(executable)) continue;
      auto id=executable.empty() ? app_id : lower(executable);
      add(InstalledApp{id,std::wstring(name.value,size),executable,app_id,std::move(rich)});
    }
  } catch (const Error&) { throw; }
  catch (...) { /* Without the shell's list, the system tools below and running apps remain. */ }
  wchar_t system[MAX_PATH]{};
  auto length=GetSystemDirectoryW(system,MAX_PATH);
  if (length>0 && length<MAX_PATH) {
    for (const auto& pair : {std::pair{L"Notepad",L"notepad.exe"},std::pair{L"Paint",L"mspaint.exe"}}) {
      // Where the shell already lists the app (a packaged Notepad), that entry is the one that starts it.
      bool listed=false;
      for (const auto& known:apps) if (lower(known.name)==lower(pair.first)) listed=true;
      if (listed) continue;
      auto path=std::wstring(system)+L"\\"+pair.second;
      auto attributes=GetFileAttributesW(path.c_str());
      if (attributes!=INVALID_FILE_ATTRIBUTES && !(attributes&FILE_ATTRIBUTE_DIRECTORY))
        add(InstalledApp{lower(path),pair.first,path,L"",{}});
    }
  }
}
const std::vector<InstalledApp>& AppCatalog::all() { load(); return apps; }
const InstalledApp* AppCatalog::find(const std::wstring& id) {
  load();
  for (const auto& app:apps) if (app.id==id) return &app;
  return nullptr;
}
HANDLE AppCatalog::launch(const InstalledApp& app) {
  SHELLEXECUTEINFOW request{}; request.cbSize=sizeof(request);
  request.fMask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_FLAG_NO_UI;
  // The app opens behind the user's work; the helper brings it forward only for real input.
  request.lpVerb=L"open"; request.nShow=SW_SHOWNOACTIVATE;
  Pidl target;
  if (app.item) {
    check_hresult(SHGetIDListFromObject(app.item.get(),&target.value));
    request.fMask|=SEE_MASK_IDLIST;
    request.lpIDList=target.value;
  } else request.lpFile=app.executable.c_str();
  // No model-controlled command, arguments, shell interpolation or runas verb.
  input_may_have_run=true;
  require(ShellExecuteExW(&request),"app_not_found","Windows could not start the application");
  return request.hProcess;
}
}
