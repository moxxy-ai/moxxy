#!/usr/bin/env bash

# Built-in Skill: remove_schedule
# Allows an agent to remove a previously scheduled background task.

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

NAME=$1

if [ -z "$NAME" ]; then
    echo "Usage: remove_schedule <job_name|--all>"
    echo "Error: Missing required argument."
    exit 1
fi

_urlencode() { printf '%s' "$1" | sed -e 's/ /%20/g' -e 's/!/%21/g' -e 's/#/%23/g' -e 's/&/%26/g' -e 's/+/%2B/g' -e 's/\//%2F/g' -e 's/:/%3A/g' -e 's/\?/%3F/g'; }

if [ "$NAME" = "--all" ]; then
    response=$(curl -s -w "\n%{http_code}" -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$MOXXY_API_BASE/agents/$AGENT_NAME/schedules")
else
    ENCODED_NAME=$(_urlencode "$NAME")
    response=$(curl -s -w "\n%{http_code}" -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$MOXXY_API_BASE/agents/$AGENT_NAME/schedules/$ENCODED_NAME")
fi

body=$(echo "$response" | sed '$d')
status_code=$(echo "$response" | tail -n 1)

if [ "$status_code" -eq 200 ]; then
    success=$(echo "$body" | grep -o '"success":true')
    if [ ! -z "$success" ]; then
        echo "Successfully removed schedule: $NAME"
        exit 0
    else
        echo "Failed to remove schedule. Server responded:"
        echo "$body"
        exit 1
    fi
else
    echo "HTTP Error $status_code when communicating with API."
    echo "Response: $body"
    exit 1
fi
