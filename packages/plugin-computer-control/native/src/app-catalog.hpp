#pragma once
#include "common.hpp"
#include <shobjidl.h>

namespace moxxy {
/// An application the user can start. `id` survives helper restarts: the executable path in lower
/// case, or the AppUserModelID for a packaged app.
struct InstalledApp {
  std::wstring id, name, executable, application_id;
  com_ptr<IShellItem2> item;
};
class AppCatalog {
 public:
  const std::vector<InstalledApp>& all();
  const InstalledApp* find(const std::wstring& id);
  HANDLE launch(const InstalledApp& app);
 private:
  std::vector<InstalledApp> apps;
  bool loaded=false;
  void add(InstalledApp app);
  void load();
};
std::wstring lower(std::wstring value);
/// The same identifier `InstalledApp::id` uses, for a running process; empty when it cannot be read.
std::wstring process_app_id(DWORD pid);
/// File name of an executable path without its extension.
std::wstring base_name(const std::wstring& path);
}
