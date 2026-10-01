#include "wire.hpp"

#include "text.hpp"

namespace moxxy {

namespace wire {

Incoming decode(std::string_view frame) {
  if (!valid_utf8(frame)) throw ProtocolFault::malformed_frame;
  const auto value = Json::parse(frame);
  if (!value || !value->object()) throw ProtocolFault::malformed_frame;
  const auto* sent = value->find("version");
  const auto number = sent ? sent->integer() : std::nullopt;
  if (!number) throw ProtocolFault::malformed_frame;
  if (*number != version) throw ProtocolFault::version_mismatch;
  if (const auto* control = value->find("control")) {
    const auto* name = control->string();
    if (!name || value->object()->size() != 2) throw ProtocolFault::malformed_frame;
    if (*name == "pause") return Control::pause;
    if (*name == "resume") return Control::resume;
    if (*name == "stop") return Control::stop;
    if (*name == "takeover") return Control::takeover;
    throw ProtocolFault::malformed_frame;
  }
  const auto* id = value->find("id");
  const auto* method = value->find("method");
  if (!id || !id->string() || id->string()->empty() || utf16_length(*id->string()) > 160) throw ProtocolFault::malformed_frame;
  if (!method || !method->string() || method->string()->empty()) throw ProtocolFault::malformed_frame;
  const auto* params = value->find("params");
  return Request{*id->string(), *method->string(), params ? *params : Json()};
}

namespace {
std::string line(Json::Object fields) {
  fields["version"] = version;
  return Json(std::move(fields)).dump() + "\n";
}
}  // namespace

std::string success(const std::string& id, Json result) {
  return line({{"id", id}, {"ok", true}, {"result", std::move(result)}});
}

std::string failure(const std::string& id, const HelperError& error) {
  return line({{"id", id}, {"ok", false}, {"error", Json::Object{{"code", fit(error.code, 80)}, {"message", fit(error.message, 2048)}}}});
}

std::string event(const std::string& name, Json::Object fields) {
  fields["event"] = name;
  return line(std::move(fields));
}

}  // namespace wire

std::vector<std::string> LineDecoder::push(std::string_view bytes) {
  std::vector<std::string> frames;
  while (!bytes.empty()) {
    const size_t newline = bytes.find('\n');
    const auto part = bytes.substr(0, newline);
    if (pending_.size() + part.size() > limit_) throw ProtocolFault::frame_too_large;
    pending_.append(part);
    if (newline == std::string_view::npos) break;
    frames.push_back(std::move(pending_));
    pending_.clear();
    bytes.remove_prefix(newline + 1);
  }
  return frames;
}

void LineDecoder::finish() const {
  if (!pending_.empty()) throw ProtocolFault::truncated_frame;
}

}  // namespace moxxy
