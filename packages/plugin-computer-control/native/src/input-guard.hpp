#pragma once
#include "common.hpp"

namespace moxxy {
void start_input_guard(HANDLE parent, HANDLE stop);
int run_input_guard(int argc, char** argv);
void guarded_input(INPUT input, std::optional<INPUT> release = std::nullopt);
void guarded_release() noexcept;
}
