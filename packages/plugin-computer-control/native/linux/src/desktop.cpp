#include "desktop.hpp"

#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/keysym.h>
#include <algorithm>
#include <cstring>
#include <map>
#include <mutex>
#include <poll.h>
#include <thread>

#include "keys.hpp"
#include "text.hpp"

namespace moxxy {

namespace {

/// The last error on each desktop's own connection, set by the error handler: a window can vanish
/// between two requests, which is no reason to exit. Kept per connection, because the live preview
/// captures on a thread of its own and an error there must not fail a request here, nor the reverse.
std::mutex errors_mutex;
std::map<Display*, int> x_errors;
int on_error(Display* display, XErrorEvent* event) {
  std::lock_guard lock(errors_mutex);
  if (const auto found = x_errors.find(display); found != x_errors.end()) found->second = event->error_code;
  return 0;
}
void clear_error(Display* display) { std::lock_guard lock(errors_mutex); x_errors[display] = 0; }
bool had_error(Display* display) {
  std::lock_guard lock(errors_mutex);
  const auto found = x_errors.find(display);
  return found != x_errors.end() && found->second != 0;
}

int shift_of(unsigned long mask) { int shift = 0; while (mask && !(mask & 1)) { mask >>= 1; shift++; } return shift; }

void pause(double seconds) { std::this_thread::sleep_for(std::chrono::duration<double>(seconds)); }

}  // namespace

double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

void OwnInput::mark() { until = now() + 0.25; }
bool OwnInput::recent() const { return now() < until; }

void HeldInput::key(unsigned keycode, bool down) {
  std::lock_guard lock(mutex_);
  if (down) keys_.insert(keycode); else keys_.erase(keycode);
}

void HeldInput::button(unsigned button, bool down) {
  std::lock_guard lock(mutex_);
  if (down) buttons_.insert(button); else buttons_.erase(button);
}

void HeldInput::release_all() {
  std::lock_guard lock(mutex_);
  if (keys_.empty() && buttons_.empty()) return;
  Display* display = XOpenDisplay(nullptr);
  if (!display) return;
  for (const auto button : buttons_) XTestFakeButtonEvent(display, button, False, CurrentTime);
  for (const auto keycode : keys_) XTestFakeKeyEvent(display, keycode, False, CurrentTime);
  XSync(display, False);
  XCloseDisplay(display);
  keys_.clear();
  buttons_.clear();
}

std::unique_ptr<Desktop> Desktop::open(OwnInput& own, HeldInput& held) {
  XInitThreads();
  Display* display = XOpenDisplay(nullptr);
  if (!display) return nullptr;
  XSetErrorHandler(on_error);
  return std::unique_ptr<Desktop>(new Desktop(display, own, held));
}

Desktop::Desktop(Display* display, OwnInput& own, HeldInput& held) : display_(display), root_(DefaultRootWindow(display)), own_(own), held_(held) {
  int event = 0, error = 0, major = 0, minor = 0;
  clear_error(display_);
  xtest_ = XTestQueryExtension(display_, &event, &error, &major, &minor);
  composite_ = XCompositeQueryExtension(display_, &event, &error) && XCompositeQueryVersion(display_, &major, &minor) && (major > 0 || minor >= 2);
  // Changes of the active window and of the window list wake `wait_for`.
  XSelectInput(display_, root_, PropertyChangeMask | SubstructureNotifyMask);
}

Desktop::~Desktop() {
  restore_scratch();
  XCloseDisplay(display_);
  std::lock_guard lock(errors_mutex);
  x_errors.erase(display_);
}

std::pair<int, int> Desktop::screen_size() const {
  return {DisplayWidth(display_, DefaultScreen(display_)), DisplayHeight(display_, DefaultScreen(display_))};
}

Atom Desktop::atom(const char* name) { return XInternAtom(display_, name, False); }

std::optional<std::vector<unsigned long>> Desktop::cardinals(Window window, Atom property, Atom type) {
  Atom actual = None;
  int format = 0;
  unsigned long count = 0, rest = 0;
  unsigned char* data = nullptr;
  if (XGetWindowProperty(display_, window, property, 0, 4096, False, type, &actual, &format, &count, &rest, &data) != Success || !data) return std::nullopt;
  std::vector<unsigned long> values;
  if (format == 32) values.assign(reinterpret_cast<unsigned long*>(data), reinterpret_cast<unsigned long*>(data) + count);
  XFree(data);
  return format == 32 ? std::optional(values) : std::nullopt;
}

std::string Desktop::text(Window window, Atom property) {
  Atom actual = None;
  int format = 0;
  unsigned long count = 0, rest = 0;
  unsigned char* data = nullptr;
  if (XGetWindowProperty(display_, window, property, 0, 4096, False, AnyPropertyType, &actual, &format, &count, &rest, &data) != Success || !data) return {};
  std::string value = format == 8 ? std::string(reinterpret_cast<char*>(data), count) : std::string();
  XFree(data);
  return value;
}

std::optional<WindowInfo> Desktop::info(Window window) {
  clear_error(display_);
  XWindowAttributes attributes;
  if (!XGetWindowAttributes(display_, window, &attributes) || had_error(display_)) return std::nullopt;
  int x = 0, y = 0;
  Window child = 0;
  XTranslateCoordinates(display_, window, root_, 0, 0, &x, &y, &child);
  WindowInfo found;
  found.id = window;
  found.frame = {double(x), double(y), double(attributes.width), double(attributes.height)};
  found.viewable = attributes.map_state == IsViewable;
  if (const auto pid = cardinals(window, atom("_NET_WM_PID"), XA_CARDINAL); pid && !pid->empty()) found.pid = static_cast<pid_t>(pid->front());
  found.title = clean_utf8(text(window, atom("_NET_WM_NAME")));
  if (found.title.empty()) found.title = clean_utf8(text(window, XA_WM_NAME));
  // WM_CLASS is two strings, each ended by a zero byte.
  const auto wm_class = text(window, XA_WM_CLASS);
  const auto split = wm_class.find('\0');
  found.instance = clean_utf8(wm_class.substr(0, split));
  if (split != std::string::npos) found.app_class = clean_utf8(std::string(wm_class.c_str() + split + 1));
  return had_error(display_) ? std::nullopt : std::optional(found);
}

std::vector<WindowInfo> Desktop::windows() {
  // The window manager's own list, bottom to top; without one, the children of the root.
  auto ids = cardinals(root_, atom("_NET_CLIENT_LIST_STACKING"), XA_WINDOW);
  if (!ids) ids = cardinals(root_, atom("_NET_CLIENT_LIST"), XA_WINDOW);
  std::vector<Window> list;
  if (ids) list.assign(ids->begin(), ids->end());
  else {
    Window root = 0, parent = 0, *children = nullptr;
    unsigned count = 0;
    if (XQueryTree(display_, root_, &root, &parent, &children, &count) && children) { list.assign(children, children + count); XFree(children); }
  }
  std::vector<WindowInfo> found;
  for (auto window = list.rbegin(); window != list.rend(); ++window) {
    if (auto described = info(*window); described && described->frame.width > 1 && described->frame.height > 1) found.push_back(std::move(*described));
  }
  return found;
}

std::optional<Window> Desktop::active() {
  const auto value = cardinals(root_, atom("_NET_ACTIVE_WINDOW"), XA_WINDOW);
  return value && !value->empty() && value->front() != 0 ? std::optional<Window>(value->front()) : std::nullopt;
}

bool Desktop::wait_for(const std::function<bool()>& done, double seconds) {
  const double until = now() + seconds;
  while (true) {
    XSync(display_, False);
    XEvent event;
    while (XPending(display_)) XNextEvent(display_, &event);
    if (done()) return true;
    const double left = until - now();
    if (left <= 0) return false;
    // A window that only repaints sends nothing to the root; look again at least this often.
    pollfd descriptor{ConnectionNumber(display_), POLLIN, 0};
    poll(&descriptor, 1, static_cast<int>(std::min(left, 0.1) * 1000));
  }
}

bool Desktop::activate(Window window, double seconds) {
  const auto is_up = [&] {
    const auto described = info(window);
    return described && described->viewable && active() == window;
  };
  if (is_up()) return true;
  XEvent event{};
  event.xclient.type = ClientMessage;
  event.xclient.window = window;
  event.xclient.message_type = atom("_NET_ACTIVE_WINDOW");
  event.xclient.format = 32;
  // Source 2: a request made on the user's behalf, which window managers honour across desktops.
  event.xclient.data.l[0] = 2;
  event.xclient.data.l[1] = CurrentTime;
  XSendEvent(display_, root_, False, SubstructureRedirectMask | SubstructureNotifyMask, &event);
  XMapRaised(display_, window);
  return wait_for(is_up, seconds);
}

std::optional<WindowPicture> Desktop::capture(Window window) {
  const auto described = info(window);
  if (!described || !described->viewable) return std::nullopt;
  const int width = static_cast<int>(described->frame.width), height = static_cast<int>(described->frame.height);
  clear_error(display_);
  XImage* image = nullptr;
  if (composite_) {
    // A redirected window keeps its own pixels, so the picture is whole even under another window.
    if (redirected_.insert(window).second) XCompositeRedirectWindow(display_, window, CompositeRedirectAutomatic);
    const Pixmap pixmap = XCompositeNameWindowPixmap(display_, window);
    XSync(display_, False);
    if (!had_error(display_) && pixmap) image = XGetImage(display_, pixmap, 0, 0, width, height, AllPlanes, ZPixmap);
    if (pixmap) XFreePixmap(display_, pixmap);
  }
  Rect bounds = described->frame;
  if (!image) {
    // What the screen shows of it: the part inside the screen, with whatever lies on top.
    clear_error(display_);
    const int screen_width = DisplayWidth(display_, DefaultScreen(display_)), screen_height = DisplayHeight(display_, DefaultScreen(display_));
    const int left = std::max(0, int(bounds.x)), top = std::max(0, int(bounds.y));
    const int right = std::min(screen_width, int(bounds.x) + width), bottom = std::min(screen_height, int(bounds.y) + height);
    if (right <= left || bottom <= top) return std::nullopt;
    image = XGetImage(display_, root_, left, top, right - left, bottom - top, AllPlanes, ZPixmap);
    bounds = {double(left), double(top), double(right - left), double(bottom - top)};
  }
  XSync(display_, False);
  if (!image || had_error(display_)) { if (image) XDestroyImage(image); return std::nullopt; }
  WindowPicture picture{{image->width, image->height, std::vector<uint8_t>(size_t(image->width) * image->height * 3)}, bounds};
  const int red = shift_of(image->red_mask), green = shift_of(image->green_mask), blue = shift_of(image->blue_mask);
  uint8_t* out = picture.pixels.rgb.data();
  for (int y = 0; y < image->height; y++) {
    if (image->bits_per_pixel == 32) {
      const auto* row = reinterpret_cast<const uint32_t*>(image->data + size_t(y) * image->bytes_per_line);
      for (int x = 0; x < image->width; x++, out += 3) { out[0] = row[x] >> red; out[1] = row[x] >> green; out[2] = row[x] >> blue; }
    } else {
      for (int x = 0; x < image->width; x++, out += 3) {
        const unsigned long pixel = XGetPixel(image, x, y);
        out[0] = pixel >> red; out[1] = pixel >> green; out[2] = pixel >> blue;
      }
    }
  }
  XDestroyImage(image);
  return picture;
}

bool Desktop::descends(Window window, Window ancestor) {
  for (int depth = 0; window && depth < 32; depth++) {
    if (window == ancestor) return true;
    Window root = 0, parent = 0, *children = nullptr;
    unsigned count = 0;
    if (!XQueryTree(display_, window, &root, &parent, &children, &count)) return false;
    if (children) XFree(children);
    window = parent;
  }
  return false;
}

pid_t Desktop::pid_inside(Window top) {
  // The window manager's frame has no owner of its own; the application's window is a few levels inside.
  std::vector<Window> level{top};
  for (int depth = 0; depth < 4 && !level.empty(); depth++) {
    std::vector<Window> next;
    for (const auto window : level) {
      if (const auto pid = cardinals(window, atom("_NET_WM_PID"), XA_CARDINAL); pid && !pid->empty()) return static_cast<pid_t>(pid->front());
      Window root = 0, parent = 0, *children = nullptr;
      unsigned count = 0;
      if (XQueryTree(display_, window, &root, &parent, &children, &count) && children) { next.insert(next.end(), children, children + count); XFree(children); }
    }
    level = std::move(next);
  }
  return 0;
}

std::pair<pid_t, bool> Desktop::owner_at(double x, double y, Window target) {
  Window root = 0, parent = 0, *children = nullptr;
  unsigned count = 0;
  if (!XQueryTree(display_, root_, &root, &parent, &children, &count) || !children) return {0, false};
  std::pair<pid_t, bool> owner{0, false};
  for (unsigned index = count; index-- > 0;) {
    const Window top = children[index];
    if (top == ignored_) continue;
    XWindowAttributes attributes;
    clear_error(display_);
    if (!XGetWindowAttributes(display_, top, &attributes) || had_error(display_) || attributes.map_state != IsViewable || attributes.c_class != InputOutput) continue;
    if (x < attributes.x || y < attributes.y || x >= attributes.x + attributes.width || y >= attributes.y + attributes.height) continue;
    owner = {pid_inside(top), descends(target, top)};
    break;
  }
  XFree(children);
  return owner;
}

std::pair<int, int> Desktop::pointer() {
  Window root = 0, child = 0;
  int x = 0, y = 0, inside_x = 0, inside_y = 0;
  unsigned mask = 0;
  XQueryPointer(display_, root_, &root, &child, &x, &y, &inside_x, &inside_y, &mask);
  return {x, y};
}

void Desktop::move(double x, double y) {
  own_.mark();
  XTestFakeMotionEvent(display_, DefaultScreen(display_), static_cast<int>(x), static_cast<int>(y), CurrentTime);
  XFlush(display_);
}

void Desktop::button(unsigned button, bool down) {
  own_.mark();
  held_.button(button, down);
  XTestFakeButtonEvent(display_, button, down ? True : False, CurrentTime);
  XFlush(display_);
}

void Desktop::click(unsigned which, int count) {
  for (int index = 0; index < count; index++) {
    button(which, true);
    pause(0.02);
    button(which, false);
    if (index + 1 < count) pause(0.06);
  }
}

std::pair<unsigned, bool> Desktop::keycode(unsigned long keysym) {
  int low = 0, high = 0;
  XDisplayKeycodes(display_, &low, &high);
  for (int code = low; code <= high; code++) {
    if (static_cast<unsigned>(code) == scratch_ && scratch_bound_) continue;
    if (XkbKeycodeToKeysym(display_, code, 0, 0) == keysym) return {code, false};
  }
  for (int code = low; code <= high; code++) {
    if (static_cast<unsigned>(code) == scratch_ && scratch_bound_) continue;
    if (XkbKeycodeToKeysym(display_, code, 0, 1) == keysym) return {code, true};
  }
  // The layout has no key for this symbol: bind it to a key that has none, as xdotool does.
  if (!scratch_) {
    int per_code = 0;
    KeySym* map = XGetKeyboardMapping(display_, low, high - low + 1, &per_code);
    for (int code = high; code >= low && !scratch_; code--) {
      bool empty = true;
      for (int level = 0; level < per_code; level++) if (map[(code - low) * per_code + level] != NoSymbol) empty = false;
      if (empty) scratch_ = code;
    }
    XFree(map);
    if (!scratch_) return {0, false};
  }
  KeySym symbol = keysym;
  XChangeKeyboardMapping(display_, scratch_, 1, &symbol, 1);
  scratch_bound_ = true;
  XSync(display_, False);
  // Applications learn the new layout from an event; a key sent before they read it types nothing.
  pause(0.03);
  return {scratch_, false};
}

void Desktop::restore_scratch() {
  if (!scratch_bound_) return;
  KeySym none = NoSymbol;
  XChangeKeyboardMapping(display_, scratch_, 1, &none, 1);
  XSync(display_, False);
  scratch_bound_ = false;
}

void Desktop::key(unsigned long keysym, bool down) {
  const auto [code, shift] = keycode(keysym);
  if (!code) return;
  own_.mark();
  held_.key(code, down);
  XTestFakeKeyEvent(display_, code, down ? True : False, CurrentTime);
  XFlush(display_);
}

void Desktop::type(const std::vector<char32_t>& text) {
  const unsigned shift_code = XKeysymToKeycode(display_, XK_Shift_L);
  const auto send = [&](unsigned code, bool down) {
    own_.mark();
    held_.key(code, down);
    XTestFakeKeyEvent(display_, code, down ? True : False, CurrentTime);
  };
  for (const auto character : text) {
    const auto [code, shift] = keycode(keysym_for_codepoint(character));
    if (!code) continue;
    if (shift) send(shift_code, true);
    send(code, true);
    send(code, false);
    if (shift) send(shift_code, false);
    XFlush(display_);
    pause(scratch_bound_ && code == scratch_ ? 0.02 : 0.004);
  }
  XSync(display_, False);
  restore_scratch();
}

}  // namespace moxxy
