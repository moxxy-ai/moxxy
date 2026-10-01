#include "capture.hpp"
#include "video.hpp"
#include <mutex>
#include <thread>

namespace moxxy {
namespace {
constexpr int max_edge = 960, quality = 60;
std::atomic<HWND> target{nullptr};
// 0 while nobody is watching.
std::atomic<int> rate{0};
std::atomic<bool> video{false}, wants_key{false};
std::once_flag started;

Json preview_event(const wchar_t* name, uint64_t sequence) {
  Json event; event.Insert(L"version", numeric(protocol_version));
  event.Insert(L"event", string_value(name));
  event.Insert(L"seq", JsonValue::CreateNumberValue(static_cast<double>(sequence)));
  return event;
}
void emit_frame(uint64_t sequence, const Pixels* pixels, const char* failure) {
  Json event = preview_event(L"preview_frame", sequence);
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
void emit_chunk(uint64_t sequence, const VideoChunk& chunk, int width, int height) {
  Json event = preview_event(L"preview_chunk", sequence);
  event.Insert(L"key", boolean(chunk.key));
  event.Insert(L"codec", string_value(to_hstring(chunk.codec)));
  event.Insert(L"data", string_value(to_hstring(base64(chunk.data.data(), chunk.data.size()))));
  event.Insert(L"timestamp", JsonValue::CreateNumberValue(static_cast<double>(chunk.microseconds)));
  event.Insert(L"width", numeric(width)); event.Insert(L"height", numeric(height));
  write_frame(event);
}
void run() {
  init_apartment(apartment_type::multi_threaded);
  std::unique_ptr<WindowStream> stream;
  std::unique_ptr<VideoEncoder> encoder;
  // Chunks count on their own: a gap in their numbers tells the viewer that one was lost.
  uint64_t sequence = 0, chunk_sequence = 0;
  ULONGLONG last_sent = 0, video_started = 0;
  HWND failed = nullptr;
  // The picture last sent as video, for a viewer that joins while the window stands still.
  Pixels shown;
  // This system cannot encode video, so the viewer gets pictures.
  bool pictures_only = false;
  for (;;) {
    const int fps = rate.load();
    if (WaitForSingleObject(stop_event, fps > 0 ? 1000 / fps : 200) != WAIT_TIMEOUT) return;
    const auto window = target.load();
    if (fps <= 0 || !window) { stream.reset(); encoder.reset(); failed = nullptr; continue; }
    // A window that could not be captured is not retried until the target changes.
    if (window == failed) continue;
    try {
      if (!IsWindow(window)) throw Error("capture-unavailable", "The window is closed");
      if (!stream || stream->window() != window) { stream = std::make_unique<WindowStream>(window); encoder.reset(); last_sent = 0; }
      const bool as_video = video.load() && !pictures_only;
      if (!as_video) encoder.reset();
      Pixels pixels;
      if (!stream->latest(pixels)) {
        if (as_video && encoder && shown.width > 0 && wants_key.load()) pixels = shown;
        else {
          // An unchanged window still says it is being watched, once a second.
          if (GetTickCount64() - last_sent >= 1000) { emit_frame(sequence++, nullptr, nullptr); last_sent = GetTickCount64(); }
          continue;
        }
      }
      last_sent = GetTickCount64();
      if (!as_video) { emit_frame(sequence++, &pixels, nullptr); continue; }
      const auto [width, height] = video_size(pixels.width, pixels.height, max_edge);
      bool key = wants_key.exchange(false);
      if (!encoder || encoder->width() != width || encoder->height() != height) {
        try { encoder = std::make_unique<VideoEncoder>(width, height, fps); }
        catch (...) { encoder.reset(); pictures_only = true; emit_frame(sequence++, &pixels, nullptr); continue; }
        video_started = GetTickCount64();
        key = true;
      }
      try {
        for (const auto& chunk : encoder->encode(pixels, static_cast<int64_t>(GetTickCount64() - video_started) * 1000, key)) {
          // A chunk too large for one protocol frame is dropped; the next one starts the picture again.
          if (chunk.data.size() > 2'000'000) { wants_key = true; continue; }
          emit_chunk(chunk_sequence++, chunk, width, height);
        }
        shown = std::move(pixels);
      } catch (...) {
        encoder.reset(); pictures_only = true; emit_frame(sequence++, &pixels, nullptr);
      }
    } catch (const Error& error) {
      stream.reset(); encoder.reset(); failed = window; emit_frame(sequence++, nullptr, error.what());
    } catch (...) {
      stream.reset(); encoder.reset(); failed = window; emit_frame(sequence++, nullptr, "The window cannot be captured");
    }
  }
}
}
void start_preview(int fps, bool as_video) {
  video = as_video;
  wants_key = true;
  rate = std::clamp(fps, 1, 30);
  std::call_once(started, [] { std::thread(run).detach(); });
}
void preview_keyframe() { wants_key = true; }
void stop_preview() { rate = 0; }
void preview_target(HWND window) { target = window; }
}
