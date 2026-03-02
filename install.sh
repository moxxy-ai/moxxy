#!/bin/sh
set -e

# Moxxy Installer
# Usage: curl -fsSL https://moxxy.ai/install.sh | sh

MOXXY_HOME="${MOXXY_HOME:-$HOME/.moxxy}"
BIN_DIR="$MOXXY_HOME/bin"
LOG_DIR="$MOXXY_HOME/logs"
BASE_URL="${MOXXY_DOWNLOAD_URL:-https://moxxy.ai/bin}"
SYMLINK_DIR="/usr/local/bin"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33m==>\033[0m %s\n" "$1"; }
error() { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; exit 1; }

# --- Detect platform ---

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
    *)      error "Unsupported operating system: $OS" ;;
  esac

  case "$ARCH" in
    x86_64)       ARCH="x86_64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)            error "Unsupported architecture: $ARCH" ;;
  esac

  PLATFORM="${OS}-${ARCH}"
  info "Detected platform: $PLATFORM"
}

# --- Download gateway binary ---

download_gateway() {
  BINARY_URL="$BASE_URL/moxxy-gateway-${PLATFORM}"
  TARGET="$BIN_DIR/moxxy-gateway"

  info "Downloading moxxy-gateway from $BINARY_URL"

  mkdir -p "$BIN_DIR" "$LOG_DIR"

  if command -v curl >/dev/null 2>&1; then
    curl -fSL --progress-bar "$BINARY_URL" -o "$TARGET"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --show-progress "$BINARY_URL" -O "$TARGET"
  else
    error "Neither curl nor wget found. Please install one and retry."
  fi

  chmod +x "$TARGET"
  ok "Installed moxxy-gateway to $TARGET"
}

# --- Create symlink ---

create_symlink() {
  SYMLINK="$SYMLINK_DIR/moxxy-gateway"

  if [ -w "$SYMLINK_DIR" ]; then
    ln -sf "$BIN_DIR/moxxy-gateway" "$SYMLINK"
    ok "Symlinked to $SYMLINK"
  else
    info "Creating symlink requires sudo"
    sudo ln -sf "$BIN_DIR/moxxy-gateway" "$SYMLINK"
    ok "Symlinked to $SYMLINK (via sudo)"
  fi
}

# --- Check Node.js ---

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    warn "Node.js is not installed."
    warn "Moxxy CLI requires Node.js >= 22."
    warn "Install it from: https://nodejs.org"
    return 1
  fi

  NODE_VERSION="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_VERSION" -lt 22 ] 2>/dev/null; then
    warn "Node.js v$NODE_VERSION found, but v22+ is required."
    warn "Upgrade from: https://nodejs.org"
    return 1
  fi

  ok "Node.js v$(node -v | sed 's/^v//') found"
  return 0
}

# --- Install CLI ---

install_cli() {
  if ! check_node; then
    warn "Skipping CLI installation (Node.js 22+ required)."
    warn "After installing Node.js, run: npm install -g @moxxy/cli"
    return
  fi

  info "Installing Moxxy CLI via npm..."
  npm install -g @moxxy/cli
  ok "Moxxy CLI installed"
}

# --- Main ---

main() {
  printf "\n"
  printf "\033[1;36m  ███╗   ███╗ ██████╗ ██╗  ██╗██╗  ██╗██╗   ██╗\033[0m\n"
  printf "\033[1;36m  ████╗ ████║██╔═══██╗╚██╗██╔╝╚██╗██╔╝╚██╗ ██╔╝\033[0m\n"
  printf "\033[1;36m  ██╔████╔██║██║   ██║ ╚███╔╝  ╚███╔╝  ╚████╔╝\033[0m\n"
  printf "\033[1;36m  ██║╚██╔╝██║██║   ██║ ██╔██╗  ██╔██╗   ╚██╔╝\033[0m\n"
  printf "\033[1;36m  ██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗██╔╝ ██╗   ██║\033[0m\n"
  printf "\033[1;36m  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝\033[0m\n"
  printf "\n\033[1m  Installer\033[0m\n\n"

  detect_platform
  download_gateway
  create_symlink
  install_cli

  printf "\n"
  ok "Installation complete!"
  printf "\n"
  info "Next steps:"
  printf "  1. Start the gateway:  moxxy gateway start\n"
  printf "  2. Run the setup:      moxxy init\n"
  printf "\n"
}

main
