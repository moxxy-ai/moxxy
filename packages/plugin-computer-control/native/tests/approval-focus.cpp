#include "approval-focus.hpp"
#include <stdexcept>

void check(bool value) { if (!value) throw std::runtime_error("Permission focus state violated"); }
int main() {
  moxxy::ApprovalFocus state;
  state.begin(10, 20, 10);
  state.changed(30, 20);
  check(state.finish(30, 20, true, true));
  check(!state.finish(30, 20, true, true)); // one-use approval
  state.begin(10, 20, 10);
  state.changed(99, 99); state.changed(30, 20);
  check(!state.finish(30, 20, true, true)); // human visited a different app
  state.begin(10, 20, 99); state.changed(30, 20);
  check(!state.finish(30, 20, true, true)); // target never had focus
  state.begin(10, 20, 10); state.changed(30, 20);
  check(!state.finish(30, 20, false, true)); // denied
  state.begin(10, 20, 10); state.changed(30, 20);
  check(!state.finish(30, 20, true, false)); // geometry/identity changed
  state.begin(10, 20, 10);
  check(!state.finish(30, 20, true, true)); // foreground event not processed yet
  check(state.reason()=="foreground-event-pending");
  state.begin(10,20,10); state.changed(99,99); state.changed(30,20);
  check(!state.finish(30,20,true,true));
  check(state.reason()=="focus-left-approved-host");
  state.begin(10,20,10);
  check(state.awaiting_foreground(30));
  state.changed(30,20);
  check(state.foreground_observed()==30);
  check(!state.awaiting_foreground(30));
  check(state.finish(30,20,true,true));
  state.begin(10,20,10); state.changed(99,99);
  check(!state.awaiting_foreground(30)); // a human switch is a refusal, not a retry
}
