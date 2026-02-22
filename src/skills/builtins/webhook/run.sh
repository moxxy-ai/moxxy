#!/usr/bin/env bash

# Built-in Skill: webhook
# Unified webhook management — register, remove, enable, disable, update, list.

ACTION=$1

if [ -z "$ACTION" ]; then
    echo "Usage: webhook <action> [arguments...]"
    echo "Actions: register, remove, enable, disable, update, list"
    echo "Error: Missing action."
    exit 1
fi

case "$ACTION" in
    register)
        NAME=$2
        SOURCE=$3
        PROMPT_TEMPLATE=$4
        SECRET=$5
        if [ -z "$NAME" ] || [ -z "$SOURCE" ] || [ -z "$PROMPT_TEMPLATE" ]; then
            echo "Usage: webhook register <name> <source_slug> <prompt_template> [secret]"
            echo "Error: name, source_slug, and prompt_template are required."
            exit 1
        fi
        PAYLOAD=$(jq -n \
          --arg name "$NAME" \
          --arg source "$SOURCE" \
          --arg prompt_template "$PROMPT_TEMPLATE" \
          --arg secret "${SECRET:-}" \
          '{name: $name, source: $source, prompt_template: $prompt_template, secret: $secret}')
        response=$(curl -s -w "\n%{http_code}" -X POST "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
        ;;
    remove)
        NAME=$2
        if [ -z "$NAME" ]; then
            echo "Usage: webhook remove <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(jq -rn --arg x "$NAME" '$x|@uri')
        response=$(curl -s -w "\n%{http_code}" -X DELETE "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME")
        ;;
    enable)
        NAME=$2
        if [ -z "$NAME" ]; then
            echo "Usage: webhook enable <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(jq -rn --arg x "$NAME" '$x|@uri')
        PAYLOAD=$(jq -n '{active: true}')
        response=$(curl -s -w "\n%{http_code}" -X PATCH "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
        ;;
    disable)
        NAME=$2
        if [ -z "$NAME" ]; then
            echo "Usage: webhook disable <webhook_name>"
            echo "Error: webhook name is required."
            exit 1
        fi
        ENCODED_NAME=$(jq -rn --arg x "$NAME" '$x|@uri')
        PAYLOAD=$(jq -n '{active: false}')
        response=$(curl -s -w "\n%{http_code}" -X PATCH "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks/$ENCODED_NAME" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
        ;;
    update)
        NAME=$2
        SOURCE=$3
        PROMPT_TEMPLATE=$4
        SECRET=$5
        if [ -z "$NAME" ] || [ -z "$SOURCE" ] || [ -z "$PROMPT_TEMPLATE" ]; then
            echo "Usage: webhook update <name> <source_slug> <new_prompt_template> [new_secret]"
            echo "Error: name, source_slug, and prompt_template are required."
            exit 1
        fi
        PAYLOAD=$(jq -n \
          --arg name "$NAME" \
          --arg source "$SOURCE" \
          --arg prompt_template "$PROMPT_TEMPLATE" \
          --arg secret "${SECRET:-}" \
          '{name: $name, source: $source, prompt_template: $prompt_template, secret: $secret}')
        response=$(curl -s -w "\n%{http_code}" -X POST "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD")
        ;;
    list)
        response=$(curl -s -w "\n%{http_code}" -X GET "$MOXXY_API_BASE/agents/$AGENT_NAME/webhooks")
        body=$(echo "$response" | sed '$d')
        status_code=$(echo "$response" | tail -n 1)
        if [ "$status_code" -eq 200 ]; then
            echo "$body" | jq -r '.webhooks[] | "[\(if .active then "ACTIVE" else "INACTIVE" end)] \(.name) → /api/webhooks/'"$AGENT_NAME"'/\(.source)"' 2>/dev/null
            if [ $? -ne 0 ]; then
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
        webhook_url=$(echo "$body" | jq -r '.webhook_url // empty' 2>/dev/null)
        if [ ! -z "$webhook_url" ]; then
            echo "Webhook URL: $webhook_url"
        fi
        msg=$(echo "$body" | jq -r '.message // empty' 2>/dev/null)
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
