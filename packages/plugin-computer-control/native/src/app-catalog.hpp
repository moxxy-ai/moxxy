#pragma once
#include "common.hpp"
#include <shobjidl.h>
#include <map>

namespace moxxy {
struct InstalledApp {
  std::wstring name, executable, application_id;
  com_ptr<IShellItem2> item;
};
class AppCatalog {
 public:
  Json list(const Json& params);
  const InstalledApp& get(const std::wstring& id) const;
  HANDLE launch(const InstalledApp& app);
  bool matches(const InstalledApp& app,DWORD pid) const;
 private:
  std::map<std::wstring,InstalledApp> apps;
  bool loaded=false, incomplete=false, shell_unavailable=false;
  void load();
};
}
