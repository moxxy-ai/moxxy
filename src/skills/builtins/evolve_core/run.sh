#!/bin/sh

if [ -z "$MOXXY_SOURCE_DIR" ]; then
    echo "Error: MOXXY_SOURCE_DIR is not set. The source directory could not be detected from the running binary."
    exit 1
fi

PAYLOAD=$(cat << 'EOF'
cd "$MOXXY_SOURCE_DIR" || exit 1

echo "[1/4] Running cargo check..."
CHECK_OUT=$(cargo check 2>&1)
if [ $? -ne 0 ]; then
    echo "Syntax Error during cargo check. Aborting."
    echo "$CHECK_OUT"
    exit 1
fi

echo "[2/4] Running cargo test..."
TEST_OUT=$(cargo test 2>&1)
if [ $? -ne 0 ]; then
    echo "Tests failed. Aborting."
    echo "$TEST_OUT"
    exit 1
fi

echo "[3/4] Running cargo build --release..."
BUILD_OUT=$(cargo build --release 2>&1)
if [ $? -ne 0 ]; then
    echo "Compilation failed. Aborting."
    echo "$BUILD_OUT"
    exit 1
fi

echo "[4/4] Compilation successful. Preparing Watchdog Rollback..."
cp target/release/moxxy target/release/moxxy.bak

# Create a watchdog script that runs detached
cat << 'WDOG' > target/release/watchdog.sh
#!/bin/bash
sleep 2
killall moxxy || true
sleep 1
./target/release/moxxy web &
NEW_PID=$!
sleep 5
if ! kill -0 $NEW_PID 2>/dev/null; then
    echo "Watchdog: New process crashed! Rolling back..."
    cp target/release/moxxy.bak target/release/moxxy
    ./target/release/moxxy web &
fi
WDOG

chmod +x target/release/watchdog.sh
nohup ./target/release/watchdog.sh > /dev/null 2>&1 &
echo "Watchdog deployed. Restart sequence initiating... Connection will drop shortly."
EOF
)

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }

JSON_PAYLOAD=$(printf '{"command":"%s"}' "$(_esc "$PAYLOAD")")

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$JSON_PAYLOAD" ${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/host/execute_bash
