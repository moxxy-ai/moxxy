#include "check.hpp"

int main() {
  for (const auto& test : check::cases()) {
    const int before = check::failures();
    try { test.body(); } catch (...) { check::failures()++; std::cerr << test.name << ": unexpected exception\n"; }
    std::cout << (check::failures() == before ? "ok   " : "FAIL ") << test.name << "\n";
  }
  std::cout << check::cases().size() << " tests, " << check::failures() << " failed checks\n";
  return check::failures() == 0 ? 0 : 1;
}
