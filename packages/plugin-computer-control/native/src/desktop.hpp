#pragma once
#include "common.hpp"
#include <map>

namespace moxxy {
struct Window { HWND hwnd; DWORD pid; uint64_t created; uint64_t generation; com_ptr<IUIAutomationElement> root; };
struct Element { com_ptr<IUIAutomationElement> node; Rect bounds; };
class Desktop {
 public:
  Desktop();
  ~Desktop();
  Windows::Data::Json::IJsonValue execute(const std::wstring& method, const Json& params);
 private:
  com_ptr<IUIAutomation> automation;
  com_ptr<IUIAutomationElement> observed_focus;
  std::map<std::wstring, Window> windows;
  std::map<std::wstring, Element> elements;
  Handle lease;
  bool owns_lease = false;
  std::wstring observed_window, observation_id, capture_id, captured_window;
  Rect observed_bounds{}, captured_bounds{}, captured_window_bounds{};
  uint64_t observed_epoch = 0, captured_epoch = 0;
  int captured_width = 0, captured_height = 0;
  void acquire();
  Window& target(const Json& params);
  Element& element(const Json& params, Window& window, bool needs_focus = true);
  void fresh_observation(const Json& params, Window& window, bool needs_focus = true);
  Point point(const Json& params, const Json& coordinates, Window& window);
  JsonArray list_windows();
  Json observe(const Json& params, Window& window);
};
}
