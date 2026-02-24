#!/bin/sh

# Our agent name and API base are injected by the executor.
if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API_URL="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/vault"

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

ACTION=$1
KEY=$2
VALUE=$3

case "$ACTION" in
    "list")
        curl -s ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$API_URL"
        ;;
    "get")
        if [ -z "$KEY" ]; then
            echo '{"success":false, "error":"Missing key name for get action"}'
            exit 1
        fi
        curl -s ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$API_URL/$KEY"
        ;;
    "set")
        if [ -z "$KEY" ] || [ -z "$VALUE" ]; then
            echo '{"success":false, "error":"Missing key or value for set action"}'
            exit 1
        fi
        payload=$(python3 -c "import json,sys; print(json.dumps({'key': sys.argv[1], 'value': sys.argv[2]}))" "$KEY" "$VALUE")
        curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$payload" "$API_URL"
        ;;
    "remove")
        if [ -z "$KEY" ]; then
            echo '{"success":false, "error":"Missing key name for remove action"}'
            exit 1
        fi
        curl -s -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$API_URL/$KEY"
        ;;
    *)
        echo '{"success":false, "error":"Unknown action: '"$ACTION"'. Use list, get, set, or remove."}'
        exit 1
        ;;
esac
