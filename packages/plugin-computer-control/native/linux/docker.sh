#!/usr/bin/env bash
# Runs a command in the Linux build image with the repository mounted, for hosts that are not Linux.
#   native/linux/docker.sh native/linux/build.sh
#   native/linux/docker.sh native/linux/desktop.sh npx vitest run src/linux
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
docker image inspect moxxy-computer-linux >/dev/null 2>&1 || docker build -t moxxy-computer-linux "$HERE"
# The mounted node_modules were installed for the host system. The test runner's one native part is
# fetched for Linux into a volume and found through NODE_PATH, so the host's install stays untouched.
exec docker run --rm -v "$REPO":/work -v moxxy-computer-linux-node:/opt/node -w /work/packages/plugin-computer-control \
  -e NODE_PATH=/opt/node/node_modules moxxy-computer-linux bash -c '
    version=$(node -p "require(\"/work/node_modules/.pnpm/node_modules/rolldown/package.json\").version" 2>/dev/null || true)
    binding=@rolldown/binding-linux-$(uname -m | sed "s/x86_64/x64/;s/aarch64/arm64/")-gnu
    if [ -n "$version" ] && [ "$(node -p "require(\"/opt/node/node_modules/$binding/package.json\").version" 2>/dev/null)" != "$version" ]; then
      npm install --silent --no-audit --no-fund --prefix /opt/node "$binding@$version" >/dev/null
    fi
    exec "$@"
  ' docker "$@"
