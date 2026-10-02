#pragma once
#include <functional>
#include <iostream>
#include <string>
#include <vector>

/// A minimal test harness: `TEST(name) { CHECK(...); }`, all run by `main` in tests/main.cpp.
namespace check {
struct Case { std::string name; std::function<void()> body; };
inline std::vector<Case>& cases() { static std::vector<Case> all; return all; }
inline int& failures() { static int count = 0; return count; }
struct Register { Register(std::string name, std::function<void()> body) { cases().push_back({std::move(name), std::move(body)}); } };
}  // namespace check

#define TEST(name) \
  static void test_##name(); \
  static check::Register register_##name(#name, test_##name); \
  static void test_##name()

#define CHECK(condition) \
  do { if (!(condition)) { check::failures()++; std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK(" #condition ") failed\n"; } } while (false)

#define CHECK_THROWS(expression) \
  do { bool threw = false; try { expression; } catch (...) { threw = true; } \
       if (!threw) { check::failures()++; std::cerr << __FILE__ << ":" << __LINE__ << ": expected a throw from " #expression "\n"; } } while (false)
