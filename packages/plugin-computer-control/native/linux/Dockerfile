# Build and test image for the Linux helper: the toolchain, the libraries it links, and a headless X11 desktop.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config ca-certificates curl \
      libatspi2.0-dev libglib2.0-dev libx11-dev libxtst-dev libxext-dev libxfixes-dev libxcomposite-dev libxi-dev libjpeg-turbo8-dev \
      libgtk-3-dev \
      xvfb openbox dbus-x11 at-spi2-core libgtk-3-0 x11-utils x11-apps gnome-calculator xdotool \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
