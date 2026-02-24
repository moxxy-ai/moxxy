#!/bin/sh

# mcp builtin skill script

API_URL="${MOXXY_API_BASE:-http://127.0.0.1:17890/api}"
AGENT_NAME="${MOXXY_AGENT_NAME:-default}"
AUTH_HEADER=""
if [ -n "${MOXXY_INTERNAL_TOKEN:-}" ]; then
    AUTH_HEADER="X-Moxxy-Internal-Token: ${MOXXY_INTERNAL_TOKEN}"
fi

action="$1"

case "$action" in
    "list")
        curl -s ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API_URL}/agents/${AGENT_NAME}/mcp" | jq '.'
        ;;
    "add")
        server_name="$2"
        command="$3"
        args="$4"
        env_json="${5:-{}}"

        if [ -z "$server_name" ] || [ -z "$command" ]; then
            echo "Error: server_name and command are required."
            exit 1
        fi

        # Prepare JSON payload safely
        payload=$(jq -n \
          --arg n "$server_name" \
          --arg c "$command" \
          --arg a "$args" \
          --arg e "$env_json" \
          '{name: $n, command: $c, args: $a, env: $e}')

        curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$payload" "${API_URL}/agents/${AGENT_NAME}/mcp" | jq '.'
        ;;
    "add-json")
        json_config="$2"

        if [ -z "$json_config" ]; then
            echo "Error: JSON config is required."
            echo "Expected format: {\"mcpServers\":{\"name\":{\"command\":\"...\",\"args\":[...],\"env\":{...}}}}"
            exit 1
        fi

        # Validate JSON
        if ! echo "$json_config" | jq empty 2>/dev/null; then
            echo "Error: Invalid JSON provided."
            exit 1
        fi

        # Extract server names from mcpServers object
        servers=$(echo "$json_config" | jq -r '.mcpServers // . | keys[]' 2>/dev/null)

        if [ -z "$servers" ]; then
            echo "Error: No servers found in JSON config."
            exit 1
        fi

        # Determine the root: either .mcpServers or the object itself
        root_expr='.mcpServers // .'

        added=0
        for server_name in $servers; do
            server_json=$(echo "$json_config" | jq -c "($root_expr)[\"$server_name\"]")

            command=$(echo "$server_json" | jq -r '.command // empty')
            if [ -z "$command" ]; then
                echo "Skipping '$server_name': no command specified."
                continue
            fi

            # Convert args array to space-separated string
            args=$(echo "$server_json" | jq -r '
                if .args then
                    if (.args | type) == "array" then
                        .args | join(" ")
                    else
                        .args
                    end
                else
                    ""
                end
            ')

            # Extract env as JSON string
            env_json=$(echo "$server_json" | jq -c '.env // {}')

            payload=$(jq -n \
              --arg n "$server_name" \
              --arg c "$command" \
              --arg a "$args" \
              --arg e "$env_json" \
              '{name: $n, command: $c, args: $a, env: $e}')

            echo "Adding MCP server: $server_name"
            curl -s -X POST ${AUTH_HEADER:+-H "$AUTH_HEADER"} -H "Content-Type: application/json" -d "$payload" "${API_URL}/agents/${AGENT_NAME}/mcp" | jq '.'
            added=$((added + 1))
        done

        echo "Added $added MCP server(s). Please reboot the agent to initialize them."
        ;;
    "remove")
        server_name="$2"
        if [ -z "$server_name" ]; then
            echo "Error: server_name is required."
            exit 1
        fi

        curl -s -X DELETE ${AUTH_HEADER:+-H "$AUTH_HEADER"} "${API_URL}/agents/${AGENT_NAME}/mcp/${server_name}" | jq '.'
        ;;
    *)
        echo "Usage:"
        echo "  mcp list"
        echo "  mcp add <name> <command> <args> <env_json>"
        echo "  mcp add-json '<mcpServers JSON config>'"
        echo "  mcp remove <name>"
        exit 1
        ;;
esac
