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
# When a terminal is attached it ends by handing off to `moxxy onboard` —
# the guided setup: pick a provider (sign-in or API key; keys are yours, we
# can't skip that), pair a messaging channel, install the always-on service.
# Piped/CI installs (no /dev/tty) or MOXXY_NO_ONBOARD=1 skip the hand-off
# and just print the next steps.
#
# Env overrides:
#   MOXXY_INSTALL_DIR      install root            (default: ~/.moxxy)
#   MOXXY_NO_PLUGINS=1     skip the plugin preload (slim install)
#   MOXXY_NO_MODIFY_PATH=1 don't touch shell profiles
#   MOXXY_NO_ONBOARD=1     don't hand off to `moxxy onboard` at the end
set -euo pipefail
export NPM_CONFIG_UPDATE_NOTIFIER=false # keep npm quiet during the steps

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

# ---------------------------------------------------------------- visuals
# Colors only on a TTY and when NO_COLOR is unset — a piped/captured run
# stays plain text. The dim-gray wordmark matches the CLI's own banner.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; D=$'\033[2m'; G=$'\033[90m'; M=$'\033[35m'; GRN=$'\033[32m'; R=$'\033[31m'; N=$'\033[0m'
else
  B=''; D=''; G=''; M=''; GRN=''; R=''; N=''
fi

say()  { printf '%s\n' "  $*"; }
ok()   { printf '%s\n' "  ${GRN}✓${N} $*"; }
note() { printf '%s\n' "  ${D}$*${N}"; }
fail() { printf '%s\n' "  ${R}✗ $*${N}" >&2; exit 1; }

STEP=0
STEPS_TOTAL=4
step() {
  STEP=$((STEP + 1))
  printf '\n%s\n' "${M}┌─${N} ${B}[$STEP/$STEPS_TOTAL]${N} $* ${D}────────────────────────────────${N}"
}

banner() {
  printf '\n'
  printf '%s\n' \
    "${G}${D}   M   M   OOO   X   X  X   X  Y   Y${N}" \
    "${G}${D}   MM MM  O   O   X X    X X    Y Y ${N}" \
    "${G}${D}   M M M  O   O    X      X      Y  ${N}" \
    "${G}${D}   M   M  O   O   X X    X X     Y  ${N}" \
    "${G}${D}   M   M   OOO   X   X  X   X    Y  ${N}"
  printf '\n%s\n' "   ${B}the personal agent that lives where you do${N}"
  printf '%s\n' "   ${D}installer · everything preinstalled, one step left for you${N}"
}

banner

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

step "Node runtime"
NODE_BIN=""
NPM_BIN=""
if command -v node >/dev/null 2>&1 && [ "$(node_major "$(command -v node)")" -ge "$NODE_MIN_MAJOR" ]; then
  NODE_BIN="$(command -v node)"
  NPM_BIN="$(command -v npm || true)"
  ok "using your Node $("$NODE_BIN" --version) ${D}($NODE_BIN)${N}"
fi

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  # Reuse a previously downloaded runtime when it satisfies the floor.
  if [ -x "$RUNTIME_DIR/current/bin/node" ] \
     && [ "$(node_major "$RUNTIME_DIR/current/bin/node")" -ge "$NODE_MIN_MAJOR" ]; then
    ok "using the moxxy-managed Node runtime"
  else
    say "no Node >= $NODE_MIN_MAJOR found — downloading Node v$NODE_LTS_VERSION ${D}(into $RUNTIME_DIR, no sudo)${N}"
    NODE_PKG="node-v$NODE_LTS_VERSION-$NODE_OS-$NODE_ARCH"
    TMP_TGZ="$(mktemp -t moxxy-node.XXXXXX)"
    fetch "https://nodejs.org/dist/v$NODE_LTS_VERSION/$NODE_PKG.tar.gz" "$TMP_TGZ"
    mkdir -p "$RUNTIME_DIR"
    tar -xzf "$TMP_TGZ" -C "$RUNTIME_DIR"
    rm -f "$TMP_TGZ"
    ln -sfn "$RUNTIME_DIR/$NODE_PKG" "$RUNTIME_DIR/current"
    ok "Node v$NODE_LTS_VERSION ready"
  fi
  NODE_BIN="$RUNTIME_DIR/current/bin/node"
  NPM_BIN="$RUNTIME_DIR/current/bin/npm"
  # npm shells back out to `node`; make sure the managed one resolves first.
  export PATH="$RUNTIME_DIR/current/bin:$PATH"
fi

# -------------------------------------------------------------------- cli
step "moxxy CLI"
note "→ $CLI_PREFIX"
mkdir -p "$CLI_PREFIX" "$BIN_DIR"
"$NPM_BIN" install --prefix "$CLI_PREFIX" --no-fund --no-audit --loglevel=error @moxxy/cli@latest
ln -sfn "$CLI_PREFIX/node_modules/.bin/moxxy" "$BIN_DIR/moxxy"

CLI_VERSION="$("$NODE_BIN" -p "require('$CLI_PREFIX/node_modules/@moxxy/cli/package.json').version")"
ok "moxxy ${B}$CLI_VERSION${N} installed"

