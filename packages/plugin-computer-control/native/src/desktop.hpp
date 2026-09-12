#pragma once
#include "common.hpp"
#include "app-catalog.hpp"
#include "accessibility-actions.hpp"
#include <map>

namespace moxxy {
struct Window { HWND hwnd; DWORD pid; uint64_t created; uint64_t generation; com_ptr<IUIAutomationElement> root; };
struct ValueState {
  std::wstring text;
  bool readonly;
  bool operator==(const ValueState&) const = default;
};
struct Element { com_ptr<IUIAutomationElement> node; Rect bounds; std::optional<ValueState> value; AccessibilityState accessibility; };
class Desktop {
 public:
  Desktop();
  ~Desktop();
  Windows::Data::Json::IJsonValue execute(const std::wstring& method, const Json& params);
 private:
  com_ptr<IUIAutomation> automation;
  AppCatalog catalog;
  AccessibilityActions actions;
  com_ptr<IUIAutomationElement> observed_focus;
  std::map<std::wstring, Window> windows;
  std::map<std::wstring, Element> elements;
  std::optional<Element> approval_control;
  Handle lease;
  bool owns_lease = false;
  std::wstring observed_window, observation_id, capture_id, captured_window;
  Rect observed_bounds{}, captured_bounds{}, captured_window_bounds{};
  uint64_t observed_epoch = 0, captured_epoch = 0;
  int captured_width = 0, captured_height = 0;
  struct CaptureReference {
    std::string image;
    int max_dim, quality;
    bool jpeg;
    std::optional<Rect> crop;
  };
  std::optional<CaptureReference> capture_reference;
  void acquire();
  Window& target(const Json& params, bool allow_minimized = false);
  Element& element(const Json& params, Window& window, bool needs_focus = true);
  void fresh_observation(const Json& params, Window& window, bool needs_focus = true);
  void revalidate_approved_target(Window& window);
  bool unchanged_control(const Element& element, Window& window);
  Point point(const Json& params, const Json& coordinates, Window& window);
  JsonArray list_windows();
  std::wstring window_id(HWND hwnd) const;
  bool belongs_to_window(IUIAutomationElement* node, const Window& window);
  Json observe(const Json& params, Window& window);
  Json open(const Json& params);
};
}
