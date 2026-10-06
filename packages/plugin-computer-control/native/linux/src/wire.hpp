#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "json.hpp"

namespace moxxy {

/// A refusal the TypeScript side maps to a known error code and its hint.
struct HelperError {
  std::string code;
  std::string message;
  static HelperError invalid_params(std::string message) { return {"invalid_params", std::move(message)}; }
};

/// Why the stream itself can no longer be trusted; the helper stops instead of guessing.
enum class ProtocolFault { frame_too_large, truncated_frame, malformed_frame, version_mismatch };

enum class Control { pause, resume, stop, takeover };
struct Request {
  std::string id;
  std::string method;
  Json params;
};
using Incoming = std::variant<Request, Control>;

/// The JSON-lines envelope shared with `src/helper/protocol.ts`.
namespace wire {
constexpr int version = 5;
constexpr size_t max_frame_bytes = 3'000'000;

/// Throws `ProtocolFault`.
Incoming decode(std::string_view frame);
std::string success(const std::string& id, Json result);
std::string failure(const std::string& id, const HelperError& error);
/// A frame the helper sends on its own, outside any request.
std::string event(const std::string& name, Json::Object fields);
}  // namespace wire

/// Splits a byte stream into newline-terminated frames. Throws `ProtocolFault`.
class LineDecoder {
 public:
  explicit LineDecoder(size_t limit) : limit_(limit) {}
  std::vector<std::string> push(std::string_view bytes);
  void finish() const;

 private:
  size_t limit_;
  std::string pending_;
};

}  // namespace moxxy
