#include "capture.hpp"
#include <mutex>
#include <thread>

namespace moxxy {
namespace {
constexpr int max_edge = 960, quality = 60;
std::atomic<HWND> target{nullptr};
// 0 while nobody is watching.
std::atomic<int> rate{0};
std::once_flag started;

void emit_frame(uint64_t sequence, const Pixels* pixels, const char* failure) {
  Json event; event.Insert(L"version", numeric(protocol_version));
  event.Insert(L"event", string_value(L"preview_frame"));
  event.Insert(L"seq", JsonValue::CreateNumberValue(static_cast<double>(sequence)));
  if (failure) event.Insert(L"error", string_value(to_hstring(failure)));
  if (pixels) {
    const double scale = std::min(1.0, static_cast<double>(max_edge) / std::max(pixels->width, pixels->height));
    const int width = std::max(1, static_cast<int>(pixels->width * scale)), height = std::max(1, static_cast<int>(pixels->height * scale));
    Json image; image.Insert(L"mediaType", string_value(L"image/jpeg"));
    image.Insert(L"base64", string_value(to_hstring(encode_pixels(*pixels, width, height, true, quality))));
    image.Insert(L"width", numeric(width)); image.Insert(L"height", numeric(height));
    event.Insert(L"image", image);
  }
  write_frame(event);
}
void run() {
  init_apartment(apartment_type::multi_threaded);
  std::unique_ptr<WindowStream> stream;
  uint64_t sequence = 0;
  ULONGLONG last_sent = 0;
  HWND failed = nullptr;
  for (;;) {
    const int fps = rate.load();
    if (WaitForSingleObject(stop_event, fps > 0 ? 1000 / fps : 200) != WAIT_TIMEOUT) return;
    const auto window = target.load();
    if (fps <= 0 || !window) { stream.reset(); failed = nullptr; continue; }
    // A window that could not be captured is not retried until the target changes.
    if (window == failed) continue;
    try {
      if (!IsWindow(window)) throw Error("capture-unavailable", "The window is closed");
      if (!stream || stream->window() != window) { stream = std::make_unique<WindowStream>(window); last_sent = 0; }
      Pixels pixels;
      if (stream->latest(pixels)) { emit_frame(sequence++, &pixels, nullptr); last_sent = GetTickCount64(); }
      // An unchanged window still says it is being watched, once a second.
      else if (GetTickCount64() - last_sent >= 1000) { emit_frame(sequence++, nullptr, nullptr); last_sent = GetTickCount64(); }
    } catch (const Error& error) {
      stream.reset(); failed = window; emit_frame(sequence++, nullptr, error.what());
    } catch (...) {
      stream.reset(); failed = window; emit_frame(sequence++, nullptr, "The window cannot be captured");
    }
  }
}
}
void start_preview(int fps) {
  rate = std::clamp(fps, 1, 5);
  std::call_once(started, [] { std::thread(run).detach(); });
}
void stop_preview() { rate = 0; }
void preview_target(HWND window) { target = window; }
}
