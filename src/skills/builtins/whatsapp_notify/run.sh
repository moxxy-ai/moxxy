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

if [ "$#" -lt 1 ]; then
  echo "Usage: whatsapp_notify '<message>'"
  exit 1
fi

message="$1"
shift
for part in "$@"; do
  message="$message $part"
done

resp=$(curl -sS -X POST \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  --data-urlencode "message=${message}" \
  "${API_BASE}/agents/${AGENT_NAME}/channels/whatsapp/send")

if ! printf '%s' "$resp" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
  err=$(printf '%s' "$resp" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  echo "Error: ${err:-failed to send WhatsApp message}"
  exit 1
fi

msg=$(printf '%s' "$resp" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
echo "${msg:-WhatsApp message sent.}"
