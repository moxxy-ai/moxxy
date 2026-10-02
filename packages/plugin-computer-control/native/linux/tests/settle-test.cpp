#include <cmath>

#include "check.hpp"
#include "settle.hpp"

using namespace moxxy;

TEST(an_app_that_says_nothing_is_settled_once_the_minimum_passed) {
  const SettleClock clock(10, SettlePolicy::after_action());
  CHECK(!clock.settled(10.5));
  CHECK(clock.settled(11.0));
  CHECK(SettleClock(10, SettlePolicy::observe_only()).settled(10));
}

TEST(a_change_keeps_the_app_unsettled_until_it_has_been_quiet) {
  SettleClock clock(10, SettlePolicy::after_action());
  clock.record(10.9);
  CHECK(!clock.settled(11.1));
  CHECK(clock.settled(11.25));
  CHECK(std::abs(clock.next_check(11.0) - 11.2) < 1e-9);
}

TEST(settling_never_waits_past_the_maximum) {
  SettleClock clock(10, SettlePolicy::after_action());
  clock.record(14.9);
  CHECK(clock.settled(15.0));
  CHECK(clock.next_check(14.95) == 15.0);
}
