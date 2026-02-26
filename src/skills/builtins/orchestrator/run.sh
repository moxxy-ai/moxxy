#!/bin/sh

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API_URL="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/orchestrate"

AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

RESOURCE="$1"
ACTION="$2"
ARG1="$3"
ARG2="$4"

request() {
    METHOD="$1"
    URL="$2"
    DATA="$3"

    if [ -n "$DATA" ]; then
        curl -s -X "$METHOD" ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$DATA" "$URL"
    else
        curl -s -X "$METHOD" ${AUTH_HEADER:+-H "$AUTH_HEADER"} "$URL"
    fi
}

case "$RESOURCE:$ACTION" in
    "config:get")
        request "GET" "$API_URL/config" ""
        ;;
    "config:set")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing JSON payload"}'
            exit 1
        fi
        request "POST" "$API_URL/config" "$ARG1"
        ;;
    "templates:list")
        request "GET" "$API_URL/templates" ""
        ;;
    "templates:get")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing template_id"}'
            exit 1
        fi
        request "GET" "$API_URL/templates/$ARG1" ""
        ;;
    "templates:upsert"|"templates:create")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing JSON payload"}'
            exit 1
        fi
        request "POST" "$API_URL/templates" "$ARG1"
        ;;
    "templates:patch"|"templates:update")
        if [ -z "$ARG1" ] || [ -z "$ARG2" ]; then
            echo '{"success":false,"error":"Missing template_id or JSON payload"}'
            exit 1
        fi
        request "PATCH" "$API_URL/templates/$ARG1" "$ARG2"
        ;;
    "templates:delete"|"templates:remove")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing template_id"}'
            exit 1
        fi
        request "DELETE" "$API_URL/templates/$ARG1" ""
        ;;
    "jobs:start")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing JSON payload"}'
            exit 1
        fi
        request "POST" "$API_URL/jobs" "$ARG1"
        ;;
    "jobs:run")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing JSON payload"}'
            exit 1
        fi
        request "POST" "$API_URL/jobs/run" "$ARG1"
        ;;
    "jobs:get"|"jobs:status")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "GET" "$API_URL/jobs/$ARG1" ""
        ;;
    "jobs:workers")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "GET" "$API_URL/jobs/$ARG1/workers" ""
        ;;
    "jobs:events")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "GET" "$API_URL/jobs/$ARG1/events" ""
        ;;
    "jobs:stream")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "GET" "$API_URL/jobs/$ARG1/stream" ""
        ;;
    "jobs:cancel")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "POST" "$API_URL/jobs/$ARG1/cancel" ""
        ;;
    "jobs:approve-merge"|"jobs:approve")
        if [ -z "$ARG1" ]; then
            echo '{"success":false,"error":"Missing job_id"}'
            exit 1
        fi
        request "POST" "$API_URL/jobs/$ARG1/actions/approve-merge" ""
        ;;
    *)
        echo '{"success":false,"error":"Unknown action. Use config/templates/jobs commands."}'
        exit 1
        ;;
esac
