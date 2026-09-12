#pragma once
#include <cstdint>

namespace moxxy {
class ApprovalFocus {
  uintptr_t target=0, observed=0;
  uint32_t host=0;
  bool valid=false;
 public:
  void begin(uintptr_t window, uint32_t host_pid, uintptr_t foreground) {
    target=window; host=host_pid; observed=foreground;
    valid=target!=0 && host!=0 && foreground==target;
  }
  void changed(uintptr_t window, uint32_t pid) {
    observed=window;
    if (window!=target && pid!=host) valid=false;
  }
  bool finish(uintptr_t foreground, uint32_t pid, bool approved, bool unchanged) {
    const bool restore=valid && approved && unchanged && observed==foreground &&
      (foreground==target || pid==host);
    valid=false;
    return restore;
  }
};
}
