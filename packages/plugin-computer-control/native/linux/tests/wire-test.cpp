#include "check.hpp"
#include "json.hpp"
#include "text.hpp"
#include "wire.hpp"

using namespace moxxy;

TEST(json_round_trips_every_kind_of_value) {
  const auto parsed = Json::parse(R"({"a":[1,2.5,-3e2,true,false,null],"b":"x\n\"\u00e9\ud83d\ude00","c":{}})");
  CHECK(parsed.has_value());
  CHECK(parsed->find("a")->array()->size() == 6);
  CHECK(*(*parsed->find("a")->array())[2].number() == -300);
  CHECK(*parsed->find("b")->string() == "x\n\"\xC3\xA9\xF0\x9F\x98\x80");
  CHECK(Json::parse(parsed->dump()) == parsed);
  CHECK(Json(Json::Object{{"n", 5}, {"s", "a\tb"}}).dump() == R"({"n":5,"s":"a\tb"})");
}

TEST(json_refuses_what_is_not_json) {
  for (const char* bad : {"", "{", "[1,]", "{\"a\":}", "nul", "\"\\ud800\"", "1 2", "{\"a\":1,}", "\"line\nbreak\""}) CHECK(!Json::parse(bad).has_value());
  CHECK(!Json::parse(std::string(200, '[')).has_value());
}

TEST(json_reads_whole_numbers_only_as_integers) {
  CHECK(Json(5.0).integer() == 5);
  CHECK(!Json(5.5).integer().has_value());
  CHECK(!Json("5").integer().has_value());
}

TEST(text_is_measured_and_cut_in_utf16_units) {
  const std::string emoji = "a\xF0\x9F\x98\x80z";  // a, U+1F600 (two units), z
  CHECK(utf16_length(emoji) == 4);
  CHECK(fit(emoji, 4) == emoji);
  CHECK(fit(emoji, 2) == "a");
  CHECK(fit(emoji, 3) == "a\xF0\x9F\x98\x80");
  CHECK(fit(emoji, 1, true) == "z");
  CHECK(fit(emoji, 3, true) == "\xF0\x9F\x98\x80z");
  CHECK(fit("abc", 0).empty());
}

TEST(text_from_an_app_is_made_valid) {
  CHECK(valid_utf8("za\xC5\xBC\xC3\xB3\xC5\x82\xC4\x87"));
  CHECK(!valid_utf8("\xC0\xAF"));
  CHECK(!valid_utf8("\xED\xA0\x80"));
  CHECK(clean_utf8("a\xFFz") == "a\xEF\xBF\xBDz");
}

TEST(a_long_key_stays_unique_and_within_the_limit) {
  const std::string deep(600, 'k');
  const auto first = wire_key(deep + "/a:1");
  const auto second = wire_key("x" + deep + "/a:1");
  CHECK(utf16_length(first) <= 512);
  CHECK(first != second);
  CHECK(first.ends_with("/a:1"));
  CHECK(wire_key("short") == "short");
}

TEST(base64_pads_to_whole_groups) {
  const uint8_t bytes[] = {'M', 'a', 'n', 'y'};
  CHECK(base64(bytes, 3) == "TWFu");
  CHECK(base64(bytes, 4) == "TWFueQ==");
  CHECK(base64(bytes, 2) == "TWE=");
}

TEST(wire_decodes_requests_and_controls) {
  const auto request = wire::decode(R"({"version":5,"id":"r1","method":"status","params":{"a":1}})");
  CHECK(std::get<Request>(request).method == "status");
  CHECK(std::get<Request>(request).params.find("a")->integer() == 1);
  CHECK(std::get<Control>(wire::decode(R"({"version":5,"control":"takeover"})")) == Control::takeover);
}

TEST(wire_refuses_other_versions_and_malformed_frames) {
  try { wire::decode(R"({"version":4,"id":"r","method":"status"})"); CHECK(false); } catch (ProtocolFault fault) { CHECK(fault == ProtocolFault::version_mismatch); }
  CHECK_THROWS(wire::decode("not json"));
  CHECK_THROWS(wire::decode(R"({"version":5,"id":"","method":"status"})"));
  CHECK_THROWS(wire::decode(R"({"version":5,"control":"dance"})"));
  CHECK_THROWS(wire::decode(R"({"version":5,"control":"stop","extra":1})"));
  CHECK_THROWS(wire::decode("{\"version\":5,\"id\":\"r\",\"method\":\"\xFF\"}"));
}

TEST(wire_answers_in_one_line_with_bounded_errors) {
  CHECK(wire::success("r1", Json::Object{{"ok", 1}}) == "{\"id\":\"r1\",\"ok\":true,\"result\":{\"ok\":1},\"version\":5}\n");
  const auto failure = Json::parse(wire::failure("r1", {"helper_failed", std::string(5000, 'x')}));
  CHECK(failure->find("error")->find("message")->string()->size() == 2048);
  const auto event = Json::parse(wire::event("cursor", {{"cursor", nullptr}}));
  CHECK(*event->find("event")->string() == "cursor");
  CHECK(event->find("version")->integer() == 5);
}

TEST(lines_are_split_and_bounded) {
  LineDecoder decoder(10);
  CHECK(decoder.push("ab").empty());
  const auto frames = decoder.push("c\nde\nf");
  CHECK(frames.size() == 2 && frames[0] == "abc" && frames[1] == "de");
  CHECK_THROWS(decoder.finish());
  CHECK_THROWS(decoder.push("0123456789ab"));
}
