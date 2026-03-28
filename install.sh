#!/bin/sh
set -e

# Moxxy Installer
# Usage: curl -fsSL https://moxxy.ai/install.sh | sh

MOXXY_HOME="${MOXXY_HOME:-$HOME/.moxxy}"
BIN_DIR="$MOXXY_HOME/bin"
LOG_DIR="$MOXXY_HOME/logs"
VERSION="${MOXXY_VERSION:-latest}"
SYMLINK_DIR="/usr/local/bin"

if [ "$VERSION" = "latest" ]; then
  BASE_URL="${MOXXY_DOWNLOAD_URL:-https://github.com/moxxyai/moxxy/releases/latest/download}"
else
  BASE_URL="${MOXXY_DOWNLOAD_URL:-https://github.com/moxxyai/moxxy/releases/download/${VERSION}}"
fi

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33m==>\033[0m %s\n" "$1"; }
error() { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; exit 1; }

# Cleanup partial downloads on failure or interrupt
CLEANUP_FILES=""
cleanup() { rm -f $CLEANUP_FILES; }
trap cleanup EXIT INT TERM

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

# --- Download helper ---

download() {
  URL="$1"
  DEST="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fSL --progress-bar "$URL" -o "$DEST"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$URL" -O "$DEST"
  else
    error "Neither curl nor wget found. Please install one and retry."
  fi
}

# --- Download binaries ---

download_binaries() {
  mkdir -p "$BIN_DIR" "$LOG_DIR"

  # Gateway
  GATEWAY_URL="$BASE_URL/moxxy-gateway-${PLATFORM}"
  GATEWAY_TARGET="$BIN_DIR/moxxy-gateway"
  CLEANUP_FILES="$GATEWAY_TARGET"
  info "Downloading moxxy-gateway..."
  download "$GATEWAY_URL" "$GATEWAY_TARGET"
  chmod +x "$GATEWAY_TARGET"
  ok "Installed moxxy-gateway to $GATEWAY_TARGET"

  # CLI
  CLI_URL="$BASE_URL/moxxy-cli-${PLATFORM}"
  CLI_TARGET="$BIN_DIR/moxxy"
  CLEANUP_FILES="$GATEWAY_TARGET $CLI_TARGET"
  info "Downloading moxxy CLI..."
  download "$CLI_URL" "$CLI_TARGET"
  chmod +x "$CLI_TARGET"
  ok "Installed moxxy CLI to $CLI_TARGET"
}

# --- Verify checksums ---

verify_checksums() {
  CHECKSUM_URL="$BASE_URL/checksums.sha256"
  CHECKSUM_FILE="$BIN_DIR/.checksums.sha256"

  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    warn "Neither shasum nor sha256sum found - skipping checksum verification"
    return 0
  fi

  info "Verifying checksums..."
  if ! download "$CHECKSUM_URL" "$CHECKSUM_FILE" 2>/dev/null; then
    rm -f "$CHECKSUM_FILE"
    if [ "${MOXXY_NO_VERIFY:-0}" = "1" ]; then
      warn "Could not download checksums - skipping verification (MOXXY_NO_VERIFY=1)"
      return 0
    fi
    error "Could not download checksums. Set MOXXY_NO_VERIFY=1 to skip verification."
  fi

  # Extract expected checksums for our files
  GATEWAY_EXPECTED="$(grep "moxxy-gateway-${PLATFORM}" "$CHECKSUM_FILE" | awk '{print $1}')"
  CLI_EXPECTED="$(grep "moxxy-cli-${PLATFORM}" "$CHECKSUM_FILE" | awk '{print $1}')"

  if [ -z "$GATEWAY_EXPECTED" ]; then
    rm -f "$CHECKSUM_FILE"
    error "No checksum found for moxxy-gateway-${PLATFORM} in checksums file"
  fi

  if [ -z "$CLI_EXPECTED" ]; then
    rm -f "$CHECKSUM_FILE"
    error "No checksum found for moxxy-cli-${PLATFORM} in checksums file"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    GATEWAY_ACTUAL="$(sha256sum "$BIN_DIR/moxxy-gateway" | awk '{print $1}')"
    CLI_ACTUAL="$(sha256sum "$BIN_DIR/moxxy" | awk '{print $1}')"
  else
    GATEWAY_ACTUAL="$(shasum -a 256 "$BIN_DIR/moxxy-gateway" | awk '{print $1}')"
    CLI_ACTUAL="$(shasum -a 256 "$BIN_DIR/moxxy" | awk '{print $1}')"
  fi

  if [ "$GATEWAY_EXPECTED" != "$GATEWAY_ACTUAL" ]; then
    rm -f "$CHECKSUM_FILE"
    error "Checksum mismatch for moxxy-gateway! Expected $GATEWAY_EXPECTED, got $GATEWAY_ACTUAL"
  fi

  if [ "$CLI_EXPECTED" != "$CLI_ACTUAL" ]; then
    rm -f "$CHECKSUM_FILE"
    error "Checksum mismatch for moxxy CLI! Expected $CLI_EXPECTED, got $CLI_ACTUAL"
  fi

  rm -f "$CHECKSUM_FILE"
  ok "Checksums verified"
}

# --- Create symlinks ---

create_symlinks() {
  if [ -w "$SYMLINK_DIR" ]; then
    ln -sf "$BIN_DIR/moxxy-gateway" "$SYMLINK_DIR/moxxy-gateway"
    ln -sf "$BIN_DIR/moxxy" "$SYMLINK_DIR/moxxy"
    ok "Symlinked to $SYMLINK_DIR"
  else
    info "Creating symlinks requires sudo"
    sudo ln -sf "$BIN_DIR/moxxy-gateway" "$SYMLINK_DIR/moxxy-gateway"
    sudo ln -sf "$BIN_DIR/moxxy" "$SYMLINK_DIR/moxxy"
    ok "Symlinked to $SYMLINK_DIR (via sudo)"
  fi

  case ":$PATH:" in
    *":$SYMLINK_DIR:"*) ;;
    *) warn "$SYMLINK_DIR is not in your PATH. Add it to your shell profile." ;;
  esac
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
  download_binaries
  verify_checksums

  # Checksums passed — stop cleaning up binaries on exit
  CLEANUP_FILES=""

  create_symlinks

  printf "\n"
  ok "Installation complete!"
  printf "\n"
  info "Next steps:"
  printf "  1. Start the gateway:  moxxy gateway start\n"
  printf "  2. Run the setup:      moxxy init\n"
  printf "\n"
}

main
