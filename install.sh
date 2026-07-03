#!/usr/bin/env bash
#
# moxxy installer — https://moxxy.ai
#
#   curl -fsSL https://moxxy.ai/install.sh | bash
#
# Installs everything upfront so the first `moxxy` just works:
#   1. a Node >= 20 runtime (uses yours if present; otherwise downloads an
#      official Node build into ~/.moxxy/runtime — no sudo, no system changes)
#   2. the moxxy CLI into ~/.moxxy/cli (never `sudo npm -g`)
#   3. the full first-party plugin set into ~/.moxxy/plugins (providers,
#      modes, memory, browser/terminal/web surfaces, channels, …) pinned to
#      the CLI's version — so nothing needs a download later
#   4. PATH wiring in your shell profile (idempotent, clearly marked)
#
# The only thing left for you: run `moxxy` and pick a provider — either a
# ChatGPT/Claude sign-in or an API key. Keys are yours; we can't skip that.
#
# Env overrides:
#   MOXXY_INSTALL_DIR      install root            (default: ~/.moxxy)
#   MOXXY_NO_PLUGINS=1     skip the plugin preload (slim install)
#   MOXXY_NO_MODIFY_PATH=1 don't touch shell profiles
set -euo pipefail

NODE_MIN_MAJOR=20
NODE_LTS_VERSION="22.14.0" # downloaded only when no suitable node exists
MOXXY_DIR="${MOXXY_INSTALL_DIR:-$HOME/.moxxy}"
BIN_DIR="$MOXXY_DIR/bin"
CLI_PREFIX="$MOXXY_DIR/cli"
RUNTIME_DIR="$MOXXY_DIR/runtime"
PLUGINS_DIR="$MOXXY_DIR/plugins"

# Preloaded so the first session already has every capability installed.
# Keep in sync with the desktop seed list (apps/desktop/scripts/
# bundle-plugins-seed.mjs) — this IS the CLI-side equivalent of that seed.
PLUGINS=(
  @moxxy/plugin-provider-anthropic
  @moxxy/plugin-provider-openai
  @moxxy/plugin-provider-google
  @moxxy/plugin-provider-xai
  @moxxy/plugin-provider-zai
  @moxxy/plugin-provider-local
  @moxxy/mode-goal
  @moxxy/mode-deep-research
  @moxxy/plugin-subagents
  @moxxy/plugin-memory
  @moxxy/plugin-view
  @moxxy/plugin-channel-web
  @moxxy/plugin-channel-http
  @moxxy/plugin-browser
  @moxxy/plugin-terminal
  @moxxy/plugin-oauth
  @moxxy/plugin-usage-stats
  @moxxy/plugin-self-update
  @moxxy/plugin-voice-admin
  @moxxy/plugin-stt-whisper
  @moxxy/plugin-telegram
  @moxxy/plugin-channel-slack
  @moxxy/plugin-provider-admin
  @moxxy/plugin-mcp
)

say()  { printf '\033[1m[moxxy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[moxxy]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- platform
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) NODE_OS="darwin" ;;
  Linux)  NODE_OS="linux" ;;
  *) fail "unsupported OS: $OS — on Windows, install via WSL or see https://moxxy.ai/docs/install" ;;
esac
case "$ARCH" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64|amd64)  NODE_ARCH="x64" ;;
  *) fail "unsupported architecture: $ARCH" ;;
esac

command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
  || fail "need curl or wget"
command -v tar >/dev/null 2>&1 || fail "need tar"

fetch() { # fetch <url> <dest>
  if command -v curl >/dev/null 2>&1; then curl -fSL --progress-bar "$1" -o "$2"
  else wget -qO "$2" "$1"; fi
}

# ------------------------------------------------------------------- node
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

NODE_BIN=""
NPM_BIN=""
if command -v node >/dev/null 2>&1 && [ "$(node_major "$(command -v node)")" -ge "$NODE_MIN_MAJOR" ]; then
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(command -v npm || true)"
  say "using your Node $("$NODE_BIN" --version) ($NODE_BIN)"
