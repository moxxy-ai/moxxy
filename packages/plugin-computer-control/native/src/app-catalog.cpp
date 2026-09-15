#include "app-catalog.hpp"
#include <shlobj.h>
#include <shellapi.h>
#include <propkey.h>
#include <appmodel.h>

namespace moxxy {
namespace {
struct Pidl { PIDLIST_ABSOLUTE value=nullptr; ~Pidl() { CoTaskMemFree(value); } };
struct ShellText { PWSTR value=nullptr; ~ShellText() { CoTaskMemFree(value); } };
std::wstring lower(std::wstring value) { for (auto& ch:value) ch=static_cast<wchar_t>(towlower(ch)); return value; }
std::wstring property(IShellItem2* item, REFPROPERTYKEY key) {
  ShellText value;
  if (FAILED(item->GetString(key,&value.value)) || !value.value) return {};
  auto size=wcsnlen_s(value.value,32769);
  return size<=32768 ? std::wstring(value.value,size) : std::wstring();
}
}
void AppCatalog::load() {
  if (loaded) return;
  loaded=true;
  wchar_t system[MAX_PATH]{};
  auto length=GetSystemDirectoryW(system,MAX_PATH);
  if (length>0 && length<MAX_PATH) {
    for (const auto& pair : {std::pair{L"Notepad",L"notepad.exe"},std::pair{L"Paint",L"mspaint.exe"}}) {
      auto path=std::wstring(system)+L"\\"+pair.second;
      auto attributes=GetFileAttributesW(path.c_str());
      if (attributes!=INVALID_FILE_ATTRIBUTES && !(attributes&FILE_ATTRIBUTE_DIRECTORY))
        apps.emplace(identifier(),InstalledApp{pair.first,path,L"",{}});
    }
  }
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
      if (hr==S_FALSE || !fetched) return;
      auto rich=item.as<IShellItem2>();
      ShellText name; if (FAILED(item->GetDisplayName(SIGDN_NORMALDISPLAY,&name.value)) || !name.value) continue;
      auto size=wcsnlen_s(name.value,513); if (!size || size>512) continue;
      auto executable=property(rich.get(),PKEY_Link_TargetParsingPath);
      auto app_id=property(rich.get(),PKEY_AppUserModel_ID);
      apps.emplace(identifier(),InstalledApp{std::wstring(name.value,size),executable,app_id,std::move(rich)});
    }
    incomplete=true;
  } catch (const Error&) { throw; }
  catch (...) { shell_unavailable=true; }
}
Json AppCatalog::list(const Json& params) {
  load();
  auto query=lower(text(params,L"query",256));
  auto maximum=number(params,L"maxResults",1,64);
  JsonArray output;
  bool truncated=incomplete;
  for (const auto& [id,app]:apps) {
    if (lower(app.name).find(query)==std::wstring::npos && lower(app.application_id).find(query)==std::wstring::npos) continue;
    if (output.Size()>=static_cast<unsigned>(maximum)) { truncated=true; break; }
    Json row; row.Insert(L"appId",string_value(id)); row.Insert(L"name",string_value(app.name));
    row.Insert(L"source",string_value(app.item ? L"windows-shell" : L"system")); output.Append(row);
  }
  JsonArray unavailable;
  if (shell_unavailable) unavailable.Append(string_value(L"windows-shell"));
  Json result; result.Insert(L"apps",output); result.Insert(L"truncated",boolean(truncated)); result.Insert(L"unavailableSources",unavailable); return result;
}
const InstalledApp& AppCatalog::get(const std::wstring& id) const {
  auto found=apps.find(id);
  require(found!=apps.end(),"unknown-app","Select an application from computer_app_catalog; command text is not accepted");
  return found->second;
}
HANDLE AppCatalog::launch(const InstalledApp& app) {
  SHELLEXECUTEINFOW request{}; request.cbSize=sizeof(request);
  request.fMask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_FLAG_NO_UI;
  request.lpVerb=L"open"; request.nShow=SW_SHOWNORMAL;
  Pidl target;
  if (app.item) {
    check_hresult(SHGetIDListFromObject(app.item.get(),&target.value));
    request.fMask|=SEE_MASK_IDLIST;
    request.lpIDList=target.value;
  } else request.lpFile=app.executable.c_str();
  // No model-controlled command, arguments, shell interpolation or runas verb.
  input_may_have_run=true;
  require(ShellExecuteExW(&request),"launch-failed","Windows did not confirm application launch; check installed application availability");
  return request.hProcess;
}
bool AppCatalog::matches(const InstalledApp& app,DWORD pid) const {
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid));
  if (!process.value) return false;
  if (!app.executable.empty()) {
    wchar_t path[32768]{}; DWORD size=32768;
    if (QueryFullProcessImageNameW(process.value,0,path,&size) && lower(app.executable)==lower(std::wstring(path,size))) return true;
  }
  if (!app.application_id.empty()) {
    wchar_t id[512]{}; UINT32 size=512;
    if (GetApplicationUserModelId(process.value,&size,id)==ERROR_SUCCESS && app.application_id==id) return true;
  }
  return false;
}
}
