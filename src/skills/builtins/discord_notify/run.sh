#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

if [ "$#" -lt 1 ]; then
  echo "Usage: discord_notify '<message>'"
  echo "   or: discord_notify '<channel_id>' '<message>'"
  exit 1
fi

# Two-arg form: discord_notify <channel_id> <message>
# One-arg form: discord_notify <message>  (uses default paired channel)
if [ "$#" -ge 2 ] && printf '%s' "$1" | grep -qE '^[0-9]+$'; then
  channel_id="$1"
  shift
  message="$1"
  shift
  for part in "$@"; do
    message="$message $part"
  done
  resp=$(curl -sS -X POST \
    --data-urlencode "message=${message}" \
    --data-urlencode "channel_id=${channel_id}" \
    "${API_BASE}/agents/${AGENT_NAME}/channels/discord/send")
else
  message="$1"
  shift
  for part in "$@"; do
    message="$message $part"
  done
  resp=$(curl -sS -X POST \
    --data-urlencode "message=${message}" \
    "${API_BASE}/agents/${AGENT_NAME}/channels/discord/send")
fi

if printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  msg=$(printf '%s' "$resp" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  printf '%s\n' "${msg:-Discord message sent.}"
else
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  echo "Error: ${err:-failed to send Discord message}"
  exit 1
fi
