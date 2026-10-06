#pragma once
#include <optional>

namespace moxxy {

/// How long to let an app settle: at least `minimum` after an action, then until no change for `quiet`
/// seconds, never past `maximum` (the same policy as the macOS helper).
struct SettlePolicy {
  double minimum, quiet, maximum;
  static constexpr SettlePolicy after_action() { return {1.0, 0.3, 5.0}; }
  static constexpr SettlePolicy observe_only() { return {0, 0.3, 5.0}; }
};

/// The settle decision as a function of time, so it is tested without an app.
class SettleClock {
 public:
  SettleClock(double start, SettlePolicy policy) : start_(start), policy_(policy) {}
  void record(double time);
  bool settled(double now) const;
  /// When the decision can next change; a change may wake the waiter earlier.
  double next_check(double now) const;

 private:
  double start_;
  SettlePolicy policy_;
  std::optional<double> last_change_;
};

}  // namespace moxxy
