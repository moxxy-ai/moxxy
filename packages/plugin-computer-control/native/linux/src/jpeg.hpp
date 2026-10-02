#pragma once
#include <cstdint>
#include <vector>

#include "geometry.hpp"
#include "json.hpp"

namespace moxxy {

std::vector<uint8_t> encode_jpeg(const Pixels& pixels, int quality);
/// A picture in the contract's shape (`imageSchema` in `src/backend/rpc.ts`).
Json image_json(const Pixels& pixels, int quality);

}  // namespace moxxy
