#include "text-actions.hpp"

namespace moxxy {
namespace {
struct OwnedString {
  BSTR value=nullptr;
  ~OwnedString() { SysFreeString(value); }
};
com_ptr<IUIAutomationTextPattern> text_pattern(IUIAutomationElement* node) {
  com_ptr<IUIAutomationTextPattern> pattern;
  node->GetCurrentPatternAs(UIA_TextPatternId,IID_PPV_ARGS(pattern.put()));
  return pattern;
}
std::pair<HWND,std::wstring> standard_edit(IUIAutomationElement* node, HWND window) {
  UIA_HWND handle=nullptr; check_hresult(node->get_CurrentNativeWindowHandle(&handle));
  auto hwnd=reinterpret_cast<HWND>(handle);
  wchar_t name[256]{}; GetClassNameW(hwnd,name,256);
  require((std::wstring_view(name)==L"Edit" || std::wstring_view(name)==L"EDIT") && GetAncestor(hwnd,GA_ROOT)==window,
    "unsupported","Control has neither TextPattern nor verified native EDIT text support; no keyboard fallback");
  require(!(GetWindowLongPtrW(hwnd,GWL_STYLE)&ES_PASSWORD),"protected-element","Protected native text control");
  com_ptr<IUIAutomationValuePattern> value;
  check_hresult(node->GetCurrentPatternAs(UIA_ValuePatternId,IID_PPV_ARGS(value.put())));
  OwnedString text; check_hresult(value->get_CurrentValue(&text.value));
  auto length=SysStringLen(text.value);
  require(length<=64000,"observation-limit","Native EDIT text exceeds safe selection index limit");
  return {hwnd,length ? std::wstring(text.value,length) : std::wstring()};
}
}
std::wstring control_text(IUIAutomationElement* node, HWND window) {
  auto pattern=text_pattern(node);
  if (!pattern) return standard_edit(node,window).second;
  com_ptr<IUIAutomationTextRange> document;
  check_hresult(pattern->get_DocumentRange(document.put()));
  require(document!=nullptr,"unsupported","Control has no document range");
  OwnedString text;
  check_hresult(document->GetText(64001,&text.value));
  auto size=SysStringLen(text.value);
  require(size<=64000,"unsupported","The text is too long to search safely");
  return size ? std::wstring(text.value,size) : std::wstring();
}
void select_control_text(IUIAutomationElement* node, HWND window, const std::wstring& text, int occurrence, TextPlacement placement) {
  auto pattern=text_pattern(node);
  if (!pattern) {
    auto [hwnd,value]=standard_edit(node,window);
    size_t start=0,found=0;
    for (int i=0;i<occurrence;++i) {
      found=value.find(text,start);
      require(found!=std::wstring::npos,"text-not-found","Requested literal occurrence is absent; observe again");
      start=found+text.size();
    }
    check_focus(window); input_may_have_run=true;
    DWORD_PTR result=0;
    const auto from=placement==TextPlacement::cursor_after ? start : found;
    const auto to=placement==TextPlacement::cursor_before ? found : start;
    require(SendMessageTimeoutW(hwnd,EM_SETSEL,from,to,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&result)!=0,
      "uncertain-result","Native selection request timed out; observe before another action");
    return;
  }
  SupportedTextSelection supported=SupportedTextSelection_None;
  check_hresult(pattern->get_SupportedTextSelection(&supported));
  require(supported!=SupportedTextSelection_None,"unsupported","Control does not support text selection");
  com_ptr<IUIAutomationTextRange> remaining,found;
  check_hresult(pattern->get_DocumentRange(remaining.put()));
  require(remaining!=nullptr,"unsupported","Control has no document range");
  OwnedString query; query.value=SysAllocStringLen(text.data(),static_cast<UINT>(text.size()));
  require(query.value!=nullptr,"native-error","Cannot allocate text query");
  for (int i=0;i<occurrence;++i) {
    found=nullptr;
    check_hresult(remaining->FindText(query.value,FALSE,FALSE,found.put()));
    require(found!=nullptr,"text-not-found","Requested literal occurrence is absent; observe again");
    if (i+1<occurrence) check_hresult(remaining->MoveEndpointByRange(TextPatternRangeEndpoint_Start,found.get(),TextPatternRangeEndpoint_End));
  }
  check_focus(window);
  input_may_have_run=true;
  if (placement!=TextPlacement::text) {
    // An empty range at one end of the match is the caret position.
    const auto moved=placement==TextPlacement::cursor_before ? TextPatternRangeEndpoint_End : TextPatternRangeEndpoint_Start;
    const auto anchor=placement==TextPlacement::cursor_before ? TextPatternRangeEndpoint_Start : TextPatternRangeEndpoint_End;
    com_ptr<IUIAutomationTextRange> caret;
    check_hresult(found->Clone(caret.put()));
    check_hresult(caret->MoveEndpointByRange(moved,found.get(),anchor));
    check_hresult(caret->Select());
    return;
  }
  check_hresult(found->Select());
}
}
