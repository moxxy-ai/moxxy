#!/usr/bin/env bash

# Built-in Skill: webhook
# Unified webhook management - register, remove, enable, disable, update, list.

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

_esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR>1{printf "%s","\\n"}{printf "%s",$0}'; }
_jv() { v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1); printf '%s' "${v:-$3}"; }
_urlencode() { printf '%s' "$1" | sed -e 's/ /%20/g' -e 's/!/%21/g' -e 's/#/%23/g' -e 's/&/%26/g' -e 's/+/%2B/g' -e 's/\//%2F/g' -e 's/:/%3A/g' -e 's/\?/%3F/g'; }

ACTION=${1:-}

if [ -z "$ACTION" ]; then
    echo "Usage: webhook <action> [arguments...]"
    echo "Actions: register, remove, enable, disable, update, list"
    echo "Error: Missing action."
    exit 1
fi

case "$ACTION" in
    register)
        NAME=${2:-}
        SOURCE=${3:-}
        PROMPT_TEMPLATE=${4:-}
        SECRET=${5:-}
        if [ -z "$NAME" ] || [ -z "$SOURCE" ] || [ -z "$PROMPT_TEMPLATE" ]; then
            echo "Usage: webhook register <name> <source_slug> <prompt_template> [secret]"
            echo "Error: name, source_slug, and prompt_template are required."
            exit 1
        fi
        PAYLOAD=$(printf '{"name":"%s","source":"%s","prompt_template":"%s","secret":"%s"}' \
          "$(_esc "$NAME")" "$(_esc "$SOURCE")" "$(_esc "$PROMPT_TEMPLATE")" "$(_esc "${SECRET:-}")")
        response=$(curl -s -w "\n%{http_code}" -X POST \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD" \
            "$API_BASE/agents/$AGENT_NAME/webhooks")
        ;;
    remove)
        NAME=${2:-}
        if [ -z "$NAME" ]; then
            echo "Usage: webhook remove <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(_urlencode "$NAME")
        response=$(curl -s -w "\n%{http_code}" -X DELETE \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            "$API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME")
        ;;
    enable)
        NAME=${2:-}
        if [ -z "$NAME" ]; then
            echo "Usage: webhook enable <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(_urlencode "$NAME")
        response=$(curl -s -w "\n%{http_code}" -X PATCH \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            -H "Content-Type: application/json" \
            -d '{"active":true}' \
            "$API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME")
        ;;
    disable)
        NAME=${2:-}
        if [ -z "$NAME" ]; then
            echo "Usage: webhook disable <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(_urlencode "$NAME")
        response=$(curl -s -w "\n%{http_code}" -X PATCH \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            -H "Content-Type: application/json" \
            -d '{"active":false}' \
            "$API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME")
        ;;
    update)
        NAME=${2:-}
        SOURCE=${3:-}
        PROMPT_TEMPLATE=${4:-}
        SECRET=${5:-}
        if [ -z "$NAME" ] || [ -z "$SOURCE" ] || [ -z "$PROMPT_TEMPLATE" ]; then
            echo "Usage: webhook update <name> <source_slug> <new_prompt_template> [new_secret]"
            echo "Error: name, source_slug, and prompt_template are required."
            exit 1
        fi
        PAYLOAD=$(printf '{"name":"%s","source":"%s","prompt_template":"%s","secret":"%s"}' \
          "$(_esc "$NAME")" "$(_esc "$SOURCE")" "$(_esc "$PROMPT_TEMPLATE")" "$(_esc "${SECRET:-}")")
        response=$(curl -s -w "\n%{http_code}" -X POST \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD" \
            "$API_BASE/agents/$AGENT_NAME/webhooks")
        ;;
    list)
        response=$(curl -s -w "\n%{http_code}" -X GET \
            ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
            "$API_BASE/agents/$AGENT_NAME/webhooks")
        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)
        if [ "$status_code" -eq 200 ]; then
            # Parse webhook list using grep/sed
            has_webhooks=false
            printf '%s' "$body" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"$//' | while read -r wh_name; do
                has_webhooks=true
                # Check if active
                active_val=$(printf '%s' "$body" | grep -o "\"name\":\"${wh_name}\"[^}]*" | grep -o '"active":[a-z]*' | head -1 | sed 's/"active"://')
                source_val=$(printf '%s' "$body" | grep -o "\"name\":\"${wh_name}\"[^}]*" | grep -o '"source":"[^"]*"' | head -1 | sed 's/"source":"//;s/"$//')
                if [ "$active_val" = "true" ]; then
                    echo "[ACTIVE] $wh_name -> /api/webhooks/${AGENT_NAME}/${source_val}"
                else
                    echo "[INACTIVE] $wh_name -> /api/webhooks/${AGENT_NAME}/${source_val}"
                fi
            done
            if [ "$has_webhooks" = "false" ]; then
                echo "No webhooks registered."
            fi
        else
            echo "HTTP Error $status_code"
            echo "$body"
        fi
        exit 0
        ;;
    *)
        echo "Unknown action: $ACTION"
        echo "Valid actions: register, remove, enable, disable, update, list"
        exit 1
        ;;
esac

body=$(echo "$response" | sed '$d')
status_code=$(echo "$response" | tail -n 1)

if [ "$status_code" -eq 200 ]; then
    success=$(echo "$body" | grep -o '"success":true')
    if [ ! -z "$success" ]; then
        echo "Successfully performed '$ACTION' on webhook."
        webhook_url=$(_jv "$body" "webhook_url" "")
        if [ ! -z "$webhook_url" ]; then
            echo "Webhook URL: $webhook_url"
        fi
        msg=$(_jv "$body" "message" "")
        if [ ! -z "$msg" ]; then
            echo "$msg"
        fi
        exit 0
    else
        echo "Failed to $ACTION webhook. Server responded:"
        echo "$body"
        exit 1
    fi
else
    echo "HTTP Error $status_code when communicating with API."
    echo "Response: $body"
    exit 1
fi
