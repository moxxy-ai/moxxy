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

resp=$(curl -sS \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  "${API_BASE}/agents/${AGENT_NAME}/channels/discord/list-channels")

if printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  printf '%s\n' "$resp"
else
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  echo "Error: ${err:-failed to list Discord channels}"
  exit 1
fi
