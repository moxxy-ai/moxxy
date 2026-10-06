#include "apps.hpp"

#include <algorithm>
#include <set>

#include "text.hpp"

namespace moxxy::catalog {

namespace {

std::string file_name(const std::string& path) {
  const auto slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

std::string last_part(const std::string& id) {
  const auto dot = id.find_last_of('.');
  return dot == std::string::npos ? id : id.substr(dot + 1);
}

}  // namespace

bool owns(const AppRecord& app, const ProcessFacts& process) {
  const auto instance = lower(process.instance), app_class = lower(process.app_class);
  const auto is_window_class = [&](const std::string& name) { return !name.empty() && (lower(name) == instance || lower(name) == app_class); };
  if (is_window_class(app.wm_class) || is_window_class(app.id) || is_window_class(last_part(app.id))) return true;
  if (app.program.empty()) return false;
  return std::any_of(process.programs.begin(), process.programs.end(), [&](const std::string& program) { return lower(program) == lower(app.program); });
}

std::vector<AppRecord> merge(std::vector<AppRecord> running, const std::vector<AppRecord>& installed) {
  std::set<std::string> seen;
  std::vector<AppRecord> unique;
  running.insert(running.end(), installed.begin(), installed.end());
  for (auto& app : running) if (seen.insert(lower(app.id)).second) unique.push_back(std::move(app));
  std::stable_sort(unique.begin(), unique.end(), [](const AppRecord& left, const AppRecord& right) {
    if (left.running != right.running) return left.running;
    return lower(left.name) < lower(right.name);
  });
  return unique;
}

AppPage page(const std::vector<AppRecord>& apps, const std::string& query, size_t limit) {
  const auto needle = lower(query);
  AppPage page;
  for (const auto& app : apps) {
    if (!needle.empty() && lower(app.name + " " + app.id + " " + app.program).find(needle) == std::string::npos) continue;
    if (page.apps.size() == limit) { page.truncated = true; break; }
    page.apps.push_back(app);
  }
  return page;
}

Resolution resolve(const std::string& request, const std::vector<AppRecord>& apps) {
  auto wanted = lower(request);
  if (wanted.ends_with(".desktop")) wanted.resize(wanted.size() - 8);
  for (const auto& app : apps) if (lower(app.id) == wanted) return app;
  std::vector<AppRecord> named;
  for (const auto& app : apps) if (lower(app.name) == wanted || (!app.program.empty() && lower(app.program) == wanted)) named.push_back(app);
  if (named.size() == 1) return named.front();
  if (named.size() > 1) return named;
  return NotFound{};
}

std::string program_of(const std::string& exec) {
  size_t at = 0;
  while (at < exec.size()) {
    while (at < exec.size() && exec[at] == ' ') at++;
    if (at >= exec.size()) break;
    std::string word;
    if (exec[at] == '"') {
      const auto close = exec.find('"', at + 1);
      word = exec.substr(at + 1, close == std::string::npos ? std::string::npos : close - at - 1);
      at = close == std::string::npos ? exec.size() : close + 1;
    } else {
      const auto space = exec.find(' ', at);
      word = exec.substr(at, space == std::string::npos ? std::string::npos : space - at);
      at = space == std::string::npos ? exec.size() : space;
    }
    if (word == "env" || word.find('=') != std::string::npos) continue;
    return file_name(word);
  }
  return {};
}

}  // namespace moxxy::catalog
