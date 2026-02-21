#!/usr/bin/env bash

# Built-in Skill: scheduler
# Allows an agent to schedule tasks for itself using cron syntax.

NAME=$1
CRON=$2
PROMPT=$3

if [ -z "$NAME" ] || [ -z "$CRON" ] || [ -z "$PROMPT" ]; then
    echo "Usage: scheduler <name> <cron_expression> <prompt_string>"
    echo "Error: Missing required arguments."
    exit 1
fi

PAYLOAD=$(jq -n \
  --arg name "$NAME" \
  --arg cron "$CRON" \
  --arg prompt "$PROMPT" \
  '{name: $name, cron: $cron, prompt: $prompt}')

# Use the dynamically injected API base URL
response=$(curl -s -w "\n%{http_code}" -X POST "$MOXXY_API_BASE/agents/$AGENT_NAME/schedules" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

body=$(echo "$response" | sed '$d')
status_code=$(echo "$response" | tail -n 1)

if [ "$status_code" -eq 200 ]; then
    success=$(echo "$body" | grep -o '"success":true')
    if [ ! -z "$success" ]; then
        echo "Successfully scheduled job: $NAME"
        exit 0
    else
        echo "Failed to schedule job. Server responded:"
        echo "$body"
        exit 1
    fi
else
    echo "HTTP Error $status_code when communicating with API."
    echo "Response: $body"
    exit 1
fi
