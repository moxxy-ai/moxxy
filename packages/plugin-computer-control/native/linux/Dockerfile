# Build and test image for the Linux helper: the toolchain, the libraries it links, a headless X11 desktop and Node.
FROM ubuntu:24.04
COPY deps.sh /tmp/deps.sh
RUN /tmp/deps.sh --test \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl gnome-calculator \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
