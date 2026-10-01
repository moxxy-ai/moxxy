#include "video-format.hpp"
#include <iostream>
#include <stdexcept>

namespace {
void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
using Bytes = std::vector<uint8_t>;
const Bytes sps{0, 0, 0, 1, 0x67, 0x4d, 0x00, 0x1f, 0xaa};
const Bytes pps{0, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80};
const Bytes idr{0, 0, 1, 0x65, 0x88, 0x84};
const Bytes delta{0, 0, 0, 1, 0x41, 0x9a, 0x02};
Bytes join(std::initializer_list<Bytes> parts) { Bytes all; for (const auto& part : parts) all.insert(all.end(), part.begin(), part.end()); return all; }
}

int main() {
  using namespace moxxy;
  // The longer edge fits the limit and both sides are even, as the encoder needs.
  check(video_size(1920, 1080, 960) == std::pair(960, 540), "1920x1080 is not halved");
  check(video_size(801, 601, 960) == std::pair(800, 600), "Odd sides are not made even");
  check(video_size(1, 1, 960) == std::pair(2, 2), "A tiny window has no picture");
  check(video_size(1000, 3000, 960) == std::pair(320, 960), "A tall window does not fit");

  // The name of the stream comes from the three bytes after the header of its sequence parameter set.
  check(h264_codec(join({sps, pps, idr})) == std::optional<std::string>("avc1.4d001f"), "Codec name is wrong");
  check(!h264_codec(delta), "A stream without parameter sets has a name");
  check(!h264_codec(Bytes{0, 0, 0, 1, 0x67, 0x4d}), "A cut parameter set has a name");

  check(h264_key(join({sps, pps, idr})) && h264_key(idr), "A key picture is not seen");
  check(!h264_key(delta) && !h264_key(join({sps, pps})), "A picture that depends on others counts as key");

  // A decoder that joins late needs the parameter sets in front of every key picture.
  const Bytes sets = h264_parameter_sets(join({sps, pps, idr}));
  check(sets == join({sps, pps}), "Parameter sets are not taken out of the stream");
  check(h264_parameter_sets(delta).empty(), "A picture gave parameter sets");
  check(with_parameter_sets(Bytes{0, 0, 0, 1, 0x65, 0x88}, sets) == join({sps, pps, Bytes{0, 0, 0, 1, 0x65, 0x88}}), "Parameter sets are not put in front");
  check(with_parameter_sets(join({sps, pps, idr}), sets) == join({sps, pps, idr}), "Parameter sets are doubled");

  // White, black and red in studio-range BT.601, the layout the encoder takes: luma, then interleaved chroma.
  Bytes nv12;
  const Bytes white(2 * 2 * 4, 255);
  bgra_to_nv12(white.data(), 2, 2, 2, 2, nv12);
  check(nv12 == Bytes{235, 235, 235, 235, 128, 128}, "White is wrong");
  const Bytes black{0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255};
  bgra_to_nv12(black.data(), 2, 2, 2, 2, nv12);
  check(nv12 == Bytes{16, 16, 16, 16, 128, 128}, "Black is wrong");
  const Bytes red{0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255};
  bgra_to_nv12(red.data(), 2, 2, 2, 2, nv12);
  check(nv12 == Bytes{82, 82, 82, 82, 90, 240}, "Red is wrong");

  // A larger picture is sampled down: left half black, right half white.
  Bytes wide(4 * 2 * 4, 0);
  for (int y = 0; y < 2; ++y) for (int x = 2; x < 4; ++x) for (int c = 0; c < 4; ++c) wide[(y * 4 + x) * 4 + c] = 255;
  bgra_to_nv12(wide.data(), 4, 2, 2, 2, nv12);
  check(nv12.size() == 6 && nv12[0] == 16 && nv12[1] == 235 && nv12[2] == 16 && nv12[3] == 235, "Scaling down is wrong");
  std::cout << "video-format passed\n";
}
