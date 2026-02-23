#!/bin/bash
set -eu

DIR=$(dirname "$0")
SCRIPT="$DIR/google_workspace.py"
VENV="$DIR/venv"
REQUIREMENTS="$DIR/requirements.txt"

ensure_venv() {
    if [ ! -d "$VENV" ] || [ ! -f "$VENV/bin/python3" ]; then
        echo "Setting up Google Workspace skill environment (first run)..." >&2
        python3 -m venv "$VENV" >&2
        "$VENV/bin/pip" install --quiet --upgrade pip >&2
        "$VENV/bin/pip" install --quiet google-auth google-auth-oauthlib google-api-python-client >&2
    fi
}

if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ] || [ -z "${GOOGLE_REFRESH_TOKEN:-}" ]; then
    echo "Error: Missing Google OAuth credentials in vault."
    echo ""
    echo "Required vault keys:"
    echo "  - GOOGLE_CLIENT_ID"
    echo "  - GOOGLE_CLIENT_SECRET"
    echo "  - GOOGLE_REFRESH_TOKEN"
    echo ""
    echo "Setup instructions:"
    echo "  1. Go to https://console.cloud.google.com/apis/credentials"
    echo "  2. Create an OAuth 2.0 Client ID (Desktop application)"
    echo "  3. Note your Client ID and Client Secret"
    echo "  4. Run the setup script to obtain a refresh token:"
    echo "     python3 $DIR/setup_oauth.py --client-id YOUR_ID --client-secret YOUR_SECRET"
    echo "  5. Store the credentials in your vault:"
    echo '     <invoke name="manage_vault">["set", "GOOGLE_CLIENT_ID", "your_client_id"]</invoke>'
    echo '     <invoke name="manage_vault">["set", "GOOGLE_CLIENT_SECRET", "your_client_secret"]</invoke>'
    echo '     <invoke name="manage_vault">["set", "GOOGLE_REFRESH_TOKEN", "your_refresh_token"]</invoke>'
    echo ""
    echo "Required API scopes (enable in Google Cloud Console):"
    echo "  - Gmail API"
    echo "  - Google Drive API"
    echo "  - Google Calendar API"
    echo "  - Google Chat API"
    echo "  - Google Docs API"
    echo "  - Google Sheets API"
    exit 1
fi

ensure_venv >&2

if [ $# -eq 0 ]; then
    "$VENV/bin/python3" "$SCRIPT"
    exit $?
fi

SERVICE="$1"
shift

if [ -z "$SERVICE" ]; then
    "$VENV/bin/python3" "$SCRIPT"
    exit $?
fi

# Handle stdin mode for large payloads
if [ "$MOXXY_ARGS_MODE" = "stdin" ] && [ $# -eq 0 ]; then
    INPUT=$(cat)
    # Parse JSON array from stdin
    SERVICE=$(echo "$INPUT" | python3 -c "import sys,json; a=json.load(sys.stdin); print(a[0] if a else '')" 2>/dev/null || echo "")
    ARGS_JSON=$(echo "$INPUT" | python3 -c "import sys,json; a=json.load(sys.stdin); print(json.dumps(a[1:]))" 2>/dev/null || "[]")
    
    if [ -n "$SERVICE" ]; then
        "$VENV/bin/python3" "$SCRIPT" "$SERVICE" $(echo "$ARGS_JSON" | python3 -c "import sys,json; a=json.load(sys.stdin); print(' '.join(['\"' + str(x).replace('\"', '\\\"') + '\"' for x in a]))" 2>/dev/null || "")
    fi
    exit $?
fi

"$VENV/bin/python3" "$SCRIPT" "$SERVICE" "$@"
