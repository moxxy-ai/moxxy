#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
  AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

channel_id="${1:-}"

if [ -z "$channel_id" ]; then
  echo "Usage: discord_add_listen_channel '<channel_id>'"
  echo "Use discord_channels to find channel IDs by name."
  exit 1
fi

# Validate channel_id is numeric (Discord snowflake)
case "$channel_id" in
  *[!0-9]*) echo "Error: channel_id must be a numeric Discord snowflake."; exit 1 ;;
esac

resp=$(curl -sS -X POST \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -H "Content-Type: application/json" \
  -d "$(printf '{"channel_id":"%s"}' "$channel_id")" \
  "${API_BASE}/agents/${AGENT_NAME}/channels/discord/listen-channels")

if printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  msg=$(printf '%s' "$resp" | jq -r '.message // "Channel added to listen list."')
  echo "$msg"
else
  err=$(printf '%s' "$resp" | jq -r '.error // "failed to add channel"')
  echo "Error: $err"
  exit 1
fi
