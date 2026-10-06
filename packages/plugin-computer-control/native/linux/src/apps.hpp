#pragma once
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace moxxy {

/// One application the model can name. Its id is the desktop file's name without ".desktop"
/// ("org.gnome.Calculator"), or the window class for a running program that has no desktop file.
struct AppRecord {
  std::string id;
  std::string name;
  /// The program its desktop file starts, without the folder ("gnome-calculator").
  std::string program;
  /// StartupWMClass from the desktop file.
  std::string wm_class;
  bool running = false;
  bool operator==(const AppRecord&) const = default;
};

/// What is known about the process behind a window.
struct ProcessFacts {
  std::string instance;
  std::string app_class;
  /// File names of the executable and of its first arguments (a script run by an interpreter).
  std::vector<std::string> programs;
};

struct AppPage {
  std::vector<AppRecord> apps;
  bool truncated = false;
};

struct NotFound {};
using Resolution = std::variant<AppRecord, std::vector<AppRecord>, NotFound>;

namespace catalog {
/// Whether a window of that process belongs to this application.
bool owns(const AppRecord& app, const ProcessFacts& process);
/// Running apps win over installed copies of the same id; running first, then by name.
std::vector<AppRecord> merge(std::vector<AppRecord> running, const std::vector<AppRecord>& installed);
AppPage page(const std::vector<AppRecord>& apps, const std::string& query, size_t limit);
/// Id first, then the shown name or the program name; several apps with that name are ambiguous.
Resolution resolve(const std::string& request, const std::vector<AppRecord>& apps);
/// The program a desktop file's Exec line starts: the first word that is not `env` or a variable.
std::string program_of(const std::string& exec);
}  // namespace catalog

}  // namespace moxxy
