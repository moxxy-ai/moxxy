#!/usr/bin/env bash
# Installs what the Linux helper needs on Debian or Ubuntu: the toolchain and libraries to build it,
# and with --test the headless X11 desktop its end-to-end tests run in. Run as root.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
PACKAGES="build-essential cmake pkg-config libatspi2.0-dev libglib2.0-dev libx11-dev libxtst-dev libxext-dev libxfixes-dev libxcomposite-dev libxi-dev libjpeg-turbo8-dev"
if [ "${1:-}" = "--test" ]; then
  PACKAGES="$PACKAGES libgtk-3-dev xvfb openbox dbus-x11 at-spi2-core x11-utils xdotool procps"
fi
apt-get update
# shellcheck disable=SC2086
apt-get install -y --no-install-recommends $PACKAGES
