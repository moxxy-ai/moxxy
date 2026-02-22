#!/bin/sh
set -eu

if [ -z "${AGENT_NAME:-}" ]; then
  echo "AGENT_NAME is required"
  exit 1
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

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
  --data-urlencode "message=${message}" \
  "${API_BASE}/agents/${AGENT_NAME}/channels/whatsapp/send")

success=$(printf '%s' "$resp" | jq -r '.success // false')
if [ "$success" != "true" ]; then
  err=$(printf '%s' "$resp" | jq -r '.error // "failed to send WhatsApp message"')
  echo "Error: $err"
  exit 1
fi

printf '%s\n' "$resp" | jq -r '.message // "WhatsApp message sent."'