# ---------------------------------------------------------------- plugins
step "plugin preload"
if [ "${MOXXY_NO_PLUGINS:-0}" != "1" ]; then
  say "preloading ${B}${#PLUGINS[@]}${N} plugins ${D}(providers · modes · memory · surfaces · channels)${N}"
  note "→ $PLUGINS_DIR"
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
  if "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "${PINNED[@]}" 2>/dev/null; then
    ok "all ${#PLUGINS[@]} plugins pinned to $CLI_VERSION"
  else
    note "pinned set not fully available — installing per package"
    SKIPPED=()
    for p in "${PLUGINS[@]}"; do
      if "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "$p@$CLI_VERSION" 2>/dev/null \
         || "$NPM_BIN" install --prefix "$PLUGINS_DIR" --no-fund --no-audit --loglevel=error --save "$p" 2>/dev/null; then
        ok "${p#@moxxy/}"
      else
        SKIPPED+=("$p")
      fi
    done
    if [ "${#SKIPPED[@]}" -gt 0 ]; then
      note "skipped (not on npm yet — install later via /plugins):"
      for p in "${SKIPPED[@]}"; do printf '%s\n' "    ${D}· ${p#@moxxy/}${N}"; done
    fi
  fi
else
  note "MOXXY_NO_PLUGINS=1 — skipping the plugin preload (install later via /plugins)"
fi

# ------------------------------------------------------------------- PATH
step "shell PATH"
PATH_LINE="export PATH=\"$BIN_DIR:$RUNTIME_DIR/current/bin:\$PATH\" # moxxy"
# A non-default install root must also tell moxxy where home is.
if [ "$MOXXY_DIR" != "$HOME/.moxxy" ]; then
  PATH_LINE="$PATH_LINE
export MOXXY_HOME=\"$MOXXY_DIR\" # moxxy"
fi
if [ "${MOXXY_NO_MODIFY_PATH:-0}" != "1" ]; then
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    if grep -qF '# moxxy' "$rc" 2>/dev/null; then
      ok "already wired: ${rc/#$HOME/~}"
    else
      printf '\n%s\n' "$PATH_LINE" >> "$rc"
      ok "wired: ${rc/#$HOME/~}"
    fi
  done
  if command -v fish >/dev/null 2>&1 && [ -d "$HOME/.config/fish" ]; then
    FISH_CONF="$HOME/.config/fish/conf.d/moxxy.fish"
    [ -f "$FISH_CONF" ] || printf 'fish_add_path -g %s %s # moxxy\n' "$BIN_DIR" "$RUNTIME_DIR/current/bin" > "$FISH_CONF"
  fi
fi

# ------------------------------------------------------------------ done
# Box rows self-align: pad by the PLAIN text width so interpolated values
# (the version) can be any length without shearing the right border.
BOX_W=58
boxrow() { # boxrow <styled> <plain>
  local styled="$1" plain="$2"
  local pad=$((BOX_W - ${#plain}))
  [ "$pad" -lt 0 ] && pad=0
  printf '%s\n' "  ${M}│${N}${styled}$(printf '%*s' "$pad" '')${M}│${N}"
}
rule() { printf '%s' "$(printf '─%.0s' $(seq 1 $BOX_W))"; }

printf '\n'
printf '%s\n' "  ${M}╭$(rule)╮${N}"
boxrow "  ${GRN}✓${N} ${B}moxxy $CLI_VERSION is ready${N} — everything preinstalled" \
       "  ✓ moxxy $CLI_VERSION is ready — everything preinstalled"
boxrow "" ""
boxrow "    ${B}exec \$SHELL${N}   ${D}reload PATH (or open a new terminal)${N}" \
       "    exec \$SHELL   reload PATH (or open a new terminal)"
boxrow "    ${B}moxxy onboard${N} ${D}provider → channel → always-on service${N}" \
       "    moxxy onboard provider → channel → always-on service"
boxrow "" ""
printf '%s\n' "  ${M}╰$(rule)╯${N}"
note "install dir: $MOXXY_DIR"
note "uninstall:   rm -rf $MOXXY_DIR + the '# moxxy' PATH lines"
printf '\n'

# ---------------------------------------------------------------- onboard
# Hand off to the guided setup when a human can actually answer prompts.
# Under `curl | bash` stdin is the script pipe, so re-attach the terminal
# from /dev/tty; skip cleanly when there is none (CI, containers), when
# stdout isn't a terminal (logged installs), or on explicit opt-out.
if [ "${MOXXY_NO_ONBOARD:-0}" != "1" ] && [ -t 1 ] && { : </dev/tty; } 2>/dev/null; then
  say "handing off to ${B}moxxy onboard${N} ${D}(Ctrl+C skips it — re-run anytime)${N}"
  printf '\n'
  # A non-default install root must reach onboard before the rc files do.
  if [ "$MOXXY_DIR" != "$HOME/.moxxy" ]; then export MOXXY_HOME="$MOXXY_DIR"; fi
  PATH="$BIN_DIR:$RUNTIME_DIR/current/bin:$PATH" "$BIN_DIR/moxxy" onboard </dev/tty \
    || note "onboarding skipped — run 'moxxy onboard' whenever you're ready"
fi
