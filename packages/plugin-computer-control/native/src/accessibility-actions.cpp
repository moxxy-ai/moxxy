#include "accessibility-actions.hpp"
#include "input-guard.hpp"
#include <thread>

namespace moxxy {
namespace {
constexpr const wchar_t* names[]={L"invoke",L"select",L"add_to_selection",L"remove_from_selection",L"toggle",L"expand",L"collapse",L"scroll_into_view"};
template<class T> com_ptr<T> pattern(IUIAutomationElement* node, PATTERNID id) {
  com_ptr<T> value;
  if (FAILED(node->GetCurrentPatternAs(id,__uuidof(T),value.put_void()))) return nullptr;
  return value;
}
HRESULT perform(IUIAutomationElement* node, unsigned index) {
  if (index==0) {
    auto value=pattern<IUIAutomationInvokePattern>(node,UIA_InvokePatternId);
    return value ? value->Invoke() : UIA_E_NOTSUPPORTED;
  }
  if (index>=1 && index<=3) {
    auto value=pattern<IUIAutomationSelectionItemPattern>(node,UIA_SelectionItemPatternId);
    if (!value) return UIA_E_NOTSUPPORTED;
    return index==1 ? value->Select() : index==2 ? value->AddToSelection() : value->RemoveFromSelection();
  }
  if (index==4) {
    auto value=pattern<IUIAutomationTogglePattern>(node,UIA_TogglePatternId);
    return value ? value->Toggle() : UIA_E_NOTSUPPORTED;
  }
  if (index==5 || index==6) {
    auto value=pattern<IUIAutomationExpandCollapsePattern>(node,UIA_ExpandCollapsePatternId);
    return value ? (index==5 ? value->Expand() : value->Collapse()) : UIA_E_NOTSUPPORTED;
  }
  auto value=pattern<IUIAutomationScrollItemPattern>(node,UIA_ScrollItemPatternId);
  return value ? value->ScrollIntoView() : UIA_E_NOTSUPPORTED;
}
}
AccessibilityState accessibility_state(IUIAutomationElement* node) {
  AccessibilityState state;
  if (pattern<IUIAutomationInvokePattern>(node,UIA_InvokePatternId)) state.actions|=1;
  if (auto value=pattern<IUIAutomationSelectionItemPattern>(node,UIA_SelectionItemPatternId)) {
    BOOL selected=FALSE; check_hresult(value->get_CurrentIsSelected(&selected));
    state.selected=selected ? 1 : 0; state.actions|=(1<<1)|(1<<2)|(1<<3);
  }
  if (auto value=pattern<IUIAutomationTogglePattern>(node,UIA_TogglePatternId)) {
    ToggleState toggle; check_hresult(value->get_CurrentToggleState(&toggle));
    state.toggle=toggle; state.actions|=1<<4;
  }
  if (auto value=pattern<IUIAutomationExpandCollapsePattern>(node,UIA_ExpandCollapsePatternId)) {
    ExpandCollapseState expanded; check_hresult(value->get_CurrentExpandCollapseState(&expanded));
    state.expanded=expanded;
    if (expanded!=ExpandCollapseState_LeafNode) state.actions|=(1<<5)|(1<<6);
  }
  if (pattern<IUIAutomationScrollItemPattern>(node,UIA_ScrollItemPatternId)) state.actions|=1<<7;
  return state;
}
JsonArray accessibility_actions(const AccessibilityState& state) {
  JsonArray result;
  for (unsigned i=0;i<std::size(names);++i) if (state.actions&(1<<i)) result.Append(string_value(names[i]));
  return result;
}
Json accessibility_properties(const AccessibilityState& state) {
  Json result;
  if (state.toggle>=0) result.Insert(L"toggle",numeric(state.toggle));
  if (state.selected>=0) result.Insert(L"selected",boolean(state.selected!=0));
  if (state.expanded>=0) result.Insert(L"expansion",numeric(state.expanded));
  return result;
}
Json AccessibilityActions::start(com_ptr<IUIAutomationElement> node, HWND window, const AccessibilityState& state, const std::wstring& action) {
  require(!result.valid() || result.wait_for(std::chrono::milliseconds(0))==std::future_status::ready,
    "action-pending","Previous UIA action is still pending; observe its modal or stop, do not repeat the action");
  unsigned index=0; while (index<std::size(names) && action!=names[index]) ++index;
  require(index<std::size(names) && (state.actions&(1<<index)),"unsupported","Action was not exposed by this control; no physical fallback was performed");
  current=identifier();
  auto completion=std::make_shared<std::promise<HRESULT>>(); result=completion->get_future().share();
  // UIA providers can block inside Invoke until a modal closes. Keep that COM
  // call off the protocol reader/executor and the independent input guardian.
  std::thread([node=std::move(node),window,state,index,completion] {
    HRESULT outcome=E_FAIL;
    try {
      init_apartment(apartment_type::multi_threaded);
      BOOL enabled=FALSE,password=TRUE;
      check_hresult(node->get_CurrentIsEnabled(&enabled)); check_hresult(node->get_CurrentIsPassword(&password));
      if (enabled && !password && has_target_focus(window) && !guard_paused() && WaitForSingleObject(stop_event,0)==WAIT_TIMEOUT && accessibility_state(node.get())==state)
        outcome=perform(node.get(),index);
      else outcome=E_ABORT;
    } catch (const hresult_error& error) { outcome=error.code(); }
      catch (...) { outcome=E_FAIL; }
    completion->set_value(outcome);
  }).detach();
  return status(current,100);
}
Json AccessibilityActions::status(const std::wstring& id, int wait_ms) {
  require(!current.empty() && id==current,"stale-action","Action receipt is not owned by this helper or has been superseded");
  bool complete=result.wait_for(std::chrono::milliseconds(wait_ms))==std::future_status::ready;
  Json response; response.Insert(L"actionId",string_value(current));
  response.Insert(L"status",string_value(!complete ? L"pending" : SUCCEEDED(result.get()) ? L"completed" : L"failed"));
  response.Insert(L"verificationRequired",boolean(true)); return response;
}
}
