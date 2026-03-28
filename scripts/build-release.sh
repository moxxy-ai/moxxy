#!/usr/bin/env bash
set -euo pipefail

LOGO='
  ███╗   ███╗ ██████╗ ██╗  ██╗██╗  ██╗██╗   ██╗
  ████╗ ████║██╔═══██╗╚██╗██╔╝╚██╗██╔╝╚██╗ ██╔╝
  ██╔████╔██║██║   ██║ ╚███╔╝  ╚███╔╝  ╚████╔╝
  ██║╚██╔╝██║██║   ██║ ██╔██╗  ██╔██╗   ╚██╔╝
  ██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗██╔╝ ██╗   ██║
  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
'
echo "$LOGO"
echo "  Release Builder"
echo "  ────────────────────────────────────────"
echo ""

# ── Configuration ──

OUT_DIR="${1:-dist}"
VERSION="${MOXXY_VERSION:-$(grep '^version' crates/moxxy-gateway/Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')}"

# Target triples → output names (matching install.sh expectations)
# Format: "rust_target:bun_target:output_suffix"
TARGETS=(
  "aarch64-apple-darwin:bun-darwin-arm64:darwin-arm64"
  "x86_64-apple-darwin:bun-darwin-x64:darwin-x86_64"
  "aarch64-unknown-linux-gnu:bun-linux-arm64:linux-arm64"
  "x86_64-unknown-linux-gnu:bun-linux-x64:linux-x86_64"
)

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33m==>\033[0m %s\n" "$1"; }
error() { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; }

# ── Parse args ──

BUILD_ALL=false
BUILD_CLI=false
SELECTED_TARGETS=()

for arg in "${@:2}"; do
  case "$arg" in
    --all) BUILD_ALL=true ;;
    --cli) BUILD_CLI=true ;;
    *)     SELECTED_TARGETS+=("$arg") ;;
  esac
done

# ── Determine which targets to build ──

if [ "$BUILD_ALL" = true ]; then
  info "Building all targets"
elif [ ${#SELECTED_TARGETS[@]} -gt 0 ]; then
  info "Building selected targets: ${SELECTED_TARGETS[*]}"
else
  # Default: build for current platform only
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
    *)      error "Unsupported OS: $OS"; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64)        ARCH="x86_64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             error "Unsupported arch: $ARCH"; exit 1 ;;
  esac
  SELECTED_TARGETS=("${OS}-${ARCH}")
  info "Building for current platform: ${SELECTED_TARGETS[*]}"
fi

echo ""

# ── Ensure output directory ──

mkdir -p "$OUT_DIR"
info "Output directory: $OUT_DIR"
info "Version: $VERSION"
echo ""

# ── Build each target ──

BUILT=0
FAILED=0

for entry in "${TARGETS[@]}"; do
  IFS=':' read -r RUST_TARGET BUN_TARGET OUTPUT_SUFFIX <<< "$entry"

  # Skip if not selected
  if [ "$BUILD_ALL" = false ]; then
    MATCH=false
    for sel in "${SELECTED_TARGETS[@]}"; do
      if [ "$sel" = "$OUTPUT_SUFFIX" ]; then
        MATCH=true
        break
      fi
    done
    if [ "$MATCH" = false ]; then
      continue
    fi
  fi

  # ── Gateway binary ──

  OUTPUT_NAME="moxxy-gateway-${OUTPUT_SUFFIX}"
  info "Building $OUTPUT_NAME ($RUST_TARGET)..."

  # Check if target is installed
  if ! rustup target list --installed 2>/dev/null | grep -q "^${RUST_TARGET}$"; then
    warn "Target $RUST_TARGET not installed. Installing..."
    rustup target add "$RUST_TARGET" 2>/dev/null || {
      error "Failed to install target $RUST_TARGET. Skipping."
      FAILED=$((FAILED + 1))
      continue
    }
  fi

  # Build
  if cargo build --release --target "$RUST_TARGET" -p moxxy-gateway 2>&1; then
    SRC="target/${RUST_TARGET}/release/moxxy-gateway"
    if [ -f "$SRC" ]; then
      cp "$SRC" "${OUT_DIR}/${OUTPUT_NAME}"
      chmod +x "${OUT_DIR}/${OUTPUT_NAME}"

      SIZE=$(ls -lh "${OUT_DIR}/${OUTPUT_NAME}" | awk '{print $5}')
      ok "$OUTPUT_NAME ($SIZE)"
      BUILT=$((BUILT + 1))
    else
      error "Binary not found at $SRC"
      FAILED=$((FAILED + 1))
    fi
  else
    error "Build failed for $RUST_TARGET"
    FAILED=$((FAILED + 1))
  fi

  # ── CLI binary (--all or --cli) ──

  if [ "$BUILD_ALL" = true ] || [ "$BUILD_CLI" = true ]; then
    CLI_NAME="moxxy-cli-${OUTPUT_SUFFIX}"
    info "Building $CLI_NAME ($BUN_TARGET)..."

    if command -v bun >/dev/null 2>&1; then
      (
        cd apps/moxxy-cli
        bun install --frozen-lockfile 2>/dev/null || bun install
        bun build --compile --target="$BUN_TARGET" src/cli.js --outfile "../../${OUT_DIR}/${CLI_NAME}"
      )
      if [ -f "${OUT_DIR}/${CLI_NAME}" ]; then
        chmod +x "${OUT_DIR}/${CLI_NAME}"
        SIZE=$(ls -lh "${OUT_DIR}/${CLI_NAME}" | awk '{print $5}')
        ok "$CLI_NAME ($SIZE)"
        BUILT=$((BUILT + 1))
      else
        error "CLI binary not found at ${OUT_DIR}/${CLI_NAME}"
        FAILED=$((FAILED + 1))
      fi
    else
      warn "Bun not found - skipping CLI build for $OUTPUT_SUFFIX"
      FAILED=$((FAILED + 1))
    fi
  fi

  echo ""
done

# ── Generate checksums ──

if [ "$BUILT" -gt 0 ]; then
  info "Generating checksums..."
  cd "$OUT_DIR"
  shasum -a 256 moxxy-gateway-* moxxy-cli-* > checksums.sha256 2>/dev/null || \
    sha256sum moxxy-gateway-* moxxy-cli-* > checksums.sha256 2>/dev/null || \
    warn "Could not generate checksums (shasum/sha256sum not found)"
  cd ..
  ok "Checksums written to $OUT_DIR/checksums.sha256"
  echo ""
fi

# ── Summary ──

echo "  ────────────────────────────────────────"
echo ""

if [ "$BUILT" -gt 0 ]; then
  ok "$BUILT binary(ies) built in $OUT_DIR/"
  echo ""
  ls -lh "$OUT_DIR"/moxxy-* 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
  echo ""
fi

if [ "$FAILED" -gt 0 ]; then
  warn "$FAILED target(s) failed"
fi

if [ "$BUILT" -gt 0 ]; then
  info "Upload the contents of $OUT_DIR/ to your release."
  echo ""
fi
