#pragma once
#include "common.hpp"
#include <future>

namespace moxxy {
struct AccessibilityState {
  unsigned actions=0;
  int toggle=-1,selected=-1,expanded=-1;
  bool operator==(const AccessibilityState&) const = default;
};
AccessibilityState accessibility_state(IUIAutomationElement* node);
JsonArray accessibility_actions(const AccessibilityState& state);
Json accessibility_properties(const AccessibilityState& state);

class AccessibilityActions {
 public:
  Json start(com_ptr<IUIAutomationElement> node, HWND window, const AccessibilityState& state, const std::wstring& action);
  Json status(const std::wstring& id, int wait_ms);
 private:
  std::wstring current;
  std::shared_future<HRESULT> result;
};
}
