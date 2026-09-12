#include "common.hpp"
#include <iostream>

namespace {
void check_value(std::wstring_view input, std::wstring_view expected) {
  const auto result = moxxy::string_value(input);
  if (std::wstring_view(result.GetString()) != expected) throw std::runtime_error("String value changed");
  moxxy::Json object;
  object.Insert(L"value", result);
  const auto decoded = moxxy::Json::Parse(object.Stringify()).GetNamedString(L"value");
  if (std::wstring_view(decoded) != expected) throw std::runtime_error("JSON round trip changed string value");
}
}

int main(int argc, char** argv) {
  try {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    if (argc != 2) throw std::runtime_error("Scenario required");
    const std::string scenario = argv[1];
    if (scenario == "empty") check_value({}, L"");
    else if (scenario == "full") {
      const std::wstring text(512, L'A');
      check_value(text, text);
    } else if (scenario == "prefix") {
      const std::wstring text = std::wstring(512, L'A') + L'B';
      check_value(std::wstring_view(text).substr(0, 512), std::wstring(512, L'A'));
    } else if (scenario == "offset") {
      const std::wstring text = L"before:Zażółć:after";
      check_value(std::wstring_view(text).substr(7, 6), L"Zażółć");
    } else if (scenario == "unicode") {
      const std::wstring text = L"Zażółć \U0001F600 trailing";
      check_value(std::wstring_view(text).substr(0, 9), L"Zażółć \U0001F600");
    } else if (scenario == "embedded-null") {
      const std::wstring text{L'A', L'\0', L'B', L'C'};
      check_value(std::wstring_view(text).substr(0, 3), std::wstring{L'A', L'\0', L'B'});
    } else if (scenario == "lifetime") {
      auto result = [] {
        const std::wstring text = L"retained trailing";
        return moxxy::string_value(std::wstring_view(text).substr(0, 8));
      }();
      if (result.GetString() != L"retained") throw std::runtime_error("Result lost ownership of its text");
    } else throw std::runtime_error("Unknown scenario");
    std::cout << scenario << " passed\n";
    return 0;
  } catch (...) {
    std::cerr << "JSON string regression failed\n";
    return 1;
  }
}
