#pragma once
#include "common.hpp"
#include "app-catalog.hpp"
#include "accessibility-actions.hpp"
#include <map>

namespace moxxy {
struct Window { HWND hwnd; DWORD pid; uint64_t created; uint64_t generation; com_ptr<IUIAutomationElement> root; };
struct Element { com_ptr<IUIAutomationElement> node; Rect bounds; bool secure; };
/// One top-level window in the current inventory, with the app it belongs to.
struct WindowRow { std::wstring id; HWND hwnd; DWORD pid; std::wstring title, class_name, app; bool minimized; };
/// What the model last saw of one app; indices and points in later actions refer to it.
struct AppTarget {
  std::wstring id, name, window_id;
  HWND hwnd = nullptr;
  Rect bounds{};
  bool observed = false;
  std::map<int, Element> elements;
  /// An element keeps its index while its key lives; indices are never reused. Kept per window, so
  /// a dialog that comes and goes leaves the indices of the window under it alone.
  std::map<std::wstring, std::map<std::wstring, int>> indices;
  int next_index = 0;
  bool pictured = false;
  int image_width = 0, image_height = 0;
};
/// Why a step was not carried out, reported to the model as the action's result.
struct Refusal { const wchar_t* outcome; const wchar_t* code; std::wstring hint; };

class Desktop {
 public:
  Desktop();
  ~Desktop();
  Windows::Data::Json::IJsonValue execute(const std::wstring& method, const Json& params);
 private:
  com_ptr<IUIAutomation> automation;
  AppCatalog catalog;
  AccessibilityActions actions;
  std::map<std::wstring, Window> windows;
  std::map<std::wstring, AppTarget> targets;
  std::optional<Element> approval_control;
  struct Screen { Rect bounds; int width, height; };
  std::optional<Screen> screen;
  Handle lease;
  bool owns_lease = false;
  void acquire();
  std::vector<WindowRow> inventory();
  Window& live_window(AppTarget& target);
  bool belongs_to_window(IUIAutomationElement* node, const Window& window);
  Element& live(AppTarget& target, Window& window, int index);
  Point screen_point(const AppTarget& target, double x, double y);
  Point aim(AppTarget& target, Window& window, const Json& step);
  void bring_forward(Window& window);
  void settle(HWND window, int budget);
  void physically(Window& window, Point point, const std::function<void()>& input);
  void refuse_protected_focus();
  Json list_apps(const Json& params);
  Json resolve_apps(const Json& params);
  Json app_state(const std::wstring& app, const std::optional<std::wstring>& wanted, bool screenshot, int settle_budget);
  Json act(const std::wstring& app, const Json& step);
  Json perform(AppTarget& target, Window& window, const Json& step);
  Json scroll(AppTarget& target, Window& window, const Json& step);
  Json state_after(const std::wstring& app);
  Pixels visible_screen(Rect display, const std::set<std::wstring>& allowed);
  Json screenshot(const Json& params);
  Json zoom(const Json& params);
  Json approval(const Json& params);
};
}
