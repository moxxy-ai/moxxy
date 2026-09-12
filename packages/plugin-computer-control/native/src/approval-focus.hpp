#pragma once
#include <cstdint>
#include <string_view>

namespace moxxy {
class ApprovalFocus {
  uintptr_t target=0, observed=0;
  uint32_t host=0;
  bool valid=false;
  std::string_view last_reason="not-prepared";
 public:
  std::string_view reason() const { return last_reason; }
  bool awaiting_foreground(uintptr_t foreground) const { return valid && observed!=foreground; }
  void begin(uintptr_t window, uint32_t host_pid, uintptr_t foreground) {
    target=window; host=host_pid; observed=foreground;
    valid=target!=0 && host!=0 && foreground==target;
    last_reason=valid ? "prepared" : "target-not-focused-before-question";
  }
  void changed(uintptr_t window, uint32_t pid) {
    observed=window;
    if (valid && window!=target && pid!=host) { valid=false; last_reason="focus-left-approved-host"; }
  }
  bool finish(uintptr_t foreground, uint32_t pid, bool approved, bool unchanged) {
    if (valid) {
      last_reason=!approved ? "not-approved" : !unchanged ? "target-changed-or-stopped" :
        observed!=foreground ? "foreground-event-pending" :
        (foreground!=target && pid!=host) ? "foreign-foreground" : "approved";
    } else if (last_reason=="approved") last_reason="approval-already-consumed";
    const bool restore=valid && last_reason=="approved";
    valid=false;
    return restore;
  }
};
}
