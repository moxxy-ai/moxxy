#!/bin/sh

# Our agent name is injected into the container by NativeExecutor usually as AGENT_NAME env var.
if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi


curl -s "${MOXXY_API_BASE:-http://127.0.0.1:17890/api}/agents/${AGENT_NAME}/skills"
