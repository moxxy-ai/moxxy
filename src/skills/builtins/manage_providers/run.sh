#!/bin/sh

if [ -z "$AGENT_NAME" ]; then
    AGENT_NAME="default"
fi

API_BASE="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"

ACTION=$1
shift

case "$ACTION" in
    "list")
        curl -s "$API_BASE/providers"
        ;;
    "list_custom")
        curl -s "$API_BASE/providers/custom"
        ;;
    "add")
        # Arguments: id name base_url api_format vault_key default_model [models_json]
        PROV_ID=$1
        PROV_NAME=$2
        BASE_URL=$3
        API_FORMAT=${4:-openai}
        VAULT_KEY=${5:-${PROV_ID}_api_key}
        DEFAULT_MODEL=$6
        MODELS_JSON=${7:-"[]"}

        if [ -z "$PROV_ID" ] || [ -z "$PROV_NAME" ] || [ -z "$BASE_URL" ]; then
            echo '{"success":false, "error":"Usage: manage_providers add <id> <name> <base_url> [api_format] [vault_key] [default_model] [models_json]"}'
            exit 1
        fi

        PAYLOAD=$(cat <<EOJSON
{
  "id": "$PROV_ID",
  "name": "$PROV_NAME",
  "api_format": "$API_FORMAT",
  "base_url": "$BASE_URL",
  "auth": {"type": "bearer", "vault_key": "$VAULT_KEY"},
  "default_model": "$DEFAULT_MODEL",
  "models": $MODELS_JSON,
  "extra_headers": {},
  "custom": true
}
EOJSON
)
        curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$API_BASE/providers/custom"
        ;;
    "remove")
        PROV_ID=$1
        if [ -z "$PROV_ID" ]; then
            echo '{"success":false, "error":"Usage: manage_providers remove <provider_id>"}'
            exit 1
        fi
        curl -s -X DELETE "$API_BASE/providers/custom/$PROV_ID"
        ;;
    "switch")
        PROVIDER=$1
        MODEL=$2
        if [ -z "$PROVIDER" ] || [ -z "$MODEL" ]; then
            echo '{"success":false, "error":"Usage: manage_providers switch <provider_id> <model_id>"}'
            exit 1
        fi
        curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"provider\":\"$PROVIDER\", \"model\":\"$MODEL\"}" \
            "$API_BASE/agents/$AGENT_NAME/llm"
        ;;
    *)
        echo '{"success":false, "error":"Unknown action: '"$ACTION"'. Use list, list_custom, add, remove, or switch."}'
        exit 1
        ;;
esac
