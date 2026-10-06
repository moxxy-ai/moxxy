#include "guard.hpp"

#include <X11/extensions/XInput2.h>
#include <X11/keysym.h>
#include <cerrno>
#include <csignal>
#include <cstring>
#include <poll.h>
#include <set>
#include <sys/syscall.h>
#include <thread>
#include <unistd.h>

namespace moxxy {

void ControlGate::pause() {
  std::lock_guard lock(mutex_);
  paused_ = true;
}

void ControlGate::resume() {
  { std::lock_guard lock(mutex_); paused_ = false; }
  resumed_.notify_all();
}

bool ControlGate::wait_while_paused() {
  std::unique_lock lock(mutex_);
  if (!paused_) return false;
  lock.unlock();
  emit_("paused_by_user");
  lock.lock();
  resumed_.wait(lock, [&] { return !paused_; });
  lock.unlock();
  emit_("recovering");
  return true;
}

bool UserActivity::start() {
  Display* display = XOpenDisplay(nullptr);
  if (!display) return false;
  int opcode = 0, event = 0, error = 0, major = 2, minor = 1;
  if (!XQueryExtension(display, "XInputExtension", &opcode, &event, &error) || XIQueryVersion(display, &major, &minor) != Success) {
    XCloseDisplay(display);
    return false;
  }
  unsigned char bits[XIMaskLen(XI_LASTEVENT)] = {};
  XISetMask(bits, XI_RawKeyPress);
  XISetMask(bits, XI_RawButtonPress);
  XISetMask(bits, XI_RawMotion);
  XIEventMask mask{XIAllMasterDevices, sizeof bits, bits};
  XISelectEvents(display, DefaultRootWindow(display), &mask, 1);
  XFlush(display);
  std::thread([this, display, opcode] { watch(display, opcode); }).detach();
  return true;
}

void UserActivity::watch(Display* display, int opcode) {
  // Synthetic input arrives through the server's own test devices; a real mouse or keyboard never does.
  std::set<int> synthetic;
  int count = 0;
  if (XIDeviceInfo* devices = XIQueryDevice(display, XIAllDevices, &count)) {
    for (int index = 0; index < count; index++) if (std::strstr(devices[index].name, "XTEST")) synthetic.insert(devices[index].deviceid);
    XIFreeDeviceInfo(devices);
  }
  const KeyCode escape = XKeysymToKeycode(display, XK_Escape);
  while (true) {
    XEvent event;
    XNextEvent(display, &event);
    if (event.xcookie.type != GenericEvent || event.xcookie.extension != opcode || !XGetEventData(display, &event.xcookie)) continue;
    const auto* raw = static_cast<XIRawEvent*>(event.xcookie.data);
    const bool ours = synthetic.contains(raw->sourceid) && own_.recent();
    const bool stop = !ours && event.xcookie.evtype == XI_RawKeyPress && raw->detail == escape;
    XFreeEventData(display, &event.xcookie);
    if (ours) continue;
    last_ = now();
    if (stop) on_escape_();
  }
}

double UserActivity::seconds_since_input() const { return now() - last_; }

bool watch_parent(pid_t parent, std::function<void()> on_exit) {
  const int descriptor = static_cast<int>(syscall(SYS_pidfd_open, parent, 0));
  if (descriptor < 0) {
    if (errno == ESRCH) return false;
    // A kernel without process descriptors: ask to be signalled when the parent goes instead.
    return kill(parent, 0) == 0;
  }
  std::thread([descriptor, on_exit = std::move(on_exit)] {
    pollfd waiting{descriptor, POLLIN, 0};
    while (poll(&waiting, 1, -1) < 0 && errno == EINTR) {}
    on_exit();
  }).detach();
  return true;
}

}  // namespace moxxy
