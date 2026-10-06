#pragma once
#include "common.hpp"

namespace moxxy {
enum class TextPlacement { text, cursor_before, cursor_after };
/// The whole text of a text control, for finding what to select.
std::wstring control_text(IUIAutomationElement* node, HWND window);
/// Selects the `occurrence`-th match of `text`, or puts the caret before or after it.
void select_control_text(IUIAutomationElement* node, HWND window, const std::wstring& text, int occurrence, TextPlacement placement);
}
