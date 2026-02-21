#!/usr/bin/env bash

# Built-in Skill: remove_schedule
# Allows an agent to remove a previously scheduled background task.

NAME=$1

if [ -z "$NAME" ]; then
    echo "Usage: remove_schedule <job_name|--all>"
    echo "Error: Missing required argument."
    exit 1
fi

if [ "$NAME" = "--all" ]; then
    response=$(curl -s -w "\n%{http_code}" -X DELETE "$MOXXY_API_BASE/agents/$AGENT_NAME/schedules")
else
    # URL encode the schedule name to safely handle spaces and special characters
    ENCODED_NAME=$(jq -rn --arg x "$NAME" '$x|@uri')
    response=$(curl -s -w "\n%{http_code}" -X DELETE "$MOXXY_API_BASE/agents/$AGENT_NAME/schedules/$ENCODED_NAME")
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
