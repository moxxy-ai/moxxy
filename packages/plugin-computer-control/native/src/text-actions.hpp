#pragma once
#include "common.hpp"

namespace moxxy {
Json read_control_text(IUIAutomationElement* node, int limit);
void select_control_text(IUIAutomationElement* node, HWND window, const std::wstring& text, int occurrence);
}
