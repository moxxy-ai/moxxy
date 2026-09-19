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
Json read_control_text(IUIAutomationElement* node, HWND window, int limit) {
  auto pattern=text_pattern(node);
  if (!pattern) {
    auto [hwnd,text]=standard_edit(node,window);
    DWORD_PTR selected=0;
    require(SendMessageTimeoutW(hwnd,EM_GETSEL,0,0,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&selected)!=0,
      "target-unavailable","Native EDIT selection read timed out");
    size_t begin=LOWORD(selected),end=HIWORD(selected);
    require(begin<=end && end<=text.size(),"stale-element","Native text changed while reading selection");
    auto cap=[&](std::wstring value) {
      if (value.size()>static_cast<size_t>(limit)) value.resize(limit);
      if (!value.empty() && value.back()>=0xD800 && value.back()<=0xDBFF) value.pop_back();
      return value;
    };
    auto visible=cap(text),selection=cap(text.substr(begin,end-begin));
    JsonArray ranges; if (!selection.empty()) ranges.Append(string_value(selection));
    Json result; result.Insert(L"text",string_value(visible)); result.Insert(L"selectedText",ranges);
    result.Insert(L"truncated",boolean(visible.size()<text.size() || selection.size()<end-begin)); return result;
  }
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
    require(SendMessageTimeoutW(hwnd,EM_SETSEL,found,start,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&result)!=0,
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
  check_hresult(found->Select());
}
}
