#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

if [ "$#" -lt 1 ]; then
  echo "Usage: discord_notify '<message>'"
  exit 1
fi

message="$1"
shift
for part in "$@"; do
  message="$message $part"
done

resp=$(curl -sS -X POST \
  --data-urlencode "message=${message}" \
  "${API_BASE}/agents/${AGENT_NAME}/channels/discord/send")

# Parse JSON without jq (not available in sandboxed/minimal environments)
if printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  msg=$(printf '%s' "$resp" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  printf '%s\n' "${msg:-Discord message sent.}"
else
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  echo "Error: ${err:-failed to send Discord message}"
  exit 1
fi
