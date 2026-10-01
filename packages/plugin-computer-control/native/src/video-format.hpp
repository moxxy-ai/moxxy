#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace moxxy {
/// Pixels of the preview video: the longer edge at most `max_edge`, both sides even (the encoder needs that).
inline std::pair<int,int> video_size(int width, int height, int max_edge) {
  const double shrink = std::min(1.0, static_cast<double>(max_edge) / std::max({width, height, 1}));
  const auto even = [&](int side) { return std::max(2, static_cast<int>(side * shrink) / 2 * 2); };
  return {even(width), even(height)};
}

/// One unit of an Annex B stream: `begin` at its start code, `payload` just past it, `end` at the next one.
struct NalUnit { size_t begin, payload, end; };
inline std::vector<NalUnit> nal_units(const std::vector<uint8_t>& stream) {
  std::vector<NalUnit> units;
  for (size_t i = 0; i + 3 <= stream.size(); ++i) {
    if (stream[i] != 0 || stream[i + 1] != 0 || stream[i + 2] != 1) continue;
    // A four-byte start code is a zero in front of the three-byte one.
    const size_t begin = i > 0 && stream[i - 1] == 0 ? i - 1 : i;
    if (!units.empty()) units.back().end = begin;
    units.push_back({begin, i + 3, stream.size()});
    i += 2;
  }
  return units;
}
inline int nal_type(const std::vector<uint8_t>& stream, const NalUnit& unit) {
  return unit.payload < unit.end ? stream[unit.payload] & 0x1f : -1;
}
inline constexpr int nal_idr = 5, nal_sps = 7, nal_pps = 8;

/// RFC 6381 name of the stream, e.g. `avc1.4d001f`: profile, constraints and level from the sequence parameter set.
inline std::optional<std::string> h264_codec(const std::vector<uint8_t>& stream) {
  for (const auto& unit : nal_units(stream)) {
    if (nal_type(stream, unit) != nal_sps || unit.end - unit.payload < 4) continue;
    char name[12];
    std::snprintf(name, sizeof name, "avc1.%02x%02x%02x", stream[unit.payload + 1], stream[unit.payload + 2], stream[unit.payload + 3]);
    return std::string(name);
  }
  return std::nullopt;
}
/// Whether the stream holds a picture a decoder can start from.
inline bool h264_key(const std::vector<uint8_t>& stream) {
  for (const auto& unit : nal_units(stream)) if (nal_type(stream, unit) == nal_idr) return true;
  return false;
}
/// The sequence and picture parameter sets of the stream, each behind a four-byte start code.
inline std::vector<uint8_t> h264_parameter_sets(const std::vector<uint8_t>& stream) {
  std::vector<uint8_t> sets;
  for (const auto& unit : nal_units(stream)) {
    const int type = nal_type(stream, unit);
    if (type != nal_sps && type != nal_pps) continue;
    sets.insert(sets.end(), {0, 0, 0, 1});
    sets.insert(sets.end(), stream.begin() + unit.payload, stream.begin() + unit.end);
  }
  return sets;
}
/// A key picture a viewer can start from at any time: the parameter sets go in front unless they are there.
inline std::vector<uint8_t> with_parameter_sets(const std::vector<uint8_t>& picture, const std::vector<uint8_t>& sets) {
  if (!h264_parameter_sets(picture).empty()) return picture;
  std::vector<uint8_t> all(sets);
  all.insert(all.end(), picture.begin(), picture.end());
  return all;
}

/// `source` (BGRA, `source_width` x `source_height`) sampled to `width` x `height` (both even) as NV12 in
/// studio-range BT.601: the luma plane, then one interleaved U,V pair per 2x2 block.
inline void bgra_to_nv12(const uint8_t* source, int source_width, int source_height, int width, int height, std::vector<uint8_t>& output) {
  output.resize(static_cast<size_t>(width) * height * 3 / 2);
  const auto pixel = [&](int x, int y) {
    const int sx = std::min(source_width - 1, static_cast<int>(static_cast<int64_t>(x) * source_width / width));
    const int sy = std::min(source_height - 1, static_cast<int>(static_cast<int64_t>(y) * source_height / height));
    return source + (static_cast<size_t>(sy) * source_width + sx) * 4;
  };
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const uint8_t* p = pixel(x, y);
      output[static_cast<size_t>(y) * width + x] = static_cast<uint8_t>(((66 * p[2] + 129 * p[1] + 25 * p[0] + 128) >> 8) + 16);
    }
  }
  uint8_t* chroma = output.data() + static_cast<size_t>(width) * height;
  for (int y = 0; y < height; y += 2) {
    for (int x = 0; x < width; x += 2) {
      const uint8_t* p = pixel(x, y);
      *chroma++ = static_cast<uint8_t>(((-38 * p[2] - 74 * p[1] + 112 * p[0] + 128) >> 8) + 128);
      *chroma++ = static_cast<uint8_t>(((112 * p[2] - 94 * p[1] - 18 * p[0] + 128) >> 8) + 128);
    }
  }
}
}
