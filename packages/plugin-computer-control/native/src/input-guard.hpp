#pragma once
#include "common.hpp"
#include "control-panel.hpp"

namespace moxxy {
void start_input_guard(HANDLE parent, HANDLE stop);
int run_input_guard(int argc, char** argv);
void guarded_input(INPUT input, std::optional<INPUT> release = std::nullopt);
void guarded_release() noexcept;
void guard_control(ControlCommand command);
bool guard_paused();
bool guard_stopped_by_user();
bool take_guard_resume();
void publish_guard_state(ControlState state, HWND target = nullptr);
}
