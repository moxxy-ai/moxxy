#!/usr/bin/env bash
# Runs a command inside a headless X11 desktop: a display, a session bus with the accessibility bus,
# and a window manager. Used by the end-to-end tests in the build image and in CI.
#   native/linux/desktop.sh npx vitest run src/linux
set -euo pipefail
export DISPLAY=${DISPLAY_NUMBER:-:99}
export XDG_SESSION_TYPE=x11
export NO_AT_BRIDGE=0
export GTK_A11Y=atspi
unset WAYLAND_DISPLAY

Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
XVFB=$!
trap 'kill $XVFB 2>/dev/null || true' EXIT
for _ in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done

exec dbus-run-session -- bash -c '
  openbox >/dev/null 2>&1 &
  /usr/libexec/at-spi-bus-launcher --launch-immediately >/dev/null 2>&1 &
  for _ in $(seq 50); do
    dbus-send --session --print-reply --dest=org.a11y.Bus /org/a11y/bus org.a11y.Bus.GetAddress >/dev/null 2>&1 && break
    sleep 0.1
  done
  "$@"
' desktop "$@"
