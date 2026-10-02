#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <optional>
#include <thread>
#include <unistd.h>

#include "session.hpp"
#include "wire.hpp"

using namespace moxxy;

namespace {

/// Exit codes the TypeScript transport understands: 20 means the user stopped Computer Use.
constexpr int exit_normal = 0, exit_usage = 64, exit_protocol_fault = 65, exit_user_stopped = 20;

/// One writer for stdout so responses and events never interleave mid-line. A frame ends with its own newline.
std::mutex output_mutex;
void write_line(const std::string& framed) {
  std::lock_guard lock(output_mutex);
  size_t sent = 0;
  while (sent < framed.size()) {
    const auto written = write(STDOUT_FILENO, framed.data() + sent, framed.size() - sent);
    if (written <= 0) return;
    sent += static_cast<size_t>(written);
  }
}

HeldInput held;
Accessibility* bus = nullptr;

/// A mouse button or key the model left down is never left pressed for the user.
[[noreturn]] void leave(int code) {
  held.release_all();
  if (bus) bus->restore();
  _exit(code);
}

[[noreturn]] void fail(const char* message, int code) {
  // Diagnostics only; never application content.
  const std::string line = std::string("moxxy-computer: ") + message + "\n";
  (void)!write(STDERR_FILENO, line.data(), line.size());
  _exit(code);
}

pid_t parent_pid(int argc, char** argv) {
  for (int index = 1; index + 1 < argc; index++) {
    if (std::strcmp(argv[index], "--parent")) continue;
    char* end = nullptr;
    const long pid = std::strtol(argv[index + 1], &end, 10);
    if (*argv[index + 1] && !*end && pid > 0) return static_cast<pid_t>(pid);
  }
  fail("usage: moxxy-computer --parent <pid>", exit_usage);
}

/// Requests wait here for the request thread; `nullopt` is the end of input.
class Requests {
 public:
  void push(std::optional<Request> request) {
    { std::lock_guard lock(mutex_); queue_.push_back(std::move(request)); }
    ready_.notify_one();
  }
  std::optional<Request> pop() {
    std::unique_lock lock(mutex_);
    ready_.wait(lock, [&] { return !queue_.empty(); });
    auto request = std::move(queue_.front());
    queue_.pop_front();
    return request;
  }

 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<std::optional<Request>> queue_;
};

}  // namespace

int main(int argc, char** argv) {
  const pid_t parent = parent_pid(argc, argv);
  if (!watch_parent(parent, [] { leave(exit_normal); })) return exit_normal;

  /// The request being handled, for `control_state` frames while it waits.
  std::mutex current_mutex;
  std::string current;
  ControlGate gate([&](const std::string& state) {
    std::lock_guard lock(current_mutex);
    if (!current.empty()) write_line(wire::event("control_state", {{"id", current}, {"state", state}}));
  });
  OwnInput own;
  // The user's Escape stops Computer Use like the Stop button.
  UserActivity activity(own, [] { leave(exit_user_stopped); });
  PreviewStream preview(write_line);

  Session session;
  session.desktop = Desktop::open(own, held);
  session.accessibility = Accessibility::open();
  bus = session.accessibility.get();
  if (session.desktop) session.cursor = std::make_unique<AgentCursor>(*session.desktop, write_line);
  session.gate = &gate;
  if (session.desktop && activity.start()) session.activity = &activity;
  session.preview = &preview;
  session.host = parent;

  Requests requests;
  // The reader stays free for pause and stop while a request runs.
  std::thread([&] {
    LineDecoder decoder(wire::max_frame_bytes);
    char buffer[65536];
    try {
      while (true) {
        const auto count = read(STDIN_FILENO, buffer, sizeof buffer);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) { decoder.finish(); break; }
        for (const auto& frame : decoder.push(std::string_view(buffer, static_cast<size_t>(count)))) {
          auto incoming = wire::decode(frame);
          if (auto* request = std::get_if<Request>(&incoming)) { requests.push(std::move(*request)); continue; }
          switch (std::get<Control>(incoming)) {
            case Control::stop: leave(exit_user_stopped);
            case Control::pause: gate.pause(); break;
            case Control::takeover:
              gate.pause();
              if (session.cursor) session.cursor->hide();
              held.release_all();
              break;
            case Control::resume:
              if (session.cursor) session.cursor->reveal();
              gate.resume();
              break;
          }
        }
      }
    } catch (const ProtocolFault&) {
      fail("protocol fault", exit_protocol_fault);
    }
    // End of input is the graceful shutdown signal: finish queued work, then leave.
    requests.push(std::nullopt);
  }).detach();

  while (auto request = requests.pop()) {
    { std::lock_guard lock(current_mutex); current = request->id; }
    std::string answer;
    try {
      answer = wire::success(request->id, session.handle(request->method, request->params));
    } catch (const HelperError& error) {
      answer = wire::failure(request->id, error);
    } catch (const std::exception&) {
      answer = wire::failure(request->id, {"helper_failed", "The helper failed on this request"});
    }
    { std::lock_guard lock(current_mutex); current.clear(); }
    write_line(answer);
  }
  preview.stop();
  leave(exit_normal);
}
