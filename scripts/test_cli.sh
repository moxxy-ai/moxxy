#!/usr/bin/env bash
set -e

echo "Building moxxy..."
cargo build

echo "Testing CLI Headless mode..."
OUTPUT=$(cargo run --bin moxxy -q -- run --agent default --prompt "Reply with exactly 'HELLO TEST'")

if echo "$OUTPUT" | grep -q "HELLO TEST"; then
    echo "SUCCESS: Programmatic CLI printed expected output."
    exit 0
else
    echo "FAILED: Expected 'HELLO TEST' not found in output."
    echo "Raw output:"
    echo "$OUTPUT"
    exit 1
fi
