#pragma once
#include "common.hpp"
#include "video-format.hpp"
#include <mftransform.h>
#include <icodecapi.h>

namespace moxxy {
/// One access unit of the preview video, Annex B.
struct VideoChunk { std::vector<uint8_t> data; bool key = false; std::string codec; int64_t microseconds = 0; };

/// Compresses the preview with the system's H.264 encoder (Media Foundation), tuned for a live picture.
class VideoEncoder {
 public:
  VideoEncoder(int width, int height, int fps);
  ~VideoEncoder();
  VideoEncoder(const VideoEncoder&) = delete;
  VideoEncoder& operator=(const VideoEncoder&) = delete;
  /// The chunks that are ready after taking in `picture`; `key` asks for a picture a viewer can start from.
  std::vector<VideoChunk> encode(const Pixels& picture, int64_t microseconds, bool key);
  int width() const { return frame_width; }
  int height() const { return frame_height; }
 private:
  std::vector<VideoChunk> drain();
  void remember(const std::vector<uint8_t>& sets);
  int frame_width, frame_height, rate;
  com_ptr<IMFTransform> transform;
  com_ptr<ICodecAPI> settings;
  std::vector<uint8_t> parameter_sets, picture_buffer;
  std::string codec;
};
}
