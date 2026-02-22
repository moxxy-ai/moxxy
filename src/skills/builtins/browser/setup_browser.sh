#!/bin/bash
set -e

DIR=$(dirname "$0")
VENV_PATH="$DIR/venv"

echo "Setting up browser automation environment in $VENV_PATH..."

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is not installed."
    exit 1
fi

if [ ! -d "$VENV_PATH" ]; then
    python3 -m venv "$VENV_PATH" || { echo "Error: Failed to create venv"; exit 1; }
fi

echo "Installing dependencies..."
"$VENV_PATH/bin/pip" install --quiet playwright html2text || { echo "Error: pip install failed"; exit 1; }

echo "Installing Playwright Chromium..."
"$VENV_PATH/bin/playwright" install chromium || { echo "Error: Playwright browser install failed"; exit 1; }

echo "Browser setup complete."