fi

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  # Reuse a previously downloaded runtime when it satisfies the floor.
  if [ -x "$RUNTIME_DIR/current/bin/node" ] \
     && [ "$(node_major "$RUNTIME_DIR/current/bin/node")" -ge "$NODE_MIN_MAJOR" ]; then
    say "using the moxxy-managed Node runtime"
  else
    say "no Node >= $NODE_MIN_MAJOR found — downloading Node v$NODE_LTS_VERSION into $RUNTIME_DIR (no sudo)"
    NODE_PKG="node-v$NODE_LTS_VERSION-$NODE_OS-$NODE_ARCH"
    TMP_TGZ="$(mktemp -t moxxy-node.XXXXXX)"
    fetch "https://nodejs.org/dist/v$NODE_LTS_VERSION/$NODE_PKG.tar.gz" "$TMP_TGZ"
    mkdir -p "$RUNTIME_DIR"
    tar -xzf "$TMP_TGZ" -C "$RUNTIME_DIR"
    rm -f "$TMP_TGZ"
    ln -sfn "$RUNTIME_DIR/$NODE_PKG" "$RUNTIME_DIR/current"
  fi
  NODE_BIN="$RUNTIME_DIR/current/bin/node"
  NPM_BIN="$RUNTIME_DIR/current/bin/npm"
  # npm shells back out to `node`; make sure the managed one resolves first.
  export PATH="$RUNTIME_DIR/current/bin:$PATH"
fi

# -------------------------------------------------------------------- cli
say "installing @moxxy/cli into $CLI_PREFIX"
mkdir -p "$CLI_PREFIX" "$BIN_DIR"
"$NPM_BIN" install --prefix "$CLI_PREFIX" --no-fund --no-audit --loglevel=error @moxxy/cli@latest
ln -sfn "$CLI_PREFIX/node_modules/.bin/moxxy" "$BIN_DIR/moxxy"

CLI_VERSION="$("$NODE_BIN" -p "require('$CLI_PREFIX/node_modules/@moxxy/cli/package.json').version")"
say "moxxy $CLI_VERSION installed"

# ---------------------------------------------------------------- plugins
if [ "${MOXXY_NO_PLUGINS:-0}" != "1" ]; then
  say "preloading ${#PLUGINS[@]} plugins into $PLUGINS_DIR (providers, modes, memory, surfaces, channels)"
  mkdir -p "$PLUGINS_DIR"
  if [ ! -f "$PLUGINS_DIR/package.json" ]; then
    cat > "$PLUGINS_DIR/package.json" <<'EOF'
{
  "name": "moxxy-user-plugins",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Auto-generated workspace for moxxy plugins installed at runtime."
}
EOF
  fi
  PINNED=()
  for p in "${PLUGINS[@]}"; do PINNED+=("$p@$CLI_VERSION"); done
  # Fast path: the whole set pinned to the CLI version in one npm run
  # (first-party packages co-version). If ANY member is missing at that
  # version — or not published yet at all — fall back to per-package installs
  # with the same 404→latest→skip semantics moxxy's own installer uses, so
  # one unavailable package never sinks the rest of the preload.
  if ! "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "${PINNED[@]}" 2>/dev/null; then
    say "pinned set not fully available — installing per package"
    SKIPPED=()
    for p in "${PLUGINS[@]}"; do
      if "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "$p@$CLI_VERSION" 2>/dev/null \
         || "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "$p" 2>/dev/null; then
        printf '  + %s\n' "$p"
      else
        SKIPPED+=("$p")
      fi
    done
    if [ "${#SKIPPED[@]}" -gt 0 ]; then
      say "skipped (not on npm yet — install later via /plugins): ${SKIPPED[*]}"
    fi
  fi
else
  say "MOXXY_NO_PLUGINS=1 — skipping the plugin preload (install later via /plugins)"
fi

# ------------------------------------------------------------------- PATH
PATH_LINE="export PATH=\"$BIN_DIR:$RUNTIME_DIR/current/bin:\$PATH\" # moxxy"
# A non-default install root must also tell moxxy where home is.
if [ "$MOXXY_DIR" != "$HOME/.moxxy" ]; then
  PATH_LINE="$PATH_LINE
export MOXXY_HOME=\"$MOXXY_DIR\" # moxxy"
fi
if [ "${MOXXY_NO_MODIFY_PATH:-0}" != "1" ]; then
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    grep -qF '# moxxy' "$rc" 2>/dev/null || printf '\n%s\n' "$PATH_LINE" >> "$rc"
  done
  if command -v fish >/dev/null 2>&1 && [ -d "$HOME/.config/fish" ]; then
    FISH_CONF="$HOME/.config/fish/conf.d/moxxy.fish"
    [ -f "$FISH_CONF" ] || printf 'fish_add_path -g %s %s # moxxy\n' "$BIN_DIR" "$RUNTIME_DIR/current/bin" > "$FISH_CONF"
  fi
fi

# ------------------------------------------------------------------ done
say ""
say "done. Everything is preinstalled — one step left:"
say ""
say "    exec \$SHELL        # reload PATH (or open a new terminal)"
say "    moxxy              # pick a provider: ChatGPT/Claude sign-in or an API key"
say ""
say "install dir: $MOXXY_DIR   ·   uninstall: rm -rf $MOXXY_DIR + the '# moxxy' PATH lines"
