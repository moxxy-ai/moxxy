#pragma once
#include "common.hpp"

namespace moxxy {
enum class ControlCommand { pause, resume, stop };
struct PanelSnapshot {
  bool visible;
  ControlState state;
  std::wstring application;
};
struct PanelModel {
  std::function<PanelSnapshot()> read;
  std::function<void(ControlCommand)> command;
};
// The caller owns the model for the lifetime of its message loop.
HWND create_control_panel(PanelModel& model);
}
