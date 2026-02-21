#!/bin/sh

# Our agent name and API base are injected by the executor.
if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API_URL="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/vault"

ACTION=$1
KEY=$2
VALUE=$3

case "$ACTION" in
    "list")
        curl -s "$API_URL"
        ;;
    "get")
        if [ -z "$KEY" ]; then
            echo '{"success":false, "error":"Missing key name for get action"}'
            exit 1
        fi
        curl -s "$API_URL/$KEY"
        ;;
    "set")
        if [ -z "$KEY" ] || [ -z "$VALUE" ]; then
            echo '{"success":false, "error":"Missing key or value for set action"}'
            exit 1
        fi
        curl -s -X POST -H "Content-Type: application/json" -d "{\"key\":\"$KEY\", \"value\":\"$VALUE\"}" "$API_URL"
        ;;
    "remove")
        if [ -z "$KEY" ]; then
            echo '{"success":false, "error":"Missing key name for remove action"}'
            exit 1
        fi
        curl -s -X DELETE "$API_URL/$KEY"
        ;;
    *)
        echo '{"success":false, "error":"Unknown action: '"$ACTION"'. Use list, get, set, or remove."}'
        exit 1
        ;;
esac
