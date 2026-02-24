#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

resp=$(curl -sS "${API_BASE}/agents/${AGENT_NAME}/channels/discord/list-channels")

if printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  printf '%s\n' "$resp"
else
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  echo "Error: ${err:-failed to list Discord channels}"
  exit 1
fi
