#!/bin/bash
DIR=$(dirname "$0")
BRIDGE_PORT=18791
BRIDGE_URL="http://127.0.0.1:$BRIDGE_PORT"
PID_FILE="$DIR/bridge.pid"

# Read action from args or stdin
if [ -n "$1" ]; then
    ACTION="$1"
    shift
    ARGS=("$@")
else
    # Read JSON array from stdin
    INPUT=$(cat)
    ACTION=$(echo "$INPUT" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0] if a else '')" 2>/dev/null)
    ARGS_JSON=$(echo "$INPUT" | python3 -c "import sys,json; a=json.load(sys.stdin); print(json.dumps(a[1:]))" 2>/dev/null)
fi

if [ -z "$ACTION" ]; then
    echo "Usage: browser <action> [args...]"
    echo "Actions: fetch, navigate, snapshot, click, type, screenshot, scroll, evaluate, back, forward, tabs, close, wait"
    exit 1
fi

# --- fetch action: lightweight, no browser needed ---
if [ "$ACTION" = "fetch" ]; then
    URL="${ARGS[0]:-$ARGS_JSON}"
    if [ -z "$URL" ]; then
        # Try extracting from JSON args
        URL=$(echo "$ARGS_JSON" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0] if a else '')" 2>/dev/null)
    fi
    if [ -z "$URL" ]; then
        echo "Error: fetch requires a URL argument"
        exit 1
    fi
    python3 "$DIR/fetch.py" "$URL"
    exit $?
fi

# --- All other actions: need the browser bridge ---

ensure_venv() {
    if [ ! -d "$DIR/venv" ] || [ ! -f "$DIR/venv/bin/python3" ]; then
        if [ -f "$DIR/setup_browser.sh" ]; then
            echo "Setting up browser environment (first run)..." >&2
            bash "$DIR/setup_browser.sh" >&2
        else
            echo "Error: Browser venv not found and no setup script available"
            exit 1
        fi
    fi
}

start_bridge() {
    ensure_venv
    # Start bridge server in background
    "$DIR/venv/bin/python3" "$DIR/bridge.py" --port "$BRIDGE_PORT" --pid-file "$PID_FILE" &
    BRIDGE_PID=$!
    echo "$BRIDGE_PID" > "$PID_FILE"

    # Wait for bridge to become ready (up to 30 seconds)
    for i in $(seq 1 60); do
        if curl -sf "$BRIDGE_URL/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
    done
    echo "Error: Browser bridge failed to start within 30 seconds"
    kill "$BRIDGE_PID" 2>/dev/null
    rm -f "$PID_FILE"
    exit 1
}

# Check if bridge is running
if ! curl -sf "$BRIDGE_URL/health" >/dev/null 2>&1; then
    # Check stale PID file
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ! kill -0 "$OLD_PID" 2>/dev/null; then
            rm -f "$PID_FILE"
        fi
    fi
    start_bridge
fi

# Build JSON payload
if [ -n "$ARGS_JSON" ]; then
    PAYLOAD=$(python3 -c "
import json, sys
action = '$ACTION'
args = json.loads('$ARGS_JSON')
print(json.dumps({'action': action, 'args': args}))
" 2>/dev/null)
else
    # Build from positional args
    PAYLOAD=$(python3 -c "
import json, sys
action = '$ACTION'
args = sys.argv[1:]
print(json.dumps({'action': action, 'args': args}))
" "${ARGS[@]}" 2>/dev/null)
fi

# Send request to bridge
RESPONSE=$(curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 120 \
    "$BRIDGE_URL/action" 2>&1)

CURL_EXIT=$?
if [ $CURL_EXIT -ne 0 ]; then
    echo "Error: Failed to communicate with browser bridge (exit=$CURL_EXIT)"
    echo "$RESPONSE"
    exit 1
fi

# Extract result
SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('success', False))" 2>/dev/null)
if [ "$SUCCESS" = "True" ]; then
    echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result', ''))" 2>/dev/null
else
    echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print('Error:', r.get('error', 'Unknown error'))" 2>/dev/null
    exit 1
fi
