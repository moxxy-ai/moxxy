#include "settle.hpp"

#include <algorithm>

namespace moxxy {

void SettleClock::record(double time) { last_change_ = std::max(last_change_.value_or(time), time); }

bool SettleClock::settled(double now) const {
  if (now - start_ >= policy_.maximum) return true;
  if (now < start_ + policy_.minimum) return false;
  return !last_change_ || now - *last_change_ >= policy_.quiet;
}

double SettleClock::next_check(double now) const {
  return std::min(std::max(start_ + policy_.minimum, last_change_.value_or(now) + policy_.quiet), start_ + policy_.maximum);
}

}  // namespace moxxy
