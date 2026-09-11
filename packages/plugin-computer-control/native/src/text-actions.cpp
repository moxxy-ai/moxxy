#include "text-actions.hpp"

namespace moxxy {
namespace {
struct OwnedString {
  BSTR value=nullptr;
  ~OwnedString() { SysFreeString(value); }
};
com_ptr<IUIAutomationTextPattern> text_pattern(IUIAutomationElement* node) {
  com_ptr<IUIAutomationTextPattern> pattern;
  require(SUCCEEDED(node->GetCurrentPatternAs(UIA_TextPatternId,IID_PPV_ARGS(pattern.put()))) && pattern,
    "unsupported","This control does not support accessible document text; no input fallback was performed");
  return pattern;
}
std::wstring range_text(IUIAutomationTextRange* range, int limit, bool& truncated) {
  OwnedString text;
  check_hresult(range->GetText(limit+1,&text.value));
  auto size=SysStringLen(text.value);
  auto length=std::min<UINT>(size,limit);
  // Never return half of a UTF-16 surrogate pair when applying an output cap.
  if (length && text.value[length-1]>=0xD800 && text.value[length-1]<=0xDBFF) --length;
  truncated=truncated || size>length;
  return length ? std::wstring(text.value,length) : std::wstring();
}
}
Json read_control_text(IUIAutomationElement* node, int limit) {
  auto pattern=text_pattern(node);
  com_ptr<IUIAutomationTextRange> document;
  check_hresult(pattern->get_DocumentRange(document.put()));
  require(document!=nullptr,"unsupported","Control has no document range");
  bool truncated=false;
  auto text=range_text(document.get(),limit,truncated);
  JsonArray selected;
  com_ptr<IUIAutomationTextRangeArray> ranges;
  check_hresult(pattern->GetSelection(ranges.put()));
  if (ranges) {
    int count=0; check_hresult(ranges->get_Length(&count));
    truncated=truncated || count>16;
    int remaining=limit;
    for (int i=0;i<std::min(count,16);++i) {
      com_ptr<IUIAutomationTextRange> range;
      check_hresult(ranges->GetElement(i,range.put()));
      require(range!=nullptr,"native-error","Invalid selected text range");
      auto part=range_text(range.get(),remaining,truncated);
      remaining-=static_cast<int>(part.size());
      if (!part.empty()) selected.Append(string_value(part));
    }
  }
  Json result; result.Insert(L"text",string_value(text)); result.Insert(L"selectedText",selected);
  result.Insert(L"truncated",boolean(truncated)); return result;
}
void select_control_text(IUIAutomationElement* node, HWND window, const std::wstring& text, int occurrence) {
  auto pattern=text_pattern(node);
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
  check_hresult(found->Select());
}
}
